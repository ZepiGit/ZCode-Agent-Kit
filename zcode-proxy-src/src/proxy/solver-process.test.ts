/**
 * The solver dispatcher over the child-process adapter (the solver
 * process). Each scenario runs in a host Bun of its own that
 * plays the proxy: it builds a dispatcher, solves through the offline fixture
 * backend and reports. The host's own stdout/stderr are what the proxy's would
 * be. Loopback only; the egress guard (bunfig preload) reaches the host and,
 * through BUN_OPTIONS in the environment the solver process inherits, every
 * solver process it spawns.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeExecutableDirectory, terminateOwnedChild, withinCleanupDeadline } from "./__fixtures__/solver-test-cleanup.js";

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const tokenPath = fileURLToPath(new URL("./captcha-token.ts", import.meta.url));
const capPath = fileURLToPath(new URL("./solver-cap.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;

interface HostRun { code: number | null; stdout: string; stderr: Buffer }

/** The runner's environment without the names these tests set themselves (npm and CI may carry proxy settings). */
function hermeticEnv(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/proxy|stop_token|respawn/i.test(name)));
}

/** Runs `source` in a host Bun with `solver`, `cap` (solver-cap.ts), `label`, `classify` and `backendModule` in scope. */
async function host(source: string, env: Record<string, string | undefined> = {}, timeoutMs = 20_000): Promise<HostRun> {
  const child = Bun.spawn([process.execPath, "--eval", `
    import assert from 'node:assert/strict';
    import * as solver from ${JSON.stringify(solverPath)};
    import * as cap from ${JSON.stringify(capPath)};
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

/** Whether `pid` is alive. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Kills a leaked solver process of ours: on Linux only after /proc confirms it is still a captcha solver. */
function reapLeaked(pid: number): void {
  if (process.platform !== "linux" || !alive(pid)) return;
  try {
    if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("captcha-solver")) process.kill(pid, "SIGKILL");
  } catch {}
}

describe("solver process: the proxy's dispatcher", () => {
  it("runs the proxy's solves in a solver process started from the running Bun", async () => {
    const run = await expectOk(host(`${REPORT}
      solver.configureCaptchaSolver({ backendModule, idleMs: 2000 });
      const pid = Number(label(await solver.runCaptchaSolve('pid', 'sgp', 'p')).slice(4));
      report({ pid, host: process.pid, command: solver.solverProcessCommand(), execPath: process.execPath });
      solver.shutdownCaptchaSolver();
    `));
    const { pid, host: hostPid, command, execPath } = reported(run);
    expect(pid).not.toBe(hostPid);
    expect(command).toEqual([execPath, fileURLToPath(new URL("./captcha-solver-process.ts", import.meta.url))]);
  });

  it("refuses to run without the proxy's IPC channel, from the entry module and through the proxy's CLI, with one event line", async () => {
    const entry = fileURLToPath(new URL("./captcha-solver-process.ts", import.meta.url));
    const index = fileURLToPath(new URL("../index.ts", import.meta.url));
    for (const argv of [[entry, "12345"], [index, "__captcha-solver-process", "12345"]]) {
      const child = Bun.spawn([process.execPath, ...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: hermeticEnv() });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, stdout }).toEqual({ code: 2, stdout: "" });
      expect(stderr).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z ERROR solver "?solver process started without the proxy's IPC channel; the proxy starts it on the first solve"? command=__captcha-solver-process\n$/);
    }
  });

  it("exits on IPC EOF while its parent lives on, even with guest timers left on its event loop", async () => {
    const { spawn } = await import("node:child_process");
    const entry = fileURLToPath(new URL("./captcha-solver-process.ts", import.meta.url));
    const child = spawn(process.execPath, [entry, String(process.pid)], { stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "json", env: hermeticEnv() });
    try {
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
      // The entry greets, and serves only once its cap is acknowledged.
      expect(await new Promise<unknown>((resolve) => child.once("message", resolve))).toMatchObject({ type: "hello", pid: child.pid });
      child.send({ type: "cap", enforcement: "none", capMB: null });
      const answered = new Promise<unknown>((resolve) => child.once("message", resolve));
      child.send({ type: "init", backendModule: fixtureUrl });
      child.send({ type: "solve", id: 1, scene: "keep-loop", region: "sgp", prefix: "p" });
      expect(await answered).toMatchObject({ type: "result", id: 1, ok: true });
      expect(child.exitCode).toBeNull();
      // The parent (this runner) stays alive, so the parent watcher never fires:
      // only the EOF can end it.
      child.disconnect();
      expect(await exited).toEqual({ code: 0, signal: null });
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("never keeps the proxy alive for an idle solver process, which ends when the proxy exits", async () => {
    const run = await expectOk(host(`${REPORT}
      solver.configureCaptchaSolver({ backendModule });
      report(Number(label(await solver.runCaptchaSolve('pid', 'sgp', 'p')).slice(4)));
      // No shutdown: the 10 min idle timer and the live generation must not hold the host.
    `, {}, 8000));
    const solverPid = reported(run);
    try {
      const deadline = Date.now() + 3000;
      while (alive(solverPid) && Date.now() < deadline) await Bun.sleep(25);
      expect(alive(solverPid)).toBe(false);
    } finally {
      reapLeaked(solverPid);
    }
  });

  for (const mode of ["idle", "hung"] as const) {
    it(`leaves no solver process once the proxy is SIGKILLed with a ${mode} generation`, async () => {
      const child = Bun.spawn([process.execPath, "--eval", `
        import * as solver from ${JSON.stringify(solverPath)};
        solver.configureCaptchaSolver({ backendModule: ${JSON.stringify(fixtureUrl)}, deadlineMs: 120000 });
        const token = await solver.runCaptchaSolve('pid', 'sgp', 'p');
        console.log('SOLVER ' + JSON.parse(Buffer.from(token, 'base64').toString()).certifyId.slice(4));
        ${mode === "hung" ? "void solver.runCaptchaSolve('hang', 'sgp', 'p').catch(() => {}); await new Promise(r => setTimeout(r, 300));" : ""}
        console.log('READY');
        await new Promise(() => {});
      `], { stdout: "pipe", stderr: "pipe", env: { ...hermeticEnv(), ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0" } });
      let solverPid = 0;
      try {
        const reader = child.stdout.getReader();
        let out = "";
        while (!out.includes("READY")) {
          const { value, done } = await reader.read();
          if (done) break;
          out += new TextDecoder().decode(value);
        }
        solverPid = Number(/SOLVER (\d+)/.exec(out)?.[1]);
        expect(out).toContain("READY");
        expect(solverPid).not.toBe(child.pid);
        expect(alive(solverPid)).toBe(true);
        child.kill("SIGKILL");
        await child.exited;
        const deadline = Date.now() + 3000;
        while (alive(solverPid) && Date.now() < deadline) await Bun.sleep(25);
        expect(alive(solverPid)).toBe(false);
      } finally {
        child.kill("SIGKILL");
        if (solverPid) reapLeaked(solverPid);
      }
    });
  }
});

// On the pinned Bun 1.4.2 `proxy: false` is
// ignored and Bun reads the process environment, so the unset case is
// delivered by the solver process's environment. Plain tests, no version gate.
// Loopback only: the recording proxies answer absolute-form requests
// themselves and refuse every CONNECT, so nothing is forwarded or tunnelled.
describe("solver process: captcha egress", () => {
  const arrivals: string[] = [];
  const servers: (http.Server | net.Server)[] = [];
  let configuredProxy = "";
  let ambientProxy = "";
  let target = "";
  let tlsPort = 0;

  const listen = async (server: http.Server | net.Server): Promise<number> => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  };
  const recordingProxy = async (name: string): Promise<string> => {
    const server = http.createServer((req, res) => {
      arrivals.push(`${name} ${req.method} ${req.url}`);
      res.end(`via ${name}`);
    });
    server.on("connect", (req, socket) => {
      arrivals.push(`${name} CONNECT ${req.url}`);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    return `http://127.0.0.1:${await listen(server)}`;
  };

  beforeAll(async () => {
    configuredProxy = await recordingProxy("configured");
    ambientProxy = await recordingProxy("ambient");
    target = `http://127.0.0.1:${await listen(http.createServer((req, res) => {
      arrivals.push(`target ${req.method} ${req.url}`);
      res.end("direct");
    }))}`;
    tlsPort = await listen(net.createServer((socket) => {
      arrivals.push("tls-target connection");
      socket.destroy();
    }));
  });
  afterAll(() => {
    for (const server of servers) server.close();
  });

  // The proxy's environment: ambient proxy variables in mixed case.
  const ambient = () => ({ http_proxy: ambientProxy, Https_Proxy: ambientProxy, ALL_PROXY: ambientProxy, no_proxy: "", NPM_HTTPS_PROXY: ambientProxy });

  async function egressThroughSolverProcess(env: Record<string, string>) {
    arrivals.length = 0;
    const scene = `egress:${Buffer.from(JSON.stringify({ target, tlsPort })).toString("base64")}`;
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      const results = JSON.parse(label(await s.run(${JSON.stringify(scene)}, 'sgp', 'p')).slice('egress:'.length));
      const names = label(await s.run('env-names:^(http_proxy|https_proxy|all_proxy|no_proxy|npm_https_proxy)$', 'sgp', 'p'));
      s.shutdown();
      report({ results, names });
    `, env, 30_000));
    return { ...reported(run), arrivals: [...arrivals].sort() };
  }

  it("goes direct when the setting is unset, with mixed-case ambient proxy variables in the proxy's environment", async () => {
    const run = await egressThroughSolverProcess(ambient());
    expect(run.arrivals).toEqual(["target GET /fetch", "target GET /sync-xhr", "tls-target connection"]);
    expect(run.results.fetch).toBe("200 direct");
    expect(run.results.syncXhr).toBe("200 direct");
    expect(run.names).toBe("env-names:");
  }, 40_000);

  it("sends all three routes through the configured proxy only when the setting is set", async () => {
    const run = await egressThroughSolverProcess({ ...ambient(), ZCODE_PROXY_UPSTREAM_PROXY: configuredProxy });
    expect(run.arrivals).toEqual([
      `configured CONNECT 127.0.0.1:${tlsPort}`,
      `configured GET ${target}/fetch`,
      `configured GET ${target}/sync-xhr`,
    ]);
    expect(run.results.fetch).toBe("200 via configured");
    expect(run.results.syncXhr).toBe("200 via configured");
    expect(run.names).toBe("env-names:");
  }, 40_000);
});

describe("solver process: compiled proxy", () => {
  const proxyRoot = fileURLToPath(new URL("../..", import.meta.url));
  const harness = fileURLToPath(new URL("./__fixtures__/compiled-solver-host.ts", import.meta.url));
  let dir = "";
  let binary = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "solver-compiled-"));
    binary = join(dir, process.platform === "win32" ? "solver-host.exe" : "solver-host");
    const build = Bun.spawn([process.execPath, "build", "--compile", "--define", "require.resolve=undefined", harness, "--outfile", binary],
      { cwd: proxyRoot, stdout: "pipe", stderr: "pipe", env: hermeticEnv() });
    try {
      const [code, , stderr] = await withinCleanupDeadline(Promise.all([
        build.exited, new Response(build.stdout).text(), new Response(build.stderr).text(),
      ]), 110_000, "compiled fixture build");
      expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    } finally {
      await terminateOwnedChild(build);
    }
  }, 120_000);

  afterAll(async () => {
    if (dir) await removeExecutableDirectory(dir);
  }, 5_000);

  it("starts its solver process by self-exec through the proxy's own CLI route, never with -e", async () => {
    const plainBackend = new URL("./__fixtures__/plain-backend.ts", import.meta.url).href;
    const run = Bun.spawn([binary, plainBackend, "argv", "token:compiled", "pid"],
      { stdout: "pipe", stderr: "pipe", env: { ...hermeticEnv(), ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "0" } });
    let result: [number, string, string];
    try {
      result = await withinCleanupDeadline(Promise.all([run.exited, new Response(run.stdout).text(), new Response(run.stderr).text()]), 50_000, "compiled fixture host");
    } finally {
      await terminateOwnedChild(run);
    }
    const [code, stdout, stderr] = result;
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    const report = reported({ code, stdout, stderr: Buffer.from(stderr) });
    expect(report.solverExited).toBe(true);
    expect(report.results[2]).toBe(`pid:${report.solverPid}`);
    expect(alive(report.solverPid)).toBe(false);
    expect(report.command).toEqual([report.execPath, "__captcha-solver-process"]);
    const started = JSON.parse(report.results[0].slice("argv:".length));
    expect(started.execPath).toBe(report.execPath);
    expect(started.argv.slice(-2)).toEqual(["__captcha-solver-process", String(report.pid)]);
    for (const flag of ["-e", "--eval", "-p", "--print"]) {
      expect(started.argv).not.toContain(flag);
      expect(started.execArgv).not.toContain(flag);
    }
    expect(report.results[1]).toBe("token:compiled");
    expect(report.results[2]).not.toBe(`pid:${report.pid}`);
  }, 60_000);
});

describe("solver process: lifecycle", () => {
  it("spawns the next generation only after the previous one has exited, killing it after the grace when it ignores SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solver-generations-"));
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
      `, { SOLVER_TEST_GENERATION_LOG: log }));
      const { first, second, killedAt, deathAt, generation } = reported(run);
      const starts = Object.fromEntries(readFileSync(log, "utf8").trim().split("\n").map((line) => line.split(" ").map(Number)));
      expect(Object.keys(starts).map(Number).sort()).toEqual([first, second].sort());
      expect(generation).toBe(2);
      // The stubborn generation outlived SIGTERM until the grace ran out (on
      // Windows SIGTERM is TerminateProcess, which cannot be ignored) ...
      if (process.platform !== "win32") expect(deathAt - killedAt).toBeGreaterThanOrEqual(1000);
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

  it("never splits a solver line with a proxy line, cuts a line at 2 KiB on a character boundary and keeps the unterminated tail", async () => {
    const b64 = (text: string) => Buffer.from(text).toString("base64");
    const run = await expectOk(host(`
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      await s.run('stderr-line:${b64("partial-without-newline")}', 'sgp', 'p');
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stderr.write('PROXY LINE\\n');
      await s.run('stderr-line:${b64(" then the rest ✓\n")}', 'sgp', 'p');
      // 100 KiB of two-byte characters after one ASCII byte: the 2 KiB limit falls inside a character.
      await s.run('stderr-line:' + Buffer.from('x' + 'é'.repeat(50 * 1024) + '\\nafter the long line\\n').toString('base64'), 'sgp', 'p');
      await s.run('stderr-line:${b64("tail-without-newline")}', 'sgp', 'p');
      s.shutdown();
      await new Promise(resolve => setTimeout(resolve, 500));
    `));
    expect(run.stderr.toString("utf8")).toBe(
      "PROXY LINE\npartial-without-newline then the rest ✓\n" + "x" + "é".repeat(1023) + "\nafter the long line\ntail-without-newline");
    expect(run.stdout).not.toContain("further lines were dropped");
  });

  it("passes on at most 200 lines per solver process, says once how many it dropped when the process ends, and starts over with the next process", async () => {
    const lines = (from: number, to: number, tag: string) => Array.from({ length: to - from }, (_, i) => `${tag} ${from + i}\n`).join("");
    const run = await expectOk(host(`
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      await s.run('stderr-line:${Buffer.from(lines(0, 150, "first")).toString("base64")}', 'sgp', 'p');
      await s.run('stderr-line:${Buffer.from(lines(150, 320, "first")).toString("base64")}', 'sgp', 'p');
      s.requestRecycle('request');
      await s.run('stderr-line:${Buffer.from(lines(0, 3, "second")).toString("base64")}', 'sgp', 'p');
      s.shutdown();
      await new Promise(resolve => setTimeout(resolve, 500));
    `));
    expect(run.stderr.toString()).toBe(lines(0, 200, "first") + lines(0, 3, "second"));
    const dropped = run.stdout.split("\n").filter((line) => line.includes("further lines were dropped"));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatch(/^\S+ WARN solver solver wrote more output than one generation may; further lines were dropped droppedLines=120 limitLines=200 limitKiB=64$/);
  });

  it("passes on at most 64 KiB per solver process, stdout and stderr together", async () => {
    // 40 lines of 2000 bytes: 32 of them (64,032 bytes with their newlines) fit.
    const block = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, "0")}${"y".repeat(1998)}\n`).join("");
    const run = await expectOk(host(`
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      await s.run('stderr-line:${Buffer.from(block).toString("base64")}', 'sgp', 'p');
      await s.run('stderr-line:${Buffer.from(block).toString("base64")}', 'sgp', 'p');
      s.shutdown();
      await new Promise(resolve => setTimeout(resolve, 500));
    `));
    expect(run.stderr.length).toBe(32 * 2001);
    expect(run.stdout).toMatch(/further lines were dropped droppedLines=8 limitLines=200 limitKiB=64$/m);
  });

  it("writes solver lines into the live proxy.log through the proxy's log writer, also after the file was rotated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solver-proxy-log-"));
    const writerPath = fileURLToPath(new URL("../log/proxy-log-writer.ts", import.meta.url));
    const b64 = (text: string) => Buffer.from(text).toString("base64");
    try {
      await expectOk(host(`
        const { openProxyLogWriter, routeOutputThrough } = await import(${JSON.stringify(writerPath)});
        // What serve does with ZCODE_KIT_LOG_DIR set, with a small rotation threshold.
        const writer = openProxyLogWriter({ dir: ${JSON.stringify(dir)}, maxBytes: 4096 });
        const restore = routeOutputThrough(writer);
        try {
          const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
          s.configure({ backendModule, idleMs: 2000 });
          await s.run('stderr-line:${b64("[captcha-guest-error] before the rotation\n")}', 'sgp', 'p');
          await new Promise(resolve => setTimeout(resolve, 200));
          console.log('p'.repeat(5000));
          console.log('the proxy line that follows the rotation');
          await s.run('stderr-line:${b64("[captcha-guest-error] after the rotation\n")}', 'sgp', 'p');
          await new Promise(resolve => setTimeout(resolve, 200));
          s.shutdown();
        } finally { restore(); writer.close(); }
      `, { ZCODE_KIT_STOP_TOKEN: "stop-token-for-the-log-test" }));
      const live = readFileSync(join(dir, "proxy.log"), "utf8");
      const rotated = readFileSync(join(dir, "proxy.log.1"), "utf8");
      expect(rotated).toContain("[captcha-guest-error] before the rotation\n");
      expect(rotated).not.toContain("after the rotation");
      expect(live).toBe("the proxy line that follows the rotation\n[captcha-guest-error] after the rotation\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Does a systemd user scope apply MemoryMax here? Then the solver cap is enforced by a cgroup. */
function systemdScopeCaps(): boolean {
  if (process.platform !== "linux") return false;
  const want = 64 * 1024 * 1024;
  const probe = Bun.spawnSync(["systemd-run", "--user", "--scope", "--quiet", "-p", `MemoryMax=${want}`, "-p", "MemorySwapMax=0", "--",
    "sh", "-c", 'cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max"'], { stdout: "pipe", stderr: "ignore" });
  return probe.exitCode === 0 && probe.stdout.toString().trim() === String(want);
}

/** The enforcement mode the operating system gives the solver cap on this machine. */
const expectedEnforcement = process.platform === "win32" ? "job-object" : systemdScopeCaps() ? "cgroup" : "sampling";

const SAMPLING_CAP = "async () => ({ enforcement: 'sampling', reason: 'test', endedAtCap: async () => false, release() {} })";
const AT_CAP = (mode: string) => new RegExp(String.raw`^\S+ WARN solver solver process ended at its memory cap capMB=128 enforcement=${mode} key=solver\.memoryCapMB next="raise solver\.memoryCapMB in the proxy's config\.yaml if solves need more memory"${mode === "sampling" ? String.raw` footprintMB=\d+` : ""}$`, "m");

describe("solver process: memory cap", () => {
  /** The real entry behind the module probe, started the way the transport starts it. */
  async function probedEntry(args: string[], body: (child: import("node:child_process").ChildProcess, messages: unknown[], modules: () => string[]) => Promise<void>) {
    const { spawn } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "solver-handshake-"));
    const log = join(dir, "modules.log");
    const modules = () => readFileSync(log, "utf8").trim().split("\n");
    const child = spawn(process.execPath, [entryFixture, ...args, String(process.pid)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "json", env: { ...hermeticEnv(), SOLVER_TEST_MODULE_LOG: log },
    });
    const messages: unknown[] = [];
    child.on("message", (message) => messages.push(message));
    let stderr = "";
    child.stderr!.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    try {
      await body(child, messages, modules);
      return { stderr, modules: modules() };
    } finally {
      child.kill("SIGKILL");
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const until = async (ready: () => boolean, ms = 5000) => {
    const deadline = Date.now() + ms;
    while (!ready() && Date.now() < deadline) await Bun.sleep(10);
    expect(ready()).toBe(true);
  };

  it("loads neither the DOM runtime nor the solve code before the cap acknowledgement, and ignores a solve sent before it", async () => {
    const run = await probedEntry([], async (child, messages, modules) => {
      await until(() => messages.length === 1);
      expect(messages[0]).toMatchObject({ type: "hello", pid: child.pid });
      child.send({ type: "init", backendModule: fixtureUrl });
      child.send({ type: "solve", id: 1, scene: "token:early", region: "sgp", prefix: "p" });
      await Bun.sleep(400);
      expect(messages).toHaveLength(1);
      child.send({ type: "cap", enforcement: "none", capMB: null });
      child.send({ type: "init", backendModule: fixtureUrl });
      child.send({ type: "solve", id: 2, scene: "token:late", region: "sgp", prefix: "p" });
      await until(() => messages.length === 2);
      expect(messages[1]).toMatchObject({ type: "result", id: 2, ok: true });
      expect(typeof (messages[1] as { footprintMB?: unknown }).footprintMB).toBe("number");
      child.send({ type: "probe" });
      await until(() => modules().length === 3);
    });
    expect(run.modules.slice(0, 2)).toEqual(["start 0", "cap 0"]);
    // The probe does see the modules once a solve has run.
    expect(Number(run.modules[2]!.replace("probe ", ""))).toBeGreaterThan(0);
  });

  it("ends itself without solving when the cap acknowledgement never arrives", async () => {
    let outcome: { code: number | null; signal: string | null } | null = null;
    const run = await probedEntry(["handshake-timeout", "300"], async (child, messages) => {
      const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
      await until(() => messages.length === 1);
      child.send({ type: "init", backendModule: fixtureUrl });
      child.send({ type: "solve", id: 1, scene: "token:never", region: "sgp", prefix: "p" });
      outcome = await exit;
      expect(messages).toHaveLength(1);
    });
    expect(outcome!).toEqual({ code: 3, signal: null });
    expect(run.stderr).toMatch(/^\S+ ERROR solver solver process got no memory cap acknowledgement from the proxy; it ends without solving waitedMs=300\n$/);
    expect(run.modules).toEqual(["start 0", "exit 0"]);
  });

  it("fails the solve and never runs it when the cap cannot be confirmed to the solver process", async () => {
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({
        command: [process.execPath, ${JSON.stringify(entryFixture)}, 'handshake-timeout', '300'], applyCap: () => new Promise(() => {}) }) });
      s.configure({ backendModule, idleMs: 2000 });
      let failure = null;
      try { await s.run('token:uncapped', 'sgp', 'p'); } catch (e) { failure = [e.name, e.message, classify(e)]; }
      report({ failure, stats: s.stats() });
      s.shutdown();
    `));
    const { failure, stats } = reported(run);
    expect(failure).toEqual(["CaptchaSdkError", "captcha solver worker exited unexpectedly", "other"]);
    expect(stats).toMatchObject({ totalSolves: 0, enforcement: null });
  });

  it(`caps the proxy's solver at 300 MB by default, enforced here by ${expectedEnforcement}, and reports both`, async () => {
    const run = await expectOk(host(`${REPORT}
      const before = solver.getCaptchaSolverStats();
      solver.configureCaptchaSolver({ backendModule, idleMs: 2000 });
      await solver.runCaptchaSolve('token:a', 'sgp', 'p');
      report({ before: [before.capMB, before.enforcement], after: [solver.getCaptchaSolverStats().capMB, solver.getCaptchaSolverStats().enforcement],
        thread: (({ capMB, enforcement }) => [capMB, enforcement])(solver.createCaptchaSolver({ transport: solver.threadTransport() }).stats()) });
      solver.shutdownCaptchaSolver();
    `));
    expect(reported(run)).toEqual({ before: [300, null], after: [300, expectedEnforcement], thread: [null, "none"] });
  });

  it(`ends a solver that allocates past its cap (${expectedEnforcement}), fails only that solve and names the config key in the log`, async () => {
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({ capMB: 128 }) });
      s.configure({ backendModule, idleMs: 2000 });
      const first = label(await s.run('pid', 'sgp', 'p'));
      let failure = null;
      const ballooning = s.run('balloon:600', 'sgp', 'p');
      const queued = s.run('pid', 'sgp', 'p');
      try { await ballooning; } catch (e) { failure = [e.name, e.message, classify(e)]; }
      const next = label(await queued);
      await new Promise(resolve => setTimeout(resolve, 600));
      report({ first, failure, next, stats: s.stats() });
      s.shutdown();
    `, {}, 40_000));
    const { first, failure, next, stats } = reported(run);
    expect(failure).toEqual(["CaptchaSdkError", "captcha solver worker exited unexpectedly", "other"]);
    expect(next).not.toBe(first);
    expect(stats).toMatchObject({ capMB: 128, enforcement: expectedEnforcement, generation: 2, totalSolves: 2, totalFailures: 1 });
    expect(run.stdout).toMatch(AT_CAP(expectedEnforcement));
    expect(stats.capExits).toBe(1);
  }, 50_000);

  it("ends itself at the cap where the operating system enforces nothing (sampling); the proxy logs the cap exit with the config key even when the solver's output allowance is used up", async () => {
    const noise = Buffer.from(Array.from({ length: 260 }, (_, i) => `noise ${i}\n`).join("") + "left open without a newline").toString("base64");
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({ capMB: 128, applyCap: ${SAMPLING_CAP} }) });
      s.configure({ backendModule, idleMs: 2000 });
      await s.run('stderr-line:${noise}', 'sgp', 'p');
      let failure = null;
      try { await s.run('balloon:600', 'sgp', 'p'); } catch (e) { failure = [e.name, e.message, classify(e)]; }
      const after = label(await s.run('token:after', 'sgp', 'p'));
      await new Promise(resolve => setTimeout(resolve, 300));
      report({ failure, after, stats: s.stats() });
      s.shutdown();
      await new Promise(resolve => setTimeout(resolve, 300));
    `, {}, 40_000));
    const { failure, after, stats } = reported(run);
    expect(failure).toEqual(["CaptchaSdkError", "captcha solver worker exited unexpectedly", "other"]);
    expect(after).toBe("token:after:active=1");
    expect(stats).toMatchObject({ capMB: 128, enforcement: "sampling", capExits: 1, abnormalExits: 1 });
    // The allowance was spent before the cap: 200 lines went through, the rest was dropped ...
    expect(run.stderr.toString()).toBe(Array.from({ length: 200 }, (_, i) => `noise ${i}\n`).join(""));
    expect(run.stdout).toMatch(/further lines were dropped droppedLines=61 limitLines=200 limitKiB=64$/m);
    // ... and the cap exit is logged by the proxy all the same, once; the solver's marker is never shown.
    expect(run.stdout.match(new RegExp(AT_CAP("sampling").source, "gm"))).toHaveLength(1);
    expect(run.stdout + run.stderr.toString()).not.toContain("@@zcode-solver-at-cap");
    // Said once, not per generation.
    expect(run.stdout.match(/WARN solver the operating system does not enforce the solver's memory cap; the solver process measures itself and ends at the cap capMB=128 enforcement=sampling why=test/g)).toHaveLength(1);
  }, 50_000);

  it("does not log a cap exit for a solver process that ends for another reason", async () => {
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({ capMB: 128, applyCap: ${SAMPLING_CAP} }) });
      s.configure({ backendModule, idleMs: 2000 });
      const pid = Number(label(await s.run('pid', 'sgp', 'p')).slice(4));
      const running = s.run('slow:2000', 'sgp', 'p').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 200));
      process.kill(pid, 'SIGKILL');
      await running;
      await new Promise(resolve => setTimeout(resolve, 300));
      report(s.stats());
      s.shutdown();
    `));
    expect(reported(run)).toMatchObject({ capExits: 0, abnormalExits: 1 });
    expect(run.stdout).not.toContain("ended at its memory cap");
  });

  it.skipIf(process.platform !== "linux")("reports sampling, never cgroup, when the scope's memory.max does not show the requested limit", async () => {
    const run = await expectOk(host(`${REPORT}
      const { readFileSync } = await import('node:fs');
      const { execFile } = await import('node:child_process');
      const os = {
        platform: 'linux',
        run: (command, args, timeout) => new Promise(resolve => execFile(command, args, { timeout }, (error, stdout) => resolve({ code: error ? 1 : 0, stdout: String(stdout) }))),
        // A user systemd without the memory controller: the scope exists, the limit does not.
        read: (path) => { if (path.endsWith('/memory.max')) return 'max\\n'; try { return readFileSync(path, 'utf8'); } catch { return null; } },
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        jobObjects: async () => null,
      };
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport({ applyCap: (pid, bytes) => cap.applySolverCap(pid, bytes, os) }) });
      s.configure({ backendModule, idleMs: 2000 });
      await s.run('token:a', 'sgp', 'p');
      report(s.stats().enforcement);
      s.shutdown();
    `));
    expect(reported(run)).toBe("sampling");
  });

  it.skipIf(expectedEnforcement !== "cgroup")("leaves no scope and no solver process behind after an idle exit", async () => {
    const run = await expectOk(host(`${REPORT}
      const { readFileSync, existsSync } = await import('node:fs');
      solver.configureCaptchaSolver({ backendModule, idleMs: 300 });
      const pid = Number(label(await solver.runCaptchaSolve('pid', 'sgp', 'p')).slice(4));
      const scope = '/sys/fs/cgroup' + readFileSync('/proc/' + pid + '/cgroup', 'utf8').split('\\n').find(line => line.startsWith('0::')).slice(3);
      const limit = [readFileSync(scope + '/memory.max', 'utf8').trim(), readFileSync(scope + '/memory.swap.max', 'utf8').trim()];
      const deadline = Date.now() + 5000;
      const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      while ((alive() || existsSync(scope)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      report({ pid, host: process.pid, scope, limit, alive: alive(), scopeExists: existsSync(scope), reason: solver.getCaptchaSolverStats().lastRecycleReason });
    `));
    const { pid, host: hostPid, scope, limit, alive: stillAlive, scopeExists, reason } = reported(run);
    expect(scope).toMatch(new RegExp(`/zcode-captcha-solver-${hostPid}-${pid}-[0-9a-f]{8}\\.scope$`));
    expect(limit).toEqual([String(300 * 1024 * 1024), "0"]);
    expect({ reason, stillAlive, scopeExists }).toEqual({ reason: "idle", stillAlive: false, scopeExists: false });
  });
});

// The ambient proxy names lib/proxy-env.mjs strips from the managed proxy,
// plus near misses it keeps; each set once in a mixed spelling.
const PROXY_LIKE = [
  "HTTP_PROXY", "https_proxy", "All_Proxy", "nO_pRoXy", "npm_http_proxy", "NPM_HTTPS_PROXY", "yarn_all_proxy",
  "Pnpm_No_Proxy", "npm_proxy", "YARN_PROXY", "npm_config_proxy", "HTTP_PROXY_EXTRA", "MY_HTTP_PROXY", "SOCKS_PROXY",
];

// What the proxy reads as a credential, a key, or the place it keeps them.
const CREDENTIAL_NAMES = [
  "ZCODE_PROXY_CREDENTIAL_SECRET", "ZCODE_PROXY_CREDENTIAL_MASTER_KEY", "ZCODE_PROXY_MASTER_KEY", "Zcode_Proxy_Api_Key",
  "ZCODE_CREDENTIAL_SECRET", "zcode_proxy_credentials_path", "ZCODE_PROXY_ACCOUNTS_PATH", "ZCODE_CONTROL_CAPABILITY",
  "ZCODE_PROXY_KEY",
  // Named like a secret, whoever set them.
  "OPENAI_API_KEY", "gh_token", "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "Db_Password", "MY_SECRET", "GOOGLE_APPLICATION_CREDENTIALS", "SOME_API_KEY_FILE", "SSH_KEY",
];
// Near misses that stay.
const NOT_SECRETS = ["KEYBOARD_LAYOUT", "TOKENIZERS_PARALLELISM", "SECRET_SANTA", "MONKEY"];

describe("solver process: environment", () => {
  it("passes the worker's inputs and strips the stop token, the respawn chain, the proxy's credentials and keys and every ambient proxy name, in any case", async () => {
    const env: Record<string, string> = {
      ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "1",
      CAPTCHA_CDN_CACHE_DIR: "/tmp/solver-test-cdn",
      CAPTCHA_CDN_CACHE_TTL_MS: "1234",
      ZCODE_PROXY_UPSTREAM_PROXY: "http://127.0.0.1:9",
      ZCODE_KIT_LOG_DIR: "/tmp/solver-test-logs",
      ZCODE_SOLVER_TEST_PLAIN: "kept",
      ZCODE_KIT_STOP_TOKEN: "test-stop-token-value",
      zcode_kit_stop_token: "test-stop-token-lower",
      ZCODE_KIT_RESPAWN_NODE: "/usr/bin/node",
      Zcode_Kit_Respawn_Manager: "/kit/manager.mjs",
      ZCODE_KIT_RESPAWN_ARGS: "[]",
    };
    for (const name of [...CREDENTIAL_NAMES, ...NOT_SECRETS]) env[name] = "test-credential-value";
    for (const name of PROXY_LIKE) env[name] = "http://127.0.0.1:9";
    const run = await expectOk(host(`${REPORT}
      const s = solver.createCaptchaSolver({ transport: solver.solverProcessTransport() });
      s.configure({ backendModule, idleMs: 2000 });
      const seen = {};
      for (const name of ['ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA', 'CAPTCHA_CDN_CACHE_DIR', 'CAPTCHA_CDN_CACHE_TTL_MS',
        'ZCODE_PROXY_UPSTREAM_PROXY', 'ZCODE_KIT_LOG_DIR', 'ZCODE_SOLVER_TEST_PLAIN']) seen[name] = label(await s.run('env:' + name, 'sgp', 'p'));
      const names = label(await s.run(${JSON.stringify(`env-names:stop_token|respawn|accounts_path|capability|^(${[...CREDENTIAL_NAMES, ...NOT_SECRETS, ...PROXY_LIKE, "ZCODE_PROXY_UPSTREAM_PROXY", "BUN_OPTIONS"].join("|")})$`)}, 'sgp', 'p'));
      const guard = label(await s.run('env:BUN_OPTIONS', 'sgp', 'p'));
      s.shutdown();
      report({ seen, names, guard });
    `, env));
    const { seen, names, guard } = reported(run);
    expect(seen).toEqual({
      ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: "env:1",
      CAPTCHA_CDN_CACHE_DIR: "env:/tmp/solver-test-cdn",
      CAPTCHA_CDN_CACHE_TTL_MS: "env:1234",
      ZCODE_PROXY_UPSTREAM_PROXY: "env:http://127.0.0.1:9",
      ZCODE_KIT_LOG_DIR: "env:/tmp/solver-test-logs",
      ZCODE_SOLVER_TEST_PLAIN: "env:kept",
    });
    // Kept: the egress setting, the near misses, and the egress guard's preload.
    const keptProxyLike = ["HTTP_PROXY_EXTRA", "MY_HTTP_PROXY", "SOCKS_PROXY", "ZCODE_PROXY_UPSTREAM_PROXY", "npm_config_proxy"];
    expect(names).toBe(`env-names:${["BUN_OPTIONS", ...NOT_SECRETS, ...keptProxyLike].sort().join(",")}`);
    // The proxy suite's egress guard reaches the solver process.
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
