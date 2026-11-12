/**
 * When a solver generation is recycled and what its failures cost: the
 * footprint and solve-count thresholds, the abnormal exits that use up the
 * restart budget, the fail-fast window that follows, and the bound on the
 * solves that may wait. The dispatcher runs over an in-memory transport and a
 * manual clock; one scenario kills a real solver process.
 */
import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  ABNORMAL_EXIT_WINDOW_MS, MAX_ABNORMAL_EXITS, QUEUE_FULL_RETRY_AFTER_MS,
  createCaptchaSolver,
  type CaptchaSolver, type SolverCapState, type SolverChannelEvents, type SolverClock, type SolverHostMessage, type SolverTransport,
} from "./captcha-solver.js";
import { CaptchaTokenPool } from "./captcha-pool.js";
import { CaptchaSdkError, CaptchaSolverUnavailableError, classifyCaptchaError } from "./captcha-token.js";

const param = (label: string) => Buffer.from(JSON.stringify({
  certifyId: label, sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
})).toString("base64");
const certifyId = (token: string) => JSON.parse(Buffer.from(token, "base64").toString()).certifyId;

type Solve = Extract<SolverHostMessage, { type: "solve" }>;
interface FakeGeneration { events: SolverChannelEvents; solves: Solve[]; terminated: boolean }

/**
 * In-memory solver generations under a 300 MB cap (or none). A scene decides
 * the answer: "ok" a token, "mem:<footprint>:<heap>" a token with that memory
 * report, "fail" a failed solve, "crash" an exit, "error" a transport error,
 * "fatal" a fatal message, "hang" nothing at all.
 */
function memoryTransport(cap: SolverCapState | null = { capMB: 300, enforcement: "cgroup" }) {
  const generations: FakeGeneration[] = [];
  let refuseSpawn = false;
  const transport: SolverTransport = {
    ...(cap ? { cap: () => cap } : {}),
    spawn(events) {
      if (refuseSpawn) { refuseSpawn = false; throw new Error("spawn refused"); }
      const gen: FakeGeneration = { events, solves: [], terminated: false };
      generations.push(gen);
      return {
        post(msg) {
          if (msg.type !== "solve") return;
          gen.solves.push(msg);
          queueMicrotask(() => {
            const [kind, footprint, heap] = msg.scene.split(":");
            const memory = { heapUsedMB: Number(heap ?? 12), ...(footprint ? { footprintMB: Number(footprint) } : {}) };
            if (kind === "ok" || kind === "mem") events.message({ type: "result", id: msg.id, ok: true, param: param(msg.scene), ...memory, scripts: null });
            else if (kind === "fail") events.message({ type: "result", id: msg.id, ok: false, error: { category: "other", message: "captcha SDK failure" }, ...memory });
            else if (kind === "crash") events.exit();
            else if (kind === "error") events.error();
            else if (kind === "fatal") events.message({ type: "fatal", name: "TypeError" });
          });
        },
        terminate() { gen.terminated = true; },
      };
    },
  };
  return { transport, generations, refuseNextSpawn: () => { refuseSpawn = true; } };
}

/** A manual clock for the dispatcher's timers and its time. */
function manualClock() {
  let now = 1_000_000;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SolverClock = {
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { at: now + ms, fn }); return { id, unref() {} }; },
    clearTimeout(timer) { timers.delete((timer as { id: number } | null)?.id ?? -1); },
    now: () => now,
  };
  return {
    clock,
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= now && timers.delete(id)) timer.fn();
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function dispatcher(cap?: SolverCapState | null) {
  const fake = memoryTransport(cap);
  const time = manualClock();
  const lines: string[] = [];
  const solver = createCaptchaSolver({ transport: fake.transport, clock: time.clock, writeLog: (line) => lines.push(line) });
  return { solver, ...fake, time, lines };
}

/** One abnormal exit of each kind the budget counts. */
const ABNORMAL: Record<string, (d: ReturnType<typeof dispatcher>) => Promise<void>> = {
  "a crash": async ({ solver }) => { await solver.run("crash", "r", "p").catch(() => {}); },
  "a transport error": async ({ solver }) => { await solver.run("error", "r", "p").catch(() => {}); },
  "a fatal error": async ({ solver }) => { await solver.run("fatal", "r", "p").catch(() => {}); },
  "a deadline kill": async ({ solver, time }) => {
    const hung = solver.run("hang", "r", "p").catch(() => {});
    await settled();
    time.advance(90_000);
    await hung;
  },
  "a generation that cannot start": async ({ solver, refuseNextSpawn }) => {
    solver.requestRecycle("request");
    refuseNextSpawn();
    await solver.run("ok", "r", "p").catch(() => {});
  },
};

