/** Fixture cleanup at the OS filesystem/process boundary: owned children end and executable directories go within a deadline. */
import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeExecutableDirectory, waitForOwnedProcessExit, terminateOwnedChild, withinCleanupDeadline } from "./__fixtures__/solver-test-cleanup.js";

for (const code of ["EPERM", "EBUSY"]) {
  it(`fails on persistent ${code} rather than claiming the directory was removed`, async () => {
    const error = Object.assign(new Error("persistent executable lock"), { code });
    const start = performance.now();
    await expect(removeExecutableDirectory("unused", {
      timeoutMs: 30, retryMs: 5, remove() { throw error; },
    })).rejects.toBe(error);
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
}

it("propagates unexpected filesystem errors without retrying", async () => {
  const error = Object.assign(new Error("I/O failure"), { code: "EIO" });
  let attempts = 0;
  await expect(removeExecutableDirectory("unused", { remove() { attempts++; throw error; } })).rejects.toBe(error);
  expect(attempts).toBe(1);
});

it("propagates permission and unexpected process-probe errors rather than treating them as exit", async () => {
  for (const code of ["EPERM", "EIO"]) {
    const error = Object.assign(new Error("cannot observe child"), { code });
    await expect(waitForOwnedProcessExit(123, 30, () => { throw error; })).rejects.toBe(error);
  }
});

it("rejects a stalled owned-child termination and preserves operation failures", async () => {
  await expect(terminateOwnedChild({ kill() {}, exited: new Promise(() => {}) }, 20)).rejects.toThrow("owned child termination timed out");
  const error = new Error("exit observation failed");
  await expect(withinCleanupDeadline(Promise.reject(error), 100, "owned child termination")).rejects.toBe(error);
  await expect(terminateOwnedChild({ kill() { throw error; }, exited: Promise.resolve(0) })).rejects.toBe(error);
});

it("terminates and awaits the exact child handle this test spawned", async () => {
  const child = Bun.spawn([process.execPath, "--eval", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" });
  await terminateOwnedChild(child);
  expect(() => process.kill(child.pid, 0)).toThrow();
});

it("fails when its owned child does not exit before the deadline", async () => {
  const child = Bun.spawn([process.execPath, "--eval", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" });
  try {
    await expect(waitForOwnedProcessExit(child.pid, 30)).rejects.toThrow("owned process");
  } finally {
    await terminateOwnedChild(child);
  }
});

it("does not report shutdown complete before its owned child has exited", async () => {
  const child = Bun.spawn([process.execPath, "--eval", "setTimeout(() => process.exit(0), 150)"], { stdout: "ignore", stderr: "ignore" });
  try {
    await waitForOwnedProcessExit(child.pid, 2_000);
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(await child.exited).toBe(0);
  } finally {
    await terminateOwnedChild(child);
  }
});

it("removes the executable directory after transient EPERM and EBUSY locks clear", async () => {
  const directory = mkdtempSync(join(tmpdir(), "solver-cleanup-"));
  writeFileSync(join(directory, "solver-host.exe"), "offline fixture");
  const locks = ["EPERM", "EBUSY"];
  try {
    await removeExecutableDirectory(directory, {
      timeoutMs: 200, retryMs: 5,
      remove(path) {
        const code = locks.shift();
        if (code) throw Object.assign(new Error("executable locked"), { code });
        rmSync(path, { recursive: true });
      },
    });
    expect(existsSync(directory)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
