#!/usr/bin/env node
// PROTOTYPE — THROWAWAY. Lives on branch prototype/terminal-ux only; never merge.
//
// Question it answers: "What should zcode-kit's terminal output look like?"
// Plan (one line): three structurally different variants (A Ledger, B Cards,
// C Outline) of one design language, rendering help, doctor, setup summary,
// proxy status, an error block and the proxy-TUI dashboard from FAKE data,
// switchable with --variant (or ←/→ in --interactive mode).
//
// Run:
//   npm run prototype:ux                       # all screens, variant A, this terminal
//   node cli/ux-prototype/terminal-ux.prototype.mjs --variant B --screen doctor
//   node cli/ux-prototype/terminal-ux.prototype.mjs --interactive   # ←/→ variant, ↑/↓ screen, q quit
//   node cli/ux-prototype/terminal-ux.prototype.mjs --render-all <dir>  # every variant × screen × terminal mode
// Simulate terminals: --width N  --ascii  --no-color / NO_COLOR=1  --tty / --no-tty  TERM=dumb
//
// Shared on purpose (it is the design language itself, not a layout): the
// capability probe, the token table (glyphs, colour roles), width handling
// from the kit's own zcode-proxy-src/src/tui/width.ts (Node type stripping),
// and the fake data. Everything that is LAYOUT lives inside each variant.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitKeypressEvents } from "node:readline";
import { displayWidth, padEndWidth, stripAnsi, truncateToWidth } from "../../zcode-proxy-src/src/tui/width.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ capabilities
/**
 * One capability record per stream (research/terminal-conventions.md R1-R6).
 * Real module: lib/term/caps.mjs. Nothing else may look at isTTY or env.
 *  color  — R2 precedence: flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > non-TTY off > TERM=dumb off > CLICOLOR=0 off > on.
 *  glyphs — R4: ZCODE_KIT_UNICODE override > ascii (TERM=dumb, non-TTY, non-UTF-8 POSIX locale)
 *           > wgl4 (win32 without WT_SESSION/TERM_PROGRAM/build>=22621) > full.
 *  animate — R6: TTY, TERM != dumb, CI unset.
 *  width  — stream.columns, else COLUMNS, else 80, min 40. `fixed` false off a TTY:
 *           nothing is truncated in pipes (R17).
 */
export function probe({ stream = process.stdout, env = process.env, flags = {}, platform = flags.platform ?? process.platform } = {}) {
  const set = (k) => env[k] !== undefined && env[k] !== "";
  const tty = flags.tty ?? Boolean(stream.isTTY);
  const dumb = env.TERM === "dumb";
  let color;
  if (flags.color !== undefined) color = flags.color;
  else if (set("NO_COLOR")) color = false;
  else if (set("FORCE_COLOR")) color = !/^(0|false)$/i.test(env.FORCE_COLOR);
  else if (set("CLICOLOR_FORCE") && env.CLICOLOR_FORCE !== "0") color = true;
  else color = tty && !dumb && env.CLICOLOR !== "0";
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  let glyphs = flags.glyphs;
  if (!glyphs && set("ZCODE_KIT_UNICODE")) glyphs = env.ZCODE_KIT_UNICODE === "0" ? "ascii" : "full";
  if (!glyphs) {
    if (dumb || !tty || (platform !== "win32" && locale && !/utf-?8/i.test(locale))) glyphs = "ascii";
    else if (platform === "win32" && !(set("WT_SESSION") || set("TERM_PROGRAM"))) glyphs = "wgl4";
    else glyphs = "full";
  }
  const ci = set("CI") && !/^(0|false)$/i.test(env.CI);
  const width = Math.max(40, Number(flags.width) || stream.columns || Number(env.COLUMNS) || 80);
  return { tty, color, glyphs, unicode: glyphs !== "ascii", animate: tty && !dumb && !ci, width, fixed: tty };
}

// ------------------------------------------------------------------ tokens
// [full, wgl4, ascii]. R12: chrome uses WGL4-safe glyphs below `full`; no
// emoji, no braille, no VS16 at any tier. Status is always glyph + word (R11).
const GLYPH = {
  ok: ["✓", "√", "+"], fail: ["✗", "×", "x"], warn: ["!", "!", "!"], skip: ["–", "–", "-"], info: ["•", "•", "*"],
  run: ["●", "●", "*"], stop: ["○", "○", "o"], arrow: ["→", "→", "->"], next: ["▸", "►", ">"], dot: ["·", "·", "-"],
  ell: ["…", "…", "..."], tree: ["├─", "├─", "|-"], last: ["└─", "└─", "`-"], pipe: ["│", "│", "|"],
  bar: ["█", "█", "#"], barEmpty: ["░", "░", "."], up: ["↑", "↑", "^"], down: ["↓", "↓", "v"], hr: ["─", "─", "-"],
};
const TIER = { full: 0, wgl4: 1, ascii: 2 };
const BOX = {
  full: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  wgl4: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
};
// 16-colour SGR only (R13): renders on conhost, PowerShell 5.1, macOS Terminal, every Linux terminal.
const ROLE = { ok: "32", fail: "31", warn: "33", info: "36", accent: "36", muted: "2", heading: "1", cmd: "1", key: "", value: "" };
const WORD = { ok: "ok", fail: "FAIL", warn: "warn", skip: "skip", info: "info" };

function theme(c) {
  const g = (name) => GLYPH[name][TIER[c.glyphs]];
  const paint = (role, text) => (c.color && ROLE[role] ? `\x1b[${ROLE[role]}m${text}\x1b[0m` : text);
  const fit = (text, w) => (c.fixed ? truncateToWidth(text, w, g("ell")) : text);
  return { c, g, paint, fit, box: BOX[c.glyphs], w: c.width };
}

