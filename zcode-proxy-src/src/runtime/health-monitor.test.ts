import { afterEach, describe, expect, it } from "bun:test";
import {
  EventLoopLagMonitor,
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
      capMB: null,
      enforcement: "none",
      lastFootprintMB: null,
      abnormalExits: 0,
      failFast: false,
      failFastUntil: null,
      shedSolves: 0,
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
