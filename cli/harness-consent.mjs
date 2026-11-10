// Per-harness consent for `zcode-kit setup`.
//
// Setup never configures a harness silently: each detected harness gets its
// own question ("? Configure ZCode for <HARNESS>? [y/n]", on stderr), an
// explicit selection (`--harness a,b`,
// `ZCODE_KIT_HARNESSES=a,b`, `none`) counts as consent for exactly those ids,
// and a missing terminal is never consent. Decisions are stored one file per
// harness under `<state>/generated/harness-choices/` through the setup
// transaction, so a rollback of the setup that recorded a decision removes
// that decision too, and update/repair paths refresh only harnesses the user
// consented to. A kit-owned integration that predates the questions (proven
// by the adapter's `owned(ctx)`) is refreshed on unattended runs but never
// turned into consent: the next interactive run still asks.
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { commitFile, ensureDir } from "../lib/edit.mjs";

export const HARNESS_CHOICES_DIR = "harness-choices";
export const HARNESS_SELECTION_ENV = "ZCODE_KIT_HARNESSES";
export const NO_CONSENT_HINT = `no interactive consent (select explicitly: --harness <list> or ${HARNESS_SELECTION_ENV}=<list>)`;
export const ABORTED = "ABORTED";

export function harnessQuestion(label) {
  return `Configure ZCode for ${label}?`;
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
 * undefined when no interactive answer is possible: no TTY on stdin or the
 * prompt stream, CI, or input closed before an answer (EOF must never count
 * as consent). Ctrl-C rejects with an error whose `code` is ABORTED so the
 * caller can stop asking instead of treating it as "no answer".
 *
 * A prompt is a diagnostic (ADR-0005, design-language §4.9): without an
 * explicit stream it is written to stderr, in the `? <question> [y/n]` form,
 * and questions appear only when stdin AND stderr are terminals — with
 * stderr redirected the question would be invisible, so nothing is asked.
 *
 * How a question is drawn is the capability record's decision
 * (lib/term/out.mjs promptStyle, from `output`, `env` and `platform`), never
 * the process's own TERM (Node's readline redraws a prompt unless
 * process.env.TERM is "dumb"). The kit always writes the question text itself.
 *   redraw: readline owns the line (raw mode): it echoes, edits and redraws the
 *           question on resize with cursor control. Only where motion and
 *           colour are allowed.
 *   plain:  readline only reads lines (terminal: false). The terminal's own
 *           line discipline echoes and edits, nothing the kit writes carries
 *           an escape sequence, and Ctrl-C arrives as SIGINT. TERM=dumb,
 *           NO_COLOR, colour off.
 * `redraw` forces the decision (true/false); by default it is taken on the
 * first question, loading the capability record lazily: the proxy manager
 * imports this module and never loads presentation code.
 */
