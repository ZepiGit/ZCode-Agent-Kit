// Proxy lifecycle module (spec §4; ADR-0003, ADR-0012). One module owns the
// start, stop, restart, the start lock, the pid record, the identity proof,
// the hung-own proof, the kill guard, respawn requests and the restart budget.
//
// Its interface is the lifecycle intents:
//   ensureRunning({ waitMs, onlyIfRecord, observe })  → outcome record
//   stop({ observe })                                 → outcome record
//   restart({ waitMs, observe })                      → outcome record (+ .stop, .start)
//   requestRespawn(pid, reason, { observe })          → outcome record (budgeted)
//   readState()                                       → { identity, pidRecord, alive }
// An outcome record is `{ intent, code, outcome, recovered, lines, error? }`:
//   code      the manager CLI's exit code for it (0–5, frozen; 1 = the intent
//             could not run, the CLI prints `manager error: <error>`);
//   outcome   a fixed word for the state it ended in ("already-running",
//             "started", "foreign", "no-key", "stopped", …);
//   recovered the hung-own recovery this intent performed, or null;
//   lines     every narration line, in order, as the manager prints them.
// The intents print nothing. Every narration line goes to proxy.log
// (`[manager <ISO>] …`) and to the caller's optional `observe(line)` the
// moment it happens, so a caller that renders progress (the manager CLI, the
// preflight) streams exactly the bytes it streamed before; the record keeps
// them all. Unexpected errors (an unreadable config, a filesystem failure
// outside the lock) still throw, as before.
//
// Safety rules (unchanged from the manager, AUD-001):
//   - Identity: a process on the configured port counts as OURS only when an
//     authenticated /health request (with the local key) answers
//     {"status":"ok","provider":"zai"}.
//   - Fail-closed stop: a process is killed ONLY when identity is "ours", the
//     pid record matches, and the live process's start time matches the one
//     recorded at spawn (PID-reuse protection). Anything doubtful is reported
//     and left running — a foreign or reused pid is never killed. After a
//     kill, the recorded process counts as exited when its pid is gone or
//     now names a process with another start time (Windows reuses pids at
//     once); an unknown start time never counts as exited.
//   - Hung-own recovery: a recorded proxy that does not answer /health may be
//     killed ONLY with the hung-own proof (start time match + kit proxy
//     command line + past the startup grace + sustained /health silence).
//   - The respawn request is accepted only for the recorded pid and is
//     rate limited by the restart budget (3 per 15 min).
//   - The start lock is exclusive and is never taken over automatically
//     (tickets 16/17 change that through acquireStartLock only).
//
// `createLifecycle({ root, home, processStartMsImpl, processCommandLineImpl,
// bunResolver, …timings })` takes the same injection points as
// `createManager`, which builds on it (seam 2). This module imports no
// presentation code: the preflight loads it without the manager CLI.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCtx } from "../cli/context.mjs";
import { createEventLogger, redactLine } from "./event-line.mjs";
import { logHeal } from "./heal-log.mjs";
import { processCommandLine, resolveBun } from "./process.mjs";
import { newStopToken, proxyServeEnv } from "./proxy-env.mjs";

const RESPAWN_LIMIT = 3;
const RESPAWN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
// The respawn hook target (ZCODE_KIT_RESPAWN_MANAGER, frozen): the manager CLI
// of the kit this module belongs to.
const DEFAULT_MANAGER_PATH = fileURLToPath(new URL("../proxy/zcode-proxy-manager.mjs", import.meta.url));

