#!/usr/bin/env node
// zcode-proxy service manager (user-local, no admin rights).
//
// Commands: start | stop | restart | status | doctor | logs [n]
//           | respawn <pid> [--reason R] | help
//
// Safety rules:
//   - Identity: a process on the configured port counts as OURS only when an
//     authenticated /health request (with the local key) answers
//     {"status":"ok","provider":"zai"}.
//   - Fail-closed stop: stop/restart kill a process ONLY when identity is
//     "ours", the pid file matches, and the live process's start time matches
//     the one recorded at spawn (PID-reuse protection). Anything doubtful is
//     reported and left running — a foreign or reused pid is never killed.
//   - Hung-own recovery: a recorded proxy that does not answer /health may be
//     killed by start/stop/respawn ONLY with the hung-own proof (start time
//     match + kit proxy command line + past the startup grace + sustained
//     /health silence). A hung proxy would otherwise block every harness until
//     a manual kill; any unproven condition keeps the fail-closed refusal.
//   - respawn is the proxy's only restart path (watchdog/memory guard): it is
//     accepted only for the recorded pid and rate limited (3 per 15 min).
//   - start holds an exclusive lock; parallel invocations cannot race, and a
//     crashed holder's stale lock is taken over only when its pid is gone.
//   - Graceful shutdown first, forced kill only as escalation, and only for
//     verified-own processes.
//   - No component is a hard requirement: doctor checks only what is
//     installed on this machine and separates auth validity from token age.
import { spawn, spawnSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, openSync, closeSync, readSync } from "node:fs";
import { existsSync, readFileSync, statSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diagnoseQuota, quotaAuthValid } from "../cli/quota-diagnostics.mjs";
import { createCtx } from "../cli/context.mjs";
import { logHeal } from "../cli/heal.mjs";
import { processCommandLine, resolveBun } from "../lib/process.mjs";
import { proxyEnv } from "../lib/proxy-env.mjs";

// ------------------------------------------------------------------ factory
const MANAGER_PATH = fileURLToPath(import.meta.url);
const RESPAWN_LIMIT = 3;
const RESPAWN_WINDOW_MS = 15 * 60 * 1000;