export function createPrompter({ input = process.stdin, output = process.stderr, env = process.env, platform = process.platform, redraw } = {}) {
  const interactive = isInteractive({ input, output, env });
  const queue = [];
  const waiters = [];
  let rl = null;
  let closed = false;
  let aborted = false;
  let style = redraw === undefined ? null : { redraw: redraw === true };
  let onSignal = null;
  let selectorSession = null;
  function settleWaiters() {
    while (waiters.length) {
      const waiter = waiters.shift();
      if (aborted) waiter.reject(abortError()); else waiter.resolve(undefined);
    }
  }
  function detachSignal() {
    if (onSignal) process.removeListener("SIGINT", onSignal);
    onSignal = null;
  }
  function abort() {
    aborted = true;
    queue.length = 0;
    output.write("\n");
    const current = rl;
    rl = null;
    closed = true;
    detachSignal();
    current?.close();
    settleWaiters();
  }
  async function ensure() {
    if (rl || closed) return;
    if (!style) {
      const { loadPromptStyle } = await import("../lib/term/load.mjs");
      style = await loadPromptStyle(output, { env, platform });
    }
    if (rl || closed) return;
    const lineInput = selectorSession ? await selectorSession.lineInput() : input;
    if (closed) return;
    rl = createInterface({ input: lineInput, output, terminal: style.redraw });
    rl.on("line", (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line); else queue.push(line);
    });
    if (style.redraw) rl.on("SIGINT", abort);
    else { onSignal = abort; process.on("SIGINT", onSignal); }
    rl.on("close", () => {
      closed = true;
      rl = null;
      detachSignal();
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
      // Not rl.prompt(): its bytes depend on process.env.TERM. The question is
      // written as text; in redraw mode readline also keeps it as the line to
      // redraw on resize or editing.
      if (style.redraw) rl.setPrompt(promptText);
      if (rl.paused) rl.resume();
      if (selectorSession) {
        output.write(promptText, (err) => {
          if (err) {
            selectorSession.close();
            const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
            if (index !== -1) waiters.splice(index, 1);
            reject(err);
          }
          else selectorSession.armLine();
        });
      } else output.write(promptText);
    });
  }
  return {
    interactive,
    get aborted() { return aborted; },
    /** Automatic checkbox consent; null means the untouched legacy path. */
    async selectHarnesses({ rows, reask = false, mcpIds = [] }) {
      if (!interactive || closed || rl || redraw === false || typeof input.setRawMode !== "function") return null;
      const { selectorCaps } = await import("../lib/term/caps.mjs");
      const { displayWidth, padEndWidth } = await import("../lib/term/width.mjs");
      const { GLYPHS } = await import("../lib/term/tokens.mjs");
      if (!Array.isArray(rows) || rows.length > 10) throw new TypeError("selector needs at most ten rows");
      const inventory = rows.map((row) => ({ ...row,
        locked: !reask && !row.unreadable && (row.stored === "configured" || row.stored === "skipped"),
        checked: !row.unreadable && row.stored === "configured",
      }));
      const editable = inventory.filter((row) => !row.locked);
      if (!editable.length) return null;
      const offers = new Set(mcpIds.filter((id) => editable.some((row) => row.id === id)));
      let focus = inventory.findIndex((row) => !row.locked), hint = "";
      const initialFocus = focus;
      const reset = () => { for (const row of inventory) row.checked = !row.unreadable && row.stored === "configured"; focus = initialFocus; hint = ""; };
      function frame(caps, feedback = hint) {
        if (!caps.eligible || caps.width < 1) return null;
        const width = caps.width;
        const wrap = (text, indent = "") => {
          const lines = []; let line = indent;
          for (const word of text.split(" ")) {
            if (displayWidth(indent + word) > width) return null;
            if (line !== indent && displayWidth(line + " " + word) > width) { lines.push(line); line = indent + word; }
            else line += (line === indent ? "" : " ") + word;
          }
          lines.push(line); return lines;
        };
        const prose = [
          "Configure ZCode as a provider in these assistants?",
          "Enter with editable checks answers yes for checked rows and no for unchecked rows.",
          "Esc or Enter with no editable checks saves no harness decision.",
          "A nonempty confirmation saves readable editable choices; unreadable choices apply only to this run.",
          ...(reask ? ["--reask: saved choices are editable. Esc, an empty confirmation or input closing keeps their saved decision files unchanged."] : inventory.some((row) => row.locked) ? ["Saved choices are locked. Change them with: zcode-kit setup --reask"] : []),
          ...editable.flatMap((row) => row.unreadable
            ? [`Esc, an empty confirmation or input closing skips ${row.label} without refreshing it. Its unreadable decision file is never overwritten.`]
            : row.owned ? [
              `Esc, an empty confirmation or input closing refreshes the existing kit integration for ${row.label}, even if its saved choice is no. No harness decision is saved.`,
              `In a nonempty confirmation, an unchecked ${row.label} is skipped without refreshing its integration and its readable choice is saved as no.`,
            ] : [`Esc, an empty confirmation or input closing skips ${row.label} for this run, even if its saved choice is yes. No harness decision is saved.`]),
          ...(offers.size ? [`Selecting ${editable.filter((row) => offers.has(row.id)).map((row) => row.label).join(" or ")} also registers the kit's MCP bridge "zcode-harness" (skip with --no-mcp).`] : []),
        ];
        const lines = [];
        const append = (text, indent) => { const part = wrap(text, indent); if (!part) return false; lines.push(...part); return true; };
        for (const text of prose) if (!append(text)) return null;
        lines.push("");
        const labelWidth = Math.max(...inventory.map((row) => displayWidth(row.label)));
        for (const [i, row] of inventory.entries()) {
          const state = row.unreadable ? "unreadable / not saved" : row.stored === "configured" ? `saved yes / ${row.locked ? "locked" : "editable"}` : row.stored === "skipped" ? `saved no / ${row.locked ? "locked" : "editable"}` : "new / editable";
          const prefix = `  ${i === focus ? GLYPHS[caps.glyphs].pointer : " "} [${row.checked ? "x" : " "}] `;
          const full = prefix + padEndWidth(row.label, labelWidth) + "  " + state;
          if (displayWidth(full) <= width) lines.push(full);
          else { if (!append(row.label, prefix)) return null; if (!append(state, "        ")) return null; }
        }
        lines.push("");
        for (const text of ["Arrows move  Space toggle  a toggle all editable  Enter confirm", "Esc no new harness decision  Ctrl-C abort", `${editable.filter((row) => row.checked).length} of ${editable.length} editable checked; saved yes kept: ${inventory.filter((row) => row.locked && row.checked).length}`, feedback || ""]) if (!append(text)) return null;
        return lines;
      }
      let caps = selectorCaps(output, { env, platform });
      const maximum = frame(caps, "Saved choice is locked; use zcode-kit setup --reask");
      if (!maximum || maximum.length + 1 > caps.rows) return null;
      selectorSession = createSelectorSession({ input, output,
        onClosed: () => { closed = true; }, onAborted: () => { aborted = true; closed = true; },
        getCaps: () => selectorCaps(output, { env, platform }), frame, reset, inventory, editable, offers,
        getFocus: () => focus, setFocus: (value) => { focus = value; hint = ""; },
        setHint: (value) => { hint = value; },
      });
      return selectorSession.select();
    },
    /**
     * `defaultAnswer: false` marks the question `[y/N]` and an empty line
     * (Enter) answers n; without it the marker is `[y/n]` and Enter asks again.
     */
    async ask(question, { defaultAnswer } = {}) {
      if (!interactive) return undefined;
      await ensure();
      const defaultNo = defaultAnswer === false;
      const promptText = `? ${question} ${defaultNo ? "[y/N]" : "[y/n]"} `;
      for (;;) {
        const line = await nextLine(promptText);
        if (line === undefined) return undefined; // Closed input must never count as consent.
        if (defaultNo && line.trim() === "") return false;
        if (/^[yn]$/i.test(line.trim())) return line.trim().toLowerCase() === "y";
        output.write("Please answer y or n.\n");
      }
    },
    /**
     * One free-form line, validated by `parse` (returns undefined to ask
     * again, printing `retryHint`). Undefined without a terminal or on closed
     * input; Ctrl-C rejects with ABORTED like `ask`.
     */
    async askLine(promptText, parse, retryHint) {
      if (!interactive) return undefined;
      await ensure();
      for (;;) {
        const line = await nextLine(promptText);
        if (line === undefined) return undefined;
        const value = parse(line.trim());
        if (value !== undefined) return value;
        output.write(`${retryHint}\n`);
      }
    },
    close() {
      closed = true;
      detachSignal();
      if (rl) { const current = rl; rl = null; current.close(); }
      selectorSession?.close();
      settleWaiters();
    },
  };
}