// ------------------------------------------------------------- fake data
const DOCTOR = [
  { group: "Runtime", name: "Bun runtime", status: "ok", detail: "1.4.2 (~/.bun/bin/bun)" },
  { group: "Runtime", name: "Proxy config", status: "ok", detail: "proxy/config.yaml" },
  { group: "Runtime", name: "Local proxy key", status: "ok", detail: ".proxykey" },
  { group: "Runtime", name: "Proxy dependencies", status: "ok", detail: "zcode-proxy-src/node_modules" },
  { group: "Runtime", name: "MCP bridge dependencies", status: "fail", detail: "mcp/zcode-harness-mcp/node_modules missing",
    why: "the last setup was interrupted before the bridge dependencies were installed", next: "zcode-kit setup" },
  { group: "Proxy", name: "Proxy reachable (own instance)", status: "ok", detail: "http://127.0.0.1:8457, identity verified" },
  { group: "Proxy", name: "Memory", status: "warn", detail: "proxy 912 MB of 1024 MB budget",
    why: "RSS is close to the hard cap; the captcha worker is recycled at the cap", next: "zcode-kit proxy restart" },
  { group: "Account", name: "Credential store", status: "ok", detail: "decryptable on this machine" },
  { group: "Account", name: "Account auth", status: "ok", detail: "valid (token 5.2 h old)" },
  { group: "Integrations", name: "OMP / Oh My Pi", status: "ok", detail: "provider, key resolver, autostart extension" },
  { group: "Integrations", name: "Codex", status: "ok", detail: "generated/codex-home/config.toml" },
  { group: "Integrations", name: "OpenCode", status: "fail", detail: "provider.zcode missing from opencode.json",
    why: "the file was rewritten after setup (no kit signature found)", next: "zcode-kit integrate opencode" },
  { group: "Integrations", name: "pi", status: "skip", detail: "declined in setup — zcode-kit integrate pi to change" },
  { group: "Integrations", name: "Claude Code", status: "skip", detail: "no decision yet — zcode-kit integrate claude-code" },
  { group: "Integrations", name: "Cline, Kilo Code, Aider, Goose", status: "skip", detail: "not detected" },
];
const CONN = { openai: "http://127.0.0.1:8457/v1", anthropic: "http://127.0.0.1:8457", models: ["glm-5.3", "glm-5.3-flash"],
  key: "k7Qm2_example_fake_key_A1b2C3d4E5f6G7h8I9j0", verified: true };
const STATUS = {
  state: "running", pid: 48211, uptime: "1 h 02 min", port: 8457, version: "0.2.42 (proxy 4.6.4)",
  procs: [
    { name: "proxy", pid: 48211, rss: 182, cap: 1024 },
    { name: "captcha worker", pid: 48230, rss: 311, cap: 768 },
    { name: "sync-fetch worker", pid: 48231, rss: 41, cap: 128 },
  ],
  captcha: "ready 2/2, mint success 96 % (10 min), solver gen 3 (2 recycles)",
  quota: [{ name: "GLM Coding Lite", left: 4120, total: 6000, unit: "prompts", resets: "2026-12-31" },
    { name: "Start Plan Bonus", left: 35, total: 200, unit: "prompts", resets: "2026-11-30" }],
  accounts: [{ id: "work", verdict: "usable", state: "ready", active: true }, { id: "personal", verdict: "exhausted", state: "until 13:00" },
    { id: "backup", verdict: "paused", state: "paused" }],
};
const SETUP = {
  configured: [{ label: "OMP / Oh My Pi", note: "+ MCP bridge" }, { label: "Codex" }, { label: "OpenCode" }],
  skipped: [{ label: "pi", note: "answered n" }, { label: "Claude Code", note: "answered n" }, { label: "Continue", note: "answered n" }],
  failed: [],
  rotator: "disabled (enable later: zcode-kit accounts enable)",
  smoke: "skipped (no account yet)",
  tx: "2026-11-05T12-00-00-000-001-a1b2c3",
};
const ERR = { what: "Port 8457 is in use by another service", why: "it answered /health without this kit's identity (HTTP 401); the kit never stops a service it did not start",
  next: ["zcode-kit proxy status", "change server.port in proxy/config.yaml, then zcode-kit proxy start"], code: 3 };
const LOGS = (() => {
  const out = [];
  for (let i = 1; i <= 214; i++) {
    const sec = 12 * 3600 + i * 13;
    const t = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, "0")).join(":");
    if (i % 31 === 0) out.push({ t, level: "error", text: `r${i} OAI glm-5.3-flash 502 stream 1.2s upstream error 上游服务暂时不可用 (provider_1305)` });
    else if (i % 17 === 0) out.push({ t, level: "warn", text: `r${i} ANT glm-5.3 429 batch 233ms rate limited, retry in 30 s` });
    else out.push({ t, level: "info", text: `r${i} ${i % 2 ? "ANT glm-5.3     " : "OAI glm-5.3-flash"} 200 stream ${300 + (i % 40) * 9}ms ${400 + i * 3}tok` });
  }
  return out;
})();
const HELP = [
  { group: "Get started", cmds: [["setup", "Detect assistants, ask once per assistant, configure the local provider"], ["integrate <harness>", "Configure one assistant explicitly (--dry-run shows the changes)"], ["run <harness> -- <args>", "Start an assistant wired to the local proxy"]] },
  { group: "Check and fix", cmds: [["doctor", "Check runtime, proxy, account and integrations (--fix repairs, --json)"], ["status", "Proxy health, memory, quota and connection details (--json)"], ["models", "Model ids served by the proxy (--show-key prints the local key)"]] },
  { group: "Proxy service", cmds: [["proxy start|stop|restart", "Manage the local proxy (never touches a service it did not start)"], ["proxy status|logs [n]", "Show state or the last n log lines"]] },
  { group: "Accounts", cmds: [["auth status|login|logout", "ZCode login used by the proxy"], ["accounts [health|quota|doctor]", "Account Rotator pool (enable|disable|pause|resume|remove)"]] },
  { group: "Maintenance", cmds: [["update [--version vX.Y.Z]", "Update the kit, keep your configuration"], ["rollback [tx-id]", "Undo the last (or a given) change set"], ["uninstall", "Remove kit-owned integrations; logins are kept"]] },
];
const EXAMPLES = [["zcode-kit setup", "first run, answers y/n per assistant"], ["zcode-kit setup --harness omp,codex", "unattended, no questions"], ["zcode-kit proxy status", "base URLs, key and models for a manual client"], ["zcode-kit doctor --fix", "repair kit-owned config and restart a dead proxy"]];
const EXIT_CODES = "0 ok · 1 checks failed · 2 runtime error · 3 port conflict · 4 safe-start refused · 5 auth failure · 20 a harness failed · 130 aborted";

