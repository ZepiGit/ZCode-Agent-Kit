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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const tokenPath = fileURLToPath(new URL("./captcha-token.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;

interface HostRun { code: number | null; stdout: string; stderr: Buffer }

/** The runner's environment without the names these tests set themselves (npm and CI may carry proxy settings). */
function hermeticEnv(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/proxy|stop_token|respawn/i.test(name)));
}

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
  `], { stdout: "pipe", stderr: "pipe", env: { ...hermeticEnv(), ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0", ...env } });
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

const entryFixture = fileURLToPath(new URL("./__fixtures__/solver-process-entry.ts", import.meta.url));

/** A manual clock for the dispatcher's timers (host source). */
const FAKE_CLOCK = `
  function fakeClock() {
    let now = 0, next = 0; const timers = new Map();
    return {
      setTimeout(fn, ms) { const t = { id: ++next, at: now + ms, fn, unref() { return t; } }; timers.set(t.id, t); return t; },
      clearTimeout(t) { if (t) timers.delete(t.id); },
      advance(ms) {
        now += ms;
        for (const t of [...timers.values()].sort((a, b) => a.at - b.at)) if (t.at <= now && timers.delete(t.id)) t.fn();
      },
    };
  }
  const settled = () => new Promise(resolve => setTimeout(resolve, 20));
`;

describe("solver process: lifecycle", () => {
  it("spawns the next generation only after the previous one has exited, killing it after the grace when it ignores SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "t27-generations-"));
    const log = join(dir, "generations.log");
    try {
      const run = await expectOk(host(`${REPORT}
        const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({
          command: [process.execPath, ${JSON.stringify(entryFixture)}, 'ignore-sigterm'], graceMs: 1200 }) });
        s.configure({ backendModule, deadlineMs: 400, idleMs: 5000 });
        const first = Number(label(await s.run('pid', 'sgp', 'p')).slice(4));
        await assert.rejects(s.run('hang', 'sgp', 'p'), /deadline exceeded/);
        const killedAt = Date.now();
        s.configure({ deadlineMs: 10000 });
        const next = s.run('pid', 'sgp', 'p');
        let deathAt = null;
        while (deathAt === null) {
          try { process.kill(first, 0); await new Promise(resolve => setTimeout(resolve, 10)); } catch { deathAt = Date.now(); }
        }
        const second = Number(label(await next).slice(4));
        s.shutdown();
        report({ first, second, killedAt, deathAt, generation: s.stats().generation });
      `, { T27_GENERATION_LOG: log }));
      const { first, second, killedAt, deathAt, generation } = reported(run);
      const starts = Object.fromEntries(readFileSync(log, "utf8").trim().split("\n").map((line) => line.split(" ").map(Number)));
      expect(Object.keys(starts).map(Number).sort()).toEqual([first, second].sort());
      expect(generation).toBe(2);
      // The stubborn generation outlived SIGTERM until the grace ran out ...
      expect(deathAt - killedAt).toBeGreaterThanOrEqual(1000);
      // ... and the next one started only after it was gone (10 ms polling).
      expect(starts[second]).toBeGreaterThanOrEqual(deathAt - 15);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a solve dispatched during the cold start at 90 s from dispatch, not from readiness", async () => {
    const run = await expectOk(host(`${FAKE_CLOCK} ${REPORT}
      const clock = fakeClock();
      const s = solver.createCaptchaSolver({ clock, transport: solver.solverProcessTransport({
        command: [process.execPath, ${JSON.stringify(entryFixture)}, 'slow-start', '3000'] }) });
      s.configure({ backendModule });
      let outcome = null;
      s.run('token:cold', 'sgp', 'p').then(() => { outcome = 'solved'; }, (err) => { outcome = err.message; });
      clock.advance(89_999); await settled();
      const before = outcome;
      clock.advance(1); await settled();
      report({ before, after: outcome, stats: s.stats() });
      s.shutdown();
    `));
    const { before, after, stats } = reported(run);
    expect({ before, after }).toEqual({ before: null, after: "captcha solver deadline exceeded" });
    expect(stats).toMatchObject({ deadlineKills: 1, generation: 1, totalSolves: 0 });
  });

  it("serves a solve that was dispatched while the solver process was still starting", async () => {
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({
        command: [process.execPath, ${JSON.stringify(entryFixture)}, 'slow-start', '800'] }) });
      s.configure({ backendModule, idleMs: 2000 });
      report(label(await s.run('token:during-start', 'sgp', 'p')));
      s.shutdown();
    `));
    expect(reported(run)).toBe("token:during-start:active=1");
  });
});

describe("solver process: output", () => {
  it("re-emits the solver's own log line ([pe-cache-evict]) on the proxy's stderr exactly as the thread transport writes it", async () => {
    const stderrOf = async (transport: string) => (await expectOk(host(`
      const s = solver.createCaptchaSolver({ transport: solver.${transport}() });
      s.configure({ backendModule, idleMs: 2000 });
      assert.equal(label(await s.run('stall-evict', 'sgp', 'p')), 'evict:memory:none');
      s.shutdown();
      await new Promise(resolve => setTimeout(resolve, 300));
    `))).stderr;
    const viaThread = await stderrOf("threadTransport");
    const viaProcess = await stderrOf("solverProcessTransport");
    expect(viaThread.toString()).toMatch(/^\[pe-cache-evict\] resource-[0-9a-f]{16} stalled 2x — evicting cache\n$/);
    expect(viaProcess.equals(viaThread)).toBe(true);
  });

  it("never splits a solver line with a proxy line, keeps every byte of an oversized line and the unterminated tail", async () => {
    const b64 = (text: string) => Buffer.from(text).toString("base64");
    const big = "é".repeat(50 * 1024) + "\n"; // 100 KiB of two-byte characters: chunk boundaries fall inside them
    const run = await expectOk(host(`
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      await s.run('stderr-line:${b64("partial-without-newline")}', 'sgp', 'p');
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stderr.write('PROXY LINE\\n');
      await s.run('stderr-line:${b64(" then the rest ✓\n")}', 'sgp', 'p');
      await s.run('stderr-line:' + Buffer.from('é'.repeat(50 * 1024) + '\\n').toString('base64'), 'sgp', 'p');
      await s.run('stderr-line:${b64("tail-without-newline")}', 'sgp', 'p');
      s.shutdown();
      await new Promise(resolve => setTimeout(resolve, 500));
    `));
    const text = run.stderr.toString("utf8");
    expect(text.split("\n")).toContain("PROXY LINE");
    expect(text.split("\n")).toContain("partial-without-newline then the rest ✓");
    expect(text).toContain(big);
    expect(text.endsWith("tail-without-newline")).toBe(true);
    expect(run.stderr.length).toBe(Buffer.byteLength("PROXY LINE\npartial-without-newline then the rest ✓\n" + big + "tail-without-newline"));
  });
});

