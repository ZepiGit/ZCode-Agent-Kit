/**
 * Wire transcripts of the bridge's MCP surface: fixed raw JSON-RPC
 * conversations over stdio and over HTTP, and what the bridge answered, byte
 * for byte. The transcripts under test/fixture/wire/ were recorded once and
 * are replayed by wire-replay.test.mjs, so a change of the MCP library (or of
 * the bridge's own server code) that alters a single byte a 2025-era client
 * sees fails a test.
 *
 * Only requests with an answer that does not depend on the run are scripted
 * (no paths, times, ids or process state). An answer longer than 4 KiB (the
 * tool list, the capability registry) is kept as its SHA-256, its length and
 * its first characters instead of its text.
 *
 *   node test/integration/wire-transcript.mjs --write   re-record the fixtures
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_NODE_FLAGS, isolatedTestEnv } from "./client.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturePath = path.join(projectRoot, "test", "fixture", "fake-harness.mjs");
export const WIRE_DIR = path.join(projectRoot, "test", "fixture", "wire");
export const HTTP_KEY = "wire-transcript-key";

const rpc = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const note = (method, params) => JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
const initialize = (id, protocolVersion) =>
  rpc(id, "initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "wire-transcript", version: "0.0.1" } });

/** What a transcript keeps of an answer: its text, or its digest when it is long. */
function pin(text) {
  if (text.length <= 4096) return text;
  return { sha256: createHash("sha256").update(text, "utf8").digest("hex"), bytes: Buffer.byteLength(text, "utf8"), head: text.slice(0, 160) };
}

/** The requests a full session sends after its handshake. */
function surface(firstId) {
  let id = firstId;
  return [
    rpc(id++, "ping"),
    rpc(id++, "tools/list"),
    rpc(id++, "tools/list", {}),
    rpc(id++, "resources/list", {}),
    rpc(id++, "resources/read", { uri: "zcode://capabilities" }),
    rpc(id++, "resources/read", { uri: "zcode://tasks/task-missing/status" }),
    rpc(id++, "resources/read", { uri: "zcode://nothing/here" }),
    rpc(id++, "tools/call", { name: "zcode_capabilities", arguments: {} }),
    rpc(id++, "tools/call", { name: "zcode_no_such_tool", arguments: {} }),
    rpc(id++, "tools/call", { name: "zcode_task_get", arguments: {} }),
    rpc(id++, "tools/call", { name: "zcode_task_get", arguments: { taskId: "task-missing" } }),
    rpc(id++, "tools/call", { name: "zcode_operation_describe", arguments: { method: "session/create" } }),
    rpc("string-id", "ping"),
    rpc(id++, "resources/templates/list", {}),
    rpc(id++, "prompts/list", {}),
    rpc(id++, "logging/setLevel", { level: "info" }),
    rpc(id++, "completion/complete", { ref: { type: "ref/prompt", name: "x" }, argument: { name: "a", value: "b" } }),
    rpc(id++, "server/discover", {}),
    rpc(id++, "no/such/method", {}),
    rpc(id++, "resources/read", {}),
    rpc(id++, "tools/call", {}),
  ];
}

/** The short form for the other versions: the handshake decides, the surface is the same code. */
function brief(firstId) {
  let id = firstId;
  return [
    rpc(id++, "ping"),
    rpc(id++, "resources/list", {}),
    rpc(id++, "resources/read", { uri: "zcode://nothing/here" }),
    rpc(id++, "tools/call", { name: "zcode_no_such_tool", arguments: {} }),
    rpc(id++, "server/discover", {}),
  ];
}

/** Protocol versions with the full surface, and versions a client may also ask for (the last two are not 2025-era revisions). */
export const FULL_VERSIONS = ["2025-06-18", "2025-11-25"];
export const OTHER_VERSIONS = ["2025-03-26", "2024-11-05", "2026-07-28", "1999-01-01"];
const VERSIONS = [...FULL_VERSIONS.map((v) => [v, surface]), ...OTHER_VERSIONS.map((v) => [v, brief])];

