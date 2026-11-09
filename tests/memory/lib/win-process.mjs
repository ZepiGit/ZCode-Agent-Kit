// Windows has no SIGSTOP/SIGCONT: S3's hung proxy is frozen with
// NtSuspendProcess and thawed with NtResumeProcess (ticket 02). Each action
// names a process by its identity (pid + start time, lib/process-identity.mjs),
// never by its pid alone: Windows hands a freed pid to a new process quickly on
// a busy runner (tickets 70, 72), and a pid-only resume or terminate would act
// on that stranger (ticket 73).
//
// The action holds a handle on the pid first. While any handle to a process is
// open its pid cannot be reused ("The PID can be reused once the process is
// destroyed", https://devblogs.microsoft.com/oldnewthing/20110107-00/?p=11803;
// PROCESS_INFORMATION dwProcessId), so the start time asked next, with the
// same expression every identity of the loop uses, is the start time of the
// process the handle holds. The action runs on that handle only when the start
// time is the expected one. A pid that names another process, or none, is
// reported as such and nothing is done to it.
import { spawnSync } from "node:child_process";
import { WINDOWS_START_EXPRESSION } from "./process-identity.mjs";

const CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class MemloopProcess {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr h);
  public static IntPtr Open(int pid, uint access, out int error) {
    IntPtr h = OpenProcess(access, false, pid);
    error = h == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
    return h;
  }
  public static void Close(IntPtr h) { if (h != IntPtr.Zero) CloseHandle(h); }
  public static int Act(IntPtr h, string action) {
    if (action == "suspend") return NtSuspendProcess(h);
    if (action == "resume") return NtResumeProcess(h);
    if (action == "terminate") return TerminateProcess(h, 1) ? 0 : -Marshal.GetLastWin32Error();
    return -87;
  }
}
`;

// PROCESS_SUSPEND_RESUME (0x0800), PROCESS_TERMINATE (0x0001).
const ACCESS = { suspend: 0x0800, resume: 0x0800, terminate: 0x0001 };

function checkIdentity(id) {
  if (!id || !Number.isInteger(id.pid) || id.pid <= 0) throw new Error(`not a process identity: ${JSON.stringify(id)}`);
  if (!/^\d+$/.test(String(id.start ?? ""))) throw new Error(`pid ${id.pid}: no start time to judge it by (${JSON.stringify(id.start)})`);
}

/**
 * The PowerShell 5.1 script that runs `action` (suspend, resume, terminate) on
 * the process `id` names. It prints `DONE <status>` (NTSTATUS or 0 / -Win32
 * error), `OTHER <start or NONE>` (the pid names another process or none:
 * nothing done) or `OPENFAIL <Win32 error>` (it is the process, but no handle).
 */
export function processActionScript(id, action) {
  checkIdentity(id);
  if (!(action in ACCESS)) throw new Error(`unknown process action: ${action}`);
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${CS}\n'@`,
    "$err = 0",
    // The handle first: from here on the pid cannot pass to another process.
    `$h = [MemloopProcess]::Open(${id.pid}, ${ACCESS[action]}, [ref]$err)`,
    "try {",
    `  $p = Get-CimInstance Win32_Process -Filter 'ProcessId=${id.pid}'`,
    `  $start = 'NONE'; if ($p) { $start = 'START ' + ${WINDOWS_START_EXPRESSION} }`,
    `  if ($start -ne 'START ${id.start}') { [Console]::Out.Write('OTHER ' + $start) }`,
    "  elseif ($h -eq [IntPtr]::Zero) { [Console]::Out.Write('OPENFAIL ' + $err) }",
    `  else { [Console]::Out.Write('DONE ' + [MemloopProcess]::Act($h, '${action}')) }`,
    "} finally { [MemloopProcess]::Close($h) }",
  ].join("\n");
}

/** That script's result → true (done), false (the pid no longer names the process: nothing done), or a throw. */
export function parseProcessAction(id, action, { status, stdout, stderr }) {
  const out = String(stdout ?? "").trim();
  if (status === 0 && out === "DONE 0") return true;
  if (status === 0 && /^OTHER (?:NONE|START \d+)$/.test(out)) return false;
  throw new Error(`${action} pid ${id.pid} (start ${id.start}) failed: status ${status} ${out.slice(0, 120)} ${String(stderr ?? "").trim().slice(-200)}`);
}

function run(id, action) {
  const script = processActionScript(id, action);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  return parseProcessAction(id, action, r);
}

/** Suspend the process `id` names; false when its pid names another process or none (nothing suspended). */
export const suspendProcess = (id) => run(id, "suspend");
/** Resume the process `id` names; false when it is gone (a stranger at its pid is never resumed). */
export const resumeProcess = (id) => run(id, "resume");
/** Terminate the process `id` names; false when it is gone (a stranger at its pid is never terminated). */
export const terminateProcess = (id) => run(id, "terminate");
