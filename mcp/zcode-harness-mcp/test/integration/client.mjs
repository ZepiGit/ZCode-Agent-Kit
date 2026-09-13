/**
 * Shared MCP test client for bridge tests. Speaks real MCP over stdio to a
 * bridge process configured against the fixture harness.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

export async function startBridge(overrides = {}) {
  const dataDir = overrides.reuseDataDir ?? path.join(os.tmpdir(), `zcode-harness-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
  const workspaceDir = overrides.workspaceDirOverride ?? path.join(dataDir, "ws");
  fs.mkdirSync(workspaceDir, { recursive: true });

  const args = [
    path.join(projectRoot, "dist", "index.js"),
    "--stdio",
    "--data-dir", dataDir,
    "--allow-workspace", workspaceDir,
    "--interaction-policy", overrides.interactionPolicy ?? "ask",
    "--interaction-timeout-sec", overrides.interactionTimeoutSec ?? "4",
    "--max-concurrent-tasks", overrides.maxConcurrentTasks ?? "2",
  ];
  if (overrides.readOnly) args.push("--read-only");
  if (overrides.extraArgs) args.push(...overrides.extraArgs);

  const child = spawn(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(overrides.useRealRuntime ? {} : { ZCODE_HARNESS_RUNTIME_PATH: path.join(projectRoot, "test", "fixture", "fake-harness.mjs") }),
      ZCODE_HARNESS_LOG_LEVEL: "warn",
      ...overrides.env,
    },
  });

  const client = {
    child,
    dataDir,
    workspaceDir,
    nextId: 1,
    pending: new Map(),
    notifications: [],
    buf: "",
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    client.buf += chunk;
    let idx;
    while ((idx = client.buf.indexOf("\n")) >= 0) {
      const line = client.buf.slice(0, idx);
      client.buf = client.buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && msg.method === undefined && client.pending.has(msg.id)) {
        const { resolve } = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        resolve(msg);
      } else if (msg.method !== undefined) {
        client.notifications.push(msg);
      }
    }
  });
  child.stderr.on("data", (d) => {
    if (overrides.collectStderr) overrides.collectStderr.push(String(d));
  });

  await new Promise((r) => setTimeout(r, 300));

  client.call = (method, params, timeoutMs = 30_000) => {
    const id = client.nextId++;
    return new Promise((resolve, reject) => {
      client.pending.set(id, { resolve });
      setTimeout(() => {
        if (client.pending.has(id)) {
          client.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, timeoutMs);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };

  client.notify = (method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  };

  client.result = async (method, params, timeoutMs) => {
    const resp = await client.call(method, params, timeoutMs);
    if (resp.error) throw new Error(`MCP error for ${method}: ${JSON.stringify(resp.error)}`);
    return resp.result;
  };

  client.tool = async (name, args, timeoutMs) => {
    const resp = await client.call("tools/call", { name, arguments: args ?? {} }, timeoutMs);
    if (resp.error) throw new Error(`MCP error for ${name}: ${JSON.stringify(resp.error)}`);
    if (resp.result?.isError) {
      const text = resp.result?.content?.[0]?.text ?? "tool error";
      const err = new Error(text);
      err.isToolError = true;
      throw err;
    }
    const sc = resp.result?.structuredContent;
    if (sc !== undefined && sc !== null) return sc;
    const text = resp.result?.content?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  client.expectToolError = async (name, args, timeoutMs) => {
    const resp = await client.call("tools/call", { name, arguments: args ?? {} }, timeoutMs);
    if (resp.result?.isError) return String(resp.result?.content?.[0]?.text ?? "");
    throw new Error(`expected tool error for ${name}, got: ${JSON.stringify(resp.result).slice(0, 200)}`);
  };

  client.stop = async () => {
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200));
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  };

  // initialize
  const init = await client.result("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bridge-test", version: "0.0.1" },
  });
  client.notify("notifications/initialized", {});
  client.serverInfo = init.serverInfo;
  return client;
}
