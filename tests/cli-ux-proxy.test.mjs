// Seam 5, ticket 40 (UX batch a): `status`, `proxy status|start|stop|restart|logs`
// render through the output module. Each command module runs against a temp
// kit whose lifecycle (lib/proxy-lifecycle.mjs) and status record
// (lib/proxy-status.mjs) are faked at their boundary with fixture records;
// its progress (`ctx.step`) and its `{ exitCode, records }` are rendered with
// forced capabilities in every C3 variant and compared byte for byte with
// tests/snapshots/cli/{status,proxy}/.
//
// Pinned here (spec Stories 93, 95, 105; A-09, A-12, A-17, A-23):
//   - the status starts with a state line in human units; the connection
//     details appear once, unboxed, within 80 columns, routes only with
//     --verbose; the key only on an interactive terminal outside CI;
//   - reports on stdout, progress, results and error blocks (what/why/next)
//     on stderr; exit codes are the lifecycle's (0-5) and the status's (0/1);
//   - `--json` is the status document, unchanged;
//   - `proxy logs` prints raw lines on stdout, with the additive --level and
//     --grep filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderRecords } from "../lib/term/out.mjs";
import { displayWidth, stripAnsi } from "../lib/term/width.mjs";
import { C3_VARIANTS, matchSnapshot, normaliseSnapshot, renderVariantAsync } from "./snapshot-harness.mjs";

const ROOT = join(import.meta.dirname, "..");
const load = (name) => import(pathToFileURL(join(ROOT, "cli", "commands", `${name}.mjs`)).href);
const args = (positional, flags = {}) => ({ positional, flags, passthrough: null });
const KEY = "UXFIXTURE-not-a-secret-0000000000000000000";
const real = (rel) => JSON.stringify(pathToFileURL(join(ROOT, rel)).href);

// The fake boundary: one lifecycle and one status module per temp kit, both
// driven by the kit's fixture.json.
const FAKE_LIFECYCLE = `
import { readFileSync } from "node:fs";
const f = JSON.parse(readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
export function createLifecycle(opts) {
  (globalThis.__cliUxLifecycle ??= []).push(opts);
  const stops = [...(f.stops ?? [])];
  return {
    KEY_FILE: "/kit/.proxykey", CONFIG: "/kit/proxy/config.yaml", LOG_FILE: f.logFile ?? "/kit/logs/proxy.log",
    loadPort: () => { if (f.port === null) throw new Error("config not found: /kit/proxy/config.yaml — run setup first: zcode-kit setup"); return f.port ?? 18458; },
    readKey: () => { if (f.keyMissing) throw new Error("ENOENT .proxykey"); return ${JSON.stringify(KEY)}; },
    readPidFile: () => f.pidRecord ?? null,
    healthIdentify: async () => f.reproof ?? "ours",
    redact: (text) => text.split(${JSON.stringify(KEY)}).join("<redacted>"),
    ensureRunning: async () => { if (f.startThrows) throw new Error(f.startThrows); return f.start; },
    stop: async (opts = {}) => {
      if (f.stopThrows) throw new Error(f.stopThrows);
      const record = stops.shift() ?? f.stop;
      // The real intent forwards every step to observe: the stop request's
      // event lines (ticket 14) and its narration lines alike.
      for (const line of (f.stopEvents ?? [])) opts?.observe?.(line);
      for (const line of (record.lines ?? [])) opts?.observe?.(line);
      return record;
    },
  };
}
`;
const FAKE_STATUS = `
import { readFileSync } from "node:fs";
export { statusDocument, statusExitCode } from ${real("lib/proxy-status.mjs")};
const f = JSON.parse(readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
export async function readProxyStatus() { return f.status; }
export async function readConnectionFacts({ source }) {
  if (f.factsError) throw new Error(f.factsError);
  return { port: 18458, models: ["glm-5.3", "glm-5.3-flash"], modelsSource: source === "running" ? "live" : "config", source, host: "127.0.0.1", responsesEnabled: true };
}
`;

