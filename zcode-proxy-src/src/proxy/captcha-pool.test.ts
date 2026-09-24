import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const solveMock = mock(async (_scene: string, _region: string, _prefix: string, _beforeSolve?: () => void) => {
  return "x".repeat(64);
});

const recycleMock = mock((_reason: string) => {});

mock.module("./captcha-solver.js", () => ({
  runCaptchaSolve: solveMock,
  shutdownCaptchaSolver: () => {},
  captchaSolverConcurrency: () => 2,
  getCaptchaSolverStats: () => ({
    mode: "worker",
    alive: false,
    busy: false,
    queueDepth: 0,
    generation: 0,
    solvesSinceSpawn: 0,
    totalSolves: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    deadlineKills: 0,
    recycles: 0,
    lastRecycleReason: null,
    lastRecycleAt: null,
    lastSdkScripts: null,
  }),
  requestCaptchaSolverRecycle: recycleMock,
  CAPTCHA_NODE_DIR: "/tmp",
}));

const { CaptchaTokenPool } = await import("./captcha-pool.js");

const CFG = {
  enabled: true,
  prefix: "no8xfe",
  sceneId: "11xygtvd",
  region: "sgp",
};

let pool: InstanceType<typeof CaptchaTokenPool>;

describe("CaptchaTokenPool", () => {
  beforeEach(() => {
    process.env.ZCODE_CAPTCHA_SKIP_DEPS = "1";
    solveMock.mockClear();
    pool = new CaptchaTokenPool({
      poolSizeMin: 3,
      poolSizeMax: 3,
      tokenTtlMs: 60_000,
      refillIntervalMs: 60_000,
      staggerMs: 0,
      solveRetries: 1,
      solveConcurrency: 2,
      scaleDownIdleMs: 60_000,
    });
  });

  afterEach(() => {
    delete process.env.ZCODE_CAPTCHA_SKIP_DEPS;
    pool.stopBackgroundRefill();
  });

  it("prefill adds tokens without consuming on take", async () => {
    await pool.prefill(CFG, 2);
    expect(pool.stats().ready).toBe(2);
    expect(solveMock).toHaveBeenCalledTimes(2);
  });

  it("takeToken uses prefetched token and triggers background refill", async () => {
    await pool.prefill(CFG, 2);
    solveMock.mockClear();

    const param = await pool.takeToken(CFG);
    expect(param.length).toBeGreaterThan(20);
    expect(pool.stats().ready).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(solveMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("concurrent takes use parallel solves when pool is empty", async () => {
    const [a, b] = await Promise.all([pool.takeToken(CFG), pool.takeToken(CFG)]);
    expect(a.length).toBeGreaterThan(20);
    expect(b.length).toBeGreaterThan(20);
    expect(solveMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('provider rate limits stop retries and enforce cooldown even without a callback', async () => {
    const limited = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, solveRetries: 4, solveConcurrency: 1, emptyTakeRace: 1 });
    solveMock.mockImplementation(async () => { throw new Error('HTTP 429 too many requests'); });
    try {
      await expect(limited.takeToken(CFG)).rejects.toThrow(/captcha failed/);
      expect(solveMock).toHaveBeenCalledTimes(1);
      await expect(limited.takeToken(CFG)).rejects.toThrow(/paused/);
      expect(solveMock).toHaveBeenCalledTimes(1);
    } finally {
      limited.stopBackgroundRefill();
      solveMock.mockImplementation(async () => 'x'.repeat(64));
    }
  });

  it('diagnostic hashes cannot pause ordinary solver failures', async () => {
    const limited = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, solveRetries: 1, solveConcurrency: 1, emptyTakeRace: 1 });
    solveMock.mockImplementation(async () => { throw new Error('captcha solve stall | captchaMetadata={"sha256":"a429bf008"}'); });
    try {
      // Prefill surfaces the failed mint without the independent empty-take grace wait.
      await limited.prefill(CFG);
      expect(solveMock).toHaveBeenCalledTimes(1);
      solveMock.mockImplementation(async () => 'x'.repeat(64));
      expect(await limited.takeToken(CFG)).toBe('x'.repeat(64));
    } finally { limited.stopBackgroundRefill(); solveMock.mockImplementation(async () => 'x'.repeat(64)); }
  });

  it("prefill stops after a failed batch exhausts its retry budget", async () => {
    const limited = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, solveRetries: 2, solveConcurrency: 1 });
    solveMock.mockImplementation(async () => { throw new Error("synthetic solve failure"); });
    try {
      await limited.prefill(CFG);
      expect(solveMock).toHaveBeenCalledTimes(2);
      expect(limited.stats().ready).toBe(0);
      expect(limited.stats().activeSolves).toBe(0);
    } finally {
      limited.stopBackgroundRefill();
      solveMock.mockImplementation(async () => "x".repeat(64));
    }
  });

  it("invalidate clears the pool", async () => {
    await pool.prefill(CFG, 2);
    pool.invalidate();
    expect(pool.stats().ready).toBe(0);
  });

  it("pushToken rejects duplicate certifyId", async () => {
    const payload = Buffer.from(
      JSON.stringify({ certifyId: "dup-test-id", sceneId: "11xygtvd", isSign: true, securityToken: "x" }),
    ).toString("base64");
    const poolAny = pool as unknown as {
      pushToken: (p: string) => void;
      stats: () => { ready: number };
    };
    poolAny.pushToken(payload);
    poolAny.pushToken(payload);
    expect(poolAny.stats().ready).toBe(1);
  });

  it("takeToken prefers newest token (LIFO)", async () => {
    let n = 0;
    solveMock.mockImplementation(async () => {
      n += 1;
      return `token-${n}:${"x".repeat(48)}`;
    });
    await pool.prefill(CFG, 3);
    solveMock.mockClear();

    const taken = await pool.takeToken(CFG);
    expect(taken.startsWith("token-3:")).toBe(true);
  });
});

