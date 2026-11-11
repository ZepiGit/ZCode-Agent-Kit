// Seam 5, ticket 46 (UX batch c2): `accounts` (+health), `auth status` and
// `models` render through the output module. The command modules run against
// faked boundaries (spawnSync for the proxy CLI, fetch for /quota) and their
// `{ exitCode, records }` are rendered with forced capabilities in every C3
// variant (tests/snapshot-harness.mjs) and compared byte for byte with
// tests/snapshots/cli/{accounts,auth,models}/.
//
// Pinned here (spec Stories 95, 102, 114; ADR-0001 rules 1-2, ADR-0005;
// design-language §4.7 and §7):
//   - `accounts` / `accounts health`: one table per command with an active
//     marker explained in the footer, a verdict word per account, one number
//     format (thousands without separators, `69 %`), and every next step
//     names `zcode-kit …`, never `zcode-proxy …` (A-19, A-27);
//   - `auth status`: human key/value text on a TTY, today's exact JSON when
//     stdout is not a TTY, the same JSON bytes on a TTY with `--json`;
//   - `models`: the list, the key and the warning keep today's exact bytes,
//     now as output-module records (data/json) instead of plain text records;
//   - streams (ADR-0005): tables, kv blocks, the list and all JSON on stdout;
//     error blocks on stderr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createOutput, renderRecords } from "../lib/term/out.mjs";
import { C3_VARIANTS, matchSnapshot, normaliseSnapshot } from "./snapshot-harness.mjs";
import { fakeClock } from "./term-fixtures.mjs";

const ROOT = join(import.meta.dirname, "..");
const load = (name) => import(pathToFileURL(join(ROOT, "cli", "commands", `${name}.mjs`)).href);
const args = (positional, flags = {}) => ({ positional, flags, passthrough: null });

const NOW = Math.floor(Date.parse("2026-11-05T12:00:00.000Z") / 1000);

// ---------------------------------------------------------------- fixtures
// The same synthetic pool the before-captures seed (tests/ux-before/capture/
// seed-store.ts, fake-proxy.ts): work/personal/backup, GLM Coding Lite
// 4120/6000, Start Plan Bonus 35/200. No credential field ever appears.

const LIST_DOC = {
  schemaVersion: 1,
  source: "offline-config",
  asOf: "2026-11-05T12:00:00.000Z",
  accounts: [
    { id: "work", label: "Work account", provider: "zai", plan: "coding-plan", state: "active", credentialPreview: "redacted", maskedCredential: "redacted" },
    { id: "personal", label: "Personal", provider: "zai", plan: "start-plan", state: "ready", credentialPreview: "redacted", maskedCredential: "redacted" },
    { id: "backup", provider: "bigmodel", plan: "coding-plan", state: "paused", credentialPreview: "redacted", maskedCredential: "redacted" },
  ],
};

const CODE_LITE = { showName: "GLM Coding Lite", remainingUnits: 4120, totalUnits: 6000, unitType: "prompts", expiresAt: 1798761600, percentRemaining: 68.7 };
const PLAN_BONUS = { showName: "Start Plan Bonus", remainingUnits: 35, totalUnits: 200, unitType: "prompts", expiresAt: 1796083200, percentRemaining: 17.5 };
const PLAN_EMPTY = { ...PLAN_BONUS, remainingUnits: 0, percentRemaining: 0 };

const HEALTH_DOC = {
  schemaVersion: 1,
  source: "combined",
  asOf: "2026-11-05T12:00:00.000Z",
  activeAccountId: "work",
  proxy: { reachable: true, quotaAvailable: true },
  accounts: [
    { id: "work", probeSource: "live", verdict: "ok", state: "ready", paused: false, plan: "coding-plan", provider: "zai", lastUsedAt: NOW - 120, exhaustedUntil: null, balances: [CODE_LITE], errors: [] },
    { id: "personal", probeSource: "live", verdict: "exhausted", state: "exhausted", paused: false, plan: "start-plan", provider: "zai", lastUsedAt: NOW - 7200, exhaustedUntil: NOW + 3600, balances: [PLAN_EMPTY], errors: [] },
    { id: "backup", probeSource: "skipped", verdict: "paused", state: "paused", paused: true, plan: "coding-plan", provider: "bigmodel", lastUsedAt: null, exhaustedUntil: null, balances: [], errors: [] },
  ],
  summary: { usable: 1, total: 3, totals: [CODE_LITE, PLAN_BONUS] },
};