// Owns only the selector epoch and its subsequent fresh line transport. The
// legacy path never constructs this session, so its typed-ahead queue is intact.
function createSelectorSession({ input, output, onClosed, onAborted, getCaps, frame, reset, inventory, editable, offers, getFocus, setFocus, setHint }) {
  let phase = "disclosing", ended = false, settled = false, pendingCR = false;
  let prefix = "", paste = false, pasteMatch = 0, quarantine = false;
  let controlString = false, stringEscape = false;
  let decoder = null, utf8 = new StringDecoder("utf8"), line = null, inKey = false;
  let resolve, reject, drawn = 0, painting = false, dirty = false;
  let generation = 0;
  const priorRaw = input.isRaw === true;
  const endMarker = "\x1b[201~";
  const write = (text) => new Promise((done, fail) => {
    if (output.destroyed || output.writableEnded) return fail(new Error("selector output closed"));
    try { output.write(text, (err) => err ? fail(err) : done()); } catch (err) { fail(err); }
  });
  function disposeDecoder() {
    if (!decoder) return;
    const current = decoder; decoder = null;
    // Public decoder has no disposer. Flush disarmed private transport so its
    // supported ESC timeout is cleared, then destroy only this owned stream.
    const dispose = () => {
      current.write(Buffer.alloc(32));
      current.removeListener("keypress", current.selectorKey);
      current.destroy();
    };
    // At most one callback is active. Other reset paths dispose synchronously,
    // so repeated contamination cannot grow a microtask/decoder queue.
    if (inKey) queueMicrotask(dispose); else dispose();
  }
  function freshDecoder() {
    disposeDecoder(); prefix = ""; utf8 = new StringDecoder("utf8");
    decoder = new PassThrough();
    emitKeypressEvents(decoder);
    const current = decoder;
    current.selectorKey = (...args) => {
      if (decoder !== current) return;
      inKey = true;
      try { onKey(...args); } finally { inKey = false; }
    };
    decoder.on("keypress", current.selectorKey);
  }
  function restore() {
    disposeDecoder();
    try { input.setRawMode(priorRaw); }
    catch (err) { return err; }
    finally { output.removeListener("resize", resize); }
  }
  function cleanup() {
    if (phase === "closed") return;
    phase = "closed";
    const restoreError = restore();
    input.removeListener("data", onData);
    input.removeListener("end", eof);
    input.removeListener("close", eof);
    input.removeListener("error", fail);
    // Writable may emit its error after invoking the failed write callback.
    // Keep only this owned guard through that turn, never remove foreign ones.
    setImmediate(() => output.removeListener("error", fail));
    output.removeListener("close", outputClosed);
    process.removeListener("SIGINT", interrupt);
    for (const [signal, handler] of signals) process.removeListener(signal, handler);
    line?.end();
    return restoreError;
  }
  function fail(err) {
    if (phase === "closed") return;
    cleanup();
    settled = true; reject(err);
  }
  function outputClosed() { fail(new Error("selector output closed")); }
  function interrupt() { onAborted(); fail(abortError()); }
  const signals = ["SIGTERM", "SIGHUP", ...(process.platform === "win32" ? ["SIGBREAK"] : [])].map((signal) => [signal, () => {
    cleanup();
    // Preserve default termination after restoring the terminal. Never turn a
    // handled termination into an absent answer or a successful setup.
    process.kill(process.pid, signal);
  }]);
  function eof() {
    ended = true; onClosed();
    if (!settled) finish("eof");
    else line?.end();
  }
  function finish(reason) {
    if (settled) return;
    phase = "leaving";
    const restoreError = restore();
    if (restoreError) { fail(restoreError); return; }
    settled = true;
    const nonempty = reason === "confirm" && editable.some((row) => row.checked);
    const answers = new Map(editable.map((row) => [row.id, nonempty ? row.checked : undefined]));
    // Still own input while the newline drains and adapters run; no old key
    // can become a line answer during this interval.
    write("\n").then(() => resolve({ answers, mcpIds: offers, reason }), (err) => { cleanup(); reject(err); });
  }
  function fallback() {
    if (settled) return;
    phase = "leaving"; reset();
    const restoreError = restore();
    if (restoreError) { fail(restoreError); return; }
    settled = true;
    // Geometry changed: append, since the old physical region is uncertain.
    write("\nTerminal too small for the selector; continuing with individual questions.\n")
      .then(() => resolve({ fallback: true }), (err) => { cleanup(); reject(err); });
  }
  function fits(caps) {
    const worst = frame(caps, "Saved choice is locked; use zcode-kit setup --reask");
    return worst && worst.length + 1 <= caps.rows;
  }
  async function paint(disclose = false) {
    if (painting) { dirty = true; return; }
    painting = true;
    try {
      do {
        dirty = false;
        const current = generation, caps = getCaps();
        if (!fits(caps)) { fallback(); return; }
        const lines = frame(caps);
        const erase = drawn && !disclose ? `\x1b[${drawn}A\r\x1b[0J` : "";
        await write(erase + lines.join("\n") + "\n");
        drawn = lines.length;
        if (current !== generation) { dirty = true; continue; }
        if (phase === "disclosing") { phase = "armed"; freshDecoder(); }
      } while (dirty && !settled);
    } catch (err) { fail(err); }
    finally { painting = false; }
  }
  function redisclose() {
    phase = "disclosing"; reset(); quarantine = false; paste = false; pasteMatch = 0;
    freshDecoder(); void paint(true);
  }
  function contaminate() { reset(); quarantine = true; prefix = ""; freshDecoder(); }
  function resize() {
    generation++;
    if (!fits(getCaps())) { fallback(); return; }
    // Append on resize rather than guessing old wrapped geometry ownership.
    drawn = 0; void paint();
  }
  function onKey(_, key) {
    if (phase !== "armed" || !decoder) return;
    if (key.name === "escape" && prefix === "\x1b") {
      prefix = "";
      if (quarantine) redisclose(); else finish("escape");
      return;
    }
    if (key.sequence !== prefix && prefix) return;
    if (key.ctrl && key.name === "c") { interrupt(); return; }
    if (key.ctrl && key.name === "d") { eof(); return; }
    if (quarantine || key.ctrl || key.meta || (key.shift && key.name !== "a")) return;
    if (["up", "left", "down", "right"].includes(key.name)) {
      setFocus((getFocus() + (["up", "left"].includes(key.name) ? -1 : 1) + inventory.length) % inventory.length);
    } else if (key.name === "space") {
      const row = inventory[getFocus()];
      if (row.locked) setHint("Saved choice is locked; use zcode-kit setup --reask");
      else { row.checked = !row.checked; setHint(""); }
    } else if (key.name === "a") {
      const checked = !editable.every((row) => row.checked);
      for (const row of editable) row.checked = checked;
      setHint("");
    } else if (key.name === "return" || key.name === "enter") {
      if (!fits(getCaps())) fallback(); else finish("confirm");
      return;
    }
    else return;
    void paint();
  }
  function character(ch) {
    if (phase !== "armed") return;
    if (paste) {
      pasteMatch = ch === endMarker[pasteMatch] ? pasteMatch + 1 : ch === endMarker[0] ? 1 : 0;
      if (pasteMatch === endMarker.length) redisclose();
      return;
    }
    if (ch === "\x03") { interrupt(); return; }
    if (controlString) {
      if (ch === "\x07" || (stringEscape && ch === "\\")) { controlString = false; stringEscape = false; redisclose(); }
      else stringEscape = ch === "\x1b";
      return;
    }
    if (quarantine) {
      if (ch === "\r" || ch === "\n") { redisclose(); return; }
      if (ch !== "\x1b" && !prefix) return;
    }
    if (prefix || ch === "\x1b") {
      // Node holds ESC + introducer while this guard holds the remainder.
      // Check before appending: combined undecided state never exceeds 32.
      if (Buffer.byteLength(prefix) + Buffer.byteLength(ch) > 30) { contaminate(); return; }
      prefix += ch;
      if (prefix === "\x1b") { decoder.write(ch); return; }
      if (["\x1b]", "\x1bP", "\x1b^", "\x1b_"].includes(prefix)) {
        reset(); controlString = true; stringEscape = false; freshDecoder(); return;
      }
      if (prefix === "\x1b[" || prefix === "\x1bO") { decoder.write(ch); return; }
      const csi = prefix.startsWith("\x1b[");
      const ss3 = prefix.startsWith("\x1bO");
      if ((csi || ss3) && !/[\x40-\x7e]$/.test(ch)) return;
      if (prefix === "\x1b[200~") { reset(); paste = true; pasteMatch = 0; freshDecoder(); return; }
      const complete = prefix;
      if (csi || ss3) decoder.write(complete.slice(2)); else decoder.write(ch);
      prefix = "";
      return;
    }
    if (quarantine) return;
    if (ch.length && ch >= " " && ch !== " " && ch !== "a" && ch !== "A" && ch !== "\x7f") { contaminate(); return; }
    decoder.write(ch);
  }
  function onData(chunk) {
    try {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const byte of bytes) {
        if (pendingCR) { pendingCR = false; if (byte === 10) continue; }
        if (byte === 13) pendingCR = true;
        if (phase === "line" && line) { line.write(Buffer.from([byte])); continue; }
        if (phase !== "armed") continue;
        const text = utf8.write(Buffer.from([byte]));
        for (const ch of text) character(ch);
      }
    } catch (err) { fail(err); }
  }
  return {
    select() {
      return new Promise((yes, no) => {
        resolve = yes; reject = no;
        input.on("data", onData); input.on("end", eof); input.on("close", eof); input.on("error", fail);
        output.on("resize", resize); output.on("error", fail); output.on("close", outputClosed);
        process.on("SIGINT", interrupt);
        for (const [signal, handler] of signals) process.on(signal, handler);
        try { input.setRawMode(true); input.resume(); }
        catch (err) { fail(err); return; }
        void paint(true);
      });
    },
    async lineInput() {
      phase = "leaving";
      line ??= new PassThrough();
      line.isTTY = input.isTTY;
      line.setRawMode = (raw) => { input.setRawMode(raw); return line; };
      if (ended) line.end();
      return line;
    },
    armLine() { if (!ended && phase !== "closed") phase = "line"; },
    close() {
      const pending = !settled;
      const err = cleanup();
      if (pending) {
        settled = true;
        if (err) reject(err);
        else resolve({ answers: new Map(editable.map((row) => [row.id, undefined])), mcpIds: offers, reason: "eof" });
      }
    },
  };
}