describe("CaptchaTokenPool deep idle", () => {
  beforeEach(() => {
    process.env.ZCODE_CAPTCHA_SKIP_DEPS = "1";
    solveMock.mockClear();
  });
  afterEach(() => {
    delete process.env.ZCODE_CAPTCHA_SKIP_DEPS;
    pool?.stopBackgroundRefill?.();
  });

  it("decays target to idleFloor after sustained zero traffic", async () => {
    pool = new CaptchaTokenPool({
      poolSizeMin: 5,
      poolSizeMax: 10,
      idleFloor: 1,
      tokenTtlMs: 60_000,
      refillIntervalMs: 60_000,
      solveRetries: 1,
      solveConcurrency: 1,
      scaleDownIdleMs: 60_000,
    });
    await pool.prefill(CFG, 5);
    expect(pool.stats().target).toBe(5);
    // Simulate 61s of idle: lastTakeAt far in the past.
    const p = pool as unknown as { lastTakeAt: number };
    p.lastTakeAt = Date.now() - 61_000;
    const decayed = pool as unknown as { maybeScaleDown: () => void; applyGovernorCaps: () => void };
    decayed.maybeScaleDown();
    decayed.applyGovernorCaps();
    expect(pool.stats().target).toBeLessThanOrEqual(1);
    expect(pool.stats().ready).toBeLessThanOrEqual(1);
  });

  it("restores full floor on the next token take", async () => {
    pool = new CaptchaTokenPool({
      poolSizeMin: 5,
      poolSizeMax: 10,
      idleFloor: 1,
      tokenTtlMs: 60_000,
      refillIntervalMs: 60_000,
      solveRetries: 1,
      solveConcurrency: 1,
      scaleDownIdleMs: 60_000,
    });
    await pool.prefill(CFG, 5);
    const p = pool as unknown as { lastTakeAt: number };
    p.lastTakeAt = Date.now() - 61_000;
    const decayed = pool as unknown as { maybeScaleDown: () => void };
    decayed.maybeScaleDown();
    expect(pool.stats().target).toBeLessThanOrEqual(1);
    await pool.takeToken(CFG);
    expect(pool.stats().target).toBe(5);
  });

  it("decays floor to 0 after deepIdleAfterMs (no background mints)", async () => {
    pool = new CaptchaTokenPool({
      poolSizeMin: 5,
      poolSizeMax: 10,
      idleFloor: 1,
      deepIdleAfterMs: 120_000,
      tokenTtlMs: 60_000,
      refillIntervalMs: 60_000,
      solveRetries: 1,
      solveConcurrency: 1,
      scaleDownIdleMs: 60_000,
    });
    await pool.prefill(CFG, 5);
    const p = pool as unknown as { lastTakeAt: number };
    // Past scaleDownIdleMs but before deepIdleAfterMs → keeper floor.
    p.lastTakeAt = Date.now() - 61_000;
    let decayed = pool as unknown as { maybeScaleDown: () => void };
    decayed.maybeScaleDown();
    expect(pool.stats().target).toBe(1);
    // Past deepIdleAfterMs → floor 0.
    p.lastTakeAt = Date.now() - 121_000;
    decayed.maybeScaleDown();
    expect(pool.stats().target).toBe(0);
  });

  it("keeps one banked token through decay for instant wake-up serves", async () => {
    pool = new CaptchaTokenPool({
      poolSizeMin: 5,
      poolSizeMax: 10,
      idleFloor: 0,
      deepIdleAfterMs: 120_000,
      tokenTtlMs: 60_000,
      refillIntervalMs: 60_000,
      solveRetries: 1,
      solveConcurrency: 1,
      scaleDownIdleMs: 60_000,
    });
    await pool.prefill(CFG, 5);
    const p = pool as unknown as { lastTakeAt: number };
    p.lastTakeAt = Date.now() - 121_000;
    const decayed = pool as unknown as { maybeScaleDown: () => void };
    decayed.maybeScaleDown();
    // Target is 0 but the last banked token survives trimming.
    expect(pool.stats().target).toBe(0);
    expect(pool.stats().ready).toBe(1);
    // …and a take right after deep idle still gets served instantly.
    solveMock.mockClear();
    const param = await pool.takeToken(CFG);
    expect(param.length).toBeGreaterThan(20);
  });

  it("races parallel solves on an empty-pool take and banks extras", async () => {
    pool = new CaptchaTokenPool({
      poolSizeMin: 2,
      poolSizeMax: 10,
      emptyTakeRace: 3,
      tokenTtlMs: 60_000,
      refillIntervalMs: 60_000,
      staggerMs: 0,
      solveRetries: 1,
      solveConcurrency: 4,
      scaleDownIdleMs: 60_000,
    });
    let n = 0;
    let active = 0;
    let peak = 0;
    solveMock.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      n += 1;
      return `race-token-${n}:${"y".repeat(48)}`;
    });
    const param = await pool.takeToken(CFG);
    expect(param).toContain("race-token-");
    // Racers overlap: peak concurrent solves equals the race width instead
    // of stacking sequentially.
    expect(peak).toBe(3);
    // Extra successes are banked into the pool once they settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(pool.stats().ready).toBeGreaterThanOrEqual(2);
  });

  it("grace-waits for refill when all raced solves fail before surfacing the error", async () => {
    process.env.CAPTCHA_TAKE_GRACE_MS = "1500";
    try {
      pool = new CaptchaTokenPool({
        poolSizeMin: 1,
        poolSizeMax: 10,
        emptyTakeRace: 2,
        tokenTtlMs: 60_000,
        refillIntervalMs: 60_000,
        staggerMs: 0,
        solveRetries: 1,
        solveConcurrency: 4,
        scaleDownIdleMs: 600_000,
        deepIdleAfterMs: 600_000,
      });
      // Every solve fails at first — a full storm.
      solveMock.mockImplementation(async () => {
        throw new Error("captcha solve stall pe=pe.099.storm.js");
      });
      const takePromise = pool.takeToken(CFG);
      // Mid-storm, a refill wave succeeds and banks a token.
      const pushTimer = setTimeout(() => {
        const p = pool as unknown as { pushToken: (s: string) => void };
        p.pushToken(`storm-rescue:${"g".repeat(48)}`);
      }, 400);
      const param = await takePromise;
      clearTimeout(pushTimer);
      expect(param).toContain("storm-rescue");
    } finally {
      delete process.env.CAPTCHA_TAKE_GRACE_MS;
    }
  });
});