export function createLifecycle({
  root, home, processStartMsImpl, processCommandLineImpl, bunResolver,
  managerPath = DEFAULT_MANAGER_PATH,
  // Hung-own proof and respawn timings (contract defaults; tests shorten them).
  startupGraceMs = 60_000, hungProbeCount = 3, hungProbeIntervalMs = 5_000, hungProbeTimeoutMs = 5_000,
  respawnWaitMs = 30_000,
} = {}) {
  const ROOT = root ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const HOME = (home ?? process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
  const ctx = createCtx(ROOT, HOME || undefined);
  const PROXY_SRC = join(ROOT, "zcode-proxy-src");
  const CONFIG = ctx.config;
  const KEY_FILE = ctx.keyFile;
  const LOG_DIR = ctx.logDir;
  const findBun = bunResolver ?? (() => resolveBun(ROOT));
  const LOG_FILE = join(LOG_DIR, "proxy.log");
  const PID_FILE = join(LOG_DIR, "proxy.pid");
  const LOCK_FILE = join(LOG_DIR, "manager.lock");
  const RESPAWN_FILE = join(LOG_DIR, "respawn.json");
  const RESPAWN_LOCK_FILE = join(LOG_DIR, "respawn.lock");

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

  // Redaction applies to every line the manager writes or shows (ADR-0010
  // rule 4): exact known secrets plus token shapes; secret-free text is unchanged.
  // The secrets: the proxy key, and the stop token of this manager's last
  // spawn and of the recorded proxy (ticket 18).
  function knownSecrets() {
    const secrets = [];
    try { secrets.push(readKey()); } catch {}
    if (lastSpawn) secrets.push(lastSpawn.stopToken);
    const recorded = recordedStopToken();
    if (recorded) secrets.push(recorded);
    return secrets;
  }
  const redact = (text) => redactLine(text, knownSecrets());

  function appendLog(line) {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + "\n");
  }

  // ------------------------------------------------------------ narration
  // One run per intent call: it collects the narration lines and forwards
  // each to the caller's observer at once.
  function newRun(intent, observe) {
    return { intent, observe: typeof observe === "function" ? observe : null, lines: [], recovered: null };
  }
  /** Existing lines: `[manager <ISO>] …` in proxy.log, text unchanged (the golden-path script and users grep them). */
  function narrate(run, msg) {
    const text = redact(msg);
    run.lines.push(text);
    run.observe?.(text);
    try {
      appendLog(`[manager ${new Date().toISOString()}] ${text}`);
    } catch {}
  }
  function finish(run, code, outcome, extra = {}) {
    return { intent: run.intent, code, outcome, recovered: run.recovered, lines: run.lines, ...extra };
  }

  // New events: `ISO-time LEVEL manager message key=value…` (ticket 14).
  function logEvent(level, message, fields, { observe } = {}) {
    const events = createEventLogger({
      component: "manager",
      secrets: knownSecrets,
      write: (line) => {
        observe?.(line);
        try { appendLog(line); } catch {}
      },
    });
    const method = { DEBUG: events.debug, INFO: events.info, WARN: events.warn, ERROR: events.error }[level];
    if (!method) throw new TypeError(`logEvent: unknown level ${level}`);
    return method(message, fields);
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

  // ------------------------------------------------------- identity proof
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

  // ----------------------------------------------------------- pid record
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

  // The stop token (ticket 18): an additive `stopToken` field of the pid
  // record, never returned by readPidFile (so no report can print it).
  // lastSpawn = { pid, stopToken } of this manager's own last spawn.
  let lastSpawn = null;
  /** The recorded proxy's stop token, or null. */
  function recordedStopToken() {
    try {
      const j = JSON.parse(readFileSync(PID_FILE, "utf8"));
      return typeof j?.stopToken === "string" && j.stopToken ? j.stopToken : null;
    } catch {
      return null;
    }
  }

  function writePidFile(pid, startedMs) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const startedIso = Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : null;
    // Only the spawner knows the token: its writes (pid, then start time) carry it.
    const stopToken = lastSpawn?.pid === pid ? lastSpawn.stopToken : null;
    writeFileSync(PID_FILE, JSON.stringify({ pid, startedMs: startedMs ?? null, startedIso, ...(stopToken ? { stopToken } : {}) }) + "\n", { mode: 0o600 });
    // The mode option applies only to a new file: an existing record (an old
    // kit's, a damaged one) is made owner-only too (Windows: the profile ACL).
    try { chmodSync(PID_FILE, 0o600); } catch {}
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
      const starttime = Number(stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]);
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
    return sameStart(liveStart, recorded) ? "match" : "reuse-suspect";
  }

  function sameStart(liveStart, recorded) {
    // Windows records sub-ms ticks, Linux /proc exposes 10 ms ticks; macOS ps
    // only exposes whole seconds. Never accept a nearby, different generation.
    const toleranceMs = process.platform === "darwin" ? 999 : process.platform === "win32" ? 1 : 10;
    return Number.isFinite(liveStart) && Number.isFinite(recorded) && Math.abs(liveStart - recorded) <= toleranceMs;
  }

  /**
   * Has the process with this pid and recorded start time exited? Yes when no
   * process has the pid, or when the pid now names another process (a
   * different start time: Windows hands a freed pid to a new process at once,
   * ticket 70). An unknown start time is no proof: the process counts as
   * still there (fail closed). This only decides "gone"; every signal still
   * passes its own guard.
   */
  function exited(pid, startedMs = null) {
    if (!pidAlive(pid)) return true;
    if (!Number.isFinite(startedMs)) return false;
    const liveStart = (processStartMsImpl ?? processStartMs)(pid, { timeoutMs: 2500 });
    return liveStart !== null && !sameStart(liveStart, startedMs);
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

  // ------------------------------------------------------- hung-own proof
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
  async function recoverHung(run, pidInfo, reason, verb) {
    narrate(run, `hung proxy pid ${pidInfo.pid} (${reason}) — ${verb}`);
    const killed = await killOwnedIn(run, pidInfo.pid, ownershipGuard(pidInfo, { withCommand: true }), recordedStartOf(pidInfo));
    logHeal(ctx, { cause: "hung", action: "recover", result: killed ? "ok" : "failed" });
    if (!killed) {
      narrate(run, `ERROR: could not terminate hung proxy pid ${pidInfo.pid}. Next: zcode-kit doctor`);
      return false;
    }
    removePidRecordFor(pidInfo.pid);
    lastRecovery = { pid: pidInfo.pid, reason, at: Date.now() };
    run.recovered = lastRecovery;
    return true;
  }

  async function waitForExit(pid, ms, startedMs = null) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(300);
      if (exited(pid, startedMs)) return true;
    }
    return exited(pid, startedMs);
  }

  const recordedStartOf = (pidInfo) => pidInfo.startedMs ?? parseIsoMs(pidInfo.startedIso);

  // ------------------------------------------------------------ kill guard
  /**
   * Kill a verified-own process tree: graceful first, forced as escalation.
   * `guard` (recorded proxies) is re-evaluated immediately before each
   * signal; a refusal stops the escalation and reports failure (fail closed).
   * Freshly spawned children of this very call pass no guard. `startedMs`
   * (a recorded proxy's start time) lets the exit checks see a reused pid as
   * the recorded process being gone; without it they go by the pid alone.
   */
  async function killOwnedIn(run, pid, guard = null, startedMs = null) {
    const allowed = () => {
      if (!guard) return true;
      const g = guard();
      if (g === "ok") return true;
      if (g !== "gone") narrate(run, `refusing to signal pid ${pid}: ${g}`);
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
        if (result.status !== 0) narrate(run, `refusing to signal pid ${pid}: process handle identity could not be confirmed`);
        return;
      }
      try { process.kill(pid, graceful ? "SIGTERM" : "SIGKILL"); } catch {}
    };
    if (exited(pid, startedMs)) return true;
    if (!allowed()) return exited(pid, startedMs);
    signal(true);
    if (await waitForExit(pid, 5000, startedMs)) return true;
    if (!allowed()) return exited(pid, startedMs);
    signal(false);
    return waitForExit(pid, 5000, startedMs);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function openLogStream() {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const fd = openSync(LOG_FILE, "a", 0o600);
    return { fd, close: () => { try { closeSync(fd); } catch {} } };
  }

  // ------------------------------------------------------------ start lock
  // Manager start lock: guards two parallel `start` invocations. AUD-001:
  // no automatic stale takeover — an unconditional unlink after a stale
  // observation lets two contenders delete each other's fresh locks and both
  // believe they own the lock. A live holder blocks; a stale/unreadable lock
  // must be removed manually (the error names the path). Release deletes the
  // file only when the on-disk nonce still matches our own acquisition.
  // Returns { status: "acquired", release() } | { status: "contended", holder,
  // message } | { status: "unavailable", message }. This is the one place the
  // lock protocol lives (proven takeover: ticket 16; signal release: ticket 17).
  function acquireStartLock() {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const nonce = randomBytes(8).toString("hex");
    try {
      writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce }), { flag: "wx", mode: 0o600 });
      return { status: "acquired", release: () => releaseStartLock(nonce) };
    } catch (err) {
      if (err.code !== "EEXIST") return { status: "unavailable", message: err.message };
      let holder = null;
      try { holder = JSON.parse(readFileSync(LOCK_FILE, "utf8")); } catch {}
      if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
        return {
          status: "contended", holder,
          message: `another manager start is in progress (pid ${holder.pid}, started ${holder.startedAt}). If that is wrong (e.g. pid reuse), remove ${LOCK_FILE}`,
        };
      }
      return {
        status: "unavailable",
        message: `stale or unreadable manager start lock at ${LOCK_FILE}` +
          (holder ? ` (holder pid ${holder.pid} is not alive, started ${holder.startedAt})` : "") +
          ` — refusing automatic takeover. If no start is actually running, remove ${LOCK_FILE} manually and retry.`,
      };
    }
  }

  function releaseStartLock(nonce) {
    try {
      const holder = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (holder.nonce !== nonce) return; // belongs to a successor — leave it alone
    } catch {
      return;
    }
    try { unlinkSync(LOCK_FILE); } catch {}
  }

  // ------------------------------------------------------- ensure running
  // Maps an identity state to the ensure-running outcome, or null when a
  // start may proceed.
  function preStartVerdict(run, state) {
    if (state === "ours") {
      const pidInfo = readPidFile();
      narrate(run, "already running" + (pidInfo ? ` (pid ${pidInfo.pid})` : ""));
      return finish(run, 0, "already-running");
    }
    if (state === "foreign") {
      narrate(run, `ERROR: port ${loadPort()} is occupied by a foreign service (auth failed). Not touching it.`);
      return finish(run, 3, "foreign");
    }
    if (state === "nokey") {
      narrate(run, `ERROR: ${KEY_FILE} missing — cannot verify identity. Run setup first (node setup.mjs).`);
      return finish(run, 5, "no-key");
    }
    return null;
  }

  // onlyIfRecord (respawn): start only while the pid file still holds exactly
  // this record (checked under the start lock).
  async function ensureRunning({ waitMs = 25000, onlyIfRecord = null, observe } = {}) {
    return ensureRunningIn(newRun("ensure-running", observe), { waitMs, onlyIfRecord });
  }

  async function ensureRunningIn(run, { waitMs = 25000, onlyIfRecord = null } = {}) {
    rotateLogIfNeeded();
    let state;
    try {
      state = await healthIdentify();
    } catch (err) {
      narrate(run, `ERROR: ${err.message}`);
      return finish(run, 4, "identity-error");
    }
    const early = preStartVerdict(run, state);
    if (early !== null) return early;
    const lock = acquireStartLock();
    if (lock.status === "unavailable") {
      return finish(run, 1, "start-lock-unavailable", { error: lock.message });
    }
    if (lock.status === "contended") {
      // Another start holds the lock: wait (bounded) for its proxy instead of
      // failing immediately. The lock is never taken over.
      narrate(run, "another start is in progress — waiting for it to finish");
      // The holder may be proving a hung proxy (probes + process queries)
      // before its own spawn wait; do not give up while that is legitimately running.
      const contentionMs = waitMs + hungProbeCount * (hungProbeTimeoutMs + hungProbeIntervalMs) + 20_000;
      const t0 = Date.now();
      while (Date.now() - t0 < contentionMs) {
        await sleep(600);
        const s = await healthIdentify(1500);
        if (s === "ours") {
          narrate(run, "already running (started by a concurrent manager)");
          return finish(run, 0, "already-running");
        }
        if (s === "foreign") return preStartVerdict(run, s);
        if (!existsSync(LOCK_FILE)) break;
      }
      if (await healthIdentify(1500) === "ours") return finish(run, 0, "already-running");
      narrate(run, `ERROR: concurrent start did not produce a healthy proxy within ${contentionMs}ms. Run doctor; nothing was taken over.`);
      return finish(run, 4, "contention-timeout");
    }
    try {
      return await startLocked(run, { waitMs, onlyIfRecord });
    } finally {
      lock.release();
    }
  }

  async function startLocked(run, { waitMs, onlyIfRecord }) {
    // Re-verify under the lock: the state may have changed while acquiring it.
    const locked = preStartVerdict(run, await healthIdentify());
    if (locked !== null) return locked;
    const recorded = readPidFile();
    if (onlyIfRecord && !sameRecord(recorded, onlyIfRecord)) {
      // respawn: the proxy that asked was stopped or replaced meanwhile —
      // that newer decision wins; a stale helper never restarts over it.
      narrate(run, `respawn: refused — the pid record changed while waiting (now ${recorded ? `pid ${recorded.pid}` : "none"}); nothing started`);
      return finish(run, 4, "record-changed");
    }
    if (recorded && pidAlive(recorded.pid)) {
      // A live process is recorded but does not answer as ours: a starting
      // or hung proxy, or a reused pid. Only a proven hung own proxy is
      // replaced; anything else keeps its record and is never touched.
      const proof = await proveHungOwn(recorded);
      if (proof.state === "ours") {
        narrate(run, `already running (pid ${recorded.pid} answered during verification)`);
        return finish(run, 0, "already-running");
      }
      if (proof.state === "foreign") return preStartVerdict(run, "foreign");
      if (proof.proven) {
        if (!await recoverHung(run, recorded, proof.reason, "terminating and restarting")) return finish(run, 4, "hung-recovery-failed");
      } else if (proof.state !== "dead") {
        narrate(run, `ERROR: pid ${recorded.pid} from ${PID_FILE} is alive but the proxy is not answering on port ${loadPort()}, and it is not proven to be a hung kit proxy: ${proof.reason}. Refusing to start a second instance. Next: zcode-kit proxy restart (after the startup grace), then zcode-kit doctor.`);
        return finish(run, 4, "unproven-live-record");
      }
    }
    if (recorded) {
      try { unlinkSync(PID_FILE); } catch {}
    }
    if (!existsSync(join(PROXY_SRC, "node_modules"))) {
      narrate(run, "ERROR: proxy dependencies missing. Run: cd zcode-proxy-src && bun install --frozen-lockfile");
      return finish(run, 4, "dependencies-missing");
    }
    let bun;
    try {
      bun = findBun();
    } catch (err) {
      narrate(run, `ERROR: cannot start the proxy — ${err.message}`);
      return finish(run, 4, "bun-unavailable");
    }
    narrate(run, "starting zcode-proxy ...");
    const spawned = await spawnProxy(run, bun);
    if (spawned.record) return spawned.record;
    return awaitHealthy(run, spawned, waitMs);
  }

  /**
   * Spawn → pid record → start time: the window tickets 16/17 close. Returns
   * { child, out, spawnError() } or { record } when the spawn itself failed.
   */
  async function spawnProxy(run, bun) {
    const out = openLogStream();
    let spawnError = null;
    let child;
    // A fresh stop token per spawn, never an inherited one (ticket 18).
    const stopToken = newStopToken();
    try {
      child = spawn(bun, ["run", join(PROXY_SRC, "src", "index.ts"), "serve"], {
        cwd: PROXY_SRC,
        // Respawn hook: the proxy's watchdog/memory guard asks THIS manager
        // for a restart (never self-respawn: compiled binaries ignore -e).
        env: { ...proxyServeEnv(ctx, stopToken), ZCODE_LOG_FORMAT: "compact", ZCODE_KIT_RESPAWN_NODE: process.execPath, ZCODE_KIT_RESPAWN_MANAGER: managerPath },
        detached: true,
        stdio: ["ignore", out.fd, out.fd],
      });
    } catch (err) {
      out.close();
      narrate(run, `ERROR: failed to spawn bun (${err.message}).`);
      return { record: finish(run, 4, "spawn-failed") };
    }
    child.on("error", (err) => { spawnError = err; });
    child.unref();
    lastSpawn = { pid: child.pid, stopToken };
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
    return { child, out, spawnError: () => spawnError };
  }

  async function awaitHealthy(run, { child, out, spawnError }, waitMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      if (spawnError()) {
        narrate(run, `ERROR: failed to spawn bun (${spawnError().message}). Is bun on PATH?`);
        removePidRecordFor(child.pid);
        out.close();
        return finish(run, 4, "spawn-failed");
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        narrate(run, `ERROR: proxy exited immediately (code ${child.exitCode}). See ${LOG_FILE}`);
        removePidRecordFor(child.pid);
        out.close();
        return finish(run, 2, "exited");
      }
      await sleep(600);
      const s = await healthIdentify(1500);
      if (s === "ours") {
        narrate(run, `started (pid ${child.pid}) — healthy on ${base()}`);
        out.close();
        return finish(run, 0, "started", { pid: child.pid });
      }
      if (s === "foreign") {
        // The port was taken during startup — the child we spawned is our
        // own, so killing it is safe.
        narrate(run, `ERROR: port ${loadPort()} taken by a foreign service during startup (our pid ${child.pid}).`);
        await killOwnedIn(run, child.pid);
        removePidRecordFor(child.pid);
        out.close();
        return finish(run, 3, "foreign-during-start");
      }
    }
    narrate(run, `ERROR: proxy did not become healthy within ${waitMs}ms (pid ${child.pid}). See ${LOG_FILE}`);
    await killOwnedIn(run, child.pid); // our own child — safe to kill on failure
    removePidRecordFor(child.pid);
    out.close();
    return finish(run, 2, "unhealthy");
  }

  // ------------------------------------------------------------------ stop
  async function stop({ observe } = {}) {
    return stopIn(newRun("stop", observe));
  }

  async function stopIn(run) {
    const deadline = Date.now() + 30_000;
    let lock;
    for (;;) {
      lock = acquireStartLock();
      if (lock.status === "acquired") break;
      if (lock.status === "contended" && Date.now() < deadline) {
        await sleep(200);
        continue;
      }
      narrate(run, `ERROR: stop refused while lifecycle ownership is unavailable: ${lock.message}`);
      return finish(run, 4, "lock-unavailable");
    }
    try { return await stopLocked(run); }
    finally { lock.release(); }
  }

  async function stopLocked(run) {
    let portStr = String(loadPort());
    const pidInfo = readPidFile();
    const state = await healthIdentify();
    if (state === "foreign") {
      narrate(run, `ERROR: something foreign is on port ${portStr}. Refusing to stop anything.`);
      return finish(run, 3, "foreign");
    }
    if (state === "down") {
      if (pidInfo && pidAlive(pidInfo.pid)) {
        // A live recorded process that does not answer is killed only with
        // the hung-own proof; otherwise report it instead of pretending
        // nothing runs.
        const proof = await proveHungOwn(pidInfo);
        if (proof.state === "ours") return stopVerified(run, pidInfo, portStr);
        if (proof.state === "foreign") {
          narrate(run, `ERROR: something foreign is on port ${portStr}. Refusing to stop anything.`);
          return finish(run, 3, "foreign");
        }
        if (proof.proven) {
          if (!await recoverHung(run, pidInfo, proof.reason, "terminating")) return finish(run, 2, "hung-recovery-failed");
          narrate(run, `stopped (hung pid ${pidInfo.pid})`);
          return finish(run, 0, "stopped-hung", { pid: pidInfo.pid });
        }
        if (proof.state !== "dead") {
          narrate(run, `ERROR: pid ${pidInfo.pid} from ${PID_FILE} is alive but nothing answers on port ${portStr} — cannot verify it is a hung kit proxy (${proof.reason}), refusing to kill. Inspect the process manually; next: zcode-kit doctor.`);
          return finish(run, 4, "unproven-live-record");
        }
      }
      if (pidInfo) {
        try { unlinkSync(PID_FILE); } catch {}
      }
      narrate(run, "not running");
      return finish(run, 0, "not-running");
    }
    if (state === "nokey") {
      // Fail-closed: without the key we cannot tell OUR proxy from a foreign
      // one that happens to answer — never kill on an unverifiable identity.
      narrate(run, `ERROR: ${KEY_FILE} missing — identity cannot be verified, refusing to stop anything on port ${portStr}.`);
      return finish(run, 5, "no-key");
    }
    return stopVerified(run, pidInfo, portStr);
  }

  /** stop once /health answered as ours: pid file + start time must match. */
  async function stopVerified(run, pidInfo, portStr) {
    if (!pidInfo) {
      narrate(run, "ERROR: proxy healthy but no pid file — refusing to guess. Remove it manually if intended.");
      return finish(run, 4, "no-pid-record");
    }
    const verdict = verifyOwnProcess(pidInfo);
    if (verdict === "dead") {
      narrate(run,
        `ERROR: pid ${pidInfo.pid} from the pid file is gone but something still answers on port ${portStr}. ` +
          `Find the listening process manually: netstat -ano | findstr :${portStr}`,
      );
      return finish(run, 4, "recorded-pid-gone");
    }
    if (verdict === "reuse-suspect") {
      narrate(run, `ERROR: pid ${pidInfo.pid} exists but its start time does not match the pid file (PID reuse suspected) — refusing to kill.`);
      return finish(run, 4, "reuse-suspect");
    }
    if (verdict === "start-unknown") {
      // Fail-closed: when the live start time cannot be determined,
      // PID-reuse cannot be ruled out — never kill on doubtful evidence.
      narrate(run, `ERROR: start time of pid ${pidInfo.pid} is not determinable — PID reuse cannot be ruled out, refusing to kill. Find the process manually: netstat -ano | findstr :${portStr}`);
      return finish(run, 4, "start-unknown");
    }
    if (!await killOwnedIn(run, pidInfo.pid, ownershipGuard(pidInfo, { withCommand: false }), recordedStartOf(pidInfo))) {
      narrate(run, `ERROR killing pid ${pidInfo.pid}`);
      return finish(run, 2, "kill-failed");
    }
    const current = readPidFile();
    if (current?.pid === pidInfo.pid && current.startedMs === pidInfo.startedMs) removePidRecordFor(pidInfo.pid);
    narrate(run, `stopped (pid ${pidInfo.pid})`);
    return finish(run, 0, "stopped", { pid: pidInfo.pid });
  }

  // --------------------------------------------------------------- restart
  async function restart({ waitMs, observe } = {}) {
    const run = newRun("restart", observe);
    // restart = stop, then ensure running; each step keeps its own record and
    // its lines also land, in order, in the restart's record.
    const step = (intent) => newRun(intent, (line) => { run.lines.push(line); run.observe?.(line); });
    const stopped = await stopIn(step("stop"));
    run.recovered = stopped.recovered;
    if (stopped.code !== 0) return finish(run, stopped.code, stopped.outcome, { stop: stopped, start: null });
    const started = await ensureRunningIn(step("ensure-running"), waitMs === undefined ? {} : { waitMs });
    run.recovered = started.recovered ?? run.recovered;
    return finish(run, started.code, started.outcome, { stop: stopped, start: started, ...(started.error ? { error: started.error } : {}) });
  }

  // --------------------------------------------------------------- respawn
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

  async function requestRespawn(pid, reason = "unspecified", { observe } = {}) {
    const run = newRun("respawn", observe);
    const why = String(reason).replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "unspecified";
    const refuse = (msg) => {
      narrate(run, msg);
      logHeal(ctx, { cause: "respawn", action: "respawn", result: "refused" });
      return finish(run, 4, "refused");
    };
    narrate(run, `respawn: requested for pid ${pid} (reason ${why})`);
    const recorded = readPidFile();
    if (!Number.isInteger(pid) || pid <= 0 || !recorded || recorded.pid !== pid) {
      return refuse(`respawn: refused — pid ${pid} is not the recorded proxy pid (${recorded ? recorded.pid : "no pid file"})`);
    }
    const denied = await reserveRespawn(pid, why);
    if (denied) return refuse(`respawn refused: ${denied}`);
    narrate(run, `respawn: waiting up to ${Math.round(respawnWaitMs / 1000)}s for pid ${pid} to exit`);
    narrate(run, await waitForExit(pid, respawnWaitMs) ? `respawn: pid ${pid} exited` : `respawn: pid ${pid} still alive — start() decides via the hung-own proof`);
    // ensure running re-checks, under its lock, that the pid record is still
    // the one this request was for: a proxy stopped or replaced meanwhile is
    // final. A still-alive pid goes through the hung-own proof (never killed unproven).
    narrate(run, "respawn: starting a fresh proxy");
    const started = await ensureRunningIn(run, { onlyIfRecord: recorded });
    // A start lock it may not take ends the request here, as before (the CLI
    // prints `manager error: …`); nothing more is narrated or logged.
    if (started.outcome === "start-lock-unavailable") return finish(run, started.code, started.outcome, { error: started.error });
    narrate(run, `respawn: start finished with exit code ${started.code}`);
    logHeal(ctx, { cause: "respawn", action: "respawn", result: started.code === 0 ? "ok" : "failed" });
    return finish(run, started.code, started.code === 0 ? "respawned" : started.outcome, started.pid ? { pid: started.pid } : {});
  }

  // ------------------------------------------------------------ read state
  /** The identity proof plus the pid record (and whether its pid is alive). */
  async function readState() {
    const pidRecord = readPidFile();
    const identity = await healthIdentify();
    return { identity, pidRecord, alive: pidRecord ? pidAlive(pidRecord.pid) : false };
  }

  return {
    // lifecycle intents
    ensureRunning, stop, restart, requestRespawn, readState,
    // proofs and records the manager CLI's reports read
    healthIdentify, readPidFile, verifyOwnProcess, proveHungOwn, pidAlive, processStartMs,
    killOwned: (pid, guard = null, { observe } = {}) => killOwnedIn(newRun("kill", observe), pid, guard),
    lastRecovery: () => lastRecovery,
    logEvent, redact, readKey, loadPort, findBun,
    ctx, ROOT, HOME, PROXY_SRC, LOG_FILE, PID_FILE, LOCK_FILE, CONFIG, KEY_FILE, LOG_DIR, RESPAWN_FILE,
  };
}