/**
 * Parse the `setup --select` answer for a numbered list of `count` entries:
 * "all", "none", or 1-based numbers separated by commas/spaces. Returns the
 * set of 0-based indexes, or undefined when the answer is invalid.
 */
export function parseSelection(answer, count) {
  const text = answer.trim().toLowerCase();
  if (text === "all") return new Set([...Array(count).keys()]);
  if (text === "none") return new Set();
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return undefined;
  const chosen = new Set();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined;
    const n = Number(part);
    if (n < 1 || n > count) return undefined;
    chosen.add(n - 1);
  }
  return chosen;
}

/** Single y/n question on its own terminal session (see createPrompter). */
export async function askYesNo(question, streams = {}, options = {}) {
  const prompter = createPrompter(streams);
  try {
    return await prompter.ask(question, options);
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
 * In a dry run nothing is written: a decision file the real run WOULD write
 * is reported through `tx.touch` (the `integrate --dry-run` would-write list),
 * with the same would-change predicate as the real write.
 * Returns false when nothing could be recorded (unreadable decision file).
 */
export function recordHarnessChoice(ctx, tx, choices, id, decision, source, now = () => new Date().toISOString(), { mcp = false } = {}) {
  const previous = choices.harnesses[id];
  if (ctx.dryRun) {
    if (isUnreadableChoice(choices, id)) return false; // never overwrite what could not be read
    if (!(previous && previous.decision === decision && previous.source === source && previous.mcp === mcp)) {
      tx?.touch?.(join(harnessChoicesDir(ctx), `${id}.json`));
    }
    return true;
  }
  if (isUnreadableChoice(choices, id)) return false; // never overwrite what could not be read
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
/** Ids that have a decision file on disk (readable or not), including unknown ids. */
export function storedDecisionIds(ctx) {
  const dir = harnessChoicesDir(ctx);
  try {
    return readdirSync(dir).filter((name) => /^[a-z0-9-]+\.json$/.test(name)).map((name) => name.slice(0, -".json".length)).sort();
  } catch {
    return [];
  }
}

/**
 * Doctor checks for the decision files themselves (ok: true PASS, false FAIL,
 * null SKIP): an unreadable file blocks every refresh of its harness, so it
 * is a failure with the way out; a decision for a harness that is not
 * installed (any more) or for an unknown id is kept and only noted.
 */
export function decisionFileChecks(ctx, knownIds, detected, choices = readHarnessChoices(ctx)) {
  const checks = [];
  if (choices.unreadable.includes("*")) {
    checks.push({ name: "harness decisions", ok: false, detail: `${harnessChoicesDir(ctx)} unreadable — check its permissions; every harness counts as undecided` });
    return checks;
  }
  const ids = storedDecisionIds(ctx);
  for (const id of ids) {
    const known = knownIds.includes(id);
    if (choices.unreadable.includes(id)) {
      checks.push({ name: `${id}: decision file`, ok: false, detail: `unreadable — the harness counts as undecided and is never refreshed; fix it or remove it: zcode-kit doctor --forget ${id}` });
    } else if (!known) {
      checks.push({ name: `${id}: decision file`, ok: null, detail: `unknown harness id — ignored; remove it with: zcode-kit doctor --forget ${id}` });
    } else if (!detected[id]) {
      checks.push({ name: `${id}: decision file`, ok: null, detail: `kept (${choices.harnesses[id].decision}), but ${id} is not detected — used again when it is installed; remove with: zcode-kit doctor --forget ${id}` });
    }
  }
  if (ids.length && !checks.some((c) => c.ok === false)) {
    checks.push({ name: "harness decisions", ok: true, detail: `${ids.length} stored decision(s) readable` });
  }
  return checks;
}

/**
 * Remove one stored decision through the transaction (a rollback restores
 * it). The integration itself is never touched: the next setup asks again.
 * Works on unreadable files too. Returns { removed, file }.
 */
export function forgetHarnessChoice(ctx, tx, id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`invalid harness id "${id}"`);
  const file = join(harnessChoicesDir(ctx), `${id}.json`);
  if (!existsSync(file)) return { removed: false, file };
  tx.touch(file);
  unlinkSync(file);
  return { removed: true, file };
}

export function consentStatus(ctx, id, adapter, detected, choices = readHarnessChoices(ctx)) {
  if (!detected) return { verify: false, detail: "not detected — skipped" };
  if (isUnreadableChoice(choices, id)) return { verify: false, detail: `decision file unreadable — fix it or remove it: zcode-kit doctor --forget ${id}` };
  const stored = choices.harnesses[id]?.decision;
  if (stored === "configured") return { verify: true };
  if (stored === "skipped") return { verify: false, detail: "not configured (your choice) — zcode-kit integrate " + id + " to change" };
  if (ownedIntegration(adapter, ctx)) return { verify: true };
  return { verify: false, detail: `not configured (no consent yet) — answer y in zcode-kit setup or run zcode-kit integrate ${id}` };
}
