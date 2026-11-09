// OMP extension: no kit modules are imported into the long-lived host.
// Each cold/unhealthy check executes the shared preflight in a fresh native
// process, so repaired modules are picked up even when Bun caches ESM failures.
// TEMPLATE: setup pins the installation, native interpreter and safe messages.
import { execFile } from "node:child_process";
import { closeSync, fstatSync, linkSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";

const ROOT = "__ZCODE_OM_ROOT__";
const KEY_FILE = "__ZCODE_OM_KEY_FILE__";
const RUNTIME = "__ZCODE_OM_RUNTIME__";
const HEALTH_URL = "http://127.0.0.1:__ZCODE_OM_PORT__/health";
const PREFLIGHT = ROOT + "/cli/heal.mjs";
const FAILURE_DETAILS: Record<string, string> = JSON.parse("__ZCODE_OM_FAILURE_DETAILS__");
const WARNINGS: Record<string, string> = JSON.parse("__ZCODE_OM_WARNINGS__");
// Above the manager's bounded wait: do not interrupt normal detached-child
// bookkeeping. All output is captured; -p stdout is model-only.
const START_TIMEOUT_MS = 120_000;
const HEALTH_TTL_MS = 60_000;

interface ZcodeExtensionContext {
  model?: { provider?: string };
  models?: { current?: () => { provider?: string } | undefined };
}

async function healthy(): Promise<boolean> {
  try {
    const key = readFileSync(KEY_FILE, "utf8").trim();
    if (!key) return false;
    const res = await fetch(HEALTH_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(800) });
    const body = await res.json() as { status?: string; provider?: string };
    return res.ok && body?.status === "ok" && body?.provider === "zai";
  } catch { return false; }
}

type Identity = { pid: number; startedMs: number; nonce: string; at: number };
type Outcome = { exitCode: number; lines: string[]; failure?: string };
const LOG_DIR = dirname(KEY_FILE) + "/logs";
const TOKEN = LOG_DIR + "/omp-autostart.token";
const RESULT = LOG_DIR + "/omp-autostart.result";
const HOST_START_MS = Math.round(Date.now() - process.uptime() * 1000);
const LIMIT = 4096;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const identity = (): Identity => ({ pid: process.pid, startedMs: HOST_START_MS, nonce: randomUUID(), at: Date.now() });

