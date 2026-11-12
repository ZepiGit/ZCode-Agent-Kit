/**
 * Seam 7 (spec §6 b): the bridge's startup footprint.
 *   - stdio mode never loads the HTTP transport (node:http, the SDK's
 *     streamable HTTP transport, hono): it is imported lazily;
 *   - HTTP mode still loads it and serves MCP unchanged;
 *   - the test client starts the bridge the way the kit's generated harness
 *     entries do: `--max-semi-space-size=1` on the Node command line, never
 *     in NODE_OPTIONS.
 * A preload (test/fixture/module-trace.mjs) records every module URL the
 * bridge process resolved and its Node flags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BRIDGE_NODE_FLAGS, isolatedTestEnv, startBridge } from "./client.mjs";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const preload = pathToFileURL(path.join(projectRoot, "test", "fixture", "module-trace.mjs")).href;
const HTTP_MODULE = /^node:https?$|\/server\/streamableHttp\.js$|\/server\/webStandardStreamableHttp\.js$|\/@hono\/node-server\/|\/node_modules\/hono\//;

function tracePath(label) {
  return path.join(os.tmpdir(), `zcode-bridge-trace-${label}-${process.pid}-${Date.now()}.json`);
}

function readTrace(file) {
  const trace = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.rmSync(file, { force: true });
  return trace;
}

test("stdio mode loads no HTTP transport module (lazy HTTP)", async () => {
  const trace = tracePath("stdio");
  const c = await startBridge({ nodeArgs: [...BRIDGE_NODE_FLAGS, "--import", preload], env: { ZCODE_TEST_MODULE_TRACE: trace } });
  try {
    const health = await c.tool("zcode_health", {});
    assert.equal(health.runtime.running !== undefined, true, "health answered over stdio");
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "lazy http", readOnly: true });
    await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
  } finally {
    await c.stop();
  }
  const { urls } = readTrace(trace);
  assert.ok(urls.some((u) => u.endsWith("/sdk/dist/esm/server/stdio.js")), "the trace saw the stdio transport (the hook works)");
  assert.deepEqual(urls.filter((u) => HTTP_MODULE.test(u)), [], "stdio mode resolved no HTTP transport module");
});

test("the test client puts the semi-space flag on the bridge command line, never in NODE_OPTIONS", async () => {
  assert.deepEqual(BRIDGE_NODE_FLAGS, ["--max-semi-space-size=1"]);
  const trace = tracePath("flags");
  const c = await startBridge({ nodeArgs: [...BRIDGE_NODE_FLAGS, "--import", preload], env: { ZCODE_TEST_MODULE_TRACE: trace } });
  await c.stop();
  const t = readTrace(trace);
  assert.ok(t.execArgv.includes("--max-semi-space-size=1"), `bridge execArgv: ${JSON.stringify(t.execArgv)}`);
  assert.doesNotMatch(String(t.nodeOptions ?? ""), /semi-space/, "the flag never travels in NODE_OPTIONS (it would leak to the harness children)");

  const d = await startBridge();
  try {
    const script = d.child.spawnargs.findIndex((a) => a.endsWith(path.join("dist", "index.js")));
    assert.deepEqual(d.child.spawnargs.slice(1, script), BRIDGE_NODE_FLAGS, "default spawn: the flags sit between node and dist/index.js");
    await d.tool("zcode_health", {});
  } finally {
    await d.stop();
  }
});

test("HTTP mode loads the HTTP transport at start and serves MCP", async () => {
  const dataDir = path.join(os.tmpdir(), `zcode-harness-lazy-http-${Date.now()}`);
  fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const trace = tracePath("http");
  const server = spawn(process.execPath, [
    "--import", preload,
    path.join(projectRoot, "dist", "index.js"),
    "--http", "--http-key", "test-key-lazy-http", "--port", String(port), "--host", "127.0.0.1",
    "--data-dir", dataDir,
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    env: isolatedTestEnv(dataDir, {
      ZCODE_HARNESS_RUNTIME_PATH: path.join(projectRoot, "test", "fixture", "fake-harness.mjs"),
      ZCODE_TEST_MODULE_TRACE: trace,
    }),
  });
  const post = (body) => fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer test-key-lazy-http" },
    body: JSON.stringify(body),
  });
  try {
    let res = null;
    for (let i = 0; i < 30 && !res; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      res = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lazy-http", version: "0" } } }).catch(() => null);
    }
    assert.ok(res, "bridge HTTP server came up");
    assert.equal(res.status, 200);
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    assert.equal(JSON.parse(line ? line.slice(5) : text).result.serverInfo.name, "zcode-harness-mcp");
    await new Promise((r) => setTimeout(r, 400)); // the preload's timer flush (a Windows kill runs no exit handler)
  } finally {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const { urls } = readTrace(trace);
  assert.ok(urls.includes("node:http"), "HTTP mode loaded node:http");
  assert.ok(urls.some((u) => u.endsWith("/sdk/dist/esm/server/streamableHttp.js")), "HTTP mode loaded the streamable HTTP transport");
});