describe("CaptchaTokenPool mint-storm breaker", () => {
  let clock = 0;
  // Refill/probe mints are fire-and-forget; one macrotask lets the mocked
  // (microtask-only) solve settle. Breaker time itself is the injected clock.
  const tick = () => Bun.sleep(0);
  const fail = async () => { throw new Error("captcha solve stall pe=storm.js"); };

  function stormPool(): InstanceType<typeof CaptchaTokenPool> {
    return new CaptchaTokenPool({
      poolSizeMin: 1,
      poolSizeMax: 1,
      tokenTtlMs: 60_000,
      refillIntervalMs: 600_000,
      staggerMs: 0,
      solveRetries: 1,
      solveConcurrency: 1,
      emptyTakeRace: 1,
      scaleDownIdleMs: 600_000,
      deepIdleAfterMs: 600_000,
      now: () => clock,
    });
  }

  /** Each prefill runs exactly one failing single-attempt mint. */
  async function failMints(target: InstanceType<typeof CaptchaTokenPool>, n: number): Promise<void> {
    for (let i = 0; i < n; i++) await target.prefill(CFG);
  }

  beforeEach(() => {
    clock = 1_000_000;
    solveMock.mockClear();
    recycleMock.mockClear();
  });
  afterEach(() => {
    pool?.stopBackgroundRefill?.();
    solveMock.mockImplementation(async () => "x".repeat(64));
  });

  it("reports a success rate of 1 before any mint and stays out of storm below the attempt floor", async () => {
    pool = stormPool();
    expect(pool.stats().mintSuccessRate10m).toBe(1);
    expect(pool.stats().storm).toBe(false);
    solveMock.mockImplementation(fail);
    await failMints(pool, 4);
    expect(pool.stats().storm).toBe(false);
    expect(pool.stats().mintSuccessRate10m).toBe(0);
    expect(recycleMock).not.toHaveBeenCalled();
  });

  it("does not enter storm at exactly 20% success", async () => {
    pool = stormPool();
    await pool.prefill(CFG); // one success
    pool.invalidate();
    solveMock.mockImplementation(fail);
    await failMints(pool, 4);
    expect(pool.stats().mintSuccessRate10m).toBeCloseTo(0.2);
    expect(pool.stats().storm).toBe(false);
    // The next failure drops the rate below 20% over ≥5 attempts.
    await failMints(pool, 1);
    expect(pool.stats().storm).toBe(true);
  });

  it("enters storm, recycles the solver once, and fails empty-pool takes fast", async () => {
    pool = stormPool();
    solveMock.mockImplementation(fail);
    await failMints(pool, 5);
    expect(pool.stats().storm).toBe(true);
    expect(recycleMock).toHaveBeenCalledTimes(1);
    expect(recycleMock.mock.calls[0]![0]).toBe("storm");

    const calls = solveMock.mock.calls.length;
    const started = Date.now();
    await expect(pool.takeToken(CFG)).rejects.toThrow("captcha minting degraded (storm) — retry later");
    expect(Date.now() - started).toBeLessThan(500);
    // Background refill stays paused during the backoff.
    pool.requestUrgentRefill();
    await pool.prefill(CFG);
    await tick();
    expect(solveMock.mock.calls.length).toBe(calls);
    expect(recycleMock).toHaveBeenCalledTimes(1);
  });

  it("still serves cached tokens during a storm", async () => {
    pool = stormPool();
    solveMock.mockImplementation(fail);
    await failMints(pool, 5);
    (pool as unknown as { pushToken: (p: string) => void }).pushToken(`cached:${"c".repeat(48)}`);
    expect(await pool.takeToken(CFG)).toContain("cached:");
  });

  it("probes once per backoff, doubling the backoff up to 600 s after failed probes", async () => {
    pool = stormPool();
    solveMock.mockImplementation(fail);
    await failMints(pool, 5);
    const probesAfter = async (advanceMs: number): Promise<number> => {
      const before = solveMock.mock.calls.length;
      clock += advanceMs;
      pool.requestUrgentRefill();
      await tick();
      pool.requestUrgentRefill();
      await tick();
      return solveMock.mock.calls.length - before;
    };
    expect(await probesAfter(59_000)).toBe(0);
    expect(await probesAfter(1_000)).toBe(1); // 60 s backoff elapsed → one probe, fails
    for (const backoff of [120_000, 240_000, 480_000, 600_000, 600_000]) {
      expect(await probesAfter(backoff - 1_000)).toBe(0);
      expect(await probesAfter(1_000)).toBe(1);
    }
    expect(pool.stats().storm).toBe(true);
    await expect(pool.takeToken(CFG)).rejects.toThrow(/degraded \(storm\)/);
  });

  it("exits the storm on a successful probe and resets the window", async () => {
    pool = stormPool();
    solveMock.mockImplementation(fail);
    await failMints(pool, 5);
    solveMock.mockImplementation(async () => `probe:${"p".repeat(48)}`);
    clock += 60_000;
    pool.requestUrgentRefill();
    await tick();
    const stats = pool.stats();
    expect(stats.storm).toBe(false);
    expect(stats.mintSuccessRate10m).toBe(1);
    expect(stats.ready).toBe(1);
    expect(await pool.takeToken(CFG)).toContain("probe:");
    // The take's refill mints one more success (window: 1 ok).
    await tick();
    pool.invalidate();
    // A fresh episode needs a fresh run of failures, then recycles again.
    solveMock.mockImplementation(fail);
    await failMints(pool, 4);
    expect(pool.stats().storm).toBe(false);
    await failMints(pool, 1);
    expect(pool.stats().storm).toBe(true);
    expect(recycleMock).toHaveBeenCalledTimes(2);
  });

  it("cancels solves already queued behind the one that tripped the storm", async () => {
    pool = new CaptchaTokenPool({
      poolSizeMin: 6,
      poolSizeMax: 6,
      tokenTtlMs: 60_000,
      refillIntervalMs: 600_000,
      staggerMs: 0,
      solveRetries: 1,
      solveConcurrency: 6,
      // With the default CPU governor prefill starts at one solve per wave and
      // stops after that wave fails, so only one mint would run. This
      // scenario needs all six solves queued at once behind the serial solver.
      cpuLimitPercent: 0,
      scaleDownIdleMs: 600_000,
      deepIdleAfterMs: 600_000,
      now: () => clock,
    });
    // Serial queue like the real solver: admission (beforeSolve) runs when a
    // queued solve reaches the front, after earlier solves settled.
    let queue: Promise<unknown> = Promise.resolve();
    let executed = 0;
    solveMock.mockImplementation((_s, _r, _p, beforeSolve) => {
      const run = queue.then(async () => {
        beforeSolve?.();
        executed += 1;
        throw new Error("captcha solve stall pe=storm.js");
      });
      queue = run.catch(() => {});
      return run;
    });
    await pool.prefill(CFG, 6);
    expect(pool.stats().storm).toBe(true);
    // The 6th queued solve was cancelled at admission and is not a mint.
    expect(executed).toBe(5);
    expect((pool as unknown as { mintOutcomes: unknown[] }).mintOutcomes).toHaveLength(5);
    expect(pool.stats().activeSolves).toBe(0);
  });

  it("counts a returned duplicate certifyId as a failed mint", async () => {
    pool = stormPool();
    const param = Buffer.from(JSON.stringify({ certifyId: "dup-storm", sceneId: "s" })).toString("base64");
    solveMock.mockImplementation(async () => param);
    await pool.prefill(CFG);
    expect(await pool.takeToken(CFG)).toBe(param);
    // The take's refill mints the same certifyId again → rejected as duplicate.
    await tick();
    expect(pool.stats().ready).toBe(0);
    expect(pool.stats().mintSuccessRate10m).toBe(0.5);
  });

  it("forgets outcomes older than 10 minutes", async () => {
    pool = stormPool();
    solveMock.mockImplementation(fail);
    await failMints(pool, 4);
    clock += 600_001;
    expect(pool.stats().mintSuccessRate10m).toBe(1);
    await failMints(pool, 4);
    expect(pool.stats().storm).toBe(false);
  });
});