describe("solver recycle triggers", () => {
  it("recycles a capped generation once its footprint reaches 80 % of the cap, and not below", async () => {
    const { solver, generations } = dispatcher();
    await solver.run("mem:239", "r", "p");
    expect(solver.stats()).toMatchObject({ recycles: 0, alive: true, lastFootprintMB: 239 });
    await solver.run("mem:241", "r", "p");
    expect(solver.stats()).toMatchObject({ recycles: 1, lastRecycleReason: "footprint", alive: false, lastFootprintMB: 241 });
    expect(generations[0]!.terminated).toBe(true);
    // The threshold itself recycles too.
    await solver.run("mem:240", "r", "p");
    expect(solver.stats()).toMatchObject({ recycles: 2, lastRecycleReason: "footprint", generation: 2 });
  });

  it("follows the cap: 80 % of 512 MB is 410 MB", async () => {
    const { solver } = dispatcher({ capMB: 512, enforcement: "sampling" });
    await solver.run("mem:409", "r", "p");
    expect(solver.stats().recycles).toBe(0);
    await solver.run("mem:410", "r", "p");
    expect(solver.stats()).toMatchObject({ recycles: 1, lastRecycleReason: "footprint" });
  });

  it("does not use the heap threshold under a cap: the footprint decides there", async () => {
    const { solver } = dispatcher();
    await solver.run("mem:100:900", "r", "p");
    expect(solver.stats().recycles).toBe(0);
  });

  it("keeps the heap threshold for a generation without a cap, where no footprint counts", async () => {
    for (const cap of [null, { capMB: null, enforcement: "none" } as SolverCapState]) {
      const { solver } = dispatcher(cap);
      await solver.run("mem:900:768", "r", "p");
      expect(solver.stats().recycles).toBe(0);
      await solver.run("mem:900:769", "r", "p");
      expect(solver.stats()).toMatchObject({ recycles: 1, lastRecycleReason: "heap" });
    }
  });

  it("recycles after 100 solves as a backstop, and not after 99", async () => {
    const { solver, generations } = dispatcher();
    for (let i = 0; i < 99; i++) await solver.run("ok", "r", "p");
    expect(solver.stats()).toMatchObject({ recycles: 0, solvesSinceSpawn: 99, alive: true });
    await solver.run("ok", "r", "p");
    expect(solver.stats()).toMatchObject({ recycles: 1, lastRecycleReason: "solves", alive: false });
    await solver.run("ok", "r", "p");
    expect(generations).toHaveLength(2);
  });

  it("never counts a planned recycle as an abnormal exit: footprint, solve count, failures, request, idle, shutdown", async () => {
    const { solver, time } = dispatcher();
    const reasons: Array<string | null> = [];
    const note = () => reasons.push(solver.stats().lastRecycleReason);

    await solver.run("mem:290", "r", "p"); note();
    solver.configure({ recycleAfterSolves: 1 });
    await solver.run("ok", "r", "p"); note();
    solver.configure({ recycleAfterSolves: 100 });
    for (let i = 0; i < 3; i++) await solver.run("fail", "r", "p").catch(() => {});
    note();
    await solver.run("ok", "r", "p");
    solver.requestRecycle("request"); note();
    await solver.run("ok", "r", "p");
    await settled();
    time.advance(10 * 60_000); note();
    await solver.run("ok", "r", "p");
    solver.shutdown(); note();

    expect(reasons).toEqual(["footprint", "solves", "failures", "request", "idle", "shutdown"]);
    expect(solver.stats()).toMatchObject({ recycles: 6, abnormalExits: 0, failFast: false, failFastUntil: null, shedSolves: 0 });
  });
});

