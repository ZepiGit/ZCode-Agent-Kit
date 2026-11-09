// Windows Ctrl-C-during-start trial (ticket 81, Owner Proxy round 33): deliver
// a REAL console control event to the trial's own `proxy start` child instead
// of `child.kill("SIGINT")`, which Node maps to TerminateProcess on Windows —
// a crash, not a console event (child_process.kill docs), so no kit change
// could ever clear windows S4/short `stale-lock-after-ctrl-c`.
//
// Delivery (round 33 condition 4a): the trial child is created with
// CREATE_NEW_PROCESS_GROUP (0x200) by a helper process, and a second helper
// sends GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, <child pid>). The group id
// is the child's own pid — never 0 (that would signal every process sharing
// the sender's console, including the runner's: B4) and never CTRL_C_EVENT (0:
// cannot be aimed at a group, and a new process group has Ctrl-C disabled).
// CTRL_BREAK is the only console event the documented API can aim at exactly
// one group, and "CTRL+BREAK signals always cause the handler functions to be
// called" (Microsoft Learn, GenerateConsoleCtrlEvent). The sender attaches to
// the child's console first (FreeConsole + AttachConsole), so the event can
// only reach processes on the child's own console: the helper tree of this
// trial (the console Windows gave the hidden helper and its child, or the one
// Windows gives the child itself — either way it holds only processes this run
// started).
//
// In-box tooling only (condition 4b): PowerShell 5.1 + Add-Type P/Invoke into
// kernel32, exactly like lib/win-process.mjs. No npm dependency, no native
// addon, no binary; no network endpoint. Both helpers are short-lived
// powershell.exe children of the scenario: tracked by pid, reaped at the end
// of each trial and on every failure path (reapAll), under the job's existing
// caps (the Job Object kill-on-close holds the whole tree on CI). The Windows
// sampler already classifies powershell.exe as role "tooling" (win-sampler.mjs
// TOOLING), so a helper is never counted as a kit role, in count:*, orphans or
// footprint.
//
// Proof of delivery (condition 4c): a trial counts as proven when the child's
// own `INFO manager start lock released on signal signal=SIGBREAK …` event
// line appears in the kit's log (lib/proxy-lifecycle.mjs onSignalRelease), or
// — only when the handler did not run — the child died the console-event death
// (exit code 0xC000013A, STATUS_CONTROL_C_EXIT): that proves the event reached
// the process and lets the mutant run (17's SIGBREAK listener removed) show
// stale locks instead of a harness failure. A trial whose delivery cannot be
// proven at all is a harness failure: never GREEN, never a silent fallback to
// child.kill. Trial 0 is the self-test: if it cannot prove delivery, the run
// fails there (a start holds the lock for seconds, so a lost event is the only
// explanation on 17's tree, whose only signal listeners are start-lock's).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Round 33 condition 4d: the label each platform's trial prints per trial. */
export const DELIVERY_LABELS = {
  linux: "SIGINT (kill)",
  windows: "CTRL_BREAK_EVENT (console event, own process group)",
};

/** The child's exit code when it died from the console event without (or before) a handler. */
export const EVENT_EXIT_CODE = 0xc000013a; // STATUS_CONTROL_C_EXIT, unsigned DWORD

const PS_ARGS = ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand"];

const SPAWNER_CS = String.raw`
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct K81StartupInfo {
  public uint cb;
  public string lpReserved;
  public string lpDesktop;
  public string lpTitle;
  public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize;
  public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute; public uint dwFlags;
  public short wShowWindow; public short cbReserved2;
  public IntPtr lpReserved2;
  public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
}
[StructLayout(LayoutKind.Sequential)]
public struct K81ProcessInfo {
  public IntPtr hProcess; public IntPtr hThread;
  public uint dwProcessId; public uint dwThreadId;
}
public static class K81Spawn {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CreateProcessW(string applicationName, string commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref K81StartupInfo startupInfo, out K81ProcessInfo processInformation);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
}
`;

