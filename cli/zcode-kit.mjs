#!/usr/bin/env node
// zcode-kit — install, diagnose, run, update, roll back the local ZCode
// provider integration for your own agent harnesses.
//
// Commands:
//   zcode-kit setup [--harness auto|<list>]      bootstrap + integrate detected harnesses
//   zcode-kit integrate <harness> [--dry-run]
//   zcode-kit run <harness> -- <args>            launch a harness wired to ZCode
//   zcode-kit doctor [--fix] [--harness <id>] [--json]   --fix also (re)starts a down or proven-hung proxy
//   zcode-kit status                              includes /health details (memory, captcha, solver)
//   zcode-kit proxy start|stop|restart|status|logs [n]
//   zcode-kit models [--json] [--show-key]
//   zcode-kit usage --json
//   zcode-kit auth status|login|logout
//   zcode-kit accounts [--json|--live]
//   zcode-kit accounts remove|pause|resume ID [--yes]
//   zcode-kit accounts explain --model MODEL --operation OP
//   zcode-kit accounts doctor [--json] | accounts quota | accounts health [--json]
//   zcode-kit update [--version vX.Y.Z]          checkout: fast-forward; npm: npm install; release: verified tarball mirror
//   zcode-kit rollback [tx-id]
//   zcode-kit uninstall
//
// Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
// 4 safe-start refused (lock/ownership) · 5 auth/identity failure. Unknown
// harness names are errors, not no-ops. `setup` exits 0 once the integration
// is saved even if the optional live smoke request fails (it prints a warning).
import { beginTransaction, acquireLock, releaseLock, rollbackTransaction, listTransactions } from "../lib/transaction.mjs";
import { detectHarnesses } from "../lib/detect.mjs";
import { createCtx, bootstrap, kitRoot } from "./context.mjs";
import { repairManaged, setupSmoke, startupPreflight } from "./heal.mjs";
import { diagnoseQuota, quotaAuthValid } from "./quota-diagnostics.mjs";
import { spawnSync } from "node:child_process";
import { runCommandSync, resolveBun } from "../lib/process.mjs";
import { proxyEnv } from "../lib/proxy-env.mjs";
import { ensureState } from "../lib/state.mjs";
import {
  detectInstallType,
  downloadRelease,
  extractTarball,
  installedVersion,
  mirrorTree,
  repoFromPackage,
  resolveLatestTag,
  stripV,
} from "../lib/self-update.mjs";
import { commitFile, ensureDir } from "../lib/edit.mjs";
import { launchHarness } from "./launch.mjs";
import { askAccountRotator, configureAccountRotator, restartForAccountChange, rotatorChoice } from "./account-setup.mjs";
import { setupOutput } from "./setup-output.mjs";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
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
      else if (["fix", "json", "dry-run", "no-mcp", "yes", "help", "show-key", "installer", "verbose", "import", "paste", "replace", "live"].includes(a.slice(2))) flags[a.slice(2)] = true;
      else flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else positional.push(a);
  }
  return { positional, flags, passthrough };
}

const { positional, flags, passthrough } = parseArgs(process.argv.slice(2));
const command = positional[0] ?? "help";
const ROOT = kitRoot();
let BACKUP_DIR;
let ctx;

