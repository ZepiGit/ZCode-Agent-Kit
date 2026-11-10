/**
 * Seam 3 (solver dispatcher interface) through the transport seam (ADR-0002,
 * ticket 24). The dispatcher is an object built over a transport; these tests
 * drive it with an in-memory transport that speaks the existing message
 * protocol, and drive the thread transport with the offline fixture backend.
 * The file name stays outside `captcha-*.test.ts` on purpose: those 13 suites
 * are the B1 preservation set and their count is pinned by the ticket.
 */
import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  createCaptchaSolver,
  type SolverChannelEvents,
  type SolverHostMessage,
  type SolverTransport,
} from "./captcha-solver.js";

const param = (label: string) => Buffer.from(JSON.stringify({
  certifyId: label, sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
})).toString("base64");

interface FakeGeneration {
  events: SolverChannelEvents;
  posted: string[];
  terminated: boolean;
}

/** In-memory solver generations. `onSolve` decides how each one answers. */
function memoryTransport(onSolve: (gen: FakeGeneration, msg: Extract<SolverHostMessage, { type: "solve" }>) => void) {
  const generations: FakeGeneration[] = [];
  const transport: SolverTransport = {
    spawn(events) {
      const gen: FakeGeneration = { events, posted: [], terminated: false };
      generations.push(gen);
      return {
        post(msg) {
          gen.posted.push(JSON.stringify(msg));
          if (msg.type === "solve") queueMicrotask(() => onSolve(gen, msg));
        },
        terminate() { gen.terminated = true; },
      };
    },
  };
  return { transport, generations };
}

const answerWithToken = (gen: FakeGeneration, msg: { id: number; scene: string }) => {
  gen.events.message({
    type: "result", id: msg.id, ok: true, param: param(`token:${msg.scene}`), heapUsedMB: 12,
    scripts: [{ filename: "feilin008.js", sha256: "a".repeat(64) }],
  });
};

const certifyId = (token: string) => JSON.parse(Buffer.from(token, "base64").toString()).certifyId;

