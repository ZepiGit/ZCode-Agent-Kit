// CLI output module: `createOutput(...) → Out` renders records as text or JSON
// through one capability record per stream (./caps.mjs). Reports and data go
// to stdout, diagnostics to stderr. Nothing else in the kit should write
// to the terminal once a command has migrated onto it.
//
// Line mode never draws boxes. With colour off it emits no escape sequence
// at all, progress included. Off a TTY ("plain": pipe, CI, TERM=dumb) a check
// row keeps the legacy grammar `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$`
// with whitespace-indented `why:`/`next:` lines. Its separator ` — ` (U+2014)
// and the verdict words never change with the glyph tier, and the row
// carries no SGR even under forced colour, because
// scripts grep it.
//
// This module is the renderer, so it is loaded lazily: callers on a rendering
// path use `loadOutput()` (./load.mjs). The preflight and the lifecycle
// intents never import it (tests/term-boundaries.test.mjs).
import { REDACTED_KEY_CARD, connectionDetailsObject } from "../../cli/connection-details.mjs";
import { detectCaps } from "./caps.mjs";
import { BOX, GLYPHS, ROLES, SPINNER, STATUS_ROLES, WORDS } from "./tokens.mjs";
import { displayWidth, padEndWidth, truncateToWidth } from "./width.mjs";

const DESIGN_WIDTH = 80;
const CHECK_STATUSES = new Set(["pass", "fail", "warn", "skip"]);
const RESULT_STATUSES = new Set(["ok", "fail", "warn", "skip", "info"]);
const SEPARATOR = " \u2014 "; // the off-TTY check-row separator, every tier
const SPIN_MS = 100; // ≤ 10 Hz
const ELAPSED_AFTER_MS = 2000;

const REAL_CLOCK = {
  now: () => Date.now(),
  setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
  clearInterval: (t) => clearInterval(t),
};

/** Kit-authored punctuation on the ascii tier. Never applied to caller data. */
const ASCII_COPY = [["\u2014", "-"], ["\u00b7", "-"], ["\u2026", "..."], ["\u2192", "->"]];

function painter(caps) {
  const g = GLYPHS[caps.glyphs];
  const sgr = (role, text) => (caps.color && text !== "" ? `\x1b[${ROLES[role] ?? role}m${text}\x1b[0m` : text);
  const copy = (text) => (caps.glyphs === "ascii" ? ASCII_COPY.reduce((s, [from, to]) => s.split(from).join(to), text) : text);
  /** `✓ PASS` as one coloured unit; the word is padded to 4 outside the SGR. */
  const badge = (status) => {
    const word = WORDS[status];
    return sgr(STATUS_ROLES[status], `${g[status]} ${word}`) + " ".repeat(4 - word.length);
  };
  return { caps, g, sgr, copy, badge };
}

/**
 * A word wider than `width` that holds wide (CJK) characters is prose
 * without spaces: it breaks between grapheme clusters (C3 CJK).
 * Any other long word (a path, a URL, a key) stays whole.
 */