/** Proxy down: offline rows only, every verdict unknown, nothing usable (the live capture's down shape). */
const HEALTH_DOWN = {
  ...HEALTH_DOC,
  activeAccountId: null,
  proxy: { reachable: false, quotaAvailable: false },
  accounts: HEALTH_DOC.accounts.map((a) => ({ ...a, verdict: "unknown", balances: [], probeSource: "not_probed" })),
  summary: { usable: 0, total: 3, totals: [] },
};

const AUTH_RUNNING = { status: 200, json: { provider: "zai", serverTime: 1700000000000, jwt: { ageHours: 5.2, issuedAt: 1793914091 }, balances: [], errors: [] } };
const AUTH_LOGGED_OUT = { status: 200, json: { provider: "zai", serverTime: 1700000000000, balances: [], error: { code: 3012 } } };

// ------------------------------------------------------------------ ctx

/** A ctx whose proxy CLI answers `stdout` (exit `status`); records every spawn. */
function proxyCtx(t, { status = 0, stdout = "", stderr = "" } = {}) {
  const spawns = [];
  return {
    ctx: {
      kit: { root: ROOT, home: "/home/fake", proxySrc: join(ROOT, "zcode-proxy-src"), key: () => "UXFIXTURE-not-a-secret-0000000000000000000", port: () => 18458, dryRun: false },
      // resolveBun takes ZCODE_KIT_BUN when it names a native executable.
      env: { ZCODE_KIT_BUN: process.execPath },
      execPath: process.execPath,
      platform: process.platform,
      terminal: { stdin: null, stdout: { isTTY: false }, stderr: { isTTY: false } },
      spawnSync: (bin, cmdArgs, opts) => { spawns.push({ bin, cmdArgs, opts }); return { status, stdout, stderr }; },
      fetch: () => assert.fail("accounts must not fetch"),
      progress: () => assert.fail("accounts streams nothing"),
      progressError: () => assert.fail("accounts streams nothing"),
      step: () => assert.fail("accounts has no progress"),
    },
    spawns,
  };
}

/** A ctx whose fetch answers `fixture` (an http boundary for auth status); `fetchThrows` makes the proxy unreachable. */
function authCtx(t, fixture, { tty = true, fetchThrows = null } = {}) {
  const requests = [];
  return {
    ctx: {
      kit: { root: ROOT, home: "/home/fake", key: () => "UXFIXTURE-not-a-secret-0000000000000000000", port: () => 18458 },
      env: {},
      execPath: process.execPath,
      platform: process.platform,
      terminal: { stdin: null, stdout: { isTTY: tty }, stderr: { isTTY: tty } },
      spawnSync: () => assert.fail("auth status spawns nothing"),
      fetch: async (url, init) => {
        if (fetchThrows) throw new Error(fetchThrows);
        requests.push({ url, authorization: init?.headers?.authorization });
        return { status: fixture.status, json: async () => structuredClone(fixture.json) };
      },
      progress: () => assert.fail("auth status streams nothing"),
      progressError: () => assert.fail("auth status streams nothing"),
      step: () => assert.fail("auth status has no progress"),
    },
    requests,
  };
}

// ------------------------------------------------------------ rendering

/** The entry's renderer (cli/zcode-kit.mjs): text verbatim, JSON as one document, the rest through Out. */
function renderLikeEntry(variant, records, { json = false } = {}) {
  const v = C3_VARIANTS[variant];
  const mk = (tty, columns) => {
    const chunks = [];
    return { isTTY: tty, columns: tty ? columns : undefined, write(c) { chunks.push(String(c)); return true; }, text: () => chunks.join("") };
  };
  const stdout = mk(v.tty, v.columns);
  const stderr = mk(v.tty, v.columns);
  const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform, json, clock: fakeClock() });
  let batch = [];
  const flush = () => { if (batch.length) { renderRecords(out, batch); batch = []; } };
  for (const r of records) {
    if (r.kind === "text") { flush(); (r.stream === "stderr" ? stderr : stdout).write(r.text); }
    else if (r.kind === "json") { flush(); out.json(r.value); }
    else batch.push(r);
  }
  flush();
  return { stdout: stdout.text(), stderr: stderr.text() };
}

