/**
 * The health supervisor's memory policy at module level:
 * an injected footprint sampler and an injected clock, so "3 samples 15 s
 * apart" is checked against the clock, not against real time.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCaptchaRuntime } from "./health-monitor.js";
import {
  createHealthSupervisor,
  managerRespawnHandoff,
  memoryFootprint,
  type FootprintSample,
  type HealthSupervisorOptions,
  type SupervisorClock,
} from "./supervisor.js";

/** A clock whose repeating timers fire only when the test advances it. */
function fakeClock() {
  let t = 0;
  const timers: Array<{ next: number; ms: number; fn: () => void; on: boolean }> = [];
  const clock: SupervisorClock & { advance(ms: number): void } = {
    now: () => t,
    every(ms, fn) {
      const timer = { next: t + ms, ms, fn, on: true };
      timers.push(timer);
      return () => { timer.on = false; };
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.on && x.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        t = due.next;
        due.next += due.ms;
        due.fn();
      }
      t = end;
    },
  };
  return clock;
}

const EVENT_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (DEBUG|INFO|WARN|ERROR) supervisor /;

/**
 * A supervisor on a fake clock whose sampler reads `footprint` (MB). The
 * respawn handoff records each request; `confirms` says whether the manager
 * confirmed it (false: the hook did not start). The confirmed respawn's
 * shutdown is recorded, never run.
 */
function harness(opts: { hook?: boolean; confirms?: boolean; thresholds?: HealthSupervisorOptions["thresholds"] } = {}) {
  const clock = fakeClock();
  const lines: string[] = [];
  const requests: Array<{ reason: string; at: number }> = [];
  const shutdowns: Array<{ reason: string; at: number }> = [];
  let samples = 0;
  const state = { footprint: 100 };
  const sample = (): FootprintSample => { samples++; return { mb: state.footprint, metric: "footprint" }; };
  const supervisor = createHealthSupervisor({
    ...(opts.thresholds ? { thresholds: opts.thresholds } : {}),
    sample,
    clock,
    watchdog: false,
    writeLog: (line) => lines.push(line),
    respawn: opts.hook === false ? null : {
      available: () => true,
      request: async (reason) => {
        requests.push({ reason, at: clock.now() });
        const confirmed = opts.confirms ?? true;
        return { outcome: confirmed ? "acknowledged" : "hook-failed", confirmed, waitedMs: 0 };
      },
    },
    shutdown: async (reason) => { shutdowns.push({ reason, at: clock.now() }); },
  });
  supervisor.start();
  supervisors.push(supervisor);
  return {
    clock, lines, requests, shutdowns, supervisor,
    get samples() { return samples; },
    /** Hold `mb` for `count` sample intervals of `intervalMs`. */
    hold(mb: number, count: number, intervalMs = 15_000) {
      state.footprint = mb;
      for (let i = 0; i < count; i++) clock.advance(intervalMs);
    },
  };
}

const supervisors: Array<{ stop(): void }> = [];
afterEach(() => {
  while (supervisors.length) supervisors.pop()!.stop();
  registerCaptchaRuntime(null);
});

