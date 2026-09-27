// Per-harness consent for `zcode-kit setup`.
//
// Setup never configures a harness silently: each detected harness gets its
// own question ("Configure ZCode as a provider with its supported models in
// <HARNESS>? [y/n]"), an explicit selection (`--harness a,b`,
// `ZCODE_KIT_HARNESSES=a,b`, `none`) counts as consent for exactly those ids,
// and a missing terminal is never consent. Decisions are stored one file per
// harness under `<state>/generated/harness-choices/` through the setup
// transaction, so a rollback of the setup that recorded a decision removes
// that decision too, and update/repair paths refresh only harnesses the user
// consented to. A kit-owned integration that predates the questions (proven
// by the adapter's `owned(ctx)`) is refreshed on unattended runs but never
// turned into consent: the next interactive run still asks.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { commitFile, ensureDir } from "../lib/edit.mjs";

export const HARNESS_CHOICES_DIR = "harness-choices";
export const HARNESS_SELECTION_ENV = "ZCODE_KIT_HARNESSES";
export const NO_CONSENT_HINT = `no interactive consent (select explicitly: --harness <list> or ${HARNESS_SELECTION_ENV}=<list>)`;
export const ABORTED = "ABORTED";

export function harnessQuestion(label) {
  return `Configure ZCode as a provider with its supported models in ${label}?`;
}

export function isInteractive({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  if (!input.isTTY || !output.isTTY) return false;
  return !(env.CI && !/^(0|false)$/i.test(env.CI));
}

function abortError() {
  const err = new Error("aborted by the user (Ctrl-C)");
  err.code = ABORTED;
  return err;
}

/**
 * One terminal session for several y/n questions. A single readline
 * interface owns stdin for the whole setup: lines typed ahead are queued and
 * answer the following questions in order instead of being swallowed by a
 * closed interface. `ask` resolves true/false for an explicit answer, or
 * undefined when no interactive answer is possible: no TTY on either side,
 * CI, or input closed before an answer (EOF must never count as consent).
 * Ctrl-C rejects with an error whose `code` is ABORTED so the caller can stop
 * asking instead of treating it as "no answer".
 */
export function createPrompter({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const interactive = isInteractive({ input, output, env });
  const queue = [];
  const waiters = [];
  let rl = null;
  let closed = false;
  let aborted = false;
  function settleWaiters() {
    while (waiters.length) {
      const waiter = waiters.shift();
      if (aborted) waiter.reject(abortError()); else waiter.resolve(undefined);
    }
  }
  function ensure() {
    if (rl || closed) return;
    rl = createInterface({ input, output, terminal: true });
    rl.on("line", (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line); else queue.push(line);
    });
    rl.on("SIGINT", () => {
      aborted = true;
      queue.length = 0;
      output.write("\n");
      const current = rl;
      rl = null;
      closed = true;
      current.close();
      settleWaiters();
    });
    rl.on("close", () => {
      closed = true;
      rl = null;
      settleWaiters();
    });
  }
  function nextLine(promptText) {
    if (aborted) return Promise.reject(abortError());
    if (queue.length) {
      // Typed ahead: show the question with the answer it consumed.
      const line = queue.shift();
      output.write(`${promptText}${line}\n`);
      return Promise.resolve(line);
    }
    if (closed) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      rl.setPrompt(promptText);
      rl.prompt();
    });
  }
  return {
    interactive,
    get aborted() { return aborted; },
    async ask(question) {
      if (!interactive) return undefined;
      ensure();
      const promptText = `${question} [y/n] `;
      for (;;) {
        const line = await nextLine(promptText);
        if (line === undefined) return undefined; // Closed input must never count as consent.
        if (/^[yn]$/i.test(line.trim())) return line.trim().toLowerCase() === "y";
        output.write("Please answer y or n.\n");
      }
    },
    close() {
      closed = true;
      if (rl) { const current = rl; rl = null; current.close(); }
      settleWaiters();
    },
  };
}

/** Single y/n question on its own terminal session (see createPrompter). */
export async function askYesNo(question, streams = {}) {
  const prompter = createPrompter(streams);
  try {
    return await prompter.ask(question);
  } finally {
    prompter.close();
  }
}

/**
 * Explicit, documented harness selection for unattended runs.
 * Returns undefined for auto-detection (default), `{ ids, none, source }`
 * otherwise. Unknown ids throw (an unknown harness is an error, not a no-op).
 */
