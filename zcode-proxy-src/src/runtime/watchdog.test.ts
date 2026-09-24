import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { respawnHookCommand, spawnRespawnHook, watchdogStep, type WatchdogState } from "./watchdog.js";

const CFG = { checkIntervalMs: 1_000, stallMs: 45_000 };

describe("watchdogStep", () => {
  const fresh: WatchdogState = { beat: 7, changedAt: 0, checkedAt: 0 };

  it("reports a stall only once the heartbeat has been frozen past the threshold", () => {
    let state = fresh;
    let stalledMs: number | null = null;
    for (let now = 1_000; now <= 45_000; now += 1_000) {
      ({ state, stalledMs } = watchdogStep(state, 7, now, CFG));
      expect(stalledMs).toBeNull();
    }
    ({ state, stalledMs } = watchdogStep(state, 7, 46_000, CFG));
    expect(stalledMs).toBe(46_000);
  });

  it("a moving heartbeat restarts the stall clock", () => {
    let state = fresh;
    let stalledMs: number | null = null;
    for (let now = 1_000; now <= 30_000; now += 1_000) ({ state } = watchdogStep(state, 7, now, CFG));
    ({ state, stalledMs } = watchdogStep(state, 8, 31_000, CFG));
    expect(stalledMs).toBeNull();
    for (let now = 32_000; now <= 76_000; now += 1_000) {
      ({ state, stalledMs } = watchdogStep(state, 8, now, CFG));
      expect(stalledMs).toBeNull();
    }
    ({ state, stalledMs } = watchdogStep(state, 8, 77_000, CFG));
    expect(stalledMs).toBe(46_000);
  });

  it("treats a gap in its own checks (> 20× interval) as a suspend, not a stall", () => {
    const state: WatchdogState = { beat: 7, changedAt: 0, checkedAt: 1_000 };
    // 10 minutes of machine sleep: heartbeat frozen, but so was the watcher.
    const resumed = watchdogStep(state, 7, 601_000, CFG);
    expect(resumed.stalledMs).toBeNull();
    expect(resumed.state).toEqual({ beat: 7, changedAt: 601_000, checkedAt: 601_000 });
    // Exactly 20× is still an ordinary (late) check and may report a stall.
    const late = watchdogStep({ beat: 7, changedAt: 0, checkedAt: 30_000 }, 7, 50_000, CFG);
    expect(late.stalledMs).toBe(50_000);
  });
});

describe("respawnHookCommand", () => {
  it("builds the manager respawn command only when both hook variables are set", () => {
    const env = { ZCODE_KIT_RESPAWN_NODE: "/usr/bin/node", ZCODE_KIT_RESPAWN_MANAGER: "/kit/proxy/zcode-proxy-manager.mjs" };
    expect(respawnHookCommand(env, 1234, "memory")).toEqual({
      command: "/usr/bin/node",
      args: ["/kit/proxy/zcode-proxy-manager.mjs", "respawn", "1234", "--reason", "memory"],
    });
    expect(respawnHookCommand({ ZCODE_KIT_RESPAWN_NODE: "/usr/bin/node" }, 1, "watchdog")).toBeNull();
    expect(respawnHookCommand({ ZCODE_KIT_RESPAWN_MANAGER: "/m.mjs" }, 1, "watchdog")).toBeNull();
  });
});

describe("spawnRespawnHook", () => {
  it("reports failure without crashing the host when the hook executable does not exist", async () => {
    const env = {
      ZCODE_KIT_RESPAWN_NODE: join(tmpdir(), "zcode-no-such-node", "node-missing.exe"),
      ZCODE_KIT_RESPAWN_MANAGER: join(tmpdir(), "zcode-no-such-manager.mjs"),
    };
    // An unhandled child 'error' event would surface as an uncaught error
    // and fail this test run.
    expect(await spawnRespawnHook("memory", env)).toBe(false);
  });

  it("reports success once a real hook process has started", async () => {
    const env = { ZCODE_KIT_RESPAWN_NODE: process.execPath, ZCODE_KIT_RESPAWN_MANAGER: "--version" };
    expect(await spawnRespawnHook("memory", env)).toBe(true);
  });

  it("is false without the hook environment", async () => {
    expect(await spawnRespawnHook("memory", {})).toBe(false);
  });
});