/** Let the handoff's promise chain settle. */
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("health supervisor: memory thresholds (defaults 512 / 1024 MB × 3 samples 15 s apart)", () => {
  it("a soft breach held for 3 samples only WARNs once, in the event-line format, and never recycles the solver", async () => {
    let recycles = 0;
    registerCaptchaRuntime({ stats: () => { throw new Error("unused"); }, recycle: () => { recycles++; }, shutdown: () => {} });
    const h = harness();
    h.hold(600, 2);
    expect(h.lines).toEqual([]);
    h.hold(600, 1);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatch(EVENT_LINE);
    expect(h.lines[0]).toMatch(/^\S+ WARN supervisor memory above the soft limit .*footprintMB=600 .*softLimitMB=512/);
    h.hold(700, 10);
    await settle();
    expect(h.lines).toHaveLength(1);
    expect(recycles).toBe(0);
    expect(h.requests).toEqual([]);
    expect(h.shutdowns).toEqual([]);
  });

  it("a hard breach held for 3 samples 15 s apart requests one respawn, and the confirmed respawn runs the graceful shutdown", async () => {
    const h = harness();
    h.hold(1_100, 2);
    await settle();
    expect(h.requests).toEqual([]);
    h.clock.advance(14_999);
    await settle();
    expect(h.requests).toEqual([]);
    h.clock.advance(1);
    await settle();
    // Samples at 15, 30 and 45 s: the third one asks.
    expect(h.requests).toEqual([{ reason: "memory", at: 45_000 }]);
    expect(h.shutdowns).toEqual([{ reason: "memory", at: 45_000 }]);
    expect(h.lines.some((l) => /WARN supervisor memory above the hard limit .*footprintMB=1100 .*hardLimitMB=1024/.test(l))).toBe(true);
    h.hold(1_200, 10);
    await settle();
    expect(h.requests).toHaveLength(1);
  });

  it("adversarial: two samples above hard followed by one below never request a respawn", async () => {
    const h = harness();
    for (let round = 0; round < 5; round++) {
      h.hold(1_500, 2);
      h.hold(1_000, 1); // above soft, below hard
    }
    await settle();
    expect(h.requests).toEqual([]);
    h.hold(1_500, 3);
    await settle();
    expect(h.requests).toHaveLength(1);
  });

  it("adversarial: samples are taken 15 s apart on the injected clock, so a hard breach needs 30 s after its first sample", async () => {
    const h = harness();
    h.hold(2_000, 0);
    h.clock.advance(14_999);
    expect(h.samples).toBe(0);
    h.clock.advance(1);
    expect(h.samples).toBe(1);
    h.clock.advance(29_999);
    await settle();
    expect(h.samples).toBe(2);
    expect(h.requests).toEqual([]);
    h.clock.advance(1);
    await settle();
    expect(h.samples).toBe(3);
    expect(h.requests).toHaveLength(1);
  });

  it("thresholds, sample count and interval come from config", async () => {
    const h = harness({ thresholds: { softLimitMB: 100, hardLimitMB: 200, samples: 2, sampleIntervalMs: 5_000 } });
    h.hold(150, 2, 5_000);
    expect(h.lines.filter((l) => / WARN supervisor memory above the soft limit /.test(l))).toHaveLength(1);
    expect(h.lines[0]).toMatch(/softLimitMB=100/);
    h.hold(250, 1, 5_000);
    await settle();
    expect(h.requests).toEqual([]);
    h.hold(250, 1, 5_000);
    await settle();
    expect(h.requests).toEqual([{ reason: "memory", at: 20_000 }]);
  });

  it("without a manager hook it logs once per episode and keeps serving (keeps sampling, never shuts down)", async () => {
    const h = harness({ hook: false });
    h.hold(1_500, 8);
    await settle();
    const noHook = h.lines.filter((l) => / WARN supervisor memory above the hard limit; no manager hook, keeps serving /.test(l));
    expect(noHook).toHaveLength(1);
    expect(h.shutdowns).toEqual([]);
    const before = h.samples;
    h.hold(1_500, 2);
    expect(h.samples).toBe(before + 2);
    // A new episode (back under the soft limit) reports again.
    h.hold(300, 1);
    h.hold(1_500, 3);
    await settle();
    expect(h.lines.filter((l) => / no manager hook, keeps serving /.test(l))).toHaveLength(2);
    expect(h.shutdowns).toEqual([]);
  });

  it("a respawn hook that does not start leaves the proxy serving and is not retried within the budget window, not even in a new episode", async () => {
    const h = harness({ confirms: false });
    h.hold(1_500, 3);
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.shutdowns).toEqual([]);
    expect(h.lines.some((l) => /^\S+ ERROR supervisor respawn hook did not start; keeps serving /.test(l))).toBe(true);
    h.hold(1_500, 6);
    await settle();
    expect(h.requests).toHaveLength(1);
    // A new episode inside the budget window
    // spawns no hook either; the first request after the window does.
    h.hold(300, 1);
    h.hold(1_500, 3);
    await settle();
    expect(h.requests).toHaveLength(1);
    h.hold(1_500, 60);
    await settle();
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]!.at - h.requests[0]!.at).toBeGreaterThanOrEqual(15 * 60_000);
  });
});