// ---------------------------------------------------------------- helpers
const statusWord = (T, s) => T.paint(s, `${T.g(s === "skip" ? "skip" : s === "info" ? "info" : s)} ${WORD[s]}`);
const counts = (rows) => rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
const kv = (T, pairs, indent = "  ") => {
  const kw = Math.max(...pairs.map(([k]) => displayWidth(k)));
  return pairs.map(([k, v]) => T.fit(`${indent}${T.paint("muted", padEndWidth(k, kw))}  ${v}`, T.w));
};
/**
 * Word-wrap prose to the terminal (R17): never truncate explanations. `first`
 * prefixes line 1, `rest` the continuation lines (hanging indent). Off a TTY
 * prose wraps at 80; single-record data lines are never wrapped (use fit()).
 */
function wrap(T, text, first = "", rest = " ".repeat(displayWidth(stripAnsi(first))), width = T.c.tty ? T.w : 80) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = first;
  let empty = true;
  for (const word of words) {
    const candidate = empty ? line + word : `${line} ${word}`;
    if (!empty && displayWidth(stripAnsi(candidate)) > width) { out.push(line); line = rest + word; }
    else line = candidate;
    empty = false;
  }
  out.push(line);
  return out;
}
function bar(T, frac, width = 10) {
  const n = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return T.g("bar").repeat(n) + T.g("barEmpty").repeat(width - n);
}
function boxed(T, title, lines, { width = Math.min(T.w, 100), right = "" } = {}) {
  const b = T.box;
  const inner = width - 4;
  const head = ` ${title} `;
  const tail = right ? ` ${right} ` : "";
  const fill = Math.max(1, width - 2 - displayWidth(stripAnsi(head)) - displayWidth(stripAnsi(tail)) - 1);
  const out = [T.paint("muted", b.tl + b.h) + T.paint("heading", head) + T.paint("muted", b.h.repeat(fill)) + tail + T.paint("muted", b.tr)];
  for (const l of lines) {
    // Long content wraps inside the card with a hanging indent under its
    // last column (never cut prose). Wrapped rows lose their colour (prototype).
    if (displayWidth(stripAnsi(l)) <= inner) { out.push(`${T.paint("muted", b.v)} ${padEndWidth(l, inner)} ${T.paint("muted", b.v)}`); continue; }
    const plain = stripAnsi(l);
    let cut = 0;
    for (const m of plain.matchAll(/\S\s{2,}/g)) if (m.index + m[0].length < inner * 0.6) cut = m.index + m[0].length;
    const parts = wrap({ c: { tty: true }, w: inner }, plain.slice(cut), plain.slice(0, cut), " ".repeat(cut), inner);
    for (const t of parts) out.push(`${T.paint("muted", b.v)} ${padEndWidth(truncateToWidth(t, inner, T.g("ell")), inner)} ${T.paint("muted", b.v)}`);
  }
  out.push(T.paint("muted", b.bl + b.h.repeat(width - 2) + b.br));
  return out;
}
const rule = (T, title) => {
  const t = ` ${title} `;
  return T.paint("heading", `${title} `) + T.paint("muted", T.g("hr").repeat(Math.max(2, Math.min(T.w, 80) - displayWidth(t))));
};