function splitWide(word, width) {
  if (displayWidth(word) <= width || displayWidth(word) === [...word].length) return [word];
  const parts = [];
  let rest = word;
  while (displayWidth(rest) > width) {
    const head = truncateToWidth(rest, width, "");
    if (head === "") break;
    parts.push(head);
    rest = rest.slice(head.length);
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

/** Greedy word wrap by display width; a word longer than the width stays whole (values never break mid-token), except wide prose (splitWide). */
function wrapWords(text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(" ").flatMap((w) => splitWide(w, width))) {
    if (line !== "" && displayWidth(line) + 1 + displayWidth(word) > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Hanging lines on a TTY: `<indent>why   text`, `<indent>next  cmd`,
 * `<indent>  or  cmd`: a 4-cell label field (`or` right-aligned under
 * `next`), two spaces, then the text, wrapped under its own column.
 */
function hanging(p, indent, label, text, { value = (s) => s, wrap = true } = {}) {
  const col = indent + 6;
  const room = p.caps.width - col;
  const parts = wrap && room >= 20 ? wrapWords(text, room) : [String(text)];
  const field = label === "or" ? `  ${p.sgr("muted", label)}` : `${p.sgr("muted", label)}${" ".repeat(4 - displayWidth(label))}`;
  return parts.map((part, i) => (i === 0 ? `${" ".repeat(indent)}${field}  ${value(part)}` : `${" ".repeat(col)}${value(part)}`));
}

/** `cmd` / `or cmd` lines for a list of next commands. */
const nextHanging = (p, indent, commands) =>
  commands.flatMap((cmd, i) => hanging(p, indent, i ? "or" : "next", cmd, { value: (s) => p.sgr("cmd", s), wrap: false }));

/** Prose on a TTY wraps at word boundaries under its column; off a TTY it stays on one line. */
const flow = (p, text, col) => (p.caps.fixed && p.caps.width - col >= 20 ? wrapWords(text, p.caps.width - col) : [String(text)]);

const asList = (next) => (next === undefined || next === null || next === "" ? [] : Array.isArray(next) ? next : [next]);

function checkLines(p, row, nameWidth) {
  if (!CHECK_STATUSES.has(row?.status)) throw new TypeError(`check: unknown status ${JSON.stringify(row?.status)}`);
  const { name, detail, why } = row;
  const next = asList(row.next);
  if (p.caps.plain) {
    const lines = [`${WORDS[row.status]}  ${name}${detail ? SEPARATOR + detail : ""}`];
    if (why) lines.push(`  why: ${why}`);
    for (const cmd of next) lines.push(`  next: ${cmd}`);
    return lines;
  }
  const width = Math.max(nameWidth ?? 0, displayWidth(name));
  const head = `  ${p.badge(row.status)}  ${detail ? padEndWidth(name, width) : name}`;
  const col = 2 + 6 + 2 + width + 2;
  const lines = [];
  if (detail) {
    const parts = flow(p, detail, col);
    lines.push(`${head}  ${p.sgr("muted", parts[0])}`, ...parts.slice(1).map((part) => `${" ".repeat(col)}${p.sgr("muted", part)}`));
  } else {
    lines.push(head);
  }
  if (why) lines.push(...hanging(p, col, "why", why));
  lines.push(...nextHanging(p, col, next));
  return lines;
}

function resultLine(p, row, labelWidth) {
  if (!RESULT_STATUSES.has(row?.status)) throw new TypeError(`result: unknown status ${JSON.stringify(row?.status)}`);
  const { label, detail } = row;
  if (p.caps.plain) {
    const word = p.sgr(STATUS_ROLES[row.status], WORDS[row.status]);
    return `${word}  ${label}${detail ? p.copy(SEPARATOR) + detail : ""}`;
  }
  const width = Math.max(labelWidth ?? 0, displayWidth(label));
  return `  ${p.badge(row.status)}  ${detail ? `${padEndWidth(label, width)}  ${p.sgr("muted", detail)}` : label}`;
}

function blockLines(p, status, block) {
  const { what, why, exit } = block ?? {};
  const next = asList(block?.next);
  if (p.caps.plain) {
    const lines = [`${p.sgr(STATUS_ROLES[status], WORDS[status])}  ${what}`];
    if (why) lines.push(`  why: ${why}`);
    for (const cmd of next) lines.push(`  next: ${cmd}`);
    if (exit) lines.push(`  exit: ${exit}`);
    return lines;
  }
  const lines = [p.sgr(STATUS_ROLES[status], `${p.g[status]} ${WORDS[status]}  ${what}`)];
  if (why) lines.push(...hanging(p, 3, "why", why));
  lines.push(...nextHanging(p, 3, next));
  if (exit) lines.push(`   ${p.sgr("muted", "exit")} ${exit}`);
  return lines;
}

function headingLine(p, title) {
  const rule = BOX[p.caps.glyphs].h.repeat(Math.max(0, Math.min(p.caps.width, DESIGN_WIDTH) - displayWidth(title) - 1));
  return rule ? `${p.sgr("heading", title)} ${p.sgr("muted", rule)}` : p.sgr("heading", title);
}

function kvLines(p, pairs, { indent = 2 } = {}) {
  const keyWidth = Math.max(0, ...pairs.map(([key]) => displayWidth(key)));
  const col = indent + keyWidth + 2;
  const room = p.caps.width - col;
  return pairs.flatMap(([key, value]) => {
    const text = String(value ?? "");
    // A long value wraps under its column on a TTY only; off a TTY it stays on one line.
    const parts = p.caps.fixed && room >= 20 && displayWidth(text) > room ? wrapWords(text, room) : [text];
    return parts.map((part, i) => (i === 0
      ? `${" ".repeat(indent)}${part === "" ? p.sgr("muted", key) : `${p.sgr("muted", padEndWidth(key, keyWidth))}  ${part}`}`
      : `${" ".repeat(col)}${part}`));
  });
}

function tableLines(p, fields, rows, { marker, footer } = {}) {
  const cell = (row, col) => String(row?.[col.key] ?? "");
  const widths = fields.map((col) => Math.max(displayWidth(col.title), ...rows.map((row) => displayWidth(cell(row, col)))));
  const lead = marker ? 2 : 0; // "* " or "  " before the first column
  const total = () => 2 + lead + widths.reduce((sum, w) => sum + w, 0) + 2 * (fields.length - 1);
  if (p.caps.fixed && total() > p.caps.width) {
    // On a TTY narrower than the table, the right-most truncatable text column gives way.
    const idx = fields.map((col, i) => (col.truncate ? i : -1)).filter((i) => i >= 0).pop();
    if (idx !== undefined) widths[idx] = Math.max(displayWidth(fields[idx].title), widths[idx] - (total() - p.caps.width), 1);
  }
  const fit = (text, i) => {
    const w = widths[i];
    const t = displayWidth(text) > w ? truncateToWidth(text, w, p.g.ellipsis) : text;
    const pad = " ".repeat(Math.max(0, w - displayWidth(t)));
    return fields[i].align === "right" ? pad + t : t + pad;
  };
  const body = (cells, mark) => `${marker ? `${mark} ` : ""}${cells.map(fit).join("  ")}`.trimEnd();
  const header = body(fields.map((col) => col.title), " ");
  const lines = [`  ${" ".repeat(lead)}${p.sgr(`${ROLES.heading};${ROLES.muted}`, header.slice(lead))}`];
  for (const row of rows) lines.push(`  ${body(fields.map((col) => cell(row, col)), marker?.(row) ? "*" : " ")}`);
  if (footer) lines.push(`  ${p.sgr("muted", footer)}`);
  return lines;
}

function verdictLine(p, counts, { label = "result", exit } = {}) {
  const n = (key) => Number(counts?.[key] ?? 0);
  const parts = [
    [n("fail"), `${n("fail")} failed`, "fail"],
    [n("warn"), `${n("warn")} warning${n("warn") === 1 ? "" : "s"}`, "warn"],
    [n("pass"), `${n("pass")} passed`, "ok"],
    [n("skip"), `${n("skip")} skipped`, "muted"],
  ].filter(([count]) => count > 0).map(([, text, role]) => p.sgr(role, text));
  const body = parts.length ? parts.join(", ") : "nothing checked";
  return `${label}: ${body}${exit ? ` ${p.g.arrow} exit ${exit}` : ""}`;
}

function nextLines(p, commands) {
  const list = asList(commands);
  if (p.caps.plain) return list.map((cmd) => `  next: ${cmd}`);
  return nextHanging(p, 2, list);
}

/**
 * The connection card: unboxed, within 80 columns.
 * The routes appear only with `verbose`; the JSON always has them.
 */
function connectionLines(p, facts, { reveal = false, verbose = false } = {}) {
  const details = connectionDetailsObject(facts ?? {});
  const verified = details.source === "running";
  // The key is shown only on an interactive terminal; a pipe never gets it,
  // whatever the caller asked (cli/connection-details.mjs rules).
  const shown = reveal && p.caps.tty && typeof facts?.key === "string" && facts.key.length > 0;
  const models = details.models.join(", ") + (verified && details.modelsSource !== "live" ? " (configured; live list unavailable)" : "");
  const pairs = [
    ["OpenAI base URL", details.openaiBaseUrl],
    ...(verbose ? [["OpenAI routes", details.routes.openai.join(", ")]] : []),
    ["Anthropic base URL", details.anthropicBaseUrl],
    ...(verbose ? [["Anthropic routes", details.routes.anthropic.join(", ")]] : []),
    ["API key", shown ? facts.key : p.copy(REDACTED_KEY_CARD)],
    ["Models", models],
    ["State", verified ? `${p.g.run} running, identity verified` : `${p.g.stop} not verified running`],
  ];
  if (!details.loopback) pairs.push(["Warning", p.copy(`server.host ${facts.host} is not loopback \u2014 do not expose it`)]);
  return [headingLine(p, "Connection details (manual clients)"), ...kvLines(p, pairs)];
}

/** The doctor's lead line: the problem count only, never the rows. */
function leadLine(p, counts) {
  const fail = Number(counts?.fail ?? 0);
  const warn = Number(counts?.warn ?? 0);
  const total = fail + warn;
  const parts = [`${fail} failed`, ...(warn ? [`${warn} warning${warn === 1 ? "" : "s"}`] : [])];
  const text = `${total} problem${total === 1 ? "" : "s"}: ${parts.join(", ")}`;
  return p.caps.plain ? text : `${p.sgr("fail", p.g.fail)} ${text}`;
}

function validateCommands(rows, { title, note } = {}) {
  const safe = (text) => typeof text === "string" && text.trim() !== "" && !/[\x00-\x1f\x7f-\x9f]/.test(text);
  if (!Array.isArray(rows) || !rows.length || rows.some((row) => !safe(row?.command) || !safe(row?.description)) ||
      (title !== undefined && !safe(title)) || (note !== undefined && !safe(note))) throw new TypeError("commands: expected nonempty single-line command descriptions");
}

function commandLines(p, rows, opts = {}) {
  validateCommands(rows, opts);
  // This additive block is plain in script/CI/dumb output even when global
  // forced colour is on. All older renderer methods retain their policy.
  if (p.caps.plain) p = painter({ ...p.caps, color: false });
  const width = Math.max(...rows.map((row) => displayWidth(row.command)));
  const lines = ["", ...(opts.title ? [headingLine(p, opts.title)] : [])];
  for (const row of rows) {
    if (p.caps.fixed && !p.caps.plain && 2 + width + 2 + displayWidth(row.description) > p.caps.width) {
      lines.push(`  ${p.sgr("cmd", row.command)}`);
      lines.push(...wrapWords(row.description, Math.max(1, p.caps.width - 4)).map((part) => `    ${p.sgr("muted", part)}`));
    } else lines.push(`  ${p.sgr("cmd", padEndWidth(row.command, width))}  ${p.sgr("muted", row.description)}`);
  }
  if (opts.note) lines.push(...(p.caps.fixed && !p.caps.plain ? wrapWords(opts.note, p.caps.width) : [opts.note]));
  return lines;
}

const STATE_STATUSES = new Set(["run", "stop", "fail", "warn"]);

/** A state line (`status` and `proxy status`): the word is in the text; the glyph only on a TTY. */
function stateLine(p, row) {
  if (!STATE_STATUSES.has(row?.status)) throw new TypeError(`state: unknown status ${JSON.stringify(row?.status)}`);
  return p.caps.plain ? row.text : `${p.sgr(STATUS_ROLES[row.status], p.g[row.status])} ${row.text}`;
}

/**
 * @param {{
 *   stdout?: NodeJS.WritableStream, // a TTY stream or a fake `{ write }` (tests)
 *   stderr?: NodeJS.WritableStream,
 *   env?: Record<string, string | undefined>,
 *   flags?: { color?: "auto" | "always" | "never" },
 *   platform?: string,
 *   json?: boolean,
 *   clock?: { now(): number, setInterval(fn: () => void, ms: number): unknown, clearInterval(t: unknown): void },
 * }} [opts]
 */
export function createOutput({ stdout = process.stdout, stderr = process.stderr, env = process.env, flags = {}, platform = process.platform, json = false, clock = REAL_CLOCK } = {}) {
  const caps = Object.freeze({ out: detectCaps(stdout, { env, flags, platform }), err: detectCaps(stderr, { env, flags, platform }) });
  const po = painter(caps.out);
  const pe = painter(caps.err);
  const write = (stream, lines) => { if (lines.length) stream.write(lines.join("\n") + "\n"); };
  // In JSON mode stdout carries only the document (and explicit data).
  const report = (lines) => { if (!json) write(stdout, lines); };

  /** Progress on stderr: motion only when caps.err.animate. */
  function step(label, total) {
    const prefix = Array.isArray(total) ? `[${total[0]}/${total[1]}] ` : "";
    const started = clock.now();
    let text = prefix + label;
    let frame = 0;
    let drawn = 0; // display width of the line on screen (animated only)
    let timer = null;
    let finished = false;
    const elapsed = () => {
      const ms = clock.now() - started;
      return ms >= ELAPSED_AFTER_MS ? ` (${Math.round(ms / 1000)} s)` : "";
    };
    // With colour off no escape sequence may appear: the line is blanked with spaces.
    const clear = () => (!drawn ? "\r" : caps.err.color ? "\r\x1b[K" : `\r${" ".repeat(drawn)}\r`);
    const draw = () => {
      const line = `${SPINNER[frame % SPINNER.length]} ${text}${elapsed()}`;
      stderr.write(clear() + line);
      drawn = displayWidth(line);
    };
    if (caps.err.animate) {
      draw();
      timer = clock.setInterval(() => { frame++; draw(); }, SPIN_MS);
    } else {
      write(stderr, [`${text} ...`]);
    }
    const finish = (lines) => {
      if (finished) return;
      finished = true;
      if (timer !== null) clock.clearInterval(timer);
      if (caps.err.animate) { stderr.write(clear()); drawn = 0; }
      write(stderr, lines);
    };
    return {
      // The command consumes the frozen capability, never probes stream flags.
      tty: caps.err.tty,
      update(next) {
        if (finished) return;
        text = prefix + next;
        if (caps.err.animate) draw();
        else write(stderr, [`${text} ...`]);
      },
      done(detail, result = {}) { finish([resultLine(pe, { status: "ok", label: (result.label ?? text) + elapsed(), detail })]); },
      skip(reason, result = {}) { finish([resultLine(pe, { status: "skip", label: result.label ?? text, detail: reason })]); },
      fail(block) { finish(blockLines(pe, "fail", { what: text, ...block })); },
    };
  }

  return Object.freeze({
    caps,
    heading: (title) => report([headingLine(po, title)]),
    kv: (pairs, opts) => report(kvLines(po, pairs, opts)),
    check: (row, opts) => report(checkLines(po, row, opts?.nameWidth)),
    result: (row, opts) => report([resultLine(po, row, opts?.labelWidth)]),
    table: (fields, rows, opts) => report(tableLines(po, fields, rows, opts)),
    connection: (facts, opts) => report(connectionLines(po, facts, opts)),
    verdict: (counts, opts) => report([verdictLine(po, counts, opts)]),
    lead: (counts) => report([leadLine(po, counts)]),
    state: (row) => report([stateLine(po, row)]),
    blank: () => report([""]),
    next: (commands) => report(nextLines(po, commands)),
    commands: (rows, opts) => report(commandLines(po, rows, opts)),
    commandsText: (rows, opts) => {
      let text = "";
      const capture = { write(chunk) { text += chunk; return true; } };
      createOutput({ stdout: capture, stderr: capture, env: {}, platform: "linux" }).commands(rows, opts);
      return text;
    },
    data: (text) => { const s = String(text ?? ""); stdout.write(s.endsWith("\n") ? s : s + "\n"); },
    json: (value) => { stdout.write(JSON.stringify(value, null, 2) + "\n"); },
    error: (block) => write(stderr, blockLines(pe, "fail", block)),
    warn: (block) => write(stderr, blockLines(pe, "warn", block)),
    note: (text) => write(stderr, [pe.caps.plain ? `${pe.sgr("info", WORDS.info)}  ${text}` : `${pe.sgr("info", `${pe.g.info} ${WORDS.info}`)}  ${text}`]),
    step,
  });
}

const RECORD_KINDS = new Set(["heading", "kv", "check", "result", "table", "connection", "verdict", "lead", "state", "blank", "next", "commands", "data", "json", "error", "warn", "note"]);

/**
 * Render command records (`{ exitCode, records }`) through an Out.
 * A record is `{ kind, ...arguments }`. Consecutive check (result) records
 * form one group whose names (labels) are padded to the group's longest on a
 * TTY. Every record is validated before anything is written.
 */
export function renderRecords(out, records) {
  const list = Array.isArray(records) ? records : [];
  for (const record of list) {
    if (!RECORD_KINDS.has(record?.kind)) throw new TypeError(`renderRecords: unknown record kind ${JSON.stringify(record?.kind)}`);
    if (record.kind === "commands") validateCommands(record.rows, record);
  }
  const groupEnd = (i, kind) => { let end = i; while (end + 1 < list.length && list[end + 1].kind === kind) end++; return end; };
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    switch (r.kind) {
      case "heading": out.heading(r.title); break;
      case "kv": out.kv(r.pairs, { indent: r.indent }); break;
      case "check": {
        const end = groupEnd(i, "check");
        const group = list.slice(i, end + 1);
        const nameWidth = Math.max(...group.map((row) => displayWidth(row.name ?? "")));
        for (const row of group) out.check(row, { nameWidth });
        i = end;
        break;
      }
      case "result": {
        const end = groupEnd(i, "result");
        const group = list.slice(i, end + 1);
        const labelWidth = Math.max(...group.map((row) => displayWidth(row.label ?? "")));
        for (const row of group) out.result(row, { labelWidth });
        i = end;
        break;
      }
      case "table": out.table(r.fields, r.rows, { marker: r.marker, footer: r.footer }); break;
      case "connection": out.connection(r.facts, { reveal: r.reveal, verbose: r.verbose }); break;
      case "verdict": out.verdict(r.counts, { label: r.label, exit: r.exit }); break;
      case "lead": out.lead(r.counts); break;
      case "state": out.state(r); break;
      case "blank": out.blank(); break;
      case "next": out.next(r.commands); break;
      case "commands": out.commands(r.rows, { title: r.title, note: r.note }); break;
      case "data": out.data(r.text); break;
      case "json": out.json(r.value); break;
      case "error": out.error(r); break;
      case "warn": out.warn(r); break;
      case "note": out.note(r.text); break;
    }
  }
}
