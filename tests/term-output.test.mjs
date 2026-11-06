// Seam 5: the output module (lib/term/out.mjs) driven with forced
// capabilities through fake streams. Expected values come from
// design-language §4 / §9, ADR-0001 rule 1 (Round 4 D1) and ADR-0005.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutput, renderRecords } from "../lib/term/out.mjs";
import { REDACTED_KEY } from "../cli/connection-details.mjs";
import { fakeClock } from "./term-fixtures.mjs";

function fakeStream({ isTTY = false, columns } = {}) {
  const chunks = [];
  return { isTTY, columns, chunks, write(chunk) { chunks.push(String(chunk)); return true; }, get text() { return chunks.join(""); } };
}

/** An Out over fake streams; `tty` applies to both streams. */
function output({ tty = false, columns = 80, env = {}, platform = "linux", ...rest } = {}) {
  const stdout = fakeStream({ isTTY: tty, columns: tty ? columns : undefined });
  const stderr = fakeStream({ isTTY: tty, columns: tty ? columns : undefined });
  const out = createOutput({ stdout, stderr, env, platform, ...rest });
  return { out, stdout, stderr };
}

const UTF8 = { TERM: "xterm-256color", LANG: "C.UTF-8" };

// Every off-TTY ("plain") terminal of ADR-0001 rule 1, in every glyph tier.
const PLAIN_VARIANTS = {
  "pipe (ascii)": { env: UTF8 },
  "pipe + ZCODE_KIT_UNICODE=1 (full)": { env: { ...UTF8, ZCODE_KIT_UNICODE: "1" } },
  // The row is a script contract ("exactly" the grammar): forced colour does not reach it.
  "pipe + FORCE_COLOR=1 (ascii)": { env: { ...UTF8, FORCE_COLOR: "1" } },
  "TERM=dumb on a TTY (ascii)": { tty: true, env: { TERM: "dumb", LANG: "C.UTF-8" } },
  "CI on a TTY (full)": { tty: true, env: { ...UTF8, CI: "true" } },
  "CI on a conhost TTY (wgl4)": { tty: true, platform: "win32", env: { CI: "true" } },
  "CI with a C locale on a TTY (ascii)": { tty: true, env: { TERM: "xterm", LANG: "C", CI: "1" } },
};

const CHECK_ROW = /^(PASS|FAIL|SKIP|WARN)  (.+?)( — (.+))?$/;
const CONTINUATION = /^\s+(why|next): \S/;

const ROWS = [
  { status: "pass", name: "bun available", detail: "/opt/bun (1.4.2)" },
  { status: "fail", name: "proxy reachable + identity", detail: "health=down", why: "no process answers on 127.0.0.1:8457", next: "zcode-kit proxy start" },
  { status: "warn", name: "restart budget", detail: "2 of 3 used in 15 min", why: "the proxy restarted twice", next: ["zcode-kit proxy logs 50", "zcode-kit doctor"] },
  { status: "skip", name: "pi: integration", detail: "not configured (no consent yet) — answer y in zcode-kit setup" },
  { status: "pass", name: "omp: omp extension installed" },
];

for (const [label, variant] of Object.entries(PLAIN_VARIANTS)) {
  test(`check() off a TTY keeps the legacy grammar byte for byte: ${label}`, () => {
    const { out, stdout, stderr } = output(variant);
    assert.equal(out.caps.out.plain, true, "the variant must be a plain (off-TTY) terminal");
    for (const row of ROWS) out.check(row);
    const lines = stdout.text.split("\n");
    assert.equal(lines.pop(), "", "output ends with a newline");
    const rows = lines.filter((line) => !/^\s/.test(line));
    assert.equal(rows.length, ROWS.length, "one row per check");
    for (const line of rows) assert.match(line, CHECK_ROW);
    for (const line of lines.filter((l) => /^\s/.test(l))) assert.match(line, CONTINUATION);
    assert.equal(stderr.text, "", "check rows go to stdout");
    assert.doesNotMatch(stdout.text, /\x1b/, "no escape sequences in line mode");
    assert.equal(stdout.text, [
      "PASS  bun available — /opt/bun (1.4.2)",
      "FAIL  proxy reachable + identity — health=down",
      "  why: no process answers on 127.0.0.1:8457",
      "  next: zcode-kit proxy start",
      "WARN  restart budget — 2 of 3 used in 15 min",
      "  why: the proxy restarted twice",
      "  next: zcode-kit proxy logs 50",
      "  next: zcode-kit doctor",
      "SKIP  pi: integration — not configured (no consent yet) — answer y in zcode-kit setup",
      "PASS  omp: omp extension installed",
      "",
    ].join("\n"));
  });
}

