#!/usr/bin/env node
// zcode-kit — install, diagnose, run, update, roll back the local ZCode
// provider integration for your own agent harnesses.
//
// Commands:
//   zcode-kit setup [--harness auto|<list>]      bootstrap + integrate detected harnesses
//   zcode-kit integrate <harness> [--dry-run] [--scope user]
//   zcode-kit run <harness> -- <args>            launch a harness wired to ZCode
//   zcode-kit doctor [--harness <id>] [--json]
//   zcode-kit status
//   zcode-kit models [--json] [--show-key]
//   zcode-kit usage --json
//   zcode-kit auth status|login|logout
//   zcode-kit update [--version <v>]
//   zcode-kit rollback [tx-id]
//   zcode-kit uninstall
//
// Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
// 5 auth/identity failure. Unknown harness names are errors, not no-ops.
import { beginTransaction, acquireLock, releaseLock, rollbackTransaction, listTransactions } from "../lib/transaction.mjs";
import { detectHarnesses } from "../lib/detect.mjs";
import { createCtx, bootstrap, kitRoot } from "./context.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ADAPTER_IDS = ["omp", "pi", "claude-code", "codex", "opencode", "cline", "kilo-code", "aider", "continue", "goose"];

function loadAdapter(id) {
  // eslint-disable-next-line no-bitwise
  return import(`./adapters/${id}.mjs`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let passthrough = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" && passthrough === null) {
      passthrough = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else positional.push(a);
  }
  return { positional, flags, passthrough };
}

const { positional, flags, passthrough } = parseArgs(process.argv.slice(2));
const command = positional[0] ?? "help";
const ROOT = kitRoot();
const BACKUP_DIR = join(ROOT, "backups");
let ctx;

async function main() {
  if (command === "help" || flags.help) return usage(0);
  ctx = createCtx(ROOT);

  switch (command) {
    case "setup": return cmdSetup();
    case "integrate": return cmdIntegrate();
    case "run": return cmdRun();
    case "doctor": return cmdDoctor();
    case "status": return cmdStatus();
    case "models": return cmdModels();
    case "usage": return cmdUsage();
    case "auth": return cmdAuth();
    case "update": return cmdUpdate();
    case "rollback": return cmdRollback();
    case "uninstall": return cmdUninstall();
    default:
      console.error(`unknown command: ${command}`);
      return usage(2);
  }
}

function usage(code) {
  console.log(`zcode-kit — local ZCode provider for your own agent harnesses

  zcode-kit setup [--harness auto|omp,pi,...]   bootstrap + integrate (auto = detect)
  zcode-kit integrate <harness> [--dry-run] [--scope user]
  zcode-kit run <harness> -- <args>             launch harness wired to ZCode
  zcode-kit doctor [--harness <id>] [--json]
  zcode-kit status | models [--json] [--show-key] | usage --json
  zcode-kit auth status|login|logout
  zcode-kit update [--version <v>] | rollback [tx-id] | uninstall

Harnesses: ${ADAPTER_IDS.join(", ")}`);
  return code;
}

function requireHarness(name) {
  if (!ADAPTER_IDS.includes(name)) {
    console.error(`unknown harness "${name}". Known: ${ADAPTER_IDS.join(", ")}`);
    process.exit(2);
  }
}

function runProxyCli(args, opts = {}) {
  const res = spawnSync("bun", ["run", "src/index.ts", ...args], {
    cwd: ctx.proxySrc,
    env: { ...process.env, ZCODE_PROXY_CONFIG: ctx.config },
    encoding: "utf8",
    ...opts,
  });
  return res;
}