const lines = (text) => text.split("\n").slice(0, -1);

// ---------------------------------------------------------------- accounts

for (const [name, doc] of [["accounts-list", LIST_DOC], ["accounts-empty", { ...LIST_DOC, accounts: [] }]]) {
  test(`accounts ${name}: one table through Out in every C3 variant (snapshots)`, async (t) => {
    const { ctx } = proxyCtx(t, { stdout: `${JSON.stringify(doc, null, 2)}\n` });
    const { exitCode, records } = await (await load("accounts")).run(args(["accounts"]), ctx);
    assert.equal(exitCode, 0);
    for (const variant of Object.keys(C3_VARIANTS)) {
      const { stdout, stderr } = renderLikeEntry(variant, records);
      matchSnapshot(`cli/accounts/${name}/${variant}.out`, normaliseSnapshot(stdout));
      matchSnapshot(`cli/accounts/${name}/${variant}.err`, normaliseSnapshot(stderr));
    }
  });
}

test("accounts list: one aligned table, the active row marked and explained in the footer", async (t) => {
  const { ctx } = proxyCtx(t, { stdout: `${JSON.stringify(LIST_DOC, null, 2)}\n` });
  const { records } = await (await load("accounts")).run(args(["accounts"]), ctx);
  const { stdout } = renderLikeEntry("pipe", records);
  const out = lines(stdout);
  assert.ok(out.some((l) => /^ {4}ACCOUNT\b/.test(l)), `a header row: ${out[0]}`);
  assert.ok(out.some((l) => /^  \* work\b/.test(l)), `the active row carries *: ${stdout}`);
  assert.ok(out.some((l) => /^    personal\b/.test(l)), `a non-active row carries no marker: ${stdout}`);
  assert.equal(out.at(-1), "  * = active account", "the marker is explained in a footer line");
  assert.ok(stdout.includes("work      Work account  zai       coding-plan  active"), `aligned columns: ${stdout}`);
  assert.ok(!stdout.includes("credential"), "no credential column in the table (the JSON carries it)");
  assert.equal(renderLikeEntry("pipe", records).stderr, "", "the table is stdout only (ADR-0005)");
});

test("accounts empty: an INFO row and a next step that names zcode-kit (A-19)", async (t) => {
  const { ctx } = proxyCtx(t, { stdout: `${JSON.stringify({ ...LIST_DOC, accounts: [] }, null, 2)}\n` });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts"]), ctx);
  assert.equal(exitCode, 0);
  const { stdout } = renderLikeEntry("pipe", records);
  assert.match(stdout, /^INFO {2}No accounts configured\.$/m);
  assert.match(stdout, /^ {2}next: zcode-kit auth login zai --account ID$/m);
  assert.ok(!stdout.includes("zcode-proxy"), "never names the standalone binary");
});

test("accounts --json forwards the proxy CLI verbatim (spawn args, stdio, exit)", async (t) => {
  const raw = `${JSON.stringify(LIST_DOC, null, 2)}\n`;
  const { ctx, spawns } = proxyCtx(t, { stdout: raw });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts"], { json: true }), ctx);
  assert.equal(exitCode, 0);
  assert.deepEqual(records, [], "the child's stdout is forwarded, no records of our own");
  assert.deepEqual(spawns[0]?.cmdArgs, ["run", "src/index.ts", "auth", "accounts", "--json"]);
  assert.equal(spawns[0]?.opts?.stdio, "inherit");
});

test("accounts health --json forwards the proxy CLI verbatim (spawn args, stdio, exit)", async (t) => {
  const { ctx, spawns } = proxyCtx(t, { status: 1, stdout: `${JSON.stringify(HEALTH_DOC, null, 2)}\n` });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts", "health"], { json: true }), ctx);
  assert.equal(exitCode, 1, "the proxy CLI's exit code passes through");
  assert.deepEqual(records, []);
  assert.deepEqual(spawns[0]?.cmdArgs, ["run", "src/index.ts", "auth", "accounts", "health", "--json"]);
});