test("check() off a TTY never maps the separator or the verdict word down in the ascii tier", () => {
  const { out, stdout } = output({ env: { TERM: "dumb", LANG: "C" } });
  assert.equal(out.caps.out.glyphs, "ascii");
  out.check({ status: "fail", name: "config exists", detail: "missing — run setup" });
  assert.equal(stdout.text, "FAIL  config exists — missing — run setup\n");
  assert.ok(Buffer.from(stdout.text).includes(Buffer.from(" \u2014 ")), "U+2014 kept byte for byte");
});

test("streams (ADR-0005): reports and data on stdout, diagnostics and progress on stderr", () => {
  const { out, stdout, stderr } = output({ env: UTF8 });
  out.heading("Runtime");
  out.kv([["Port", "18458"]]);
  out.check({ status: "pass", name: "bun available" });
  out.result({ status: "ok", label: "proxy started" });
  out.table([{ key: "a", title: "A" }], [{ a: "1" }]);
  out.connection({ port: 18458, source: "configured" });
  out.verdict({ pass: 1 }, { label: "doctor" });
  out.next(["zcode-kit doctor"]);
  out.data("raw line");
  out.json({ ok: true });
  const report = stdout.text;
  assert.equal(stderr.text, "", "nothing but diagnostics may reach stderr");
  out.error({ what: "boom" });
  out.warn({ what: "careful" });
  out.note("fyi");
  out.step("work").done();
  assert.equal(stdout.text, report, "diagnostics never reach stdout");
  assert.equal(stderr.text, "FAIL  boom\nWARN  careful\nINFO  fyi\nwork ...\nOK  work\n");
});

test("json mode: stdout carries only the JSON document (and explicit data); diagnostics stay on stderr", () => {
  const { out, stdout, stderr } = output({ env: UTF8, json: true });
  renderRecords(out, [
    { kind: "heading", title: "Runtime" },
    { kind: "check", status: "fail", name: "x", detail: "y", next: "z" },
    { kind: "verdict", counts: { fail: 1 }, label: "doctor", exit: 1 },
    { kind: "connection", facts: { port: 18458, key: "k" }, reveal: true },
    { kind: "json", value: { ok: false, failed: 1 } },
    { kind: "warn", what: "a warning" },
  ]);
  assert.deepEqual(JSON.parse(stdout.text), { ok: false, failed: 1 });
  assert.equal(stdout.text, '{\n  "ok": false,\n  "failed": 1\n}\n');
  assert.equal(stderr.text, "WARN  a warning\n");
});

test("connection(): the key is shown only on an interactive terminal, never on a pipe, whatever the caller asks", () => {
  const facts = { port: 18458, key: "UXFIXTURE-not-a-secret-0000000000000000000", source: "running" };
  const tty = output({ tty: true, env: { ...UTF8, NO_COLOR: "1" } });
  tty.out.connection(facts, { reveal: true });
  assert.match(tty.stdout.text, /API key {13}UXFIXTURE-not-a-secret-0000000000000000000\n/);
  for (const variant of [{ env: UTF8 }, { env: { ...UTF8, ZCODE_KIT_UNICODE: "1" } }, { env: { ...UTF8, FORCE_COLOR: "1" } }]) {
    const pipe = output(variant);
    pipe.out.connection(facts, { reveal: true });
    assert.doesNotMatch(pipe.stdout.text, /UXFIXTURE/, "a pipe never receives the key");
  }
  const unicodePipe = output({ env: { ...UTF8, ZCODE_KIT_UNICODE: "1" } });
  unicodePipe.out.connection(facts, { reveal: true });
  assert.ok(unicodePipe.stdout.text.includes(REDACTED_KEY), "the redaction marker is the shared one");
  const hidden = output({ tty: true, env: UTF8 });
  hidden.out.connection(facts, { reveal: false });
  assert.doesNotMatch(hidden.stdout.text, /UXFIXTURE/);
  assert.match(hidden.stdout.text, /● running, identity verified/);
});