describe("solver dispatcher over a transport", () => {
  it("speaks the existing message protocol, byte for byte, and returns the solve's token", async () => {
    const { transport, generations } = memoryTransport(answerWithToken);
    const solver = createCaptchaSolver({ transport });
    solver.configure({ backendModule: "file:///fixture-backend.ts" });

    expect(certifyId(await solver.run("scene-a", "sgp", "no8xfe"))).toBe("token:scene-a");
    expect(certifyId(await solver.run("scene-b", "sgp", "no8xfe"))).toBe("token:scene-b");

    expect(generations).toHaveLength(1);
    expect(generations[0]!.posted).toEqual([
      '{"type":"init","backendModule":"file:///fixture-backend.ts"}',
      '{"type":"solve","id":1,"scene":"scene-a","region":"sgp","prefix":"no8xfe"}',
      '{"type":"solve","id":2,"scene":"scene-b","region":"sgp","prefix":"no8xfe"}',
    ]);
    const stats = solver.stats();
    expect(stats).toMatchObject({
      mode: "worker", alive: true, busy: false, queueDepth: 0, generation: 1,
      solvesSinceSpawn: 2, totalSolves: 2, totalFailures: 0, recycles: 0,
    });
    expect(stats.lastSdkScripts).toEqual([{ filename: "feilin008.js", sha256: "a".repeat(64) }]);
    solver.shutdown();
    expect(generations[0]!.terminated).toBe(true);
  });

  it("rebuilds failure provenance at the dispatcher boundary, preserving categories but never worker text", async () => {
    for (const category of ['other', 'rate-limit', 'duplicate', 'incompatible'] as const) {
      const { transport, generations } = memoryTransport((gen, msg) => gen.events.message({
        type: 'result', id: msg.id, ok: false, heapUsedMB: 12,
        error: { category, message: 'synthetic worker failure | SyntheticTransportCredential' },
      }));
      const solver = createCaptchaSolver({ transport });
      try {
        const err = await solver.run('synthetic-failure', 'fixture', 'fixture').catch(err => err);
        expect(err.category).toBe(category);
        expect(err.message).not.toContain('SyntheticTransportCredential');
        expect(err.stack).not.toContain('SyntheticTransportCredential');
        expect(err.message).toMatch(/len=\d+ sha256=[0-9a-f]{64}/);
        expect(generations).toHaveLength(1);
        expect(solver.stats()).toMatchObject({ totalFailures: 1, totalSolves: 0, generation: 1 });
      } finally { solver.shutdown(); }
    }
  });

  it("keeps each dispatcher's state in its own object", async () => {
    const a = memoryTransport(answerWithToken);
    const b = memoryTransport(answerWithToken);
    const first = createCaptchaSolver({ transport: a.transport });
    const second = createCaptchaSolver({ transport: b.transport });

    await first.run("only-first", "sgp", "p");
    first.requestRecycle("request");

    expect(first.stats()).toMatchObject({ generation: 1, totalSolves: 1, recycles: 1, lastRecycleReason: "request", alive: false });
    expect(second.stats()).toMatchObject({ generation: 0, totalSolves: 0, recycles: 0, lastRecycleReason: null, alive: false });
    expect(b.generations).toHaveLength(0);
  });

  it("a deadline kill ends the generation and its late result settles nothing", async () => {
    const pending: Array<{ gen: FakeGeneration; id: number; scene: string }> = [];
    const { transport, generations } = memoryTransport((gen, msg) => {
      if (msg.scene === "hang") pending.push({ gen, id: msg.id, scene: msg.scene });
      else answerWithToken(gen, msg);
    });
    const solver = createCaptchaSolver({ transport });
    solver.configure({ deadlineMs: 30 });

    await expect(solver.run("hang", "sgp", "p")).rejects.toThrow("captcha solver deadline exceeded");
    expect(generations[0]!.terminated).toBe(true);
    // The killed generation answers late: nothing may be settled by it.
    answerWithToken(pending[0]!.gen, pending[0]!);
    expect(solver.stats()).toMatchObject({ deadlineKills: 1, recycles: 1, lastRecycleReason: "deadline", totalSolves: 0, totalFailures: 1 });

    expect(certifyId(await solver.run("after", "sgp", "p"))).toBe("token:after");
    expect(generations).toHaveLength(2);
    expect(solver.stats().generation).toBe(2);
    solver.shutdown();
  });

  it("an exit the dispatcher did not ask for fails only the solve in flight", async () => {
    const { transport, generations } = memoryTransport((gen, msg) => {
      if (msg.scene === "crash") gen.events.exit();
      else answerWithToken(gen, msg);
    });
    const solver = createCaptchaSolver({ transport });

    const crashed = solver.run("crash", "sgp", "p");
    const queued = solver.run("queued", "sgp", "p");
    await expect(crashed).rejects.toThrow("captcha solver worker exited unexpectedly");
    expect(certifyId(await queued)).toBe("token:queued");
    expect(generations).toHaveLength(2);
    expect(solver.stats()).toMatchObject({ lastRecycleReason: "exit", totalFailures: 1, totalSolves: 1, generation: 2 });
    solver.shutdown();
  });

  it("a transport that cannot spawn fails that solve and the next one gets a fresh try", async () => {
    let refuse = true;
    const inner = memoryTransport(answerWithToken);
    const transport: SolverTransport = {
      spawn(events) {
        if (refuse) { refuse = false; throw new Error("spawn refused"); }
        return inner.transport.spawn(events);
      },
    };
    const solver = createCaptchaSolver({ transport });

    await expect(solver.run("first", "sgp", "p")).rejects.toThrow("captcha solver worker unavailable");
    expect(certifyId(await solver.run("second", "sgp", "p"))).toBe("token:second");
    expect(solver.stats()).toMatchObject({ totalFailures: 1, totalSolves: 1, generation: 1 });
    solver.shutdown();
  });
});

