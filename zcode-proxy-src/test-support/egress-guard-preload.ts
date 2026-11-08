// `bun test` preload (bunfig.toml [test].preload): the egress guard for the
// proxy test run (ticket 76). It installs egress-guard.mjs in this process and
// passes it on to everything the tests start: workers (both Worker classes),
// Bun child processes (BUN_OPTIONS) and Node child processes (NODE_OPTIONS).
//
// Every blocked attempt, from any of them, lands in one JSON-lines log. Around
// each test the preload reads the new lines: by default the test fails and
// names the transport, host:port and stack; with ZCODE_EGRESS_GUARD=record the
// attempts are printed to stderr and the run is not failed (diagnosis only).
// Attempts made outside a test (module load, hooks, late async work) fail the
// next test or the file's afterAll.

import { afterAll, afterEach, beforeEach, mock } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EGRESS_GUARD_LOG_ENV,
  GUARD_MODULE_URL,
  guardFetchLike,
  guardUrlCall,
  guardUrlClass,
  installEgressGuard,
  withGuardPreload,
} from "./egress-guard.mjs";

export const EGRESS_GUARD_MODE_ENV = "ZCODE_EGRESS_GUARD";

installEgressGuard();

// One log per test-runner process. A nested `bun test` (the guard's own
// fail-the-run test) gets its own log, never its parent's.
const logPath = join(mkdtempSync(join(tmpdir(), "zcode-egress-guard-")), "attempts.jsonl");
writeFileSync(logPath, "", { mode: 0o600 });
process.env[EGRESS_GUARD_LOG_ENV] = logPath;

// Forward slashes: BUN_OPTIONS is split like a command line, and Bun accepts
// them on Windows. The `=` form matters: `--preload <path>` would make Bun
// read a following subcommand (`bun test`, `bun run`) as a script name.
const guardPath = fileURLToPath(GUARD_MODULE_URL).replaceAll("\\", "/");
const bunPreloadFlag = `--preload=${guardPath}`;
const nodeImportFlag = `--import=${GUARD_MODULE_URL}`;

function appendFlag(current: string | undefined, flag: string): string {
  if (current?.includes(flag)) return current;
  return current ? `${current} ${flag}` : flag;
}

function guardEnv(base: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...base,
    [EGRESS_GUARD_LOG_ENV]: logPath,
    BUN_OPTIONS: appendFlag(base.BUN_OPTIONS, bunPreloadFlag),
    NODE_OPTIONS: appendFlag(base.NODE_OPTIONS, nodeImportFlag),
  };
}

// node:child_process reads process.env at call time; an explicit env that
// spreads process.env carries the flags as well.
Object.assign(process.env, guardEnv(process.env));

// Bun.spawn/spawnSync snapshot the environment at startup and ignore later
// process.env writes, so the guard variables are added per call.
function withGuardEnv(args: unknown[]): unknown[] {
  const [first, second, ...rest] = args;
  if (Array.isArray(first) || typeof first === "string") {
    const opts = (second && typeof second === "object" ? second : {}) as { env?: Record<string, string | undefined> };
    return [first, { ...opts, env: guardEnv(opts.env ?? process.env) }, ...rest];
  }
  if (first && typeof first === "object") {
    const opts = first as { env?: Record<string, string | undefined> };
    return [{ ...opts, env: guardEnv(opts.env ?? process.env) }, second, ...rest];
  }
  return args;
}
const originalSpawn = Bun.spawn;
const originalSpawnSync = Bun.spawnSync;
(Bun as { spawn: unknown }).spawn = (...args: unknown[]) => (originalSpawn as (...a: unknown[]) => unknown)(...withGuardEnv(args));
(Bun as { spawnSync: unknown }).spawnSync = (...args: unknown[]) => (originalSpawnSync as (...a: unknown[]) => unknown)(...withGuardEnv(args));

// `import { Worker } from "node:worker_threads"` is a builtin binding that a
// global patch cannot reach; mock.module swaps the live binding.
const workerThreads = require("node:worker_threads") as typeof import("node:worker_threads");
const RealThreadWorker = workerThreads.Worker;
class GuardedThreadWorker extends RealThreadWorker {
  constructor(filename: string | URL, options?: import("node:worker_threads").WorkerOptions) {
    super(filename, withGuardPreload(options) as import("node:worker_threads").WorkerOptions);
  }
}
const guardedThreads = { ...workerThreads, Worker: GuardedThreadWorker };
mock.module("node:worker_threads", () => ({ ...guardedThreads, default: guardedThreads }));
mock.module("worker_threads", () => ({ ...guardedThreads, default: guardedThreads }));

// Bun's builtin `undici` fetches natively, past globalThis.fetch.
const undici = require("undici") as Record<string, unknown>;
const guardedUndici: Record<string, unknown> = { ...undici };
if (typeof undici.fetch === "function") guardedUndici.fetch = guardFetchLike(undici.fetch, "undici.fetch");
for (const name of ["request", "stream", "pipeline", "connect", "upgrade"]) {
  if (typeof undici[name] === "function") guardedUndici[name] = guardUrlCall(undici[name], `undici.${name}`);
}
for (const name of ["WebSocket", "EventSource"]) {
  if (typeof undici[name] === "function") guardedUndici[name] = guardUrlClass(undici[name], `undici.${name}`);
}
mock.module("undici", () => ({ ...guardedUndici, default: guardedUndici }));

// ---- turning attempts into failures ----

type AttemptRecord = { transport: string; host: string; port: number; target: string; runtime: string; thread: string; pid: number; stack: string[] };

const failRun = process.env[EGRESS_GUARD_MODE_ENV] !== "record";
let readOffset = 0;

function drainAttempts(): AttemptRecord[] {
  let size = 0;
  try { size = statSync(logPath).size; } catch { return []; }
  if (size <= readOffset) return [];
  const text = readFileSync(logPath).subarray(readOffset, size).toString("utf8");
  const end = text.lastIndexOf("\n");
  if (end < 0) return [];
  readOffset += Buffer.byteLength(text.slice(0, end + 1));
  const out: AttemptRecord[] = [];
  for (const line of text.slice(0, end).split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as AttemptRecord); } catch { /* torn line from a killed child */ }
  }
  return out;
}

/** Consumes the attempts recorded so far, so a test that provokes them on purpose can assert on them. */
export function takeEgressAttempts(): AttemptRecord[] {
  return drainAttempts();
}

function describe(records: AttemptRecord[], when: string): string {
  const lines = [`egress guard: ${records.length} non-loopback connection attempt(s) ${when}; tests may reach loopback mocks only (ticket 76)`];
  for (const r of records) {
    lines.push(`  BLOCKED ${r.transport} ${r.host}:${r.port} ${r.target} [${r.runtime} ${r.thread} pid ${r.pid}]`);
    for (const frame of r.stack) lines.push(`      ${frame}`);
  }
  return lines.join("\n");
}

function report(when: string): void {
  const records = drainAttempts();
  if (records.length === 0) return;
  const text = describe(records, when);
  if (failRun) throw new Error(text);
  console.error(`[egress-guard record] ${text}`);
}

beforeEach(() => report("before this test started (module load, a hook or late async work)"));
afterEach(() => report("during this test"));
afterAll(() => report("after the last test of this file"));
