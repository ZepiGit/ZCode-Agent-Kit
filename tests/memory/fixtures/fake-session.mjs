#!/usr/bin/env node
// Stand-in for one harness session (S3): what a real session costs the kit
// besides the proxy is its own MCP bridge (node dist/index.js --stdio) with
// the bridge's runtime. Starts the real bridge against the fixture runtime
// (mcp/zcode-harness-mcp/test/fixture/fake-harness.mjs), initializes it, asks
// for health, holds for S3_HOLD_MS, then closes stdin and exits.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const mcp = join(root, "mcp", "zcode-harness-mcp");
const fixture = join(mcp, "test", "fixture", "fake-harness.mjs");
const data = join(process.env.TMPDIR ?? "/tmp", `s3-session-${process.pid}`);
const ws = join(data, "ws");
mkdirSync(join(data, "workspaces"), { recursive: true });
mkdirSync(ws, { recursive: true });
const hold = Number(process.env.S3_HOLD_MS ?? 8000);

const bridge = spawn(process.execPath, [join(mcp, "dist", "index.js"), "--stdio", "--data-dir", data, "--allow-workspace", ws, "--runtime-path", fixture], {
  stdio: ["pipe", "pipe", "ignore"],
  env: { ...process.env, ZCODE_HARNESS_RUNTIME_PATH: fixture, ZCODE_HARNESS_LOG_LEVEL: "warn" },
});
let buf = "";
const waiters = new Map();
bridge.stdout.on("data", (b) => {
  buf += b;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); waiters.get(m.id)?.(m); waiters.delete(m.id); } catch {}
  }
});
let id = 0;
const call = (method, params) => new Promise((r) => {
  const n = ++id;
  waiters.set(n, r);
  bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  setTimeout(() => { if (waiters.delete(n)) r(null); }, 20_000).unref();
});
await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "s3-session", version: "0" } });
bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
await call("tools/call", { name: "zcode_health", arguments: {} });
await new Promise((r) => setTimeout(r, hold));
bridge.stdin.end();
await new Promise((r) => { bridge.once("exit", r); setTimeout(() => { bridge.kill("SIGKILL"); r(); }, 5000).unref(); });
process.exit(0);
