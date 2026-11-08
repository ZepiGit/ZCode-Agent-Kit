// Seam 3 (solver dispatcher with a fixture backend): the CDN memory tier and
// the stall counters of the REAL captcha-happy module are bounded inside one
// solver generation and start empty in the next one (ADR-0009, spec §7).
// The fixture backend runs inside the production worker and reports the
// generation's resources as `cdn:<entries>:<bytes>:stalls:<urls>`.
import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

// Same isolation as captcha-solver.test.ts: a child process per scenario, so
// another suite's module mocks cannot replace the worker or its backend.
async function scenario(source: string): Promise<void> {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-generation-"));
  dirs.push(cacheDir);
  const child = Bun.spawn([process.execPath, "--eval", `
    import assert from 'node:assert/strict';
    import * as solver from ${JSON.stringify(solverPath)};
    solver.configureCaptchaSolver({backendModule:${JSON.stringify(fixtureUrl)},deadlineMs:15000,idleMs:5000,recycleAfterSolves:200,recycleAfterFailures:3,maxWorkerHeapMB:768});
    const run = async scene => JSON.parse(Buffer.from(await solver.runCaptchaSolve(scene,'fixture','fixture'),'base64').toString()).certifyId;
    const watchdog = setTimeout(() => { console.error('generation bounds scenario timed out'); process.exit(1); }, 25000);
    try { ${source}; console.log('SCENARIO_OK'); }
    finally { clearTimeout(watchdog); solver.shutdownCaptchaSolver(); }
  `], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0", CAPTCHA_CDN_CACHE_DIR: cacheDir } });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("SCENARIO_OK");
}

describe("solver generation resources", () => {
  it("bound the CDN memory tier and the stall counters inside one generation, and reset with the next", async () => {
    await scenario(`
      // Two stalls of a cached pe URL evict it from the generation's cache.
      assert.equal(await run('stall-evict'), 'evict:memory:none');
      const generation = solver.getCaptchaSolverStats().generation;
      assert.equal(await run('cdn-fill:300/1024'), 'cdn:256:262144:stalls:0');
      assert.equal(await run('cdn-fill:40/1048576'), 'cdn:32:33554432:stalls:0');
      assert.equal(await run('stall-fill:1100'), 'cdn:32:33554432:stalls:1024');
      assert.equal(solver.getCaptchaSolverStats().generation, generation);
      solver.requestCaptchaSolverRecycle('test');
      assert.equal(await run('resources'), 'cdn:0:0:stalls:0');
      assert(solver.getCaptchaSolverStats().generation > generation);
    `);
  }, 30_000);
});