// The ambient proxy names lib/proxy-env.mjs strips from the managed proxy,
// plus near misses it keeps; each set once in a mixed spelling.
const PROXY_LIKE = [
  "HTTP_PROXY", "https_proxy", "All_Proxy", "nO_pRoXy", "npm_http_proxy", "NPM_HTTPS_PROXY", "yarn_all_proxy",
  "Pnpm_No_Proxy", "npm_proxy", "YARN_PROXY", "npm_config_proxy", "HTTP_PROXY_EXTRA", "MY_HTTP_PROXY", "SOCKS_PROXY",
];

describe("solver process: environment", () => {
  it("passes the worker's inputs and strips the stop token, the respawn chain and every ambient proxy name, in any case", async () => {
    const env: Record<string, string> = {
      ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1",
      CAPTCHA_CDN_CACHE_DIR: "/tmp/t27-cdn",
      CAPTCHA_CDN_CACHE_TTL_MS: "1234",
      ZCODE_PROXY_UPSTREAM_PROXY: "http://127.0.0.1:9",
      ZCODE_KIT_LOG_DIR: "/tmp/t27-logs",
      ZCODE_T27_PLAIN: "kept",
      ZCODE_KIT_STOP_TOKEN: "t27-stop-token-value",
      zcode_kit_stop_token: "t27-stop-token-lower",
      ZCODE_KIT_RESPAWN_NODE: "/usr/bin/node",
      Zcode_Kit_Respawn_Manager: "/kit/manager.mjs",
      ZCODE_KIT_RESPAWN_ARGS: "[]",
    };
    for (const name of PROXY_LIKE) env[name] = "http://127.0.0.1:9";
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      const seen = {};
      for (const name of ['ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA', 'CAPTCHA_CDN_CACHE_DIR', 'CAPTCHA_CDN_CACHE_TTL_MS',
        'ZCODE_PROXY_UPSTREAM_PROXY', 'ZCODE_KIT_LOG_DIR', 'ZCODE_T27_PLAIN']) seen[name] = label(await s.run('env:' + name, 'sgp', 'p'));
      const names = label(await s.run(${JSON.stringify(`env-names:stop_token|respawn|^(${[...PROXY_LIKE, "ZCODE_PROXY_UPSTREAM_PROXY", "BUN_OPTIONS"].join("|")})$`)}, 'sgp', 'p'));
      const guard = label(await s.run('env:BUN_OPTIONS', 'sgp', 'p'));
      s.shutdown();
      report({ seen, names, guard });
    `, env));
    const { seen, names, guard } = reported(run);
    expect(seen).toEqual({
      ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "env:1",
      CAPTCHA_CDN_CACHE_DIR: "env:/tmp/t27-cdn",
      CAPTCHA_CDN_CACHE_TTL_MS: "env:1234",
      ZCODE_PROXY_UPSTREAM_PROXY: "env:http://127.0.0.1:9",
      ZCODE_KIT_LOG_DIR: "env:/tmp/t27-logs",
      ZCODE_T27_PLAIN: "env:kept",
    });
    // Kept: the egress setting, the near misses, and the egress guard's preload.
    const keptProxyLike = ["HTTP_PROXY_EXTRA", "MY_HTTP_PROXY", "SOCKS_PROXY", "ZCODE_PROXY_UPSTREAM_PROXY", "npm_config_proxy"];
    expect(names).toBe(`env-names:${["BUN_OPTIONS", ...keptProxyLike].sort().join(",")}`);
    // The proxy suite's egress guard reaches the solver process (ticket 76).
    expect(guard).toContain("egress-guard");
  });

  it("strips exactly the ambient proxy names the managed proxy's environment strips (lib/proxy-env.mjs)", async () => {
    // The kit's module, outside this package (and its rootDir): loaded by URL.
    const kitProxyEnv = new URL("../../../lib/proxy-env.mjs", import.meta.url).href;
    const { proxyEnv } = await import(kitProxyEnv) as { proxyEnv(ctx: { config: string }, source: Record<string, string>): Record<string, string> };
    const source: Record<string, string> = {};
    for (const name of PROXY_LIKE) source[name] = "http://127.0.0.1:9";
    const keptByKit = Object.keys(proxyEnv({ config: "config.yaml" }, source)).filter((name) => PROXY_LIKE.includes(name)).sort();
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      report(label(await s.run(${JSON.stringify(`env-names:^(${PROXY_LIKE.join("|")})$`)}, 'sgp', 'p')));
      s.shutdown();
    `, source));
    expect(keptByKit.length).toBeGreaterThan(0);
    expect(reported(run)).toBe(`env-names:${keptByKit.join(",")}`);
  });
});