export function createManager({
  root, home, processStartMsImpl, processCommandLineImpl, bunResolver,
  // Hung-own proof and respawn timings (contract defaults; tests shorten them).
  startupGraceMs = 60_000, hungProbeCount = 3, hungProbeIntervalMs = 5_000, hungProbeTimeoutMs = 5_000,
  respawnWaitMs = 30_000,
} = {}) {
  const ROOT = root ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const HOME = (home ?? process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
  const ctx = createCtx(ROOT, HOME || undefined);
  const OMP_AGENT = HOME ? HOME + "/.omp/agent" : null;
  const PROXY_SRC = join(ROOT, "zcode-proxy-src");
  const MCP_DIR = join(ROOT, "mcp", "zcode-harness-mcp");
  const CONFIG = ctx.config;
  const KEY_FILE = ctx.keyFile;
  const LOG_DIR = ctx.logDir;
  const GENERATED = ctx.generated;
  const findBun = bunResolver ?? (() => resolveBun(ROOT));
  const LOG_FILE = join(LOG_DIR, "proxy.log");
  const PID_FILE = join(LOG_DIR, "proxy.pid");
  const LOCK_FILE = join(LOG_DIR, "manager.lock");
  const RESPAWN_FILE = join(LOG_DIR, "respawn.json");
  const RESPAWN_LOCK_FILE = join(LOG_DIR, "respawn.lock");
  const MAX_LOG_BYTES = 5 * 1024 * 1024;

  // Lazy config: a missing config.yaml must not crash help/doctor — only the
  // commands that actually need the port resolve (and report) it.
  let portCache = null;
  function loadPort() {
    if (portCache === null) {
      if (!existsSync(CONFIG)) {
        throw new Error(`config not found: ${CONFIG} — run setup first (node setup.mjs)`);
      }
      portCache = Number((readFileSync(CONFIG, "utf8").match(/^  port:\s*(\d+)/m) ?? [])[1] ?? 8457);
    }
    return portCache;
  }
  const base = () => `http://127.0.0.1:${loadPort()}`;

  function readKey() {
    return readFileSync(KEY_FILE, "utf8").trim();
  }

  function logLine(msg) {
    console.log(msg);
    try {
      mkdirSync(LOG_DIR, { recursive: true });
      appendFileSync(LOG_FILE, `[manager ${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  }

  function rotateLogIfNeeded() {
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) {
        const old = LOG_FILE + ".1";
        try { unlinkSync(old); } catch {}
        renameSync(LOG_FILE, old);
      }
    } catch {}
  }

  async function healthIdentify(timeoutMs = 2500) {
    // Authenticated identity check: only OUR proxy knows the key AND reports
    // the expected identity payload. Returns "ours" | "foreign" | "down" | "nokey".
    let key;
    try {
      key = readKey();
    } catch {
      return "nokey";
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base()}/health`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 401) return "foreign"; // something answered, wrong secret
      if (res.status !== 200) return "foreign";
      const j = JSON.parse(text);
      if (j?.status === "ok" && j?.provider === "zai") return "ours";
      return "foreign";
    } catch {
      return "down";
    } finally {
      clearTimeout(t);
    }
  }

  function readPidFile() {
    try {
      const raw = readFileSync(PID_FILE, "utf8").trim();
      // Current format: JSON { pid, startedMs, startedIso, name? }
      try {
        const j = JSON.parse(raw);
        if (Number.isInteger(j.pid) && j.pid > 0) {
          return { pid: j.pid, startedMs: j.startedMs ?? parseIsoMs(j.startedIso), startedIso: j.startedIso ?? null };
        }
      } catch {}
      // Legacy format (setup <= kit-1): "<pid>\n<ISO timestamp>"
      const [pid, iso] = raw.split("\n");
      const p = Number(pid);
      if (Number.isInteger(p) && p > 0) return { pid: p, startedMs: parseIsoMs(iso), startedIso: iso ?? null };
      return null;
    } catch {
      return null;
    }
  }

  function parseIsoMs(iso) {
    const ms = Date.parse(iso ?? "");
    return Number.isFinite(ms) ? ms : null;
  }

  function writePidFile(pid, startedMs) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const startedIso = Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : null;
    writeFileSync(PID_FILE, JSON.stringify({ pid, startedMs: startedMs ?? null, startedIso }) + "\n", { mode: 0o600 });
  }

  /** Delete the PID file only while it still records the given pid. */
  function removePidRecordFor(pid) {
    const current = readPidFile();
    if (current && current.pid === pid) {
      try { unlinkSync(PID_FILE); } catch {}
    }
  }

  function pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // AUD-001: only "no such process" proves death; EPERM and unknown
      // errors fail closed — the process counts as alive.
      return err?.code !== "ESRCH";
    }
  }

  // Process start time — the PID-reuse guard. Windows asks PowerShell (ticks
  // are locale-independent); POSIX reads /proc. null = not determinable here,
  // and the caller MUST treat that as fail-closed (never kill).
  let bootTimeMs = null;
  function processStartMs(pid, { timeoutMs = 15000 } = {}) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (process.platform === "win32") {
      // Two attempts: PowerShell cold start on busy CI runners can exceed a
      // single short timeout. Argument passing avoids shell interpolation.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const r = spawnSync(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${Number(pid)}).StartTime.ToUniversalTime().Ticks`],
            { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, encoding: "utf8", windowsHide: true },
          );
          const ticks = Number((r.stdout ?? "").trim());
          if (r.status === 0 && Number.isFinite(ticks) && ticks > 0) return ticks / 10000 - 62135596800000;
        } catch {}
      }
      return null;
    }
    if (process.platform === "darwin") {
      // AUD-007: macOS has no /proc — read the process start time via ps.
      // LC_ALL=C keeps the date format locale-independent; Date.parse handles
      // the "Mon Sep 13 18:00:00 2026" ctime format.
      try {
        const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          timeout: 15000,
          env: { ...process.env, LC_ALL: "C" },
        });
        if (r.status === 0) {
          const ms = Date.parse((r.stdout ?? "").trim());
          if (Number.isFinite(ms)) return ms;
        }
      } catch {}
      return null;
    }
    try {
      if (bootTimeMs === null) {
        const stat = readFileSync("/proc/stat", "utf8");
        const m = stat.match(/^btime (\d+)$/m);
        if (m) bootTimeMs = Number(m[1]) * 1000;
      }
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const starttime = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
      if (Number.isFinite(starttime) && bootTimeMs !== null) {
        return bootTimeMs + (starttime * 1000) / 100; // CLK_TCK is 100 on Linux
      }
    } catch {}
    return null;
  }

  /**
   * Compare a live process against the pid-file record.
   * Returns "match" | "dead" | "reuse-suspect" | "start-unknown".
   */
  function verifyOwnProcess(pidInfo) {
    if (!pidAlive(pidInfo.pid)) return "dead";
    const liveStart = (processStartMsImpl ?? processStartMs)(pidInfo.pid);
    if (liveStart === null) return "start-unknown"; // platform limitation
    const recorded = pidInfo.startedMs ?? parseIsoMs(pidInfo.startedIso);
    if (recorded === null) {
      // Legacy pid file without a usable timestamp: PID reuse cannot be ruled
      // out, so ownership stays unproven (fail-closed).
      return "start-unknown";
    }
    // Windows records sub-ms ticks, Linux /proc exposes 10 ms ticks; macOS ps
    // only exposes whole seconds. Never accept a nearby, different generation.
    const toleranceMs = process.platform === "darwin" ? 999 : process.platform === "win32" ? 1 : 10;
    return Number.isFinite(liveStart) && Number.isFinite(recorded)
      && Math.abs(liveStart - recorded) <= toleranceMs ? "match" : "reuse-suspect";
  }

  /** The kit launches `bun run src/index.ts serve`; nothing else counts as our proxy. */
  function isKitProxyCommand(info) {
    if (!info || typeof info.commandLine !== "string" || typeof info.executablePath !== "string") return false;
    const tokens = info.commandLine.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(token => token.replace(/^["']|["']$/g, "")) ?? [];
    const canonical = value => {
      const normalized = resolve(value).replace(/\\/g, "/");
      return process.platform === "win32" ? normalized.toLowerCase() : normalized;
    };
    const script = canonical(join(PROXY_SRC, "src", "index.ts"));
    const ownsScript = tokens.some((token, index) => {
      if (tokens[index + 1] !== "serve") return false;
      if (/^(?:[A-Za-z]:[\\/]|\/)/.test(token)) return canonical(token) === script;
      // Legacy relative entrypoints need OS-provided cwd, never guessed cwd.
      return typeof info.cwd === "string" && canonical(resolve(info.cwd, token)) === script;
    });
    if (!ownsScript) return false;
    const exe = info.executablePath.replace(/^"|"$/g, "");
    if (/^bun(?:\.exe)?$/i.test(exe.split(/[\\/]/).pop() ?? "")) return true;
    try {
      const bun = findBun();
      return process.platform === "win32" ? bun.toLowerCase() === exe.toLowerCase() : bun === exe;
    } catch {
      return false;
    }
  }

  /**
   * Hung-own proof: may a recorded proxy that does not answer be killed?
   * Cheap conditions first, the ~25 s of /health probes last. Returns
   * { proven, reason, state } — state "ours" means it answered meanwhile.
   */
  async function proveHungOwn(pidInfo) {
    const pid = pidInfo.pid;
    const recorded = pidInfo.startedMs ?? parseIsoMs(pidInfo.startedIso);
    if (recorded !== null && Date.now() - recorded < startupGraceMs) {
      const age = Math.max(0, Math.round((Date.now() - recorded) / 1000));
      return { proven: false, reason: `pid ${pid} is ${age}s old, still within the ${Math.round(startupGraceMs / 1000)}s startup grace (a starting proxy is never killed)` };
    }
    const verdict = verifyOwnProcess(pidInfo);
    if (verdict === "dead") return { proven: false, reason: `pid ${pid} exited`, state: "dead" };
    if (verdict !== "match") {
      const why = verdict === "reuse-suspect" ? "its start time does not match the pid file (PID reuse suspected)"
        : "its start time is not determinable or not recorded (PID reuse cannot be ruled out)";
      return { proven: false, reason: `pid ${pid} ownership not proven: ${why}` };
    }
    const info = (processCommandLineImpl ?? processCommandLine)(pid);
    if (!info) return { proven: false, reason: `the command line of pid ${pid} is not readable` };
    if (!isKitProxyCommand(info)) return { proven: false, reason: `pid ${pid} is not the kit proxy (command line is not bun … src/index.ts serve)` };
    for (let i = 0; i < hungProbeCount; i++) {
      if (i > 0) await sleep(hungProbeIntervalMs);
      const s = await healthIdentify(hungProbeTimeoutMs);
      if (s !== "down") return { proven: false, reason: `the proxy answered /health (${s}) during verification`, state: s };
    }
    const silentSec = Math.round((hungProbeCount * hungProbeTimeoutMs + (hungProbeCount - 1) * hungProbeIntervalMs) / 1000);
    return { proven: true, reason: `no /health answer on ${hungProbeCount} probes over ~${silentSec}s` };
  }

  function sameRecord(a, b) {
    return !!a && !!b && a.pid === b.pid && (a.startedMs ?? null) === (b.startedMs ?? null);
  }

  /**
   * Signal guard for killOwned: the proof is minutes old by the time a signal
   * is sent (probes, graceful wait), so the pid may have exited, been reused,
   * or been replaced by a concurrent manager. Re-checked right before EVERY
   * signal; anything but a still-recorded, start-time-matching process fails
   * closed. withCommand also re-reads the command line (hung path: no /health
   * identity backs it). Returns "ok" | "gone" | a refusal reason.
   */
  function ownershipGuard(pidInfo, { withCommand }) {
    return () => {
      if (!sameRecord(readPidFile(), pidInfo)) return "the pid record changed (stopped or replaced concurrently)";
      const verdict = verifyOwnProcess(pidInfo);
      if (verdict === "dead") return "gone";
      if (verdict !== "match") return "its start time no longer matches the pid record";
      if (withCommand && !isKitProxyCommand((processCommandLineImpl ?? processCommandLine)(pidInfo.pid))) {
        return "its command line is no longer readable as the kit proxy";
      }
      return "ok";
    };
  }

  let lastRecovery = null;
  /** Kill a proven hung own proxy and drop its record; logged for heal.log. */
  async function recoverHung(pidInfo, reason, verb) {
    logLine(`hung proxy pid ${pidInfo.pid} (${reason}) — ${verb}`);
    const killed = await killOwned(pidInfo.pid, ownershipGuard(pidInfo, { withCommand: true }));
    logHeal(ctx, { cause: "hung", action: "recover", result: killed ? "ok" : "failed" });
    if (!killed) {
      logLine(`ERROR: could not terminate hung proxy pid ${pidInfo.pid}. Next: zcode-kit doctor`);
      return false;
    }
    removePidRecordFor(pidInfo.pid);
    lastRecovery = { pid: pidInfo.pid, reason, at: Date.now() };
    return true;
  }

  async function waitForExit(pid, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(300);
      if (!pidAlive(pid)) return true;
    }
    return !pidAlive(pid);
  }

  /**
   * Kill a verified-own process tree: graceful first, forced as escalation.
   * `guard` (recorded proxies) is re-evaluated immediately before each
   * signal; a refusal stops the escalation and reports failure (fail closed).
   * Freshly spawned children of this very call pass no guard.
   */
  async function killOwned(pid, guard = null) {
    const allowed = () => {
      if (!guard) return true;
      const g = guard();
      if (g === "ok") return true;
      if (g !== "gone") logLine(`refusing to signal pid ${pid}: ${g}`);
      return false;
    };
    const signal = (graceful) => {
      if (process.platform === "win32") {
        // Capture the OS generation, then open ONE handle and compare that same
        // handle's creation time before terminating. Numeric taskkill /PID could
        // otherwise target a reused PID between the final guard and the signal.
        const expected = processStartMs(pid);
        if (expected === null || !allowed()) return;
        const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZCodeProcessHandle {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr handle, uint code);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$handle = [ZCodeProcessHandle]::OpenProcess(0x1001, $false, ${pid})
if ($handle -eq [IntPtr]::Zero) { exit 4 }
try {
 [long]$created=0; [long]$exited=0; [long]$kernel=0; [long]$user=0
 if (-not [ZCodeProcessHandle]::GetProcessTimes($handle,[ref]$created,[ref]$exited,[ref]$kernel,[ref]$user)) { exit 4 }
 $started=[DateTime]::FromFileTimeUtc($created)
 $expected=[DateTimeOffset]::FromUnixTimeMilliseconds(${Math.trunc(expected)}).UtcDateTime
 if ([Math]::Abs(($started-$expected).TotalMilliseconds) -gt 1) { exit 4 }
 if (-not [ZCodeProcessHandle]::TerminateProcess($handle,0)) { exit 4 }
} finally { [void][ZCodeProcessHandle]::CloseHandle($handle) }
`;
        const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {stdio:"pipe",windowsHide:true,timeout:15000});
        if (result.status !== 0) logLine(`refusing to signal pid ${pid}: process handle identity could not be confirmed`);
        return;
      }
      try { process.kill(pid, graceful ? "SIGTERM" : "SIGKILL"); } catch {}
    };
    if (!pidAlive(pid)) return true;
    if (!allowed()) return !pidAlive(pid);
    signal(true);
    if (await waitForExit(pid, 5000)) return true;
    if (!allowed()) return !pidAlive(pid);
    signal(false);
    return waitForExit(pid, 5000);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function openLogStream() {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const fd = openSync(LOG_FILE, "a", 0o600);
    return { fd, close: () => { try { closeSync(fd); } catch {} } };
  }

  // Manager start lock: guards two parallel `start` invocations. AUD-001:
  // no automatic stale takeover — an unconditional unlink after a stale
  // observation lets two contenders delete each other's fresh locks and both
  // believe they own the lock. A live holder blocks; a stale/unreadable lock
  // must be removed manually (the error names the path). Release deletes the
  // file only when the on-disk nonce still matches our own acquisition.
  let startLockNonce = null;
  function acquireStartLock() {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const nonce = randomBytes(8).toString("hex");
    try {
      writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce }), { flag: "wx", mode: 0o600 });
      startLockNonce = nonce;
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try { holder = JSON.parse(readFileSync(LOCK_FILE, "utf8")); } catch {}
      if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
        const contention = new Error(`another manager start is in progress (pid ${holder.pid}, started ${holder.startedAt}). If that is wrong (e.g. pid reuse), remove ${LOCK_FILE}`);
        contention.code = "START_IN_PROGRESS";
        throw contention;
      }
      throw new Error(
        `stale or unreadable manager start lock at ${LOCK_FILE}` +
          (holder ? ` (holder pid ${holder.pid} is not alive, started ${holder.startedAt})` : "") +
          ` — refusing automatic takeover. If no start is actually running, remove ${LOCK_FILE} manually and retry.`,
      );
    }
  }

  function releaseStartLock() {
    if (!startLockNonce) return;
    const nonce = startLockNonce;
    startLockNonce = null;
    try {
      const holder = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (holder.nonce !== nonce) return; // belongs to a successor — leave it alone
    } catch {
      return;
    }
    try { unlinkSync(LOCK_FILE); } catch {}
  }

  // ------------------------------------------------------------------ start
  // Maps an identity state to the start() outcome, or null when a start may proceed.
  function preStartVerdict(state) {
    if (state === "ours") {
      const pidInfo = readPidFile();
      logLine("already running" + (pidInfo ? ` (pid ${pidInfo.pid})` : ""));
      return 0;
    }
    if (state === "foreign") {
      logLine(`ERROR: port ${loadPort()} is occupied by a foreign service (auth failed). Not touching it.`);
      return 3;
    }
    if (state === "nokey") {
      logLine(`ERROR: ${KEY_FILE} missing — cannot verify identity. Run setup first (node setup.mjs).`);
      return 5;
    }
    return null;
  }

  // onlyIfRecord (respawn): start only while the pid file still holds exactly
  // this record (checked under the start lock).
  async function start({ waitMs = 25000, onlyIfRecord = null } = {}) {
    rotateLogIfNeeded();
    let state;
    try {
      state = await healthIdentify();
    } catch (err) {
      logLine(`ERROR: ${err.message}`);
      return 4;
    }
    const early = preStartVerdict(state);
    if (early !== null) return early;
    try {
      acquireStartLock();
    } catch (err) {
      if (err.code !== "START_IN_PROGRESS") throw err;
      // Another start holds the lock: wait (bounded) for its proxy instead of
      // failing immediately. The lock is never taken over.
      logLine("another start is in progress — waiting for it to finish");
      // The holder may be proving a hung proxy (probes + process queries)
      // before its own spawn wait; do not give up while that is legitimately running.
      const contentionMs = waitMs + hungProbeCount * (hungProbeTimeoutMs + hungProbeIntervalMs) + 20_000;
      const t0 = Date.now();
      while (Date.now() - t0 < contentionMs) {
        await sleep(600);
        const s = await healthIdentify(1500);
        if (s === "ours") {
          logLine("already running (started by a concurrent manager)");
          return 0;
        }
        if (s === "foreign") return preStartVerdict(s);
        if (!existsSync(LOCK_FILE)) break;
      }
      if (await healthIdentify(1500) === "ours") return 0;
      logLine(`ERROR: concurrent start did not produce a healthy proxy within ${contentionMs}ms. Run doctor; nothing was taken over.`);
      return 4;
    }
    try {
      // Re-verify under the lock: the state may have changed while acquiring it.
      const locked = preStartVerdict(await healthIdentify());
      if (locked !== null) return locked;
      const recorded = readPidFile();
      if (onlyIfRecord && !sameRecord(recorded, onlyIfRecord)) {
        // respawn: the proxy that asked was stopped or replaced meanwhile —
        // that newer decision wins; a stale helper never restarts over it.
        logLine(`respawn: refused — the pid record changed while waiting (now ${recorded ? `pid ${recorded.pid}` : "none"}); nothing started`);
        return 4;
      }
      if (recorded && pidAlive(recorded.pid)) {
        // A live process is recorded but does not answer as ours: a starting
        // or hung proxy, or a reused pid. Only a proven hung own proxy is
        // replaced; anything else keeps its record and is never touched.
        const proof = await proveHungOwn(recorded);
        if (proof.state === "ours") {
          logLine(`already running (pid ${recorded.pid} answered during verification)`);
          return 0;
        }
        if (proof.state === "foreign") return preStartVerdict("foreign");
        if (proof.proven) {
          if (!await recoverHung(recorded, proof.reason, "terminating and restarting")) return 4;
        } else if (proof.state !== "dead") {
          logLine(`ERROR: pid ${recorded.pid} from ${PID_FILE} is alive but the proxy is not answering on port ${loadPort()}, and it is not proven to be a hung kit proxy: ${proof.reason}. Refusing to start a second instance. Next: zcode-kit proxy restart (after the startup grace), then zcode-kit doctor.`);
          return 4;
        }
      }
      if (recorded) {
        try { unlinkSync(PID_FILE); } catch {}
      }
      if (!existsSync(join(PROXY_SRC, "node_modules"))) {
        logLine("ERROR: proxy dependencies missing. Run: cd zcode-proxy-src && bun install --frozen-lockfile");
        return 4;
      }
      let bun;
      try {
        bun = findBun();
      } catch (err) {
        logLine(`ERROR: cannot start the proxy — ${err.message}`);
        return 4;
      }
      logLine("starting zcode-proxy ...");
      const out = openLogStream();
      let spawnError = null;
      let child;
      try {
        child = spawn(bun, ["run", join(PROXY_SRC, "src", "index.ts"), "serve"], {
          cwd: PROXY_SRC,
          // Respawn hook: the proxy's watchdog/memory guard asks THIS manager
          // for a restart (never self-respawn: compiled binaries ignore -e).
          env: { ...proxyEnv(ctx), ZCODE_LOG_FORMAT: "compact", ZCODE_KIT_RESPAWN_NODE: process.execPath, ZCODE_KIT_RESPAWN_MANAGER: MANAGER_PATH },
          detached: true,
          stdio: ["ignore", out.fd, out.fd],
        });
      } catch (err) {
        out.close();
        logLine(`ERROR: failed to spawn bun (${err.message}).`);
        return 4;
      }
      child.on("error", (err) => { spawnError = err; });
      child.unref();
      // Record the pid immediately so a crash of this manager never leaves an
      // unrecorded proxy; the start time is added as soon as it is queryable.
      writePidFile(child.pid, null);
      const probeDeadline = Date.now() + 5000;
      let recordedStart = processStartMs(child.pid, { timeoutMs: 2500 });
      while (recordedStart === null && Date.now() < probeDeadline && child.pid) {
        await sleep(300);
        recordedStart = processStartMs(child.pid, { timeoutMs: 2500 });
      }
      if (recordedStart !== null) writePidFile(child.pid, recordedStart);
      const t0 = Date.now();
      while (Date.now() - t0 < waitMs) {
        if (spawnError) {
          logLine(`ERROR: failed to spawn bun (${spawnError.message}). Is bun on PATH?`);
          removePidRecordFor(child.pid);
          out.close();
          return 4;
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          logLine(`ERROR: proxy exited immediately (code ${child.exitCode}). See ${LOG_FILE}`);
          removePidRecordFor(child.pid);
          out.close();
          return 2;
        }
        await sleep(600);
        const s = await healthIdentify(1500);
        if (s === "ours") {
          logLine(`started (pid ${child.pid}) — healthy on ${base()}`);
          out.close();
          return 0;
        }
        if (s === "foreign") {
          // The port was taken during startup — the child we spawned is our
          // own, so killing it is safe.
          logLine(`ERROR: port ${loadPort()} taken by a foreign service during startup (our pid ${child.pid}).`);
          await killOwned(child.pid);
          removePidRecordFor(child.pid);
          out.close();
          return 3;
        }
      }
      logLine(`ERROR: proxy did not become healthy within ${waitMs}ms (pid ${child.pid}). See ${LOG_FILE}`);
      await killOwned(child.pid); // our own child — safe to kill on failure
      removePidRecordFor(child.pid);
      out.close();
      return 2;
    } finally {
      releaseStartLock();
    }
  }

  // ------------------------------------------------------------------- stop
  async function stop() {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try { acquireStartLock(); break; }
      catch (err) {
        if (err.code === "START_IN_PROGRESS" && Date.now() < deadline) {
          await sleep(200);
          continue;
        }
        logLine(`ERROR: stop refused while lifecycle ownership is unavailable: ${err.message}`);
        return 4;
      }
    }
    try { return await stopLocked(); }
    finally { releaseStartLock(); }
  }

  async function stopLocked() {
    let portStr = String(loadPort());
    const pidInfo = readPidFile();
    const state = await healthIdentify();
    if (state === "foreign") {
      logLine(`ERROR: something foreign is on port ${portStr}. Refusing to stop anything.`);
      return 3;
    }
    if (state === "down") {
      if (pidInfo && pidAlive(pidInfo.pid)) {
        // A live recorded process that does not answer is killed only with
        // the hung-own proof; otherwise report it instead of pretending
        // nothing runs.
        const proof = await proveHungOwn(pidInfo);
        if (proof.state === "ours") return stopVerified(pidInfo, portStr);
        if (proof.state === "foreign") {
          logLine(`ERROR: something foreign is on port ${portStr}. Refusing to stop anything.`);
          return 3;
        }
        if (proof.proven) {
          if (!await recoverHung(pidInfo, proof.reason, "terminating")) return 2;
          logLine(`stopped (hung pid ${pidInfo.pid})`);
          return 0;
        }
        if (proof.state !== "dead") {
          logLine(`ERROR: pid ${pidInfo.pid} from ${PID_FILE} is alive but nothing answers on port ${portStr} — cannot verify it is a hung kit proxy (${proof.reason}), refusing to kill. Inspect the process manually; next: zcode-kit doctor.`);
          return 4;
        }
      }
      if (pidInfo) {
        try { unlinkSync(PID_FILE); } catch {}
      }
      logLine("not running");
      return 0;
    }
    if (state === "nokey") {
      // Fail-closed: without the key we cannot tell OUR proxy from a foreign
      // one that happens to answer — never kill on an unverifiable identity.
      logLine(`ERROR: ${KEY_FILE} missing — identity cannot be verified, refusing to stop anything on port ${portStr}.`);
      return 5;
    }
    return stopVerified(pidInfo, portStr);
  }

  /** stop() once /health answered as ours: pid file + start time must match. */
  async function stopVerified(pidInfo, portStr) {
    if (!pidInfo) {
      logLine("ERROR: proxy healthy but no pid file — refusing to guess. Remove it manually if intended.");
      return 4;
    }
    const verdict = verifyOwnProcess(pidInfo);
    if (verdict === "dead") {
      logLine(
        `ERROR: pid ${pidInfo.pid} from the pid file is gone but something still answers on port ${portStr}. ` +
          `Find the listening process manually: netstat -ano | findstr :${portStr}`,
      );
      return 4;
    }
    if (verdict === "reuse-suspect") {
      logLine(`ERROR: pid ${pidInfo.pid} exists but its start time does not match the pid file (PID reuse suspected) — refusing to kill.`);
      return 4;
    }
    if (verdict === "start-unknown") {
      // Fail-closed (audit §7): when the live start time cannot be determined,
      // PID-reuse cannot be ruled out — never kill on doubtful evidence.
      logLine(`ERROR: start time of pid ${pidInfo.pid} is not determinable — PID reuse cannot be ruled out, refusing to kill. Find the process manually: netstat -ano | findstr :${portStr}`);
      return 4;
    }
    if (!await killOwned(pidInfo.pid, ownershipGuard(pidInfo, { withCommand: false }))) {
      logLine(`ERROR killing pid ${pidInfo.pid}`);
      return 2;
    }
    const current = readPidFile();
    if (current?.pid === pidInfo.pid && current.startedMs === pidInfo.startedMs) removePidRecordFor(pidInfo.pid);
    logLine(`stopped (pid ${pidInfo.pid})`);
    return 0;
  }

  async function restart() {
    const s = await stop();
    if (s !== 0) return s;
    return start();
  }

  // ---------------------------------------------------------------- respawn
  // Requested by the proxy itself (watchdog / memory guard) right before it
  // terminates. Rate limited so a proxy that keeps failing cannot turn into a
  // restart loop; history survives in logs/respawn.json.
  /** Missing file = empty history; unreadable or corrupt = null (budget unknown, fail closed). */
  function readRespawnHistory() {
    let text;
    try {
      text = readFileSync(RESPAWN_FILE, "utf8");
    } catch (err) {
      return err?.code === "ENOENT" ? [] : null;
    }
    try {
      const j = JSON.parse(text);
      if (!Array.isArray(j?.events) || !j.events.every((e) => Number.isFinite(e?.at))) return null;
      return j.events;
    } catch {
      return null;
    }
  }

  /**
   * Reserve one slot of the restart budget. Read-check-write runs under an
   * exclusive lock so concurrent helpers cannot all see "2 used" and all
   * proceed; the write is atomic (temp + rename). Every failure refuses:
   * an unknown budget must never become an unlimited one. Like the start
   * lock, a stale lock is never taken over automatically.
   * Returns null on success, else the refusal message.
   */
  async function reserveRespawn(pid, why) {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    let fd = null;
    for (let attempt = 0; fd === null && attempt < 20; attempt++) {
      try {
        fd = openSync(RESPAWN_LOCK_FILE, "wx", 0o600);
      } catch (err) {
        if (err?.code !== "EEXIST") return `respawn budget lock unavailable (${err?.code ?? "error"})`;
        await sleep(100);
      }
    }
    if (fd === null) return `respawn budget lock ${RESPAWN_LOCK_FILE} is held; if no respawn is running, remove it manually`;
    try {
      const history = readRespawnHistory();
      if (history === null) return `${RESPAWN_FILE} is unreadable or corrupt; restart budget unknown — inspect or remove it`;
      const now = Date.now();
      const recent = history.filter((e) => now - e.at < RESPAWN_WINDOW_MS);
      if (recent.length >= RESPAWN_LIMIT) return `${RESPAWN_LIMIT} restarts in ${RESPAWN_WINDOW_MS / 60000} min; inspect logs/proxy.log`;
      const temp = `${RESPAWN_FILE}.${process.pid}-${randomBytes(4).toString("hex")}`;
      try {
        writeFileSync(temp, JSON.stringify({ events: [...recent, { at: now, pid, reason: why }] }) + "\n", { flag: "wx", mode: 0o600 });
        renameSync(temp, RESPAWN_FILE);
      } catch (err) {
        try { unlinkSync(temp); } catch {}
        return `cannot record the restart in ${RESPAWN_FILE} (${err?.code ?? "error"})`;
      }
      return null;
    } finally {
      closeSync(fd);
      try { unlinkSync(RESPAWN_LOCK_FILE); } catch {}
    }
  }

  async function respawn(pid, reason = "unspecified") {
    const why = String(reason).replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "unspecified";
    const refuse = (msg, code = 4) => {
      logLine(msg);
      logHeal(ctx, { cause: "respawn", action: "respawn", result: "refused" });
      return code;
    };
    logLine(`respawn: requested for pid ${pid} (reason ${why})`);
    const recorded = readPidFile();
    if (!Number.isInteger(pid) || pid <= 0 || !recorded || recorded.pid !== pid) {
      return refuse(`respawn: refused — pid ${pid} is not the recorded proxy pid (${recorded ? recorded.pid : "no pid file"})`);
    }
    const denied = await reserveRespawn(pid, why);
    if (denied) return refuse(`respawn refused: ${denied}`);
    logLine(`respawn: waiting up to ${Math.round(respawnWaitMs / 1000)}s for pid ${pid} to exit`);
    logLine(await waitForExit(pid, respawnWaitMs) ? `respawn: pid ${pid} exited` : `respawn: pid ${pid} still alive — start() decides via the hung-own proof`);
    // start() re-checks, under its lock, that the pid record is still the one
    // this request was for: a proxy stopped or replaced meanwhile is final.
    // A still-alive pid goes through start()'s hung-own proof (never killed unproven).
    logLine("respawn: starting a fresh proxy");
    const code = await start({ onlyIfRecord: recorded });
    logLine(`respawn: start finished with exit code ${code}`);
    logHeal(ctx, { cause: "respawn", action: "respawn", result: code === 0 ? "ok" : "failed" });
    return code;
  }

  // ----------------------------------------------------------------- status
  async function status() {
    const pidInfo = readPidFile();
    const state = await healthIdentify();
    console.log(`port:      ${portOrNull()}`);
    console.log(`pid file:  ${pidInfo ? `${pidInfo.pid} (started ${pidInfo.startedIso ?? "unknown"})` : "none"}`);
    console.log(`health:    ${state}`);
    if (state === "down" && pidInfo && pidAlive(pidInfo.pid)) {
      console.log(`  pid ${pidInfo.pid} is alive but not answering — next: zcode-kit proxy restart, then zcode-kit doctor`);
    }
    if (state === "ours") {
      for (const line of detailLines(await healthDetails())) console.log(line);
      const key = readKey();
      try {
        const q = await fetch(`${base()}/quota`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
        const j = await q.json();
        if (q.ok) {
          for (const b of j.balances ?? []) {
            console.log(`  quota: ${b.showName} ${b.remainingUnits}/${b.totalUnits} ${b.unitType} (expires ${new Date(b.expiresAt * 1000).toISOString()})`);
          }
        } else {
          console.log(`  quota: HTTP ${q.status}`);
        }
      } catch (err) {
        console.log(`  quota: unavailable (${err.message})`);
      }
    }
    return state === "ours" ? 0 : 1;
  }

  /** /health `details` (newer proxies only); null when absent or unreadable. */
  async function healthDetails() {
    try {
      const res = await fetch(`${base()}/health`, { headers: { Authorization: `Bearer ${readKey()}` }, signal: AbortSignal.timeout(5000) });
      const j = await res.json();
      return j?.details && typeof j.details === "object" ? j.details : null;
    } catch {
      return null;
    }
  }

  function detailLines(d) {
    if (!d) return [];
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    const lines = [];
    const proc = [
      num(d.pid) && `pid ${d.pid}`,
      num(d.uptimeSec) && `up ${d.uptimeSec}s`,
      num(d.rssMB) && `rss ${d.rssMB} MB`,
      num(d.heapUsedMB) && `heap ${d.heapUsedMB} MB`,
      num(d.eventLoopLagMs) && `event-loop lag ${d.eventLoopLagMs} ms`,
    ].filter(Boolean);
    if (proc.length) lines.push(`process:   ${proc.join(", ")}`);
    const c = d.captcha;
    if (c === null) lines.push("captcha:   not loaded");
    else if (c && typeof c === "object") {
      lines.push(`captcha:   ${[
        num(c.ready) && `ready ${c.ready}/${num(c.target) ? c.target : "?"}`,
        num(c.activeSolves) && `active solves ${c.activeSolves}`,
        typeof c.storm === "boolean" && `storm ${c.storm ? "yes" : "no"}`,
        num(c.mintSuccessRate10m) && `mint success ${Math.round(c.mintSuccessRate10m * 100)}% (10 min)`,
      ].filter(Boolean).join(", ")}`);
      const s = c.solver;
      if (s && typeof s === "object") {
        const last = typeof s.lastRecycleReason === "string"
          ? ` (last: ${s.lastRecycleReason}${num(s.lastRecycleAt) ? ` at ${new Date(s.lastRecycleAt).toISOString()}` : ""})` : "";
        lines.push(`solver:    ${[
          num(s.generation) && `generation ${s.generation}`,
          num(s.recycles) && `recycles ${s.recycles}${last}`,
          num(s.totalSolves) && `solves ${s.totalSolves}`,
          num(s.totalFailures) && `failures ${s.totalFailures}`,
          typeof s.busy === "boolean" && (s.busy ? "busy" : "idle"),
        ].filter(Boolean).join(", ")}`);
        if (Array.isArray(s.lastSdkScripts)) {
          const scripts = s.lastSdkScripts.slice(0, 16)
            .filter(script => script && typeof script.filename === "string" && /^[\w.-]{1,64}$/.test(script.filename)
              && typeof script.sha256 === "string" && /^[0-9a-f]{64}$/.test(script.sha256))
            .map(script => `${script.filename} sha256=${script.sha256.slice(0, 12)}`);
          if (scripts.length) lines.push(`sdk:       ${scripts.join(", ")} (diagnostics, not compatibility proof)`);
        }
      }
    }
    return lines;
  }

  function portOrNull() {
    try { return loadPort(); } catch { return "(config missing)"; }
  }

  // ----------------------------------------------------------------- doctor
  function commandOnPath(cmd) {
    try {
      execSync(`${process.platform === "win32" ? "where" : "which"} ${cmd}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  function ompHasZcode() {
    try {
      const yml = readFileSync(OMP_AGENT + "/models.yml", "utf8");
      return /^  zcode:\s*$/m.test(yml);
    } catch {
      return false;
    }
  }

  /** Proves Bun can actually be started (a PATH hit alone is not startable). */
  function bunStartable() {
    let bun;
    try {
      bun = findBun();
    } catch (err) {
      return { ok: false, detail: err.message };
    }
    const r = spawnSync(bun, ["--version"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10000, windowsHide: true });
    if (r.error || r.status !== 0) return { ok: false, detail: `${bun} cannot be started (${r.error?.message ?? `exit ${r.status}`})` };
    return { ok: true, detail: `${bun} (${(r.stdout ?? "").trim()})` };
  }

  /**
   * Proves the credential store is decryptable by THIS runtime, offline: the
   * proxy's own store module is loaded in a child that prints only a boolean.
   */
  function credentialStoreState(credentials) {
    if (!existsSync(credentials)) return { ok: false, detail: "no credential store — run: zcode-kit auth login" };
    let bun;
    try {
      bun = findBun();
    } catch {
      return { ok: null, detail: "store present; decryptability not checked (Bun unavailable)" };
    }
    const probe = 'import { loadCredential } from "./src/auth/store.ts"; const c = await loadCredential({ migrate: false }); console.log(c && typeof c.apiKey === "string" && c.apiKey.length > 0 ? "DECRYPTABLE" : "UNREADABLE");';
    const r = spawnSync(bun, ["-e", probe], {
      cwd: PROXY_SRC,
      env: { ...proxyEnv(ctx), ZCODE_PROXY_CREDENTIALS_PATH: credentials },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return { ok: null, detail: "store present; decryptability probe failed to run" };
    const decryptable = (r.stdout ?? "").trim().split("\n").pop() === "DECRYPTABLE";
    return { ok: decryptable, detail: decryptable ? "present and decryptable on this machine" : "present but NOT decryptable here — re-run: zcode-kit auth login" };
  }

  async function doctor() {
    const checks = [];
    // ok: true|false|null (null = skip, not counted as failure)
    const add = (name, ok, detail) => checks.push({ name, ok, detail });
    const bunState = bunStartable();
    add("bun available", bunState.ok, bunState.detail);
    add("config exists", existsSync(CONFIG), CONFIG);
    add("key file exists", existsSync(KEY_FILE), KEY_FILE);
    add("proxy source installed", existsSync(join(PROXY_SRC, "node_modules")), join(PROXY_SRC, "node_modules"));
    const overrides = Object.keys(process.env).filter((k) => /^ZCODE_(?:PROXY_PORT|PROXY_API_KEY|CLAIM_|ASYNC_|DUMP_)/.test(k));
    if (overrides.length) add("proxy env overrides", false, `ignored by the kit-managed proxy (unset them): ${overrides.join(", ")}`);
    if (process.env.ZCODE_PROXY_CREDENTIALS_PATH || HOME) {
      const credentials = process.env.ZCODE_PROXY_CREDENTIALS_PATH || join(HOME, ".zcode-proxy", "credentials.json");
      const cred = credentialStoreState(credentials);
      add("credentials store", cred.ok, `${process.env.ZCODE_PROXY_CREDENTIALS_PATH ? "ZCODE_PROXY_CREDENTIALS_PATH (explicit store)" : "~/.zcode-proxy/credentials.json"}: ${cred.detail}`);
    } else {
      add("credentials store", null, "USERPROFILE/HOME not set — skipped");
    }

    // OMP checks only apply when OMP is actually installed here; a Codex-only
    // user must not get FAIL lines about OMP.
    const ompInstalled = !!OMP_AGENT && existsSync(join(OMP_AGENT, "models.yml"));
    if (ompInstalled) {
      add("omp provider registered", ompHasZcode(), "zcode block in ~/.omp/agent/models.yml");
      add("extension installed", existsSync(OMP_AGENT + "/extensions/zcode-proxy-autostart.ts"), "~/.omp/agent/extensions/zcode-proxy-autostart.ts");
    } else {
      add("omp integration", null, "OMP not installed — skipped");
    }
    if (existsSync(MCP_DIR)) {
      add("mcp bridge installed", existsSync(join(MCP_DIR, "dist", "index.js")), join(MCP_DIR, "dist", "index.js"));
      add("mcp bridge deps", existsSync(join(MCP_DIR, "node_modules")), join(MCP_DIR, "node_modules"));
    }
    if (existsSync(join(GENERATED, "claude-zcode-settings.json"))) {
      add("claude adapter artifact", true, "generated/claude-zcode-settings.json");
    }
    if (existsSync(join(GENERATED, "codex-home", "config.toml"))) {
      add("codex adapter artifact", true, "generated/codex-home/config.toml");
    }

    let state = "down";
    let configOk = existsSync(CONFIG);
    if (configOk) {
      state = await healthIdentify();
      add("proxy reachable + identity", state === "ours", `health=${state}`);
      if (state === "ours") {
        const q = await authState();
        add("account auth valid", q.valid, q.detail);
        if (q.ageHours !== null && q.ageHours !== undefined) {
          add("start-plan JWT age (info)", true, `${q.ageHours.toFixed(1)}h since issue — age is informational, validity is the auth check above`);
        }
      }
    } else {
      add("proxy reachable + identity", null, "no config — skipped");
    }

    let failed = 0, skipped = 0;
    for (const c of checks) {
      const tag = c.ok === null ? "SKIP" : c.ok ? "PASS" : "FAIL";
      if (c.ok === false) failed++;
      if (c.ok === null) skipped++;
      console.log(`${tag}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.log(failed === 0 ? `doctor: ${skipped} skipped, ${failed} failed — OK` : `doctor: ${failed} check(s) failed`);
    return failed === 0 ? 0 : 1;
  }

  /**
   * Real auth validity from the account endpoint, separated from token age:
   * HTTP 200 → valid; 401/403 → invalid; quota-exhausted envelope → valid
   * account, exhausted quota (reported, not a failure).
   */
  async function authState() {
    try {
      const key = readKey();
      const q = await fetch(`${base()}/quota`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      const j = await q.json().catch(() => null);
      const diagnostic = diagnoseQuota(q.status, j);
      const valid = quotaAuthValid(q.status, j, diagnostic);
      const issuedAt = j?.jwt?.issuedAt;
      return {
        valid,
        detail: diagnostic.cause === "healthy" ? "valid" : diagnostic.detail,
        ageHours: Number.isFinite(issuedAt) ? (Date.now() / 1000 - issuedAt) / 3600 : null,
      };
    } catch {
      return { valid: false, detail: "auth check unreachable; quota authentication not proven", ageHours: null };
    }
  }

  // ------------------------------------------------------------------- logs
  function logs(n = 40) {
    if (!existsSync(LOG_FILE)) {
      console.log(`(no log file at ${LOG_FILE})`);
      return 0;
    }
    const size = statSync(LOG_FILE).size;
    const tailBytes = Math.min(size, 64 * 1024);
    const fh = openSync(LOG_FILE, "r");
    try {
      const buf = Buffer.alloc(tailBytes);
      readSync(fh, buf, 0, tailBytes, size - tailBytes);
      const lines = buf.toString("utf8").split("\n").filter(Boolean);
      console.log(lines.slice(-n).join("\n"));
    } finally {
      closeSync(fh);
    }
    return 0;
  }

  return {
    start, stop, restart, respawn, status, doctor, logs, healthIdentify, readPidFile, verifyOwnProcess, proveHungOwn,
    pidAlive, processStartMs, killOwned, lastRecovery: () => lastRecovery,
    LOG_FILE, PID_FILE, CONFIG, KEY_FILE, LOG_DIR, RESPAWN_FILE,
  };
}

// ---------------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const m = createManager();
  async function main() {
    const cmd = process.argv[2] ?? "help";
    switch (cmd) {
      case "start": process.exit(await m.start()); break;
      case "stop": process.exit(await m.stop()); break;
      case "restart": process.exit(await m.restart()); break;
      case "status": process.exit(await m.status()); break;
      case "doctor": process.exit(await m.doctor()); break;
      case "logs": process.exit(m.logs(Number(process.argv[3] ?? 40) || 40)); break;
      case "respawn": {
        const at = process.argv.indexOf("--reason");
        process.exit(await m.respawn(Number(process.argv[3]), at > 0 ? process.argv[at + 1] : undefined));
        break;
      }
      case "help":
      default:
        console.log("zcode-proxy-manager — start | stop | restart | status | doctor | logs [n] | respawn <pid> [--reason R] | help");
    }
  }
  main().catch((err) => {
    console.error("manager error:", err.message);
    process.exit(1);
  });
}