test("accounts health: one table, verdict words, one number format, usable in the footer (A-19, A-27)", async (t) => {
  const { ctx } = proxyCtx(t, { stdout: `${JSON.stringify(HEALTH_DOC, null, 2)}\n` });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts", "health"]), ctx);
  assert.equal(exitCode, 0);
  for (const variant of Object.keys(C3_VARIANTS)) {
    const rendered = renderLikeEntry(variant, records);
    matchSnapshot(`cli/accounts/accounts-health/${variant}.out`, normaliseSnapshot(rendered.stdout));
    matchSnapshot(`cli/accounts/accounts-health/${variant}.err`, normaliseSnapshot(rendered.stderr));
  }
  const { stdout, stderr } = renderLikeEntry("pipe", records);
  const out = lines(stdout);
  assert.equal(stderr, "", "the report is stdout only");
  assert.ok(out.some((l) => /^  \* work\b/.test(l)), `the active row carries *: ${stdout}`);
  assert.ok(out.some((l) => /^    backup\b/.test(l)), `a non-active row carries no marker: ${stdout}`);
  assert.ok(out.some((l) => /work.*\bok\b/.test(l)), "a verdict word per account");
  assert.ok(out.some((l) => /personal.*exhausted/.test(l)), "a verdict word per account");
  assert.ok(out.some((l) => /backup.*paused/.test(l)), "a verdict word per account");
  assert.ok(stdout.includes("4120/6000 (69 %)"), `thousands without separators and a spaced percent: ${stdout}`);
  assert.ok(stdout.includes("35/200 (18 %)"), `one number format across rows: ${stdout}`);
  assert.ok(!stdout.includes("4,120") && !stdout.includes("(69%)"), `no comma grouping, no unspaced percent: ${stdout}`);
  assert.ok(stdout.includes("resets 00:00"), "the reset time as local HH:MM");
  assert.ok(stdout.includes("never used"), "a row without use says so");
  assert.ok(out.some((l) => l === "  usable: 1 of 3; * = active account"), `the summary line in the footer: ${stdout}`);
  assert.ok(!stdout.includes("zcode-proxy"), "never names the standalone binary");
});

test("accounts health: proxy down keeps the table, and the error block on stderr names zcode-kit proxy start", async (t) => {
  const { ctx } = proxyCtx(t, { status: 1, stdout: `${JSON.stringify(HEALTH_DOWN, null, 2)}\n` });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts", "health"]), ctx);
  assert.equal(exitCode, 1, "nothing usable");
  for (const variant of Object.keys(C3_VARIANTS)) {
    const rendered = renderLikeEntry(variant, records);
    matchSnapshot(`cli/accounts/accounts-health-down/${variant}.out`, normaliseSnapshot(rendered.stdout));
    matchSnapshot(`cli/accounts/accounts-health-down/${variant}.err`, normaliseSnapshot(rendered.stderr));
  }
  const { stdout, stderr } = renderLikeEntry("pipe", records);
  const out = lines(stdout);
  assert.ok(out.some((l) => /^ {2}work\b/.test(l)), `offline rows stay visible: ${stdout}`);
  assert.ok(out.some((l) => /unknown/.test(l)), "offline verdicts are unknown, never a guess");
  assert.ok(out.some((l) => l === "  usable: 0 of 3"), `the summary without an active marker: ${stdout}`);
  assert.match(stderr, /^FAIL {2}live data unavailable$/m, "the what");
  assert.match(stderr, /^ {2}why: \S/m, "the why");
  assert.match(stderr, /^ {2}next: zcode-kit proxy start$/m, "the exact next command");
  assert.ok(!stderr.includes("zcode-proxy"));
});

