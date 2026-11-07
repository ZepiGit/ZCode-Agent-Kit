// Windows has no SIGSTOP/SIGCONT: S3's hung proxy is frozen with
// NtSuspendProcess and thawed with NtResumeProcess (ticket 02). Only ever
// called on a pid the scenario has just found in its own run (the proxy.pid
// record of the run's isolated instance).
import { spawnSync } from "node:child_process";

const CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class MemloopSuspend {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr h);
  public static int Run(int pid, bool suspend) {
    IntPtr h = OpenProcess(0x0800, false, pid);
    if (h == IntPtr.Zero) return -Marshal.GetLastWin32Error();
    try { return suspend ? NtSuspendProcess(h) : NtResumeProcess(h); } finally { CloseHandle(h); }
  }
}
`;

/** The PowerShell 5.1 script that suspends or resumes one pid; prints the NTSTATUS. */
export function suspendScript(pid, suspend) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`not a pid: ${pid}`);
  return `$ProgressPreference = 'SilentlyContinue'\n$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${CS}\n'@\n[Console]::Out.Write([MemloopSuspend]::Run(${pid}, $${suspend ? "true" : "false"}))`;
}

function run(pid, suspend) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(suspendScript(pid, suspend), "utf16le").toString("base64")], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  const status = (r.stdout ?? "").trim();
  if (r.status !== 0 || status !== "0") throw new Error(`${suspend ? "suspend" : "resume"} ${pid} failed: status ${status || r.status} ${(r.stderr ?? "").trim().slice(0, 200)}`);
}

export const suspendProcess = (pid) => run(pid, true);
export const resumeProcess = (pid) => run(pid, false);