it("real worker reports sanitized raw, mutable typed and local refusal failures (no vendor execution)", async () => {
  const failureBackend = new URL('./__fixtures__/solver-failure.ts', import.meta.url).href;
  const worker = new Worker(new URL('./captcha-solver-worker.ts', import.meta.url));
  const timer = setTimeout(() => worker.terminate(), 5_000);
  try {
    worker.postMessage({ type: 'init', backendModule: failureBackend });
    let id = 0;
    for (const scene of ['raw', 'typed', 'local', 'cleanup']) {
      const reply = new Promise<any>((resolve, reject) => {
        worker.addEventListener('message', event => resolve(event.data), { once: true });
        worker.addEventListener('error', reject, { once: true });
      });
      worker.postMessage({ type: 'solve', id: ++id, scene, region: 'fixture', prefix: 'fixture' });
      const message = await reply;
      expect(message.type).toBe('result');
      expect(message.ok).toBe(false);
      expect(message.error.category).toBe('other');
      expect(message.error.message).not.toContain('SyntheticWorkerCredential');
      if (scene === 'local') expect(message.error.message).toContain('too short (76 chars)');
      if (scene === 'cleanup') expect(message.error.message).toContain('cleanup failed');
    }
  } finally { clearTimeout(timer); worker.terminate(); }
});

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;

// Same isolation as captcha-solver.test.ts: a child Bun runs the real thread
// transport, so no other suite's module mocks can replace it.
async function threadScenario(source: string, env: Record<string, string> = {}): Promise<string> {
  const child = Bun.spawn([process.execPath, "--eval", `
    import assert from 'node:assert/strict';
    import * as solver from ${JSON.stringify(solverPath)};
    const label = token => JSON.parse(Buffer.from(token,'base64').toString()).certifyId;
    const watchdog = setTimeout(() => { console.error('thread transport scenario timed out'); process.exit(1); }, 12000);
    try { ${source}; console.log('SCENARIO_OK'); }
    finally { clearTimeout(watchdog); }
  `], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0", ...env } });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("SCENARIO_OK");
  return stdout;
}

describe("thread transport", () => {
  it("a solver generation sees the proxy's environment as it was at spawn", async () => {
    await threadScenario(`
      process.env.ZCODE_T24_SET_BEFORE_SPAWN = 'seen';
      const s = solver.createCaptchaSolver({ transport: solver.threadTransport() });
      s.configure({ backendModule: ${JSON.stringify(fixtureUrl)}, idleMs: 1000 });
      assert.equal(label(await s.run('env:ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA','fixture','fixture')), 'env:0');
      assert.equal(label(await s.run('env:ZCODE_T24_SET_BEFORE_SPAWN','fixture','fixture')), 'env:seen');
      assert.equal(label(await s.run('env:ZCODE_T24_INHERITED','fixture','fixture')), 'env:from-parent');
      s.shutdown();
    `, { ZCODE_T24_INHERITED: "from-parent" });
  });

  it("the module-level dispatcher and a dispatcher built over the thread transport return the same token", async () => {
    await threadScenario(`
      solver.configureCaptchaSolver({ backendModule: ${JSON.stringify(fixtureUrl)}, idleMs: 1000 });
      const built = solver.createCaptchaSolver({ transport: solver.threadTransport() });
      built.configure({ backendModule: ${JSON.stringify(fixtureUrl)}, idleMs: 1000 });
      const viaModule = await solver.runCaptchaSolve('real-dom','fixture','fixture');
      const viaObject = await built.run('real-dom','fixture','fixture');
      assert.equal(viaObject, viaModule);
      assert.deepEqual(built.stats().lastSdkScripts, solver.getCaptchaSolverStats().lastSdkScripts);
      assert.equal(solver.getCaptchaSolverStats().generation, 1);
      assert.equal(built.stats().generation, 1);
      solver.shutdownCaptchaSolver(); built.shutdown();
    `);
  });
});
