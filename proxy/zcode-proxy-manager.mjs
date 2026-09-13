#!/usr/bin/env node
// zcode-proxy service manager (user-local, no admin rights).
//
// Usage:
//   node zcode-proxy-manager.mjs start|stop|restart|status|doctor|logs|help
//
// Identity rule: a proxy on the configured port counts as OURS only when the
// authed /health request (with the local key) answers
// {"status":"ok","provider":"zai"}. A foreign process on the port is never
// killed — `stop`/`restart` fail with a port-conflict error instead.
import { spawn, execSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { existsSync, readFileSync, statSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HOME = (process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
const OMP_AGENT = HOME ? HOME + "/.omp/agent" : null;
const MCP_DIR = join(ROOT, "mcp", "zcode-harness-mcp");
const PROXY_SRC = join(ROOT, "zcode-proxy-src");
const CONFIG = join(ROOT, "proxy", "config.yaml");
const KEY_FILE = join(ROOT, ".proxykey");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "proxy.log");
const PID_FILE = join(LOG_DIR, "proxy.pid");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const PORT = Number((readFileSync(CONFIG, "utf8").match(/^  port:\s*(\d+)/m) ?? [])[1] ?? 8457);
const BASE = `http://127.0.0.1:${PORT}`;

function readKey() {
  return readFileSync(KEY_FILE, "utf8").trim();
}

function logLine(msg) {
  console.log(msg);
  try {
    appendLine(LOG_FILE, `[manager ${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function appendLine(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, text);
}

function rotateLogIfNeeded() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      const old = LOG_FILE + ".1";
      try { unlinkSync(old); } catch {}
      renameSync(LOG_FILE, old);
    }
  } catch {}
}

async function healthIdentify(timeoutMs = 2500) {
  // Authenticated identity check: only OUR proxy knows the key AND reports
  // the expected identity payload. Returns "ours" | "foreign" | "down".
  let key;
  try {
    key = readKey();
  } catch {
    return "nokey";
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/health`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 401) return "foreign"; // something answered, wrong secret
    if (res.status !== 200) return "foreign";
    const j = JSON.parse(text);
    if (j?.status === "ok" && j?.provider === "zai") return "ours";
    return "foreign";
  } catch {
    return "down";
  } finally {
    clearTimeout(t);
  }
}

function readPidFile() {
  try {
    const raw = readFileSync(PID_FILE, "utf8").trim().split("\n");
    const pid = Number(raw[0]);
    const started = raw[1];
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, started };
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill a pid and its whole child tree (Windows: bun spawns a serving child). */
function killTree(pid) {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function start({ waitMs = 25000 } = {}) {
  rotateLogIfNeeded();
  const state = await healthIdentify();
  if (state === "ours") {
    const pidInfo = readPidFile();
    logLine("already running" + (pidInfo ? ` (pid ${pidInfo.pid})` : ""));
    return 0;
  }
  if (state === "foreign") {
    logLine(`ERROR: port ${PORT} is occupied by a foreign service (auth failed). Not touching it.`);
    return 3;
  }
  // stale pid file?
  const stale = readPidFile();
  if (stale && !pidAlive(stale.pid)) {
    try { unlinkSync(PID_FILE); } catch {}
  }
  if (!existsSync(join(PROXY_SRC, "node_modules"))) {
    logLine("ERROR: proxy dependencies missing. Run: cd zcode-proxy-src && bun install --frozen-lockfile");
    return 4;
  }
  logLine("starting zcode-proxy ...");
  const out = openLogStream();
  const child = spawn("bun", ["run", "src/index.ts", "serve"], {
    cwd: PROXY_SRC,
    env: { ...process.env, ZCODE_PROXY_CONFIG: CONFIG, ZCODE_LOG_FORMAT: "compact" },
    detached: true,
    stdio: ["ignore", out.fd, out.fd],
  });
  child.unref();
  writeFileSync(PID_FILE, `${child.pid}\n${new Date().toISOString()}\n`);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await sleep(600);
    const s = await healthIdentify(1500);
    if (s === "ours") {
      logLine(`started (pid ${child.pid}) — healthy on ${BASE}`);
      out.close();
      return 0;
    }
    if (s === "foreign") {
      logLine(`ERROR: port ${PORT} taken by a foreign service during startup (pid ${child.pid}).`);
      killTree(child.pid); // do not leave our own spawned child behind
      try { unlinkSync(PID_FILE); } catch {}
      out.close();
      return 3;
    }
  }
  logLine(`ERROR: proxy did not become healthy within ${waitMs}ms (pid ${child.pid}). See ${LOG_FILE}`);
  killTree(child.pid);
  try { unlinkSync(PID_FILE); } catch {}
  out.close();
  return 2;
}

function openLogStream() {
  mkdirSync(LOG_DIR, { recursive: true });
  const fd = openSync(LOG_FILE, "a");
  return { fd, close: () => { try { closeSync(fd); } catch {} } };
}

function mkdir(dir) {
  mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function stop() {
  const pidInfo = readPidFile();
  const state = await healthIdentify();
  if (state === "foreign") {
    logLine(`ERROR: something foreign is on port ${PORT}. Refusing to stop anything.`);
    return 3;
  }
  if (state === "down") {
    if (pidInfo) { try { unlinkSync(PID_FILE); } catch {} }
    logLine("not running");
    return 0;
  }
  if (!pidInfo) {
    logLine("ERROR: proxy healthy but no pid file — refusing to guess. Remove it manually if intended.");
    return 4;
  }
  if (!pidAlive(pidInfo.pid)) {
    try { unlinkSync(PID_FILE); } catch {}
    logLine(`stale pid file removed (pid ${pidInfo.pid} not alive)`);
    return 0;
  }
  if (!killTree(pidInfo.pid)) {
    logLine(`ERROR killing pid ${pidInfo.pid}`);
    return 2;
  }
  // wait for shutdown
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (!pidAlive(pidInfo.pid)) break;
  }
  if (pidAlive(pidInfo.pid)) {
    logLine(`ERROR: pid ${pidInfo.pid} still alive after stop signal.`);
    return 2;
  }
  try { unlinkSync(PID_FILE); } catch {}
  logLine(`stopped (pid ${pidInfo.pid})`);
  return 0;
}

async function status() {
  const pidInfo = readPidFile();
  const state = await healthIdentify();
  console.log(`port:      ${PORT}`);
  console.log(`pid file:  ${pidInfo ? `${pidInfo.pid} (started ${pidInfo.started})` : "none"}`);
  console.log(`health:    ${state}`);
  if (state === "ours") {
    const key = readKey();
    try {
      const q = await fetch(`${BASE}/quota`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      const j = await q.json();
      if (q.ok) {
        for (const b of j.balances ?? []) {
          console.log(`  quota: ${b.showName} ${b.remainingUnits}/${b.totalUnits} ${b.unitType} (expires ${new Date(b.expiresAt * 1000).toISOString()})`);
        }
      } else {
        console.log(`  quota: HTTP ${q.status}`);
      }
    } catch (err) {
      console.log(`  quota: unavailable (${err.message})`);
    }
  }
  return state === "ours" ? 0 : 1;
}

async function doctor() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add("bun available", existsSyncProcess("bun"), "bun must be on PATH");
  add("config exists", existsSync(CONFIG), CONFIG);
  add("key file exists", existsSync(KEY_FILE), KEY_FILE);
  add("proxy source installed", existsSync(join(PROXY_SRC, "node_modules")), join(PROXY_SRC, "node_modules"));
  add("credentials store", existsSync(join(process.env.USERPROFILE ?? "C:/Users/miche", ".zcode-proxy", "credentials.json")), "~/.zcode-proxy/credentials.json");
  if (OMP_AGENT) {
    add("omp provider registered", ompHasZcode(), "zcode block in ~/.omp/agent/models.yml");
    add("extension installed", existsSync(OMP_AGENT + "/extensions/zcode-proxy-autostart.ts"), "~/.omp/agent/extensions/zcode-proxy-autostart.ts");
  } else {
    add("omp home found", false, "USERPROFILE not set");
  }
  if (existsSync(MCP_DIR)) {
    add("mcp bridge installed", existsSync(join(MCP_DIR, "dist", "index.js")), join(MCP_DIR, "dist", "index.js"));
    add("mcp bridge deps", existsSync(join(MCP_DIR, "node_modules")), join(MCP_DIR, "node_modules"));
  }
  const state = await healthIdentify();
  add("proxy reachable + identity", state === "ours", `health=${state}`);
  const jwtAge = state === "ours" ? await jwtAgeHours() : null;
  add("start-plan JWT fresh-ish", jwtAge === null ? false : jwtAge < 720, jwtAge === null ? "unknown (proxy down)" : `${jwtAge.toFixed(1)}h since issue`);
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    if (!c.ok) failed++;
  }
  console.log(failed === 0 ? "doctor: all checks passed" : `doctor: ${failed} check(s) failed`);
  return failed === 0 ? 0 : 1;
}

function existsSyncProcess(cmd) {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    execSync(`${which} ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function ompHasZcode() {
  try {
    const yml = readFileSync(OMP_AGENT + "/models.yml", "utf8");
    return /^  zcode:\s*$/m.test(yml);
  } catch {
    return false;
  }
}

async function jwtAgeHours() {
  try {
    const key = readKey();
    const q = await fetch(`${BASE}/quota`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    const j = await q.json();
    const issuedAt = j?.jwt?.issuedAt;
    if (!issuedAt) return null;
    return (Date.now() / 1000 - issuedAt) / 3600;
  } catch {
    return null;
  }
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  mkdir(LOG_DIR);
  switch (cmd) {
    case "start": process.exit(await start()); break;
    case "stop": process.exit(await stop()); break;
    case "restart": process.exit(await stop() || await start()); break;
    case "status": process.exit(await status()); break;
    case "doctor": process.exit(await doctor()); break;
    case "logs": {
      const n = Number(process.argv[3] ?? 40);
      const { readFileSync } = require("node:fs");
      const lines = readFileSync(LOG_FILE, "utf8").trim().split("\n");
      console.log(lines.slice(-n).join("\n"));
      break;
    }
    default:
      console.log("zcode-proxy-manager — start|stop|restart|status|doctor|logs [n]");
  }
}

main().catch((err) => {
  console.error("manager error:", err.message);
  process.exit(1);
});