async function main() {
  if (command === "help" || flags.help) return usage(0);
  ctx = createCtx(ROOT);
  BACKUP_DIR = ctx.backupDir;

  switch (command) {
    case "setup": return cmdSetup();
    case "integrate": return cmdIntegrate();
    case "run": return cmdRun();
    case "doctor": return cmdDoctor();
    case "status": return cmdStatus();
    case "proxy": return cmdProxy();
    case "models": return cmdModels();
    case "usage": return cmdUsage();
    case "auth": return cmdAuth();
    case "accounts": return cmdAccounts();
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
  zcode-kit integrate <harness> [--dry-run]
  zcode-kit run <harness> -- <args>             launch harness wired to ZCode
  zcode-kit doctor [--fix] [--harness <id>] [--json]
  zcode-kit status | models [--json] [--show-key] | usage --json
  zcode-kit proxy start|stop|restart|status|logs [n]   manage the local proxy service
  zcode-kit auth status|login [zai|bigmodel] [--import] [--account ID] [--replace]|logout
  zcode-kit accounts enable|disable
  zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes]
  zcode-kit accounts explain --model MODEL --operation OP
  zcode-kit accounts doctor [--json] | accounts quota | accounts health [--json]
  zcode-kit update [--version vX.Y.Z] | rollback [tx-id] | uninstall
  (update keeps .proxykey, proxy/config.yaml, logs, backups, generated and node_modules)
  (setup: --harness <list> limits adapters AND MCP registration; --no-mcp skips registration)
  (setup: --account-rotator y|n for unattended installs; --verbose for full installer output)

Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
4 safe-start refused · 5 auth/identity failure

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
  const res = spawnSync(resolveBun(ctx.root), ["run", "src/index.ts", ...args], {
    cwd: ctx.proxySrc,
    env: proxyEnv(ctx),
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
  const explicitChoice = rotatorChoice(flags["account-rotator"] ?? process.env.ZCODE_KIT_ACCOUNT_ROTATOR);
  const harnessArg = flags.harness ?? "auto";
  const detected = detectHarnesses(ctx.home);
  const targets = harnessArg === "auto"
    ? ADAPTER_IDS.filter((id) => detected[id])
    : String(harnessArg).split(",").map((s) => s.trim()).filter(Boolean);
  for (const t of targets) requireHarness(t);
  assertNotCheckoutWrite();

  ensureState(ctx);
  const compact = flags.installer === true && flags.verbose !== true && process.env.ZCODE_KIT_VERBOSE !== "1";
  const ui = setupOutput(ctx, compact);
  acquireLock(BACKUP_DIR);
  const tx = beginTransaction(BACKUP_DIR, `zcode-kit setup ${harnessArg}`);
  ctx.tx = tx;
  let txId = null;
  let accountChange = false;
  try {
    ui.step("Runtime and configuration");
    bootstrap(ctx, (...args) => ui.detail(...args));
    ui.ok("Runtime ready");
    ui.step("Assistant integrations");
    ui.detail(
      "detected harnesses: " +
        (Object.entries(detected).filter(([, v]) => v).map(([k]) => k).join(", ") || "none") +
        " — adapters run only for detected or explicitly requested harnesses",
    );
    for (const id of targets) {
      const { default: adapter } = await loadAdapter(id);
      ui.detail(`== ${id}: ${adapter.label} ==`);
      let skipped = false, warning = false;
      adapter.apply(ctx, tx, (m) => { ui.detail(m); skipped ||= /\bskipped\b/i.test(m); warning ||= /\bWARN:/i.test(m); });
      if (warning) ui.warn(`${adapter.label}: review the warning above`);
      else if (skipped) ui.skip(adapter.label);
      else ui.ok(adapter.label);
    }
    await integrateMcp(tx, detected, targets, (...args) => ui.detail(...args));
    ui.step("Account Rotator");
    console.log("\n  Keep authorized logins as separate encrypted accounts.");
    console.log("  New logins are saved automatically while the feature is enabled.");
    const choice = explicitChoice ?? await askAccountRotator();
    if (choice === undefined) {
      console.log("  Account Rotator setting unchanged (no interactive answer).");
      console.log("  Enable later: zcode-kit accounts enable");
    } else {
      const result = configureAccountRotator(ctx, tx, choice, runProxyCli);
      accountChange = result.changed;
      console.log(choice ? `  [OK] Account Rotator enabled (${result.accountCount} saved accounts).` : "  [OK] Account Rotator disabled. Saved accounts are kept.");
      if (choice && result.accountCount === 0) console.log("  Add your first account: zcode-kit auth login zai");
    }
  } finally {
    let finishErr = null;
    try { txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
    if (finishErr) console.error(`WARN: recording the transaction failed (${finishErr.message})`);
    if (txId) ui.detail(`\ntransaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  }
  if (accountChange) await restartForAccountChange(ctx);
  console.log("\n  Configuration saved.");
  ui.step("Connection check");
  const smoke = await setupSmoke(ctx);
  if (smoke.code) ui.warn(smoke.detail);
  else console.log(`  [${smoke.cause === "skipped" ? "SKIP" : "OK"}] ${smoke.detail}`);
  if (compact) console.log(`\n  Setup log: ${ui.logPath}`);
  return 0;
}

function sameInstallationPath(candidate, expected) {
  if (typeof candidate !== "string" || !isAbsolute(candidate)) return false;
  const canonical = value => {
    let resolved = normalize(value);
    try { resolved = realpathSync(resolved); } catch { /* lexical identity still handles missing artifacts */ }
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return canonical(candidate) === canonical(expected);
}

function claudeMcpEntryPath(output) {
  // `claude mcp get` is a human-readable display, not a shell command. Match
  // the entire argument field, allowing a quoted script path with spaces;
  // substring checks would incorrectly adopt `index.js.foreign`.
  const text = String(output ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const field = text.match(/^\s*Args:\s*(.+?)\s+--stdio\s*$/m)?.[1];
  if (!field) return null;
  return field.startsWith('"') && field.endsWith('"') ? field.slice(1, -1) : field;
}

/** MCP bridge registration (OMP mcp.json / claude mcp add) — additive, namespaced. */
async function integrateMcp(tx, detected, targets, log = console.log) {
  if (flags["no-mcp"]) return;
  const serverJs = join(ctx.mcpDir, "dist", "index.js");
  if (!existsSync(serverJs)) {
    log("== mcp: bridge dist missing — run setup again after install ==");
    return;
  }
  log("== mcp: zcode-harness bridge ==");
  if (targets.includes("omp") && detected.omp) {
    const ompMcp = join(ctx.home, ".omp", "agent", "mcp.json");
    const entry = { type: "stdio", command: "node", args: [serverJs, "--stdio"] };
    if (existsSync(ompMcp)) {
      try {
        const j = JSON.parse(readFileSync(ompMcp, "utf8"));
        const current = j.mcpServers?.["zcode-harness"];
        // F-09: an entry pointing at ANOTHER kit copy is not "ours" — replace
        // only when it is absent or already points at this installation.
        const ours = !current || (Array.isArray(current.args) && sameInstallationPath(current.args[0], serverJs));
        if (!current || (ours && JSON.stringify(current) !== JSON.stringify(entry))) {
          j.mcpServers = j.mcpServers ?? {};
          j.mcpServers["zcode-harness"] = entry;
          commitFile(ctx, tx, ompMcp, JSON.stringify(j, null, 2) + "\n");
          log("  omp: mcp.json updated (zcode-harness → stdio bridge)");
        } else if (!ours) {
          log(`  WARN: omp mcp.json "zcode-harness" points at another kit copy (${current.args?.[0] ?? "?"}) — left untouched`);
        } else {
          log('  omp: "zcode-harness" already registered');
        }
      } catch (err) {
        log(`  WARN: mcp.json is not valid JSON (${err.message}) — skipped`);
      }
    } else {
      commitFile(ctx, tx, ompMcp, JSON.stringify({ mcpServers: { "zcode-harness": entry } }, null, 2) + "\n");
      log("  omp: created mcp.json with zcode-harness bridge");
    }
  }
  if (targets.includes("claude-code") && detected["claude-code"]) {
    const get = runCommandSync("claude", ["mcp", "get", "zcode-harness"], { stdio: "pipe", encoding: "utf8" });
    if (get.status === 0 && !sameInstallationPath(claudeMcpEntryPath(get.stdout), serverJs)) {
      // F-09: registered by another kit copy — never silently adopt it.
      log('  WARN: claude "zcode-harness" is registered by another kit copy — left untouched');
    } else if (get.status === 0) {
      log('  claude: "zcode-harness" already registered');
    } else {
      const add = runCommandSync("claude", ["mcp", "add", "zcode-harness", "--scope", "user", "--", "node", serverJs, "--stdio"], { stdio: "pipe", encoding: "utf8" });
      if (add.status === 0) {
        log('  claude: registered "zcode-harness" (user scope)');
        tx.external('claude MCP server "zcode-harness" registered (user scope)', "claude mcp remove zcode-harness --scope user");
      } else {
        log(`  WARN: claude mcp add failed: ${(add.error?.message || add.stderr || `exit ${add.status}`).trim().slice(0, 200)}`);
      }
    }
  }
  log("  NOTE: the bridge defaults to its dedicated workspace allowlist and denied permission requests; standalone model turns may be rejected by the provider independently of Desktop availability.");
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
  ensureState(ctx);
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
  return launchHarness(ctx, id, passthrough ?? []);
}

// ------------------------------------------------------------------ doctor
async function cmdDoctor() {
  const ids = flags.harness ? String(flags.harness).split(",").map(s => s.trim()).filter(Boolean) : [...ADAPTER_IDS];
  for (const id of ids) requireHarness(id);
  const detected = detectHarnesses(ctx.home);
  if (flags.fix) {
    assertNotCheckoutWrite();
    const targets = ids.filter(id => flags.harness || detected[id]);
    const adapters = await Promise.all(targets.map(async id => (await loadAdapter(id)).default));
    const repaired = await repairManaged(ctx, adapters, flags.json ? () => {} : console.log);
    if (repaired.id && !flags.json) console.log(`transaction ${repaired.id} recorded — undo with: zcode-kit rollback ${repaired.id}`);
  }
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const managerPath = join(ROOT, "proxy", "zcode-proxy-manager.mjs");
  if (flags.fix) {
    // A down or hung proxy is the most common reason to run doctor --fix; the
    // manager's safe start (with its hung-own proof) is the only repair path.
    const { createManager } = await import(pathToFileURL(managerPath).href);
    if (await createManager({ root: ROOT, home: ctx.home }).healthIdentify() !== "ours") {
      const started = spawnSync(process.execPath, [managerPath, "start"], {
        encoding: "utf8", timeout: 180000, stdio: flags.json ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      const code = started.error || started.signal ? null : started.status;
      add("proxy start (--fix)", code === 0, code === 0 ? "proxy running and healthy"
        : `manager start exit ${code ?? "timeout"} — see zcode-kit proxy logs; next: zcode-kit proxy restart`);
      if (!flags.json) console.log(code === 0 ? "doctor --fix: proxy started" : `doctor --fix: proxy start failed (exit ${code ?? "timeout"})`);
    }
  }
  const core = spawnSync(process.execPath, [managerPath, "doctor"], { encoding: "utf8", timeout: 25000 });
  if (core.error || core.signal) add("manager doctor completed", false, "manager check failed or timed out");
  // Parse the manager doctor output in BOTH modes: the text summary and exit
  // code must count the same FAILs the user is shown, not only adapter checks.
  const lines = (core.stdout ?? "").split("\n");
  if (core.status !== 0 && !core.error && !core.signal && !lines.some(line => /^FAIL\s+/.test(line))) {
    add("manager doctor completed", false, `manager check exited ${core.status ?? "unknown"} without a diagnostic failure result`);
  }
  for (const line of lines) {
    const m = line.match(/^(PASS|FAIL|SKIP)\s+(.+?)(?:\s+—\s+(.*))?$/);
    if (m) checks.push({ name: m[2], ok: m[1] === "PASS" ? true : m[1] === "FAIL" ? false : null, detail: m[3] ?? "" });
  }
  if (!flags.json) {
    process.stdout.write(core.stdout ?? "");
  }

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

// ------------------------------------------------------------------- proxy
// Thin forwarding to the manager: it owns identity, ownership proofs and exit codes.
async function cmdProxy() {
  const sub = positional[1];
  if (!["start", "stop", "restart", "status", "logs"].includes(sub)) {
    console.error("Usage: zcode-kit proxy start|stop|restart|status|logs [n]");
    return 2;
  }
  const args = [join(ROOT, "proxy", "zcode-proxy-manager.mjs"), sub];
  if (sub === "logs" && positional[2] !== undefined) args.push(String(positional[2]));
  const res = spawnSync(process.execPath, args, { stdio: "inherit" });
  return res.status ?? 2;
}

// ------------------------------------------------------------------ models
async function cmdModels() {
  let list = null;
  let fromProxy = false;
  try {
    const res = await proxyFetch("/v1/models");
    if (res.ok) {
      const body = await res.json();
      list = (body.data ?? []).map((m) => m.id);
      fromProxy = true;
    }
  } catch {}
  if (!list) {
    // Proxy down: report the registry snapshot from the kit's synced copy.
    const registry = await loadAdapterRegistrySnapshot();
    list = registry;
  }
  if (flags.json) {
    // source must reflect where the list actually came from — a registry
    // fallback is NOT a proxy answer and must not be labeled as one.
    console.log(JSON.stringify({ models: list, source: fromProxy ? "proxy" : "registry" }, null, 2));
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
      const body = await res.json().catch(() => null);
      // Snapshot errors use billing prefixes, not a top-level code. A balance
      // rejection is not a logout; unknown/partial errors are not auth proof.
      const diagnostic = diagnoseQuota(res.status, body);
      const loggedIn = quotaAuthValid(res.status, body, diagnostic);
      const errors = diagnostic.cause === "healthy" ? [] : [diagnostic.detail];
      const jwt = body?.jwt && Number.isFinite(body.jwt.ageHours) && Number.isFinite(body.jwt.issuedAt)
        ? { ageHours: body.jwt.ageHours, issuedAt: body.jwt.issuedAt } : null;
      console.log(JSON.stringify({ logged_in: loggedIn, errors, jwt }, null, 2));
      return 0;
    } catch (err) {
      console.log(JSON.stringify({ logged_in: false, error: String(err.message) }, null, 2));
      return 1;
    }
  }
  if (sub === "login") {
    if (flags.account !== undefined && (typeof flags.account !== "string" || !flags.account.trim())) {
      console.error("--account requires an account ID.");
      return 2;
    }
    const args = ["auth", "login", positional[2] ?? "zai"];
    for (const option of ["import", "paste", "replace"]) if (flags[option] === true) args.push(`--${option}`);
    if (flags.account !== undefined) args.push("--account", String(flags.account));
    const res = runProxyCli(args, { stdio: "inherit" });
    return res.status ?? 1;
  }
  if (sub === "logout") {
    const credFile = process.env.ZCODE_PROXY_CREDENTIALS_PATH || join(ctx.home, ".zcode-proxy", "credentials.json");
    console.log(`This removes the kit proxy's effective credential store: ${credFile}`);
    console.log("Your ZCode Desktop login and its data are NOT touched.");
    if (flags.yes !== true) {
      console.log("Re-run with --yes to confirm.");
      return 2;
    }
    if (existsSync(credFile)) {
      rmSync(credFile);
      console.log(`removed ${credFile} (proxy-only credential)`);
    } else {
      console.log("no proxy credential present");
    }
    return 0;
  }
  console.error(`unknown auth subcommand: ${sub}`);
  return 2;
}

// --------------------------------------------------------------- accounts
// Offline account-pool wrapper. The proxy CLI owns encryption and redaction;
// this command forwards directly to it and never starts a serving process.
async function cmdAccounts() {
  const sub = positional[1];
  if (sub === "enable" || sub === "disable") {
    assertNotCheckoutWrite();
    ensureState(ctx);
    const lock = acquireLock(BACKUP_DIR);
    const tx = beginTransaction(BACKUP_DIR, `zcode-kit accounts ${sub}`);
    let result;
    try { result = configureAccountRotator(ctx, tx, sub === "enable", runProxyCli); }
    finally { try { tx.finish(); } finally { releaseLock(lock); } }
    if (result.changed) await restartForAccountChange(ctx);
    console.log(sub === "enable" ? `Account Rotator enabled (${result.accountCount} saved accounts). New logins are added automatically.` : "Account Rotator disabled. Saved accounts are kept.");
    return 0;
  }
  if (["remove", "pause", "resume"].includes(sub)) {
    const id = positional[2];
    if (!id || id.startsWith("--")) {
      console.error(`Usage: zcode-kit accounts ${sub} ID [--yes]`);
      return 2;
    }
    const args = ["auth", "accounts", sub, id];
    if (flags.yes === true) args.push("--yes");
    const res = runProxyCli(args, { stdio: "inherit" });
    return res.status ?? 1;
  }
  if (sub === "explain") {
    const args = ["auth", "accounts", "explain"];
    if (flags.model !== undefined) args.push("--model", String(flags.model));
    if (flags.operation !== undefined) args.push("--operation", String(flags.operation));
    if (flags.json === true) args.push("--json");
    const res = runProxyCli(args, { stdio: "inherit" });
    return res.status ?? 1;
  }
  if (sub === "doctor" || sub === "quota" || sub === "health") {
    const args = ["auth", "accounts", sub];
    if (flags.json === true) args.push("--json");
    const res = runProxyCli(args, { stdio: "inherit" });
    return res.status ?? 1;
  }
  if (sub !== undefined && sub !== "--json" && sub !== "--live") {
    console.error("Usage: zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes]");
    return 2;
  }
  const args = ["auth", "accounts"];
  if (flags.json === true) args.push("--json");
  if (flags.live === true) args.push("--live");
  const res = runProxyCli(args, { stdio: "inherit" });
  return res.status ?? 1;
}

// ------------------------------------------------------------------ update
// Three installation shapes, three update paths — update picks by layout:
//   checkout (.git present): git fetch + fast-forward to origin/main or a tag.
//   npm (node_modules/zcode-agent-kit): npm replaces the global package.
//   release tarball: download the published archive, verify its SHA-256
//     against checksums.txt, then mirror it over the installation while
//     keeping machine-local state (.proxykey, proxy/config.yaml, logs,
//     backups, generated, node_modules). Download, verification and
//     extraction all happen before the first installation file is touched.
// Every path stops a running proxy first and re-runs setup afterwards, so
// integrations and the proxy come back on the updated code.
async function cmdUpdate() {
  ensureState(ctx);
  const type = detectInstallType(ROOT);
  const wanted = flags.version === true ? "" : String(flags.version ?? "");
  if (flags.version !== undefined && !/^v?\d+\.\d+\.\d+$/.test(wanted)) {
    console.error(`update: --version expects a release tag like v0.2.11${wanted ? ` (got "${wanted}")` : ""}.`);
    return 2;
  }
  const pin = wanted ? `v${wanted.replace(/^v/, "")}` : null;
  const harnessArgs = [
    ...(flags.harness ? ["--harness", String(flags.harness)] : []),
    ...(flags["no-mcp"] ? ["--no-mcp"] : []),
  ];

  if (type === "checkout") {
    // Conservative by design: refuses on a dirty tree; fast-forward only.
    // V1-01: a missing git must be reported, not mistaken for a clean tree.
    const dirty = runCommandSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
    if (dirty.error || dirty.status !== 0) {
      console.error(`update: cannot run git (${dirty.error?.message ?? `exit ${dirty.status}`}) — install git or re-run the installer.`);
      return 2;
    }
    if ((dirty.stdout ?? "").trim().length > 0) {
      console.error("update: working tree has changes — commit or stash first (refusing to mix user changes into an update).");
      return 2;
    }
    const fetch = runCommandSync("git", ["fetch", "--tags", "origin"], { cwd: ROOT, stdio: "inherit" });
    if (fetch.error || fetch.status !== 0) {
      console.error(`update: git fetch failed${fetch.error ? ` (${fetch.error.message})` : ""}.`);
      return fetch.status ?? 2;
    }
    let target = "origin/main";
    if (pin) {
      const known = runCommandSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${pin}^{commit}`], { cwd: ROOT, encoding: "utf8" });
      if (known.error || known.status !== 0) {
        console.error(`update: release tag ${pin} does not exist on origin.`);
        return 2;
      }
      target = `refs/tags/${pin}`;
    }
    stopProxyIfRunning();
    const merge = runCommandSync("git", ["merge", "--ff-only", target], { cwd: ROOT, stdio: "inherit" });
    if (merge.error || merge.status !== 0) {
      console.error("update: fast-forward not possible (history diverged). Resolve manually — the kit never force-updates.");
      return merge.status ?? 2;
    }
    return finishUpdate(harnessArgs);
  }

  if (type === "npm") {
    const tag = pin ?? await resolveTargetTag();
    if (!tag) return 2;
    const installed = installedVersion(ROOT);
    if (!pin && installed && stripV(tag) === installed) {
      console.log(`update: already at v${installed} (latest). Nothing to do.`);
      return 0;
    }
    stopProxyIfRunning();
    const res = runCommandSync("npm", ["install", "-g", `zcode-agent-kit@${stripV(tag)}`], { stdio: "inherit" });
    if (res.error || res.status !== 0) {
      console.error(`update: npm install failed${res.error ? ` (${res.error.message})` : ""}. Run it manually: npm install -g zcode-agent-kit@${stripV(tag)}`);
      return res.status ?? 2;
    }
    return finishUpdate(harnessArgs);
  }

  const tag = pin ?? await resolveTargetTag();
  if (!tag) return 2;
  const installed = installedVersion(ROOT);
  if (!pin && installed && stripV(tag) === installed) {
    console.log(`update: already at v${installed} (latest). Nothing to do.`);
    return 0;
  }
  const tmp = mkdtempSync(join(tmpdir(), "zcode-kit-update-"));
  let txId = null;
  try {
    console.log(`update: downloading ${tag} ...`);
    const archive = await downloadRelease(repoFromPackage(ROOT), tag, tmp);
    const src = extractTarball(archive, join(tmp, "out"));
    const releaseVersion = installedVersion(src);
    if (releaseVersion !== stripV(tag)) {
      console.error(`update: archive sanity check failed (package version ${releaseVersion ?? "unknown"} != ${stripV(tag)}).`);
      return 2;
    }
    console.log(`update: verified ${tag} (sha256) — updating ${installed ? `v${installed} ` : ""}→ ${tag}`);
    stopProxyIfRunning();
    acquireLock(BACKUP_DIR);
    let tx;
    try {
      tx = beginTransaction(BACKUP_DIR, `zcode-kit update ${tag}`);
      tx.external(
        `kit files updated to ${tag}`,
        `re-apply the previous release: zcode-kit update --version ${installed ? `v${installed}` : "<previous>"} (or re-run the installer)`,
      );
      const { copied, deleted } = mirrorTree(src, ROOT);
      tx.finish();
      txId = tx.id;
      console.log(`update: applied ${tag} (${copied} files updated, ${deleted} removed)`);
    } catch (err) {
      // Record the interrupted transaction so zcode-kit rollback can list it.
      try { if (tx) tx.finish(); } catch { /* journal already persisted per op */ }
      throw err;
    } finally {
      releaseLock(join(BACKUP_DIR, ".setup-lock"));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return finishUpdate(harnessArgs, txId);
}

async function resolveTargetTag() {
  try {
    return await resolveLatestTag(repoFromPackage(ROOT));
  } catch (err) {
    console.error(`update: could not resolve the latest release (${err.message}).`);
    console.error("  Pin one explicitly: zcode-kit update --version vX.Y.Z");
    return null;
  }
}

function stopProxyIfRunning() {
  // The manager owns identity proofs: a foreign service on the port is left
  // alone (exit 3) and update continues — mirroring kit files does not touch it.
  const res = spawnSync(process.execPath, [join(ROOT, "proxy", "zcode-proxy-manager.mjs"), "stop"], { stdio: "inherit" });
  if (res.status !== 0 && res.status !== 3) {
    console.error(`update: proxy stop reported exit ${res.status ?? "unknown"} — continuing; the proxy may need a manual restart.`);
  }
}

function finishUpdate(harnessArgs, txId = null) {
  console.log("update: re-applying integrations for detected harnesses...");
  // Audit H3: explicitly running `update` IS the opt-in the checkout-write
  // guard asks for. Fresh process so the updated modules (not the ones
  // already loaded by this process) apply the integrations.
  const res = spawnSync(process.execPath, [join(ROOT, "cli", "zcode-kit.mjs"), "setup", ...harnessArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ZCODE_KIT_ALLOW_CHECKOUT: "1" },
  });
  if (res.status !== 0) {
    console.error("update: setup failed — the kit files are updated; inspect the output above and rerun `zcode-kit setup`.");
    return res.status ?? 2;
  }
  if (txId) console.log(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  return 0;
}

// ---------------------------------------------------------------- rollback
async function cmdRollback() {
  const id = positional[1] ?? null;
  // B-11: rollback mutates the same files as setup — serialize on the same lock.
  ensureState(ctx);
  acquireLock(BACKUP_DIR);
  let r;
  try {
    r = rollbackTransaction(BACKUP_DIR, id);
  } finally {
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
  }
  if (!r.id) return console.log("nothing to roll back") ?? 0;
  for (const t of r.restored) console.log(`restored: ${t}`);
  for (const t of r.removed) console.log(`removed (kit-created): ${t}`);
  for (const c of r.conflicts) console.log(`CONFLICT (left untouched): ${c}`);
  for (const e of r.external) console.log(`manual undo required: ${e.description}\n  -> ${e.undoHint}`);
  return r.complete ? 0 : 1;
}

// --------------------------------------------------------------- uninstall
async function cmdUninstall() {
  console.log("Scope: removes KIT-OWNED integrations and artifacts. Your ZCode Desktop login,");
  console.log("~/.zcode-proxy/credentials.json (shared credential store) and harness data are NOT deleted.");
  ensureState(ctx);
  acquireLock(BACKUP_DIR);
  let externalUndone = true;
  try {
    const ids = listTransactions(BACKUP_DIR);
    const serverJs = join(ctx.mcpDir, "dist", "index.js");
    // AUD-008: execute the KNOWN kit registrations' undo hints ourselves
    // (currently only the claude user-scope MCP registration); never run
    // arbitrary strings from manifests — only the exact undo command shape
    // we issued. F-09: only remove a registration that points at THIS copy.
    const undoExternal = (e) => {
      if (e.undoHint !== 'claude mcp remove zcode-harness --scope user') return false;
      const get = runCommandSync("claude", ["mcp", "get", "zcode-harness"], { stdio: "pipe", encoding: "utf8" });
      if (get.error) { console.error(`claude mcp get failed: ${get.error.message}`); return false; }
      if (get.status !== 0) return /not found|no.*server.*named/i.test(`${get.stdout ?? ''}\n${get.stderr ?? ''}`);
      if (!(get.stdout ?? "").includes(serverJs)) {
        console.log('claude "zcode-harness" is registered by another kit copy — left untouched');
        return true;
      }
      const res = runCommandSync("claude", ["mcp", "remove", "zcode-harness", "--scope", "user"], { stdio: "inherit" });
      if (res.error) console.error(`claude mcp remove failed: ${res.error.message}`);
      return !res.error && res.status === 0;
    };
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = rollbackTransaction(BACKUP_DIR, ids[i], { undoExternal });
      if (!r.complete) externalUndone = false;
      console.log(`rollback ${ids[i]}: ${r.restored.length} restored, ${r.removed.length} removed, ${r.conflicts.length} conflict(s)`);
      for (const conflict of r.conflicts) console.log(`CONFLICT (left untouched): ${conflict}`);
      for (const e of r.external) {
        console.log(`manual undo required: ${e.description}\n  -> ${e.undoHint}`);
        externalUndone = false;
      }
    }
  } finally {
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
  }
  console.log("Recorded kit files were rolled back. Unrecorded generated data, Codex sessions, proxy key and logs are preserved.");
  // The installers leave a user-scope `zcode-kit` command shim behind; remove
  // it only when it points at THIS root — a shim owned by another install
  // (or unreadable) is never touched.
  const shimPaths = process.platform === "win32"
    ? (process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "zcode-kit.cmd")] : [])
    : [join(ctx.home, ".local", "bin", "zcode-kit")];
  for (const shim of shimPaths) {
    try {
      const companion = shim.replace(/\.cmd$/i, '.ps1');
      if (process.platform === 'win32' && existsSync(shim) && existsSync(companion) && readFileSync(shim, 'utf8').includes('"%~dp0zcode-kit.ps1"') && readFileSync(companion, 'utf8').includes(join(ctx.root, 'cli', 'zcode-kit.mjs').replaceAll("'", "''"))) {
        rmSync(shim); rmSync(companion);
        console.log(`removed kit-owned command shims: ${shim}`);
      } else if (existsSync(shim) && readFileSync(shim, "utf8").includes(join(ctx.root, "cli", "zcode-kit.mjs"))) {
        rmSync(shim);
        console.log(`removed kit-owned command shim: ${shim}`);
      }
    } catch { /* unreadable shim is not ours to delete */ }
  }
  if (!externalUndone) {
    console.error("uninstall incomplete: a file conflict or external registration remains (see output above).");
    return 1;
  }
  return 0;
}

// Entry check, realpath-canonical: npm exposes global bins as symlinks
// (POSIX) or junctions (`npm i -g <folder>` on Windows), and argv[1] can carry
// arbitrary casing. import.meta.url is the realized path, so comparing it
// against the raw argv form silently no-ops the whole CLI. Compare realized
// against realized instead; a vanished entry falls through fail-closed.
const entryArg = process.argv[1] ?? "";
let entryReal = "";
try {
  entryReal = entryArg ? realpathSync(entryArg) : "";
} catch { /* nonexistent entry: nothing to run */ }
if (entryReal && import.meta.url === pathToFileURL(entryReal).href) {
  main().then((code) => process.exit(code ?? 0)).catch((err) => {
    console.error(`zcode-kit: ${err.message}`);
    process.exit(2);
  });
}
