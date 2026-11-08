// `zcode-kit setup [--harness auto|<list>|none] [--select] [--reask] [--no-mcp]
//   [--account-rotator y|n] [--installer] [--verbose]`: bootstrap the runtime,
// then integrate the harnesses the user consents to (one y/n question per
// detected harness on a terminal, an explicit selection, or stored
// decisions), register the MCP bridge where that was consented separately,
// ask the Account Rotator question, run the live smoke check and print the
// connection details. Exit 0 once the consented integrations are saved (a
// failed smoke check only warns), 20 when at least one harness failed while
// the others were configured, 130 when the user aborted with Ctrl-C (answers
// already given were applied), 2 for an unknown harness in the selection.
// Output is streamed (ctx.progress and cli/setup-output.mjs): questions are
// asked on the same terminal. Below the Node support floor the entry refuses
// first (`nodeFloor`, ADR-0006).
//
// The command ctx is `cmd`; `ctx` below is the kit context (cmd.kit), the
// object the adapters, bootstrap and the consent records work on.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireLock, beginTransaction, releaseLock } from "../../lib/transaction.mjs";
import { detectHarnesses } from "../../lib/detect.mjs";
import { ensureState } from "../../lib/state.mjs";
import { commitFile } from "../../lib/edit.mjs";
import { withLineEndingsOf } from "../../lib/line-endings.mjs";
import { BRIDGE_NODE_FLAGS, bridgeArgs, bridgeScriptOf, claudeRegistrationState, sameInstallationPath } from "../../lib/mcp-bridge.mjs";
import { bootstrap } from "../context.mjs";
import { decideAccountRotator, restartForAccountChange, rotatorChoice } from "../account-setup.mjs";
import { setupOutput } from "../setup-output.mjs";
import {
  ABORTED, HARNESS_SELECTION_ENV, NO_CONSENT_HINT, createPrompter, decideHarness,
  isUnreadableChoice, ownedIntegration, parseSelection, readHarnessChoices,
  recordHarnessChoice, resolveHarnessSelection,
} from "../harness-consent.mjs";
import {
  ADAPTER_IDS, EXIT_ABORTED, EXIT_HARNESS_FAILED, assertNotCheckoutWrite, loadAdapter, proxyCli, stderrLine,
} from "./common.mjs";

/** The entry refuses this command below the Node support floor, before the kit context exists. */
export const nodeFloor = true;