// ============================================================ VARIANT A
// "Ledger": classic line-oriented CLI. Bold section headings with a rule,
// one check per line in a fixed status column, details aligned after the
// name, a final verdict line. Connection details as an aligned key/value
// block. TUI: the current three stacked cards, extended with a health
// header and a filter row. Closest to today's output and its grep-ability.
const A = {
  name: "Ledger",
  help(T) {
    const o = [T.paint("heading", "zcode-kit") + " — local ZCode provider for your own agent harnesses", "", T.paint("heading", "Usage") + "  zcode-kit <command> [options]", ""];
    for (const grp of HELP) {
      o.push(T.paint("heading", grp.group));
      const w = Math.max(...HELP.flatMap((x) => x.cmds.map(([c]) => displayWidth(c))));
      for (const [c, d] of grp.cmds) o.push(...wrap(T, d, `  ${T.paint("cmd", padEndWidth(c, w))}  `, " ".repeat(w + 4)));
      o.push("");
    }
    o.push(T.paint("heading", "Examples"));
    for (const [c, d] of EXAMPLES) o.push(...wrap(T, "# " + d, `  ${padEndWidth(c, 38)}`, " ".repeat(42)).map((l, i) => (i ? T.paint("muted", l) : l)));
    o.push("", T.paint("heading", "Exit codes"), ...wrap(T, EXIT_CODES, "  "), "", `Details for one command: zcode-kit <command> --help`);
    return o;
  },
  doctor(T) {
    const o = [];
    let last = null;
    const nw = Math.max(...DOCTOR.map((r) => displayWidth(r.name)));
    for (const r of DOCTOR) {
      if (r.group !== last) { if (last) o.push(""); o.push(rule(T, r.group)); last = r.group; }
      const word = padEndWidth(statusWord(T, r.status), 6 + (T.c.color ? 9 : 0));
      const pad = " ".repeat(10 + nw + 2);
      o.push(...(T.c.tty ? wrap(T, r.detail, `  ${word}  ${padEndWidth(r.name, nw)}  `, pad) : [`  ${word}  ${padEndWidth(r.name, nw)}  ${r.detail}`]).map((l, i) => (i ? T.paint("muted", l) : l)));
      if (r.why) o.push(...wrap(T, r.why, `${pad}why   `, `${pad}      `), `${pad}next  ${T.paint("cmd", r.next)}`);
    }
    const n = counts(DOCTOR);
    o.push("", `doctor: ${T.paint("fail", `${n.fail} failed`)}, ${T.paint("warn", `${n.warn} warning`)}, ${n.ok} ok, ${n.skip} skipped  ${T.g("arrow")} exit 1`);
    return o;
  },
  setup(T) {
    const o = [rule(T, "Setup summary")];
    for (const a of SETUP.configured) o.push(`  ${statusWord(T, "ok")}    ${a.label}${a.note ? T.paint("muted", "  " + a.note) : ""}`);
    for (const a of SETUP.skipped) o.push(`  ${statusWord(T, "skip")}  ${a.label}${T.paint("muted", "  " + a.note)}`);
    o.push("", ...kv(T, [["Assistants", `${SETUP.configured.length} configured, ${SETUP.skipped.length} skipped, ${SETUP.failed.length} failed`], ["Account Rotator", SETUP.rotator], ["Live check", SETUP.smoke], ["Undo", `zcode-kit rollback ${SETUP.tx}`]]));
    o.push("", rule(T, "Connection details (manual clients)"), ...A.conn(T), "", `Next: ${T.paint("cmd", "zcode-kit auth login zai")}  then  ${T.paint("cmd", "zcode-kit doctor")}`);
    return o;
  },
  conn(T) {
    return kv(T, [["OpenAI base URL", CONN.openai], ["Anthropic base URL", CONN.anthropic], ["API key", T.c.tty ? CONN.key : "(hidden off a terminal — zcode-kit models --show-key)"], ["Models", CONN.models.join(", ")], ["State", CONN.verified ? `${T.paint("ok", T.g("run") + " running")}, identity verified` : "configured, proxy not running"]]);
  },
  status(T) {
    const s = STATUS;
    const o = [rule(T, "Proxy"), ...kv(T, [["State", `${T.paint("ok", T.g("run") + " running")} since ${s.uptime} (pid ${s.pid})`], ["Port", `${s.port} (loopback only)`], ["Version", s.version]])];
    o.push("", rule(T, "Memory"));
    for (const p of s.procs) o.push(T.fit(`  ${padEndWidth(p.name, 18)} ${String(p.rss).padStart(5)} MB of ${String(p.cap).padStart(4)} MB  ${bar(T, p.rss / p.cap)}  pid ${p.pid}`, T.w));
    o.push("", rule(T, "Quota"));
    for (const q of s.quota) o.push(T.fit(`  ${padEndWidth(q.name, 18)} ${String(q.left).padStart(5)} of ${String(q.total).padStart(4)} ${q.unit} left  ${bar(T, q.left / q.total)}  resets ${q.resets}`, T.w));
    o.push("", rule(T, "Accounts"), `  ${s.accounts.map((a) => `${a.active ? "*" : ""}${a.id} ${a.verdict}`).join(T.paint("muted", "  " + T.g("dot") + "  "))}   (* active)`);
    o.push("", rule(T, "Captcha"), `  ${s.captcha}`, "", rule(T, "Connection details"), ...A.conn(T));
    return o;
  },
  error(T) {
    return [`${T.paint("fail", `${T.g("fail")} error`)}  ${ERR.what}`, ...wrap(T, ERR.why, "   why   ", "         "), ...ERR.next.map((n, i) => `   ${i ? "  or " : "next "} ${T.paint("cmd", n)}`), T.paint("muted", `   exit ${ERR.code}`)];
  },
  tui(T, h = 24) {
    const w = T.w;
    const o = [];
    const top = boxed(T, "ZCode proxy", [
      `${T.paint("ok", T.g("run") + " running")}  :8457  ${T.g("dot")}  health ok  ${T.g("dot")}  up 1 h 02 min  ${T.g("dot")}  zai / start-plan`,
      `${T.paint("muted", "memory")}  proxy 182 MB  captcha 311 MB  fetch 41 MB   ${T.paint("muted", "quota")}  4120/6000  35/200`,
      `${T.paint("muted", "accounts")}  *work usable  personal exhausted  backup paused`,
    ], { width: w, right: T.paint("ok", "logged in") });
    o.push(...top);
    const filter = "429";
    const shown = LOGS.filter((l) => l.text.includes(filter));
    const rows = Math.max(3, h - top.length - 4);
    const logLines = [`${T.paint("accent", "filter:")} ${filter}   ${T.paint("muted", `${shown.length} of ${LOGS.length} lines`)}`];
    for (const l of shown.slice(-(rows - 1))) logLines.push(`${T.paint("muted", l.t)} ${l.level === "warn" ? T.paint("warn", "warn ") : l.level === "error" ? T.paint("fail", "ERROR") : "     "} ${l.text}`);
    while (logLines.length < rows) logLines.push("");
    o.push(...boxed(T, "Logs", logLines, { width: w, right: T.paint("ok", "following") }));
    // Footer in priority order: it is cut from the right on narrow terminals, so quit comes first.
    o.push(T.fit(` ${keyHint(T, "q", "quit")}  ${keyHint(T, "s", "start/stop")}  ${keyHint(T, "/", "filter")}  ${keyHint(T, "l", "login")}  ${keyHint(T, "g", "follow")}  ${keyHint(T, "c", "clear")}  ${T.paint("muted", `${T.g("up")}${T.g("down")} scroll`)}`, w));
    return o;
  },
};
const keyHint = (T, k, label) => `${T.paint("cmd", `[${k}]`)} ${label}`;