describe("solver failures", () => {
  it("a crash fails only the solve in flight, with the existing error; the queued solve runs on the next generation and nothing runs twice", async () => {
    const { solver, generations } = dispatcher();
    const crashed = solver.run("crash", "r", "p");
    const queued = solver.run("ok", "r", "p");
    const failure = await crashed.catch((err) => err);
    expect(failure).toBeInstanceOf(CaptchaSdkError);
    expect(failure).not.toBeInstanceOf(CaptchaSolverUnavailableError);
    expect([failure.message, classifyCaptchaError(failure)]).toEqual(["captcha solver worker exited unexpectedly", "other"]);
    expect(certifyId(await queued)).toBe("ok");
    // Every solve reached a generation exactly once.
    expect(generations.map((gen) => gen.solves.map((solve) => `${solve.id}:${solve.scene}`))).toEqual([["1:crash"], ["2:ok"]]);
    expect(solver.stats()).toMatchObject({ generation: 2, totalSolves: 1, totalFailures: 1, abnormalExits: 1, failFast: false });
  });

  for (const [name, exit] of Object.entries(ABNORMAL)) {
    it(`counts ${name} as an abnormal exit and keeps solving`, async () => {
      const d = dispatcher();
      await exit(d);
      expect(d.solver.stats()).toMatchObject({ abnormalExits: 1, failFast: false });
      expect(certifyId(await d.solver.run("ok", "r", "p"))).toBe("ok");
    });
  }

  it("lets 5 abnormal exits in 10 minutes restart the solver; the next one starts the fail-fast window", async () => {
    const d = dispatcher();
    const { solver, generations, time, lines } = d;
    // One of each kind, about a minute apart: the restart budget is used up, solves still run.
    const exitAt: number[] = [];
    for (const exit of Object.values(ABNORMAL)) {
      await exit(d);
      exitAt.push(time.now());
      time.advance(60_000);
    }
    expect(MAX_ABNORMAL_EXITS).toBe(5);
    expect(solver.stats()).toMatchObject({ abnormalExits: 5, failFast: false, failFastUntil: null });
    expect(certifyId(await solver.run("ok", "r", "p"))).toBe("ok");
    expect(lines).toEqual([]);
    const generationsBefore = generations.length;
    // The window reopens when the oldest of the six exits is 10 minutes old.
    const reopensAt = exitAt[0]! + ABNORMAL_EXIT_WINDOW_MS;
    const wait = reopensAt - time.now();
    expect(wait).toBeGreaterThan(180_000);

    // The sixth, with one solve queued behind it.
    const crashed = solver.run("crash", "r", "p");
    const queued = solver.run("ok", "r", "p");
    expect((await crashed.catch((err) => err)).message).toBe("captcha solver worker exited unexpectedly");
    const refused = await queued.catch((err) => err);
    expect(refused).toBeInstanceOf(CaptchaSolverUnavailableError);
    expect([refused.reason, refused.category, refused.retryAfterMs]).toEqual(["fail-fast", "other", wait]);
    expect(solver.stats()).toMatchObject({ abnormalExits: 6, failFast: true, failFastUntil: reopensAt, alive: false, queueDepth: 0 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^\\S+ ERROR solver solver fail-fast: too many abnormal solver exits; solves are refused until the window reopens abnormalExits=6 windowMin=10 retryAfterS=${Math.ceil(wait / 1000)}$`));

    // Inside the window nothing is started and the wait shrinks with the clock.
    time.advance(120_000);
    const later = await solver.run("ok", "r", "p").catch((err) => err);
    expect([later.reason, later.retryAfterMs]).toEqual(["fail-fast", wait - 120_000]);
    expect(generations).toHaveLength(generationsBefore);
    expect(solver.stats().shedSolves).toBe(2);

    time.advance(wait - 120_000 - 1);
    expect((await solver.run("ok", "r", "p").catch((err) => err)).retryAfterMs).toBe(1);
    time.advance(1);
    expect(certifyId(await solver.run("ok", "r", "p"))).toBe("ok");
    expect(solver.stats()).toMatchObject({ failFast: false, failFastUntil: null, abnormalExits: 5 });

    // Five exits are still inside the window: one more closes it again, until the next oldest has aged out.
    await solver.run("crash", "r", "p").catch(() => {});
    expect(solver.stats()).toMatchObject({ failFast: true, failFastUntil: exitAt[1]! + ABNORMAL_EXIT_WINDOW_MS });
    solver.shutdown();
  });

  it("forgets abnormal exits older than 10 minutes: a slow trickle never fails fast", async () => {
    const d = dispatcher();
    for (let i = 0; i < 12; i++) {
      await d.solver.run("crash", "r", "p").catch(() => {});
      d.time.advance(ABNORMAL_EXIT_WINDOW_MS / 5);
    }
    expect(d.solver.stats()).toMatchObject({ failFast: false, shedSolves: 0 });
    expect(certifyId(await d.solver.run("ok", "r", "p"))).toBe("ok");
  });
});

describe("solver queue bound", () => {
  it("lets 64 solves wait behind the one in flight and refuses the next with a retry time", async () => {
    const { solver, generations, time } = dispatcher();
    const hung = solver.run("hang", "r", "p").catch((err) => err);
    const waiting = Array.from({ length: 64 }, () => solver.run("ok", "r", "p"));
    expect(solver.stats()).toMatchObject({ busy: true, queueDepth: 64, shedSolves: 0 });

    const refused = await solver.run("ok", "r", "p").catch((err) => err);
    expect(refused).toBeInstanceOf(CaptchaSolverUnavailableError);
    expect([refused.reason, refused.retryAfterMs, refused.category]).toEqual(["queue-full", QUEUE_FULL_RETRY_AFTER_MS, "other"]);
    expect(solver.stats()).toMatchObject({ queueDepth: 64, shedSolves: 1 });

    // The queue drains once the solve in flight is over; the refused solve never ran.
    await settled();
    time.advance(90_000);
    expect((await hung).message).toBe("captcha solver deadline exceeded");
    expect((await Promise.all(waiting)).map(certifyId)).toEqual(Array(64).fill("ok"));
    expect(generations.flatMap((gen) => gen.solves)).toHaveLength(65);
    solver.shutdown();
  });

  it("is needed: the token pool sends every empty-pool take to the solver at once", async () => {
    // What makes the bound the solver's own: nothing above it limits how
    // many takes may wait on an empty pool.
    let running = 0;
    const release: Array<(token: string) => void> = [];
    const solver = {
      run: () => { running += 1; return new Promise<string>((resolve) => release.push(resolve)); },
      stats: () => ({}) as ReturnType<CaptchaSolver["stats"]>,
      requestRecycle: () => {},
      concurrency: () => 1,
    };
    const pool = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, refillIntervalMs: 60_000 }, solver);
    const takes = Array.from({ length: 12 }, () => pool.takeToken({ enabled: true, prefix: "p", sceneId: "s", region: "r" }));
    await settled();
    expect(running).toBeGreaterThanOrEqual(12);
    release.forEach((resolve, i) => resolve(param(`take-${i}`)));
    await Promise.all(takes);
    pool.stopBackgroundRefill();
  });
});

describe("a refused solve in the token pool", () => {
  it("reaches the caller at once as the solver's own error: no retry chain, no grace wait, no storm", async () => {
    let calls = 0;
    const refusal = new CaptchaSolverUnavailableError("fail-fast", 123_000);
    const solver = {
      run: () => { calls += 1; return Promise.reject(refusal); },
      stats: () => ({}) as ReturnType<CaptchaSolver["stats"]>,
      requestRecycle: () => {},
      concurrency: () => 1,
    };
    const pool = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, refillIntervalMs: 60_000, solveRetries: 4 }, solver);
    const cfg = { enabled: true, prefix: "p", sceneId: "s", region: "r" };
    for (let i = 0; i < 8; i++) {
      const started = Date.now();
      expect(await pool.takeToken(cfg).catch((err) => err)).toBe(refusal);
      expect(Date.now() - started).toBeLessThan(1000);
    }
    await settled();
    // One solve per take and per urgent refill that follows it, never a chain of four.
    expect(calls).toBeLessThanOrEqual(16);
    expect(pool.stats().storm).toBe(false);
    pool.stopBackgroundRefill();
  });
});

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;

describe("a killed solver process", () => {
  it("fails only the solve it was running; the queued solve completes in a new process and the killed solve is not run again", async () => {
    const child = Bun.spawn([process.execPath, "--eval", `
      import * as solver from ${JSON.stringify(solverPath)};
      const label = token => JSON.parse(Buffer.from(token, 'base64').toString()).certifyId;
      const watchdog = setTimeout(() => { console.error('scenario timed out'); process.exit(1); }, 20000);
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule: ${JSON.stringify(fixtureUrl)}, idleMs: 2000 });
      const first = Number(label(await s.run('pid', 'sgp', 'p')).slice(4));
      const running = s.run('slow:1500', 'sgp', 'p').then(() => 'solved', err => [err.name, err.message]);
      const queued = s.run('pid', 'sgp', 'p');
      await new Promise(resolve => setTimeout(resolve, 300));
      process.kill(first, 'SIGKILL');
      const outcome = await running;
      const second = Number(label(await queued).slice(4));
      // Had the killed solve been handed to the new process, it would finish now.
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('REPORT ' + JSON.stringify({ first, second, outcome, stats: s.stats() }));
      s.shutdown();
      clearTimeout(watchdog);
    `], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0" } });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    const { first, second, outcome, stats } = JSON.parse(stdout.split("\n").find((line) => line.startsWith("REPORT "))!.slice(7));
    expect(outcome).toEqual(["CaptchaSdkError", "captcha solver worker exited unexpectedly"]);
    expect(second).not.toBe(first);
    expect(stats).toMatchObject({ generation: 2, totalSolves: 2, totalFailures: 1, abnormalExits: 1, failFast: false, lastRecycleReason: "exit", busy: false, queueDepth: 0 });
  }, 30_000);
});
