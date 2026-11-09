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
//     recorded at spawn (PID-reuse protection; on Windows the exact start
//     ticks, compared as integers up to the handle the signal goes through,
//     ticket 77). Anything doubtful is reported
//     and left running — a foreign or reused pid is never killed. After a
//     kill, the recorded process counts as exited when its pid is gone or
//     now names a process with another start time (Windows reuses pids at
//     once); an unknown start time never counts as exited.
//   - Hung-own recovery: a recorded proxy that does not answer /health may be
//     killed ONLY with the hung-own proof (start time match + kit proxy
//     command line + past the startup grace + sustained /health silence).
//   - The respawn request is accepted only for the recorded pid and is
//     rate limited by the restart budget (3 per 15 min).
//   - The start lock is exclusive (lib/start-lock.mjs, protocol v1). A stale
//     lock is taken over only on proof that its holder is gone (pid dead, or
//     pid reused); a live holder's lock is never touched (AUD-001, as
//     amended by ADR-0003: takeover on proof, under an exclusive claim, so
//     two contenders can never delete each other's fresh locks).
//   - The spawn → pid record window is closed (ADR-0003 amendment, Round 7
//     Q4): the record is written as a spawn intent before the spawn, with
//     the pid right after it, and with the start time once it is known. A
//     record its spawner could not finish (killed, or a start-time probe
//     that timed out) is completed under the start lock only with proof:
//     the authenticated /health answer names the pid, and the pid's start
//     time read before and after that answer is the same. A record is
//     never completed from a port or a pid alone.
//   - A spawner killed inside CreateProcess (Windows) leaves its proxy
//     suspended before its first instruction, with only the intent recorded.
//     The next start resumes it, never kills it, and only when it is the one
//     child of the dead spawner with this installation's kit proxy command
//     line, started after the intent; the proof above then adopts it.
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
import { createStartLock, linuxStartId } from "./start-lock.mjs";

const RESPAWN_LIMIT = 3;
const RESPAWN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
// The respawn hook target (ZCODE_KIT_RESPAWN_MANAGER, frozen): the manager CLI
// of the kit this module belongs to.
const DEFAULT_MANAGER_PATH = fileURLToPath(new URL("../proxy/zcode-proxy-manager.mjs", import.meta.url));

// Windows start identity (ticket 77). PowerShell reports a process's start as
// .NET UTC ticks (100 ns since 0001-01-01); the count (~6.39e17) is above
// 2^53, so it is carried as an exact integer (a decimal string in the pid
// record, a BigInt in arithmetic) and never through a JS Number.
const UNIX_EPOCH_TICKS = 621355968000000000n;
const FILETIME_EPOCH_TICKS = 504911232000000000n; // ticks = FILETIME + this
const MAX_TICKS = 0x7fffffffffffffffn;

/**
 * A start identity from PowerShell's `.Ticks` text: `{ ms, ticks }` with the
 * exact tick count and the milliseconds since the Unix epoch derived from it
 * without float loss (the integer millisecond is always the true one), or
 * null when the text is not a tick count after the Unix epoch.
 */
function startFromTicks(text) {
  const digits = String(text ?? "").trim();
  if (!/^\d{1,19}$/.test(digits)) return null;
  const ticks = BigInt(digits);
  if (ticks <= UNIX_EPOCH_TICKS || ticks > MAX_TICKS) return null;
  const unix = ticks - UNIX_EPOCH_TICKS;
  return { ms: Number(unix / 10000n) + Number(unix % 10000n) / 10000, ticks: ticks.toString() };
}

// The kill guard's exit codes: each refusal branch has its own (ticket 77).
const KILL_GUARD_EXITS = {
  2: "OpenProcess failed (the process is gone or not accessible)",
  3: "GetProcessTimes failed",
  4: "the handle's creation time differs from the expected start",
  5: "TerminateProcess failed",
};

/**
 * The Windows kill guard (PowerShell): open ONE handle to `pid`, compare that
 * handle's creation FILETIME with the expected start (exact integer ticks,
 * no millisecond rounding), and only then terminate it. Exit 0 = terminated;
 * 2/3/4/5 as KILL_GUARD_EXITS.
 */