function proxyFetch(path, init = {}, timeoutMs = 8000) {
  const key = ctx.key();
  const port = ctx.port();
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// ------------------------------------------------------------------- setup

// A tarball install carries no .git; a source checkout always does. Writing
// user configs against a checkout root silently forks machine state when two
// copies exist (install dir + checkout share one home), so it needs an
// explicit opt-in. Read-only paths (doctor, status, --dry-run) stay open.
function assertNotCheckoutWrite() {
  if (ctx.dryRun) return;
  if (!existsSync(join(ctx.root, ".git"))) return;
  if (process.env.ZCODE_KIT_ALLOW_CHECKOUT === "1") return;
  throw new Error(
    `refusing to write user configs from a source checkout (${ctx.root}) — ` +
      "run the installed copy instead, or set ZCODE_KIT_ALLOW_CHECKOUT=1 to proceed intentionally",
  );
}

async function cmdSetup() {
  const harnessArg = flags.harness ?? "auto";
  const detected = detectHarnesses(ctx.home);
  const targets = harnessArg === "auto"
    ? ADAPTER_IDS.filter((id) => detected[id])
    : String(harnessArg).split(",").map((s) => s.trim()).filter(Boolean);
  for (const t of targets) requireHarness(t);
  assertNotCheckoutWrite();

  acquireLock(BACKUP_DIR);
  const tx = beginTransaction(BACKUP_DIR, `zcode-kit setup ${harnessArg}`);
  ctx.tx = tx;
  let txId = null;
  try {
    bootstrap(ctx);
    console.log(
      "detected harnesses: " +
        (Object.entries(detected).filter(([, v]) => v).map(([k]) => k).join(", ") || "none") +
        " — adapters run only for detected or explicitly requested harnesses",
    );
    for (const id of targets) {
      const { default: adapter } = await loadAdapter(id);
      console.log(`== ${id}: ${adapter.label} ==`);
      adapter.apply(ctx, tx, (m) => console.log(m));
    }
    await integrateMcp(tx, detected, targets);
    console.log("\ndone. Quick checks:");
    console.log("  node proxy/zcode-proxy-manager.mjs doctor");
    console.log("  zcode-kit status");
  } finally {
    let finishErr = null;
    try { txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
    if (finishErr) console.error(`WARN: recording the transaction failed (${finishErr.message})`);
    if (txId) console.log(`\ntransaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  }
  return 0;
}

/** MCP bridge registration (OMP mcp.json / claude mcp add) — additive, namespaced. */
async function integrateMcp(tx, detected, targets) {
  if (flags["no-mcp"]) return;
  const serverJs = join(ctx.mcpDir, "dist", "index.js");
  if (!existsSync(serverJs)) {
    console.log("== mcp: bridge dist missing — run setup again after install ==");
    return;
  }
  console.log("== mcp: zcode-harness bridge ==");
  if (targets.includes("omp") || detected.omp) {
    const ompMcp = join(ctx.home, ".omp", "agent", "mcp.json");
    if (existsSync(ompMcp)) {
      try {
        const j = JSON.parse(readFileSync(ompMcp, "utf8"));
        if (!j.mcpServers?.["zcode-harness"]) {
          j.mcpServers = j.mcpServers ?? {};
          j.mcpServers["zcode-harness"] = { type: "stdio", command: "node", args: [serverJs, "--stdio"] };
          tx.touch(ompMcp);
          writeFileSync(ompMcp, JSON.stringify(j, null, 2) + "\n");
          console.log("  omp: mcp.json updated (zcode-harness → stdio bridge)");
        } else {
          console.log('  omp: "zcode-harness" already registered');
        }
      } catch (err) {
        console.log(`  WARN: mcp.json is not valid JSON (${err.message}) — skipped`);
      }
    } else if (detected.omp) {
      tx.touch(ompMcp);
      writeFileSync(ompMcp, JSON.stringify({ mcpServers: { "zcode-harness": { type: "stdio", command: "node", args: [serverJs, "--stdio"] } } }, null, 2) + "\n");
      console.log("  omp: created mcp.json with zcode-harness bridge");
    }
  }
  if ((targets.includes("claude-code") || detected["claude-code"]) && detected["claude-code"]) {
    const get = spawnSync("claude", ["mcp", "get", "zcode-harness"], { stdio: "pipe", encoding: "utf8" });
    if (get.status === 0) {
      console.log('  claude: "zcode-harness" already registered');
    } else {
      const add = spawnSync("claude", ["mcp", "add", "zcode-harness", "--scope", "user", "--", "node", serverJs, "--stdio"], { stdio: "pipe", encoding: "utf8" });
      if (add.status === 0) {
        console.log('  claude: registered "zcode-harness" (user scope)');
        tx.external('claude MCP server "zcode-harness" registered (user scope)', "claude mcp remove zcode-harness --scope user");
      } else {
        console.log(`  WARN: claude mcp add failed: ${(add.stderr ?? "").trim().slice(0, 200)}`);
      }
    }
  }
  console.log("  NOTE: model turns through the bridge require the ZCode Desktop app to be running.");
}

// --------------------------------------------------------------- integrate
async function cmdIntegrate() {
  const id = positional[1];
  requireHarness(id);
  const { default: adapter } = await loadAdapter(id);
  const detected = detectHarnesses(ctx.home);
  if (flags["dry-run"]) {
    console.log(`== integrate ${id}: DRY RUN (no changes written) ==`);
    console.log(`  detected: ${detected[id] ? "yes" : "no"}`);
    ctx.dryRun = true;
    ctx.tx = null;
    const txNoop = { touch: (f) => console.log(`  would record: ${f}`), external: (d, h) => console.log(`  would register: ${d} (undo: ${h})`) };
    adapter.apply(ctx, txNoop, (m) => console.log("  " + m));
    return 0;
  }
  assertNotCheckoutWrite();
  acquireLock(BACKUP_DIR);
  const tx = beginTransaction(BACKUP_DIR, `zcode-kit integrate ${id}`);
  ctx.tx = tx;
  let txId = null;
  try {
    bootstrap(ctx);
    console.log(`== integrate ${id}: ${adapter.label} ==`);
    adapter.apply(ctx, tx, (m) => console.log(m));
  } finally {
    let finishErr = null;
    try { txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
    if (txId) console.log(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
    if (finishErr) console.error(`WARN: recording the transaction failed (${finishErr.message})`);
  }
  return 0;
}

// --------------------------------------------------------------------- run
async function cmdRun() {
  const id = positional[1];
  requireHarness(id);
  const args = passthrough ?? [];
  const key = ctx.key();
  const env = { ...process.env, ZCODE_PROXY_KEY: key };
  ensureProxyRunning();
  let cmd, argv;
  if (id === "claude-code") {
    cmd = process.platform === "win32" ? join(ROOT, "bin", "zcode-claude.cmd") : join(ROOT, "bin", "zcode-claude.sh");
    argv = args;
  } else if (id === "codex") {
    cmd = process.platform === "win32" ? join(ROOT, "bin", "zcode-codex.cmd") : join(ROOT, "bin", "zcode-codex.sh");
    argv = args;
  } else if (id === "aider") {
    cmd = process.platform === "win32" ? join(ROOT, "bin", "zcode-aider.cmd") : join(ROOT, "bin", "zcode-aider.sh");
    argv = args;
  } else if (id === "opencode") {
    cmd = "opencode";
    argv = args;
  } else {
    console.error(`run: no launcher for "${id}" (use setup/integrate instead)`);
    return 2;
  }
  const res = spawnSync(cmd, argv, { stdio: "inherit", env, shell: process.platform === "win32" && cmd.endsWith(".cmd") });
  return res.status ?? 1;
}

function ensureProxyRunning() {
  const manager = join(ROOT, "proxy", "zcode-proxy-manager.mjs");
  const res = spawnSync(process.execPath, [manager, "start"], { encoding: "utf8", timeout: 40000 });
  if (res.status !== 0) {
    console.error((res.stdout ?? "") + (res.stderr ?? ""));
    console.error("ERROR: the local proxy could not be started/verified — see logs/proxy.log");
    process.exit(3);
  }
}

// ------------------------------------------------------------------ doctor
async function cmdDoctor() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const managerPath = join(ROOT, "proxy", "zcode-proxy-manager.mjs");
  const core = spawnSync(process.execPath, [managerPath, "doctor"], { encoding: "utf8" });
  if (flags.json) {
    const lines = (core.stdout ?? "").split("\n");
    for (const line of lines) {
      const m = line.match(/^(PASS|FAIL|SKIP)\s+(.+?)(?:\s+—\s+(.*))?$/);
      if (m) checks.push({ name: m[2], ok: m[1] === "PASS" ? true : m[1] === "FAIL" ? false : null, detail: m[3] ?? "" });
    }
  } else {
    process.stdout.write(core.stdout ?? "");
  }

  const ids = flags.harness ? [String(flags.harness)] : [];
  if (flags.harness) requireHarness(String(flags.harness));
  else ids.push(...ADAPTER_IDS);
  const detected = detectHarnesses(ctx.home);
  for (const id of ids) {
    const { default: adapter } = await loadAdapter(id);
    if (!flags.harness && !detected[id]) {
      checks.push({ name: `${id}: integration`, ok: null, detail: "not detected — skipped" });
      continue;
    }
    for (const c of adapter.verify(ctx)) checks.push({ name: `${id}: ${c.name}`, ok: c.ok, detail: c.detail ?? "" });
  }

  const failed = checks.filter((c) => c.ok === false).length;
  const skipped = checks.filter((c) => c.ok === null).length;
  if (flags.json) {
    console.log(JSON.stringify({ ok: failed === 0, failed, skipped, checks }, null, 2));
  } else {
    for (const c of checks) {
      const tag = c.ok === null ? "SKIP" : c.ok ? "PASS" : "FAIL";
      console.log(`${tag}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.log(failed === 0 ? `doctor: ${skipped} skipped, ${failed} failed — OK` : `doctor: ${failed} check(s) failed`);
  }
  return failed === 0 ? 0 : 1;
}

// ------------------------------------------------------------------ status
async function cmdStatus() {
  const manager = join(ROOT, "proxy", "zcode-proxy-manager.mjs");
  const res = spawnSync(process.execPath, [manager, "status"], { stdio: "inherit" });
  return res.status ?? 1;
}

// ------------------------------------------------------------------ models
async function cmdModels() {
  let list = null;
  try {
    const res = await proxyFetch("/v1/models");
    if (res.ok) {
      const body = await res.json();
      list = (body.data ?? []).map((m) => m.id);
    }
  } catch {}
  if (!list) {
    // Proxy down: report the registry snapshot from the kit's synced copy.
    const registry = await loadAdapterRegistrySnapshot();
    list = registry;
  }
  if (flags.json) {
    console.log(JSON.stringify({ models: list, source: list ? "proxy" : "registry" }, null, 2));
  } else {
    console.log(list.join("\n"));
  }
  if (flags["show-key"]) {
    console.error("\nlocal proxy key (never share; shown because --show-key was given):");
    console.log(ctx.key());
  }
  return 0;
}

async function loadAdapterRegistrySnapshot() {
  // Reads the proxy's own model list via the vendored source (single source of
  // truth), falling back to the known pair when the source tree is absent.
  try {
    const dump = spawnSync("bun", ["-e", 'import { MODELS } from "./src/provider/models.ts"; console.log(JSON.stringify(MODELS.map(m=>m.id)))'], {
      cwd: ctx.proxySrc, encoding: "utf8", timeout: 30000,
    });
    if (dump.status === 0) return JSON.parse(dump.stdout.trim().split("\n").pop());
  } catch {}
  return ["glm-5.3", "glm-5.3-flash"];
}

// ------------------------------------------------------------------- usage
async function cmdUsage() {
  try {
    const res = await proxyFetch("/quota");
    const body = await res.json();
    console.log(JSON.stringify(body, null, 2));
    return res.ok ? 0 : 1;
  } catch (err) {
    console.log(JSON.stringify({ error: { type: "quota_unavailable", message: String(err.message) } }, null, 2));
    return 1;
  }
}

// -------------------------------------------------------------------- auth
async function cmdAuth() {
  const sub = positional[1] ?? "status";
  if (sub === "status") {
    try {
      const res = await proxyFetch("/quota");
      const body = await res.json();
      console.log(JSON.stringify({ logged_in: res.ok || body?.code !== 3012, errors: body?.errors ?? [], jwt: body?.jwt ?? null }, null, 2));
      return 0;
    } catch (err) {
      console.log(JSON.stringify({ logged_in: false, error: String(err.message) }, null, 2));
      return 1;
    }
  }
  if (sub === "login") {
    const res = runProxyCli(["auth", "login", "zai"], { stdio: "inherit" });
    return res.status ?? 1;
  }
  if (sub === "logout") {
    console.log("This removes the kit proxy's OWN stored credential (~/.zcode-proxy/credentials.json).");
    console.log("Your ZCode Desktop login and its data are NOT touched.");
    if (flags.yes !== true) {
      console.log("Re-run with --yes to confirm.");
      return 2;
    }
    const credFile = join(ctx.home, ".zcode-proxy", "credentials.json");
    if (existsSync(credFile)) {
      rmSync(credFile);
      console.log("removed ~/.zcode-proxy/credentials.json (proxy-only credential)");
    } else {
      console.log("no proxy credential present");
    }
    return 0;
  }
  console.error(`unknown auth subcommand: ${sub}`);
  return 2;
}

// ------------------------------------------------------------------ update
async function cmdUpdate() {
  // Conservative by design: refuses on a dirty tree; fast-forward only.
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  if ((dirty.stdout ?? "").trim().length > 0) {
    console.error("update: working tree has changes — commit or stash first (refusing to mix user changes into an update).");
    return 2;
  }
  const fetch = spawnSync("git", ["fetch", "origin"], { cwd: ROOT, stdio: "inherit" });
  if (fetch.status !== 0) return fetch.status ?? 1;
  const merge = spawnSync("git", ["merge", "--ff-only", `origin/${flags.version ?? "main"}`], { cwd: ROOT, stdio: "inherit" });
  if (merge.status !== 0) {
    console.error("update: fast-forward not possible (history diverged). Resolve manually — the kit never force-updates.");
    return merge.status ?? 1;
  }
  console.log("update: re-applying integrations for detected harnesses...");
  return cmdSetup();
}

// ---------------------------------------------------------------- rollback
async function cmdRollback() {
  const id = positional[1] ?? null;
  const r = rollbackTransaction(BACKUP_DIR, id);
  if (!r.id) return console.log("nothing to roll back") ?? 0;
  for (const t of r.restored) console.log(`restored: ${t}`);
  for (const t of r.removed) console.log(`removed (kit-created): ${t}`);
  for (const c of r.conflicts) console.log(`CONFLICT (left untouched): ${c}`);
  for (const e of r.external) console.log(`manual undo required: ${e.description}\n  -> ${e.undoHint}`);
  return 0;
}

// --------------------------------------------------------------- uninstall
async function cmdUninstall() {
  console.log("Scope: removes KIT-OWNED integrations and artifacts. Your ZCode Desktop login,");
  console.log("~/.zcode-proxy/credentials.json (shared credential store) and harness data are NOT deleted.");
  const ids = listTransactions(BACKUP_DIR);
  for (let i = ids.length - 1; i >= 0; i--) {
    const r = rollbackTransaction(BACKUP_DIR, ids[i]);
    console.log(`rollback ${ids[i]}: ${r.restored.length} restored, ${r.removed.length} removed, ${r.conflicts.length} conflict(s)`);
  }
  // Kit-owned generated artifacts (recorded in transactions; delete leftovers too).
  if (existsSync(ctx.generated)) rmSync(ctx.generated, { recursive: true, force: true });
  console.log("generated/ removed. The proxy key (.proxykey) and logs stay; delete manually if desired.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1].replace(/\\/g, "/")).href) {
  main().then((code) => process.exit(code ?? 0)).catch((err) => {
    console.error(`zcode-kit: ${err.message}`);
    process.exit(2);
  });
}

