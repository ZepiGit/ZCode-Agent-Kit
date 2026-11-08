// The egress guard's own proof (ticket 76): every transport a proxy test can
// reach is blocked before a socket opens and recorded, loopback passes, and
// the guarded `bun test` run fails when a test (or its child) tries to leave
// loopback, even when the code under test swallows the error.
//
// The "non-loopback" target is this host's own interface address with a
// listener in this file, so a hook that fails to block shows up as a
// counted connection on this machine and never as traffic to another host.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { Worker as ThreadWorker } from "node:worker_threads";
import { fetch as undiciFetch } from "undici";
import { EGRESS_BLOCKED_CODE, isLoopbackHost } from "./egress-guard.mjs";
import { takeEgressAttempts } from "./egress-guard-preload.js";

const PORT = 19760;
const PRELOAD = join(import.meta.dir, "egress-guard-preload.ts").replaceAll("\\", "/");

function interfaceAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return undefined;
}
// TEST-NET-1 (RFC 5737) when the host has no interface address: never routed.
const HOST = interfaceAddress() ?? "192.0.2.1";
const TARGET = `${HOST}:${PORT}`;

let server: net.Server;
let accepted = 0;
const scratch = mkdtempSync(join(tmpdir(), "t76-egress-"));

beforeAll(async () => {
  server = net.createServer((socket) => { accepted++; socket.destroy(); });
  await new Promise<void>((resolve) => server.listen(PORT, "0.0.0.0", resolve));
});
afterAll(() => { server.close(); });

function settle(p: Promise<unknown>, ms = 3000): Promise<{ code?: string; outcome: string }> {
  return Promise.race([
    p.then(() => ({ outcome: "connected" }), (e: { code?: string; cause?: { code?: string } }) => ({ code: e?.code ?? e?.cause?.code, outcome: "error" })),
    Bun.sleep(ms).then(() => ({ outcome: "timeout" })),
  ]);
}

function socketOutcome(socket: net.Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", () => { socket.destroy(); resolve(undefined); });
    socket.once("secureConnect", () => { socket.destroy(); resolve(undefined); });
  });
}

function requestOutcome(req: http.ClientRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    req.once("error", reject);
    req.once("response", (res) => { res.resume(); resolve(undefined); });
    req.end();
  });
}

/** Runs one attempt and asserts: the caller saw EGRESS_BLOCKED, no socket reached the listener, and the attempt was recorded. */
async function expectBlocked(transport: string, attempt: () => Promise<unknown>, where: Partial<{ thread: string; runtime: string }> = {}) {
  takeEgressAttempts();
  const before = accepted;
  const result = await settle(attempt());
  await Bun.sleep(50);
  const records = takeEgressAttempts();
  expect({ result, connections: accepted - before }).toEqual({ result: { code: EGRESS_BLOCKED_CODE, outcome: "error" }, connections: 0 });
  expect(records.map((r) => ({ transport: r.transport, target: `${r.host}:${r.port}`, ...(where.thread ? { thread: r.thread } : {}), ...(where.runtime ? { runtime: r.runtime } : {}) })))
    .toContainEqual({ transport, target: TARGET, ...where });
}

describe("egress guard blocks and records each transport", () => {
  test("global fetch", () => expectBlocked("fetch", () => fetch(`http://${TARGET}/v1/models`)));

  test("node:net connect", () => expectBlocked("node:net", () => socketOutcome(net.connect({ host: HOST, port: PORT }))));

  test("node:net Socket#connect(port, host)", () => expectBlocked("node:net", () => {
    const s = new net.Socket();
    const p = socketOutcome(s);
    s.connect(PORT, HOST);
    return p;
  }));

  test("node:tls connect", () => expectBlocked("node:net", () => socketOutcome(tls.connect({ host: HOST, port: PORT }))));

  test("node:http request", () => expectBlocked("node:net", () => requestOutcome(http.request(`http://${TARGET}/`))));

  test("node:https request", () => expectBlocked("node:net", () => requestOutcome(https.request(`https://${TARGET}/`))));

  test("WebSocket", () => expectBlocked("WebSocket", async () => {
    const ws = new WebSocket(`ws://${TARGET}/`);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("ws error")); });
  }));

  test("Bun.connect", () => expectBlocked("Bun.connect", () => Bun.connect({ hostname: HOST, port: PORT, socket: { data() {} } }).then((s) => s.end())));

  test("undici fetch (Bun's builtin module)", () => expectBlocked("undici.fetch", () => undiciFetch(`http://${TARGET}/`)));

  test("fetch through a non-loopback proxy", () => expectBlocked("fetch (proxy)", () => fetch("http://127.0.0.1:1/", { proxy: `http://${TARGET}` } as RequestInit)));
});

