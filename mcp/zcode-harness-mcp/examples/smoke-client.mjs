/**
 * Smoke client: speaks MCP over stdio to a freshly spawned bridge and prints
 * the results. Used by the acceptance flow; safe to run manually:
 *   node examples/smoke-client.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const dataDir = process.env.SMOKE_DATA_DIR ?? path.join(os.tmpdir(), `zcode-harness-smoke-${Date.now()}`);
fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });

const args = [
  path.join(projectRoot, "dist", "index.js"),
  "--stdio",
  "--data-dir", dataDir,
  "--allow-workspace", process.env.SMOKE_WORKSPACE ?? projectRoot,
];
if (process.env.SMOKE_RUNTIME_PATH) args.push("--runtime-path", process.env.SMOKE_RUNTIME_PATH);

const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {
      console.error("unparseable:", line.slice(0, 200));
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));

function call(method, params) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 30_000);
    child.stdin.write(msg);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const result = (resp) => {
  if (resp.error) throw new Error(`MCP error: ${JSON.stringify(resp.error)}`);
  return resp.result;
};

// ---- handshake
const init = result(await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-client", version: "0.0.1" },
}));
console.log("== initialize:", JSON.stringify(init.serverInfo));
notify("notifications/initialized", {});

// ---- tools list
const tools = result(await call("tools/list", {}));
console.log("== tools:", tools.tools.map((t) => t.name).join(", "));

// ---- health
const health = result(await call("tools/call", { name: "zcode_health", arguments: {} }));
const healthData = health.structuredContent ?? JSON.parse(health.content[0].text);
console.log("== health:", JSON.stringify({
  runtime: healthData.runtime,
  degraded: healthData.degraded ?? false,
  readOnly: healthData.bridge.readOnly,
  allowlisted: healthData.allowlistedWorkspaces,
}));

// ---- capabilities (count)
const caps = result(await call("tools/call", { name: "zcode_capabilities", arguments: {} }));
const capCount = (caps.structuredContent?.capabilities ?? []).length;
console.log("== capabilities:", capCount, "entries");

child.stdin.end();
await new Promise((r) => setTimeout(r, 300));
child.kill();
process.exit(0);
