import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const happyPath = fileURLToPath(new URL("./captcha-happy.ts", import.meta.url));
const poolPath = fileURLToPath(new URL("./captcha-pool.ts", import.meta.url));
const captchaPath = fileURLToPath(new URL("./captcha.ts", import.meta.url));
const happyDomPath = fileURLToPath(new URL("../../node_modules/happy-dom/lib/index.js", import.meta.url));

// Replace only resource delivery, not solveTraceless, destroyDom, or the real
// happy-dom close/frame/task-manager implementation. Each child gets fresh
// globals and module state, including the fail-closed cleanup admission gate.
const realDomFixture = `
  const happyDom = await import(${JSON.stringify(happyDomPath)});
  const { GlobalWindow, PropertySymbol } = happyDom;
  const windows = [];
  const entered = [];
  const unhandled = [];
  process.on("unhandledRejection", error => unhandled.push(error));
  const watchdog = setTimeout(() => { console.error("DOM scenario timed out"); process.exit(1); }, 4000);
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const param = Buffer.from(JSON.stringify({
    certifyId: "fixture", sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
  })).toString("base64");
  let onWrite = () => {};
  let onSolve = options => options.success({ verifyParam: param });
  class FixtureWindow extends GlobalWindow {
    constructor(options) {
      super(options);
      windows.push(this);
      const write = this.document.write.bind(this.document);
      this.document.write = () => {
        write('<!doctype html><html><body><div id="cap"></div><button id="btn"></button></body></html>');
        onWrite(this);
      };
      this.initAliyunCaptcha = options => { entered.push(options.SceneId); onSolve(options, this); };
    }
  }
  mock.module(${JSON.stringify(happyDomPath)}, () => ({ ...happyDom, GlobalWindow: FixtureWindow }));
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://zcode.z.ai/", "unexpected network request");
    return new Response("");
  };
  const backend = await import(${JSON.stringify(happyPath)});
  const solver = await import(${JSON.stringify(solverPath)});
  const finish = async () => {
    await tick();
    assert.deepEqual(unhandled, [], "close rejection escaped its owner");
    clearTimeout(watchdog);
    console.log("SCENARIO_OK");
    process.exit(0);
  };
`;

