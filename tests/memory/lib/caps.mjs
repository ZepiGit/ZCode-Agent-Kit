// Hard caps for the memory-budget job's runs (spec §12): every run gets a
// memory cap far above every budget and a timeout, so a cap kill is a harness
// failure, never a verdict, and the job never runs uncapped.
//
//   systemd    (linux)   `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0`,
//                        verified by reading the scope's memory.max from inside it;
//   prlimit    (linux)   `prlimit --as=2×cap` per process (coarse fallback);
//   jobobject  (windows) a PowerShell wrapper puts itself in a new Job Object
//                        with JOB_OBJECT_LIMIT_JOB_MEMORY (the whole tree, like
//                        a cgroup) and JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, reads
//                        the limit back, then starts the run, which inherits the
//                        job (the detached proxy too). The timeout kills the
//                        wrapper; closing its job handle kills the whole tree.
//                        It reports `@@JOB applied=… limit=… peak=…` on stderr;
//   none                 only when the caller already runs the job under a cap.
// Linux runs also get `timeout --kill-after=30`.
import { spawnSync } from "node:child_process";

export const bytes = (size) => Math.round(Number(String(size).replace(/G$/, "")) * 1024 ** 3);
const KILL_AFTER_S = 30;

/** Does a user systemd scope apply MemoryMax here? Reads memory.max from inside the scope. */
function systemdScopeWorks() {
  const want = 64 * 1024 * 1024;
  const r = spawnSync("systemd-run", ["--user", "--scope", "--quiet", "-p", `MemoryMax=${want}`, "-p", "MemorySwapMax=0", "--", "sh", "-c", 'cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max"'], { encoding: "utf8", timeout: 30_000 });
  return r.status === 0 && r.stdout.trim() === String(want) ? { ok: true } : { ok: false, why: (r.stderr || r.stdout || String(r.error ?? "")).trim().split("\n").slice(-1)[0] };
}