function fakeKit(t, fixture) {
  const root = mkdtempSync(join(tmpdir(), "cli-ux-proxy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "lib"));
  mkdirSync(join(root, "home"));
  writeFileSync(join(root, "fixture.json"), JSON.stringify(fixture));
  writeFileSync(join(root, "lib", "proxy-lifecycle.mjs"), FAKE_LIFECYCLE);
  writeFileSync(join(root, "lib", "proxy-status.mjs"), FAKE_STATUS);
  writeFileSync(join(root, "lib", "proxy-logs.mjs"), `export * from ${real("lib/proxy-logs.mjs")};\n`);
  return root;
}

/** Run a command against the fake kit in one C3 variant: its progress and its records, rendered. */
async function runIn(t, variant, fixture, name, positional, flags = {}, { stdinTTY = true, env = {} } = {}) {
  const root = fakeKit(t, fixture);
  let result;
  const rendered = await renderVariantAsync(variant, async (out) => {
    const ctx = {
      kit: { root, home: join(root, "home") },
      env,
      execPath: process.execPath,
      terminal: { stdin: { isTTY: stdinTTY }, stdout: { isTTY: out.caps.out.tty }, stderr: { isTTY: out.caps.err.tty } },
      spawnSync: () => assert.fail("the proxy commands spawn no manager"),
      fetch: () => Promise.reject(new Error("no network in this test")),
      progress: () => assert.fail("no stdout progress"),
      progressError: () => assert.fail("progress goes through ctx.step"),
      step: async (label, total) => out.step(label, total),
    };
    result = await (await load(name)).run(args(positional, flags), ctx);
    assert.deepEqual(result.records.filter((r) => r.kind === "text"), [], "no verbatim text: every record goes through the output module");
    renderRecords(out, result.records);
  });
  return { ...rendered, exitCode: result.exitCode, records: result.records };
}

// --------------------------------------------------------------- fixtures
const DETAILS = {
  pid: 4242, uptimeSec: 3725, rssMB: 182, heapUsedMB: 64, eventLoopLagMs: 2,
  captcha: { ready: 2, target: 2, activeSolves: 0, storm: false, mintSuccessRate10m: 0.96,
    solver: { generation: 3, recycles: 2, lastRecycleReason: "rss-budget", lastRecycleAt: 1762423872000, totalSolves: 118, totalFailures: 3, busy: false } },
};
const QUOTA = { ok: true, status: 200, bodyError: null, body: { balances: [
  { showName: "GLM Coding Lite", remainingUnits: 4120, totalUnits: 6000, unitType: "prompts", expiresAt: 1767139200 },
  { showName: "Start Plan Bonus", remainingUnits: 35, totalUnits: 200, unitType: "prompts", expiresAt: 1764460800 },
] } };
const FACTS = { port: 18458, models: ["glm-5.3", "glm-5.3-flash"], modelsSource: "live", source: "running", host: "127.0.0.1", responsesEnabled: true };
const PID_RECORD = { pid: 4242, startedMs: 1762420147000, startedIso: "2026-11-06T09:09:07.000Z" };
const status = (over) => ({ identity: "ours", pidRecord: PID_RECORD, alive: true, port: 18458, portError: null, keyFile: "/kit/.proxykey", details: DETAILS, quota: QUOTA, connection: { source: "running", facts: FACTS, error: null }, ...over });

const STATUS_FIXTURES = {
  "running": status({}),
  // CJK data (C3): a package name in Chinese aligns by display width.
  "running-cjk-quota": status({ quota: { ok: true, status: 200, bodyError: null, body: { balances: [
    { showName: "GLM 编程套餐", remainingUnits: 4120, totalUnits: 6000, unitType: "prompts", expiresAt: 1767139200 },
    { showName: "Start Plan Bonus", remainingUnits: 35, totalUnits: 200, unitType: "prompts", expiresAt: 1764460800 },
  ] } } }),
  "running-old-proxy": status({ details: null, quota: { fetchError: "The operation was aborted due to timeout" }, connection: { source: "running", facts: { ...FACTS, modelsSource: "config" }, error: null } }),
  "running-captcha-unloaded": status({ details: { ...DETAILS, captcha: null }, quota: { ok: false, status: 503, body: null, bodyError: null } }),
  "down": status({ identity: "down", pidRecord: null, alive: false, details: null, quota: null, connection: { source: "configured", facts: { ...FACTS, source: "configured", modelsSource: "config" }, error: null } }),
  "down-not-answering": status({ identity: "down", alive: true, details: null, quota: null, connection: { source: "configured", facts: { ...FACTS, source: "configured", modelsSource: "config" }, error: null } }),
  "down-no-config": status({ identity: "down", pidRecord: null, alive: false, port: null, portError: "config not found", details: null, quota: null, connection: { source: "configured", facts: null, error: "config not found: /kit/proxy/config.yaml — run setup first: zcode-kit setup" } }),
  "foreign": status({ identity: "foreign", pidRecord: null, alive: false, details: null, quota: null, connection: null }),
  "no-key": status({ identity: "nokey", pidRecord: null, alive: false, port: null, details: null, quota: null, connection: null }),
};

const START = {
  "start-started": { start: { intent: "ensure-running", code: 0, outcome: "started", recovered: null, lines: ["starting zcode-proxy ...", "started (pid 4242) — healthy on http://127.0.0.1:18458"], pid: 4242 } },
  "start-already-running": { pidRecord: PID_RECORD, start: { intent: "ensure-running", code: 0, outcome: "already-running", recovered: null, lines: ["already running (pid 4242)"] } },
  "start-recovered-hung": { start: { intent: "ensure-running", code: 0, outcome: "started", recovered: { pid: 4100, reason: "no /health answer for 15 s", at: 1 }, lines: [], pid: 4242 } },
  "start-foreign": { start: { intent: "ensure-running", code: 3, outcome: "foreign", recovered: null, lines: ["ERROR: port 18458 is occupied by a foreign service (auth failed). Not touching it."] } },
  "start-no-key": { start: { intent: "ensure-running", code: 5, outcome: "no-key", recovered: null, lines: ["ERROR: /kit/.proxykey missing — cannot verify identity. Run setup first: zcode-kit setup."] } },
  "start-unhealthy": { start: { intent: "ensure-running", code: 2, outcome: "unhealthy", recovered: null, lines: ["starting zcode-proxy ...", "ERROR: proxy did not become healthy within 25000ms (pid 4242). See /kit/logs/proxy.log"] } },
  "start-lock-unavailable": { start: { intent: "ensure-running", code: 1, outcome: "start-lock-unavailable", recovered: null, lines: [], error: "stale or unreadable manager start lock at /kit/logs/manager.lock — refusing automatic takeover. If no start is actually running, remove /kit/logs/manager.lock manually and retry." } },
  "start-throws": { startThrows: "EACCES: permission denied, open '/kit/logs/proxy.log'" },
};
const STOP = {
  "stop-stopped": { stop: { intent: "stop", code: 0, outcome: "stopped", recovered: null, lines: ["stopped (pid 4242)"], pid: 4242 } },
  // Ticket 22: the graceful stop request's steps reach observe as event lines
  // (ticket 14); the narration follows them. The fixture's line is fixed and
  // 78 columns wide so the spinner frame stays inside 80.
  "stop-graceful": {
    stopEvents: ["2026-11-11T00:00:00.000Z INFO manager stop request sent pid=4242 graceMs=10000"],
    stop: { intent: "stop", code: 0, outcome: "stopped", recovered: null, lines: ["stopped (pid 4242)"], pid: 4242 },
  },
  "stop-not-running": { stop: { intent: "stop", code: 0, outcome: "not-running", recovered: null, lines: ["not running"] } },
  "stop-foreign": { stop: { intent: "stop", code: 3, outcome: "foreign", recovered: null, lines: ["ERROR: something foreign is on port 18458. Refusing to stop anything."] } },
  "stop-reuse-suspect": { stop: { intent: "stop", code: 4, outcome: "reuse-suspect", recovered: null, lines: ["ERROR: pid 4242 exists but its start time does not match the pid file (PID reuse suspected) — refusing to kill."] } },
};
const RESTART = {
  "restart-ok": { ...STOP["stop-stopped"], ...START["start-started"] },
  "restart-graceful": { ...STOP["stop-graceful"], ...START["start-started"] },
  "restart-stop-refused": { ...STOP["stop-foreign"], ...START["start-started"] },
};

const VARIANTS = Object.keys(C3_VARIANTS);
const snap = (dir, variant, { stdout, stderr }) => {
  matchSnapshot(`cli/${dir}/${variant}.out`, normaliseSnapshot(stdout));
  matchSnapshot(`cli/${dir}/${variant}.err`, normaliseSnapshot(stderr));
};
/** Every line within 80 columns at an 80-column terminal (design-language §1.4, A-12). */
const within80 = (text, label) => {
  // A spinner redraws its line with \r: what stays on screen is the last frame.
  for (const line of stripAnsi(text).split("\n").map((l) => l.split("\r").at(-1))) assert.ok(displayWidth(line) <= 80, `${label}: ${displayWidth(line)} columns: ${JSON.stringify(line)}`);
};

// ----------------------------------------------------------------- status
for (const [fixture, record] of Object.entries(STATUS_FIXTURES)) {
  test(`status, ${fixture}: the report in every C3 variant (snapshots); proxy status is the same`, async (t) => {
    for (const variant of VARIANTS) {
      const run = await runIn(t, variant, { status: record }, "status", ["status"]);
      assert.equal(run.exitCode, record.identity === "ours" ? 0 : 1, "exit 0 only when this kit's proxy answers");
      snap(`status/${fixture}`, variant, run);
      if (variant === "tty-color-80") within80(run.stdout + run.stderr, fixture);
      const viaProxy = await runIn(t, variant, { status: record }, "proxy", ["proxy", "status"]);
      assert.deepEqual([viaProxy.stdout, viaProxy.stderr, viaProxy.exitCode], [run.stdout, run.stderr, run.exitCode], "zcode-kit proxy status prints what zcode-kit status prints");
    }
  });
}

test("status: the state line comes first, in words and human units; nothing on stderr for the own proxy", async (t) => {
  const run = await runIn(t, "pipe", { status: STATUS_FIXTURES.running }, "status", ["status"]);
  assert.equal(run.stdout.split("\n")[0], "running on 127.0.0.1:18458, up 1 h 02 min (pid 4242)");
  assert.equal(run.stderr, "");
  assert.match(run.stdout, /^ {2}GLM Coding Lite {3}4120 of 6000 prompts left \(69 %\), expires 2025-12-31$/m);
  assert.doesNotMatch(run.stdout, /\b3725s\b|health: |pid file:|ours\b/, "no implementation jargon (A-17)");
  const down = await runIn(t, "pipe", { status: STATUS_FIXTURES.down }, "status", ["status"]);
  assert.deepEqual(down.stdout.split("\n").slice(0, 2), ["stopped (port 18458)", "  next: zcode-kit proxy start"]);
});

test("status: the connection details once per command; routes only with --verbose (A-12)", async (t) => {
  for (const fixture of ["running", "down"]) {
    const plain = await runIn(t, "pipe", { status: STATUS_FIXTURES[fixture] }, "status", ["status"]);
    assert.equal((plain.stdout.match(/^Connection details/gm) ?? []).length, 1, fixture);
    assert.doesNotMatch(plain.stdout, /routes|POST \//, `${fixture}: no routes without --verbose`);
    const verbose = await runIn(t, "pipe", { status: STATUS_FIXTURES[fixture] }, "status", ["status"], { verbose: true });
    assert.match(verbose.stdout, /^ {2}OpenAI routes {7}POST \/chat\/completions, POST \/responses, GET \/models$/m);
    assert.match(verbose.stdout, /^ {2}Anthropic routes {4}POST \/v1\/messages$/m);
  }
  for (const fixture of ["foreign", "no-key"]) {
    const run = await runIn(t, "pipe", { status: STATUS_FIXTURES[fixture] }, "status", ["status"]);
    assert.doesNotMatch(run.stdout + run.stderr, /Connection details|base URL/, `${fixture}: no connection details`);
  }
});

test("status: a foreign listener or a missing key is an error block on stderr with what/why/next, exit 1", async (t) => {
  const foreign = await runIn(t, "pipe", { status: STATUS_FIXTURES.foreign }, "proxy", ["proxy", "status"]);
  assert.equal(foreign.exitCode, 1);
  assert.equal(foreign.stdout, "");
  assert.match(foreign.stderr, /^FAIL {2}Port 18458 is answered by another service\n {2}why: .+\n {2}next: change server\.port in proxy\/config\.yaml, then zcode-kit proxy start\n {2}next: zcode-kit doctor\n {2}exit: 1\n$/);
  const nokey = await runIn(t, "pipe", { status: STATUS_FIXTURES["no-key"] }, "status", ["status"]);
  assert.equal(nokey.stdout, "");
  assert.match(nokey.stderr, /^FAIL {2}The local proxy key is missing\n {2}why: \/kit\/\.proxykey not found, .+\n {2}next: zcode-kit setup\n {2}exit: 1\n$/);
  assert.doesNotMatch(nokey.stderr, /node setup\.mjs/, "the next step is the public command (A-09)");
});

test("status --json: the status document only (unchanged), exit code as the text status", async (t) => {
  const { statusDocument } = await import(pathToFileURL(join(ROOT, "lib", "proxy-status.mjs")).href);
  for (const [fixture, record] of Object.entries(STATUS_FIXTURES)) {
    for (const [name, positional] of [["status", ["status"]], ["proxy", ["proxy", "status"]]]) {
      const run = await runIn(t, "tty-color-80", { status: record }, name, positional, { json: true });
      assert.deepEqual(run.records, [{ kind: "json", value: statusDocument(record) }], fixture);
      assert.equal(run.stderr, "");
      assert.equal(run.exitCode, record.identity === "ours" ? 0 : 1);
    }
  }
});

// The reveal rule of cli/connection-details.mjs (shouldRevealKey): the key in
// full only when stdin and stdout are terminals and no CI marker is set; the
// output module adds that the stream it lands on must be a terminal.
test("connection details reveal rule: the key only on an interactive terminal outside CI, never in a pipe or JSON", async (t) => {
  const cases = [
    { variant: "tty-color-80", stdinTTY: true, env: {}, shown: true },
    { variant: "no-color", stdinTTY: true, env: {}, shown: true },
    { variant: "tty-color-80", stdinTTY: false, env: {}, shown: false },
    { variant: "tty-color-80", stdinTTY: true, env: { CI: "true" }, shown: false },
    { variant: "tty-color-80", stdinTTY: true, env: { CI: "0" }, shown: true },
    { variant: "pipe", stdinTTY: true, env: {}, shown: false },
    { variant: "ci", stdinTTY: true, env: {}, shown: false },
  ];
  for (const fixture of ["running", "down"]) {
    for (const c of cases) {
      const run = await runIn(t, c.variant, { status: STATUS_FIXTURES[fixture] }, "status", ["status"], {}, { stdinTTY: c.stdinTTY, env: c.env });
      const text = run.stdout + run.stderr;
      assert.equal(text.includes(KEY), c.shown, `${fixture} ${JSON.stringify(c)}`);
      if (!c.shown) assert.match(stripAnsi(text), /API key {13}\(redacted . print it with: zcode-kit models --show-key\)/);
      // The command passes the key only when the reveal rule allows it.
      assert.equal("key" in run.records.find((r) => r.kind === "connection").facts, c.shown, `${fixture} ${JSON.stringify(c)}: key in the record`);
    }
  }
  for (const [name, positional] of [["status", ["status"]], ["proxy", ["proxy", "status"]]]) {
    const json = await runIn(t, "tty-color-80", { status: STATUS_FIXTURES.running }, name, positional, { json: true });
    assert.ok(!JSON.stringify(json.records).includes(KEY), "never in JSON");
  }
  const started = await runIn(t, "pipe", START["start-started"], "proxy", ["proxy", "start"]);
  assert.ok(!(started.stdout + started.stderr).includes(KEY), "proxy start in a pipe: redacted");
  const tty = await runIn(t, "tty-color-80", START["start-started"], "proxy", ["proxy", "start"]);
  assert.ok(tty.stdout.includes(KEY), "proxy start on a terminal: shown");
});

// ------------------------------------------------------- start/stop/restart
for (const [sub, fixtures] of [["start", START], ["stop", STOP], ["restart", RESTART]]) {
  for (const [fixture, data] of Object.entries(fixtures)) {
    test(`proxy ${sub}, ${fixture}: progress and result on stderr, the card on stdout, every C3 variant (snapshots)`, async (t) => {
      for (const variant of VARIANTS) {
        const run = await runIn(t, variant, data, "proxy", ["proxy", sub]);
        snap(`proxy/${fixture}`, variant, run);
        if (variant === "tty-color-80") within80(run.stdout + run.stderr, fixture);
      }
    });
  }
}

test("proxy start|stop|restart: the lifecycle's exit codes 0-5 pass through; a throwing intent is exit 1, as the manager's", async (t) => {
  const expected = {
    "start-started": 0, "start-already-running": 0, "start-recovered-hung": 0, "start-foreign": 3, "start-no-key": 5, "start-unhealthy": 2, "start-lock-unavailable": 1, "start-throws": 1,
    "stop-stopped": 0, "stop-not-running": 0, "stop-foreign": 3, "stop-reuse-suspect": 4,
    "restart-ok": 0, "restart-stop-refused": 3,
  };
  for (const [fixture, code] of Object.entries(expected)) {
    const sub = fixture.split("-")[0];
    const data = { ...START, ...STOP, ...RESTART }[fixture];
    const run = await runIn(t, "pipe", data, "proxy", ["proxy", sub]);
    assert.equal(run.exitCode, code, fixture);
    if (code === 0) assert.match(run.stderr, /^(OK|SKIP) {2}Proxy (start|stop)/m, `${fixture}: a result row`);
    else assert.match(run.stderr, /(^|\n)FAIL {2}.+\n {2}why: \S.*\n( {2}next: \S.*\n)+ {2}exit: \d\n$/, `${fixture}: an error block with what/why/next`);
    const cards = (run.stdout.match(/^Connection details/gm) ?? []).length;
    assert.equal(cards, code === 0 && sub !== "stop" ? 1 : 0, `${fixture}: the card once, after a successful start only`);
    if (code !== 0 || sub === "stop") assert.equal(run.stdout, "", `${fixture}: nothing on stdout`);
  }
});

test("proxy start: errors name the public commands, never the retired setup entry point (A-09)", async (t) => {
  const run = await runIn(t, "pipe", START["start-no-key"], "proxy", ["proxy", "start"]);
  assert.match(run.stderr, /^ {2}next: zcode-kit setup$/m);
  assert.doesNotMatch(run.stderr, /node setup\.mjs/);
  const foreign = await runIn(t, "pipe", START["start-foreign"], "proxy", ["proxy", "start"]);
  assert.match(foreign.stderr, /^FAIL {2}Port 18458 is in use by another service$/m);
  assert.match(foreign.stderr, /never stops a service it did not start/);
});

test("proxy restart: a refused stop ends it before any start", async (t) => {
  const run = await runIn(t, "pipe", RESTART["restart-stop-refused"], "proxy", ["proxy", "restart"]);
  assert.equal(run.exitCode, 3);
  assert.doesNotMatch(run.stderr, /Proxy start/);
});

test("proxy start: the lifecycle runs for this kit, with this kit's manager as the respawn hook target", async (t) => {
  globalThis.__cliUxLifecycle = [];
  const run = await runIn(t, "pipe", START["start-started"], "proxy", ["proxy", "start"]);
  assert.equal(run.exitCode, 0);
  const [opts] = globalThis.__cliUxLifecycle;
  assert.match(opts.root, /cli-ux-proxy-/);
  assert.equal(opts.managerPath, join(opts.root, "proxy", "zcode-proxy-manager.mjs"));
  assert.equal(opts.home, join(opts.root, "home"));
});

// ------------------------------------------------------------------- logs
const LOG = [
  "[manager 2026-11-06T10:00:00.000Z] starting zcode-proxy ...",
  "zcode-proxy listening on http://127.0.0.1:18458",
  "r001 ANT glm-5.3 200 stream 812ms→6.4s 1830tok 286t/s",
  "r002 OAI glm-5.3-flash 200 stream 390ms→2.1s 402tok 191t/s",
  "r003 ANT glm-5.3 429 batch 233ms",
  "2026-11-06T10:01:00.000Z WARN supervisor memory near cap rss_mb=900",
  `[manager 2026-11-06T10:02:00.000Z] ERROR: proxy exited immediately (code 1). key ${KEY}`,
  "r004 OAI glm-5.3-flash 502 batch 412ms",
  "[captcha] solver recycled (rss-budget) generation=3",
].join("\n") + "\n";

async function logsRun(t, positional, flags = {}, { log = LOG } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cli-ux-logs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logFile = join(dir, "proxy.log");
  if (log !== null) writeFileSync(logFile, log);
  return runIn(t, "pipe", { logFile }, "proxy", positional, flags);
}

test("proxy logs [n]: raw lines on stdout, redacted, the last n", async (t) => {
  const all = await logsRun(t, ["proxy", "logs"]);
  assert.equal(all.exitCode, 0);
  assert.equal(all.stderr, "");
  assert.equal(all.stdout, LOG.split(KEY).join("<redacted>"));
  const three = await logsRun(t, ["proxy", "logs", "3"]);
  assert.deepEqual(three.stdout.split("\n").slice(0, -1), [`[manager 2026-11-06T10:02:00.000Z] ERROR: proxy exited immediately (code 1). key <redacted>`, "r004 OAI glm-5.3-flash 502 batch 412ms", "[captcha] solver recycled (rss-budget) generation=3"]);
});

test("proxy logs --level warn|error and --grep <text> filter the lines (A-23, additive)", async (t) => {
  const warn = await logsRun(t, ["proxy", "logs"], { level: "warn" });
  assert.deepEqual(warn.stdout.split("\n").slice(0, -1), [
    "r003 ANT glm-5.3 429 batch 233ms",
    "2026-11-06T10:01:00.000Z WARN supervisor memory near cap rss_mb=900",
    "[manager 2026-11-06T10:02:00.000Z] ERROR: proxy exited immediately (code 1). key <redacted>",
    "r004 OAI glm-5.3-flash 502 batch 412ms",
  ]);
  const error = await logsRun(t, ["proxy", "logs"], { level: "error" });
  assert.deepEqual(error.stdout.split("\n").slice(0, -1), [
    "[manager 2026-11-06T10:02:00.000Z] ERROR: proxy exited immediately (code 1). key <redacted>",
    "r004 OAI glm-5.3-flash 502 batch 412ms",
  ]);
  const grep = await logsRun(t, ["proxy", "logs", "1"], { grep: "glm-5.3-flash" });
  assert.deepEqual(grep.stdout.split("\n").slice(0, -1), ["r004 OAI glm-5.3-flash 502 batch 412ms"]);
  const both = await logsRun(t, ["proxy", "logs"], { level: "warn", grep: "ANT" });
  assert.deepEqual(both.stdout.split("\n").slice(0, -1), ["r003 ANT glm-5.3 429 batch 233ms"]);
  const none = await logsRun(t, ["proxy", "logs"], { grep: "no such text" });
  assert.deepEqual([none.exitCode, none.stdout, none.stderr], [0, "", ""], "no match: nothing, exit 0");
  // The filters see the lines as they are shown: redacted first.
  const secret = await logsRun(t, ["proxy", "logs"], { grep: KEY });
  assert.equal(secret.stdout, "", "a grep for the key matches nothing");
});

test("proxy logs: a bad --level or an empty --grep is a usage error (exit 2, stderr); no log file is a note, exit 0", async (t) => {
  for (const flags of [{ level: "debug" }, { level: true }, { grep: true }]) {
    const run = await logsRun(t, ["proxy", "logs"], flags);
    assert.equal(run.exitCode, 2, JSON.stringify(flags));
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /^FAIL {2}.+\n {2}next: zcode-kit proxy logs \[n\] \[--level warn\|error\] \[--grep <text>\]\n {2}exit: 2\n$/);
  }
  const missing = await logsRun(t, ["proxy", "logs"], {}, { log: null });
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.stdout, "", "no data");
  assert.match(missing.stderr, /^INFO {2}no proxy log yet at .*proxy\.log$/m);
});