// Isolate module mocks from the pool suite's dispatcher mock and the real DOM
// suites. No production injection API and no remote CAPTCHA requests are needed.
async function runIsolated(source: string, overrides: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CAPTCHA_") || key.startsWith("ZCODE_CAPTCHA_")) delete env[key];
  }
  const child = Bun.spawn([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    globalThis.fetch = async () => { throw new Error("unexpected network request"); };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    ${source}
  `], {
    env: { ...env, ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0", ...overrides },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("SCENARIO_OK");
}

describe("in-process CAPTCHA runtime capacity", () => {
  it("holds the dispatcher through real child-frame and parent timer destruction", async () => {
    await runIsolated(realDomFixture + `
      const closing = deferred();
      const release = deferred();
      let frame;
      let parentTicks = 0;
      let closed = false;
      onWrite = w => {
        if (windows.length !== 1) return;
        frame = globalThis.__browserFrame;
        const iframe = w.document.createElement("iframe");
        iframe.srcdoc = "<html><body>offline child</body></html>";
        w.document.getElementById("cap").appendChild(iframe);
        assert.equal(frame.childFrames.length, 1);
        const manager = frame.childFrames[0][PropertySymbol.asyncTaskManager];
        const destroy = manager.destroy.bind(manager);
        manager.destroy = async () => {
          closing.resolve();
          await release.promise;
          await destroy();
        };
        w.setInterval(() => { parentTicks++; }, 1);
        const close = w.happyDOM.close.bind(w.happyDOM);
        w.happyDOM.close = async () => { await close(); closed = true; };
      };
      let firstSettled = false;
      const first = solver.runCaptchaSolve("first", "sgp", "fixture");
      first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
      const second = solver.runCaptchaSolve("second", "sgp", "fixture");
      await closing.promise;
      await Bun.sleep(15);
      assert.deepEqual(entered, ["first"]);
      assert.equal(firstSettled, false);
      assert.equal(closed, false);
      assert(parentTicks > 0, "parent work should remain live during child close");
      assert.equal(globalThis.window, windows[0]);
      assert.equal(globalThis.__browserFrame, frame);
      assert(globalThis.__capGuestScopes[windows[0].__capScopeId]);
      const repeatedClose = backend.destroyDom(windows[0]);
      let repeatedSettled = false;
      repeatedClose.then(() => { repeatedSettled = true; });
      await tick();
      assert.equal(repeatedSettled, false, "repeat close bypassed original child drain");
      onSolve = options => {
        assert.equal(closed, true, "second solve entered before actual page close");
        options.success({ verifyParam: param });
      };
      release.resolve();
      assert.equal(await first, param);
      assert.equal(await repeatedClose, true);
      assert.equal(await second, param);
      assert.deepEqual(entered, ["first", "second"]);
      const ticksAfterClose = parentTicks;
      await Bun.sleep(20);
      assert.equal(parentTicks, ticksAfterClose, "parent timer survived real close");
      assert.equal(globalThis.__browserFrame, null);
      assert.equal(globalThis.__capGuestScopes[windows[0].__capScopeId], undefined);
      await finish();
    `, { ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1" });
  });

  for (const failsDuringSolve of [false, true]) {
    it(`quarantines rejected real-backend cleanup without leaking errors (${failsDuringSolve ? "failed" : "successful"} solve)`, async () => {
      await runIsolated(realDomFixture + `
        let realClose;
        const closing = deferred();
        const release = deferred();
        onWrite = w => {
          realClose = w.happyDOM.close.bind(w.happyDOM);
          w.happyDOM.close = async () => {
            closing.resolve();
            await release.promise;
            throw new Error("PRIVATE_CLOSE_SECRET");
          };
        };
        onSolve = options => {
          if (${failsDuringSolve}) options.onError({ status: 429, message: "PRIVATE_SOLVE_SECRET" });
          else options.success({ verifyParam: param });
        };
        const first = solver.runCaptchaSolve("first", "sgp", "fixture").then(
          () => { throw new Error("expected failure"); }, error => error);
        const second = solver.runCaptchaSolve("second", "sgp", "fixture").then(
          () => { throw new Error("unsafe second solve admitted"); }, error => error);
        await closing.promise;
        await tick();
        assert.deepEqual(entered, ["first"]);
        release.resolve();
        const firstError = await first;
        const secondError = await second;
        if (${failsDuringSolve}) {
          const { classifyCaptchaError } = await import(${JSON.stringify(fileURLToPath(new URL("./captcha-token.ts", import.meta.url)))});
          assert.equal(classifyCaptchaError(firstError), "rate-limit");
        } else assert.match(firstError.message, /cleanup failed/);
        assert.match(secondError.message, /cleanup failed/);
        assert(!String(firstError.stack).includes("PRIVATE"));
        assert(!String(secondError.stack).includes("PRIVATE"));
        assert.equal(firstError.cause, undefined);
        assert.equal(secondError.cause, undefined);
        assert.equal(windows.length, 1, "failed close allowed another DOM allocation");
        assert.equal(globalThis.window, windows[0]);
        assert(globalThis.__capGuestScopes[windows[0].__capScopeId]);
        await assert.rejects(backend.createDom("sgp", "fixture", {
          primeCookies: async () => { throw new Error("unsafe priming admitted"); },
          documentHtml: "<html></html>",
        }), /cleanup failed/);
        // Test-only final disposal; production must not trust a retry of a page
        // which happy-dom already marked closed before a teardown rejection.
        await realClose();
        await finish();
      `, { ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1" });
    });
  }

  it("awaits partial createDom cleanup before the next dispatcher call", async () => {
    await runIsolated(realDomFixture + `
      const original = Object.freeze(new Error("fixture initialization failure"));
      const closing = deferred();
      const release = deferred();
      let closed = false;
      onWrite = w => {
        if (windows.length !== 1) return;
        const close = w.happyDOM.close.bind(w.happyDOM);
        w.happyDOM.close = async () => {
          closing.resolve();
          await release.promise;
          await close();
          closed = true;
        };
        throw original;
      };
      let firstSettled = false;
      const first = solver.runCaptchaSolve("first", "sgp", "fixture").then(
        () => { throw new Error("expected initialization failure"); },
        error => { firstSettled = true; return error; });
      const second = solver.runCaptchaSolve("second", "sgp", "fixture");
      await closing.promise;
      await tick();
      assert.equal(firstSettled, false);
      assert.equal(windows.length, 1);
      assert.deepEqual(entered, []);
      assert.equal(globalThis.window, windows[0]);
      assert(globalThis.__capGuestScopes[windows[0].__capScopeId]);
      onSolve = options => {
        assert.equal(closed, true);
        options.success({ verifyParam: param });
      };
      release.resolve();
      assert.equal(await first, original);
      assert.equal(await second, param);
      assert.deepEqual(entered, ["second"]);
      assert.equal(globalThis.__capGuestScopes[windows[0].__capScopeId], undefined);
      await finish();
    `, { ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1" });
  });

  it("preserves a partial initialization error when close rejects", async () => {
    await runIsolated(realDomFixture + `
      const original = Object.freeze(new Error("fixture initialization failure"));
      let realClose;
      onWrite = w => {
        realClose = w.happyDOM.close.bind(w.happyDOM);
        w.happyDOM.close = async () => { throw new Error("PRIVATE_CLOSE_SECRET"); };
        throw original;
      };
      const result = await solver.runCaptchaSolve("first", "sgp", "fixture").then(
        () => { throw new Error("expected initialization failure"); }, error => error);
      assert.equal(result, original);
      await assert.rejects(solver.runCaptchaSolve("second", "sgp", "fixture"), /cleanup failed/);
      assert.equal(windows.length, 1);
      assert.deepEqual(entered, []);
      await realClose();
      await finish();
    `, { ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1" });
  });

  for (const reuseLimit of ["CAPTCHA_REUSE_MAX_SOLVES", "CAPTCHA_REUSE_MAX_IDLE_MS"]) {
    it(`awaits reusable-window discard for ${reuseLimit}`, async () => {
      await runIsolated(realDomFixture + `
        const closing = deferred();
        const release = deferred();
        let closed = false;
        onWrite = w => {
          if (windows.length !== 1) return;
          const close = w.happyDOM.close.bind(w.happyDOM);
          w.happyDOM.close = async () => {
            closing.resolve();
            await release.promise;
            await close();
            closed = true;
          };
        };
        assert.equal(await solver.runCaptchaSolve("first", "sgp", "fixture"), param);
        assert.equal(closed, false, "successful reusable window was closed early");
        const second = solver.runCaptchaSolve("second", "sgp", "fixture");
        await closing.promise;
        await tick();
        assert.equal(windows.length, 1);
        assert.deepEqual(entered, ["first"]);
        assert.equal(globalThis.window, windows[0]);
        onSolve = options => {
          assert.equal(closed, true);
          options.success({ verifyParam: param });
        };
        release.resolve();
        assert.equal(await second, param);
        assert.deepEqual(entered, ["first", "second"]);
        assert.equal(await backend.destroyDom(windows[1]), true);
        await finish();
      `, { ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1", CAPTCHA_WINDOW_REUSE: "1", [reuseLimit]: "-1" });
    });
  }

  it("does not replace a reusable window whose discard rejects", async () => {
    await runIsolated(realDomFixture + `
      let realClose;
      onWrite = w => {
        realClose = w.happyDOM.close.bind(w.happyDOM);
        w.happyDOM.close = async () => { throw new Error("PRIVATE_CLOSE_SECRET"); };
      };
      assert.equal(await solver.runCaptchaSolve("first", "sgp", "fixture"), param);
      const failure = await solver.runCaptchaSolve("second", "sgp", "fixture").then(
        () => { throw new Error("unsafe replacement admitted"); }, error => error);
      assert.match(failure.message, /cleanup failed/);
      assert(!String(failure.stack).includes("PRIVATE"));
      await assert.rejects(solver.runCaptchaSolve("third", "sgp", "fixture"), /cleanup failed/);
      assert.equal(windows.length, 1);
      assert.deepEqual(entered, ["first"]);
      assert.equal(globalThis.window, windows[0]);
      await realClose();
      await finish();
    `, { ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1", CAPTCHA_WINDOW_REUSE: "1", CAPTCHA_REUSE_MAX_SOLVES: "0" });
  });

  it("serializes actual dispatcher calls through rejection cleanup and host shutdown", async () => {
    await runIsolated(`
      const entered = [];
      const release = new Map();
      let owner = null;
      let active = 0;
      let peak = 0;
      let finishCleanup;
      const cleanup = new Promise(resolve => { finishCleanup = resolve; });
      mock.module(${JSON.stringify(happyPath)}, () => ({
        solveTraceless: async ({ scene }) => {
          assert.equal(owner, null, "overlapping global window lifetime");
          owner = scene;
          active += 1;
          peak = Math.max(peak, active);
          entered.push(scene);
          try {
            await new Promise(resolve => release.set(scene, resolve));
            assert.equal(owner, scene, "another window replaced the global alias");
            if (scene === "reject") throw new Error("synthetic rejection");
            return "token:" + scene;
          } finally {
            if (scene === "reject") await cleanup;
            assert.equal(owner, scene, "cleanup ran against another window");
            owner = null;
            active -= 1;
          }
        },
      }));
      const solver = await import(${JSON.stringify(solverPath)});
      const first = solver.runCaptchaSolve("reject", "sgp", "fixture");
      const firstFailure = first.then(() => { throw new Error("expected rejection"); }, error => error.message);
      const second = solver.runCaptchaSolve("second", "sgp", "fixture");
      const third = solver.runCaptchaSolve("third", "sgp", "fixture");
      await tick();
      assert.deepEqual(entered, ["reject"]);
      release.get("reject")();
      await tick();
      solver.shutdownCaptchaSolver();
      await tick();
      assert.deepEqual(entered, ["reject"], "host shutdown released a live backend");
      finishCleanup();
      assert.equal(await firstFailure, "synthetic rejection");
      await tick();
      assert.deepEqual(entered, ["reject", "second"]);
      release.get("second")();
      assert.equal(await second, "token:second");
      await tick();
      assert.deepEqual(entered, ["reject", "second", "third"]);
      release.get("third")();
      assert.equal(await third, "token:third");
      assert.equal(owner, null);
      assert.equal(peak, 1);
      assert.equal(solver.captchaSolverConcurrency(), 1);
      console.log("SCENARIO_OK");
    `, { CAPTCHA_DAEMON_CONCURRENCY: "120" });
  });

  it("checks provider cooldown after queued admission and recovers the shared queue", async () => {
    await runIsolated(`
      let calls = 0;
      let release;
      mock.module(${JSON.stringify(happyPath)}, () => ({
        solveTraceless: async () => {
          calls += 1;
          if (calls === 1) {
            await new Promise(resolve => { release = resolve; });
            throw new Error("HTTP 429 too many requests");
          }
          return "recovered";
        },
      }));
      const { CaptchaTokenPool } = await import(${JSON.stringify(poolPath)});
      const { runCaptchaSolve } = await import(${JSON.stringify(solverPath)});
      const pool = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, solveRetries: 4, cpuLimitPercent: 0 });
      const cfg = { enabled: true, sceneId: "fixture", region: "sgp", prefix: "fixture" };
      const pending = Promise.allSettled([pool.takeToken(cfg), pool.takeToken(cfg), pool.takeToken(cfg)]);
      await tick();
      assert.equal(calls, 1);
      release();
      const results = await pending;
      assert(results.every(result => result.status === "rejected"));
      assert.equal(calls, 1, "queued work executed after the provider pause");
      pool.invalidate();
      await assert.rejects(pool.takeToken(cfg), /paused/);
      pool.requestUrgentRefill();
      await tick();
      assert.equal(calls, 1, "invalidation or urgent refill bypassed the pause");
      assert.equal(pool.stats().activeSolves, 0);
      assert.equal(await runCaptchaSolve("independent", "sgp", "fixture"), "recovered");
      pool.stopBackgroundRefill();
      console.log("SCENARIO_OK");
      process.exit(0); // Existing take deadline timers are deliberately not changed here.
    `);
  });

  for (const [label, overrides] of [
    ["defaults", {}],
    ["legacy parallel environment", { CAPTCHA_POOL_MIN: "20", CAPTCHA_POOL_MAX: "120", CAPTCHA_SOLVE_CONCURRENCY: "8", CAPTCHA_EMPTY_TAKE_RACE: "3" }],
    ["invalid sizing environment", { CAPTCHA_POOL_MIN: "NaN", CAPTCHA_POOL_MAX: "Infinity", CAPTCHA_SOLVE_CONCURRENCY: "0", CAPTCHA_EMPTY_TAKE_RACE: "-1" }],
  ] as const) {
    it(`warms one token and grows only a bounded serial bank with ${label}`, async () => {
      await runIsolated(`
        let calls = 0;
        let active = 0;
        let peak = 0;
        mock.module(${JSON.stringify(happyPath)}, () => ({
          solveTraceless: async () => {
            active += 1;
            peak = Math.max(peak, active);
            await tick();
            active -= 1;
            return "token:" + (++calls);
          },
        }));
        const captcha = await import(${JSON.stringify(captchaPath)});
        const pools = await import(${JSON.stringify(poolPath)});
        const cfg = { enabled: true, sceneId: "fixture", region: "sgp", prefix: "fixture" };
        globalThis.fetch = async url => {
          assert(String(url).startsWith("https://zcode.z.ai/api/v1/client/configs?"));
          return Response.json({ data: { configs: { captcha: cfg } } });
        };
        // The safe gate must prevent even a config fetch/solve before opt-in.
        await captcha.startCaptchaPool("fixture");
        assert.equal(calls, 0);
        process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA = "1";
        await captcha.startCaptchaPool("fixture");
        await tick();
        assert.equal(calls, 1);
        assert.equal(pools.getCaptchaPoolStats().ready, 1);
        assert.equal(pools.getCaptchaPoolStats().target, 1);
        assert.equal(pools.getCaptchaPoolStats().max, 4);
        assert.equal(pools.getCaptchaPoolStats().solverWorkers, 1);
        // Repeated zero-demand refills must not widen the warm target.
        for (let i = 0; i < 5; i++) {
          pools.urgentCaptchaRefill();
          await tick();
        }
        assert.equal(calls, 1);
        for (let i = 0; i < 8; i++) {
          assert.match(await pools.takeCaptchaToken(cfg), /^token:/);
          await tick();
        }
        await pools.prefillCaptchaPool(cfg, 120);
        while (pools.getCaptchaPoolStats().activeSolves > 0) await tick();
        assert.equal(pools.getCaptchaPoolStats().target, 4);
        assert(pools.getCaptchaPoolStats().ready <= 4);
        assert.equal(peak, 1);
        captcha.shutdownCaptcha();
        console.log("SCENARIO_OK");
        process.exit(0);
      `, { ...overrides, CAPTCHA_CPU_GOVERNOR: "0" });
    });
  }
});
