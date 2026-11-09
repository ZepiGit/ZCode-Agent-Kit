// Seam 2: the manager's `doctor` (ticket 38, spec §10 migration step 3,
// ADR-0001 Round 2 amendment). The manager CLI's own `doctor` keeps the
// legacy off-TTY grammar byte for byte: each fixture state below spawns
// `node proxy/zcode-proxy-manager.mjs doctor` in a kit copy and compares
// stdout, the exit code and stderr with a snapshot captured on the code
// before ticket 38 (tests/snapshots/manager-doctor/, written once with
// UPDATE_SNAPSHOTS=1 at the integration tip 91fa58f). `zcode-kit doctor` and
// `doctor --json` run over the same states against snapshots of the same
// origin (seam 5 spawn tests): its output and exit codes stay as they were
// when it consumes the manager's check records instead of its text.
//
// Fixtures: a temp kit root that is its own state directory, a temp HOME, a
// fixture credential store read by a fixture `src/auth/store.ts` (no real
// credential, B2), Bun named through ZCODE_KIT_BUN (or no Bun at all), and a
// stand-in proxy on a free loopback port in this process. Normalised: the
// fixture root (<KIT>, with `/` separators), the Bun path and its version,
// each in its raw and its JSON-escaped spelling (`doctor --json` prints a
// Windows path with `\\` separators).
//
// The snapshots were captured on Linux. One more platform fact on Windows:
// libuv sorts the environment block of every process it spawns, so a list the
// doctor builds from `Object.keys(env)` (the env-override row) reads in
// sorted order there, on the tip as after ticket 38 (the tip's manager read
// `Object.keys(process.env)` in a spawned child). The Windows expectation is
// the stored snapshot with that list sorted (windowsExpectation); on Linux the
// stored bytes are compared as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBun } from "../lib/process.mjs";
import { freePort } from "./free-port.mjs";
import { SNAPSHOT_ROOT, matchSnapshot } from "./snapshot-harness.mjs";

const ROOT = join(import.meta.dirname, "..");
const KEY = "synthetic-doctor-key";

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
  // The kit CLI and its adapters read these members too (as in the UX capture).
  for (const member of ["package.json", "proxy/zcode-proxy-manager.mjs", "proxy/zcode-proxy-autostart.ts", "proxy/resolve-zcode-proxy-key.mjs", "proxy/config.example.yaml"]) {
    cpSync(join(ROOT, member), join(root, member));
  }
  mkdirSync(join(root, "zcode-proxy-src", "src", "auth"), { recursive: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "auth", "store.ts"), FAKE_STORE);
  if (configured) {
    writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nauth:\n  proxyApiKey: "${KEY}"\n`);
    writeFileSync(join(root, ".proxykey"), KEY + "\n");
  }
  if (installed) {
    // The checkout's proxy dependencies (the OMP adapter's check loads `yaml` from them), linked as the UX capture does.
    symlinkSync(join(ROOT, "zcode-proxy-src", "node_modules"), join(root, "zcode-proxy-src", "node_modules"), process.platform === "win32" ? "junction" : "dir");
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
      ? `providers:\n  zcode:\n# >>> zcode-kit (managed block)\n    name: zcode\n    apiKey: "${KEY}"\n# <<< zcode-kit (managed block)\n`
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

/** The fixture's environment: its HOME, its Bun (or none), its store; no ambient kit/proxy variable. */
function fixtureEnv(root, { bun = bunOrFail(), store = false, extraEnv = {} } = {}) {
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home") };
  for (const name of Object.keys(env)) {
    if (/^ZCODE_(?:KIT_STATE_DIR|KIT_BUN|PROXY_|CLAIM_|ASYNC_|DUMP_)/.test(name)) delete env[name];
  }
  Object.assign(env, extraEnv);
  if (bun) env.ZCODE_KIT_BUN = bun;
  else { env.PATH = join(root, "empty-path"); mkdirSync(env.PATH, { recursive: true }); }
  if (store) env.ZCODE_PROXY_CREDENTIALS_PATH = join(root, "credentials.json");
  return env;
}

/** A kit entry spawned asynchronously (the stand-in proxy answers from this process). */
function spawnKit(root, entry, args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(root, entry), ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => { stdout += c; });
    child.stderr.setEncoding("utf8").on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(timer); resolveRun({ code, signal, stdout, stderr, bun: env.ZCODE_KIT_BUN ?? null }); });
  });
}

/** A path as printed raw and as `doctor --json` prints it (JSON-escaped); on Linux both are the same. */
const spellings = (path) => new Set([JSON.stringify(path).slice(1, -1), path]);