export async function run({ flags }, cmd) {
  const ctx = cmd.kit;
  const explicitChoice = rotatorChoice(flags["account-rotator"] ?? cmd.env.ZCODE_KIT_ACCOUNT_ROTATOR);
  const harnessArg = flags.harness ?? "auto";
  const detected = detectHarnesses(ctx.home);
  // Consent model: `--harness <list>` / ZCODE_KIT_HARNESSES=<list> is an
  // explicit, unattended-safe selection; `auto` asks one y/n question per
  // detected harness on a terminal and skips undecided harnesses otherwise.
  let explicit;
  try {
    explicit = resolveHarnessSelection(harnessArg, cmd.env[HARNESS_SELECTION_ENV], ADAPTER_IDS);
  } catch (err) {
    return { exitCode: 2, records: [stderrLine(err.message)] };
  }
  assertNotCheckoutWrite(ctx, cmd.env);

  ensureState(ctx);
  const compact = flags.installer === true && flags.verbose !== true && cmd.env.ZCODE_KIT_VERBOSE !== "1";
  const ui = setupOutput(ctx, compact);
  acquireLock(ctx.backupDir);
  const tx = beginTransaction(ctx.backupDir, `zcode-kit setup ${harnessArg}`);
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
      cmd.progress(`  No interactive terminal: harnesses without a saved decision are skipped (select them with --harness <list> or ${HARNESS_SELECTION_ENV}=<list>).`);
    }
    if (!explicit && !detectedIds.length) {
      cmd.progress("  No supported assistant detected. The connection details below work with any OpenAI- or Anthropic-compatible client.");
    }
    // `--select`: one numbered list instead of one question per harness.
    // Every detected harness gets a decision (chosen = configured, the rest
    // = skipped); an explicit selection wins, and without a terminal the flag
    // changes nothing.
    let selection = null;
    if (flags.select === true) {
      if (explicit) {
        cmd.progress(`  note: --select ignored — the explicit selection (${explicit.source === "flag" ? "--harness" : HARNESS_SELECTION_ENV}) decides.`);
      } else if (!interactive) {
        cmd.progress("  note: --select needs an interactive terminal — ignored (stored decisions apply).");
      } else if (detectedIds.length) {
        const labels = await Promise.all(detectedIds.map(async (id) => (await loadAdapter(id)).default.label));
        cmd.progress("\n  Detected assistants:");
        detectedIds.forEach((id, i) => {
          const stored = choices.harnesses[id]?.decision;
          cmd.progress(`    ${i + 1}) ${labels[i]}${stored ? ` (currently ${stored})` : ""}`);
        });
        const bridgeFor = detectedIds.filter((id) => mcpBridgeAvailable && (id === "omp" || id === "claude-code"));
        if (bridgeFor.length) cmd.progress(`  note: selecting ${bridgeFor.map((id) => labels[detectedIds.indexOf(id)]).join(" or ")} also registers the kit's MCP bridge "zcode-harness" there (skip with --no-mcp).`);
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
          if (owned) cmd.progress(`  note: an existing kit integration for ${adapter.label} was found; y keeps it current, n leaves it untouched.`);
          if (mcpOffered) cmd.progress(`  note: y also registers the kit's MCP bridge "zcode-harness" for ${adapter.label} (skip with --no-mcp).`);
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
    await integrateMcp(cmd, flags, tx, detected, mcpIds, (...args) => ui.detail(...args));
    ui.step("Account Rotator");
    // Asked once (ticket 42): a stored decision stands unless --reask; the
    // overrides still win. See decideAccountRotator for the order.
    const rotator = await decideAccountRotator({
      ctx,
      tx,
      explicit: explicitChoice,
      explicitSource: flags["account-rotator"] !== undefined ? "flag" : "env",
      reask: flags.reask === true,
      prompter,
      aborted: abortedByUser,
      progress: cmd.progress,
      warn: (line) => ui.warn(line),
      runProxyCli: (cliArgs, opts) => proxyCli(cmd, cliArgs, opts),
    });
    accountChange = rotator.changed;
    abortedByUser = rotator.aborted;
  } finally {
    prompter.close();
    let finishErr = null;
    try { txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(ctx.backupDir, ".setup-lock"));
    if (finishErr) cmd.progressError(`WARN: recording the transaction failed (${finishErr.message})`);
    if (txId) ui.detail(`\ntransaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  }
  if (accountChange) await restartForAccountChange(ctx);
  cmd.progress("\n  Configuration saved.");
  cmd.progress(`  Assistants: ${outcome.configured.length} configured, ${outcome.skipped.length} skipped, ${outcome.failed.length} failed.`);
  for (const entry of outcome.failed) cmd.progress(`    failed: ${entry.label} — ${entry.error}`);
  if (undecided) cmd.progress("    Undecided harnesses can be configured later: zcode-kit setup --harness <list>, or zcode-kit integrate <harness>.");
  if (abortedByUser) cmd.progress("    Aborted by the user: remaining questions were skipped; nothing beyond the answers given was configured.");
  ui.step("Connection check");
  if (abortedByUser) {
    cmd.progress("  [SKIP] aborted by the user");
  } else {
    // Lazy: heal.mjs checks at module scope whether it is the process entry.
    const { setupSmoke } = await import("../heal.mjs");
    const smoke = await setupSmoke(ctx);
    if (smoke.code) ui.warn(smoke.detail);
    else cmd.progress(`  [${smoke.cause === "skipped" ? "SKIP" : "OK"}] ${smoke.detail}`);
  }
  // Connection details for manual client setup: "running" only after the
  // manager's authenticated identity check, model ids from the live instance.
  // A kit layout without the proxy manager (minimal fixtures, tooling
  // checkouts) has no proxy component to describe.
  cmd.progress("");
  const managerPath = join(ctx.root, "proxy", "zcode-proxy-manager.mjs");
  let manager = null;
  if (existsSync(managerPath)) {
    try {
      const mod = await import(pathToFileURL(managerPath).href);
      if (typeof mod.createManager === "function") manager = mod.createManager({ root: ctx.root, home: ctx.home });
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
    else if (identity === "foreign") cmd.progress("  Connection details withheld: the configured port is answered by a service that is not this kit's proxy (see zcode-kit proxy status).");
    else cmd.progress(`  Connection details unavailable (${identity}); see zcode-kit proxy status.`);
  } else cmd.progress("  Connection details unavailable: no proxy manager in this kit layout (see zcode-kit proxy status after a full install).");
  if (compact) cmd.progress(`\n  Setup log: ${ui.logPath}`);
  if (abortedByUser) return { exitCode: EXIT_ABORTED, records: [] };
  return { exitCode: outcome.failed.length ? EXIT_HARNESS_FAILED : 0, records: [] };
}

// `claude mcp get` is a human-readable display, not a shell command:
// claudeRegistrationState (lib/mcp-bridge.mjs) matches the entire argument
// field (leading Node flags, then a script path that may be quoted with
// spaces) and compares the script with sameInstallationPath; substring checks
// would incorrectly adopt `index.js.foreign`.
function claudeMcpAdd(cmd, args) {
  return cmd.runCommandSync("claude", ["mcp", "add", "zcode-harness", "--scope", "user", "--", "node", ...args], { stdio: "pipe", encoding: "utf8" });
}

function commandFailure(res) {
  return (res.error?.message || res.stderr || `exit ${res.status}`).trim().slice(0, 200);
}

/** MCP bridge registration (OMP mcp.json / claude mcp add) — additive, namespaced. */
async function integrateMcp(cmd, flags, tx, detected, targets, log) {
  const ctx = cmd.kit;
  if (flags["no-mcp"]) return;
  const serverJs = join(ctx.mcpDir, "dist", "index.js");
  if (!existsSync(serverJs)) {
    log("== mcp: bridge dist missing — run setup again after install ==");
    return;
  }
  log("== mcp: zcode-harness bridge ==");
  if (targets.includes("omp") && detected.omp) {
    const ompMcp = join(ctx.home, ".omp", "agent", "mcp.json");
    // The bridge flags (ticket 36) go on the command line; an older entry of
    // this installation is refreshed to this form through the transaction.
    const entry = { type: "stdio", command: "node", args: bridgeArgs(serverJs) };
    if (existsSync(ompMcp)) {
      try {
        const text = readFileSync(ompMcp, "utf8");
        const j = JSON.parse(text);
        const current = j.mcpServers?.["zcode-harness"];
        // F-09: an entry pointing at ANOTHER kit copy is not "ours" — replace
        // only when it is absent or already points at this installation.
        const ours = !current || sameInstallationPath(bridgeScriptOf(current.args), serverJs);
        if (!current || (ours && JSON.stringify(current) !== JSON.stringify(entry))) {
          j.mcpServers = j.mcpServers ?? {};
          j.mcpServers["zcode-harness"] = entry;
          commitFile(ctx, tx, ompMcp, withLineEndingsOf(text, JSON.stringify(j, null, 2) + "\n"));
          log("  omp: mcp.json updated (zcode-harness → stdio bridge)");
        } else if (!ours) {
          log(`  WARN: omp mcp.json "zcode-harness" points at another kit copy (${bridgeScriptOf(current.args) ?? "?"}) — left untouched`);
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
    const get = cmd.runCommandSync("claude", ["mcp", "get", "zcode-harness"], { stdio: "pipe", encoding: "utf8" });
    const { state, registered } = get.status === 0 ? claudeRegistrationState(get.stdout, serverJs) : { state: "absent", registered: null };
    if (state === "foreign") {
      // F-09: registered by another kit copy — never silently adopt it.
      log('  WARN: claude "zcode-harness" is registered by another kit copy — left untouched');
    } else if (state === "current") {
      log('  claude: "zcode-harness" already registered');
    } else if (state === "outdated") {
      // This installation's older registration (ticket 36): `claude mcp add`
      // refuses an existing name, so re-register. A failed add puts the
      // previous registration back, so the bridge is never left unregistered.
      const remove = cmd.runCommandSync("claude", ["mcp", "remove", "zcode-harness", "--scope", "user"], { stdio: "pipe", encoding: "utf8" });
      if (remove.status !== 0) {
        log(`  WARN: claude mcp remove failed: ${commandFailure(remove)} — "zcode-harness" left as registered`);
      } else {
        const add = claudeMcpAdd(cmd, bridgeArgs(serverJs));
        if (add.status === 0) {
          log(`  claude: re-registered "zcode-harness" with ${BRIDGE_NODE_FLAGS.join(" ")} (user scope)`);
          tx.external(`claude MCP server "zcode-harness" re-registered with ${BRIDGE_NODE_FLAGS.join(" ")} (user scope)`, "claude mcp remove zcode-harness --scope user");
        } else {
          const back = claudeMcpAdd(cmd, [...registered.flags, registered.script, "--stdio"]);
          log(`  WARN: claude mcp add failed: ${commandFailure(add)} — ${back.status === 0 ? "previous registration restored" : `previous registration NOT restored (${commandFailure(back)}); run setup again`}`);
        }
      }
    } else {
      const add = claudeMcpAdd(cmd, bridgeArgs(serverJs));
      if (add.status === 0) {
        log('  claude: registered "zcode-harness" (user scope)');
        tx.external('claude MCP server "zcode-harness" registered (user scope)', "claude mcp remove zcode-harness --scope user");
      } else {
        log(`  WARN: claude mcp add failed: ${commandFailure(add)}`);
      }
    }
  }
  log("  NOTE: the bridge defaults to its dedicated workspace allowlist and denied permission requests; standalone model turns may be rejected by the provider independently of Desktop availability.");
}