test("accounts health: every next line names zcode-kit, never zcode-proxy (A-19)", async (t) => {
  const accounts = await load("accounts");
  for (const doc of [HEALTH_DOC, HEALTH_DOWN]) {
    const { ctx } = proxyCtx(t, { stdout: `${JSON.stringify(doc, null, 2)}\n` });
    const { records } = await accounts.run(args(["accounts", "health"]), ctx);
    const rendered = renderLikeEntry("pipe", records);
    for (const text of [rendered.stdout, rendered.stderr]) {
      for (const line of lines(text)) {
        const next = line.match(/^\s+next: (\S.*)$/);
        if (next) assert.match(next[1], /^zcode-kit /, `${line}`);
        assert.ok(!/\bzcode-proxy\b/.test(line), `${line}`);
      }
    }
  }
});

test("accounts: a proxy CLI that prints no JSON is an error block with a next step (Story 95)", async (t) => {
  const { ctx } = proxyCtx(t, { status: 2, stdout: "", stderr: "" });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts"]), ctx);
  assert.equal(exitCode, 2, "the proxy CLI's exit code passes through");
  const { stderr } = renderLikeEntry("pipe", records);
  assert.match(stderr, /^FAIL {2}/m, "a what");
  assert.match(stderr, /^ {2}why: \S/m, "a why");
  assert.match(stderr, /^ {2}next: zcode-kit \S/m, "a next");
});

test("accounts health: an unreadable health report is an error block with a next step (Story 95)", async (t) => {
  const { ctx } = proxyCtx(t, { status: 1, stdout: "not json at all\n" });
  const { exitCode, records } = await (await load("accounts")).run(args(["accounts", "health"]), ctx);
  assert.equal(exitCode, 1);
  const { stderr } = renderLikeEntry("pipe", records);
  assert.match(stderr, /^FAIL {2}/m);
  assert.match(stderr, /^ {2}why: \S/m);
  assert.match(stderr, /^ {2}next: zcode-kit \S/m);
});

// ------------------------------------------------------------- auth status

const AUTH_JSON_RUNNING = `${JSON.stringify({ logged_in: true, errors: [], jwt: { ageHours: 5.2, issuedAt: 1793914091 } }, null, 2)}\n`;
const AUTH_JSON_DOWN = `{\n  "logged_in": false,\n  "error": "fetch failed"\n}\n`;
const AUTH_DETAIL = "ZCode auth3012: not logged in. Refresh the Desktop login, then use zcode-kit auth login if still needed; no repeated retries.";
const AUTH_JSON_LOGGED_OUT = `${JSON.stringify({ logged_in: false, errors: [AUTH_DETAIL], jwt: null }, null, 2)}\n`;

test("auth status piped: byte-identical to the pre-change JSON", async (t) => {
  const { ctx, requests } = authCtx(t, AUTH_RUNNING, { tty: false });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"]), ctx);
  assert.equal(exitCode, 0);
  assert.equal(renderLikeEntry("pipe", records).stdout, AUTH_JSON_RUNNING, "the exact pre-change bytes");
  assert.equal(renderLikeEntry("ci", records).stdout, AUTH_JSON_RUNNING);
  assert.equal(renderLikeEntry("term-dumb", records).stdout, AUTH_JSON_RUNNING);
  assert.deepEqual(requests.map((r) => r.authorization), ["Bearer UXFIXTURE-not-a-secret-0000000000000000000"]);
});

test("auth status --json on a TTY: the same bytes as the piped output", async (t) => {
  const { ctx } = authCtx(t, AUTH_RUNNING, { tty: true });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"], { json: true }), ctx);
  assert.equal(exitCode, 0);
  const rendered = renderLikeEntry("tty-color-80", records);
  assert.equal(rendered.stdout, AUTH_JSON_RUNNING, "identical JSON on a TTY");
  assert.ok(!rendered.stdout.includes("\x1b["), "no escape sequence inside the JSON document");
});

test("auth status on a TTY: a human key/value block, not JSON", async (t) => {
  const { ctx } = authCtx(t, AUTH_RUNNING, { tty: true });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"]), ctx);
  assert.equal(exitCode, 0);
  for (const variant of Object.keys(C3_VARIANTS)) {
    const { stdout, stderr } = renderLikeEntry(variant, records);
    matchSnapshot(`cli/auth/auth-status-running/${variant}.out`, normaliseSnapshot(stdout));
    matchSnapshot(`cli/auth/auth-status-running/${variant}.err`, normaliseSnapshot(stderr));
  }
  const { stdout } = renderLikeEntry("tty-color-80", records);
  const text = stdout.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(!stdout.includes("{"), "no JSON document on a TTY");
  assert.match(text, /Logged in\s+yes/, `the key/value block: ${stdout}`);
  assert.match(text, /Token\s+5\.2 h old/, `the token age: ${stdout}`);
  assert.equal(renderLikeEntry("pipe", records).stderr, "", "the report is stdout only");
});