/**
 * Explicit normalisation: the fixture root, the Bun path and the Bun version,
 * each raw or JSON-escaped, and the separators after <KIT> (`\` raw, `\\` in
 * JSON; none on Linux). Nothing else.
 */
function normalise(text, roots, bun) {
  let out = text;
  for (const path of new Set(roots)) {
    for (const spelling of spellings(path)) out = out.split(spelling).join("<KIT>");
  }
  out = out.replace(/<KIT>[^\s)]*/g, (path) => path.replace(/\\\\|\\/g, "/"));
  if (bun) {
    for (const spelling of spellings(bun)) out = out.split(spelling).join("<BUN>");
    out = out.replace(/<BUN> \(\d+\.\d+\.\d+[^)]*\)/g, "<BUN> (<VERSION>)");
  }
  return out;
}

function snapshotText(run, root) {
  assert.equal(run.signal, null, "the command finished on its own");
  const roots = [realpathSync.native(root), root];
  return `${normalise(run.stdout, roots, run.bun)}[exit ${run.code}]\n${run.stderr ? `[stderr]\n${normalise(run.stderr, roots, run.bun)}` : ""}`;
}

/** The stored (Linux) snapshot as Windows prints it: the env-override list in the sorted order of the Windows environment block. */
function windowsExpectation(stored) {
  return stored.replace(/(ignored by the kit-managed proxy \(unset them\): )([A-Z0-9_]+(?:, [A-Z0-9_]+)*)/g,
    (_, lead, names) => lead + names.split(", ").sort().join(", "));
}

/** matchSnapshot on Linux and macOS (stored bytes as they are); on Windows the stored bytes through windowsExpectation. */
function matchPlatformSnapshot(rel, actual) {
  if (process.platform !== "win32") return matchSnapshot(rel, actual);
  const expected = windowsExpectation(readFileSync(join(SNAPSHOT_ROOT, rel), "utf8"));
  assert.equal(actual, expected, `snapshot differs on Windows: ${rel}`);
  return "match";
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

// The fixture states. `env` builds the run's environment; `proxy` the stand-in.
const STATES = [
  { id: "fresh", title: "fresh kit (no config, no key, nothing installed)", fixture: {}, env: {} },
  {
    id: "proxy-down", title: "configured with the proxy down, env overrides set and a decryptable store",
    fixture: { configured: true, installed: true, artifacts: true, omp: "managed", store: "decryptable" },
    env: { store: true, extraEnv: { ZCODE_PROXY_PORT: "1", ZCODE_CLAIM_FIXTURE: "1" } },
  },
  {
    id: "proxy-running", title: "own proxy running and every manager check passing",
    fixture: { configured: true, installed: true, artifacts: true, omp: "managed", store: "decryptable" },
    env: { store: true }, proxy: {},
  },
  {
    id: "proxy-running-auth-rejected", title: "own proxy running, rejected auth, an undecryptable store and OMP skipped",
    fixture: { configured: true, omp: "skipped", store: "opaque" }, env: { store: true }, proxy: { quota: "rejected" },
  },
  {
    id: "foreign-no-bun", title: "a foreign listener, no Bun and OMP never asked",
    fixture: { configured: true, installed: true, omp: "unasked" }, env: { bun: null }, proxy: { health: "foreign" },
  },
];

async function stateFixture(t, state) {
  const port = await freePort();
  const root = kitFixture(t, { port, ...state.fixture });
  if (state.proxy) await standIn(t, port, state.proxy);
  return { root, env: fixtureEnv(root, state.env) };
}

const managerDoctorModule = (root) => import(pathToFileURL(join(root, "lib", "proxy-doctor.mjs")).href);

// The record intent in a process of its own, so everything it writes is seen
// (this test runner's own reporter shares this process's stdout). The child's
// environment has none of the fixture's overrides or its store: the checks
// must read the env passed in.
const RECORD_PROBE = `
const [moduleUrl, root, home, envJson] = process.argv.slice(1);
const { managerDoctor } = await import(moduleUrl);
const record = await managerDoctor({ root, home, env: JSON.parse(envJson) });
process.stdout.write("\\n@@record@@" + JSON.stringify(record));
`;

test("the manager's doctor returns its checks as records, reads the injected environment and prints nothing", { timeout: 120_000 }, async (t) => {
  const state = STATES.find((s) => s.id === "proxy-down");
  const { root, env } = await stateFixture(t, state);
  const childEnv = { ...env };
  for (const name of ["ZCODE_PROXY_PORT", "ZCODE_CLAIM_FIXTURE", "ZCODE_PROXY_CREDENTIALS_PATH"]) delete childEnv[name];
  const run = await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", RECORD_PROBE, pathToFileURL(join(root, "lib", "proxy-doctor.mjs")).href, root, join(root, "home"), JSON.stringify(env)], { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => { stdout += c; });
    child.stderr.setEncoding("utf8").on("data", (c) => { stderr += c; });
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
  });
  assert.equal(run.code, 0, run.stderr);
  const at = run.stdout.indexOf("\n@@record@@");
  assert.ok(at >= 0, `no record printed: ${run.stdout}`);
  assert.deepEqual([run.stdout.slice(0, at), run.stderr], ["", ""], "the doctor intent prints nothing");
  const record = JSON.parse(run.stdout.slice(at + "\n@@record@@".length));
  assert.deepEqual([record.intent, record.code, record.outcome], ["doctor", 1, "failed"]);
  assert.deepEqual(record.checks.map((c) => [c.name, c.ok]), [
    ["bun available", true],
    ["config exists", true],
    ["key file exists", true],
    ["proxy source installed", true],
    ["proxy env overrides", false],
    ["credentials store", true],
    ["omp provider registered", true],
    ["extension installed", true],
    ["mcp bridge installed", true],
    ["mcp bridge deps", true],
    ["claude adapter artifact", true],
    ["codex adapter artifact", true],
    ["proxy reachable + identity", false],
  ]);
  const byName = Object.fromEntries(record.checks.map((c) => [c.name, c.detail]));
  // The overrides and the explicit store come from the injected env, not this process's.
  assert.equal(byName["proxy env overrides"], "ignored by the kit-managed proxy (unset them): ZCODE_PROXY_PORT, ZCODE_CLAIM_FIXTURE");
  assert.equal(byName["credentials store"], "ZCODE_PROXY_CREDENTIALS_PATH (explicit store): present and decryptable on this machine");
  assert.equal(byName["proxy reachable + identity"], "health=down");
});