// Read through a bounded descriptor, including when another host renames the file.
function boundedRead(path: string): string | null {
  let fd;
  try {
    fd = openSync(path, "r");
    if (!fstatSync(fd).isFile() || fstatSync(fd).size > LIMIT) return null;
    const data = Buffer.alloc(LIMIT + 1);
    const size = readSync(fd, data, 0, data.length, 0);
    return size > LIMIT ? null : data.subarray(0, size).toString("utf8");
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function parseIdentity(raw: string | null): Identity | null {
  try {
    const value = JSON.parse(raw!);
    return Number.isSafeInteger(value.pid) && value.pid > 0 && Number.isFinite(value.startedMs) && value.startedMs > 0 &&
      Number.isFinite(value.at) && typeof value.nonce === "string" && /^[a-f0-9-]{36}$/.test(value.nonce) ? value : null;
  } catch { return null; }
}
function same(a: Identity, b: Identity): boolean {
  return a.pid === b.pid && a.startedMs === b.startedMs && a.nonce === b.nonce && a.at === b.at;
}
function causes(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter(line => {
    const cause = line.match(/^\[zcode-preflight\] cause=([a-z0-9-]+)$/)?.[1];
    return cause && Object.hasOwn(WARNINGS, cause);
  }).slice(0, 16);
}
function printCauses(lines: string[]) {
  for (const line of lines) {
    const cause = line.slice("[zcode-preflight] cause=".length);
    console.error(`[zcode-autostart] ${cause}: ${WARNINGS[cause]}`);
  }
}
// Publish complete O_EXCL-created bytes atomically; a killed writer cannot leave
// an empty token which no waiter can identify. The link itself is exclusive.
function exclusive(path: string, value: Identity): boolean {
  const temp = `${path}.${value.pid}.${value.nonce}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    linkSync(temp, path);
    return true;
  } catch (err) {
    if (["EEXIST", "EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) return false;
    throw err;
  } finally { try { unlinkSync(temp); } catch {} }
}
function removeOwn(path: string, own: Identity) {
  const current = parseIdentity(boundedRead(path));
  if (current && same(current, own)) {
    if (path === TOKEN) takeOver(path, JSON.stringify(current), 0, true);
    else try { unlinkSync(path); } catch {}
  }
}
// BLOCKED DRAFT (ticket 35): host death/age does not prove that its native
// preflight child exited. The public-boundary expiry regression is deliberately
// RED pending a Charter decision on child lifetime/registration. Do not merge.
function stale(path: string, raw: string | null): boolean {
  const holder = parseIdentity(raw);
  if (holder) {
    if (Date.now() - holder.at >= START_TIMEOUT_MS) return true;
    try { process.kill(holder.pid, 0); } catch (err) { return (err as NodeJS.ErrnoException).code === "ESRCH"; }
    return false;
  }
  // A partial/corrupt token cannot prove a dead pid. Only its on-disk age
  // proves expiration, never its untrusted content.
  try { return Date.now() - statSync(path).mtimeMs >= START_TIMEOUT_MS; } catch { return false; }
}
function takeOver(path: string, raw: string | null, depth = 0, releasing = false): boolean {
  if (depth >= 4 || raw === null || (!releasing && !stale(path, raw))) return false;
  const claim = path + ".claim-" + createHash("sha256").update(raw).digest("hex");
  const own = identity();
  if (!exclusive(claim, own)) {
    const other = boundedRead(claim);
    if (!takeOver(claim, other, depth + 1) || !exclusive(claim, own)) return false;
  }
  try {
    // Only the exclusive claimant for these exact bytes may unlink them.
    // A delayed contender never deletes a successor's fresh token.
    if (boundedRead(path) !== raw || (!releasing && !stale(path, raw))) return false;
    unlinkSync(path);
    return true;
  } catch { return false; }
  finally { removeOwn(claim, own); }
}
function readResult(observed: Identity, waitStart: number): Outcome | null {
  try {
    const raw = boundedRead(RESULT);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (!value.identity || !same(value.identity, observed) || !Number.isFinite(value.at) || value.at < waitStart || value.at > Date.now() ||
      !Number.isInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255 || !Array.isArray(value.lines) || value.lines.length > 16 ||
      value.lines.some((line: unknown) => typeof line !== "string" || causes(line).length !== 1 || line.includes("\n") || line.includes("\r"))) return null;
    return { exitCode: value.exitCode, lines: value.lines };
  } catch { return null; }
}
async function singleFlight(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  const waitStart = Date.now(), deadline = waitStart + START_TIMEOUT_MS;
  let observed: Identity | null = null;
  while (Date.now() < deadline) {
    const raw = boundedRead(TOKEN);
    const current = parseIdentity(raw);
    if (current) observed = current;
    // Do not skip on health alone: the starter must publish its diagnostics.
    if (raw === null && observed) {
      const result = readResult(observed, waitStart);
      if (result) {
        printCauses(result.lines);
        if (result.exitCode === 0 && await healthy()) return;
      }
    }
    if (raw !== null) {
      takeOver(TOKEN, raw);
    } else {
      const own = identity();
      if (exclusive(TOKEN, own)) {
        let outcome: Outcome = { exitCode: 1, lines: [], failure: "startup" };
        try {
          outcome = await runPreflight(Math.max(1, deadline - Date.now()));
          printCauses(outcome.lines);
          if (outcome.failure) throw { code: outcome.failure };
          return;
        } finally {
          const temp = `${RESULT}.${own.pid}.${own.nonce}.tmp`;
          try {
            writeFileSync(temp, JSON.stringify({ identity: own, at: Date.now(), exitCode: outcome.exitCode, lines: outcome.lines }), { flag: "wx", mode: 0o600 });
            renameSync(temp, RESULT);
            // If publication fails, leave the token for proven expiration:
            // never advertise a released attempt without its result.
            removeOwn(TOKEN, own);
          } finally {
            try { unlinkSync(temp); } catch {}
          }
        }
      }
    }
    // Poll in-host, with no native waiter process and a bounded final sleep.
    await sleep(Math.max(0, Math.min(50, deadline - Date.now())));
  }
  throw { code: "timeout" };
}

function runPreflight(timeoutMs: number): Promise<Outcome> {
  try {
    if (!statSync(ROOT).isDirectory() || !statSync(PREFLIGHT).isFile()) throw new Error();
  } catch { return Promise.resolve({ exitCode: 1, lines: [], failure: "installation" }); }
  const env = { ...process.env };
  if (process.platform === "win32") {
    const pathKey = Object.hasOwn(env, "PATH") ? "PATH" : Object.keys(env).find(key => key.toLowerCase() === "path");
    const path = pathKey ? env[pathKey] : undefined;
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    if (path !== undefined) env.PATH = path;
  }
  return new Promise(resolve => {
    execFile(RUNTIME, [PREFLIGHT, "--diagnostic-code"], {
      cwd: ROOT, env, timeout: timeoutMs, maxBuffer: 64 * 1024,
      windowsHide: true, shell: false, windowsVerbatimArguments: false,
    }, (err, _stdout, stderr) => {
      if (err) {
        const code = err.code === "ENOENT" ? "runtime-unavailable"
          : err.code === "EACCES" || err.code === "EPERM" ? "runtime-denied"
          : err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output-limit"
          : err.killed || err.code === "ETIMEDOUT" ? "timeout"
          : err.code === 3 ? "foreign" : err.code === 5 ? "key" : "startup";
        resolve({ exitCode: typeof err.code === "number" && err.code >= 1 && err.code <= 255 ? err.code : 1, lines: causes(stderr), failure: code });
        return;
      }
      resolve({ exitCode: 0, lines: causes(stderr) });
    });
  });
}

export default function (pi: {
  on: (event: string, handler: (event: unknown, ctx: ZcodeExtensionContext) => Promise<void> | void) => void;
}) {
  let pending: Promise<void> | null = null;
  let nextCheck = 0, attempted = false;
  function ensureProxy(): Promise<void> {
    if (pending) return pending;
    if (Date.now() < nextCheck) return Promise.resolve();
    pending = (async () => {
      const first = !attempted;
      attempted = true;
      try {
        if (first || !await healthy()) await singleFlight();
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        const category = typeof code === "string" && Object.hasOwn(FAILURE_DETAILS, code) ? code : "startup";
        console.error(`[zcode-autostart] ${category}: ${FAILURE_DETAILS[category]} Next zcode request after 60s may retry.`);
      }
    })().finally(() => { nextCheck = Date.now() + HEALTH_TTL_MS; pending = null; });
    return pending;
  }
  pi.on("before_provider_request", async (_event, ctx) => {
    const provider = ctx?.model?.provider ?? ctx?.models?.current?.()?.provider;
    if (provider === "zcode") await ensureProxy();
  });
}