export const STDIO_SESSIONS = [
  ...VERSIONS.map(([v, requests]) => ({
    name: `stdio ${v}`,
    send: [initialize(1, v), note("notifications/initialized", {}), ...requests(2)],
  })),
  // A client that skips the handshake, and messages the handshake refuses.
  { name: "stdio without initialize", send: [rpc(1, "tools/list", {}), rpc(2, "ping")] },
  {
    name: "stdio malformed initialize",
    send: [
      rpc(1, "initialize", { capabilities: {}, clientInfo: { name: "wire-transcript", version: "0.0.1" } }),
      rpc(2, "initialize", { protocolVersion: "2025-06-18" }),
      rpc(3, "initialize", {}),
      initialize(4, "2025-06-18"),
      initialize(5, "2025-06-18"),
    ],
  },
];

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const post = (name, body, headers = {}) => ({ name, method: "POST", path: "/mcp", headers: { ...JSON_HEADERS, ...headers }, body });

export const HTTP_REQUESTS = [
  ...VERSIONS.flatMap(([v, requests]) => [
    post(`initialize ${v}`, initialize(1, v)),
    ...requests(2).map((body, i) => post(`${v} #${i} ${JSON.parse(body).method}`, body, { "mcp-protocol-version": v })),
    post(`${v} notification`, note("notifications/initialized", {}), { "mcp-protocol-version": v }),
    post(`${v} batch`, `[${rpc(1, "ping")},${rpc(2, "resources/list", {})},${note("notifications/initialized", {})}]`, { "mcp-protocol-version": v }),
  ]),
  // No MCP-Protocol-Version header at all (what a 2025-03-26 client sends).
  ...brief(2).map((body, i) => post(`no version header #${i} ${JSON.parse(body).method}`, body)),
  post("accept json only", rpc(1, "ping"), { accept: "application/json" }),
  post("accept event-stream only", rpc(1, "ping"), { accept: "text/event-stream" }),
  post("accept anything", rpc(1, "ping"), { accept: "*/*" }),
  { name: "no accept header", method: "POST", path: "/mcp", headers: { "content-type": "application/json" }, body: rpc(1, "ping") },
  { name: "text/plain body", method: "POST", path: "/mcp", headers: { "content-type": "text/plain", accept: JSON_HEADERS.accept }, body: rpc(1, "ping") },
  post("invalid json", "{not json"),
  post("json but not json-rpc", JSON.stringify({ hello: "world" })),
  post("empty batch", "[]"),
  post("batch of 101", `[${Array.from({ length: 101 }, (_, i) => rpc(i + 1, "ping")).join(",")}]`),
  post("response-only body", JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })),
  post("session id header is ignored", rpc(1, "ping"), { "mcp-session-id": "not-a-session" }),
  { name: "GET /mcp", method: "GET", path: "/mcp", headers: { accept: "text/event-stream" } },
  { name: "DELETE /mcp", method: "DELETE", path: "/mcp", headers: {} },
  { name: "PUT /mcp", method: "PUT", path: "/mcp", headers: JSON_HEADERS, body: rpc(1, "ping") },
  { ...post("POST /other", rpc(1, "ping")), path: "/other" },
  { ...post("no bearer", rpc(1, "ping")), auth: null },
  { ...post("wrong bearer", rpc(1, "ping")), auth: "Bearer wrong-key" },
  { ...post("foreign host", rpc(1, "ping")), host: "attacker.example:1" },
  { ...post("foreign origin", rpc(1, "ping")), origin: "http://127.0.0.1.evil.example" },
  { ...post("own origin", rpc(1, "ping")), origin: "self" },
  { name: "declared body over 4 MiB", method: "POST", path: "/mcp", headers: { ...JSON_HEADERS, "content-length": String(4 * 1024 * 1024 + 1) } },
];

function bridgeArgs(dataDir, extra) {
  return [...BRIDGE_NODE_FLAGS, path.join(projectRoot, "dist", "index.js"), ...extra, "--data-dir", dataDir, "--runtime-path", fixturePath];
}

function freshDataDir(label) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `zh-wire-${label}-`));
  fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
  return dataDir;
}

async function stopChild(child, how) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  how();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

/**
 * One stdio session: every line of `send` in order, waiting for the answer of
 * each request before the next line. Returns the raw stdout lines in the order
 * they arrived. A final ping proves nothing else was pending: any line the
 * bridge wrote that no request explains would sit before the ping's answer.
 */