export function chooseCap(requested, { platform = process.platform, log = console.error } = {}) {
  if (requested === "none") return { cap: "none" };
  if (platform === "win32") {
    if (requested === "auto" || requested === "jobobject") return { cap: "jobobject" };
    return { error: `cap ${requested} is not available on Windows (use jobobject)` };
  }
  if (platform !== "linux") return { error: `no cap mechanism for ${platform}` };
  if (requested === "jobobject") return { error: "a Job Object cap exists only on Windows" };
  if (requested === "systemd" || requested === "auto") {
    const s = systemdScopeWorks();
    if (s.ok) return { cap: "systemd" };
    if (requested === "systemd") return { error: `systemd-run --user scope with MemoryMax is not available: ${s.why}` };
    log(`memory-budget: systemd user scope unavailable (${s.why}); falling back to prlimit`);
  }
  if (spawnSync("prlimit", ["--version"]).status === 0) return { cap: "prlimit" };
  return { error: "neither a systemd user scope nor prlimit is available: the job never runs uncapped" };
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// C# 5 (Windows PowerShell 5.1's Add-Type). JOBOBJECT_EXTENDED_LIMIT_INFORMATION = class 9.
const JOB_CS = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MemloopJob {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong R, W, O, RB, WB, OB; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out EXT info, int len, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  const uint JOB_MEMORY = 0x200, KILL_ON_CLOSE = 0x2000;
  static IntPtr job;
  static string Fail(string what) { return what + " failed (" + Marshal.GetLastWin32Error() + ")"; }
  public static string Apply(ulong limit) {
    job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return Fail("CreateJobObject");
    EXT info = new EXT();
    info.Basic.LimitFlags = JOB_MEMORY | KILL_ON_CLOSE;
    info.JobMemoryLimit = new UIntPtr(limit);
    int size = Marshal.SizeOf(typeof(EXT));
    if (!SetInformationJobObject(job, 9, ref info, size)) return Fail("SetInformationJobObject");
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) return Fail("AssignProcessToJobObject");
    EXT back;
    if (!QueryInformationJobObject(job, 9, out back, size, IntPtr.Zero)) return Fail("QueryInformationJobObject");
    if (back.JobMemoryLimit.ToUInt64() != limit || (back.Basic.LimitFlags & (JOB_MEMORY | KILL_ON_CLOSE)) != (JOB_MEMORY | KILL_ON_CLOSE)) return "read back limit " + back.JobMemoryLimit.ToUInt64() + " flags 0x" + back.Basic.LimitFlags.ToString("x");
    return null;
  }
  public static ulong Peak() { EXT back; if (!QueryInformationJobObject(job, 9, out back, Marshal.SizeOf(typeof(EXT)), IntPtr.Zero)) return 0; return back.PeakJobMemoryUsed.ToUInt64(); }
  public static string Quote(string arg) {
    if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return arg;
    StringBuilder sb = new StringBuilder("\"");
    int bs = 0;
    foreach (char c in arg) {
      if (c == '\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
      sb.Append('\\', bs); bs = 0; sb.Append(c);
    }
    sb.Append('\\', bs * 2); sb.Append('"');
    return sb.ToString();
  }
}
`;

/** The Job Object wrapper (Windows PowerShell 5.1). Exit: the run's own code; 2 when the cap could not be applied. */
export function jobObjectScript({ limitBytes, argv }) {
  return [
    // First, before Add-Type loads a module: its progress arrived as CLIXML on stderr (CI run 42221794531).
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `Add-Type -TypeDefinition @'\n${JOB_CS}\n'@`,
    `  $limit = [uint64]${limitBytes}`,
    "  $err = [MemloopJob]::Apply($limit)",
    "  if ($err) { [Console]::Error.WriteLine(\"@@JOB applied=0 error=$err\"); exit 2 }",
    `  $argv = @(${argv.map(psQuote).join(", ")})`,
    "  $psi = New-Object System.Diagnostics.ProcessStartInfo",
    "  $psi.FileName = $argv[0]",
    "  $psi.Arguments = (@($argv | Select-Object -Skip 1) | ForEach-Object { [MemloopJob]::Quote($_) }) -join ' '",
    "  $psi.UseShellExecute = $false",
    "  $p = [System.Diagnostics.Process]::Start($psi)",
    "  $p.WaitForExit()",
    "  [Console]::Error.WriteLine(\"@@JOB applied=1 limit=$limit peak=$([MemloopJob]::Peak())\")",
    "  exit $p.ExitCode",
    "} catch {",
    "  [Console]::Error.WriteLine(\"@@JOB applied=0 error=$($_.Exception.Message -replace '\\r?\\n', ' ')\")",
    "  exit 2",
    "}",
  ].join("\n");
}

/** argv for one capped run, plus the timeout the caller enforces itself (Windows) or null (`timeout` does it). */
export function commandFor(cap, size, timeoutS, args, { node = process.execPath, runScript }) {
  const run = [node, runScript, ...args];
  if (cap === "jobobject") {
    const script = jobObjectScript({ limitBytes: bytes(size), argv: run });
    return { argv: ["powershell.exe", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], timeoutMs: (timeoutS + KILL_AFTER_S) * 1000 };
  }
  const inner = ["timeout", `--kill-after=${KILL_AFTER_S}`, String(timeoutS), ...run];
  if (cap === "systemd") return { argv: ["systemd-run", "--user", "--scope", "--quiet", "-p", `MemoryMax=${size}`, "-p", "MemorySwapMax=0", "--", ...inner], timeoutMs: null };
  if (cap === "prlimit") return { argv: ["prlimit", `--as=${2 * bytes(size)}`, "--", ...inner], timeoutMs: null };
  return { argv: inner, timeoutMs: null };
}

/** The wrapper's `@@JOB` line from a run's output, or null when there is none. */
export function parseJobReport(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.startsWith("@@JOB "));
  if (!lines.length) return null;
  const line = lines.at(-1).slice(6);
  const applied = /\bapplied=1\b/.test(line);
  if (!applied) return { applied: false, error: (line.match(/\berror=(.*)$/) ?? [])[1] ?? "unknown" };
  const num = (k) => Number((line.match(new RegExp(`\\b${k}=(\\d+)`)) ?? [])[1] ?? NaN);
  return { applied: true, limitBytes: num("limit"), peakBytes: num("peak") };
}