test("the manager's doctor record for a passing installation is code 0, outcome ok, with the JWT age as an info check", { timeout: 120_000 }, async (t) => {
  const { root, env } = await stateFixture(t, STATES.find((s) => s.id === "proxy-running"));
  const { managerDoctor } = await managerDoctorModule(root);
  const record = await managerDoctor({ root, home: join(root, "home"), env });
  assert.deepEqual([record.code, record.outcome], [0, "ok"]);
  assert.equal(record.checks.filter((c) => c.ok !== true).length, 0);
  assert.deepEqual(record.checks.at(-1), { name: "start-plan JWT age (info)", ok: true, detail: "5.0h since issue — age is informational, validity is the auth check above" });
});

test("zcode-kit doctor --json counts checks, not lines: a Bun version string with a FAIL-looking line stays one passing check", {
  timeout: 120_000,
  skip: process.platform === "win32" ? "the fake Bun is a POSIX shell script (resolveBun accepts only .exe on Windows)" : false,
}, async (t) => {
  // The passing installation, with a Bun that prints a second, row-shaped
  // line for --version and runs the real Bun for everything else.
  const { root, env } = await stateFixture(t, STATES.find((s) => s.id === "proxy-running"));
  const fakeBun = join(root, "fake-bun");
  writeFileSync(fakeBun, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '1.4.2\\nFAIL  injected — from a version string\\n'; exit 0; fi\nexec "${env.ZCODE_KIT_BUN}" "$@"\n`, { mode: 0o755 });
  const run = await spawnKit(root, join("cli", "zcode-kit.mjs"), ["doctor", "--json"], { ...env, ZCODE_KIT_BUN: fakeBun });
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.checks[0], { name: "bun available", ok: true, detail: `${fakeBun} (1.4.2\nFAIL  injected — from a version string)` });
  assert.deepEqual(report.checks.filter((c) => /injected/.test(c.name)), [], "no check is made up from a line inside a detail");
  assert.deepEqual([run.code, report.ok, report.failed], [0, true, 0]);
});

// The Windows legs' actual lines (CI run 42535337819, test-kit on windows,
// Node 24 and 26), copied from the job logs as logged (JSON.stringify of the
// line), against the stored Linux lines: the normalisation and the Windows
// expectation take each one to the stored bytes, and nothing else changes.
test("Windows spellings meet the Linux snapshots: JSON-escaped root and Bun paths, the sorted environment block", () => {
  const logged = (literal) => JSON.parse(literal);
  const bun = String.raw`C:\Users\runneradmin\.bun\bin\bun.exe`;
  const root = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\kit-manager-doctor-2vCm5M`;
  const roots = [String.raw`C:\Users\runneradmin\AppData\Local\Temp\kit-manager-doctor-2vCm5M`, root];
  const line = (rel, n) => readFileSync(join(SNAPSHOT_ROOT, "manager-doctor", rel), "utf8").split("\n")[n - 1];

  // kit-doctor-json/{fresh,proxy-down,proxy-running,proxy-running-auth-rejected}.txt line 9
  assert.equal(normalise(logged(String.raw`"      \"detail\": \"C:\\\\Users\\\\runneradmin\\\\.bun\\\\bin\\\\bun.exe (1.4.2)\""`), roots, bun), line("kit-doctor-json/fresh.txt", 9));
  // kit-doctor-json/foreign-no-bun.txt line 14 (the short-name spelling of the temp root)
  assert.equal(normalise(logged(String.raw`"      \"detail\": \"C:\\\\Users\\\\RUNNER~1\\\\AppData\\\\Local\\\\Temp\\\\kit-manager-doctor-2vCm5M\\\\proxy\\\\config.yaml\""`), roots, null), line("kit-doctor-json/foreign-no-bun.txt", 14));
  // The long-name (realpath) spelling, raw as the text report prints it and JSON-escaped.
  assert.equal(normalise(String.raw`PASS  key file exists — C:\Users\runneradmin\AppData\Local\Temp\kit-manager-doctor-2vCm5M\.proxykey`, roots, bun), line("proxy-down.txt", 3));
  assert.equal(normalise(String.raw`      "detail": "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\kit-manager-doctor-2vCm5M\\.proxykey"`, roots, bun), line("kit-doctor-json/proxy-down.txt", 19));

  // proxy-down.txt and kit-doctor-text/proxy-down.txt line 5: the environment block's order.
  const windowsLine5 = logged(`"FAIL  proxy env overrides — ignored by the kit-managed proxy (unset them): ZCODE_CLAIM_FIXTURE, ZCODE_PROXY_PORT"`);
  for (const rel of ["proxy-down.txt", "kit-doctor-text/proxy-down.txt"]) {
    const stored = readFileSync(join(SNAPSHOT_ROOT, "manager-doctor", rel), "utf8");
    const expected = windowsExpectation(stored).split("\n");
    assert.equal(expected[4], windowsLine5, rel);
    const changed = stored.split("\n").flatMap((l, i) => (l === expected[i] ? [] : [i + 1]));
    assert.deepEqual(changed, rel === "proxy-down.txt" ? [5] : [5, 19], `${rel}: only the env-override rows differ`);
  }
  const json = readFileSync(join(SNAPSHOT_ROOT, "manager-doctor", "kit-doctor-json/proxy-down.txt"), "utf8");
  assert.ok(windowsExpectation(json).includes(`"detail": "ignored by the kit-managed proxy (unset them): ZCODE_CLAIM_FIXTURE, ZCODE_PROXY_PORT"`));
  // No other snapshot names an env override: the Windows expectation leaves them as stored.
  for (const id of STATES.map((s) => s.id).filter((id) => id !== "proxy-down")) {
    for (const rel of [`${id}.txt`, `kit-doctor-text/${id}.txt`, `kit-doctor-json/${id}.txt`]) {
      const stored = readFileSync(join(SNAPSHOT_ROOT, "manager-doctor", rel), "utf8");
      assert.equal(windowsExpectation(stored), stored, rel);
    }
  }
});

for (const state of STATES) {
  test(`manager CLI doctor, ${state.title}: the legacy rows and exit code, byte for byte`, { timeout: 120_000 }, async (t) => {
    const { root, env } = await stateFixture(t, state);
    const run = await spawnKit(root, join("proxy", "zcode-proxy-manager.mjs"), ["doctor"], env);
    matchPlatformSnapshot(`manager-doctor/${state.id}.txt`, snapshotText(run, root));
  });

  // zcode-kit doctor over the same states: its text report, its --json and
  // their exit codes as before ticket 38.
  for (const [variant, args] of [["text", ["doctor"]], ["json", ["doctor", "--json"]]]) {
    test(`zcode-kit doctor${variant === "json" ? " --json" : ""}, ${state.title}: output and exit code unchanged`, { timeout: 120_000 }, async (t) => {
      const { root, env } = await stateFixture(t, state);
      const run = await spawnKit(root, join("cli", "zcode-kit.mjs"), args, env);
      matchPlatformSnapshot(`manager-doctor/kit-doctor-${variant}/${state.id}.txt`, snapshotText(run, root));
    });
  }
}