// ============================================================ VARIANT B
// "Cards": the answer first, in boxed summary cards. Each command opens with
// a verdict card (big status + counts), then one card per group; problems
// get their own error card (what / why / next). Connection details are one
// copyable card. TUI: a dashboard grid — four tiles (Health, Memory, Quota,
// Accounts) above the log pane. Strongest scannability, heaviest chrome.
const B = {
  name: "Cards",
  help(T) {
    const w = Math.min(T.w, 100);
    const o = [...boxed(T, "zcode-kit", ["Local ZCode provider for your own agent harnesses.", `${T.paint("muted", "usage")}  zcode-kit <command> [options]     ${T.paint("muted", "help")}  zcode-kit <command> --help`], { width: w })];
    for (const grp of HELP) {
      const cw = Math.max(...grp.cmds.map(([c]) => displayWidth(c)));
      o.push(...boxed(T, grp.group, grp.cmds.map(([c, d]) => `${T.paint("cmd", padEndWidth(c, cw))}  ${d}`), { width: w }));
    }
    o.push(...boxed(T, "Examples", EXAMPLES.map(([c, d]) => `${T.paint("cmd", padEndWidth(c, 38))}${T.paint("muted", d)}`), { width: w }));
    o.push(...wrap(T, EXIT_CODES, "exit codes: ").map((l) => T.paint("muted", l)));
    return o;
  },
  doctor(T) {
    const w = Math.min(T.w, 100);
    const n = counts(DOCTOR);
    const verdict = n.fail ? T.paint("fail", `${T.g("fail")} 2 problems need attention`) : T.paint("ok", `${T.g("ok")} all checks passed`);
    const o = [...boxed(T, "zcode-kit doctor", [verdict, `${T.paint("fail", `${n.fail} failed`)}   ${T.paint("warn", `${n.warn} warning`)}   ${T.paint("ok", `${n.ok} ok`)}   ${n.skip} skipped`], { width: w })];
    for (const r of DOCTOR.filter((x) => x.status === "fail" || x.status === "warn")) o.push(...B.errorCard(T, r.name + " — " + r.detail, r.why, [r.next], r.status));
    const groups = [...new Set(DOCTOR.map((r) => r.group))];
    for (const gname of groups) {
      const rows = DOCTOR.filter((r) => r.group === gname);
      const c = counts(rows);
      const nw = Math.max(...rows.map((r) => displayWidth(r.name)));
      o.push(...boxed(T, gname, rows.map((r) => `${padEndWidth(statusWord(T, r.status), 6 + (T.c.color ? 9 : 0))} ${padEndWidth(r.name, nw)}  ${T.paint("muted", r.detail)}`), { width: w, right: `${c.ok ?? 0}/${rows.length} ok` }));
    }
    return o;
  },
  errorCard(T, what, why, next, kind = "fail") {
    const w = Math.min(T.w, 100);
    return boxed(T, T.paint(kind, `${T.g(kind)} ${kind === "fail" ? "ERROR" : "WARNING"}`), [what, `${T.paint("muted", "why ")}  ${why}`, ...next.map((n, i) => `${T.paint("muted", i ? "or  " : "next")}  ${T.paint("cmd", n)}`)], { width: w });
  },
  setup(T) {
    const w = Math.min(T.w, 100);
    const o = [...boxed(T, "Setup complete", [T.paint("ok", `${T.g("ok")} ${SETUP.configured.length} assistants configured`) + `   ${SETUP.skipped.length} skipped   ${SETUP.failed.length} failed`,
      ...SETUP.configured.map((a) => `  ${T.paint("ok", T.g("ok"))} ${a.label}${a.note ? T.paint("muted", "  " + a.note) : ""}`),
      ...SETUP.skipped.map((a) => `  ${T.g("skip")} ${a.label}${T.paint("muted", "  " + a.note)}`),
      "", `${T.paint("muted", "Account Rotator")}  ${SETUP.rotator}`, `${T.paint("muted", "Live check     ")}  ${SETUP.smoke}`, `${T.paint("muted", "Undo           ")}  zcode-kit rollback ${SETUP.tx}`], { width: w })];
    o.push(...B.connCard(T), ...boxed(T, "Next", [`1  ${T.paint("cmd", "zcode-kit auth login zai")}   sign in`, `2  ${T.paint("cmd", "zcode-kit doctor")}          verify everything`], { width: w }));
    return o;
  },
  connCard(T) {
    const w = Math.min(T.w, 100);
    return boxed(T, "Connect any client", [
      `${T.paint("muted", "OpenAI    ")}  ${CONN.openai}`, `${T.paint("muted", "Anthropic ")}  ${CONN.anthropic}`,
      `${T.paint("muted", "API key   ")}  ${T.c.tty ? CONN.key : "hidden off a terminal: zcode-kit models --show-key"}`, `${T.paint("muted", "Models    ")}  ${CONN.models.join("  ")}`,
    ], { width: w, right: T.paint("ok", `${T.g("run")} verified`) });
  },
  status(T) {
    const w = Math.min(T.w, 100);
    const s = STATUS;
    const o = [...boxed(T, "Proxy", [`${T.paint("ok", `${T.g("run")} running`)}   port ${s.port}   up ${s.uptime}   pid ${s.pid}`, T.paint("muted", s.version)], { width: w, right: T.paint("ok", "healthy") })];
    o.push(...boxed(T, "Memory", s.procs.map((p) => `${padEndWidth(p.name, 18)} ${bar(T, p.rss / p.cap, 16)} ${String(p.rss).padStart(4)} / ${p.cap} MB`), { width: w, right: "hard caps" }));
    o.push(...boxed(T, "Quota", s.quota.map((q) => `${padEndWidth(q.name, 18)} ${bar(T, q.left / q.total, 16)} ${q.left} / ${q.total} ${q.unit}  ${T.paint("muted", "resets " + q.resets)}`), { width: w }));
    o.push(...boxed(T, "Accounts", s.accounts.map((a) => `${a.active ? T.paint("accent", "*") : " "} ${padEndWidth(a.id, 10)} ${a.verdict === "usable" ? T.paint("ok", T.g("ok") + " usable") : a.verdict === "paused" ? `${T.g("skip")} paused` : T.paint("warn", `${T.g("warn")} ${a.verdict}`)}  ${T.paint("muted", a.state)}`), { width: w, right: "1 of 3 usable" }));
    o.push(...B.connCard(T));
    return o;
  },
  error(T) { return [...B.errorCard(T, ERR.what, ERR.why, ERR.next), T.paint("muted", `exit ${ERR.code}`)]; },
  tui(T, h = 24) {
    const w = T.w;
    const o = [];
    const tw = Math.floor((w - 3) / 4);
    const tiles = [
      ["Health", [T.paint("ok", `${T.g("run")} running`), ":8457 · up 1h02", T.paint("ok", "logged in")]],
      ["Memory", ["proxy   182 MB", "captcha 311 MB", "fetch    41 MB"]],
      ["Quota", [`Lite  ${bar(T, 4120 / 6000, 6)}`, `Bonus ${bar(T, 35 / 200, 6)}`, "4155 prompts"]],
      ["Accounts", [T.paint("ok", "*work usable"), T.paint("warn", "personal exh."), "backup paused"]],
    ].map(([t, l]) => boxed(T, t, l, { width: tw }));
    for (let i = 0; i < tiles[0].length; i++) o.push(tiles.map((t) => t[i]).join(" "));
    const rows = Math.max(3, h - o.length - 3);
    const lines = LOGS.slice(-rows).map((l) => `${T.paint("muted", l.t)} ${l.level === "warn" ? T.paint("warn", "warn ") : l.level === "error" ? T.paint("fail", "ERROR") : "     "} ${l.text}`);
    o.push(...boxed(T, `Logs ${T.paint("muted", `(${LOGS.length})`)}`, lines, { width: w, right: `${T.paint("muted", "filter")} all  ${T.paint("ok", "following")}` }));
    o.push(T.fit(` ${["q quit", "s start/stop", "/ filter", "l login", "o logout", "g follow"].map((x) => `${T.paint("cmd", x.split(" ")[0])} ${x.split(" ").slice(1).join(" ")}`).join(T.paint("muted", "  " + T.g("dot") + "  "))}`, w));
    return o;
  },
};