test("renderRecords validates every record before writing anything", () => {
  const { out, stdout, stderr } = output({ env: UTF8 });
  assert.throws(() => renderRecords(out, [{ kind: "heading", title: "A" }, { kind: "box", title: "no boxes in line mode" }]), /unknown record kind "box"/);
  assert.throws(() => renderRecords(out, [{ kind: "check", status: "pass", name: "a" }, null]), /unknown record kind/);
  assert.equal(stdout.text + stderr.text, "", "a bad record list writes nothing");
  assert.throws(() => out.check({ status: "ok", name: "results are not checks" }), /check: unknown status "ok"/);
  assert.throws(() => out.result({ status: "pass", label: "checks are not results" }), /result: unknown status "pass"/);
  assert.doesNotThrow(() => renderRecords(out, undefined));
});

test("progress: motion only when animating; otherwise one start line and one result line, no carriage return", () => {
  const clock = fakeClock();
  const plain = output({ env: UTF8, clock });
  const step = plain.out.step("Install", [1, 3]);
  clock.tick(5000);
  step.done();
  assert.equal(plain.stderr.text, "[1/3] Install ...\nOK  [1/3] Install (5 s)\n");
  for (const env of [{ TERM: "dumb", LANG: "C.UTF-8" }, { ...UTF8, CI: "true" }]) {
    const c = fakeClock();
    const tty = output({ tty: true, env, clock: c });
    const s = tty.out.step("Install");
    c.tick(1000);
    s.done();
    // CI keeps colour on a TTY (CI is not in the colour precedence); only motion stops.
    assert.doesNotMatch(tty.stderr.text, /\r|\x1b\[K/, `no motion under ${JSON.stringify(env)}`);
    assert.match(tty.stderr.text, /^Install \.\.\.\n/);
  }
  const c = fakeClock();
  const anim = output({ tty: true, env: UTF8, clock: c });
  const s = anim.out.step("Install");
  c.tick(1000);
  assert.ok((anim.stderr.text.match(/\r/g) ?? []).length >= 10, "redrawn at 10 Hz");
  assert.ok((anim.stderr.text.match(/\r/g) ?? []).length <= 11, "never faster than 10 Hz");
  s.done();
  s.done();
  s.fail({ why: "late" });
  assert.match(anim.stderr.text, /\r\x1b\[K  \x1b\[32m✓ OK\x1b\[0m    Install\n$/, "the spinner line is replaced by one result row, once");
});

test("verdict(): counts carry their word; the exit code is named only when non-zero", () => {
  const { out, stdout } = output({ env: UTF8 });
  out.verdict({ fail: 2, warn: 1, pass: 9, skip: 3 }, { label: "doctor", exit: 1 });
  out.verdict({ pass: 4, warn: 2 }, { label: "doctor", exit: 0 });
  out.verdict({}, { label: "upstream" });
  assert.equal(stdout.text, "doctor: 2 failed, 1 warning, 9 passed, 3 skipped -> exit 1\ndoctor: 2 warnings, 4 passed\nupstream: nothing checked\n");
});

test("plain result rows map kit punctuation down on the ascii tier; check rows never do", () => {
  const { out, stdout } = output({ env: UTF8 });
  out.result({ status: "ok", label: "proxy started", detail: "127.0.0.1:18458" });
  out.check({ status: "pass", name: "proxy reachable", detail: "127.0.0.1:18458" });
  assert.equal(stdout.text, "OK  proxy started - 127.0.0.1:18458\nPASS  proxy reachable — 127.0.0.1:18458\n");
});
