// Manager safety proofs with harmless mock processes (audit §7):
//   - a foreign service on the port is never killed
//   - an unverifiable identity (no key) never triggers a kill
//   - a reused pid (start time mismatch) never triggers a kill
//   - a verified-own process IS stopped cleanly
//   - doctor/logs survive a missing config without crashing
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { createManager } from "../proxy/zcode-proxy-manager.mjs";

const TMP = join(import.meta.dirname, "fakehome", "manager");
const KEY = "test-key-abc123";
let server = null;
let portCounter = 18600;

function tmpRoot() {
  const root = join(TMP, `case-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "proxy"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  return root;
}

function writeConfig(root, port) {
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\n`);
  writeFileSync(join(root, ".proxykey"), KEY + "\n");
}

/**
 * Mock proxy variants:
 *   mode "ours"          — answers the kit identity payload without auth check
 *   mode "wrong-key"     — 401 for every key (a foreign service with its own auth)
 *   mode "wrong-payload" — 200 with a different provider identity
 */
async function startMockProxy(port, { mode = "ours" } = {}) {
  const srv = http.createServer((req, res) => {
    if (mode === "wrong-key") {
      res.writeHead(401).end();
      return;
    }
    if (req.url === "/health") {
      const payload = mode === "wrong-payload" ? { status: "ok", provider: "someone-else" } : { status: "ok", provider: "zai" };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  return srv;
}

/** Harmless long-running node process, tracked for kill assertions. */
function spawnDummy() {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"], { stdio: "ignore" });
  return child;
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});
afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
});

test("stop refuses to kill a foreign service on the port", async () => {
  const root = tmpRoot();
  const port = ++portCounter;
  writeConfig(root, port);
  server = await startMockProxy(port, { mode: "wrong-key" }); // foreign service: 401 for every key
  const dummy = spawnDummy();
  try {
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: dummy.pid, startedMs: Date.now() }) + "\n");
    const m = createManager({ root, home: TMP });
    const code = await m.stop();
    assert.equal(code, 3, "stop must report the foreign service and refuse");
    assert.ok(m.pidAlive(dummy.pid), "the foreign process must still be alive");
  } finally {
    try { dummy.kill(); } catch {}
  }
});

test("stop is fail-closed when the key is missing (identity unverifiable)", async () => {
  const root = tmpRoot();
  const port = ++portCounter;
  writeConfig(root, port);
  rmSync(join(root, ".proxykey")); // no key → identity check impossible
  server = await startMockProxy(port, { mode: "ours" }); // would answer as "ours" with any key
  const dummy = spawnDummy();
  try {
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: dummy.pid, startedMs: Date.now() }) + "\n");
    const m = createManager({ root, home: TMP });
    const code = await m.stop();
    assert.equal(code, 5, "stop must refuse with a missing key");
    assert.ok(m.pidAlive(dummy.pid), "the process must still be alive");
  } finally {
    try { dummy.kill(); } catch {}
  }
});

test("stop refuses a reused pid whose start time does not match the pid file", async () => {
  const root = tmpRoot();
  const port = ++portCounter;
  writeConfig(root, port);
  server = await startMockProxy(port, { mode: "ours" }); // answers the kit identity payload
  const dummy = spawnDummy();
  try {
    // Record a start time 10 years ago → the live process cannot be the one recorded.
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: dummy.pid, startedMs: Date.now() - 10 * 365 * 24 * 3600 * 1000 }) + "\n");
    const m = createManager({ root, home: TMP });
    const code = await m.stop();
    assert.equal(code, 4, "stop must refuse on PID-reuse suspicion");
    assert.ok(m.pidAlive(dummy.pid), "the reused-pid process must still be alive");
  } finally {
    try { dummy.kill(); } catch {}
  }
});

test("stop is fail-closed when the live start time is undeterminable (start-unknown)", async () => {
  const root = tmpRoot();
  const port = ++portCounter;
  writeConfig(root, port);
  server = await startMockProxy(port, { mode: "ours" });
  const dummy = spawnDummy();
  try {
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: dummy.pid, startedMs: Date.now() }) + "\n");
    // Platform limitation simulated: the start time cannot be queried at all —
    // PID reuse cannot be ruled out, so the kill must be refused (audit §7).
    const m = createManager({ root, home: TMP, processStartMsImpl: () => null });
    const code = await m.stop();
    assert.equal(code, 4, "undeterminable start time must refuse the kill, not proceed");
    assert.ok(m.pidAlive(dummy.pid), "the process must still be alive");
  } finally {
    try { dummy.kill(); } catch {}
  }
});

test("stop cleanly kills a verified-own process (identity + pid + start time match)", async () => {
  const root = tmpRoot();
  const port = ++portCounter;
  writeConfig(root, port);
  server = await startMockProxy(port, { withAuth: false });
  const dummy = spawnDummy();
  try {
    const realStart = new Promise((r) => setTimeout(() => r(null), 0)); // start time queried inside manager
    await realStart;
    const startedMs = createManager({ root, home: TMP }).processStartMs(dummy.pid);
    assert.ok(startedMs !== null, "test premise: start time determinable on this platform");
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: dummy.pid, startedMs }) + "\n");
    const m = createManager({ root, home: TMP });
    const code = await m.stop();
    assert.equal(code, 0, "verified-own process must be stopped");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(m.pidAlive(dummy.pid), false, "the process must be gone");
    assert.equal(existsSync(join(root, "logs", "proxy.pid")), false, "pid file cleaned up");
  } finally {
    try { dummy.kill(); } catch {}
  }
});

test("doctor and logs survive a missing config", async () => {
  const root = tmpRoot();
  const m = createManager({ root, home: TMP });
  const code = await m.doctor(); // must not throw; config check FAILs, doctor reports
  assert.equal(code, 1);
  assert.equal(m.logs(5), 0);
});