// Real child processes: the property under test is that a separate thread
// hard-kills a process whose main thread is genuinely blocked.
describe("watchdog in a child process", () => {
  const STALL_MS = 1_000;
  const BLOCK_MS = 15_000;
  let dir = "";
  let childScript = "";
  let fakeManager = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zcode-watchdog-"));
    childScript = join(dir, "child.ts");
    fakeManager = join(dir, "fake-manager.mjs");
    const watchdogUrl = pathToFileURL(join(import.meta.dir, "watchdog.ts")).href;
    writeFileSync(
      childScript,
      `import { installWatchdog } from ${JSON.stringify(watchdogUrl)};
const handle = installWatchdog({ stallMs: ${STALL_MS}, checkIntervalMs: 100, heartbeatMs: 50 });
console.log("installed:" + (handle !== null) + " pid:" + process.pid);
await Bun.sleep(300);
const until = Date.now() + Number(process.env.BLOCK_MS);
while (Date.now() < until) { /* stalled main thread */ }
console.log("survived");
process.exit(0);
`,
    );
    writeFileSync(
      fakeManager,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.env.WATCHDOG_MARKER, process.argv.slice(2).join(" "));
`,
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function runChild(extraEnv: Record<string, string>, blockMs = BLOCK_MS) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith("ZCODE_KIT_")) env[k] = v;
    }
    Object.assign(env, { BLOCK_MS: String(blockMs) }, extraEnv);
    const started = Date.now();
    const child = spawn(process.execPath, [childScript], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const { promise, resolve } = Promise.withResolvers<void>();
    const guard = setTimeout(() => child.kill("SIGKILL"), blockMs + 10_000);
    child.on("close", () => resolve());
    await promise;
    clearTimeout(guard);
    const pid = Number(/pid:(\d+)/.exec(stdout)?.[1]);
    return { stdout, stderr, pid, elapsedMs: Date.now() - started };
  }

  async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(path) && readFileSync(path, "utf8").length > 0) return true;
      await Bun.sleep(50);
    }
    return false;
  }

  it("kills a stalled process and invokes the manager respawn hook", async () => {
    const marker = join(dir, "marker-hook.txt");
    const result = await runChild({
      ZCODE_KIT_RESPAWN_NODE: process.execPath,
      ZCODE_KIT_RESPAWN_MANAGER: fakeManager,
      WATCHDOG_MARKER: marker,
    });
    expect(result.stdout).toContain("installed:true");
    expect(result.stdout).not.toContain("survived");
    // Startup + 300 ms idle + 1 s threshold + kill; far below the 15 s block.
    expect(result.elapsedMs).toBeLessThan(STALL_MS + 6_000);
    expect(result.stderr).toMatch(/\[watchdog\] main thread unresponsive for \d+ms — requesting restart/);
    expect(await waitForFile(marker, 5_000)).toBe(true);
    expect(readFileSync(marker, "utf8")).toBe(`respawn ${result.pid} --reason watchdog`);
  }, 30_000);

  it("still kills a stalled process when the hook executable is missing", async () => {
    const result = await runChild({
      ZCODE_KIT_RESPAWN_NODE: join(dir, "missing-node.exe"),
      ZCODE_KIT_RESPAWN_MANAGER: fakeManager,
    });
    expect(result.stdout).not.toContain("survived");
    expect(result.elapsedMs).toBeLessThan(STALL_MS + 6_000);
    expect(result.stderr).toContain("[watchdog] main thread unresponsive");
    expect(result.stderr).toContain("[watchdog] respawn hook failed:");
  }, 30_000);

  it("still kills a stalled process when no hook is configured", async () => {
    const marker = join(dir, "marker-nohook.txt");
    const result = await runChild({ WATCHDOG_MARKER: marker });
    expect(result.stdout).toContain("installed:true");
    expect(result.stdout).not.toContain("survived");
    expect(result.elapsedMs).toBeLessThan(STALL_MS + 6_000);
    expect(result.stderr).toContain("[watchdog] main thread unresponsive");
    await Bun.sleep(500);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  it("is not installed with ZCODE_KIT_WATCHDOG=0", async () => {
    const result = await runChild({ ZCODE_KIT_WATCHDOG: "0" }, STALL_MS * 2);
    expect(result.stdout).toContain("installed:false");
    expect(result.stdout).toContain("survived");
    expect(result.stderr).not.toContain("[watchdog]");
  }, 30_000);
});