export function resolveHarnessSelection(flagValue, envValue, knownIds) {
  const pick = (value, source) => {
    const text = String(value).trim();
    if (!text || text === "auto") return undefined;
    if (text === "none") return { ids: [], none: true, source };
    const ids = [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
    for (const id of ids) {
      if (!knownIds.includes(id)) throw new Error(`unknown harness "${id}" in ${source === "flag" ? "--harness" : HARNESS_SELECTION_ENV}. Known: ${knownIds.join(", ")}, none (or auto for detection)`);
    }
    if (!ids.length) return undefined;
    return { ids, none: false, source };
  };
  if (flagValue !== undefined && flagValue !== "auto") return pick(flagValue, "flag");
  if (envValue !== undefined) return pick(envValue, "env");
  return undefined;
}

export function harnessChoicesDir(ctx) {
  return join(ctx.generated, HARNESS_CHOICES_DIR);
}

/**
 * Stored decisions, one JSON file per harness. Unreadable or malformed files
 * fail closed: their ids are reported in `unreadable` and count as undecided
 * without any existing-integration shortcut, and nothing is recorded for them.
 */
export function readHarnessChoices(ctx) {
  const dir = harnessChoicesDir(ctx);
  const result = { harnesses: {}, unreadable: [], errors: [] };
  if (!existsSync(dir)) return result;
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => /^[a-z0-9-]+\.json$/.test(name));
  } catch (err) {
    result.errors.push(`${dir}: ${err.message} — decisions unreadable`);
    result.unreadable.push("*");
    return result;
  }
  for (const name of names) {
    const id = name.slice(0, -".json".length);
    const file = join(dir, name);
    try {
      const entry = JSON.parse(readFileSync(file, "utf8"));
      if (!entry || entry.schema !== 1 || (entry.decision !== "configured" && entry.decision !== "skipped")) throw new Error("unsupported format");
      // `mcp` is separate consent for the kit's MCP bridge (recorded only
      // after the MCP note was shown or the harness was selected explicitly);
      // absent means no MCP consent, never "implied".
      result.harnesses[id] = { decision: entry.decision, source: String(entry.source ?? "unknown"), decidedAt: String(entry.decidedAt ?? ""), mcp: entry.mcp === true };
    } catch (err) {
      result.unreadable.push(id);
      result.errors.push(`${file}: ${err.message} — fix or remove the file; ${id} counts as undecided until then`);
    }
  }
  return result;
}

export function isUnreadableChoice(choices, id) {
  return choices.unreadable.includes("*") || choices.unreadable.includes(id);
}

/**
 * Record one decision through the transaction (rollback of that setup removes
 * it again). `mcp` records consent for the kit's MCP bridge separately from
 * the provider consent; it is never inferred from a stored decision.
 * Returns false when nothing could be recorded (unreadable decision file).
 */
export function recordHarnessChoice(ctx, tx, choices, id, decision, source, now = () => new Date().toISOString(), { mcp = false } = {}) {
  if (ctx.dryRun) return true;
  if (isUnreadableChoice(choices, id)) return false; // never overwrite what could not be read
  const previous = choices.harnesses[id];
  if (previous && previous.decision === decision && previous.source === source && previous.mcp === mcp) return true;
  const entry = { schema: 1, harness: id, decision, source, decidedAt: now(), ...(mcp ? { mcp: true } : {}) };
  ensureDir(ctx, harnessChoicesDir(ctx));
  commitFile(ctx, tx, join(harnessChoicesDir(ctx), `${id}.json`), JSON.stringify(entry, null, 2) + "\n");
  choices.harnesses[id] = { decision, source, decidedAt: entry.decidedAt, mcp };
  return true;
}

/** A kit-owned integration bound to THIS installation (adapter proof, never a shape guess). */
export function ownedIntegration(adapter, ctx) {
  if (typeof adapter?.owned !== "function") return false;
  try {
    return adapter.owned(ctx) === true;
  } catch {
    return false;
  }
}

/**
 * Decide one harness. `ask` resolves the y/n answer (undefined = no answer,
 * rejects with code ABORTED on Ctrl-C).
 * Returns { action: "configure" | "refresh" | "skip" | "ignore", source,
 *           reason, record, consent, note }:
 *   - explicit selection: listed ids are configured, `none` skips detected
 *     ids, everything else is left alone;
 *   - a stored decision stands: "configured" is refreshed without asking,
 *     "skipped" stays skipped until `--harness`, `integrate` or `--reask`
 *     (which asks again only on a terminal);
 *   - an unreadable decision file leaves the harness undecided and is never
 *     overwritten; without a terminal it is skipped;
 *   - an owned kit integration without a decision is asked about on a
 *     terminal and only refreshed (no consent recorded, no MCP) otherwise;
 *   - otherwise the harness is asked; y configures, n skips, no answer skips
 *     without changing the stored decision.
 * `consent` marks decisions that authorize the provider integration; `mcp`
 * marks the narrower consent for the kit's MCP bridge: an explicit selection
 * unless the bridge was declined (`mcpAllowed` false with --no-mcp), or a y
 * given after the MCP note was shown (`mcpOffered`), or a stored decision
 * that recorded it. A refresh, an `integrate` decision or a y without the
 * note never registers MCP.
 */