const SENDER_CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class K81Send {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);
}
`;

/**
 * The spawner helper: creates the trial child with CREATE_NEW_PROCESS_GROUP
 * (0x200) — the group id is the child's pid — prints `__K81__PID <pid>`, waits
 * for the child's exit and prints `__K81__EXIT <unsigned code>`. The child
 * inherits the helper's environment (the isolated kit's) and console, and its
 * own stdout/stderr go to that console (the helper's stdout stays the protocol
 * pipe). CREATE_NEW_PROCESS_GROUP disables the group's Ctrl-C handling, which
 * is why the event is Ctrl-Break.
 */
export function spawnerScript(childExe, childArgs) {
  if (!Array.isArray(childArgs) || childArgs.some((a) => /[\0\r\n]/.test(a))) throw new Error(`bad child args: ${JSON.stringify(childArgs)}`);
  for (const s of [childExe, ...childArgs]) if (/"/.test(s)) throw new Error(`child argument needs quoting this script cannot express: ${JSON.stringify(s)}`);
  const commandLine = `@"${childExe}" ${childArgs.map((a) => `"${a}"`).join(" ")}`;
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${SPAWNER_CS}\n'@`,
    `$exe = @'
${childExe}
'@`,
    `$cmd = @'
${commandLine}
'@`,
    "$si = New-Object K81StartupInfo",
    "$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf([type][K81StartupInfo])",
    "$pi = New-Object K81ProcessInfo",
    // 0x200 = CREATE_NEW_PROCESS_GROUP; NULL environment = inherit the helper's (the isolated kit's).
    "$ok = [K81Spawn]::CreateProcessW($exe, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false, [uint32]0x200, [IntPtr]::Zero, $null, [ref]$si, [ref]$pi)",
    `if (-not $ok) { [Console]::Out.Write('__K81__CREATEFAIL ' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 1 }`,
    "[Console]::Out.Write('__K81__PID ' + $pi.dwProcessId)",
    "[Console]::Out.Flush()",
    "$null = [K81Spawn]::WaitForSingleObject($pi.hProcess, [uint32]0xFFFFFFFF)",
    "$code = [uint32]0",
    "$null = [K81Spawn]::GetExitCodeProcess($pi.hProcess, [ref]$code)",
    "$null = [K81Spawn]::CloseHandle($pi.hProcess)",
    "$null = [K81Spawn]::CloseHandle($pi.hThread)",
    "[Console]::Out.Write('__K81__EXIT ' + $code)",
    "exit 0",
  ].join("\n");
}

/**
 * The sender helper: attaches to the child's console and sends
 * GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT = 1, <child pid>) — the child's
 * own process group. Group 0 (every process on the console) and CTRL_C_EVENT
 * (0) are never used here; the guard tests pin that.
 */
export function senderScript(childPid) {
  if (!Number.isInteger(childPid) || childPid <= 0) throw new Error(`bad child pid: ${childPid}`);
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${SENDER_CS}\n'@`,
    // Detach from the helper's own console first (AttachConsole refuses while attached).
    "$null = [K81Send]::FreeConsole()",
    `if (-not [K81Send]::AttachConsole([uint32]${childPid})) { [Console]::Out.Write('__K81__ATTACHFAIL ' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 1 }`,
    `if (-not [K81Send]::GenerateConsoleCtrlEvent([uint32]1, [uint32]${childPid})) { [Console]::Out.Write('__K81__SENDFAIL ' + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 1 }`,
    "[Console]::Out.Write('__K81__SENT')",
    "exit 0",
  ].join("\n");
}

/** Spawn one helper: pid-tracked, output-bounded. The timeout never kills — reaping is the caller's job (a live spawner holds the child's process handle, which pins the child's pid while the caller ends the child first); `state.timedOut` says whether it fired. */
export function spawnHelper(script, env, { timeoutMs = 60_000 } = {}) {
  const child = spawn("powershell.exe", [...PS_ARGS, Buffer.from(script, "utf16le").toString("base64")], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "", err = "";
  const state = { pid: child.pid, timedOut: false, out: () => out, err: () => err };
  child.stdout.on("data", (b) => { out = (out + b).slice(-16 * 1024); });
  child.stderr.on("data", (b) => { err = (err + b).slice(-16 * 1024); });
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => { state.timedOut = true; resolve({ code: null, out, err, timedOut: true }); }, timeoutMs);
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut: state.timedOut }); });
    child.once("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e}`, timedOut: state.timedOut }); });
  });
  return { pid: child.pid, state, done };
}

/**
 * The trial child's pid from the spawner's live output (it prints
 * `__K81__PID <pid>` right after CreateProcessW and then waits for the child).
 * Resolves `{ childPid: null }` when the deadline passes first or the helper
 * exited without one.
 */
export async function waitForPidLine(spawner, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const parsed = parseSpawnerOut(spawner.state.out());
    if (parsed.childPid !== null) return parsed;
    const rec = await Promise.race([spawner.done, new Promise((r) => setTimeout(() => r(null), 10))]);
    if (rec) return parseSpawnerOut(rec.out); // the helper exited; judge its final output
    if (Date.now() > deadline) return parseSpawnerOut(spawner.state.out());
  }
}

