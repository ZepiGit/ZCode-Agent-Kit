// A stand-in for Windows PowerShell at the lifecycle module's process
// boundary (tests only; ticket 77). The lifecycle module sends PowerShell two
// scripts, and this stand-in answers both the way Windows would:
//   - the start-time reader `(Get-Process -Id N).StartTime.ToUniversalTime().Ticks`
//     prints the configured .NET UTC ticks of pid N;
//   - the kill guard (OpenProcess → GetProcessTimes → identity check →
//     TerminateProcess) evaluates the guard's identity check against the
//     configured creation FILETIME of pid N's handle, and "terminates" the
//     process (SIGKILL) only when the check passes.
// The state file (FAKE_POWERSHELL_STATE) holds `{ log, processes }`; processes
// maps a pid (or "*" for any pid) to `{ ticks, created?, guardExit? }`:
// `created` defaults to the FILETIME of `ticks` (the same process), and
// `guardExit` forces the guard's exit code (a failing OpenProcess, …). Each
// call is appended to the log as one JSON line.
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** .NET ticks at the FILETIME epoch (1601-01-01 UTC): ticks = FILETIME + this. */
export const FILETIME_EPOCH_TICKS = 504911232000000000n;
/** FILETIME at the Unix epoch (1970-01-01 UTC). */
const FILETIME_UNIX_EPOCH = 116444736000000000n;

/**
 * The exit code the kill guard's identity check takes for a handle whose
 * creation FILETIME is `created` (0 = the check passes), or null when the
 * script holds no identity check this stand-in can evaluate.
 */
export function identityCheckExit(script, created) {
  const exact = script.match(/if \(\$created -ne \[long\]'(\d+)'\) \{ exit (\d+) \}/);
  if (exact) return BigInt(created) !== BigInt(exact[1]) ? Number(exact[2]) : 0;
  // The guard before ticket 77: the creation time within T ms of
  // FromUnixTimeMilliseconds(N), so the tip's refusal can be reproduced.
  const ms = script.match(/FromUnixTimeMilliseconds\((-?\d+)\)/);
  const tolerance = script.match(/TotalMilliseconds\) -gt (\d+)\) \{ exit (\d+) \}/);
  if (ms && tolerance) {
    const delta = BigInt(created) - FILETIME_UNIX_EPOCH - BigInt(ms[1]) * 10000n;
    return (delta < 0n ? -delta : delta) > BigInt(tolerance[1]) * 10000n ? Number(tolerance[2]) : 0;
  }
  return null;
}

function main() {
  const script = process.argv[process.argv.indexOf("-Command") + 1] ?? "";
  const state = JSON.parse(readFileSync(process.env.FAKE_POWERSHELL_STATE, "utf8"));
  const proc = (pid) => state.processes[String(pid)] ?? state.processes["*"] ?? null;
  const log = (entry) => appendFileSync(state.log, JSON.stringify(entry) + "\n");

  const reader = script.match(/^\(Get-Process -Id (\d+)\)\.StartTime\.ToUniversalTime\(\)\.Ticks$/);
  if (reader) {
    const pid = Number(reader[1]);
    const p = proc(pid);
    log({ kind: "read", pid, ticks: p?.ticks ?? null });
    if (!p) {
      process.stderr.write(`Get-Process : Cannot find a process with the process identifier ${pid}.\r\n`);
      process.exit(1);
    }
    process.stdout.write(`${p.ticks}\r\n`);
    process.exit(0);
  }

  const open = script.match(/OpenProcess\(0x1001, \$false, (\d+)\)/);
  if (open) {
    const pid = Number(open[1]);
    const p = proc(pid);
    let exit;
    if (p && Number.isInteger(p.guardExit)) exit = p.guardExit;
    else if (!p) exit = Number((script.match(/\[IntPtr\]::Zero\) \{ exit (\d+) \}/) ?? [])[1] ?? 99);
    else {
      const created = p.created ?? String(BigInt(p.ticks) - FILETIME_EPOCH_TICKS);
      exit = identityCheckExit(script, created) ?? 99;
      if (exit === 0) {
        if (!/TerminateProcess\(\$handle,0\)/.test(script)) exit = 98;
        else try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
    log({ kind: "guard", pid, exit, check: script.split(/\r?\n/).filter((l) => /\$created -ne|FromUnixTimeMilliseconds|TotalMilliseconds/.test(l)).map((l) => l.trim()) });
    process.exit(exit);
  }

  log({ kind: "unknown", script });
  process.stderr.write("fake powershell: unrecognised script\r\n");
  process.exit(97);
}

if (process.env.FAKE_POWERSHELL_STATE && resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
