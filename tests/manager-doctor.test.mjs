// Seam 2: the manager's `doctor` (ticket 38, spec §10 migration step 3,
// ADR-0001 Round 2 amendment). The manager CLI's own `doctor` keeps the
// legacy off-TTY grammar byte for byte: each fixture state below spawns
// `node proxy/zcode-proxy-manager.mjs doctor` in a kit copy and compares
// stdout, the exit code and stderr with a snapshot captured on the code
// before ticket 38 (tests/snapshots/manager-doctor/, written once with
// UPDATE_SNAPSHOTS=1 at the integration tip 91fa58f).
//
// Fixtures: a temp kit root that is its own state directory, a temp HOME, a
// fixture credential store read by a fixture `src/auth/store.ts` (no real
// credential, B2), Bun named through ZCODE_KIT_BUN (or no Bun at all), and a
// stand-in proxy on a free loopback port in this process. Normalised: the
// fixture root (<KIT>, with `/` separators), the Bun path and its version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBun } from "../lib/process.mjs";
import { matchSnapshot } from "./snapshot-harness.mjs";

const ROOT = join(import.meta.dirname, "..");
const KEY = "synthetic-doctor-key";

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolvePort(port)); });
  });
}

function bunOrFail() {
  try { return resolveBun(ROOT); } catch (err) { assert.fail(`the doctor's Bun checks need Bun: ${err.message}`); }
}

// Answers the credential probe with "decryptable" only for a store file whose
// content says so: the probe's boolean is all the manager sees.
const FAKE_STORE = `
import { readFileSync } from "node:fs";
export async function loadCredential() {
  const text = readFileSync(process.env.ZCODE_PROXY_CREDENTIALS_PATH, "utf8");
  return text.includes("decryptable") ? { apiKey: "fixture-not-a-key" } : null;
}
`;

/**
 * A kit copy (cli/, lib/, the manager) in a temp root that is its own state
 * directory. `configured` writes config + key; `installed` adds the proxy
 * source's node_modules and the MCP bridge; `artifacts` the claude/codex
 * adapter outputs; `omp` an OMP install ("managed", "skipped" or "unasked").
 */
