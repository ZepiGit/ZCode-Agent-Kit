#!/usr/bin/env node
// Output capture for zcode-kit: the baseline the equivalence test compares against.
//
// Regenerates every user-facing output of the kit in every C3 terminal
// variant, against throwaway fixture kits (the same mechanism the kit's own
// tests use: tests/harness-consent.test.mjs `fixture()` + `runPty()`), a
// fixture proxy that answers the kit's identity contract on a loopback port of
// its own, printed as 127.0.0.1:18458 (tests/manager-safety.test.mjs
// pattern), loopback vendor/GitHub doubles and
// synthetic credential/account stores. Nothing here touches the installed kit,
// a real HOME, port 8457 or the network.
//
// usage:
//   node capture.mjs --out <dir> [--kit <kit checkout>] [--only <regex>] [--variants a,b]
// --kit defaults to the checkout this file lives in. --out is required, so a
// run can never overwrite the committed BEFORE set by accident.
// Environment: UX_BUN (the Bun binary; default: `bun` on PATH; on POSIX the
// fixtures run it through a fixed-length symlink, host.mjs pinBun) and
// UX_CAPTURE_PORT (pins the fixture proxy port for the whole run; default: a
// fresh free port per scenario; written back as 18458 in every capture, see
// normalise()).
// A full run takes several minutes and starts many short-lived processes;
// give it a memory limit and a timeout when you run it locally.
// Windows runs the non-TTY variants only (WIN32_SKIP lists what cannot run
// there).
//
// Output: <out>/<group>/<scenario>/<variant>.txt (ANSI stripped, CRLF->LF,
// fixture paths/pids/timestamps normalised), <variant>.ansi (same bytes with
// ANSI kept; TTY variants only), <variant>.stderr.txt (non-TTY variants, when
// stderr is non-empty), plus <out>/manifest.json and <out>/INDEX.md.
// The normalisation makes the .txt files stable enough to become snapshot-test
// fixtures (see normalise()).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cloneArgs, describeFailure, fakeProxySource as fakeProxySourceFor, fixtureBaseEnv, importBase, pinBun, swapPath, tarBinary, windowsGitDir } from "./host.mjs";
import { freePort } from "../../free-port.mjs";
import { startOwned, requireSuccess } from "./owned-child.mjs";