// ============================================================ VARIANT C
// "Outline": problem-first, no boxes. A one-line verdict leads; problems
// follow as a tree (what → why → next); everything that passed collapses to
// one line per group (--verbose expands). Help is man-page shaped: USAGE,
// COMMON TASKS (examples first), COMMANDS, EXIT CODES. TUI: a one-line
// status bar (htop/less style), full-height log pane, sidebar on wide
// terminals. Densest; best on 80 columns and in pipes; least chrome.
const C = {
  name: "Outline",
  help(T) {
    const o = [T.paint("heading", "USAGE"), "  zcode-kit <command> [options]", "", T.paint("heading", "COMMON TASKS")];
    for (const [c, d] of EXAMPLES) o.push(...wrap(T, d, "  ").map((l) => T.paint("muted", l)), `    $ ${T.paint("cmd", c)}`);
    o.push("", T.paint("heading", "COMMANDS"));
    for (const grp of HELP) {
      o.push(`  ${T.paint("accent", grp.group.toLowerCase())}`);
      for (const [c, d] of grp.cmds) o.push(...wrap(T, d, `    ${padEndWidth(c, 31)} `, " ".repeat(36)));
    }
    o.push("", T.paint("heading", "EXIT CODES"), ...wrap(T, EXIT_CODES, "  "), "", T.paint("muted", "zcode-kit <command> --help for options · docs: README.md#commands"));
    return o;
  },
  doctor(T) {
    const n = counts(DOCTOR);
    const o = [`${T.paint("fail", `${T.g("fail")} doctor: ${n.fail} problems`)}, ${T.paint("warn", `${n.warn} warning`)} ${T.paint("muted", `(${n.ok} ok, ${n.skip} skipped)`)}`, ""];
    for (const r of DOCTOR.filter((x) => x.why)) {
      o.push(...wrap(T, `${r.group.toLowerCase()} ${T.g("dot")} ${r.name}: ${r.detail}`, `${statusWord(T, r.status)}  `, "        "));
      o.push(...wrap(T, r.why, `  ${T.g("tree")} why   `, `  ${T.g("pipe")}        `), `  ${T.g("last")} next  ${T.paint("cmd", r.next)}`, "");
    }
    for (const gname of [...new Set(DOCTOR.map((r) => r.group))]) {
      const rows = DOCTOR.filter((r) => r.group === gname && !r.why);
      const c = counts(rows);
      const names = rows.filter((r) => r.status === "ok").map((r) => r.name);
      const parts = [names.length ? `${T.paint("ok", T.g("ok"))} ${names.join(", ")}` : "", c.skip ? `${T.g("skip")} ${c.skip} skipped` : ""].filter(Boolean);
      o.push(...wrap(T, parts.join("   "), T.paint("muted", padEndWidth(gname.toLowerCase(), 13)), " ".repeat(15)));
    }
    o.push("", T.paint("muted", "zcode-kit doctor --verbose lists every check · --json for scripts"));
    return o;
  },
  setup(T) {
    const o = [`${T.paint("ok", `${T.g("ok")} setup complete`)} ${T.paint("muted", `(${SETUP.configured.length} configured, ${SETUP.skipped.length} skipped, ${SETUP.failed.length} failed)`)}`, ""];
    o.push(T.fit(`configured   ${SETUP.configured.map((a) => a.label + (a.note ? ` (${a.note.replace("+ ", "")})` : "")).join(", ")}`, T.w));
    o.push(T.fit(`skipped      ${SETUP.skipped.map((a) => a.label).join(", ")} ${T.paint("muted", "(answered n)")}`, T.w));
    o.push(T.fit(`rotator      ${SETUP.rotator}`, T.w), `live check   ${SETUP.smoke}`, T.fit(`undo         zcode-kit rollback ${SETUP.tx}`, T.w), "");
    o.push(T.paint("heading", "connect a client manually"), ...C.conn(T), "", T.paint("heading", "next"), `  ${T.g("next")} ${T.paint("cmd", "zcode-kit auth login zai")}`, `  ${T.g("next")} ${T.paint("cmd", "zcode-kit doctor")}`);
    return o;
  },
  conn(T) {
    return [`  base URL   ${CONN.openai}  ${T.paint("muted", "(OpenAI)")}`, `             ${CONN.anthropic}  ${T.paint("muted", "(Anthropic)")}`, `  key        ${T.c.tty ? CONN.key : T.paint("muted", "hidden off a terminal; zcode-kit models --show-key")}`, `  models     ${CONN.models.join(", ")}`];
  },
  status(T) {
    const s = STATUS;
    const mem = s.procs.reduce((a, p) => a + p.rss, 0);
    const o = [`${T.paint("ok", `${T.g("run")} proxy running`)} on :${s.port} ${T.paint("muted", `· up ${s.uptime} · pid ${s.pid} · ${s.version}`)}`, ""];
    o.push(...wrap(T, `${mem} MB total ${T.g("dot")} ${s.procs.map((p) => `${p.name} ${p.rss}/${p.cap} MB`).join(` ${T.g("dot")} `)}`, "memory     ", " ".repeat(11)));
    o.push(...wrap(T, `${s.quota.map((q) => `${q.name} ${q.left}/${q.total}`).join(` ${T.g("dot")} `)} ${s.quota[0].unit}`, "quota      ", " ".repeat(11)));
    o.push(...wrap(T, `1 of 3 usable (${s.accounts.map((a) => `${a.active ? "*" : ""}${a.id} ${a.verdict}`).join(", ")})`, "accounts   ", " ".repeat(11)));
    o.push(...wrap(T, s.captcha, "captcha    ", " ".repeat(11)), "", T.paint("heading", "connect a client manually"), ...C.conn(T));
    return o;
  },
  error(T) {
    return [`${T.paint("fail", `${T.g("fail")} ${ERR.what}`)}`, ...wrap(T, ERR.why, `  ${T.g("tree")} why   `, `  ${T.g("pipe")}        `), ...ERR.next.map((n, i, a) => `  ${i === a.length - 1 ? T.g("last") : T.g("tree")} ${i ? "or  " : "next"}  ${T.paint("cmd", n)}`), T.paint("muted", `  exit ${ERR.code}`)];
  },
  tui(T, h = 24) {
    const w = T.w;
    const head = `${T.paint("ok", `${T.g("run")} running`)} :8457 ${T.g("dot")} ok ${T.g("dot")} rss 534 MB ${T.g("dot")} quota 4155 ${T.g("dot")} 1/3 acc ${T.g("dot")} zai/start-plan`;
    const o = [T.c.color ? `\x1b[7m${padEndWidth(" " + stripAnsi(head), w)}\x1b[0m` : padEndWidth(" " + head, w)];
    const side = w >= 100;
    const sw = side ? 28 : 0;
    const rows = h - 3;
    const sideLines = side ? ["MEMORY", " proxy        182 MB", " captcha      311 MB", " sync-fetch    41 MB", "", "QUOTA", ` Lite  ${bar(T, 4120 / 6000, 8)} 69%`, ` Bonus ${bar(T, 35 / 200, 8)} 18%`, "", "ACCOUNTS", " *work      usable", "  personal  exhausted", "  backup    paused"] : [];
    const logs = LOGS.slice(-rows);
    for (let i = 0; i < rows; i++) {
      const l = logs[i];
      const lvl = l.level === "warn" ? T.paint("warn", "W") : l.level === "error" ? T.paint("fail", "E") : T.paint("muted", T.g("dot"));
      const text = truncateToWidth(`${l.t} ${l.text}`, w - sw - 4, T.g("ell"));
      const left = `${lvl} ${l.t === undefined ? "" : T.paint("muted", text.slice(0, 8)) + text.slice(8)}`;
      o.push(side ? `${padEndWidth(left, w - sw - 1)}${T.paint("muted", T.g("pipe"))}${padEndWidth(sideLines[i] ? (/^[A-Z]/.test(sideLines[i]) ? T.paint("heading", sideLines[i]) : sideLines[i]) : "", sw)}` : left);
    }
    o.push(T.paint("muted", T.g("hr").repeat(w)));
    o.push(T.fit(`${T.paint("accent", "q")} quit  ${T.paint("accent", "/")}filter  ${T.paint("accent", "s")} start/stop  ${T.paint("accent", "l")} login  ${T.paint("accent", "g")} follow   ${T.paint("muted", `${LOGS.length} lines, following`)}`, w));
    return o;
  },
};

