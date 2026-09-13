/**
 * Single process-launch point of the bridge.
 *
 * The program is the fixed literal "node" (resolved by the OS from PATH and
 * verified by discovery up front). Only the harness script path varies, and
 * it comes from operator configuration or verified discovery — never from
 * model or tool output. Argument-array spawn, shell disabled, no command-line
 * string concatenation anywhere.
 */
import { type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";

export function spawnAppServer(opts: { harnessPath: string; cwd: string }): ChildProcessWithoutNullStreams {
  // stdio is fully piped, so the child has non-null streams (runtime
  // guarantee; the cast only mirrors that guarantee for the type system).
  const child = spawn("node", [opts.harnessPath, "app-server", "--stdio"], {
    cwd: opts.cwd,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

/** Read-only version probe of a candidate harness bundle. */
export function spawnVersionProbe(harnessPath: string): ChildProcess {
  return spawn("node", [harnessPath, "--version"], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
