/** Test-only OS cleanup boundary for the compiled solver fixture. */
import { rmSync } from "node:fs";

/** Waits only for a PID obtained from this fixture's own solver report. */
export async function waitForOwnedProcessExit(pid: number, timeoutMs = 5_000, probe = (ownedPid: number) => process.kill(ownedPid, 0)): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("expected an owned process pid");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("cleanup timeout must be finite and positive");
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try { probe(pid); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`owned process ${pid} did not exit within ${timeoutMs} ms`);
    await Bun.sleep(Math.min(25, remaining));
  }
}

/** Timeout rejection is not success, and never replaces an operation's own error. */
export async function withinCleanupDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("cleanup timeout must be finite and positive");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Only a handle returned by this test's Bun.spawn may be supplied. */
export async function terminateOwnedChild(child: { kill(signal: "SIGKILL"): void; exited: Promise<number> }, timeoutMs = 5_000): Promise<void> {
  child.kill("SIGKILL");
  await withinCleanupDeadline(child.exited, timeoutMs, "owned child termination");
}

export interface RemovalOptions {
  timeoutMs?: number;
  retryMs?: number;
  /** Filesystem boundary: tests inject Windows executable-lock errors. */
  remove?: (directory: string) => void;
}

export async function removeExecutableDirectory(directory: string, options: RemovalOptions = {}): Promise<void> {
  const remove = options.remove ?? ((path: string) => rmSync(path, { recursive: true, force: true, maxRetries: 0 }));
  const timeoutMs = options.timeoutMs ?? 3_000;
  const retryMs = options.retryMs ?? 50;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(retryMs) || retryMs <= 0) throw new Error("cleanup timings must be finite and positive");
  const deadline = performance.now() + timeoutMs;
  const maxAttempts = Math.ceil(timeoutMs / retryMs) + 1;
  for (let attempt = 1; ; attempt++) {
    try { remove(directory); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY") throw error;
      const remaining = deadline - performance.now();
      if (attempt >= maxAttempts || remaining <= 0) throw error;
      await Bun.sleep(Math.min(retryMs, remaining));
      if (performance.now() >= deadline) throw error;
    }
  }
}