// Health captures used to put a 120s command and two 60s manager calls
// inside the raw guard's 110s deadline. Own the synthetic listener directly:
// the guard is about the JSON -> public CLI -> raw writer, not manager stop.
// One monotonic budget covers ALL selected health captures (not per capture).
let healthDeadline = null;
let healthCase = null;
let interrupted = false;
const healthChildren = new Set();
// Global 90s INCLUDING cleanup, per-case 24s INCLUDING a reserved 4s
// cleanup. Work never consumes that reserve. Outer 110s/120s guards unchanged.
const healthBudget = (limit) => {
  const remaining = healthCase.workDeadline - performance.now();
  if (remaining <= 0 || interrupted) {
    const error = new Error(interrupted ? "health capture interrupted" : "health capture exhausted its finite work budget");
    error.diagnostic = { phase: "health-budget", error: { code: "CAPTURE_BUDGET", message: error.message } };
    throw error;
  }
  return Math.max(1, Math.min(limit, remaining));
};
const cleanupBudget = (limit) => Math.max(1, Math.min(limit, healthCase.deadline - performance.now()));
const traceHealth = (event) => console.error(`[ux-health] ${JSON.stringify(event)}`);
async function healthRun(command, args, options) {
  const owned = startOwned(command, args, { ...options, timeoutMs: healthBudget(options.timeoutMs ?? 5000), hardDeadline: healthCase.workDeadline, onEvent: traceHealth });
  healthChildren.add(owned);
  healthCase.children.add(owned);
  try { return requireSuccess(await owned.done); }
  finally {
    if (options.phase === "health-cli" && process.env.UX_CAPTURE_FAULT) healthCase.cli = owned.result;
    healthChildren.delete(owned);
  }
}
async function stopHealthChildren() { await Promise.all([...healthChildren].map((child) => child.stop())); }
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  interrupted = true;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  void stopHealthChildren(); // normal enclosing finally still writes the manifest
});
// Do not stringify foreign diagnostic objects or invoke toJSON/getters. Keep
// diagnostics bounded even when the operation failed before constructing a row.
function boundedDiagnostic(value, depth = 0, seen = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(-16384);
  if (typeof value === "bigint") return String(value);
  if (!value || typeof value !== "object" || depth >= 5 || seen.has(value)) return "[unavailable]";
  seen.add(value);
  const out = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 32)) {
    if (key === "toJSON" || !("value" in descriptor)) continue;
    out[key] = boundedDiagnostic(descriptor.value, depth + 1, seen);
  }
  return out;
}
function recordFailure(row, error) {
  row.error ??= "health capture failed";
  try { row.error = String(error?.message ?? error).slice(0, 400); } catch { /* fixed fallback above */ }
  if (row.diagnostic) return;
  try {
    const diagnostic = error?.diagnostic;
    if (!diagnostic) return;
    // Record the small primary fields before inspecting any arbitrary details.
    row.diagnostic = { phase: String(diagnostic.phase ?? "capture").slice(0, 100),
      error: { code: String(diagnostic.error?.code ?? "CAPTURE_FAILURE").slice(0, 100) } };
    row.diagnostic = boundedDiagnostic(diagnostic);
  } catch { row.diagnosticError = "DIAGNOSTIC_SERIALIZATION_FAILED"; }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const KIT = resolve(opt("--kit", join(HERE, "..", "..", "..")));
if (!opt("--out", null)) { console.error("capture: --out <dir> is required"); process.exit(2); }
const OUT = resolve(opt("--out"));
const ONLY = opt("--only", null) ? new RegExp(opt("--only")) : null;
const IS_WIN = process.platform === "win32";
/** The Bun binary: UX_BUN, else the first `bun` (bun.exe on Windows) on PATH. */
function findBun() {
  if (process.env.UX_BUN) return process.env.UX_BUN;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = dir && join(dir, IS_WIN ? "bun.exe" : "bun");
    if (candidate && existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error("capture: no bun on PATH; set UX_BUN");
}
const BUN_HOST = findBun();
// POSIX: the fixtures run Bun through a fixed-length symlink, so the host's
// Bun directory never changes where a TTY row wraps (host.mjs pinBun).
const BUN = pinBun(BUN_HOST, { windows: IS_WIN, tmp: tmpdir(), mkdtemp: mkdtempSync, symlink: symlinkSync });
if (BUN !== BUN_HOST) process.on("exit", () => rmSync(dirname(BUN), { recursive: true, force: true }));
const BASE_BUN_VERSION = "1.4.2";
const BUN_VERSION = spawnSync(BUN, ["--version"], { encoding: "utf8", timeout: 1000 }).stdout?.trim() || BASE_BUN_VERSION;
// The baseline was captured on 18458. A run on another port writes 18458 back
// in normalise(), so every capture stays comparable byte for byte. Ticket 75:
// every scenario takes a fresh port from the kernel (bind 127.0.0.1:0,
// released again; nextPort()), so parallel captures (json-superset and
// ux-before-capture run at once under `node --test`, two checkouts may run the
// suite at once) never see each other's fixture proxy, and a "down" scenario
// checks a port that was just free (portBusy() before every scenario).
// UX_CAPTURE_PORT pins one port for the whole run instead. A kernel port is
// taken only from KERNEL_PORT_FLOOR up: the committed captures hold no number
// that high (pinned in tests/ux-before-capture.test.mjs), so the write-back
// can only ever touch the port.
const BASE_PORT = 18458;
const KERNEL_PORT_FLOOR = 20000;
const PINNED_PORT = process.env.UX_CAPTURE_PORT === undefined ? null : Number(process.env.UX_CAPTURE_PORT);
if (PINNED_PORT !== null && (!Number.isInteger(PINNED_PORT) || PINNED_PORT < 1024 || PINNED_PORT > 65535)) throw new Error(`capture: bad UX_CAPTURE_PORT ${process.env.UX_CAPTURE_PORT}`);
if (PINNED_PORT === 8457) throw new Error("never the production port");
/** The current scenario's fixture proxy port; null until nextPort() chose one. */
let PORT = PINNED_PORT;
// Obviously synthetic local proxy key (base64url charset, like the real one).
const FAKE_KEY = "UXFIXTURE-not-a-secret-0000000000000000000";
const STORE_SECRET = "ux-capture-synthetic-store-secret";
/** The fixture proxy port of the next scenario (the pinned one, else a fresh kernel port). */
async function nextPort() {
  if (PINNED_PORT !== null) return PORT;
  for (let tries = 0; tries < 50; tries++) {
    const port = await freePort();
    if (port >= KERNEL_PORT_FLOOR) return (PORT = port);
  }
  throw new Error(`capture: the kernel handed out no free loopback port >= ${KERNEL_PORT_FLOOR}`);
}

const VARIANTS = {
  "tty-color-80": { tty: true, cols: 80, rows: 30, env: { TERM: "xterm-256color", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  "tty-color-120": { tty: true, cols: 120, rows: 40, env: { TERM: "xterm-256color", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  "no-color": { tty: true, cols: 80, rows: 30, env: { TERM: "xterm-256color", NO_COLOR: "1", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  "term-dumb": { tty: true, cols: 80, rows: 30, env: { TERM: "dumb", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  "ascii-locale": { tty: true, cols: 80, rows: 30, env: { TERM: "xterm-256color", LANG: "C", LC_ALL: "C" } },
  "pipe": { tty: false, env: { TERM: "xterm-256color", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  "ci": { tty: false, env: { TERM: "dumb", CI: "true", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
};
const ONLY_VARIANTS = opt("--variants", null)?.split(",") ?? Object.keys(VARIANTS);

// --------------------------------------------------------------- fixtures
const KIT_FILES = ["cli", "lib", "package.json", "proxy/config.example.yaml", "proxy/zcode-proxy-manager.mjs", "proxy/zcode-proxy-autostart.ts", "proxy/resolve-zcode-proxy-key.mjs", "zcode-proxy-src/package.json"];
const fakeProxySource = () => fakeProxySourceFor(readFileSync(join(HERE, "fake-proxy.ts"), "utf8"), join(KIT, "zcode-proxy-src"), { windows: IS_WIN });
/** The real proxy source as the Bun helper scripts import it (host.mjs importBase). */
const PROXY_SRC_REF = importBase(join(KIT, "zcode-proxy-src"), { windows: IS_WIN });

/**
 * Symlink on POSIX. Windows: a junction for a directory (no privilege needed)
 * and a copy for a file (file symlinks need SeCreateSymbolicLinkPrivilege).
 */
function link(target, path) {
  if (!IS_WIN) return symlinkSync(target, path);
  if (statSync(target).isDirectory()) return symlinkSync(target, path, "junction");
  return cpSync(target, path);
}

// The version every fixture kit reports unless a scenario names another one.
// It is fixed so that a release, which changes package.json, does not change
// the captured banners and update lines.
const FIXTURE_VERSION = "0.2.42";

/** Copy the kit members a CLI run needs into `root` (a release-shaped tree, no .git). */
function writeKitTree(root, { srcLinks = true, version = FIXTURE_VERSION } = {}) {
  for (const rel of KIT_FILES) cpSync(join(KIT, rel), join(root, rel), { recursive: true });
  // Fixture rule: the template port is the scenario's own port (nextPort()), so
  // no code path can reach 8457.
  const tpl = join(root, "proxy", "config.example.yaml");
  writeFileSync(tpl, readFileSync(tpl, "utf8").replace(/^  port: 8457$/m, `  port: ${PORT}`));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkg.version = version;
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  mkdirSync(join(root, "zcode-proxy-src", "src"), { recursive: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), fakeProxySource());
  // The release payload ships the shared token set and width core (pack
  // allowlist zcode-proxy-src/src/, verify-payload requires them); the CLI
  // output module re-exports them. Always present, never faked.
  link(join(KIT, "zcode-proxy-src", "src", "tui"), join(root, "zcode-proxy-src", "src", "tui"));
  link(join(KIT, "zcode-proxy-src", "node_modules"), join(root, "zcode-proxy-src", "node_modules"));
  if (srcLinks) {
    // The doctor's credential probe imports ./src/auth/store.ts relative to the proxy dir.
    for (const entry of readdirSync(join(KIT, "zcode-proxy-src", "src"))) {
      if (entry === "index.ts" || entry === "tui") continue;
      link(join(KIT, "zcode-proxy-src", "src", entry), join(root, "zcode-proxy-src", "src", entry));
    }
  }
  mkdirSync(join(root, "mcp", "zcode-harness-mcp", "dist"), { recursive: true });
  writeFileSync(join(root, "mcp", "zcode-harness-mcp", "dist", "index.js"), "// UX capture fixture bridge\n");
  mkdirSync(join(root, "mcp", "zcode-harness-mcp", "node_modules"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
}

const DETECT_ALL = ["omp", "pi", "claude-code", "codex", "opencode", "continue"];

function detectIn(home, ids) {
  if (ids.includes("omp")) {
    mkdirSync(join(home, ".omp", "agent"), { recursive: true });
    writeFileSync(join(home, ".omp", "agent", "models.yml"), "# user models\nproviders:\n  openai:\n    name: OpenAI\n");
    writeFileSync(join(home, ".omp", "agent", "config.yml"), "extensions: []\n");
  }
  if (ids.includes("pi")) {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "llama" }] } } }, null, 2) + "\n");
  }
  if (ids.includes("claude-code")) mkdirSync(join(home, ".claude"), { recursive: true });
  if (ids.includes("codex")) mkdirSync(join(home, ".codex"), { recursive: true });
  if (ids.includes("opencode")) {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "opencode.json"), "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n");
  }
  if (ids.includes("continue")) {
    mkdirSync(join(home, ".continue"), { recursive: true });
    writeFileSync(join(home, ".continue", "config.yaml"), "name: Local\nversion: 1.0.0\nmodels: []\n");
  }
}

function fixtureBin(bin) {
  mkdirSync(bin, { recursive: true });
  // Windows: no links to the binaries; their directories go on PATH instead (winPath()).
  if (IS_WIN) return;
  symlinkSync(BUN, join(bin, "bun"));
  symlinkSync(process.execPath, join(bin, "node"));
  // UX_GIT (tooling): run the fixtures with a chosen git, e.g. the CI runner's
  // version, to reproduce its transfer-progress output locally.
  if (process.env.UX_GIT) symlinkSync(process.env.UX_GIT, join(bin, "git"));
}

/**
 * The fixture PATH on Windows: the fixture bin, Bun, Node, git and the
 * system directories, nothing else (no harness on the host may be detected).
 */
function winPath(bin) {
  const sys = process.env.SystemRoot ?? "C:\\Windows";
  const dirs = [bin, dirname(BUN), dirname(process.execPath), windowsGitDir(process.env.PATH ?? process.env.Path, { exists: existsSync }), join(sys, "System32"), sys];
  return [...new Set(dirs.filter(Boolean))].join(delimiter);
}
/** A fake `opencode` on PATH (only for `run opencode`: PATH presence also counts as detection). */
function fakeOpencode(f) {
  writeFileSync(join(f.bin, "opencode"), "#!/bin/sh\necho \"opencode (UX fixture binary) args: $*\"\necho \"ZCODE_PROXY_KEY: ${ZCODE_PROXY_KEY:+set}\"\n");
  chmodSync(join(f.bin, "opencode"), 0o755);
}

/**
 * A fresh fixture: base/{kit,home,bin,tmp}. state "fresh" = no runtime files;
 * "configured" = .proxykey + proxy/config.yaml (the scenario's port) exist, as after a
 * first setup.
 */
function makeFixture({ state = "configured", detect = DETECT_ALL, srcLinks = true, version, onCreate = () => {} } = {}) {
  // Windows: the long-name path (tmpdir() can be an 8.3 name such as RUNNER~1).
  const base = IS_WIN ? realpathSync.native(mkdtempSync(join(tmpdir(), "ux-kit-"))) : mkdtempSync(join(tmpdir(), "ux-kit-"));
  const f = { base, root: join(base, "kit"), home: join(base, "home"), bin: join(base, "bin"), tmp: join(base, "tmp") };
  onCreate(f); // resource ledger owns partial fixture creation too
  for (const d of [f.root, f.home, f.tmp]) mkdirSync(d, { recursive: true });
  writeKitTree(f.root, { srcLinks, version });
  fixtureBin(f.bin);
  detectIn(f.home, detect);
  if (state !== "fresh") writeRuntime(f.root);
  f.env = (extra = {}) => {
    // Host env minus host-only settings (and on Windows minus PATH/TEMP and Git Bash state; host.mjs).
    const env = fixtureBaseEnv(process.env, { windows: IS_WIN });
    Object.assign(env, {
      HOME: f.home, USERPROFILE: f.home, APPDATA: join(f.home, "AppData", "Roaming"), LOCALAPPDATA: join(f.home, "AppData", "Local"),
      XDG_CONFIG_HOME: join(f.home, ".config"), XDG_DATA_HOME: join(f.home, ".local", "share"), XDG_STATE_HOME: join(f.home, ".local", "state"), XDG_CACHE_HOME: join(f.home, ".cache"),
      TMPDIR: f.tmp, PATH: `${f.bin}:/usr/bin:/bin`,
      ZCODE_KIT_SKIP_DEPS: "1", ZCODE_KIT_BUN: BUN, ZCODE_OVERHAUL_RUN: "1",
      ZCODE_PROXY_CREDENTIALS_PATH: join(f.home, ".zcode-proxy", "credentials.json"),
      ZCODE_PROXY_ACCOUNTS_PATH: join(f.home, ".zcode-proxy", "accounts.json"),
      ZCODE_PROXY_CREDENTIAL_SECRET: STORE_SECRET,
      GIT_AUTHOR_NAME: "UX Fixture", GIT_AUTHOR_EMAIL: "ux@fixture.invalid", GIT_COMMITTER_NAME: "UX Fixture", GIT_COMMITTER_EMAIL: "ux@fixture.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    }, IS_WIN ? { PATH: winPath(f.bin), TEMP: f.tmp, TMP: f.tmp, GIT_CONFIG_GLOBAL: "NUL" } : {}, extra);
    return env;
  };
  return f;
}

function writeRuntime(root) {
  writeFileSync(join(root, ".proxykey"), FAKE_KEY + "\n", { mode: 0o600 });
  mkdirSync(join(root, "proxy"), { recursive: true });
  const tpl = readFileSync(join(root, "proxy", "config.example.yaml"), "utf8").replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${FAKE_KEY}"`);
  writeFileSync(join(root, "proxy", "config.yaml"), tpl, { mode: 0o600 });
}

function assertSafePort(f) {
  const cfg = join(f.root, "proxy", "config.yaml");
  if (existsSync(cfg) && !new RegExp(`^  port: ${PORT}$`, "m").test(readFileSync(cfg, "utf8"))) {
    throw new Error(`fixture config does not pin port ${PORT}: ${cfg}`);
  }
}

// ------------------------------------------------------------------ runners
const KIT_CLI = (f) => join(f.root, "cli", "zcode-kit.mjs");
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Uncaptured helper run (fixture preparation). */
function prepRun(f, args, { env = {}, input = "" } = {}) {
  const r = spawnSync(process.execPath, [KIT_CLI(f), ...args], { env: f.env(env), cwd: f.root, encoding: "utf8", input, timeout: 120000 });
  if (r.status === null) throw new Error(`prep ${args.join(" ")} timed out`);
  return r;
}
function prepBun(f, args, env = {}) {
  const r = spawnSync(BUN, args, { env: f.env(env), cwd: f.root, encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) throw new Error(describeFailure(`prep bun ${args.join(" ")} failed`, r));
}
const seed = (f, mode) => prepBun(f, [join(HERE, "seed-store.ts"), PROXY_SRC_REF, mode]);

function runCaptured(cmd, cmdArgs, { env, cwd, variant, input, timeoutMs = 120000 }) {
  const v = VARIANTS[variant];
  const fullEnv = { ...env, ...v.env };
  const started = Date.now();
  if (!v.tty) {
    // Async on purpose: the loopback doubles (vendor, foreign service) live in
    // this process and must keep answering while the child runs.
    return new Promise((resolveRun) => {
      const child = spawn(cmd, cmdArgs, { env: fullEnv, cwd, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.setEncoding("utf8").on("data", (c) => { stdout += c; });
      child.stderr.setEncoding("utf8").on("data", (c) => { stderr += c; });
      child.on("close", (code, signal) => { clearTimeout(timer); resolveRun({ code: code ?? `signal ${signal}`, stdout, stderr, ms: Date.now() - started }); });
      child.stdin.end(typeof input === "string" ? input : "");
    });
  }
  return new Promise((resolveRun) => {
    const line = `stty cols ${v.cols} rows ${v.rows} 2>/dev/null; exec ${[cmd, ...cmdArgs].map(shq).join(" ")}`;
    const child = spawn("script", ["-qec", line, "/dev/null"], { env: fullEnv, cwd });
    let raw = "";
    const scripted = Array.isArray(input) ? [...input] : null;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      raw += chunk;
      while (scripted?.length && raw.includes(scripted[0].after)) child.stdin.write(scripted.shift().send);
    });
    child.stderr.on("data", (chunk) => { raw += chunk; });
    child.on("close", (code, signal) => { clearTimeout(timer); resolveRun({ code: code ?? `signal ${signal}`, stdout: raw, stderr: "", ms: Date.now() - started }); });
    if (!scripted) { child.stdin.write(typeof input === "string" ? input : ""); child.stdin.end(); }
  });
}

// ------------------------------------------------------------- normalising
const ANSI_RE = /\x1b(?:\[[0-9;?<=>! ]*[A-Za-z~@`\\]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_=>])/g;
const swap = (s, p, token) => swapPath(s, p, token, { windows: IS_WIN, realpath: realpathSync.native });

function normalise(text, f) {
  let s = text.replace(/\r\n/g, "\n").replace(/\r(?!\n)/g, "\n");
  if (f) {
    s = swap(swap(swap(swap(swap(s, f.root, "<KIT>"), f.home, "<HOME>"), f.bin, "<BIN>"), f.tmp, "<TMP>"), f.base, "<FIXTURE>");
  }
  s = swap(swap(s, join(KIT, "zcode-proxy-src"), "<PROXY_SRC>"), KIT, "<SRC>");
  // The pinned Bun, and the host's spelling too (a Bun process naming its own executable resolves the pin).
  s = swap(swap(swap(s, BUN, "<BUN>"), BUN_HOST, "<BUN>"), process.execPath, "<NODE>");
  s = s.replace(/\/tmp\/ux-kit-[A-Za-z0-9]+/g, "<FIXTURE>").replace(/\/tmp\/zcode-kit-update-[A-Za-z0-9]+/g, "<TMP>/zcode-kit-update-XXXX");
  s = s.replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-\d{3}-[0-9a-f]{6}/g, "<TX>");
  s = s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<TS>");
  s = s.replace(/\bpid (\d+)/g, (m, p) => (p === "4242" ? m : "pid <PID>")).replace(/("pid": )\d+/g, "$1<PID>").replace(/pid file:  \d+/g, "pid file:  <PID>");
  s = s.replace(/\(\d+ms\)/g, "(<MS>ms)");
  // Tooling additions, no-ops for a run like the original's
  // (port 18458, Bun 1.4.2): the fixture port and the running Bun's version
  // are written back as the baseline's values.
  if (PORT !== null && PORT !== BASE_PORT) s = s.replace(new RegExp(`\\b${PORT}\\b`, "g"), String(BASE_PORT));
  if (BUN_VERSION !== BASE_BUN_VERSION) s = s.split(`<BUN> (${BUN_VERSION})`).join(`<BUN> (${BASE_BUN_VERSION})`);
  return s;
}
const strip = (s) => s.replace(ANSI_RE, "");
function widthStats(text) {
  let max = 0, over80 = 0, nonAscii = 0;
  const glyphs = new Set();
  for (const line of text.split("\n")) {
    let w = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (cp > 0x7e) { nonAscii++; glyphs.add(ch); }
      w += /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/u.test(ch) ? 2 : 1;
    }
    max = Math.max(max, w);
    if (w > 80) over80++;
  }
  return { maxWidth: max, linesOver80: over80, nonAsciiChars: nonAscii, glyphs: [...glyphs].join("") };
}

// ----------------------------------------------------------- loopback doubles
async function listen(server, port = 0) {
  await new Promise((r, j) => { server.once("error", j); server.listen(port, "127.0.0.1", r); });
  return server;
}
async function closeServer(server) { if (!server) return; server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
function foreignService() { return listen(http.createServer((req, res) => { res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}'); }), PORT); }
function upstreamVendor() {
  // Shapes copied from tests/upstream-config.test.mjs (release shape, matching start-plan base).
  const rule = (mode, accountType, baseUrl, models) => ({ providerId: `account:${accountType}-${mode}`, config: { access: { type: "zhipu-account", mode, accountType }, api: { type: "anthropic-messages", baseUrl }, builtinModelIds: models } });
  const RELEASE = { schemaVersion: 1, revision: 23, config: { providerConfigRules: { templateRules: [], providerRules: [
    rule("individual-coding-plan", "zai", "https://api.z.ai/api/anthropic", ["GLM-5.3", "GLM-5.3-Flash"]),
    rule("start-plan", "zai", "https://zcode.z.ai/api/v1/zcode-plan/anthropic", ["GLM-5.3-Flash", "GLM-5.2"]),
  ] }, modelConfigRules: {} } };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const body = url.pathname === "/release.json" ? RELEASE : { code: 0, data: { configs: { builtin_provider_config_json: `${origin}/release.json` } } };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  return listen(server);
}
function portBusy(port = PORT) {
  return new Promise((r) => { const s = net.connect(port, "127.0.0.1"); s.setTimeout(200, () => { s.destroy(); r(true); }); s.once("connect", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); });
}

// --------------------------------------------------------- proxy lifecycle
function startProxy(f) {
  assertSafePort(f);
  const r = spawnSync(process.execPath, [join(f.root, "proxy", "zcode-proxy-manager.mjs"), "start"], { env: f.env(), cwd: f.root, encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) throw new Error(`fixture proxy did not start: ${r.stdout}${r.stderr}`);
}
async function stopProxy(f, root = f.root) {
  if (existsSync(join(root, "proxy", "zcode-proxy-manager.mjs"))) {
    spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "stop"], { env: f.env(), cwd: root, encoding: "utf8", timeout: 60000 });
  }
  // Fallback for a fixture proxy the manager refused to stop: only a process
  // whose command line points into THIS fixture is ever signalled.
  try {
    const raw = readFileSync(join(root, "logs", "proxy.pid"), "utf8");
    const pid = JSON.parse(raw).pid;
    if (IS_WIN) {
      // No /proc on Windows: the pid file inside THIS fixture names the proxy
      // its own manager spawned; end it only while the fixture port is still busy.
      if (await portBusy()) process.kill(pid);
    } else {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (cmdline.includes(f.base)) process.kill(pid, "SIGKILL");
    }
  } catch { /* gone */ }
  for (let i = 0; i < 20 && await portBusy(); i++) await new Promise((r) => setTimeout(r, 150));
}

// ---------------------------------------------------------------- releases
function makeRelease(base, tag, { corrupt = false } = {}) {
  const stage = join(base, `release-src-${tag}`, "kit");
  mkdirSync(stage, { recursive: true });
  writeKitTree(stage, { srcLinks: false, version: tag.replace(/^v/, "") });
  const dir = join(base, `release-${tag}`);
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, `${tag}.tar.gz`);
  const r = spawnSync(tarBinary({ windows: IS_WIN, env: process.env }), ["-czf", archive, "-C", dirname(stage), "kit"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(describeFailure("tar failed", r));
  const hash = corrupt ? "0".repeat(64) : createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(join(dir, "checksums.txt"), `${hash}  ${tag}.tar.gz\n`);
  return dir;
}
function curlMock(bin) {
  writeFileSync(join(bin, "curl"), `#!/bin/sh
# UX capture fixture curl: serves release files from $RELEASE_DIR, refuses everything else.
out=''; url=''
while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
case "$url" in
  */releases/latest) printf '{"tag_name": "v1.2.3"}\\n' ;;
  */*.tar.gz|*/checksums.txt) cp "$RELEASE_DIR/$(basename "$url")" "$out" ;;
  *) echo "fixture curl: refused $url" >&2; exit 22 ;;
esac
`);
  chmodSync(join(bin, "curl"), 0o755);
}

function gitFixture(f) {
  // A checkout install: kit root is a git clone of a local bare "origin" that
  // is one fast-forward commit ahead. Offline.
  const env = f.env();
  const git = (cwd, ...a) => {
    const args = a[0] === "clone" ? cloneArgs(a, { windows: IS_WIN }) : a;
    const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(describeFailure(`git ${args.join(" ")}`, r));
    return r.stdout;
  };
  writeFileSync(join(f.root, ".gitignore"), ".proxykey\nproxy/config.yaml\nlogs/\nbackups/\ngenerated/\nzcode-proxy-src/node_modules\n");
  git(f.root, "init", "-q", "-b", "main");
  git(f.root, "add", "-A");
  git(f.root, "commit", "-q", "-m", "fixture v0.2.42");
  const origin = join(f.base, "origin.git");
  git(f.base, "clone", "-q", "--bare", f.root, origin);
  git(f.root, "remote", "add", "origin", origin);
  git(f.root, "fetch", "-q", "origin");
  const work = join(f.base, "upstream-work");
  git(f.base, "clone", "-q", origin, work);
  const pkg = JSON.parse(readFileSync(join(work, "package.json"), "utf8")); pkg.version = "0.2.43";
  writeFileSync(join(work, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  git(work, "commit", "-q", "-am", "fixture v0.2.43");
  git(work, "push", "-q", "origin", "main");
  git(f.root, "branch", "-q", "--set-upstream-to=origin/main", "main");
}

// --------------------------------------------------------------- scenarios
const configured = (f, ids = ["omp", "codex"]) => prepRun(f, ["setup", "--harness", ids.join(","), "--account-rotator", "n"]);
const running = (f) => startProxy(f);
const SETUP_ANSWERS = "y\nn\nn\ny\ny\nn\nn\n"; // omp y, pi n, claude n, codex y, opencode y, continue n, rotator n

const S = [];
const sc = (group, id, title, def) => S.push({ group, id, title, ...def });
const FRESH = { state: "fresh", detect: [] };

// help & usage errors
sc("help", "help", "zcode-kit help", { args: ["help"], fixture: FRESH });
sc("help", "help-flag", "zcode-kit --help", { args: ["--help"], fixture: FRESH });
sc("help", "unknown-command", "unknown command", { args: ["frobnicate"], fixture: FRESH });
sc("help", "proxy-no-subcommand", "zcode-kit proxy (no subcommand)", { args: ["proxy"], fixture: FRESH });
sc("help", "integrate-unknown-harness", "zcode-kit integrate vim", { args: ["integrate", "vim"], fixture: FRESH });
sc("help", "run-no-harness", "zcode-kit run (no harness)", { args: ["run"], fixture: FRESH });

// setup
sc("setup", "setup-interactive", "setup, 6 detected harnesses, answers y n n y y n + rotator n (non-TTY variants: no terminal)", { args: ["setup"], input: SETUP_ANSWERS });
sc("setup", "setup-installer-compact", "setup --installer (compact installer mode, as run by install.sh/ps1)", { args: ["setup", "--harness", "auto", "--installer"], input: SETUP_ANSWERS });
sc("setup", "setup-explicit", "setup --harness omp,codex --account-rotator n (unattended)", { args: ["setup", "--harness", "omp,codex", "--account-rotator", "n"] });
sc("setup", "setup-select", "setup --select, answer 1,4 + rotator n", { args: ["setup", "--select"], input: "1,4\nn\n" });
sc("setup", "setup-none-detected", "setup with no harness detected", { args: ["setup"], input: "n\n", fixture: { detect: [] } });
sc("setup", "setup-proxy-running", "setup re-run with stored decisions while the proxy runs", { args: ["setup"], input: "n\nn\nn\nn\n", prep: (f) => { configured(f); running(f); } });
sc("setup", "setup-checkout-refused", "setup from a source checkout (refused)", { args: ["setup", "--harness", "omp"], prep: (f) => mkdirSync(join(f.root, ".git")) });
sc("setup", "setup-bad-harness", "setup --harness vim", { args: ["setup", "--harness", "vim"] });

// doctor
sc("doctor", "doctor-fresh", "doctor before setup", { args: ["doctor"], fixture: { state: "fresh", detect: ["omp", "pi"] } });
sc("doctor", "doctor-proxy-down", "doctor after setup, proxy down", { args: ["doctor"], prep: (f) => { configured(f); seed(f, "credential"); } });
sc("doctor", "doctor-proxy-running", "doctor after setup, proxy running", { args: ["doctor"], prep: (f) => { configured(f); seed(f, "credential"); running(f); } });
sc("doctor", "doctor-json", "doctor --json, proxy running", { args: ["doctor", "--json"], prep: (f) => { configured(f); seed(f, "credential"); running(f); } });
sc("doctor", "doctor-fix-starts-proxy", "doctor --fix with the proxy down (starts it)", { args: ["doctor", "--fix"], prep: (f) => { configured(f); seed(f, "credential"); } });
sc("doctor", "doctor-fix-nothing-to-do", "doctor --fix with a healthy proxy (re-apply only, no start)", { args: ["doctor", "--fix"], prep: (f) => { configured(f); seed(f, "credential"); running(f); } });
sc("doctor", "doctor-harness-omp", "doctor --harness omp", { args: ["doctor", "--harness", "omp"], prep: (f) => configured(f) });
sc("doctor", "doctor-upstream", "doctor --upstream (loopback vendor double, matching gateway)", { args: ["doctor", "--upstream"], vendor: true, prep: (f) => configured(f) });
sc("doctor", "doctor-upstream-unreachable", "doctor --upstream, vendor unreachable", { args: ["doctor", "--upstream"], env: { ZCODE_KIT_UPSTREAM_ORIGIN: "http://127.0.0.1:9" }, prep: (f) => configured(f) });
sc("doctor", "doctor-forget", "doctor --forget omp", { args: ["doctor", "--forget", "omp"], prep: (f) => configured(f) });
sc("doctor", "doctor-forget-nothing", "doctor --forget pi (no stored decision)", { args: ["doctor", "--forget", "pi"], prep: (f) => configured(f) });
sc("doctor", "doctor-forget-usage", "doctor --forget (no harness)", { args: ["doctor", "--forget"], prep: (f) => configured(f) });

// proxy lifecycle
sc("proxy", "proxy-start", "proxy start (from down)", { args: ["proxy", "start"], prep: (f) => configured(f) });
sc("proxy", "proxy-start-already-running", "proxy start (already running)", { args: ["proxy", "start"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-start-nokey", "proxy start before setup (no key)", { args: ["proxy", "start"], fixture: FRESH });
sc("proxy", "proxy-start-foreign", "proxy start with a foreign service on the port", { args: ["proxy", "start"], foreign: true, prep: (f) => configured(f) });
sc("proxy", "proxy-status-running", "proxy status (running)", { args: ["proxy", "status"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-status-down", "proxy status (down)", { args: ["proxy", "status"], prep: (f) => configured(f) });
sc("proxy", "proxy-status-foreign", "proxy status (foreign service on the port)", { args: ["proxy", "status"], foreign: true, prep: (f) => configured(f) });
sc("proxy", "proxy-status-fresh", "proxy status before setup", { args: ["proxy", "status"], fixture: FRESH });
sc("proxy", "proxy-status-json-running", "proxy status --json (running)", { args: ["proxy", "status", "--json"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-status-json-down", "proxy status --json (down)", { args: ["proxy", "status", "--json"], prep: (f) => configured(f) });
sc("proxy", "proxy-logs", "proxy logs", { args: ["proxy", "logs"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-logs-5", "proxy logs 5", { args: ["proxy", "logs", "5"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-logs-none", "proxy logs (no log file)", { args: ["proxy", "logs"], fixture: FRESH });
sc("proxy", "proxy-restart", "proxy restart", { args: ["proxy", "restart"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-stop", "proxy stop (running)", { args: ["proxy", "stop"], prep: (f) => { configured(f); running(f); } });
sc("proxy", "proxy-stop-not-running", "proxy stop (not running)", { args: ["proxy", "stop"], prep: (f) => configured(f) });

// status / models / usage
sc("status", "status-running", "status (running)", { args: ["status"], prep: (f) => { configured(f); running(f); } });
sc("status", "status-json-running", "status --json (running)", { args: ["status", "--json"], prep: (f) => { configured(f); running(f); } });
sc("status", "status-json-down", "status --json (down)", { args: ["status", "--json"], prep: (f) => configured(f) });
sc("models", "models-running", "models (live list)", { args: ["models"], prep: (f) => { configured(f); running(f); } });
sc("models", "models-json-down", "models --json (proxy down, registry fallback)", { args: ["models", "--json"], prep: (f) => configured(f) });
sc("models", "models-show-key", "models --show-key (fixture key)", { args: ["models", "--show-key"], prep: (f) => { configured(f); running(f); } });
sc("models", "usage-json-running", "usage --json (running)", { args: ["usage", "--json"], prep: (f) => { configured(f); running(f); } });
sc("models", "usage-json-down", "usage --json (down)", { args: ["usage", "--json"], prep: (f) => configured(f) });

// accounts
sc("accounts", "accounts-empty", "accounts (empty pool)", { args: ["accounts"], prep: (f) => configured(f) });
sc("accounts", "accounts-list", "accounts (3 synthetic accounts)", { args: ["accounts"], prep: (f) => { configured(f); seed(f, "accounts"); } });
sc("accounts", "accounts-json", "accounts --json", { args: ["accounts", "--json"], prep: (f) => { configured(f); seed(f, "accounts"); } });
sc("accounts", "accounts-health", "accounts health (proxy running, live data)", { args: ["accounts", "health"], health: true });
sc("accounts", "accounts-health-json", "accounts health --json", { args: ["accounts", "health", "--json"], health: true });
sc("accounts", "accounts-health-down", "accounts health (proxy down)", { args: ["accounts", "health"], prep: (f) => { configured(f); seed(f, "accounts"); } });
sc("accounts", "accounts-doctor", "accounts doctor", { args: ["accounts", "doctor"], prep: (f) => { configured(f); seed(f, "accounts"); } });
sc("accounts", "accounts-quota", "accounts quota (running)", { args: ["accounts", "quota"], prep: (f) => { configured(f); seed(f, "accounts"); running(f); } });
sc("accounts", "accounts-explain", "accounts explain --model glm-5.3 --operation inference", { args: ["accounts", "explain", "--model", "glm-5.3", "--operation", "inference"], prep: (f) => { configured(f); seed(f, "accounts"); } });
sc("accounts", "accounts-remove-unconfirmed", "accounts remove personal (no --yes)", { args: ["accounts", "remove", "personal"], prep: (f) => { configured(f); seed(f, "accounts"); } });
sc("accounts", "accounts-bad-subcommand", "accounts frob", { args: ["accounts", "frob"], prep: (f) => configured(f) });
sc("accounts", "accounts-enable", "accounts enable (proxy down)", { args: ["accounts", "enable"], prep: (f) => configured(f) });

// auth
sc("auth", "auth-status-running", "auth status (running)", { args: ["auth", "status"], prep: (f) => { configured(f); running(f); } });
sc("auth", "auth-status-down", "auth status (down)", { args: ["auth", "status"], prep: (f) => configured(f) });
sc("auth", "auth-logout-unconfirmed", "auth logout (no --yes)", { args: ["auth", "logout"], prep: (f) => configured(f) });
sc("auth", "auth-bad-subcommand", "auth frob", { args: ["auth", "frob"], prep: (f) => configured(f) });

// integrate / run
sc("integrate", "integrate-omp", "integrate omp", { args: ["integrate", "omp"] });
sc("integrate", "integrate-opencode-dry-run", "integrate opencode --dry-run", { args: ["integrate", "opencode", "--dry-run"] });
sc("integrate", "integrate-codex-dry-run", "integrate codex --dry-run", { args: ["integrate", "codex", "--dry-run"] });
sc("run", "run-opencode", "run opencode -- --version (fixture binary, proxy running)", { args: ["run", "opencode", "--", "--version"], prep: (f) => { fakeOpencode(f); configured(f, ["opencode"]); running(f); } });
sc("run", "run-codex-not-integrated", "run codex before integrate", { args: ["run", "codex"] });
sc("run", "run-omp-no-launcher", "run omp (no launcher)", { args: ["run", "omp"] });

// update / rollback / uninstall
sc("update", "update-checkout", "update (checkout install, fast-forward from local bare origin); TTY answers n to the re-asked questions", { args: ["update"], input: "n\nn\nn\n", fixture: { detect: ["omp"] }, prep: (f) => { gitFixture(f); prepRun(f, ["setup", "--harness", "omp", "--account-rotator", "n"], { env: { ZCODE_KIT_ALLOW_CHECKOUT: "1" } }); } });
sc("update", "update-checkout-dirty", "update with a dirty checkout (refused)", { args: ["update"], fixture: { detect: [] }, prep: (f) => { gitFixture(f); appendFileSync(join(f.root, "cli", "zcode-kit.mjs"), "\n// local edit\n"); } });
sc("update", "update-bad-version", "update --version latest", { args: ["update", "--version", "latest"] });
sc("update", "update-release", "update (release install, verified tarball via loopback stub); TTY answers n to the re-asked questions", { args: ["update"], input: "n\nn\nn\n", fixture: { detect: ["omp"], srcLinks: false }, release: "v9.9.9", prep: (f) => configured(f, ["omp"]) });
sc("update", "update-release-current", "update when already at the latest release", { args: ["update"], fixture: { detect: [], srcLinks: false, version: "9.9.9" }, release: "v9.9.9" });
sc("update", "update-release-corrupt", "update with a checksum mismatch", { args: ["update"], fixture: { detect: [], srcLinks: false }, release: "v9.9.9", corrupt: true });
sc("rollback", "rollback-after-integrate", "rollback after integrate omp", { args: ["rollback"], prep: (f) => prepRun(f, ["integrate", "omp"]) });
sc("rollback", "rollback-nothing", "rollback with no transaction", { args: ["rollback"] });
sc("uninstall", "uninstall-after-setup", "uninstall after setup --harness omp,codex", { args: ["uninstall"], prep: (f) => {
  configured(f);
  mkdirSync(join(f.home, ".local", "bin"), { recursive: true });
  writeFileSync(join(f.home, ".local", "bin", "zcode-kit"), `#!/usr/bin/env sh\nexec node "${f.root}/cli/zcode-kit.mjs" "$@"\n`);
} });

// installer (install.sh): fixture curl, real tar/sha256sum/node, real setup
const installScenario = (id, title, { version = "v1.2.3", corrupt = false, target = "empty", input = SETUP_ANSWERS } = {}) =>
  sc("install", id, title, { args: [], install: { version, corrupt, target }, input });
installScenario("install-sh-fresh", "install.sh fresh install (setup answers y n n y y n + rotator n)");
installScenario("install-sh-update", "install.sh over an existing installation", { target: "existing", input: SETUP_ANSWERS });
installScenario("install-sh-hash-mismatch", "install.sh with a corrupt release archive", { corrupt: true });
installScenario("install-sh-bad-version", "install.sh with ZCODE_KIT_VERSION=latest", { version: "latest" });
installScenario("install-sh-foreign-target", "install.sh into a non-kit directory", { target: "foreign" });

// --extra json: `--json` outputs the Phase 1C set does not cover,
// captured only for the JSON key/type baseline (tests/ux-before/json-baseline.json).
// Opt-in, so the default run is exactly the BEFORE set's scenario list.
if (opt("--extra", null) === "json") {
  sc("json-extra", "models-json-running", "models --json (running, live list)", { args: ["models", "--json"], prep: (f) => { configured(f); running(f); } });
  sc("json-extra", "doctor-json-down", "doctor --json, proxy down", { args: ["doctor", "--json"], prep: (f) => { configured(f); seed(f, "credential"); } });
  sc("json-extra", "accounts-doctor-json", "accounts doctor --json", { args: ["accounts", "doctor", "--json"], prep: (f) => { configured(f); seed(f, "accounts"); } });
  sc("json-extra", "accounts-health-json-down", "accounts health --json (proxy down)", { args: ["accounts", "health", "--json"], prep: (f) => { configured(f); seed(f, "accounts"); } });
}

// ---------------------------------------------------------------- execution
const manifest = [];
function save(rel, name, text) { const dir = join(OUT, rel); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), text); }

// Same real capture/CLI/producer path, with fixture-only ownership instead of
// manager probing. Readiness, exit and pipe drain have distinct acknowledgements.
async function prepareHealth(f) {
  await healthRun(process.execPath, [KIT_CLI(f), "setup", "--harness", "omp,codex", "--account-rotator", "n"], { env: f.env({ UX_CAPTURE_FAULT: "" }), cwd: f.root, phase: "health-setup" });
  await healthRun(BUN, [join(HERE, "seed-store.ts"), PROXY_SRC_REF, "accounts"], { env: f.env({ UX_CAPTURE_FAULT: "" }), cwd: f.root, phase: "health-seed" });
  const listener = startOwned(BUN, ["run", join(f.root, "zcode-proxy-src", "src", "index.ts"), "serve"], {
    cwd: f.root, env: f.env({ ZCODE_PROXY_CONFIG: join(f.root, "proxy", "config.yaml"), UX_CAPTURE_OWNED_LISTENER: "1", UX_CAPTURE_FAULT: "" }), input: null, phase: "health-listener", timeoutMs: healthBudget(15000), hardDeadline: healthCase.deadline, onEvent: traceHealth,
  });
  healthChildren.add(listener);
  healthCase.children.add(listener);
  f.healthListener = listener;
  const deadline = performance.now() + healthBudget(5000);
  while (!listener.result.stdout.includes("UX_LISTENER_READY")) {
    if (listener.result.ownerClosed) requireSuccess(listener.result);
    if (performance.now() >= deadline) {
      const diagnostic = { ...listener.result, error: { code: "CAPTURE_READINESS_TIMEOUT", message: "listener did not acknowledge readiness" } };
      const error = new Error(JSON.stringify(diagnostic)); error.diagnostic = diagnostic; throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  traceHealth({ type: "ready", port: PORT, pid: listener.result.pid, ownerPid: listener.result.ownerPid, pgid: listener.result.pgid });
}
async function stopHealth(f) {
  const listener = f.healthListener;
  if (!listener) return { listenerClosed: true, portClosed: !await portBusy() };
  listener.eof();
  let timer;
  const result = await Promise.race([listener.done, new Promise((resolve) => { timer = setTimeout(() => resolve(null), cleanupBudget(1000)); })]);
  clearTimeout(timer);
  if (!result) await listener.stop();
  healthChildren.delete(listener);
  const cleanup = { listenerClosed: listener.result.ownerClosed, stopAcknowledged: listener.result.stdout.includes("UX_LISTENER_STOPPED"), portClosed: !await portBusy(), listener: listener.result };
  traceHealth({ type: "listener-cleanup", listenerClosed: cleanup.listenerClosed, stopAcknowledged: cleanup.stopAcknowledged, portClosed: cleanup.portClosed });
  return cleanup;
}
async function runScenario(s, variant) {
  // Register a result and the resource ledger BEFORE any case launch.
  const row = { group: s.group, id: s.id, title: s.title, variant };
  manifest.push(row);
  let f, install, foreign = null, vendor = null;
  const extraEnv = { ...(s.env ?? {}) };
  if (s.health) {
    healthDeadline ??= performance.now() + 90000;
    const deadline = Math.min(healthDeadline, performance.now() + 24000);
    healthCase = { deadline, workDeadline: deadline - 4000, children: new Set() };
  }
  try {
    if (s.health) healthBudget(1); // refuse new launches after global exhaustion
    await nextPort();
    f = makeFixture({ ...(s.fixture ?? {}), onCreate: (created) => { f = created; } });
    install = join(f.base, "install");
    if (await portBusy()) throw new Error(`port ${PORT} busy before ${s.id}; refusing to continue`);
    if (s.health) await prepareHealth(f);
    if (s.prep) await s.prep(f);
    if (s.foreign) foreign = await foreignService();
    if (s.vendor) { vendor = await upstreamVendor(); extraEnv.ZCODE_KIT_UPSTREAM_ORIGIN = `http://127.0.0.1:${vendor.address().port}`; }
    if (s.release) {
      const dir = makeRelease(f.base, s.release, { corrupt: s.corrupt });
      Object.assign(extraEnv, { UX_RELEASE_DIR: dir, UX_RELEASE_LATEST: s.release, NODE_OPTIONS: `--import=${IS_WIN ? pathToFileURL(join(HERE, "fetch-stub.mjs")).href : join(HERE, "fetch-stub.mjs")}` });
    }
    assertSafePort(f);
    let cmd = process.execPath, args = [KIT_CLI(f), ...s.args], cwd = f.root;
    if (s.install) {
      curlMock(f.bin);
      const dir = makeRelease(f.base, s.install.version === "latest" ? "v1.2.3" : s.install.version, { corrupt: s.install.corrupt });
      if (s.install.target === "existing") {
        mkdirSync(install, { recursive: true });
        writeKitTree(install, { srcLinks: false, version: "1.2.2" });
        writeRuntime(install);
      } else if (s.install.target === "foreign") {
        mkdirSync(install, { recursive: true }); writeFileSync(join(install, "notes.txt"), "user data\n");
      }
      Object.assign(extraEnv, { RELEASE_DIR: dir, ZCODE_KIT_INSTALL_DIR: install, ZCODE_KIT_VERSION: s.install.version });
      cmd = "sh"; args = [join(KIT, "install.sh")]; cwd = f.base;
    }
    let r;
    if (s.health) {
      const v = VARIANTS[variant];
      const started = performance.now();
      const line = `stty cols ${v.cols} rows ${v.rows} 2>/dev/null; exec ${[cmd, ...args].map(shq).join(" ")}`;
      const result = await healthRun(v.tty ? "script" : cmd, v.tty ? ["-qec", line, "/dev/null"] : args, {
        env: { ...f.env(extraEnv), ...v.env, UX_CAPTURE_NODE: process.execPath }, cwd, phase: "health-cli", timeoutMs: process.env.UX_CAPTURE_FAULT === "hang" ? 1000 : 5000,
      });
      r = { code: result.status, stdout: result.stdout, stderr: result.stderr, ms: performance.now() - started };
    } else r = await runCaptured(cmd, args, { env: f.env(extraEnv), cwd, variant, input: s.input });
    if (s.health && process.env.UX_CAPTURE_RECORD_FAULT === "budget") {
      healthCase.workDeadline = performance.now() - 1;
      healthBudget(1); // actual budget throw after listener + CLI, before result fields
    }
    if (s.health && ["diagnostic", "diagnostic-trap"].includes(process.env.UX_CAPTURE_RECORD_FAULT)) {
      const error = new Error("controlled result construction failure");
      const diagnostic = { phase: "health-record", error: { code: "CAPTURE_RECORD_FAULT" }, circular: null,
        toJSON() { throw new Error("diagnostic serialization failed"); } };
      diagnostic.circular = diagnostic;
      error.diagnostic = process.env.UX_CAPTURE_RECORD_FAULT === "diagnostic-trap"
        ? new Proxy(diagnostic, { ownKeys() { throw new Error("diagnostic inspection failed"); } }) : diagnostic;
      throw error;
    }
    const rel = join(s.group, s.id);
    const v = VARIANTS[variant];
    const outText = normalise(r.stdout, f);
    const plain = strip(outText);
    save(rel, `${variant}.txt`, plain);
    if (v.tty) save(rel, `${variant}.ansi`, outText);
    let errPlain = "";
    if (!v.tty && r.stderr) { errPlain = strip(normalise(r.stderr, f)); save(rel, `${variant}.stderr.txt`, errPlain); }
    const hasAnsi = /\x1b/.test(r.stdout) || /\x1b/.test(r.stderr ?? "");
    Object.assign(row, { exit: r.code, ms: r.ms, hasAnsi, ...widthStats(plain + (errPlain ? "\n" + errPlain : "")), command: s.install ? "sh install.sh" : `zcode-kit ${s.args.join(" ")}` });
  } catch (err) {
    recordFailure(row, err);
  } finally {
    if (s.health) {
      // Fixture faults retain the CLI ledger on success too, so a missing
      // negative diagnostic cannot hide owner/holder/exit/EOF evidence.
      if (process.env.UX_CAPTURE_FAULT && healthCase.cli) row.cli = boundedDiagnostic(healthCase.cli);
      row.cleanup = { listenerClosed: !f?.healthListener, portClosed: false, fixtureRemoved: !f };
      try { if (f) Object.assign(row.cleanup, await stopHealth(f)); }
      catch (error) { row.cleanup.error = boundedDiagnostic(error); }
      finally {
        // Includes a child that failed before prepareHealth returned. Every
        // stop has its original absolute deadline, even after budget failure.
        await Promise.all([...healthCase.children].map(async (child) => {
          if (!child.result.ownerClosed) await child.stop();
          healthChildren.delete(child);
        }));
        try {
          if (f) rmSync(f.base, { recursive: true, force: true });
          row.cleanup.fixtureRemoved = !f || !existsSync(f.base);
        } catch (error) { row.cleanup.fixtureError = String(error.message).slice(0, 400); }
      }
      if (!row.cleanup.listenerClosed || !row.cleanup.portClosed || !row.cleanup.fixtureRemoved ||
          row.cleanup.listener?.cleanupError || (f?.healthListener && !row.cleanup.stopAcknowledged)) {
        row.error ??= "health fixture cleanup was not acknowledged";
      }
    } else if (f) {
      await closeServer(foreign); await closeServer(vendor);
      await stopProxy(f);
      if (s.install && existsSync(install)) await stopProxy(f, install);
      rmSync(f.base, { recursive: true, force: true });
    }
  }
}

// ------------------------------------------------------------------ TUI
async function captureTui() {
  const env = IS_WIN ? { SystemRoot: process.env.SystemRoot, PATH: winPath(tmpdir()), USERPROFILE: tmpdir(), HOME: tmpdir() } : { PATH: "/usr/bin:/bin", HOME: tmpdir() };
  const r = spawnSync(BUN, [join(HERE, "render-tui.ts"), PROXY_SRC_REF], { encoding: "utf8", timeout: 60000, env });
  if (r.status !== 0) { manifest.push({ group: "tui", id: "frames", variant: "all", error: r.stderr.slice(0, 400) }); return; }
  const frames = JSON.parse(r.stdout);
  for (const [name, fr] of Object.entries(frames)) {
    const plain = strip(fr.text);
    // The renderer is a pure function with no colour/charset switch: NO_COLOR,
    // TERM=dumb and a C locale produce byte-identical frames (recorded under
    // each variant name so reviewers can diff; see INDEX.md).
    const variants = fr.cols === 120 ? ["tty-color-120"] : fr.cols === 80 ? ["tty-color-80", "no-color", "term-dumb", "ascii-locale"] : ["tty-color-80"];
    for (const variant of variants) {
      save(join("tui", "frames", name), `${variant}.ansi`, fr.text);
      save(join("tui", "frames", name), `${variant}.txt`, plain);
      manifest.push({ group: "tui", id: `frames/${name}`, title: `buildFrame ${fr.cols}x${fr.rows}`, variant, exit: 0, hasAnsi: true, ...widthStats(plain), command: "render-tui.ts (real frame.ts)" });
    }
  }
  // Live TUI (real app.ts) first frame, logged out, then 'q'. Non-TTY variants
  // capture the refusal message.
  for (const variant of ONLY_VARIANTS) {
    await nextPort();
    const f = makeFixture({ detect: [] });
    try {
      const v = VARIANTS[variant];
      const input = v.tty ? [{ after: "Settings & Login", send: "q" }] : "";
      const res = await runCaptured(BUN, ["run", join(KIT, "zcode-proxy-src", "src", "index.ts"), join(f.root, "proxy", "config.yaml")], { env: f.env(), cwd: f.root, variant, input, timeoutMs: 20000 });
      const outText = normalise(res.stdout, f);
      const plain = strip(outText);
      save(join("tui", "live"), `${variant}.txt`, plain + (res.stderr ? `\n--- stderr ---\n${strip(normalise(res.stderr, f))}` : ""));
      if (v.tty) save(join("tui", "live"), `${variant}.ansi`, outText);
      manifest.push({ group: "tui", id: "live", title: "zcode-proxy TUI (real app.ts), first frame then q", variant, exit: res.code, ms: res.ms, hasAnsi: /\x1b/.test(res.stdout), ...widthStats(plain), command: "bun run src/index.ts <config.yaml>" });
    } catch (err) {
      manifest.push({ group: "tui", id: "live", variant, error: String(err.message) });
    } finally { await stopProxy(f); rmSync(f.base, { recursive: true, force: true }); }
  }
}

function installPs1Excerpt() {
  // pwsh is not installed on this host: install.ps1 cannot run. Record its
  // user-facing strings statically so the audit can still reason about them.
  const src = readFileSync(join(KIT, "install.ps1"), "utf8").split("\n");
  const lines = src.map((l, i) => [i + 1, l]).filter(([, l]) => /Write-(Host|Warning|Error|Output)|throw |function (Step|Ok|Fail|Die|Write)/i.test(l));
  save(join("install", "install-ps1-static"), "source-excerpt.txt", "STATIC EXCERPT (not a run): install.ps1 user-facing output statements; pwsh unavailable on the capture host.\n\n" + lines.map(([n, l]) => `${String(n).padStart(4)}: ${l}`).join("\n") + "\n");
}

function writeIndex() {
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const ok = manifest.filter((m) => !m.error), failed = manifest.filter((m) => m.error);
  const head = spawnSync("git", ["-C", KIT, "rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 1000 }).stdout?.trim() || "unavailable";
  const lines = [
    "# CLI output baseline — index",
    "",
    `Generated by \`tests/ux-before/capture/capture.mjs\` against the kit at ${head}. Captures: **${ok.length} ok, ${failed.length} failed**.`,
    "",
    "Regenerate: `node tests/ux-before/capture/capture.mjs --kit <kit checkout> --out <dir>`",
    "",
    "## Variants",
    "",
    "| Variant | How | Notes |",
    "|---|---|---|",
    "| tty-color-80 | `script -qec` pty, `stty cols 80 rows 30`, TERM=xterm-256color, C.UTF-8 | `.ansi` = raw bytes (normalised), `.txt` = ANSI stripped. stdout+stderr are merged by the pty |",
    "| tty-color-120 | same, 120x40 | |",
    "| no-color | pty 80 cols + NO_COLOR=1 | |",
    "| term-dumb | pty 80 cols + TERM=dumb | |",
    "| ascii-locale | pty 80 cols + LANG=C LC_ALL=C (Unicode-poor stand-in) | Linux cannot emulate a Windows OEM code page; the `glyphs` column lists every non-ASCII glyph a cp437/cp850/cp1252 console would have to render |",
    "| pipe | stdout/stderr piped, stdin /dev/null | stderr in `pipe.stderr.txt` |",
    "| ci | piped + CI=true, TERM=dumb | stderr in `ci.stderr.txt` |",
    "",
    "Normalisation (all files): fixture paths → `<KIT>` `<HOME>` `<BIN>` `<TMP>` `<FIXTURE>`, kit checkout → `<SRC>`/`<PROXY_SRC>`, Bun/Node binaries → `<BUN>`/`<NODE>`, ISO timestamps → `<TS>`, transaction ids → `<TX>`, real pids → `<PID>`. The fixture proxy reports fixed numbers (pid 4242, rss 182 MB …). The local proxy key shown on TTY variants is the synthetic fixture key `UXFIXTURE-not-a-secret-…`; no real secret exists in any fixture.",
    "",
    "Fixtures: throwaway kit trees under $TMPDIR/ux-kit-* (HOME next to the kit), proxy template port rewritten to a free port per scenario (printed as 18458), `zcode-proxy-src/src/index.ts` replaced by `capture/fake-proxy.ts` (serves the kit's identity contract with fixed data; non-serve argv forwards to the real proxy CLI), synthetic credential/account stores (`capture/seed-store.ts`), loopback vendor double for `--upstream`, loopback GitHub stub for release `update` (`capture/fetch-stub.mjs`), local bare git origin for checkout `update`, fixture `curl` for install.sh. ZCODE_KIT_SKIP_DEPS=1 everywhere (so the setup live smoke reports \"skipped\").",
    "",
    "## Not captured (and why)",
    "",
    "- **install.ps1** (all variants): no PowerShell on the Linux capture host (`pwsh` absent); its tests are Windows-only CI legs. `install/install-ps1-static/source-excerpt.txt` lists its output statements statically. Real captures need Windows (PowerShell 5.1 + 7, conhost + Windows Terminal) → owner action / windows-latest CI.",
    "- **Windows consoles, macOS Terminal, iTerm2**: not available on this host; the design language treats them as constraints, not evidence.",
    "- **80 vs 120 columns for the zcode-kit CLI**: captured, but the CLI never reads the terminal width, so both files are byte-identical; the `max width` / `lines >80` columns show where an 80-column terminal soft-wraps.",
    "- **TUI frames under NO_COLOR / TERM=dumb / C locale**: `frame.ts` has no switch for any of them, so those frame files are byte-identical to tty-color-80 by construction; `tui/live/*` confirms it end to end with the real app.",
    "- **Setup live smoke request**: skipped by ZCODE_KIT_SKIP_DEPS=1 (needs the real proxy + upstream; out of scope for fixtures).",
    "- **Typed-ahead answers** (setup, update, install.sh on TTY variants) are echoed by the pty line discipline before the first prompt, exactly as in a real terminal when a user types ahead; the prompts themselves show the answer they consumed.",
    "- **Path normalisation** shortens fixture paths to \`<KIT>\`/\`<HOME>\`; inside the TUI frames this makes a few box rows look shorter than 80 cells (the raw frame is exact; the \`.ansi\` file is normalised the same way).",
    "- **auth login** (OAuth browser flow), **accounts unlock / pause / resume / remove --yes**: need a real login or mutate a real pool; not captured.",
    "",
    "## Captures",
    "",
    "| Group | Scenario | Variant | Exit | ANSI | max width | lines >80 | non-ASCII glyphs | File |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const m of manifest) {
    const path = m.group === "tui" && m.id === "live" ? `tui/live/${m.variant}.txt` : `${m.group}/${m.id}/${m.variant}.txt`;
    const file = m.error ? `FAILED: ${m.error.replace(/\|/g, "/").replace(/\n/g, " ")}` : `[${path}](${path})`;
    lines.push(`| ${m.group} | ${m.id} | ${m.variant} | ${m.exit ?? "—"} | ${m.error ? "—" : m.hasAnsi ? "yes" : "no"} | ${m.maxWidth ?? "—"} | ${m.linesOver80 ?? "—"} | ${m.glyphs ? "`" + m.glyphs.replace(/`/g, "'").replace(/\|/g, "/") + "`" : ""} | ${file} |`);
  }
  writeFileSync(join(OUT, "INDEX.md"), lines.join("\n") + "\n");
  console.log(`captures: ${ok.length} ok, ${failed.length} failed -> ${OUT}`);
}

// Windows: only the non-TTY variants run (no `script` pty), and
// these scenarios need a POSIX shell: install.sh itself, and the shell-script
// `opencode` fixture binary. They are not captured there.
const WIN32_SKIP = /^(install-sh-|run-opencode$)/;

async function main() {
  if (IS_WIN) {
    const tty = ONLY_VARIANTS.filter((v) => VARIANTS[v]?.tty);
    if (tty.length) throw new Error(`capture: TTY variants need a POSIX pty (script); on Windows use --variants pipe,ci (got ${tty.join(",")})`);
  }
  mkdirSync(OUT, { recursive: true });
  if (PINNED_PORT !== null && await portBusy()) throw new Error(`port ${PORT} is in use; another capture may be running`);
  for (const s of S) {
    if (ONLY && !ONLY.test(s.id)) continue;
    if (IS_WIN && WIN32_SKIP.test(s.id)) continue;
    for (const variant of ONLY_VARIANTS) {
      process.stdout.write(`${s.group}/${s.id} [${variant}] ... `);
      await runScenario(s, variant);
      const last = manifest[manifest.length - 1];
      console.log(last.error ? `ERROR ${last.error}` : `exit ${last.exit}`);
    }
  }
  if (!ONLY || ONLY.test("tui")) await captureTui();
  if (!ONLY || ONLY.test("install")) installPs1Excerpt();
  writeIndex();
}
main().catch(async (err) => {
  console.error(String(err?.message ?? err).slice(0, 400));
  process.exitCode = 1;
  await stopHealthChildren();
  mkdirSync(OUT, { recursive: true });
  writeIndex();
});