export function parseSpawnerOut(out) {
  const pid = out.match(/__K81__PID (\d+)/);
  const exit = out.match(/__K81__EXIT (\d+)/);
  const createFail = out.match(/__K81__CREATEFAIL (\d+)/);
  return { childPid: pid ? Number(pid[1]) : null, childExitCode: exit ? Number(exit[1]) : null, createError: createFail ? Number(createFail[1]) : null };
}

export function parseSenderOut(out) {
  if (/__K81__SENT/.test(out)) return { sent: true, error: null };
  const attach = out.match(/__K81__ATTACHFAIL (\d+)/);
  if (attach) return { sent: false, error: `AttachConsole win32 error ${attach[1]}` };
  const send = out.match(/__K81__SENDFAIL (\d+)/);
  if (send) return { sent: false, error: `GenerateConsoleCtrlEvent win32 error ${send[1]}` };
  return { sent: false, error: out ? `unrecognised sender output: ${out.slice(-160)}` : "sender produced no output" };
}

/**
 * Trial 0 is the self-test: delivery must be proven there, because a start
 * holds its lock for seconds — if the child exited 0 with no release line, the
 * console event never arrived (no other listener exists on 17's tree). Later
 * trials may legitimately miss the hold (the start completed between the
 * pre-send lock read and the event); they record that honestly and are never
 * a fallback to a kill.
 *   → { delivered, proofVia?, reason?, failure? }  failure set = harness failure.
 */
export function judgeWindowsTrial({ first, sender, childExitCode, releaseLine }) {
  if (sender.timedOut) return { delivered: false, failure: `sender helper timed out (${sender.error ?? "no error"})` };
  if (releaseLine) return { delivered: true, proofVia: "release-line" };
  if (sender.sent) {
    if (childExitCode === EVENT_EXIT_CODE) return { delivered: true, proofVia: "event-exit" };
    if (childExitCode === 0) {
      return first
        ? { delivered: false, failure: `self-test: the event was generated but the child exited 0 without the release line — CTRL_BREAK_EVENT never reached the child's handler (sender said ${sender.error ?? "SENT"})` }
        : { delivered: false, reason: "start completed and the child exited before the event was generated" };
    }
    return { delivered: false, failure: `the event was generated but the child exited ${hex(childExitCode)} with no release line and no console-event exit code` };
  }
  if (childExitCode === 0) {
    return first
      ? { delivered: false, failure: `self-test: delivery unproven — the sender did not deliver (${sender.error ?? "no error"}) and the child exited 0` }
      : { delivered: false, reason: `the sender did not deliver (${sender.error ?? "no error"}); the start completed first` };
  }
  return first
    ? { delivered: false, failure: `self-test: delivery unproven — the sender did not deliver (${sender.error ?? "no error"}) and the child exited ${hex(childExitCode)}` }
    : { delivered: false, reason: `the sender did not deliver (${sender.error ?? "no error"}); the child exited ${hex(childExitCode)} without holding the lock to the end` };
}

const hex = (code) => (Number.isInteger(code) ? `0x${code.toString(16)}` : String(code));

/** The child's own release event line (the format lib/event-line.ts emits; start-lock.test.mjs pins it). */
const releaseLineFor = (childPid) => new RegExp(`^\\S+ INFO manager start lock released on signal signal=SIGBREAK pid=${childPid} path=.*manager\\.lock$`);

/**
 * Search the kit's proxy.log (its last 64 KiB, plus a rotated proxy.log.1 in
 * full) for THIS trial's release line. The tail bounds a previous trial whose
 * child could have reused the pid; the line's own timestamp must also be no
 * older than the trial.
 */
export function findReleaseLine(logDir, childPid, { notBeforeMs, tailBytes = 64 * 1024 } = {}) {
  const re = releaseLineFor(childPid);
  for (const name of ["proxy.log.1", "proxy.log"]) {
    let text;
    try { text = readFileSync(join(logDir, name), "utf8"); } catch { continue; }
    const window = name === "proxy.log" && text.length > tailBytes ? text.slice(-tailBytes) : text;
    for (const line of window.split("\n")) {
      if (!re.test(line)) continue;
      const at = Date.parse(line.match(/^\S+/)?.[0] ?? "");
      if (Number.isFinite(at) && notBeforeMs !== undefined && at < notBeforeMs - 2000) continue;
      return { file: name, line };
    }
  }
  return null;
}

/** Kill every tracked helper/child pid of a trial (ours alone); returns the count and pids actually killed. */
export function reapAll(pids) {
  const killed = [];
  for (const pid of [...new Set(pids)]) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try { process.kill(pid, "SIGKILL"); killed.push(pid); } catch { /* already gone */ }
  }
  return { count: killed.length, pids: killed };
}
