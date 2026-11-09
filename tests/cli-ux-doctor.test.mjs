// Seam 5, ticket 40 (UX batch a): `zcode-kit doctor` renders through the
// output module. The command module runs against a temp kit whose manager
// doctor (lib/proxy-doctor.mjs) is faked at its boundary with a check record,
// as tests/cli-commands.test.mjs does; its `{ exitCode, records }` are rendered
// with forced capabilities in every C3 variant (tests/snapshot-harness.mjs)
// and compared byte for byte with tests/snapshots/cli/doctor/.
//
// Pinned here (spec Stories 90-92, ADR-0001 rules 1 and 3, Round 1 Q10):
//   - each check appears once, one verdict line, a problem-count lead line
//     only when something failed (A-02);
//   - off a TTY every row matches `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$`
//     with today's names, followed only by whitespace-indented why:/next: lines;
//   - WARN never changes the exit code, and a check that FAILs is never WARN;
//   - every FAIL carries why and next;
//   - `--json` keeps today's keys and adds `warned` and a per-check `status`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderRecords } from "../lib/term/out.mjs";
import { C3_VARIANTS, SNAPSHOT_ROOT, matchSnapshot, normaliseSnapshot, renderVariant } from "./snapshot-harness.mjs";

const ROOT = join(import.meta.dirname, "..");
const load = (name) => import(pathToFileURL(join(ROOT, "cli", "commands", `${name}.mjs`)).href);
const args = (positional, flags = {}) => ({ positional, flags, passthrough: null });