export function killGuardScript(pid, startTicks) {
  const ticks = BigInt(startTicks);
  if (ticks <= FILETIME_EPOCH_TICKS || ticks > MAX_TICKS) throw new RangeError(`killGuardScript: not a start tick count: ${startTicks}`);
  const created = ticks - FILETIME_EPOCH_TICKS;
  return `
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
$handle = [ZCodeProcessHandle]::OpenProcess(0x1001, $false, ${Number(pid)})
if ($handle -eq [IntPtr]::Zero) { exit 2 }
try {
 [long]$created=0; [long]$exited=0; [long]$kernel=0; [long]$user=0
 if (-not [ZCodeProcessHandle]::GetProcessTimes($handle,[ref]$created,[ref]$exited,[ref]$kernel,[ref]$user)) { exit 3 }
 if ($created -ne [long]'${created}') { exit 4 }
 if (-not [ZCodeProcessHandle]::TerminateProcess($handle,0)) { exit 5 }
} finally { [void][ZCodeProcessHandle]::CloseHandle($handle) }
`;
}

/** The narration line for a kill guard run that did not terminate (null for exit 0). */
function killGuardRefusal(pid, status) {
  if (status === 0) return null;
  if (status === 5) return `could not signal pid ${pid}: TerminateProcess failed after its identity matched (kill guard exit 5)`;
  const why = status === null ? "none: PowerShell did not finish (timeout or spawn failure)"
    : `${status}: ${KILL_GUARD_EXITS[status] ?? "PowerShell error"}`;
  return `refusing to signal pid ${pid}: process handle identity could not be confirmed (kill guard exit ${why})`;
}

