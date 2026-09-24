import { afterEach, describe, expect, it } from "bun:test";
import {
  EventLoopLagMonitor,
  MemoryGuard,
  healthDetails,
  registerCaptchaRuntime,
  type CaptchaHealth,
} from "./health-monitor.js";

function blockFor(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) { /* synchronous main-thread stall */ }
}

describe("EventLoopLagMonitor", () => {
  let monitor: EventLoopLagMonitor | null = null;
  afterEach(() => monitor?.stop());

  // Real time on purpose: the property under test is how late a real platform
  // timer fires after the real event loop was blocked; fake timers cannot lag.
  it("reports a ~300 ms synchronous block as lag and keeps it as the 60 s max", async () => {
    monitor = new EventLoopLagMonitor({ intervalMs: 50 });
    monitor.start();
    await Bun.sleep(120);
    expect(monitor.lastMs()).toBeLessThan(150);
    blockFor(300);
    await Bun.sleep(20);
    expect(monitor.lastMs()).toBeGreaterThanOrEqual(200);
    expect(monitor.lastMs()).toBeLessThan(1_000);
    await Bun.sleep(150);
    // Later on-time ticks bring the last sample down; the window max remembers.
    expect(monitor.lastMs()).toBeLessThan(150);
    expect(monitor.maxMs()).toBeGreaterThanOrEqual(200);
  });

  it("drops samples older than the window from the max", () => {
    let now = 0;
    monitor = new EventLoopLagMonitor({ intervalMs: 500, windowMs: 60_000, now: () => now });
    monitor.start();
    monitor.stop();
    now = 500 + 4_000;
    monitor.sample();
    expect(monitor.maxMs()).toBe(4_000);
    for (let i = 0; i < 130; i++) {
      now += 500;
      monitor.sample();
    }
    expect(monitor.lastMs()).toBe(0);
    expect(monitor.maxMs()).toBe(0);
  });
});

describe("healthDetails captcha section", () => {
  afterEach(() => registerCaptchaRuntime(null));

  const captcha: CaptchaHealth = {
    ready: 1,
    target: 1,
    activeSolves: 0,
    storm: false,
    mintSuccessRate10m: 1,
    solver: {
      mode: "worker",
      alive: true,
      busy: false,
      queueDepth: 0,
      generation: 1,
      solvesSinceSpawn: 3,
      totalSolves: 3,
      totalFailures: 0,
      consecutiveFailures: 0,
      deadlineKills: 0,
      recycles: 0,
      lastRecycleReason: null,
      lastRecycleAt: null,
      lastSdkScripts: null,
    },
  };

  it("is null until the captcha module registers, then mirrors its stats", () => {
    registerCaptchaRuntime(null);
    expect(healthDetails().captcha).toBeNull();
    registerCaptchaRuntime({ stats: () => captcha, recycle: () => {}, shutdown: () => {} });
    const details = healthDetails();
    expect(details.captcha).toEqual(captcha);
    expect(details.pid).toBe(process.pid);
    expect(details.rssMB).toBeGreaterThan(0);
  });

  it("degrades to null when the stats provider throws", () => {
    registerCaptchaRuntime({ stats: () => { throw new Error("pool broken"); }, recycle: () => {}, shutdown: () => {} });
    expect(healthDetails().captcha).toBeNull();
  });
});

describe("MemoryGuard", () => {
  function harness(opts: { hook: boolean; launches?: boolean }) {
    let rss = 500;
    const events: string[] = [];
    const guard = new MemoryGuard({
      sampleRssMB: () => rss,
      recycle: (reason) => events.push(`recycle:${reason}`),
      canRestart: () => opts.hook,
      restart: async () => {
        events.push("restart");
        return opts.launches ?? true;
      },
      log: (line) => events.push(line),
    });
    return {
      events,
      at(mb: number) {
        rss = mb;
        guard.sample();
      },
    };
  }

  it("recycles once per episode above the soft limit and resets below it", () => {
    const h = harness({ hook: true });
    h.at(1_536);
    expect(h.events).toEqual([]);
    h.at(1_600);
    h.at(1_700);
    h.at(2_000);
    expect(h.events.filter((e) => e === "recycle:memory")).toHaveLength(1);
    h.at(1_000); // episode over
    h.at(1_600);
    expect(h.events.filter((e) => e === "recycle:memory")).toHaveLength(2);
    expect(h.events).not.toContain("restart");
  });

  it("restarts via the hook after 3 consecutive post-recycle samples above the hard limit", async () => {
    const h = harness({ hook: true });
    h.at(4_000); // first sample over soft: recycle, never an immediate restart
    h.at(3_100);
    h.at(3_100);
    h.at(3_000); // dips below hard: streak resets
    h.at(3_100);
    h.at(3_100);
    expect(h.events).not.toContain("restart");
    h.at(3_200);
    expect(h.events.filter((e) => e === "restart")).toHaveLength(1);
    expect(h.events).toContain("[memory] rss 3200 MB — requesting restart");
    await Promise.resolve();
    // Restart is requested exactly once.
    h.at(3_300);
    h.at(3_300);
    h.at(3_300);
    expect(h.events.filter((e) => e === "restart")).toHaveLength(1);
  });

  it("keeps serving and stops retrying for the episode when the hook fails to launch", async () => {
    const h = harness({ hook: true, launches: false });
    for (const mb of [4_000, 3_500, 3_500, 3_500]) h.at(mb);
    expect(h.events.filter((e) => e === "restart")).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.events).toContain("[memory] kit manager respawn hook did not start — not restarting, still serving");
    for (const mb of [3_500, 3_500, 3_500, 3_500]) h.at(mb);
    expect(h.events.filter((e) => e === "restart")).toHaveLength(1);
    // A new episode tries again.
    h.at(800);
    for (const mb of [4_000, 3_500, 3_500, 3_500]) h.at(mb);
    expect(h.events.filter((e) => e === "restart")).toHaveLength(2);
  });

  it("only logs once per episode without the respawn hook", () => {
    const h = harness({ hook: false });
    for (const mb of [4_000, 3_500, 3_500, 3_500, 3_500, 3_500]) h.at(mb);
    expect(h.events).not.toContain("restart");
    const warnings = h.events.filter((e) => e.includes("no kit manager respawn hook"));
    expect(warnings).toHaveLength(1);
    h.at(800);
    for (const mb of [4_000, 3_500, 3_500, 3_500]) h.at(mb);
    expect(h.events.filter((e) => e.includes("no kit manager respawn hook"))).toHaveLength(2);
    expect(h.events.filter((e) => e === "recycle:memory")).toHaveLength(2);
  });
});