test("auth status down piped: byte-identical JSON, exit 1", async (t) => {
  // The down shape is a rejected fetch (the proxy did not answer).
  const down = authCtx(t, { status: 0, json: null }, { tty: false, fetchThrows: "fetch failed" });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"]), down.ctx);
  assert.equal(exitCode, 1);
  assert.equal(renderLikeEntry("pipe", records).stdout, AUTH_JSON_DOWN, "the exact pre-change bytes");
  assert.equal(renderLikeEntry("ci", records).stdout, AUTH_JSON_DOWN);
});

test("auth status down on a TTY: the failure says what, why and the exact next command", async (t) => {
  const down = authCtx(t, { status: 0, json: null }, { tty: true, fetchThrows: "fetch failed" });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"]), down.ctx);
  assert.equal(exitCode, 1);
  for (const variant of Object.keys(C3_VARIANTS)) {
    const { stdout, stderr } = renderLikeEntry(variant, records);
    matchSnapshot(`cli/auth/auth-status-down/${variant}.out`, normaliseSnapshot(stdout));
    matchSnapshot(`cli/auth/auth-status-down/${variant}.err`, normaliseSnapshot(stderr));
  }
  const { stdout, stderr } = renderLikeEntry("pipe", records);
  assert.match(stdout, /Logged in\s+no/, `the key/value block: ${stdout}`);
  assert.match(stderr, /^FAIL {2}the proxy did not answer$/m, "the what");
  assert.match(stderr, /^ {2}why: fetch failed$/m, "the why");
  assert.match(stderr, /^ {2}next: zcode-kit proxy start$/m, "the exact next command");
});

test("auth status logged out piped: byte-identical JSON with today's diagnostic, exit 0", async (t) => {
  const { ctx } = authCtx(t, AUTH_LOGGED_OUT, { tty: false });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"]), ctx);
  assert.equal(exitCode, 0, "a proxy that answers is exit 0, logged in or not");
  assert.equal(renderLikeEntry("pipe", records).stdout, AUTH_JSON_LOGGED_OUT, "the exact pre-change bytes");
});

test("auth status logged out on a TTY: a WARN block with the kit's login command", async (t) => {
  const { ctx } = authCtx(t, AUTH_LOGGED_OUT, { tty: true });
  const { exitCode, records } = await (await load("auth")).run(args(["auth", "status"]), ctx);
  assert.equal(exitCode, 0);
  for (const variant of Object.keys(C3_VARIANTS)) {
    const { stdout, stderr } = renderLikeEntry(variant, records);
    matchSnapshot(`cli/auth/auth-status-logged-out/${variant}.out`, normaliseSnapshot(stdout));
    matchSnapshot(`cli/auth/auth-status-logged-out/${variant}.err`, normaliseSnapshot(stderr));
  }
  const { stdout, stderr } = renderLikeEntry("pipe", records);
  assert.match(stdout, /Logged in\s+no/, `the key/value block: ${stdout}`);
  assert.match(stderr, /^WARN {2}not logged in$/m, "the what");
  assert.match(stderr, /^ {2}why: ZCode auth3012/m, "the why is today's diagnostic");
  assert.match(stderr, /^ {2}next: zcode-kit auth login zai$/m, "the exact next command");
});

// ------------------------------------------------------------------ models

const LIST_BYTES = "glm-5.3\nglm-5.2\n";