export function createLifecycle({
  root, home, processStartMsImpl, processCommandLineImpl, bunResolver,
  managerPath = DEFAULT_MANAGER_PATH,
  // Hung-own proof and respawn timings (contract defaults; tests shorten them).
  startupGraceMs = 60_000, hungProbeCount = 3, hungProbeIntervalMs = 5_000, hungProbeTimeoutMs = 5_000,
  respawnWaitMs = 30_000,
  // How long a start that met an unfinished spawn record waits for that
  // proxy to answer before it spawns its own (capped by the start's waitMs).
  pendingSpawnWaitMs = 10_000,
  // Called with the name of every start-lock and spawn step (tests inject kills here).
  stepHook = () => {},
  // A dead spawner's never-started proxy (resumeNeverStarted): its children,
  // and the resume. Defaults: the OS (Windows CIM / NtResumeProcess).
  spawnedChildrenImpl, resumeProcessImpl,
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
        throw new Error(`config not found: ${CONFIG} — run setup first: zcode-kit setup`);
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
    return (await healthAnswer(timeoutMs)).state;
  }

  /**
   * Authenticated identity check: only OUR proxy knows the key AND reports
   * the expected identity payload. state is "ours" | "foreign" | "down" |
   * "nokey"; pid is the pid an "ours" answer reports for itself
   * (`details.pid`), or null (an old proxy, or no answer).
   */
  async function healthAnswer(timeoutMs = 2500) {
    let key;
    try {
      key = readKey();
    } catch {
      return { state: "nokey", pid: null };
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base()}/health`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 401) return { state: "foreign", pid: null }; // something answered, wrong secret
      if (res.status !== 200) return { state: "foreign", pid: null };
      const j = JSON.parse(text);
      if (j?.status === "ok" && j?.provider === "zai") {
        const pid = j?.details?.pid;
        return { state: "ours", pid: Number.isInteger(pid) && pid > 0 ? pid : null };
      }
      return { state: "foreign", pid: null };
    } catch {
      return { state: "down", pid: null };
    } finally {
      clearTimeout(t);
    }
  }

  // ----------------------------------------------------------- pid record
  function readPidFile() {
    try {
      const raw = readFileSync(PID_FILE, "utf8").trim();
      // Current format: JSON { pid, startedMs, startedIso, startTicks?, name? }
      // (startTicks: Windows, since ticket 77; older kits wrote no ticks).
      try {
        const j = JSON.parse(raw);
        if (Number.isInteger(j.pid) && j.pid > 0) {
          return {
            pid: j.pid, startedMs: j.startedMs ?? parseIsoMs(j.startedIso), startedIso: j.startedIso ?? null,
            ...(j.startTicks === undefined ? {} : { startTicks: j.startTicks }),
          };
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

  /**
   * The pid record's JSON object (current format only), or null. Internal:
   * it includes the stop token, so it never leaves this module (readPidFile
   * is the reader callers and reports get).
   */
  function readPidJson() {
    try {
      const j = JSON.parse(readFileSync(PID_FILE, "utf8"));
      return j && typeof j === "object" && !Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  }

  // The stop token (ticket 18): an additive `stopToken` field of the pid
  // record, never returned by readPidFile (so no report can print it).
  // lastSpawn = { pid, stopToken } of this manager's own last spawn.
  let lastSpawn = null;
  /** The recorded proxy's stop token, or null. */
  function recordedStopToken() {
    const j = readPidJson();
    return typeof j?.stopToken === "string" && j.stopToken ? j.stopToken : null;
  }

  /**
   * The stop token a record naming `pid` carries: the spawner's own (it
   * generated it), else the token the current record already holds for the
   * same spawn (the same pid, or the spawn intent of the spawn being
   * completed: completeRecord rewrites a record another manager wrote, so it
   * keeps that token and never invents one), else none.
   */
  function stopTokenFor(pid) {
    if (lastSpawn?.pid === pid) return lastSpawn.stopToken;
    const j = readPidJson();
    if (typeof j?.stopToken === "string" && j.stopToken && (j.pid === pid || j.pid === null)) return j.stopToken;
    return null;
  }

  /**
   * An unfinished spawn: the spawner wrote its intent (and maybe the pid) but
   * not the start time. { pid: number|null, at: number|null } or null.
   * A record without a start time from an old kit counts too (at: null).
   */
  function pendingSpawn() {
    const j = readPidJson();
    if (j && j.pid === null && j.spawning && typeof j.spawning === "object") {
      return { pid: null, at: Number.isFinite(j.spawning.at) ? j.spawning.at : null, by: Number.isInteger(j.spawning.by) ? j.spawning.by : null };
    }
    const info = readPidFile();
    if (info && !Number.isFinite(info.startedMs)) {
      return { pid: info.pid, at: Number.isFinite(j?.spawning?.at) ? j.spawning.at : null };
    }
    return null;
  }

  /**
   * The one pid record builder: every `proxy.pid` this module writes is built
   * here and written by writePidJson, so a field the record gains (the
   * format above, the spawn intent, later fields) has one place to go.
   * `pid` is the proxy's pid, or null for a spawn intent (no pid yet).
   * `start` is a start identity `{ ms, ticks }` or null (not known yet): the
   * record keeps `startTicks` (Windows exact .NET ticks, ticket 77) whenever
   * the identity carries them. `spawning` ({ by, at }) is kept only while the
   * start is unknown (an unfinished spawn, ticket 16). `stopToken` (ticket
   * 18) is the spawn's stop token, kept whenever given (the caller decides
   * which one: stopTokenFor).
   */
  function pidRecord(pid, start, { spawning = null, stopToken = null } = {}) {
    const startedMs = Number.isFinite(start?.ms) ? start.ms : null;
    const startedIso = startedMs === null ? null : new Date(startedMs).toISOString();
    return {
      pid, startedMs, startedIso,
      ...(startedMs !== null && start?.ticks ? { startTicks: start.ticks } : {}),
      ...(spawning && startedMs === null ? { spawning } : {}),
      ...(typeof stopToken === "string" && stopToken ? { stopToken } : {}),
    };
  }

  /**
   * Replace the pid record atomically (temp + rename), so no reader sees half
   * of it. The record holds the stop token, so it is owner-only on every path:
   * the temp file is created 0600 and the rename replaces any older file
   * (with its mode); the in-place fallback rewrites an existing file, whose
   * mode the mode option does not change, so it is set explicitly there
   * (Windows: the profile ACL).
   */
  function writePidJson(record) {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const text = JSON.stringify(record) + "\n";
    const temp = `${PID_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
      renameSync(temp, PID_FILE);
    } catch {
      try { unlinkSync(temp); } catch {}
      writeFileSync(PID_FILE, text, { mode: 0o600 });
      try { chmodSync(PID_FILE, 0o600); } catch {}
    }
  }

  /** `start` is a start identity `{ ms, ticks }` or null (not known yet); `spawning` as in pidRecord. */
  function writePidFile(pid, start, spawning = null) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    writePidJson(pidRecord(pid, start, { spawning, stopToken: stopTokenFor(pid) }));
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

  // Process start identity — the PID-reuse guard: `{ ms, ticks }`, where
  // ticks is the exact .NET tick count (decimal string) on Windows and null
  // elsewhere. Windows asks PowerShell (ticks are locale-independent); POSIX
  // reads /proc. null = not determinable here, and the caller MUST treat that
  // as fail-closed (never kill).
  let bootTimeMs = null;
  function processStartIdentity(pid, { timeoutMs = 15000 } = {}) {
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
          const start = r.status === 0 ? startFromTicks(r.stdout) : null;
          if (start) return start;
        } catch {}
      }
      return null;
    }
    const ms = processStartMsPosix(pid);
    return ms === null ? null : { ms, ticks: null };
  }

  /** The process start time in ms since the Unix epoch (the manager's reports, older callers), or null. */
  function processStartMs(pid, options) {
    return processStartIdentity(pid, options)?.ms ?? null;
  }

  function processStartMsPosix(pid) {
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
   * The live processes a (dead) spawner created: [{ pid, startMs, commandLine,
   * executablePath }]. Windows only: CIM's ParentProcessId keeps naming a
   * dead creator, and only there can a spawner's death leave a child that
   * never ran (libuv creates a detached child suspended and resumes it after
   * CreateProcessW returns). On POSIX a killed spawner's child has already
   * exec'd and runs (it is re-parented, so its old parent is unknown): [].
   * Any failure is [] (nothing is resumed on a guess).
   */
  function spawnedChildren(parentPid, { timeoutMs = 15000 } = {}) {
    if (process.platform !== "win32" || !Number.isInteger(parentPid) || parentPid <= 0) return [];
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(parentPid)}" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ticks = [string]$_.CreationDate.ToUniversalTime().Ticks; commandLine = $_.CommandLine; executablePath = $_.ExecutablePath } })`;
    try {
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, encoding: "utf8", windowsHide: true });
      if (r.status !== 0) return [];
      const parsed = JSON.parse((r.stdout ?? "").trim() || "[]");
      return (Array.isArray(parsed) ? parsed : [parsed]).filter((c) => Number.isInteger(c?.pid)).map((c) => (
        { pid: c.pid, startMs: startFromTicks(c.ticks)?.ms ?? null, commandLine: c.commandLine ?? null, executablePath: c.executablePath ?? null }
      ));
    } catch {
      return [];
    }
  }

  /** Resume a process whose threads were never started (or stopped). true when the OS confirmed it. */
  function resumeProcess(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (process.platform !== "win32") {
      try { process.kill(pid, "SIGCONT"); return true; } catch { return false; }
    }
    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZCodeProcessResume {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
 [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$handle = [ZCodeProcessResume]::OpenProcess(0x0800, $false, ${pid})
if ($handle -eq [IntPtr]::Zero) { exit 4 }
try { if ([ZCodeProcessResume]::NtResumeProcess($handle) -ne 0) { exit 4 } } finally { [void][ZCodeProcessResume]::CloseHandle($handle) }
`;
    try {
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "pipe", windowsHide: true, timeout: 30000 });
      return r.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Compare a live process against the pid-file record.
   * Returns "match" | "dead" | "reuse-suspect" | "start-unknown".
   */
  function verifyOwnProcess(pidInfo) {
    if (!pidAlive(pidInfo.pid)) return "dead";
    const live = liveStartOf(pidInfo.pid);
    if (live === null) return "start-unknown"; // platform limitation
    const recorded = recordedStartOf(pidInfo);
    if (recorded === null) {
      // Legacy pid file without a usable timestamp (or with unreadable start
      // ticks): PID reuse cannot be ruled out, so ownership stays unproven
      // (fail-closed).
      return "start-unknown";
    }
    return sameStart(live, recorded) ? "match" : "reuse-suspect";
  }

  /** The live start identity; an injected processStartMsImpl answers in ms (no ticks). */
  function liveStartOf(pid, options) {
    if (!processStartMsImpl) return processStartIdentity(pid, options);
    const ms = processStartMsImpl(pid, options);
    return ms === null ? null : { ms, ticks: null };
  }

  /**
   * A pid record's start identity, or null when it has none: `startTicks`
   * (Windows records since ticket 77) is exact; `startedMs`/`startedIso` is
   * what older kits recorded. Ticks that are present but unreadable leave the
   * record without a start (fail closed), never with a millisecond guess.
   */
  function recordedStartOf(pidInfo) {
    const ms = pidInfo.startedMs ?? parseIsoMs(pidInfo.startedIso);
    if (pidInfo.startTicks === undefined || pidInfo.startTicks === null) return Number.isFinite(ms) ? { ms, ticks: null } : null;
    const fromTicks = startFromTicks(pidInfo.startTicks);
    return fromTicks ? { ms: Number.isFinite(ms) ? ms : fromTicks.ms, ticks: fromTicks.ticks } : null;
  }

  function sameStart(live, recorded) {
    if (!live || !recorded) return false;
    // Both sides carry exact Windows ticks: the same process or not, no
    // tolerance (ticket 77: no millisecond rounding can refuse the right
    // process or accept a nearby generation).
    if (live.ticks !== null && recorded.ticks !== null) return live.ticks === recorded.ticks;
    // Otherwise milliseconds. Windows: records written before ticket 77 carry
    // only startedMs (float error < 0.01 ms) — legacy tolerance 1 ms, the rule
    // those kits applied; a reused pid starts after the recorded process
    // exited, never within 1 ms of its start. Linux /proc exposes 10 ms ticks;
    // macOS ps only whole seconds. Never accept a nearby, different generation.
    const toleranceMs = process.platform === "darwin" ? 999 : process.platform === "win32" ? 1 : 10;
    return Number.isFinite(live.ms) && Number.isFinite(recorded.ms) && Math.abs(live.ms - recorded.ms) <= toleranceMs;
  }

  /**
   * Has the process with this pid and recorded start time exited? Yes when no
   * process has the pid, or when the pid now names another process (a
   * different start time: Windows hands a freed pid to a new process at once,
   * ticket 70). An unknown start time is no proof: the process counts as
   * still there (fail closed). This only decides "gone"; every signal still
   * passes its own guard.
   */
  function exited(pid, recordedStart = null) {
    if (!pidAlive(pid)) return true;
    if (!recordedStart) return false;
    const live = liveStartOf(pid, { timeoutMs: 2500 });
    return live !== null && !sameStart(live, recordedStart);
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
    const recorded = recordedStartOf(pidInfo)?.ms ?? null;
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
    return !!a && !!b && a.pid === b.pid && (a.startedMs ?? null) === (b.startedMs ?? null) && (a.startTicks ?? null) === (b.startTicks ?? null);
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

  async function waitForExit(pid, ms, recordedStart = null) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(300);
      if (exited(pid, recordedStart)) return true;
    }
    return exited(pid, recordedStart);
  }

  // ------------------------------------------------------------ kill guard
  /**
   * Kill a verified-own process tree: graceful first, forced as escalation.
   * `guard` (recorded proxies) is re-evaluated immediately before each
   * signal; a refusal stops the escalation and reports failure (fail closed).
   * Freshly spawned children of this very call pass no guard. `recordedStart`
   * (a recorded proxy's start identity) lets the exit checks see a reused pid
   * as the recorded process being gone; without it they go by the pid alone.
   */
  async function killOwnedIn(run, pid, guard = null, recordedStart = null) {
    const allowed = () => {
      if (!guard) return true;
      const g = guard();
      if (g === "ok") return true;
      if (g !== "gone") narrate(run, `refusing to signal pid ${pid}: ${g}`);
      return false;
    };
    const signal = (graceful) => {
      if (process.platform === "win32") {
        // Capture the OS generation (exact ticks), then open ONE handle and
        // compare that same handle's creation time, as an integer, before
        // terminating. Numeric taskkill /PID could otherwise target a reused
        // PID between the final guard and the signal.
        const expected = processStartIdentity(pid);
        if (expected === null || expected.ticks === null || !allowed()) return;
        const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", killGuardScript(pid, expected.ticks)], {stdio:"pipe",windowsHide:true,timeout:15000});
        const refusal = killGuardRefusal(pid, result.status ?? null);
        if (refusal) narrate(run, refusal);
        return;
      }
      try { process.kill(pid, graceful ? "SIGTERM" : "SIGKILL"); } catch {}
    };
    if (exited(pid, recordedStart)) return true;
    if (!allowed()) return exited(pid, recordedStart);
    signal(true);
    if (await waitForExit(pid, 5000, recordedStart)) return true;
    if (!allowed()) return exited(pid, recordedStart);
    signal(false);
    return waitForExit(pid, 5000, recordedStart);
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
  // Manager start lock: guards parallel starts and stops. The protocol (v1
  // records, proven takeover under an exclusive claim, atomic writes) lives
  // in lib/start-lock.mjs. Release deletes the file only while the on-disk
  // record is still this acquisition's own (signal release: ticket 17).
  // Returns { status: "acquired", record, release() } | { status: "contended",
  // holder, message } | { status: "unavailable", reason, message }.
  // The lock record keeps milliseconds (holderStartMs, an upper bound) and the
  // Linux start id; the exact identity of a pid record is liveStartOf's.
  const startLock = createStartLock({
    file: LOCK_FILE,
    pidAlive,
    processStart: (pid) => ({ ms: liveStartOf(pid, { timeoutMs: 2500 })?.ms ?? null, id: processStartMsImpl ? null : linuxStartId(pid) }),
    self: { pid: process.pid, startMs: Math.ceil(performance.timeOrigin), startId: processStartMsImpl ? null : linuxStartId(process.pid) },
    step: (name) => stepHook(name),
    onTakeover: ({ holderPid, reason, version, path }) => {
      try { logEvent("WARN", "lock takeover", { holderPid, reason, version, path }); } catch {}
    },
  });
  function acquireStartLock() {
    return startLock.acquire();
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
      narrate(run, `ERROR: ${KEY_FILE} missing — cannot verify identity. Run setup first: zcode-kit setup`);
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
    if (state === "ours") await tidyWhileServing(run);
    const early = preStartVerdict(run, state);
    if (early !== null) return early;
    // The holder may be proving a hung proxy (probes + process queries)
    // before its own spawn wait; do not give up while that is legitimately running.
    const contentionMs = waitMs + hungProbeCount * (hungProbeTimeoutMs + hungProbeIntervalMs) + 20_000;
    const t0 = Date.now();
    let waiting = false;
    for (;;) {
      const lock = acquireStartLock();
      if (lock.status === "unavailable") {
        return finish(run, 1, "start-lock-unavailable", { error: lock.message });
      }
      if (lock.status === "acquired") {
        try {
          return await startLocked(run, { waitMs, onlyIfRecord });
        } finally {
          lock.release();
        }
      }
      // Another start holds the lock: wait (bounded) for its proxy instead of
      // failing immediately. A live holder's lock is never taken over; if the
      // holder dies meanwhile, the next acquisition takes its lock over on proof.
      if (!waiting) narrate(run, "another start is in progress — waiting for it to finish");
      waiting = true;
      if (Date.now() - t0 >= contentionMs) break;
      await sleep(600);
      const s = await healthIdentify(1500);
      if (s === "ours") {
        await tidyWhileServing(run);
        narrate(run, "already running (started by a concurrent manager)");
        return finish(run, 0, "already-running");
      }
      if (s === "foreign") return preStartVerdict(run, s);
    }
    if (await healthIdentify(1500) === "ours") return finish(run, 0, "already-running");
    narrate(run, `ERROR: concurrent start did not produce a healthy proxy within ${contentionMs}ms. Run doctor; nothing was taken over.`);
    return finish(run, 4, "contention-timeout");
  }

  /**
   * Our proxy answers. If a stale start lock or an unfinished pid record is
   * left behind (a start killed after its spawn), take the lock (a stale one
   * on proof; a live holder's never) and complete the record by proof, so
   * the next stop can verify the proxy and no later start meets the stale lock.
   */
  async function tidyWhileServing(run) {
    if (!existsSync(LOCK_FILE) && pendingSpawn() === null) return;
    const lock = acquireStartLock();
    if (lock.status !== "acquired") return; // a live start is finishing; it releases its own lock
    try {
      await completeRecord(run);
    } finally {
      lock.release();
    }
  }

  /**
   * Under the start lock: complete an unfinished pid record of a proxy that
   * answers as ours. Proof (never a port or a pid alone): the authenticated
   * /health answer names pid P; P's start time is read, the answer is asked
   * again and still names P, and P's start time is read again and is the
   * same — so the process that answered is the one whose start time is
   * recorded. P must be the recorded pid; with only a spawn intent recorded
   * (the spawner died before it learned the pid), P must have started after
   * that intent. Returns true when the record is complete afterwards.
   */
  async function completeRecord(run) {
    const pending = pendingSpawn();
    if (pending === null) return readPidFile() !== null;
    const first = await healthAnswer();
    if (first.state !== "ours" || first.pid === null) return false;
    if (pending.pid !== null && pending.pid !== first.pid) return false;
    const pid = first.pid;
    // Start identities { ms, ticks }: with ticks on both reads (Windows) the
    // two must be the same tick (ticket 77); otherwise sameStart's ms rule.
    const before = liveStartOf(pid, { timeoutMs: 2500 });
    if (before === null) return false;
    if (pending.pid === null && (pending.at === null || before.ms < pending.at - 2000)) return false;
    const again = await healthAnswer();
    if (again.state !== "ours" || again.pid !== pid) return false;
    const after = liveStartOf(pid, { timeoutMs: 2500 });
    if (after === null || !sameStart(before, after)) return false;
    // Still unfinished under the lock (nothing else writes it while we hold it).
    const still = pendingSpawn();
    if (still === null || (still.pid !== null && still.pid !== pid)) return readPidFile()?.pid === pid;
    writePidFile(pid, before);
    try { logEvent("INFO", "pid record completed", { pid, by: pending.pid === null ? "spawn intent" : "recorded pid" }); } catch {}
    return true;
  }

  /**
   * Under the start lock, an unfinished spawn is recorded: its spawner died
   * (or its start-time probe timed out). A proxy it spawned may still be
   * starting: wait for it to answer (bounded) and complete its record,
   * rather than spawn a second one. → "adopted" | "none"
   */
  async function settlePendingSpawn(run, pending, waitMs) {
    const until = Math.min(Date.now() + Math.min(waitMs, pendingSpawnWaitMs), (pending.at ?? Date.now()) + Math.min(waitMs, pendingSpawnWaitMs));
    for (;;) {
      if (pending.pid !== null && !pidAlive(pending.pid)) return "none";
      const s = await healthIdentify(1500);
      if (s === "ours") return await completeRecord(run) ? "adopted" : "none";
      if (s !== "down" || Date.now() >= until) return "none";
      await sleep(300);
    }
  }

  /**
   * Under the start lock, the record is a spawn intent with no pid and its
   * spawner is dead: on Windows a spawner killed inside CreateProcess leaves
   * its proxy suspended before its first instruction (CI run 42507303528).
   * That proxy never answers, so waiting cannot adopt it, and spawning
   * another leaves two. Resume it instead, and only it: exactly one child of
   * the dead spawner whose command line is this installation's kit proxy,
   * that started after the intent, with the same start time just before the
   * resume. Nothing is ever killed here. The bounded wait and the proof of
   * completeRecord then adopt it like any proxy of an unfinished spawn.
   * Returns true when a child was resumed.
   */
  function resumeNeverStarted(pending) {
    if (pending.pid !== null || !Number.isInteger(pending.by) || pending.at === null || pidAlive(pending.by)) return false;
    const children = (spawnedChildrenImpl ?? spawnedChildren)(pending.by);
    const ours = children.filter((c) => Number.isFinite(c.startMs) && c.startMs >= pending.at - 2000 && isKitProxyCommand(c));
    if (ours.length !== 1) return false;
    const { pid, startMs } = ours[0];
    // CIM's CreationDate has microsecond resolution (DMTF), so the scan's
    // start is compared in ms (sameStart's rule); the exact tick proof
    // follows in completeRecord before the record names this pid.
    const now = liveStartOf(pid, { timeoutMs: 2500 });
    if (now === null || !sameStart(now, { ms: startMs, ticks: null })) return false;
    if (!(resumeProcessImpl ?? resumeProcess)(pid)) return false;
    try { logEvent("INFO", "never-started proxy resumed", { pid, spawner: pending.by }); } catch {}
    return true;
  }

  async function startLocked(run, { waitMs, onlyIfRecord }) {
    // Re-verify under the lock: the state may have changed while acquiring it.
    let lockedState = await healthIdentify();
    if (lockedState === "ours") await completeRecord(run);
    if (lockedState === "down" && !onlyIfRecord) {
      // We hold the lock, so whoever spawned the recorded proxy is gone. A
      // proxy whose spawn record is unfinished, or that is still inside its
      // startup grace, may be coming up: wait for it instead of refusing or
      // spawning a second one.
      let pending = pendingSpawn();
      const young = readPidFile();
      if (pending === null && young && Number.isFinite(young.startedMs) && Date.now() - young.startedMs < startupGraceMs && pidAlive(young.pid)) {
        pending = { pid: young.pid, at: young.startedMs };
      }
      // A dead spawner's proxy that never ran gets its wait from the resume on.
      if (pending !== null && resumeNeverStarted(pending)) pending = { ...pending, at: Date.now() };
      if (pending !== null && await settlePendingSpawn(run, pending, waitMs) === "adopted") lockedState = "ours";
      else if (pending !== null && pending.pid === null) {
        // A spawn intent whose proxy never answered: nothing to adopt.
        try { unlinkSync(PID_FILE); } catch {}
      }
    }
    const locked = preStartVerdict(run, lockedState);
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
   * Spawn → pid record → start time, with no window in which a live proxy
   * has no record (Round 7 Q4): the spawn intent is recorded before the
   * spawn, the pid right after it, the start time once it is queryable (the
   * health wait keeps trying). A spawner killed anywhere in between leaves a
   * record the next start completes by proof (completeRecord). Returns
   * { child, out, spawnError(), spawning } or { record } when the spawn failed.
   */
  async function spawnProxy(run, bun) {
    const out = openLogStream();
    let spawnError = null;
    let child;
    // A fresh stop token per spawn, never an inherited one (ticket 18). The
    // intent carries it: a spawner killed before it records the pid leaves
    // a proxy holding this token, and completing the intent keeps it.
    const stopToken = newStopToken();
    const spawning = { by: process.pid, at: Date.now() };
    writePidJson(pidRecord(null, null, { spawning, stopToken }));
    stepHook("spawn:intent-recorded");
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
      if (readPidJson()?.pid === null) { try { unlinkSync(PID_FILE); } catch {} }
      narrate(run, `ERROR: failed to spawn bun (${err.message}).`);
      return { record: finish(run, 4, "spawn-failed") };
    }
    stepHook("spawn:spawned");
    child.on("error", (err) => { spawnError = err; });
    child.unref();
    lastSpawn = { pid: child.pid, stopToken };
    // Record the pid immediately so a crash of this manager never leaves an
    // unrecorded proxy; the start time is added as soon as it is queryable.
    writePidFile(child.pid, null, spawning);
    stepHook("spawn:pid-recorded");
    const probeDeadline = Date.now() + 5000;
    // The start identity { ms, ticks } (ticket 77), through the injection point
    // like every start probe (ticket 16).
    let recordedStart = child.pid ? liveStartOf(child.pid, { timeoutMs: 2500 }) : null;
    while (recordedStart === null && Date.now() < probeDeadline && child.pid) {
      await sleep(300);
      recordedStart = liveStartOf(child.pid, { timeoutMs: 2500 });
    }
    if (recordedStart !== null) {
      writePidFile(child.pid, recordedStart);
      stepHook("spawn:start-recorded");
    }
    return { child, out, spawnError: () => spawnError, startKnown: recordedStart !== null };
  }

  async function awaitHealthy(run, { child, out, spawnError, startKnown }, waitMs) {
    const t0 = Date.now();
    let lastProbe = Date.now();
    // The start-time probe did not answer within its 5 s (a slow PowerShell
    // on Windows): keep asking while the proxy comes up, and once it answers
    // complete the record by proof, so it never stays without a start time.
    // Our own unreaped child cannot have lost its pid, so probing it directly
    // is proof; once it answers /health, completeRecord's proof works too.
    const fillStart = async (healthy) => {
      if (startKnown) return;
      if (!healthy && Date.now() - lastProbe < 2000) return;
      lastProbe = Date.now();
      if (child.exitCode === null && child.signalCode === null) {
        const s = liveStartOf(child.pid, { timeoutMs: 2500 });
        if (s !== null && child.exitCode === null && readPidFile()?.pid === child.pid) {
          writePidFile(child.pid, s);
          startKnown = true;
          stepHook("spawn:start-recorded");
          return;
        }
      }
      if (healthy) startKnown = await completeRecord(run) && Number.isFinite(readPidFile()?.startedMs);
    };
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
      await fillStart(s === "ours");
      if (s === "ours") {
        // Healthy, but its start time is still unknown: keep proving it
        // (bounded by this start's wait) before handing it back.
        while (!startKnown && Date.now() - t0 < waitMs) {
          await sleep(1000);
          await fillStart(true);
        }
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
    const state = await healthIdentify();
    // An unfinished record (its spawner was killed, or its start-time probe
    // timed out) is completed by proof first, so its proxy stays stoppable.
    if (state === "ours") await completeRecord(run);
    else if (state === "down" && readPidJson()?.pid === null) {
      // A spawn intent with nothing serving: its spawner is gone (we hold the lock).
      try { unlinkSync(PID_FILE); } catch {}
    }
    const pidInfo = readPidFile();
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
    if (sameRecord(current, pidInfo)) removePidRecordFor(pidInfo.pid);
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
   * an unknown budget must never become an unlimited one. Unlike the start
   * lock (proven takeover, ADR-0003), a stale budget lock is never taken
   * over automatically.
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
    // the start lock itself (seam 2: the takeover race and the lock protocol)
    acquireStartLock,
    // proofs and records the manager CLI's reports read
    healthIdentify, readPidFile, verifyOwnProcess, proveHungOwn, pidAlive, processStartMs,
    killOwned: (pid, guard = null, { observe } = {}) => killOwnedIn(newRun("kill", observe), pid, guard),
    lastRecovery: () => lastRecovery,
    logEvent, redact, readKey, loadPort, findBun,
    ctx, ROOT, HOME, PROXY_SRC, LOG_FILE, PID_FILE, LOCK_FILE, CONFIG, KEY_FILE, LOG_DIR, RESPAWN_FILE,
  };
}