// The supervisor behind the REAL manager handoff
// (`managerRespawnHandoff`), with an injected clock and an injected spawn that
// counts every hook it is asked to start and answers like the manager would.
type HookAnswer = "refuse" | "silent" | "ack";

function fakeHookSpawn(answer: () => HookAnswer, ackFile: string, spawned: number[], clock: { now(): number }) {
  return ((command: string, args: readonly string[]) => {
    spawned.push(clock.now());
    const child = new EventEmitter() as EventEmitter & { unref(): void; pid: number };
    child.unref = () => {};
    child.pid = 1;
    const mode = answer();
    queueMicrotask(() => {
      if (mode === "refuse") child.emit("exit", 4, null);
      // The event the manager writes at reservation, stamped with the wall clock.
      if (mode === "ack") writeFileSync(ackFile, JSON.stringify({ events: [{ at: Date.now() + 1, pid: Number(args[2]), reason: "memory" }] }));
    });
    expect(command).toBe("/kit/node");
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

function managedHarness(hookAnswer: () => HookAnswer, opts: { ackWaitMs?: number } = {}) {
  const clock = fakeClock();
  const dir = mkdtempSync(join(tmpdir(), "t23-supervisor-"));
  tempDirs.push(dir);
  const ackFile = join(dir, "respawn.json");
  const spawned: number[] = [];
  const lines: string[] = [];
  const shutdowns: number[] = [];
  const state = { footprint: 100 };
  const env = { ZCODE_KIT_RESPAWN_NODE: "/kit/node", ZCODE_KIT_RESPAWN_MANAGER: "/kit/proxy/zcode-proxy-manager.mjs", ZCODE_KIT_LOG_DIR: dir };
  const supervisor = createHealthSupervisor({
    sample: () => ({ mb: state.footprint, metric: "footprint" }),
    clock,
    watchdog: false,
    writeLog: (line) => lines.push(line),
    respawn: managerRespawnHandoff(env, { spawn: fakeHookSpawn(hookAnswer, ackFile, spawned, clock), ackWaitMs: opts.ackWaitMs ?? 50, pollMs: 5 }),
    shutdown: async () => { shutdowns.push(clock.now()); },
  });
  supervisor.start();
  supervisors.push(supervisor);
  return {
    clock, lines, spawned, shutdowns, supervisor,
    /** Hold `mb` for `ms`, one 15 s sample at a time, letting each answer arrive. */
    async hold(mb: number, ms: number) {
      state.footprint = mb;
      for (let left = ms; left > 0; left -= 15_000) {
        clock.advance(Math.min(15_000, left));
        for (let i = 0; i < 100 && supervisor.memory().respawnPending && shutdowns.length === 0; i++) await Bun.sleep(5);
        await settle();
      }
    },
  };
}

const tempDirs: string[] = [];
afterEach(() => { for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const WINDOW_MS = 15 * 60_000;

describe("health supervisor: respawn acknowledgement before drain (ticket 23)", () => {
  it("an acknowledged respawn drains: the graceful shutdown runs once", async () => {
    const h = managedHarness(() => "ack", { ackWaitMs: 5_000 });
    await h.hold(1_500, 45_000);
    expect(h.spawned).toEqual([45_000]);
    expect(h.shutdowns).toEqual([45_000]);
    expect(h.lines.some((l) => / INFO supervisor respawn confirmed; draining .*outcome=acknowledged/.test(l))).toBe(true);
  });

  for (const [answer, message] of [["refuse", "respawn refused by the kit manager; keeps serving"], ["silent", "respawn not acknowledged by the kit manager; keeps serving"]] as const) {
    it(`${answer === "refuse" ? "hook exit 4" : "no acknowledgement"}: keeps serving, one ERROR event line, restarts reported exhausted`, async () => {
      const h = managedHarness(() => answer);
      await h.hold(1_500, 10 * 60_000);
      expect(h.spawned).toEqual([45_000]);
      expect(h.shutdowns).toEqual([]);
      const errors = h.lines.filter((l) => / ERROR /.test(l));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(EVENT_LINE);
      expect(errors[0]).toContain(` ERROR supervisor ${message} `);
      expect(errors[0]).toMatch(/ outcome=(refused|no-acknowledgement) .*restarts=exhausted retryInS=900$/);
      expect(h.supervisor.memory()).toMatchObject({ restartsExhausted: true, respawnPending: false, respawnOutcome: answer === "refuse" ? "refused" : "no-acknowledgement", respawnRetryAt: 45_000 + WINDOW_MS });
      // Still sampling: the proxy keeps serving, it was never stopped.
      expect(h.supervisor.memory().lastAt).toBe(10 * 60_000);
    });
  }

  it("the hard condition persisting over two budget windows with every respawn refused spawns exactly one hook per window (Story 50)", async () => {
    const h = managedHarness(() => "refuse");
    // Window 1 starts with the first request at 45 s, window 2 with the next
    // at 945 s; 1830 s is the last sample inside window 2.
    await h.hold(1_500, 1_830_000);
    expect(h.spawned).toEqual([45_000, 45_000 + WINDOW_MS]);
    expect(h.shutdowns).toEqual([]);
    expect(h.lines.filter((l) => / ERROR supervisor respawn refused /.test(l))).toHaveLength(2);
    for (let w = 0; w < 2; w++) {
      const from = 45_000 + w * WINDOW_MS;
      expect(h.spawned.filter((at) => at >= from && at < from + WINDOW_MS)).toHaveLength(1);
    }
    // The third window opens with the third request, not earlier.
    await h.hold(1_500, 15_000);
    expect(h.spawned).toEqual([45_000, 45_000 + WINDOW_MS, 45_000 + 2 * WINDOW_MS]);
  });

  it("adversarial: a condition that comes and goes inside the window spawns no extra hook and logs no extra ERROR", async () => {
    const h = managedHarness(() => "refuse");
    for (let round = 0; round < 12; round++) {
      await h.hold(1_500, 45_000);
      await h.hold(300, 15_000);
    }
    expect(h.clock.now()).toBe(12 * 60_000);
    expect(h.spawned).toEqual([45_000]);
    expect(h.lines.filter((l) => / ERROR /.test(l))).toHaveLength(1);
    // Each later episode says once that the budget is exhausted, as a WARN.
    expect(h.lines.filter((l) => / WARN supervisor memory above the hard limit; restart budget exhausted, keeps serving .*restarts=exhausted/.test(l))).toHaveLength(11);
  });

  it("the exhausted report ends with the budget window; an acknowledged retry then drains", async () => {
    let answer: HookAnswer = "refuse";
    const h = managedHarness(() => answer, { ackWaitMs: 5_000 });
    await h.hold(1_500, 60_000);
    expect(h.supervisor.memory().restartsExhausted).toBe(true);
    await h.hold(300, WINDOW_MS);
    expect(h.supervisor.memory()).toMatchObject({ restartsExhausted: false, respawnRetryAt: null });
    answer = "ack";
    await h.hold(1_500, 45_000);
    expect(h.spawned).toHaveLength(2);
    expect(h.shutdowns).toHaveLength(1);
  });
});

describe("memoryFootprint", () => {
  it("reads Bun's memory footprint and falls back to RSS where it is missing", () => {
    const real = memoryFootprint();
    expect(real.metric).toBe("footprint");
    expect(real.mb).toBeGreaterThan(0);
    expect(memoryFootprint({ memoryFootprint: () => 300 * 1024 * 1024 })).toEqual({ mb: 300, metric: "footprint" });
    const fallback = memoryFootprint({ memoryFootprint: () => undefined });
    expect(fallback.metric).toBe("rss");
    expect(fallback.mb).toBeGreaterThan(0);
    expect(memoryFootprint(null).metric).toBe("rss");
  });
});
