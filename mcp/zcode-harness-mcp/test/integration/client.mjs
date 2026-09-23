/**
 * Shared MCP test client for bridge tests. Speaks real MCP over stdio to a
 * bridge process configured against the fixture harness.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

export function isolatedTestEnv(rootDir, overrides = {}) {
  const home = path.join(rootDir, "home");
  const temp = path.join(rootDir, "temp");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  const xdg = path.join(home, ".config");
  const programFiles = path.join(rootDir, "program-files");
  const programFilesX86 = path.join(rootDir, "program-files-x86");
  for (const dir of [home, temp, appData, localAppData, xdg, programFiles, programFilesX86]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const nodeDir = path.dirname(process.execPath);
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    XDG_CONFIG_HOME: xdg,
    ProgramFiles: programFiles,
    "ProgramFiles(x86)": programFilesX86,
    ProgramW6432: programFiles,
    PATH: [nodeDir, path.join(systemRoot, "System32")].join(path.delimiter),
    ZCODE_PROXY_CREDENTIALS_PATH: path.join(rootDir, "missing-proxy-credentials.json"),
    ZCODE_KIT_SKIP_SMOKE: "1",
    ZCODE_KIT_SKIP_DEPS: "1",
    ZCODE_HARNESS_LOG_LEVEL: "warn",
  };
  for (const [name, value] of Object.entries(overrides)) {
    // Windows environment names are case-insensitive; Node otherwise picks
    // one lexicographically, which can resurrect inherited real-user paths.
    for (const existing of Object.keys(env)) {
      if (existing.toLowerCase() === name.toLowerCase()) delete env[existing];
    }
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export async function startBridge(overrides = {}) {
  const dataDir = overrides.reuseDataDir ?? path.join(os.tmpdir(), `zcode-harness-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
  const workspaceDir = overrides.workspaceDirOverride ?? path.join(dataDir, "ws");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const fixturePath = path.join(projectRoot, "test", "fixture", "fake-harness.mjs");

  const args = [
    path.join(projectRoot, "dist", "index.js"),
    "--stdio",
    "--data-dir", dataDir,
    "--allow-workspace", workspaceDir,
    "--interaction-policy", overrides.interactionPolicy ?? "ask",
    "--interaction-timeout-sec", overrides.interactionTimeoutSec ?? "4",
    "--max-concurrent-tasks", overrides.maxConcurrentTasks ?? "2",
  ];
  if (!overrides.useRealRuntime) args.push("--runtime-path", fixturePath);
  if (overrides.readOnly) args.push("--read-only");
  if (overrides.extraArgs) args.push(...overrides.extraArgs);

  const child = spawn(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: isolatedTestEnv(dataDir, {
      ZCODE_HARNESS_RUNTIME_PATH: overrides.useRealRuntime
        ? String(overrides.env?.ZCODE_HARNESS_RUNTIME_PATH ?? path.join(dataDir, "missing-runtime.cjs"))
        : fixturePath,
      ...overrides.env,
    }),
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
        const { resolve, timer } = client.pending.get(msg.id);
        clearTimeout(timer);
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
      const timer = setTimeout(() => {
        if (client.pending.has(id)) {
          client.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, timeoutMs);
      client.pending.set(id, { resolve, reject, timer });
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
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    for (const { reject, timer } of client.pending.values()) {
      clearTimeout(timer);
      reject(new Error("bridge stopped"));
    }
    client.pending.clear();
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