export async function recordStdioSession(session) {
  const dataDir = freshDataDir("stdio");
  const child = spawn(process.execPath, bridgeArgs(dataDir, ["--stdio"]), {
    stdio: ["pipe", "pipe", "ignore"],
    env: isolatedTestEnv(dataDir, { ZCODE_HARNESS_RUNTIME_PATH: fixturePath, ZCODE_HARNESS_LOG_LEVEL: "error" }),
  });
  const lines = [];
  let buf = "";
  let wake = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
    wake?.();
  });
  const lineCount = async (n) => {
    const deadline = Date.now() + 20_000;
    while (lines.length < n) {
      if (Date.now() > deadline) throw new Error(`${session.name}: no answer after ${lines.length} lines (waiting for ${n})`);
      await new Promise((r) => { wake = r; setTimeout(r, 200); });
    }
  };
  try {
    let expected = 0;
    for (const line of [...session.send, rpc("end-of-session", "ping")]) {
      child.stdin.write(line + "\n");
      if (JSON.parse(line).id !== undefined) {
        expected += 1;
        await lineCount(expected);
      }
    }
    return { name: session.name, send: session.send, received: lines.slice(0, -1).map(pin), end: lines.at(-1) };
  } finally {
    await stopChild(child, () => child.stdin.end());
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

export async function recordStdio(sessions = STDIO_SESSIONS) {
  const out = [];
  for (const session of sessions) out.push(await recordStdioSession(session));
  return out;
}

// Response headers that depend on the connection or the clock, not on the bridge's answer.
const VOLATILE_HEADERS = new Set(["date", "connection", "keep-alive"]);

function httpExchange(port, request) {
  return new Promise((resolve, reject) => {
    const headers = { ...request.headers };
    if (request.auth !== null) headers.authorization = request.auth ?? `Bearer ${HTTP_KEY}`;
    if (request.host) headers.host = request.host;
    if (request.origin) headers.origin = request.origin === "self" ? `http://127.0.0.1:${port}` : `${request.origin}:${port}`;
    const req = http.request({ host: "127.0.0.1", port, method: request.method, path: request.path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const shown = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          if (!VOLATILE_HEADERS.has(res.rawHeaders[i].toLowerCase())) shown.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
        }
        resolve({ status: res.statusCode, headers: shown.sort(), body: pin(Buffer.concat(chunks).toString("utf8")) });
      });
    });
    req.on("error", reject);
    // A declared length without a body: the refusal comes from the headers alone.
    if (request.body === undefined && headers["content-length"]) req.flushHeaders();
    else req.end(request.body);
  });
}

/** Every request of `requests` against one HTTP bridge, one at a time, each on its own connection. */
export async function recordHttp(requests = HTTP_REQUESTS) {
  const dataDir = freshDataDir("http");
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, bridgeArgs(dataDir, ["--http", "--http-key", HTTP_KEY, "--port", String(port), "--host", "127.0.0.1"]), {
    stdio: ["ignore", "ignore", "ignore"],
    env: isolatedTestEnv(dataDir, { ZCODE_HARNESS_RUNTIME_PATH: fixturePath, ZCODE_HARNESS_LOG_LEVEL: "error" }),
  });
  try {
    for (let i = 0; ; i += 1) {
      const up = await httpExchange(port, { method: "GET", path: "/mcp", headers: {} }).catch(() => null);
      if (up) break;
      if (i > 50) throw new Error("the HTTP bridge did not come up");
      await new Promise((r) => setTimeout(r, 100));
    }
    const out = [];
    for (const request of requests) {
      const { name, ...sent } = request;
      const answer = await httpExchange(port, request);
      // The port is chosen per run; it appears in no answer, only in what was sent.
      out.push({ name, request: sent, response: answer });
    }
    return out;
  } finally {
    await stopChild(child, () => child.kill("SIGTERM"));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

export function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(WIRE_DIR, name), "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--write")) {
    process.stderr.write("usage: node test/integration/wire-transcript.mjs --write\n");
    process.exit(2);
  }
  fs.mkdirSync(WIRE_DIR, { recursive: true });
  fs.writeFileSync(path.join(WIRE_DIR, "legacy-stdio.json"), JSON.stringify(await recordStdio(), null, 1) + "\n");
  fs.writeFileSync(path.join(WIRE_DIR, "legacy-http.json"), JSON.stringify(await recordHttp(), null, 1) + "\n");
  process.stdout.write(`recorded ${WIRE_DIR}\n`);
}