/** A temp kit (no stored decisions, an empty home) whose manager doctor returns `record`. */
async function doctorKit(t, record) {
  const { createCtx } = await import(pathToFileURL(join(ROOT, "cli", "context.mjs")).href);
  const root = mkdtempSync(join(tmpdir(), "cli-ux-doctor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  mkdirSync(home);
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib", "proxy-doctor.mjs"), `export async function managerDoctor() { return ${JSON.stringify(record)}; }\n`);
  const kit = { ...createCtx(root, home), stateDir: root, generated: join(root, "generated"), backupDir: join(root, "backups") };
  return {
    kit,
    env: {},
    execPath: process.execPath,
    spawnSync: () => assert.fail("doctor without --fix spawns nothing"),
    fetch: () => Promise.reject(new Error("no network in this test")),
    progress: () => assert.fail("doctor without --fix streams nothing"),
    progressError: () => assert.fail("doctor without --fix streams nothing"),
    step: () => assert.fail("doctor without --fix has no progress"),
  };
}

const managerRecord = (checks) => {
  const failed = checks.some((c) => c.ok === false);
  return { intent: "doctor", code: failed ? 1 : 0, outcome: failed ? "failed" : "ok", checks };
};

/** Render `records` in one C3 variant (consecutive Out records as one list, so check groups align). */
function renderIn(variant, records) {
  return renderVariant(variant, (out) => {
    let batch = [];
    const flush = () => { if (batch.length) renderRecords(out, batch); batch = []; };
    for (const r of records) {
      if (r.kind === "text") { flush(); out.data(r.text.replace(/\n$/, "")); } else batch.push(r);
    }
    flush();
  });
}

// Manager check records shaped like the five manager-doctor fixture states
// (tests/manager-doctor.test.mjs), with synthetic paths.
const FIXTURES = {
  "fresh": [
    { name: "bun available", ok: true, detail: "/opt/bun/bin/bun (1.4.2)" },
    { name: "config exists", ok: false, detail: "/kit/proxy/config.yaml" },
    { name: "key file exists", ok: false, detail: "/kit/.proxykey" },
    { name: "proxy source installed", ok: false, detail: "/kit/zcode-proxy-src/node_modules" },
    { name: "credentials store", ok: false, detail: "~/.zcode-proxy/credentials.json: no credential store — run: zcode-kit auth login" },
    { name: "omp integration", ok: null, detail: "OMP not installed — skipped" },
    { name: "proxy reachable + identity", ok: null, detail: "no config — skipped" },
  ],
  "proxy-down": [
    { name: "bun available", ok: true, detail: "/opt/bun/bin/bun (1.4.2)" },
    { name: "config exists", ok: true, detail: "/kit/proxy/config.yaml" },
    { name: "key file exists", ok: true, detail: "/kit/.proxykey" },
    { name: "proxy source installed", ok: true, detail: "/kit/zcode-proxy-src/node_modules" },
    { name: "proxy env overrides", ok: false, detail: "ignored by the kit-managed proxy (unset them): ZCODE_PROXY_PORT" },
    { name: "credentials store", ok: true, detail: "~/.zcode-proxy/credentials.json: present and decryptable on this machine" },
    { name: "omp provider registered", ok: true, detail: "zcode block in ~/.omp/agent/models.yml" },
    { name: "extension installed", ok: true, detail: "~/.omp/agent/extensions/zcode-proxy-autostart.ts" },
    { name: "mcp bridge installed", ok: true, detail: "/kit/mcp/zcode-harness-mcp/dist/index.js" },
    { name: "mcp bridge deps", ok: true, detail: "/kit/mcp/zcode-harness-mcp/node_modules" },
    { name: "codex adapter artifact", ok: true, detail: "generated/codex-home/config.toml" },
    { name: "proxy reachable + identity", ok: false, detail: "health=down" },
  ],
  "proxy-running": [
    { name: "bun available", ok: true, detail: "/opt/bun/bin/bun (1.4.2)" },
    { name: "config exists", ok: true, detail: "/kit/proxy/config.yaml" },
    { name: "key file exists", ok: true, detail: "/kit/.proxykey" },
    { name: "proxy source installed", ok: true, detail: "/kit/zcode-proxy-src/node_modules" },
    { name: "credentials store", ok: true, detail: "~/.zcode-proxy/credentials.json: present and decryptable on this machine" },
    { name: "omp integration", ok: null, detail: "OMP not installed — skipped" },
    { name: "proxy reachable + identity", ok: true, detail: "health=ours" },
    { name: "account auth valid", ok: true, detail: "valid" },
    { name: "start-plan JWT age (info)", ok: true, detail: "5.0h since issue — age is informational, validity is the auth check above" },
  ],
  "foreign-no-bun": [
    { name: "bun available", ok: false, detail: "Bun native executable not found; install Bun or set ZCODE_KIT_BUN to its executable path" },
    { name: "config exists", ok: true, detail: "/kit/proxy/config.yaml" },
    { name: "key file exists", ok: true, detail: "/kit/.proxykey" },
    { name: "proxy source installed", ok: true, detail: "/kit/zcode-proxy-src/node_modules" },
    { name: "credentials store", ok: false, detail: "~/.zcode-proxy/credentials.json: no credential store — run: zcode-kit auth login" },
    { name: "omp integration", ok: null, detail: "not configured (no consent yet) — answer y in zcode-kit setup or run zcode-kit integrate omp" },
    { name: "proxy reachable + identity", ok: false, detail: "health=foreign" },
  ],
  // WARN: a passing check that needs attention, with its own why/next; a
  // failing check that also says warn stays FAIL; a skipped one stays SKIP.
  "warn": [
    { name: "bun available", ok: true, detail: "/opt/bun/bin/bun (1.4.2)" },
    { name: "proxy reachable + identity", ok: true, detail: "health=ours" },
    { name: "solver memory", ok: true, warn: true, detail: "fail-fast since 10:02 (2 abnormal exits in 15 min)", why: "the solver was killed at its cap twice", next: ["zcode-kit proxy logs 50", "zcode-kit proxy restart"] },
    { name: "restart budget", ok: false, warn: true, detail: "3 of 3 restarts used in 15 min" },
    { name: "cap enforcement", ok: null, warn: true, detail: "not applicable here" },
  ],
};

const CHECK_ROW = /^(PASS|FAIL|SKIP|WARN)  (.+?)( — (.+))?$/;
const CONTINUATION = /^\s+(why|next): \S/;
const PLAIN = ["pipe", "ci", "term-dumb"];

/** The lines of a plain doctor report, classified; throws on a line that fits nothing. */
function classify(text) {
  const out = { lead: [], headings: [], rows: [], continuations: [], verdicts: [], blank: 0 };
  for (const line of text.split("\n").slice(0, -1)) {
    if (line === "") out.blank++;
    else if (CHECK_ROW.test(line)) out.rows.push(line);
    else if (CONTINUATION.test(line)) out.continuations.push(line);
    else if (/^doctor: /.test(line)) out.verdicts.push(line);
    else if (/^\d+ problems?: \d+ failed(, \d+ warnings?)?$/.test(line)) out.lead.push(line);
    else if (/^(Runtime|Proxy|Account|Integrations|Upstream) -+$/.test(line)) out.headings.push(line);
    else assert.fail(`a doctor line that fits no part of the grammar: ${JSON.stringify(line)}`);
  }
  return out;
}

for (const [fixture, checks] of Object.entries(FIXTURES)) {
  test(`doctor, ${fixture}: the report in every C3 variant (snapshots)`, async (t) => {
    const ctx = await doctorKit(t, managerRecord(checks));
    const { exitCode, records } = await (await load("doctor")).run(args(["doctor"]), ctx);
    assert.equal(exitCode, checks.some((c) => c.ok === false) ? 1 : 0);
    for (const variant of Object.keys(C3_VARIANTS)) {
      const { stdout, stderr } = renderIn(variant, records);
      matchSnapshot(`cli/doctor/${fixture}/${variant}.out`, normaliseSnapshot(stdout));
      matchSnapshot(`cli/doctor/${fixture}/${variant}.err`, normaliseSnapshot(stderr));
    }
  });

  test(`doctor, ${fixture}: off a TTY each check is one grammar row, once, with one verdict and a lead only on failure`, async (t) => {
    const ctx = await doctorKit(t, managerRecord(checks));
    const { exitCode, records } = await (await load("doctor")).run(args(["doctor"]), ctx);
    for (const variant of PLAIN) {
      const { stdout, stderr } = renderIn(variant, records);
      assert.equal(stderr, "", `${variant}: the report is stdout only`);
      const lines = classify(stdout);
      // The manager's checks plus one SKIP row per harness (none detected in the temp kit).
      assert.equal(lines.rows.length, checks.length + 10, `${variant}: one row per check`);
      for (const c of checks) {
        const named = lines.rows.filter((row) => row.match(CHECK_ROW)[2] === c.name);
        assert.equal(named.length, 1, `${variant}: ${c.name} appears once`);
        assert.equal(named[0], `${{ true: c.warn === true ? "WARN" : "PASS", false: "FAIL", null: "SKIP" }[String(c.ok)]}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
      }
      assert.equal(lines.verdicts.length, 1, `${variant}: one verdict line`);
      assert.equal(stdout.trimEnd().split("\n").at(-1), lines.verdicts[0], "the verdict is the last line");
      const failed = checks.filter((c) => c.ok === false).length;
      assert.deepEqual(lines.lead, failed ? [stdout.split("\n")[0]] : [], `${variant}: the lead line opens the report only when something failed`);
      assert.match(lines.verdicts[0], exitCode ? new RegExp(`^doctor: ${failed} failed, .* -> exit 1$`) : /^doctor: (?!.*failed)(?!.*exit).*$/);
    }
  });

  test(`doctor, ${fixture}: every FAIL row carries why and next lines`, async (t) => {
    const ctx = await doctorKit(t, managerRecord(checks));
    const { records } = await (await load("doctor")).run(args(["doctor"]), ctx);
    const lines = renderIn("pipe", records).stdout.split("\n");
    lines.forEach((line, i) => {
      if (!/^FAIL  /.test(line)) return;
      const tail = [];
      for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) tail.push(lines[j]);
      assert.match(tail[0] ?? "", /^  why: \S/, `${line}: why`);
      assert.ok(tail.some((l) => /^  next: \S/.test(l)), `${line}: next`);
    });
  });
}

test("doctor: WARN never changes the exit code, and a check that fails is never WARN (fixture matrix)", async (t) => {
  const doctor = await load("doctor");
  for (const ok of [true, false, null]) {
    for (const warn of [undefined, false, true]) {
      const check = { name: "matrix check", ok, detail: "d", ...(warn === undefined ? {} : { warn }) };
      const ctx = await doctorKit(t, managerRecord([check]));
      const text = await doctor.run(args(["doctor"]), ctx);
      const json = await doctor.run(args(["doctor"], { json: true }), ctx);
      const expected = ok === false ? "FAIL" : ok === null ? "SKIP" : warn === true ? "WARN" : "PASS";
      assert.equal(text.exitCode, ok === false ? 1 : 0, `ok=${ok} warn=${warn}: exit code`);
      assert.equal(json.exitCode, text.exitCode, "JSON and text agree");
      const pipe = renderIn("pipe", text.records).stdout;
      const rows = pipe.split("\n").filter((l) => l.match(CHECK_ROW)?.[2] === "matrix check");
      assert.deepEqual(rows, [`${expected}  matrix check — d`], `ok=${ok} warn=${warn}`);
      const verdict = pipe.trimEnd().split("\n").at(-1);
      assert.equal(/ -> exit 1$/.test(verdict), ok === false, `ok=${ok} warn=${warn}: the verdict names exit 1 only for a failure: ${verdict}`);
      const doc = json.records[0].value;
      const row = doc.checks.find((c) => c.name === "matrix check");
      assert.equal(row.status, expected.toLowerCase());
      assert.equal(row.ok, ok, "ok keeps today's value");
      assert.equal(doc.failed, ok === false ? 1 : 0);
      assert.equal(doc.warned, expected === "WARN" ? 1 : 0);
    }
  }
});

test("doctor --json: today's keys and values, plus warned and a status per check (superset)", async (t) => {
  const ctx = await doctorKit(t, managerRecord(FIXTURES["proxy-down"]));
  const { exitCode, records } = await (await load("doctor")).run(args(["doctor"], { json: true }), ctx);
  assert.equal(exitCode, 1);
  assert.equal(records.length, 1);
  const doc = records[0].value;
  assert.deepEqual(Object.keys(doc), ["ok", "failed", "skipped", "warned", "checks"]);
  assert.deepEqual([doc.ok, doc.failed, doc.skipped, doc.warned], [false, 2, 10, 0]);
  assert.deepEqual(doc.checks.slice(0, 2), [
    { name: "bun available", ok: true, detail: "/opt/bun/bin/bun (1.4.2)", status: "pass" },
    { name: "config exists", ok: true, detail: "/kit/proxy/config.yaml", status: "pass" },
  ]);
  assert.deepEqual(doc.checks.find((c) => c.name === "proxy reachable + identity"), { name: "proxy reachable + identity", ok: false, detail: "health=down", status: "fail" });
  assert.deepEqual(doc.checks.find((c) => c.name === "pi: integration"), { name: "pi: integration", ok: null, detail: "not detected — skipped", status: "skip" });
});

// The spawned `zcode-kit doctor` outputs of tests/manager-doctor.test.mjs
// (five real fixture states, compared there byte for byte with these
// snapshots on every run): the same grammar holds for each of them.
test("the spawned zcode-kit doctor reports (manager-doctor fixtures) keep the off-TTY grammar", () => {
  const dir = join(SNAPSHOT_ROOT, "manager-doctor", "kit-doctor-text");
  const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  assert.equal(files.length, 5);
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8").replace(/\[exit \d+\]\n(\[stderr\]\n[\s\S]*)?$/, "");
    const lines = classify(text);
    assert.equal(lines.verdicts.length, 1, file);
    assert.equal(new Set(lines.rows.map((r) => r.match(CHECK_ROW)[2])).size, lines.rows.length, `${file}: every check once`);
  }
});