function modelsCtx(t, { key = "UXFIXTURE-not-a-secret-0000000000000000000" } = {}) {
  const requests = [];
  return {
    ctx: {
      kit: { root: ROOT, home: "/home/fake", key: () => key, port: () => 18458 },
      env: {},
      execPath: process.execPath,
      platform: process.platform,
      terminal: { stdin: null, stdout: { isTTY: false }, stderr: { isTTY: false } },
      spawnSync: () => assert.fail("models spawns nothing"),
      fetch: async (url, init) => {
        requests.push({ url, authorization: init?.headers?.authorization });
        return { ok: true, status: 200, json: async () => ({ object: "list", data: [{ id: "glm-5.3" }, { id: "glm-5.2" }] }) };
      },
      progress: () => assert.fail("models streams nothing"),
      progressError: () => assert.fail("models streams nothing"),
      step: () => assert.fail("models has no progress"),
    },
    requests,
  };
}

test("models: the list through Out data records, today's exact bytes (snapshots)", async (t) => {
  const { ctx, requests } = modelsCtx(t);
  const { exitCode, records } = await (await load("models")).run(args(["models"]), ctx);
  assert.equal(exitCode, 0);
  assert.deepEqual(records.map((r) => r.kind), ["data"], "the list is a data record, not a plain text record");
  assert.equal(renderLikeEntry("pipe", records).stdout, LIST_BYTES, "the bytes are unchanged");
  for (const variant of Object.keys(C3_VARIANTS)) {
    const { stdout, stderr } = renderLikeEntry(variant, records);
    matchSnapshot(`cli/models/models-running/${variant}.out`, normaliseSnapshot(stdout));
    matchSnapshot(`cli/models/models-running/${variant}.err`, normaliseSnapshot(stderr));
  }
  assert.deepEqual(requests.map((r) => r.authorization), ["Bearer UXFIXTURE-not-a-secret-0000000000000000000"]);
});

test("models --json: the same document bytes, through Out json records", async (t) => {
  const { ctx } = modelsCtx(t);
  const { exitCode, records } = await (await load("models")).run(args(["models"], { json: true }), ctx);
  assert.equal(exitCode, 0);
  assert.deepEqual(records, [{ kind: "json", value: { models: ["glm-5.3", "glm-5.2"], source: "proxy" } }]);
  assert.equal(renderLikeEntry("pipe", records).stdout, `${JSON.stringify({ models: ["glm-5.3", "glm-5.2"], source: "proxy" }, null, 2)}\n`);
});

test("models --show-key: the warning on stderr, the key alone on stdout, bytes unchanged (snapshots)", async (t) => {
  const { ctx } = modelsCtx(t);
  const { exitCode, records } = await (await load("models")).run(args(["models"], { "show-key": true }), ctx);
  assert.equal(exitCode, 0);
  assert.deepEqual(records.map((r) => [r.kind, r.stream ?? ""]), [["data", ""], ["text", "stderr"], ["data", ""]]);
  const rendered = renderLikeEntry("pipe", records);
  assert.equal(rendered.stdout, `${LIST_BYTES}UXFIXTURE-not-a-secret-0000000000000000000\n`, "list, then key");
  assert.equal(rendered.stderr, "\nlocal proxy key (never share; shown because --show-key was given):\n", "the warning verbatim");
  for (const variant of Object.keys(C3_VARIANTS)) {
    const rendered2 = renderLikeEntry(variant, records);
    matchSnapshot(`cli/models/models-show-key/${variant}.out`, normaliseSnapshot(rendered2.stdout));
    matchSnapshot(`cli/models/models-show-key/${variant}.err`, normaliseSnapshot(rendered2.stderr));
  }
});

test("models: a down proxy keeps today's registry snapshot bytes, exit 0 (snapshots)", async (t) => {
  const { ctx } = modelsCtx(t);
  ctx.fetch = async () => { throw new Error("fetch failed"); };
  const { exitCode, records } = await (await load("models")).run(args(["models"]), ctx);
  assert.equal(exitCode, 0);
  assert.equal(renderLikeEntry("pipe", records).stdout, "glm-5.3\nglm-5.3-flash\n");
  for (const variant of Object.keys(C3_VARIANTS)) {
    const { stdout, stderr } = renderLikeEntry(variant, records);
    matchSnapshot(`cli/models/models-json-down/${variant}.out`, normaliseSnapshot(stdout));
    matchSnapshot(`cli/models/models-json-down/${variant}.err`, normaliseSnapshot(stderr));
  }
});