const VARIANTS = { A, B, C };
const SCREENS = ["help", "doctor", "setup", "status", "error", "tui"];

function render(variant, screen, caps, tuiRows = 24) {
  const T = theme(caps);
  const v = VARIANTS[variant];
  if (screen === "tui" && !caps.tty) {
    // Non-TTY contract for the dashboard: refuse with the line-based alternative.
    return ["zcode-proxy: the dashboard needs an interactive terminal.", "  next: zcode-kit proxy status    (one-shot, line-based)", "        zcode-kit proxy logs 50  (last log lines)"].join("\n");
  }
  const text = v[screen](T, tuiRows).join("\n");
  // Copy passes through the same tier as chrome: kit-authored punctuation is
  // mapped down on the ascii tier (user/upstream DATA keeps its UTF-8).
  return caps.glyphs === "ascii" ? text.replace(/—/g, "-").replace(/–/g, "-").replace(/·/g, "-").replace(/…/g, "...") : text;
}

// ---------------------------------------------------------------- CLI
function parseFlags(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--variant") f.variant = args[++i];
    else if (a === "--screen") f.screen = args[++i];
    else if (a === "--width") f.width = Number(args[++i]);
    else if (a === "--rows") f.rows = Number(args[++i]);
    else if (a === "--ascii") f.glyphs = "ascii";
    else if (a === "--glyphs") f.glyphs = args[++i];
    else if (a === "--no-color") f.color = false;
    else if (a === "--color") f.color = true;
    else if (a === "--tty") f.tty = true;
    else if (a === "--no-tty") f.tty = false;
    else if (a === "--interactive") f.interactive = true;
    else if (a === "--render-all") f.renderAll = args[++i];
  }
  return f;
}