function kitFixture(t, { port, configured = false, installed = false, artifacts = false, omp = null, store = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-manager-doctor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const member of ["cli", "lib"]) cpSync(join(ROOT, member), join(root, member), { recursive: true });
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "home"));
  cpSync(join(ROOT, "proxy", "zcode-proxy-manager.mjs"), join(root, "proxy", "zcode-proxy-manager.mjs"));
  mkdirSync(join(root, "zcode-proxy-src", "src", "auth"), { recursive: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "auth", "store.ts"), FAKE_STORE);
  if (configured) {
    writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nauth:\n  proxyApiKey: "${KEY}"\n`);
    writeFileSync(join(root, ".proxykey"), KEY + "\n");
  }
  if (installed) {
    mkdirSync(join(root, "zcode-proxy-src", "node_modules"));
    mkdirSync(join(root, "mcp", "zcode-harness-mcp", "dist"), { recursive: true });
    writeFileSync(join(root, "mcp", "zcode-harness-mcp", "dist", "index.js"), "// fixture bridge\n");
    mkdirSync(join(root, "mcp", "zcode-harness-mcp", "node_modules"));
  }
  if (artifacts) {
    mkdirSync(join(root, "generated", "codex-home"), { recursive: true });
    writeFileSync(join(root, "generated", "claude-zcode-settings.json"), "{}\n");
    writeFileSync(join(root, "generated", "codex-home", "config.toml"), "# fixture\n");
  }
  if (omp) {
    const agent = join(root, "home", ".omp", "agent");
    mkdirSync(join(agent, "extensions"), { recursive: true });
    const managed = omp === "managed";
    writeFileSync(join(agent, "models.yml"), managed
      ? "providers:\n  zcode:\n# >>> zcode-kit (managed block)\n    name: zcode\n# <<< zcode-kit (managed block)\n"
      : "providers:\n  openai:\n    name: OpenAI\n");
    if (managed) writeFileSync(join(agent, "extensions", "zcode-proxy-autostart.ts"), "// fixture\n");
    if (omp !== "unasked") {
      mkdirSync(join(root, "generated", "harness-choices"), { recursive: true });
      writeFileSync(join(root, "generated", "harness-choices", "omp.json"), JSON.stringify({ schema: 1, decision: managed ? "configured" : "skipped", source: "setup", decidedAt: "2026-11-01T00:00:00.000Z" }) + "\n");
    }
  }
  if (store) writeFileSync(join(root, "credentials.json"), store === "decryptable" ? "decryptable fixture\n" : "opaque fixture\n");
  return root;
}

/** The manager CLI spawned asynchronously (the stand-in proxy answers from this process). */
function managerDoctor(root, { bun = bunOrFail(), store = false, extraEnv = {} } = {}) {
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home") };
  // Ambient kit/proxy variables would change the rows; the fixture sets its own.
  for (const name of Object.keys(env)) {
    if (/^ZCODE_(?:KIT_STATE_DIR|KIT_BUN|PROXY_|CLAIM_|ASYNC_|DUMP_)/.test(name)) delete env[name];
  }
  Object.assign(env, extraEnv);
  if (bun) env.ZCODE_KIT_BUN = bun;
  else { env.PATH = join(root, "empty-path"); mkdirSync(env.PATH); }
  if (store) env.ZCODE_PROXY_CREDENTIALS_PATH = join(root, "credentials.json");
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "doctor"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => { stdout += c; });
    child.stderr.setEncoding("utf8").on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(timer); resolveRun({ code, signal, stdout, stderr, bun }); });
  });
}

/** Explicit normalisation: the fixture root, the Bun path and the Bun version. Nothing else. */
function normalise(text, root, bun) {
  let out = text;
  for (const spelling of new Set([realpathSync.native(root), root])) out = out.split(spelling).join("<KIT>");
  out = out.replace(/<KIT>[^\s)]*/g, (path) => path.replace(/\\/g, "/"));
  if (bun) out = out.split(bun).join("<BUN>").replace(/<BUN> \(\d+\.\d+\.\d+[^)]*\)/g, "<BUN> (<VERSION>)");
  return out;
}

function snapshotText(run, root) {
  assert.equal(run.signal, null, "the manager doctor finished on its own");
  return `${normalise(run.stdout, root, run.bun)}[exit ${run.code}]\n${run.stderr ? `[stderr]\n${normalise(run.stderr, root, run.bun)}` : ""}`;
}

/** A stand-in proxy: the identity proof and /quota, both authenticated with the fixture key. */
async function standIn(t, port, { health = "ours", quota = "healthy" } = {}) {
  const server = http.createServer((req, res) => {
    if (health === "foreign") return res.writeHead(401).end("{}");
    if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end("{}");
    if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", provider: "zai" }));
    if (req.url === "/quota") {
      if (quota === "rejected") return res.writeHead(401).end(JSON.stringify({ error: { code: 401 } }));
      // Issued five hours before the request, so the age row reads 5.0h.
      const now = Math.floor(Date.now() / 1000);
      return res.end(JSON.stringify({ provider: "zai", serverTime: now, balances: [], jwt: { issuedAt: now - 5 * 3600 } }));
    }
    res.writeHead(404).end("{}");
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
}

test("manager doctor, fresh kit (no config, no key, nothing installed): legacy rows, exit 1", { timeout: 90_000 }, async (t) => {
  const root = kitFixture(t);
  matchSnapshot("manager-doctor/fresh.txt", snapshotText(await managerDoctor(root), root));
});

test("manager doctor, configured with the proxy down, env overrides set and a decryptable store: exit 1", { timeout: 90_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, { port, configured: true, installed: true, artifacts: true, omp: "managed", store: "decryptable" });
  const run = await managerDoctor(root, { store: true, extraEnv: { ZCODE_PROXY_PORT: "1", ZCODE_CLAIM_FIXTURE: "1" } });
  matchSnapshot("manager-doctor/proxy-down.txt", snapshotText(run, root));
});

test("manager doctor, own proxy running and every check passing: exit 0", { timeout: 90_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, { port, configured: true, installed: true, artifacts: true, omp: "managed", store: "decryptable" });
  await standIn(t, port);
  matchSnapshot("manager-doctor/proxy-running.txt", snapshotText(await managerDoctor(root, { store: true }), root));
});

test("manager doctor, own proxy running, rejected auth, an undecryptable store and OMP skipped: exit 1", { timeout: 90_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, { port, configured: true, omp: "skipped", store: "opaque" });
  await standIn(t, port, { quota: "rejected" });
  matchSnapshot("manager-doctor/proxy-running-auth-rejected.txt", snapshotText(await managerDoctor(root, { store: true }), root));
});

test("manager doctor, a foreign listener, no Bun and OMP never asked: exit 1", { timeout: 90_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, { port, configured: true, installed: true, omp: "unasked" });
  await standIn(t, port, { health: "foreign" });
  matchSnapshot("manager-doctor/foreign-no-bun.txt", snapshotText(await managerDoctor(root, { bun: null }), root));
});
