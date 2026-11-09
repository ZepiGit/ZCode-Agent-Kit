/**
 * Seam 3 (solver dispatcher interface) over the child-process adapter
 * (ADR-0002, ticket 27). Each scenario runs in a host Bun of its own that
 * plays the proxy: it builds a dispatcher, solves through the offline fixture
 * backend and reports. The host's own stdout/stderr are what the proxy's would
 * be. Loopback only; the egress guard (bunfig preload) reaches the host and,
 * through BUN_OPTIONS in the environment the solver process inherits, every
 * solver process it spawns.
 */
import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const tokenPath = fileURLToPath(new URL("./captcha-token.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;

interface HostRun { code: number | null; stdout: string; stderr: Buffer }

/** Runs `source` in a host Bun with `solver`, `label`, `classify` and `backendModule` in scope. */
async function host(source: string, env: Record<string, string | undefined> = {}, timeoutMs = 20_000): Promise<HostRun> {
  const child = Bun.spawn([process.execPath, "--eval", `
    import assert from 'node:assert/strict';
    import * as solver from ${JSON.stringify(solverPath)};
    import { classifyCaptchaError as classify } from ${JSON.stringify(tokenPath)};
    const backendModule = ${JSON.stringify(fixtureUrl)};
    const label = token => JSON.parse(Buffer.from(token,'base64').toString()).certifyId;
    const watchdog = setTimeout(() => { console.error('host scenario timed out'); process.exit(1); }, ${timeoutMs});
    try { ${source}; console.log('SCENARIO_OK'); }
    finally { clearTimeout(watchdog); }
  `], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0", ...env } });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).arrayBuffer(),
  ]);
  return { code, stdout, stderr: Buffer.from(stderr) };
}

async function expectOk(run: Promise<HostRun>): Promise<HostRun> {
  const result = await run;
  expect({ code: result.code, stderr: result.code === 0 ? "" : result.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(result.stdout).toContain("SCENARIO_OK");
  return result;
}

/** One line of JSON the host prints with `report(value)`. */
const REPORT = "const report = value => console.log('REPORT ' + JSON.stringify(value));";
const reported = (run: HostRun) => JSON.parse(run.stdout.split("\n").find((line) => line.startsWith("REPORT "))!.slice(7));

describe("solver process: solves", () => {
  it("returns the same solve results as the thread transport, byte for byte, from another process", async () => {
    const run = await expectOk(host(`${REPORT}
      const scenes = ['token:a', 'args:x', 'real-dom', 'fail', 'rate-limit', 'incompatible', 'invalid', 'oversized', 'cleanup', 'token:b'];
      const results = {};
      const pids = {};
      for (const [name, transport] of [['thread', solver.threadTransport()], ['process', solver.solverProcessTransport()]]) {
        const s = solver.createCaptchaSolver({ transport });
        s.configure({ backendModule, idleMs: 2000 });
        const out = [];
        for (const scene of scenes) {
          try { out.push(['ok', await s.run(scene, 'sgp-✓', 'no8xfe "q" \\\\ é')]); }
          catch (e) { out.push(['err', e.name, e.message, classify(e)]); }
        }
        out.push(JSON.stringify(s.stats().lastSdkScripts));
        pids[name] = label(await s.run('pid', 'sgp', 'p'));
        results[name] = out;
        s.shutdown();
      }
      report({ results, pids, host: process.pid });
    `));
    const { results, pids, host: hostPid } = reported(run);
    expect(results.process).toEqual(results.thread);
    expect(results.thread).toHaveLength(11);
    expect(pids.thread).toBe(`pid:${hostPid}`);
    expect(pids.process).not.toBe(`pid:${hostPid}`);
  });
});
