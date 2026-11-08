// A process is its pid plus its OS start time. A pid alone names whatever
// process holds it now: Windows hands a freed pid to a new process quickly on
// a busy runner (ticket 70), so "is pid N alive?" asked after the process
// exited can answer yes for a stranger. A check that holds no handle on the
// process (a grandchild, a process another one spawned) records its identity
// while the process is surely alive and later asks whether that same process
// is still there (ticket 72). A stranger at the same pid is never "it".
//
// The start time is the one the samplers record: Linux /proc/<pid>/stat field
// 22 (starttime, lib/sampler.mjs key), Windows Win32_Process CreationDate as a
// FILETIME (lib/win-sampler.mjs `created`); macOS `ps -o lstart` (seconds).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The PowerShell 5.1 expression for the start time of the Win32_Process `$p`
 * (FILETIME, decimal). Every Windows identity of the loop uses this one
 * expression (also lib/win-process.mjs), so two answers about one process are
 * the same string.
 */
export const WINDOWS_START_EXPRESSION = "$(if ($p.CreationDate) { $p.CreationDate.ToFileTimeUtc() } else { 0 })";

/** The PowerShell 5.1 script that prints `START <FILETIME>` for the process holding `pid`, or `NONE`. */
export function windowsStartScript(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`not a pid: ${pid}`);
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
    `if ($p) { [Console]::Out.Write('START ' + ${WINDOWS_START_EXPRESSION}) } else { [Console]::Out.Write('NONE') }`,
  ].join("\n");
}

/** The PowerShell command line that runs windowsStartScript(pid). */
export function windowsStartCommand(pid) {
  const script = Buffer.from(windowsStartScript(pid), "utf16le").toString("base64");
  return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script] };
}

/** That script's result → start time, null (no process holds the pid), or a throw (cannot tell). */
export function parseWindowsStart(pid, { status, stdout, stderr }) {
  const out = String(stdout ?? "").trim();
  if (status === 0 && out === "NONE") return null;
  const m = status === 0 && out.match(/^START (\d+)$/);
  if (m) return m[1];
  throw new Error(`start time of pid ${pid} unknown: status ${status} ${out.slice(0, 120)} ${String(stderr ?? "").trim().slice(-200)}`);
}

/** /proc/<pid>/stat text → start time (field 22). */
export function linuxStart(pid, stat) {
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  if (!/^\d+$/.test(start ?? "")) throw new Error(`start time of pid ${pid} unknown: unreadable stat`);
  return start;
}

/**
 * The start time of whatever process holds `pid` now (an opaque string), or
 * null when no process does. Throws when it cannot tell: an unknown answer is
 * never taken for "gone". `procRoot` (Linux; tests: a fake /proc) defaults to /proc.
 */
export function startOf(pid, { platform = process.platform, procRoot = "/proc" } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`not a pid: ${pid}`);
  if (platform === "win32") {
    const { command, args } = windowsStartCommand(pid);
    const r = spawnSync(command, args, { encoding: "utf8", timeout: 60_000, windowsHide: true });
    return parseWindowsStart(pid, r);
  }
  if (platform === "darwin") {
    const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 15_000, env: { ...process.env, LC_ALL: "C" } });
    const out = (r.stdout ?? "").trim();
    if (r.status === 0 && out) return out;
    if (r.status === 1 && !out) return null;
    throw new Error(`start time of pid ${pid} unknown: ps status ${r.status} ${(r.stderr ?? "").trim().slice(-200)}`);
  }
  let stat;
  try { stat = readFileSync(`${procRoot}/${pid}/stat`, "utf8"); } catch (err) {
    if (err.code === "ENOENT" || err.code === "ESRCH") return null;
    throw err;
  }
  return linuxStart(pid, stat);
}

/** { pid, start } of the live process `pid`; throws when no process holds it (record it while it surely runs). */
export function identityOf(pid, opts) {
  const start = startOf(pid, opts);
  if (start === null) throw new Error(`pid ${pid}: no process to identify (record the identity while it runs)`);
  return { pid, start };
}

/** Whether the process `id` names is still there: same pid AND same start time. */
export function isSameProcess(id, opts) {
  return startOf(id.pid, opts) === id.start;
}