export async function decideHarness({ id, label, detected, stored, storedMcp = false, unreadable = false, owned = false, explicit, reask = false, ask, mcpOffered = false, mcpAllowed = true }) {
  const via = (source) => (source === "flag" ? "--harness" : HARNESS_SELECTION_ENV);
  // Re-asking needs a terminal: without one, stored decisions keep standing.
  const reasking = reask && typeof ask === "function";
  if (explicit) {
    // An explicit selection is documented to cover the MCP bridge, so it
    // records MCP consent as well — unless --no-mcp declined the bridge, in
    // which case nothing must remember it as consented.
    if (explicit.ids.includes(id)) return { action: "configure", source: explicit.source, reason: `selected via ${via(explicit.source)}`, record: true, consent: true, mcp: mcpAllowed === true };
    if (explicit.none && detected) return { action: "skip", source: explicit.source, reason: `${via(explicit.source)}=none`, record: true, consent: false };
    return { action: "ignore", source: explicit.source, reason: "not selected", record: false, consent: false };
  }
  if (!detected) return { action: "ignore", source: "detect", reason: "not detected", record: false, consent: false };
  if (unreadable) {
    const answer = ask ? await ask(harnessQuestion(label)) : undefined;
    if (answer === true) return { action: "configure", source: "interactive", reason: "answered y (decision file unreadable — not recorded)", record: false, consent: true, mcp: mcpOffered };
    return { action: "skip", source: "none", reason: answer === false ? "answered n (decision file unreadable — not recorded)" : "decision file unreadable — fix or remove it", record: false, consent: false };
  }
  if (stored === "configured" && !reasking) return { action: "configure", source: "stored", reason: "previously configured", record: false, consent: true, mcp: storedMcp === true };
  if (stored === "skipped" && !reasking) return { action: "skip", source: "stored", reason: `previously skipped (change with: zcode-kit integrate ${id}, setup --harness ${id}, or setup --reask)`, record: false, consent: false };
  if (!ask) {
    if (owned) return { action: "refresh", source: "existing", reason: "existing kit integration refreshed; consent not recorded (answer once on a terminal or select it explicitly)", record: false, consent: false };
    return { action: "skip", source: "none", reason: NO_CONSENT_HINT, record: false, consent: false };
  }
  const answer = await ask(harnessQuestion(label));
  // A y covers the MCP bridge only when the MCP note was shown before the question.
  if (answer === true) return { action: "configure", source: "interactive", reason: "answered y", record: true, consent: true, mcp: mcpOffered, note: owned ? "existing kit integration found; y keeps it current" : undefined };
  if (answer === false) return { action: "skip", source: "interactive", reason: "answered n", record: true, consent: false };
  if (owned) return { action: "refresh", source: "existing", reason: "existing kit integration refreshed; no answer, consent not recorded", record: false, consent: false };
  return { action: "skip", source: "none", reason: NO_CONSENT_HINT, record: false, consent: false };
}

/**
 * Ids that repair paths (doctor --fix, update) may touch without asking:
 * stored consent, or a kit integration owned by this installation. An
 * unreadable decision file blocks the repair of that harness.
 */
export function consentedForRepair(ctx, ids, detected, adapters, choices = readHarnessChoices(ctx)) {
  return ids.filter((id) => {
    if (!detected[id]) return false;
    if (isUnreadableChoice(choices, id)) return false;
    const stored = choices.harnesses[id]?.decision;
    if (stored === "configured") return true;
    if (stored === "skipped") return false;
    const adapter = adapters[id];
    return adapter ? ownedIntegration(adapter, ctx) : false;
  });
}

/** Doctor view of a harness that is neither explicitly requested nor consented. */
export function consentStatus(ctx, id, adapter, detected, choices = readHarnessChoices(ctx)) {
  if (!detected) return { verify: false, detail: "not detected — skipped" };
  if (isUnreadableChoice(choices, id)) return { verify: false, detail: "decision file unreadable — fix or remove it (see zcode-kit setup)" };
  const stored = choices.harnesses[id]?.decision;
  if (stored === "configured") return { verify: true };
  if (stored === "skipped") return { verify: false, detail: "not configured (your choice) — zcode-kit integrate " + id + " to change" };
  if (ownedIntegration(adapter, ctx)) return { verify: true };
  return { verify: false, detail: `not configured (no consent yet) — answer y in zcode-kit setup or run zcode-kit integrate ${id}` };
}