// The C3 terminal modes every variant must survive, as probe() inputs.
const MODES = {
  "tty-color-80": { flags: { tty: true, width: 80 }, env: { TERM: "xterm-256color", LANG: "C.UTF-8" } },
  "tty-color-120": { flags: { tty: true, width: 120 }, env: { TERM: "xterm-256color", LANG: "C.UTF-8" } },
  "no-color": { flags: { tty: true, width: 80 }, env: { TERM: "xterm-256color", NO_COLOR: "1", LANG: "C.UTF-8" } },
  "term-dumb": { flags: { tty: true, width: 80 }, env: { TERM: "dumb", LANG: "C.UTF-8" } },
  "ascii": { flags: { tty: true, width: 80 }, env: { TERM: "xterm-256color", LANG: "C" } },
  "win-conhost-wgl4": { flags: { tty: true, width: 80, platform: "win32" }, env: {} },
  "pipe": { flags: { tty: false }, env: { TERM: "xterm-256color", LANG: "C.UTF-8" } },
  "ci": { flags: { tty: false }, env: { TERM: "dumb", CI: "true", LANG: "C.UTF-8" } },
};

function renderAll(dir) {
  for (const variant of Object.keys(VARIANTS)) {
    for (const [mode, m] of Object.entries(MODES)) {
      const caps = probe({ stream: { isTTY: m.flags.tty, columns: m.flags.width }, env: m.env, flags: m.flags });
      for (const screen of SCREENS) {
        const text = render(variant, screen, caps, m.flags.width === 120 ? 40 : 24) + "\n";
        const out = join(dir, `${variant}-${VARIANTS[variant].name.toLowerCase()}`, screen);
        mkdirSync(out, { recursive: true });
        if (/\x1b/.test(text)) writeFileSync(join(out, `${mode}.ansi`), text);
        writeFileSync(join(out, `${mode}.txt`), stripAnsi(text));
      }
    }
  }
  console.log(`rendered ${Object.keys(VARIANTS).length} variants × ${Object.keys(MODES).length} modes × ${SCREENS.length} screens → ${dir}`);
}

function interactive(flags) {
  const keys = Object.keys(VARIANTS);
  let vi = Math.max(0, keys.indexOf(flags.variant ?? "A"));
  let si = Math.max(0, SCREENS.indexOf(flags.screen ?? "doctor"));
  const draw = () => {
    const caps = probe({ flags });
    const rows = process.stdout.rows || 24;
    const body = render(keys[vi], SCREENS[si], caps, rows - 2).split("\n").slice(0, rows - 2);
    const label = ` ◀ ${keys[vi]} (${VARIANTS[keys[vi]].name}) ▶   screen: ${SCREENS[si]} (↑/↓)   q quit `;
    process.stdout.write("\x1b[2J\x1b[H" + body.join("\n") + `\x1b[${rows};1H\x1b[7m${padEndWidth(label, caps.width)}\x1b[0m`);
  };
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  const quit = () => { process.stdout.write("\x1b[?25h\x1b[?1049l"); process.exit(0); };
  process.stdin.on("keypress", (_s, k) => {
    if (k.name === "q" || (k.ctrl && k.name === "c")) quit();
    if (k.name === "right") vi = (vi + 1) % keys.length;
    if (k.name === "left") vi = (vi + keys.length - 1) % keys.length;
    if (k.name === "down") si = (si + 1) % SCREENS.length;
    if (k.name === "up") si = (si + SCREENS.length - 1) % SCREENS.length;
    draw();
  });
  process.stdout.on("resize", draw);
  draw();
}

const flags = parseFlags(process.argv.slice(2));
if (flags.renderAll) renderAll(flags.renderAll);
else if (flags.interactive && process.stdout.isTTY && process.stdin.isTTY) interactive(flags);
else {
  const caps = probe({ flags });
  const variant = (flags.variant ?? "A").toUpperCase();
  const screens = flags.screen ? [flags.screen] : SCREENS;
  for (const screen of screens) {
    if (screens.length > 1) process.stdout.write(`\n${caps.color ? "\x1b[7m" : ""}  PROTOTYPE variant ${variant} (${VARIANTS[variant].name}) · screen: ${screen}  ${caps.color ? "\x1b[0m" : ""}\n\n`);
    process.stdout.write(render(variant, screen, caps, flags.rows ?? 24) + "\n");
  }
}
