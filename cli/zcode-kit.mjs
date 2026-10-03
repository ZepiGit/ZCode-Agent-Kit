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
//   zcode-kit accounts unlock [--force]
//   zcode-kit accounts explain --model MODEL --operation OP
//   zcode-kit accounts doctor [--json] | accounts quota | accounts health [--json]
//   zcode-kit update [--version vX.Y.Z]          checkout: fast-forward; npm: npm install; release: verified tarball mirror
//   zcode-kit rollback [tx-id]
//   zcode-kit uninstall
//
// Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
// 4 safe-start refused (lock/ownership) · 5 auth/identity failure · 20 setup:
// one harness failed while the others were configured · 130 setup aborted
// with Ctrl-C. Unknown harness names are errors, not no-ops. `setup` exits 0
// once the consented integrations are saved even if the optional live smoke
// request fails (it prints a warning).
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
import {
  ABORTED, HARNESS_SELECTION_ENV, NO_CONSENT_HINT, consentStatus, consentedForRepair, createPrompter, decideHarness,
  decisionFileChecks, forgetHarnessChoice, isUnreadableChoice, ownedIntegration, parseSelection, readHarnessChoices,
  recordHarnessChoice, resolveHarnessSelection, storedDecisionIds,
} from "./harness-consent.mjs";
import { upstreamChecks } from "./upstream-config.mjs";
import { ACCOUNT_ROTATOR_QUESTION } from "./account-setup.mjs";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ADAPTER_IDS = ["omp", "pi", "claude-code", "codex", "opencode", "cline", "kilo-code", "aider", "continue", "goose"];
// setup: the kit is configured but at least one harness failed. A dedicated
// code (not 1, which Node uses for an uncaught error or a failed import) so
// the installers and `update` can tell a partial success from a crash.
const EXIT_HARNESS_FAILED = 20;
// setup: interrupted with Ctrl-C; answers already given were applied.
const EXIT_ABORTED = 130;

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
      else if (["fix", "json", "dry-run", "no-mcp", "yes", "help", "show-key", "installer", "verbose", "import", "paste", "replace", "live", "reask", "select", "upstream"].includes(a.slice(2))) flags[a.slice(2)] = true;
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

  zcode-kit setup [--harness auto|omp,pi,...|none] [--select]   bootstrap + one y/n question per detected harness
  zcode-kit integrate <harness> [--dry-run]     explicit consent for one harness
  zcode-kit run <harness> -- <args>             launch harness wired to ZCode
  zcode-kit doctor [--fix] [--harness <id>] [--json] [--upstream] | doctor --forget <harness>
  zcode-kit status [--json] | models [--json] [--show-key] | usage --json
  zcode-kit proxy start|stop|restart|status [--json]|logs [n]   manage the local proxy service
  zcode-kit auth status|login [zai|bigmodel] [--import] [--account ID] [--replace]|logout
  zcode-kit accounts enable|disable
  zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes] | accounts unlock [--force]
  zcode-kit accounts explain --model MODEL --operation OP
  zcode-kit accounts doctor [--json] | accounts quota | accounts health [--json]
  zcode-kit update [--version vX.Y.Z] | rollback [tx-id] | uninstall
  (update keeps .proxykey, proxy/config.yaml, logs, backups, generated and node_modules)
  (setup: auto asks "Configure ZCode as a provider ... in <HARNESS>? [y/n]" per detected harness;
   without a terminal, undecided harnesses are skipped — never configured silently)
  (setup: --harness <list> or ${HARNESS_SELECTION_ENV}=<list> selects harnesses without questions (unattended);
   none skips all; the selection also limits MCP registration; --no-mcp skips registration;
   answers are remembered under generated/harness-choices/ — --reask asks again;
   --select shows one numbered list instead: chosen = configured, the other detected ones = skipped)
  (doctor: --forget <harness> removes a stored decision (the integration stays; setup asks again);
   --upstream compares the kit's gateway with the provider config the ZCode client receives — network, opt-in)
  (proxy status --json: one object, connection details without the key; exit 0 only when this kit's proxy answers)
  (setup: --account-rotator y|n for unattended installs; --verbose for full installer output)
  (proxy start/status and setup print the connection details for manual client setup;
   the key is shown in full only on an interactive terminal — export: zcode-kit models --show-key)

Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
4 safe-start refused · 5 auth/identity failure ·
20 setup: at least one harness failed, the others are configured ·
130 setup aborted with Ctrl-C (answers already given were applied)

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
  // Consent model: `--harness <list>` / ZCODE_KIT_HARNESSES=<list> is an
  // explicit, unattended-safe selection; `auto` asks one y/n question per
  // detected harness on a terminal and skips undecided harnesses otherwise.
  let explicit;
  try {
    explicit = resolveHarnessSelection(harnessArg, process.env[HARNESS_SELECTION_ENV], ADAPTER_IDS);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  assertNotCheckoutWrite();

  ensureState(ctx);
  const compact = flags.installer === true && flags.verbose !== true && process.env.ZCODE_KIT_VERBOSE !== "1";
  const ui = setupOutput(ctx, compact);
  acquireLock(BACKUP_DIR);
  const tx = beginTransaction(BACKUP_DIR, `zcode-kit setup ${harnessArg}`);
  ctx.tx = tx;
  let txId = null;
  let accountChange = false;
  const outcome = { configured: [], skipped: [], failed: [] };
  let undecided = false;
  let abortedByUser = false;
  // One terminal session for every question (harnesses, then the rotator):
  // answers typed ahead stay in order instead of being lost between prompts.
  const prompter = createPrompter();
  const mcpBridgeAvailable = !flags["no-mcp"] && existsSync(join(ctx.mcpDir, "dist", "index.js"));
  try {
    ui.step("Runtime and configuration");
    bootstrap(ctx, (...args) => ui.detail(...args));
    ui.ok("Runtime ready");
    ui.step("Assistant integrations");
    const detectedIds = ADAPTER_IDS.filter((id) => detected[id]);
    ui.detail(
      "detected harnesses: " + (detectedIds.join(", ") || "none") +
        " — adapters run only after consent (y answer, stored decision, explicit selection) or to refresh a kit-owned integration",
    );
    const choices = readHarnessChoices(ctx);
    for (const error of choices.errors) ui.warn(error);
    const interactive = !explicit && prompter.interactive;
    if (!explicit && !interactive && detectedIds.length) {
      console.log(`  No interactive terminal: harnesses without a saved decision are skipped (select them with --harness <list> or ${HARNESS_SELECTION_ENV}=<list>).`);
    }
    if (!explicit && !detectedIds.length) {
      console.log("  No supported assistant detected. The connection details below work with any OpenAI- or Anthropic-compatible client.");
    }
    // `--select`: one numbered list instead of one question per harness.
    // Every detected harness gets a decision (chosen = configured, the rest
    // = skipped); an explicit selection wins, and without a terminal the flag
    // changes nothing.
    let selection = null;
    if (flags.select === true) {
      if (explicit) {
        console.log(`  note: --select ignored — the explicit selection (${explicit.source === "flag" ? "--harness" : HARNESS_SELECTION_ENV}) decides.`);
      } else if (!interactive) {
        console.log("  note: --select needs an interactive terminal — ignored (stored decisions apply).");
      } else if (detectedIds.length) {
        const labels = await Promise.all(detectedIds.map(async (id) => (await loadAdapter(id)).default.label));
        console.log("\n  Detected assistants:");
        detectedIds.forEach((id, i) => {
          const stored = choices.harnesses[id]?.decision;
          console.log(`    ${i + 1}) ${labels[i]}${stored ? ` (currently ${stored})` : ""}`);
        });
        const bridgeFor = detectedIds.filter((id) => mcpBridgeAvailable && (id === "omp" || id === "claude-code"));
        if (bridgeFor.length) console.log(`  note: selecting ${bridgeFor.map((id) => labels[detectedIds.indexOf(id)]).join(" or ")} also registers the kit's MCP bridge "zcode-harness" there (skip with --no-mcp).`);
        try {
          const chosen = await prompter.askLine(
            "  Configure ZCode as a provider with its supported models in which assistants? (numbers, all, none) ",
            (answer) => parseSelection(answer, detectedIds.length),
            "  Please enter numbers from the list (e.g. 1,3), all, or none.",
          );
          if (chosen !== undefined) selection = new Set([...chosen].map((i) => detectedIds[i]));
        } catch (err) {
          if (err?.code !== ABORTED) throw err;
          abortedByUser = true;
        }
      }
    }
    const mcpIds = [];
    for (const id of ADAPTER_IDS) {
      const { default: adapter } = await loadAdapter(id);
      if (abortedByUser) {
        if (detected[id] || explicit?.ids.includes(id)) {
          outcome.skipped.push({ id, label: adapter.label, reason: "aborted" });
          ui.result("skip", `${adapter.label} — aborted`);
        }
        continue;
      }
      const owned = detected[id] ? ownedIntegration(adapter, ctx) : false;
      // MCP consent is separate from provider consent: a y covers the bridge
      // only when this note was shown before the question (interactive) or
      // the harness was selected explicitly; stored decisions carry it as a flag.
      const mcpOffered = interactive && mcpBridgeAvailable && (id === "omp" || id === "claude-code");
      // The question text is fixed; what a y implies beyond the provider
      // entry is said before it (existing integration, MCP bridge).
      const ask = selection ? async () => selection.has(id)
        : interactive ? (question) => {
          if (owned) console.log(`  note: an existing kit integration for ${adapter.label} was found; y keeps it current, n leaves it untouched.`);
          if (mcpOffered) console.log(`  note: y also registers the kit's MCP bridge "zcode-harness" for ${adapter.label} (skip with --no-mcp).`);
          return prompter.ask(question);
        } : null;
      let decision;
      try {
        decision = await decideHarness({
          id,
          label: adapter.label,
          detected: Boolean(detected[id]),
          stored: choices.harnesses[id]?.decision,
          storedMcp: choices.harnesses[id]?.mcp === true,
          unreadable: isUnreadableChoice(choices, id),
          owned,
          explicit,
          // A --select answer covers every detected harness, stored or not.
          reask: flags.reask === true || selection !== null,
          ask,
          mcpOffered,
          mcpAllowed: !flags["no-mcp"],
        });
      } catch (err) {
        if (err?.code !== ABORTED) throw err;
        // Ctrl-C: stop asking; what was already applied stays (it was consented).
        abortedByUser = true;
        outcome.skipped.push({ id, label: adapter.label, reason: "aborted" });
        ui.result("skip", `${adapter.label} — aborted`);
        continue;
      }
      if (decision.action === "ignore") continue;
      if (decision.action === "skip") {
        if (decision.record) {
          try { recordHarnessChoice(ctx, tx, choices, id, "skipped", decision.source); }
          catch (err) { ui.warn(`could not record the decision for ${adapter.label} (${err.message})`); }
        }
        if (decision.reason === NO_CONSENT_HINT) undecided = true;
        outcome.skipped.push({ id, label: adapter.label, reason: decision.reason });
        ui.result("skip", `${adapter.label} — ${decision.reason}`);
        continue;
      }
      ui.detail(`== ${id}: ${adapter.label} (${decision.reason}) ==`);
      let skipped = false, warning = false, manual = false;
      const savepoint = tx.savepoint();
      try {
        const applied = adapter.apply(ctx, tx, (m) => { ui.detail(m); skipped ||= /\bskipped\b/i.test(m); warning ||= /\bWARN:/i.test(m); });
        manual = applied?.manualConfirmationRequired === true;
        if (decision.record) recordHarnessChoice(ctx, tx, choices, id, "configured", decision.source, undefined, { mcp: decision.mcp === true });
      } catch (err) {
        // One harness must not take the others down, and a half-applied
        // integration must not stay behind: undo this harness's own writes.
        // The undo itself must not abort the run either — it reports instead.
        let undone = { restored: [], removed: [], conflicts: [] };
        let note = "";
        try {
          undone = tx.restoreSince(savepoint);
          note = undone.conflicts.length
            ? ` (left in place, check manually: ${undone.conflicts.join(", ")})`
            : undone.restored.length + undone.removed.length ? " (its partial changes were undone)" : "";
        } catch (undoErr) {
          note = ` (its partial changes could not be undone: ${undoErr.message}; see zcode-kit rollback)`;
        }
        outcome.failed.push({ id, label: adapter.label, error: err.message + note });
        ui.result("fail", `${adapter.label} — ${err.message}${note}`);
        continue;
      }
      if (skipped) {
        outcome.skipped.push({ id, label: adapter.label, reason: "nothing to configure yet (see the setup log)" });
        ui.result("skip", `${adapter.label} — nothing to configure yet (see the setup log)`);
        continue;
      }
      const suffix = decision.action === "refresh" ? " — existing kit integration refreshed (no consent recorded)"
        : manual ? " — values prepared; enter them in the extension UI"
        : warning ? " — review the warning above" : "";
      outcome.configured.push({ id, label: adapter.label, refreshed: decision.action === "refresh", manual });
      ui.result("ok", adapter.label + suffix);
      if (decision.mcp === true) mcpIds.push(id);
    }
    // MCP registration follows the separate MCP consent (explicit selection,
    // a y after the MCP note, or a stored decision that recorded it) — never
    // a refresh, an `integrate` decision or a y given without the note.
    await integrateMcp(tx, detected, mcpIds, (...args) => ui.detail(...args));
    ui.step("Account Rotator");
    console.log("\n  Keep authorized logins as separate encrypted accounts.");
    console.log("  New logins are saved automatically while the feature is enabled.");
    let choice = explicitChoice;
    if (choice === undefined && !abortedByUser) {
      try {
        choice = await prompter.ask(ACCOUNT_ROTATOR_QUESTION);
      } catch (err) {
        if (err?.code !== ABORTED) throw err;
        abortedByUser = true;
      }
    }
    if (choice === undefined) {
      console.log(abortedByUser ? "  Account Rotator question skipped (aborted); setting unchanged." : "  Account Rotator setting unchanged (no interactive answer).");
      console.log("  Enable later: zcode-kit accounts enable");
    } else {
      const result = configureAccountRotator(ctx, tx, choice, runProxyCli);
      accountChange = result.changed;
      console.log(choice ? `  [OK] Account Rotator enabled (${result.accountCount} saved accounts).` : "  [OK] Account Rotator disabled. Saved accounts are kept.");
      if (choice && result.accountCount === 0) console.log("  Add your first account: zcode-kit auth login zai");
    }
  } finally {
    prompter.close();
    let finishErr = null;
    try { txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
    if (finishErr) console.error(`WARN: recording the transaction failed (${finishErr.message})`);
    if (txId) ui.detail(`\ntransaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  }
  if (accountChange) await restartForAccountChange(ctx);
  console.log("\n  Configuration saved.");
  console.log(`  Assistants: ${outcome.configured.length} configured, ${outcome.skipped.length} skipped, ${outcome.failed.length} failed.`);
  for (const entry of outcome.failed) console.log(`    failed: ${entry.label} — ${entry.error}`);
  if (undecided) console.log("    Undecided harnesses can be configured later: zcode-kit setup --harness <list>, or zcode-kit integrate <harness>.");
  if (abortedByUser) console.log("    Aborted by the user: remaining questions were skipped; nothing beyond the answers given was configured.");
  ui.step("Connection check");
  if (abortedByUser) {
    console.log("  [SKIP] aborted by the user");
  } else {
    const smoke = await setupSmoke(ctx);
    if (smoke.code) ui.warn(smoke.detail);
    else console.log(`  [${smoke.cause === "skipped" ? "SKIP" : "OK"}] ${smoke.detail}`);
  }
  // Connection details for manual client setup: "running" only after the
  // manager's authenticated identity check, model ids from the live instance.
  // A kit layout without the proxy manager (minimal fixtures, tooling
  // checkouts) has no proxy component to describe.
  console.log("");
  const managerPath = join(ROOT, "proxy", "zcode-proxy-manager.mjs");
  let manager = null;
  if (existsSync(managerPath)) {
    try {
      const mod = await import(pathToFileURL(managerPath).href);
      if (typeof mod.createManager === "function") manager = mod.createManager({ root: ROOT, home: ctx.home });
    } catch (err) {
      ui.warn(`connection details unavailable: the proxy manager could not be loaded (${err.message})`);
    }
  }
  if (manager) {
    // Same rules as `proxy status`: verified own proxy → running; nothing on
    // the port → configured values; a foreign service → details withheld
    // (never the key next to a URL that is not ours).
    const identity = await manager.healthIdentify();
    if (identity === "ours" || identity === "down") await manager.printConnectionDetails(identity === "ours" ? "running" : "configured");
    else if (identity === "foreign") console.log("  Connection details withheld: the configured port is answered by a service that is not this kit's proxy (see zcode-kit proxy status).");
    else console.log(`  Connection details unavailable (${identity}); see zcode-kit proxy status.`);
  } else console.log("  Connection details unavailable: no proxy manager in this kit layout (see zcode-kit proxy status after a full install).");
  if (compact) console.log(`\n  Setup log: ${ui.logPath}`);
  if (abortedByUser) return EXIT_ABORTED;
  return outcome.failed.length ? EXIT_HARNESS_FAILED : 0;
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
    // An explicit integrate command is consent for this harness: later
    // setup/update/repair runs keep it current without asking again. It is
    // not MCP consent (integrate never registers the bridge), and it neither
    // grants nor revokes an MCP consent recorded earlier.
    const choices = readHarnessChoices(ctx);
    if (!recordHarnessChoice(ctx, tx, choices, id, "configured", "integrate", undefined, { mcp: choices.harnesses[id]?.mcp === true })) {
      console.log(`WARN: the decision for ${id} was not recorded — its decision file is unreadable; fix or remove it (see zcode-kit setup).`);
    }
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
/**
 * `doctor --forget <id>`: remove one stored harness decision (readable or
 * not) through a transaction; the integration itself stays as it is and the
 * next setup asks again.
 */
async function forgetDecision() {
  const id = typeof flags.forget === "string" ? flags.forget.trim() : "";
  const stored = storedDecisionIds(ctx);
  if (!id || (!ADAPTER_IDS.includes(id) && !stored.includes(id))) {
    console.error(`Usage: zcode-kit doctor --forget <harness> (known: ${ADAPTER_IDS.join(", ")}${stored.length ? `; stored: ${stored.join(", ")}` : ""})`);
    return 2;
  }
  if (!stored.includes(id)) {
    console.log(`No stored decision for ${id}; nothing to forget.`);
    return 0;
  }
  assertNotCheckoutWrite();
  ensureState(ctx);
  acquireLock(BACKUP_DIR);
  let tx = null;
  let txId = null;
  let result;
  try {
    tx = beginTransaction(BACKUP_DIR, `zcode-kit doctor --forget ${id}`);
    result = forgetHarnessChoice(ctx, tx, id);
  } finally {
    let finishErr = null;
    try { if (tx) txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(BACKUP_DIR, ".setup-lock"));
    if (finishErr) console.error(`WARN: recording the transaction failed (${finishErr.message})`);
  }
  if (result?.removed) {
    console.log(`Decision for ${id} removed. Its integration is unchanged; the next zcode-kit setup asks again.`);
    if (txId) console.log(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  }
  return 0;
}

async function cmdDoctor() {
  if (flags.forget !== undefined) return forgetDecision();
  const ids = flags.harness ? String(flags.harness).split(",").map(s => s.trim()).filter(Boolean) : [...ADAPTER_IDS];
  for (const id of ids) requireHarness(id);
  const detected = detectHarnesses(ctx.home);
  if (flags.fix) {
    assertNotCheckoutWrite();
    const loaded = Object.fromEntries(await Promise.all(ids.map(async id => [id, (await loadAdapter(id)).default])));
    // Repairs never widen consent: without --harness only harnesses the user
    // consented to (stored decision or an existing kit integration) are re-applied.
    const targets = flags.harness ? ids : consentedForRepair(ctx, ids, detected, loaded);
    const adapters = targets.map(id => loaded[id]);
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

  const choices = readHarnessChoices(ctx);
  for (const id of ids) {
    const { default: adapter } = await loadAdapter(id);
    if (!flags.harness) {
      // A harness the user declined (or never answered for) is not a failed
      // check: only consented or kit-owned integrations are verified.
      const status = consentStatus(ctx, id, adapter, Boolean(detected[id]), choices);
      if (!status.verify) {
        checks.push({ name: `${id}: integration`, ok: null, detail: status.detail });
        continue;
      }
    }
    for (const c of adapter.verify(ctx)) checks.push({ name: `${id}: ${c.name}`, ok: c.ok, detail: c.detail ?? "" });
  }
  // The decision files themselves: an unreadable one silently blocks every
  // refresh of its harness, so it is reported with the way out.
  for (const c of decisionFileChecks(ctx, ADAPTER_IDS, detected, choices)) {
    if (flags.harness && !ids.some((id) => c.name.startsWith(`${id}:`))) continue;
    checks.push(c);
  }
  // Opt-in: the only doctor check that talks to the vendor (two unauthenticated GETs).
  if (flags.upstream === true) {
    for (const c of await upstreamChecks(join(ROOT, "proxy", "config.yaml"))) checks.push(c);
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
  const res = spawnSync(process.execPath, [manager, "status", ...(flags.json === true ? ["--json"] : [])], { stdio: "inherit" });
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
  if (sub === "status" && flags.json === true) args.push("--json");
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
  if (sub === "unlock") {
    const args = ["auth", "accounts", "unlock"];
    if (flags.force === true) args.push("--force");
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
    console.error("Usage: zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes] | accounts unlock [--force]");
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
// Every path stops a running proxy first, re-runs setup afterwards and then
// restarts the proxy: when update returns, the proxy is running the updated
// code (a failed restart carries the manager's exit code).
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
  console.log("update: refreshing consented integrations (stored answers are respected; new harnesses are asked only on a terminal)...");
  // Explicitly running `update` is the opt-in the checkout-write
  // guard asks for. Fresh process so the updated modules (not the ones
  // already loaded by this process) apply the integrations.
  const res = spawnSync(process.execPath, [join(ROOT, "cli", "zcode-kit.mjs"), "setup", ...harnessArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ZCODE_KIT_ALLOW_CHECKOUT: "1" },
  });
  // Exit 20 = one or more harnesses failed but the kit itself is fine; exit
  // 130 = the user interrupted the questions (answers given were applied).
  // In both cases the proxy must still come back. Anything else is a real
  // setup failure.
  const harnessFailures = res.status === EXIT_HARNESS_FAILED;
  const aborted = res.status === EXIT_ABORTED;
  const partialExit = harnessFailures ? EXIT_HARNESS_FAILED : aborted ? EXIT_ABORTED : 0;
  if (res.status !== 0 && !harnessFailures && !aborted) {
    console.error("update: setup failed — the kit files are updated; inspect the output above and rerun `zcode-kit setup`.");
    return res.status ?? 2;
  }
  if (harnessFailures) console.error("update: some assistants could not be configured (see the summary above); the proxy is started anyway.");
  if (aborted) console.error("update: setup was interrupted; the kit files are updated and the answers given so far were applied — finish with `zcode-kit setup`. The proxy is started anyway.");
  // update stopped the proxy before mutating files, so it must come back
  // here: an update that returns with a dead proxy is not done. The
  // manager `start` is idempotent (already-running exits 0) and safe-starts
  // with full ownership proofs; failures carry its exit code. A kit layout
  // without the proxy manager (minimal fixtures, tooling checkouts) skips
  // the start — there is no proxy component to restart.
  const managerPath = join(ROOT, "proxy", "zcode-proxy-manager.mjs");
  if (!existsSync(managerPath)) {
    console.log("update: no proxy manager in this kit layout — skipping the proxy start.");
    if (txId) console.log(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
    return partialExit;
  }
  console.log("update: starting the proxy on the updated code...");
  const started = spawnSync(process.execPath, [managerPath, "start"], { stdio: "inherit" });
  if (started.status !== 0) {
    console.error("update: the proxy did not start — the kit files are updated; run `zcode-kit doctor` (the exit code carries the reason).");
    return started.status ?? 2;
  }
  if (txId) console.log(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  return partialExit;
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