describe("egress guard reaches workers and child processes", () => {
  test("a Bun Worker's fetch", () => expectBlocked("fetch", async () => {
    const file = join(scratch, "fetch-worker.ts");
    writeFileSync(file, `fetch(${JSON.stringify(`http://${TARGET}/`)}).then(() => postMessage("connected"), (e) => postMessage(e.code ?? String(e)));\n`);
    const w = new Worker(file);
    try {
      const code = await new Promise<string>((resolve) => { w.onmessage = (e) => resolve(String(e.data)); });
      throw Object.assign(new Error(code), { code });
    } finally { w.terminate(); }
  }, { thread: "worker" }));

  test("a node:worker_threads eval worker's net connect", () => expectBlocked("node:net", async () => {
    const w = new ThreadWorker(`
      const { parentPort, workerData } = require("node:worker_threads");
      const s = require("node:net").connect(workerData);
      s.on("error", (e) => parentPort.postMessage(e.code ?? String(e)));
      s.on("connect", () => { s.destroy(); parentPort.postMessage("connected"); });
    `, { eval: true, workerData: { host: HOST, port: PORT } });
    try {
      const code = await new Promise<string>((resolve) => w.once("message", (m) => resolve(String(m))));
      throw Object.assign(new Error(code), { code });
    } finally { await w.terminate(); }
  }, { thread: "worker" }));

  test("a Bun child process's fetch (Bun.spawn)", () => expectBlocked("fetch", async () => {
    const child = Bun.spawn([process.execPath, "--eval", `fetch(${JSON.stringify(`http://${TARGET}/`)}).then(() => console.log("connected"), (e) => console.log(e.code ?? String(e)))`], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } });
    const code = (await new Response(child.stdout).text()).trim();
    await child.exited;
    throw Object.assign(new Error(code), { code });
  }, { runtime: "bun" }));

  const node = Bun.which("node");
  test.skipIf(!node)("a Node child process's fetch (node:child_process)", () => expectBlocked("fetch", async () => {
    const r = spawnSync(node!, ["--input-type=module", "-e", `fetch(${JSON.stringify(`http://${TARGET}/`)}).then(() => console.log("connected"), (e) => console.log(e.code ?? e.cause?.code ?? String(e)))`], { encoding: "utf8", timeout: 15_000 });
    const code = r.stdout.trim() || r.stderr.trim();
    throw Object.assign(new Error(code), { code });
  }, { runtime: "node" }));
});

describe("loopback passes", () => {
  test("isLoopbackHost: 127.0.0.0/8, ::1 and localhost only", () => {
    const loopback = ["127.0.0.1", "127.255.0.9", "localhost", "LOCALHOST", "localhost.", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"];
    const remote = ["zcode.z.ai", "10.0.0.5", "0.0.0.0", "::", "::2", "128.0.0.1", "localhost.example.com", "evil-localhost", "169.254.169.254", "::ffff:10.0.0.1", ""];
    expect({ loopback: loopback.filter((h) => !isLoopbackHost(h)), remote: remote.filter((h) => isLoopbackHost(h)) }).toEqual({ loopback: [], remote: [] });
  });

  test("fetch, node:http and Bun.connect to a loopback listener connect and record nothing", async () => {
    takeEgressAttempts();
    const local = Bun.serve({ port: 19761, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      const viaFetch = await (await fetch("http://127.0.0.1:19761/")).text();
      const viaLocalhost = await (await fetch("http://localhost:19761/")).text();
      const viaHttp = await new Promise<number>((resolve, reject) => http.get("http://127.0.0.1:19761/", (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject));
      const sock = await Bun.connect({ hostname: "127.0.0.1", port: 19761, socket: { data() {} } });
      sock.end();
      expect({ viaFetch, viaLocalhost, viaHttp, attempts: takeEgressAttempts() }).toEqual({ viaFetch: "ok", viaLocalhost: "ok", viaHttp: 200, attempts: [] });
    } finally { local.stop(true); }
  });
});

describe("the guarded bun test run fails on a non-loopback attempt", () => {
  // Each probe is a separate `bun test` run whose bunfig.toml loads the same
  // preload, as `npm run test:proxy` does.
  function runProbe(name: string, source: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(scratch, `${name}-`));
    writeFileSync(join(dir, "bunfig.toml"), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
    writeFileSync(join(dir, "probe.test.ts"), source);
    const r = Bun.spawnSync([process.execPath, "test"], { cwd: dir, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
    return { exitCode: r.exitCode, output: r.stdout.toString() + r.stderr.toString() };
  }
  const swallowed = `fetch("http://${TARGET}/api/v1/client/configs?app_version=1").catch(() => {})`;

  test("a test whose code swallows the blocked fetch fails, naming the test, transport and target", () => {
    const r = runProbe("swallow", `import { test } from "bun:test";\ntest("fails open like the routing refresh", async () => { await ${swallowed}; });\ntest("loopback only", () => {});\n`);
    expect({
      exitCode: r.exitCode,
      failedTest: r.output.includes("(fail) fails open like the routing refresh"),
      blocked: r.output.includes(`BLOCKED fetch ${TARGET} http://${TARGET}/api/v1/client/configs`),
      queryKept: r.output.includes("app_version=1"),
      otherTestPasses: r.output.includes("(pass) loopback only"),
    }).toEqual({ exitCode: 1, failedTest: true, blocked: true, queryKept: false, otherTestPasses: true });
  });

  test("an attempt at module load fails the run", () => {
    const r = runProbe("module-load", `import { test } from "bun:test";\nvoid ${swallowed};\nawait Bun.sleep(50);\ntest("first", () => {});\n`);
    expect({ exitCode: r.exitCode, blocked: r.output.includes(`BLOCKED fetch ${TARGET}`), outside: r.output.includes("before this test started") }).toEqual({ exitCode: 1, blocked: true, outside: true });
  });

  test("an attempt from a test's child process fails that test", () => {
    const r = runProbe("child", `import { test } from "bun:test";\ntest("spawns a child", () => { Bun.spawnSync([process.execPath, "--eval", ${JSON.stringify(`await ${swallowed}`)}]); });\n`);
    expect({ exitCode: r.exitCode, failedTest: r.output.includes("(fail) spawns a child"), blocked: r.output.includes(`BLOCKED fetch ${TARGET}`) }).toEqual({ exitCode: 1, failedTest: true, blocked: true });
  });

  test("record mode prints the attempt and does not fail the run", () => {
    const r = runProbe("record", `import { test } from "bun:test";\ntest("fails open", async () => { await ${swallowed}; });\n`, { ZCODE_EGRESS_GUARD: "record" });
    expect({ exitCode: r.exitCode, recorded: r.output.includes(`[egress-guard record]`) && r.output.includes(`BLOCKED fetch ${TARGET}`) }).toEqual({ exitCode: 0, recorded: true });
  });

  test("a loopback-only run passes", () => {
    const r = runProbe("clean", `import { test, expect } from "bun:test";\ntest("loopback", async () => { const s = Bun.serve({ port: 19762, hostname: "127.0.0.1", fetch: () => new Response("ok") }); try { expect(await (await fetch("http://127.0.0.1:19762/")).text()).toBe("ok"); } finally { s.stop(true); } });\n`);
    expect({ exitCode: r.exitCode, output: r.exitCode === 0 ? "" : r.output }).toEqual({ exitCode: 0, output: "" });
  });
});
