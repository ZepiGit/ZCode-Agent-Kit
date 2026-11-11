// Seam 5: CLI command modules (spec §10 "CLI command modules", Story 61).
// Each command module takes parsed args + a command ctx and returns
// `{ exitCode, records }`; the CLI entry keeps parsing, dispatch and
// rendering. Two properties are pinned here:
//   1. importing a command module has no side effects: no argv or env reads,
//      no process.exit, no file/process/network I/O, no output, no timers at
//      module scope (transitive imports included);
//   2. exit codes are asserted on the returned `{ exitCode, records }`, with
//      the manager process and the proxy's HTTP endpoint faked at the system
//      boundary (`spawnSync`, `fetch`).
// The byte-level output is pinned elsewhere: the existing spawn suites
// (cli-kit, cli-audit, setup-regressions) and the before-equivalence test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const COMMAND_MODULES = ["status", "proxy", "logs", "models", "doctor"];

// --------------------------------------------------------------- the probe
// Runs in a fresh Node process: arms traps on every side-effect channel, then
// imports the target. A hit counts only when a file: URL frame other than the
// probe's own is on the stack (kit code, not Node's own loader), so the probe
// sees transitive imports and ignores Node internals.
const PROBE = String.raw`
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
const target = process.argv[1];
const hits = [];
let armed = false;
// The probe's own frames ([evalN]) are skipped; Node's loader reads files
// and env through the public APIs too, but with node: frames only.
const fromKit = () => new Error().stack.split("\n").slice(2).filter((l) => !l.includes("[eval")).some((l) => l.includes("file://"));
const note = (what) => { if (armed && fromKit()) hits.push(what); };
const wrap = (owner, name, label) => {
  const real = owner[name];
  if (typeof real !== "function") return;
  owner[name] = function (...args) { note(label + name); return real.apply(this, args); };
};
const env = process.env;
process.env = new Proxy(env, {
  get: (t, k) => { note("env." + String(k)); return t[k]; },
  has: (t, k) => { note("env." + String(k)); return k in t; },
  ownKeys: (t) => { note("env.*"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor: (t, k) => { note("env." + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
});
const argv = process.argv;
process.argv = new Proxy(argv, { get: (t, k) => { note("argv"); return t[k]; } });
for (const name of Object.keys(fs)) if (/^[a-z]/.test(name)) wrap(fs, name, "fs.");
for (const name of Object.keys(fs.promises)) wrap(fs.promises, name, "fs.promises.");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) wrap(cp, name, "child_process.");
syncBuiltinESMExports();
for (const name of ["setTimeout", "setInterval", "setImmediate", "fetch"]) wrap(globalThis, name, "");
for (const name of ["on", "once", "addListener", "kill", "chdir"]) wrap(process, name, "process.");
const realExit = process.exit;
process.exit = (code) => { note("process.exit"); };
const realOut = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => { note("stdout"); return armed ? true : realOut(chunk, ...rest); };
process.stderr.write = ((real) => (chunk, ...rest) => { note("stderr"); return armed ? true : real(chunk, ...rest); })(process.stderr.write.bind(process.stderr));
armed = true;
try {
  await import(pathToFileURL(target).href);
} finally {
  armed = false;
}
realOut(JSON.stringify(hits));
`;

function probe(file) {
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE, file], { encoding: "utf8", timeout: 30000 });
  assert.equal(res.status, 0, `probe of ${file} failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test("the import probe is not vacuous: each side-effect channel at module scope is caught, transitively too", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-commands-probe-"));
  try {
    const fixtures = {
      "env.mjs": ["export const home = process.env.HOME;", /^env\.HOME$/],
      "argv.mjs": ["export const first = process.argv[2];", /^argv$/],
      "fs.mjs": ['import { existsSync } from "node:fs";\nexport const root = existsSync("/");', /^fs\.existsSync$/],
      "spawn.mjs": ['import { spawnSync } from "node:child_process";\nspawnSync("true");', /^child_process\.spawnSync$/],
      "exit.mjs": ["process.exit(0);", /^process\.exit$/],
      "output.mjs": ['console.log("hello");', /^stdout$/],
      "timer.mjs": ["setTimeout(() => {}, 1).unref();", /^setTimeout$/],
      "signal.mjs": ['process.on("SIGINT", () => {});', /^process\.on$/],
      "transitive.mjs": ['import "./env.mjs";\nexport const x = 1;', /^env\.HOME$/],
    };
    for (const [name, [source]] of Object.entries(fixtures)) writeFileSync(join(dir, name), source + "\n");
    writeFileSync(join(dir, "clean.mjs"), 'import { join } from "node:path";\nexport function run(args, ctx) { return ctx.env.HOME + join("a", "b"); }\n');
    for (const [name, [, expected]] of Object.entries(fixtures)) {
      const hits = probe(join(dir, name));
      assert.ok(hits.some((h) => expected.test(h)), `${name}: expected a hit matching ${expected}, got ${JSON.stringify(hits)}`);
    }
    assert.deepEqual(probe(join(dir, "clean.mjs")), [], "a module that only reads env inside its function is clean");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const name of COMMAND_MODULES) {
  test(`importing cli/commands/${name}.mjs has no side effects`, () => {
    assert.deepEqual(probe(join(ROOT, "cli", "commands", `${name}.mjs`)), []);
  });
}

// ------------------------------------------------------------- exit codes
const load = (name) => import(pathToFileURL(join(ROOT, "cli", "commands", `${name}.mjs`)).href);
const KIT_ROOT = join(tmpdir(), "zcode-kit-cli-commands-root");
const MANAGER = join(KIT_ROOT, "proxy", "zcode-proxy-manager.mjs");

/** A command ctx whose manager process is faked at the spawn boundary. */
function managerCtx(result, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      kit: { root: KIT_ROOT, home: join(KIT_ROOT, "home") },
      env: {},
      execPath: "node-under-test",
      spawnSync: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; },
      fetch: () => Promise.reject(new Error("no network in this test")),
      progress: () => assert.fail("no progress expected"),
      ...extra,
    },
  };
}
const args = (positional, flags = {}) => ({ positional, flags, passthrough: null });



// Since ticket 40 status, proxy start|stop|restart|status and proxy logs run
// the lifecycle and the status record in-process (no manager spawn); their
// exit codes (0-5, status 0/1), --json and the line count are pinned in
// tests/cli-ux-proxy.test.mjs at the lifecycle/status module boundary.
const PROXY_USAGE = "Usage: zcode-kit proxy start|stop|restart|status|logs [n]\n";

test("proxy: a missing or unknown subcommand is a usage error, exit 2 on stderr, and starts nothing", async () => {
  const { run } = await load("proxy");
  for (const positional of [["proxy"], ["proxy", "bogus"]]) {
    const { ctx, calls } = managerCtx({ status: 0 });
    assert.deepEqual(await run(args(positional), ctx), { exitCode: 2, records: [{ kind: "text", stream: "stderr", text: PROXY_USAGE }] });
    assert.equal(calls.length, 0);
  }
});




/** A command ctx whose proxy answers (or fails) at the fetch boundary. */
function proxyCtx(answer, kit = {}) {
  const requests = [];
  return {
    requests,
    ctx: {
      kit: { root: KIT_ROOT, key: () => "synthetic-key", port: () => 19071, ...kit },
      env: {},
      execPath: "node-under-test",
      spawnSync: () => assert.fail("models starts no process"),
      fetch: async (url, init) => { requests.push({ url, authorization: init.headers.authorization }); return answer(); },
      progress: () => assert.fail("no progress expected"),
    },
  };
}
const answerModels = (ids) => () => ({ ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) });
const out = (text) => ({ kind: "text", stream: "stdout", text });

test("models: the running proxy's list, one id per line, exit 0, asked with the kit key", async () => {
  const { run } = await load("models");
  const { ctx, requests } = proxyCtx(answerModels(["glm-5.3", "glm-5.2"]));
  assert.deepEqual(await run(args(["models"]), ctx), { exitCode: 0, records: [out("glm-5.3\nglm-5.2\n")] });
  assert.deepEqual(requests, [{ url: "http://127.0.0.1:19071/v1/models", authorization: "Bearer synthetic-key" }]);
});

test("models: a down or failing proxy falls back to the registry snapshot, still exit 0", async () => {
  const { run } = await load("models");
  for (const answer of [() => { throw new Error("ECONNREFUSED"); }, () => ({ ok: false, status: 503, json: async () => ({}) })]) {
    const { ctx } = proxyCtx(answer);
    assert.deepEqual(await run(args(["models"]), ctx), { exitCode: 0, records: [out("glm-5.3\nglm-5.3-flash\n")] });
  }
  const unreadableKey = proxyCtx(answerModels(["x"]), { key: () => { throw new Error("ENOENT .proxykey"); } });
  assert.deepEqual(await run(args(["models"]), unreadableKey.ctx), { exitCode: 0, records: [out("glm-5.3\nglm-5.3-flash\n")] });
  assert.equal(unreadableKey.requests.length, 0);
});

test("models --json names where the list came from", async () => {
  const { run } = await load("models");
  const up = proxyCtx(answerModels(["glm-5.3"]));
  assert.deepEqual(await run(args(["models"], { json: true }), up.ctx), { exitCode: 0, records: [{ kind: "json", value: { models: ["glm-5.3"], source: "proxy" } }] });
  const down = proxyCtx(() => { throw new Error("down"); });
  assert.deepEqual(await run(args(["models"], { json: true }), down.ctx), { exitCode: 0, records: [{ kind: "json", value: { models: ["glm-5.3", "glm-5.3-flash"], source: "registry" } }] });
});

test("models --show-key: the warning goes to stderr and the key alone to stdout, after the list", async () => {
  const { run } = await load("models");
  const { ctx } = proxyCtx(answerModels(["glm-5.3"]));
  assert.deepEqual(await run(args(["models"], { "show-key": true }), ctx), {
    exitCode: 0,
    records: [
      out("glm-5.3\n"),
      { kind: "text", stream: "stderr", text: "\nlocal proxy key (never share; shown because --show-key was given):\n" },
      out("synthetic-key\n"),
    ],
  });
});

test("models --show-key with an unreadable key fails after the list: the error carries what was already printed", async () => {
  const { run } = await load("models");
  let reads = 0;
  const { ctx } = proxyCtx(answerModels(["glm-5.3"]), { key: () => { if (reads++ === 0) return "synthetic-key"; throw new Error("EACCES .proxykey"); } });
  await assert.rejects(run(args(["models"], { "show-key": true }), ctx), (err) => {
    assert.equal(err.message, "EACCES .proxykey");
    assert.deepEqual(err.records, [out("glm-5.3\n"), { kind: "text", stream: "stderr", text: "\nlocal proxy key (never share; shown because --show-key was given):\n" }]);
    return true;
  });
});

// doctor runs against a temp kit (no stored decisions, an empty home: no
// kit integration anywhere) with the manager's doctor faked at its boundary:
// the kit's lib/proxy-doctor.mjs, whose check record zcode-kit doctor reads
// (ticket 38; before, the manager CLI was faked at the spawn boundary).
const HARNESS_IDS = "omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose";

/** `manager` is the doctor record the fake returns, or `{ throws: message }`. */
async function doctorCtx(manager) {
  const { createCtx } = await import(pathToFileURL(join(ROOT, "cli", "context.mjs")).href);
  const root = mkdtempSync(join(tmpdir(), "cli-commands-doctor-"));
  const home = join(root, "home");
  mkdirSync(home);
  mkdirSync(join(root, "lib"));
  const tag = `__doctorCalls_${root.replace(/\W/g, "_")}`;
  writeFileSync(join(root, "lib", "proxy-doctor.mjs"), `export async function managerDoctor(opts) {
  (globalThis[${JSON.stringify(tag)}] ??= []).push(opts);
  ${manager.throws ? `throw new Error(${JSON.stringify(manager.throws)});` : `return ${JSON.stringify(manager)};`}
}\n`);
  const kit = { ...createCtx(root, home), stateDir: root, generated: join(root, "generated"), backupDir: join(root, "backups") };
  const env = { FIXTURE_ENV: "doctor" };
  return {
    calls: () => globalThis[tag] ?? [],
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    ctx: {
      kit,
      env,
      execPath: "node-under-test",
      spawnSync: () => assert.fail("doctor without --fix spawns nothing"),
      fetch: () => Promise.reject(new Error("no network in this test")),
      progress: () => assert.fail("doctor without --fix streams nothing"),
    },
  };
}
const texts = (records) => records.map((r) => { assert.equal(r.kind, "text"); return `${r.stream}:${r.text}`; });
const doctorRecord = (checks) => ({ intent: "doctor", code: checks.some((c) => c.ok === false) ? 1 : 0, outcome: checks.some((c) => c.ok === false) ? "failed" : "ok", checks });
// Since ticket 40 the text report is output-module records (cli/doctor-report.mjs):
// one check record per check, a lead record when something failed, one verdict.
const checkRows = (records) => records.filter((r) => r.kind === "check").map((r) => `${r.status.toUpperCase()}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
const verdictOf = (records) => { const v = records.filter((r) => r.kind === "verdict"); assert.equal(v.length, 1, "one verdict"); assert.equal(records.at(-1), v[0], "the verdict is last"); return v[0]; };

test("doctor: unknown --harness ids are a usage error, exit 2 on stderr, before anything runs", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([]));
  try {
    assert.deepEqual(await run(args(["doctor"], { harness: "omp,nope" }), d.ctx), {
      exitCode: 2,
      records: [{ kind: "text", stream: "stderr", text: `unknown harness "nope". Known: ${HARNESS_IDS}\n` }],
    });
    assert.equal(d.calls().length, 0);
  } finally { d.cleanup(); }
});

test("doctor: a clean manager and only unconsented harnesses is exit 0; each check once, no lead, one verdict", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([
    { name: "proxy running", ok: true, detail: "pid 4242" },
    { name: "key file", ok: true, detail: "present" },
    { name: "omp integration", ok: null, detail: "OMP not installed — skipped" },
  ]));
  try {
    const { exitCode, records } = await run(args(["doctor"]), d.ctx);
    assert.equal(exitCode, 0);
    assert.equal(records.filter((r) => r.kind === "lead").length, 0, "no lead line without a failure");
    const rows = checkRows(records);
    assert.deepEqual(rows.filter((r) => !/: integration — /.test(r)), ["PASS  proxy running — pid 4242", "PASS  key file — present", "SKIP  omp integration — OMP not installed — skipped"]);
    assert.equal(rows.length, 3 + 10, "one row per manager check and per harness, each once");
    for (const row of rows.slice(3)) assert.match(row, /^SKIP {2}[a-z-]+: integration — /);
    assert.deepEqual(verdictOf(records), { kind: "verdict", label: "doctor", counts: { pass: 2, fail: 0, warn: 0, skip: 11 }, exit: 0 });
    assert.deepEqual(d.calls(), [{ root: d.ctx.kit.root, home: d.ctx.kit.home, env: d.ctx.env }], "the manager's doctor runs once, for this kit, with the command's env");
  } finally { d.cleanup(); }
});

test("doctor: a FAIL from the manager is exit 1, led by the problem count and counted in the verdict", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([{ name: "proxy running", ok: false, detail: "not running" }]));
  try {
    const { exitCode, records } = await run(args(["doctor"]), d.ctx);
    assert.equal(exitCode, 1);
    assert.deepEqual(records[0], { kind: "lead", counts: { fail: 1, warn: 0 } });
    assert.deepEqual(checkRows(records).filter((r) => r.startsWith("FAIL")), ["FAIL  proxy running — not running"]);
    assert.deepEqual(verdictOf(records).counts, { pass: 0, fail: 1, warn: 0, skip: 10 });
    assert.equal(verdictOf(records).exit, 1);
  } finally { d.cleanup(); }
});

test("doctor: a manager doctor that throws, or fails without a failed check, still fails the report (exit 1)", async () => {
  const { run } = await load("doctor");
  for (const [manager, detail] of [
    [{ throws: "EACCES config.yaml" }, "manager check failed or timed out"],
    [{ intent: "doctor", code: 3, outcome: "failed", checks: [{ name: "proxy running", ok: true, detail: "pid 1" }] }, "manager check exited 3 without a diagnostic failure result"],
  ]) {
    const d = await doctorCtx(manager);
    try {
      const { exitCode, records } = await run(args(["doctor"]), d.ctx);
      assert.equal(exitCode, 1);
      assert.ok(checkRows(records).includes(`FAIL  manager doctor completed — ${detail}`), detail);
    } finally { d.cleanup(); }
  }
});

test("doctor: a check detail spanning lines is one check, never a row of its own", async () => {
  // A detail is data (a version string, an error message): a line inside it
  // that looks like a FAIL row must not count as a failed check.
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([{ name: "bun available", ok: true, detail: "/opt/bun (1.4.2\nFAIL  injected — from a version string)" }]));
  try {
    const { exitCode, records } = await run(args(["doctor"], { json: true }), d.ctx);
    assert.equal(exitCode, 0);
    assert.deepEqual(records[0].value.checks[0], { name: "bun available", ok: true, detail: "/opt/bun (1.4.2\nFAIL  injected — from a version string)", status: "pass" });
    assert.deepEqual([records[0].value.ok, records[0].value.failed], [true, 0]);
    assert.equal(records[0].value.checks.filter((c) => c.name.startsWith("injected")).length, 0);
  } finally { d.cleanup(); }
});

test("doctor --harness codex verifies a requested harness without consent: its missing artifact fails, exit 1", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([{ name: "proxy running", ok: true, detail: "pid 1" }]));
  try {
    const { exitCode, records } = await run(args(["doctor"], { harness: "codex" }), d.ctx);
    assert.equal(exitCode, 1);
    assert.deepEqual(checkRows(records), [
      "PASS  proxy running — pid 1",
      "FAIL  codex: codex adapter artifact — generated/codex-home/config.toml",
    ]);
    assert.deepEqual(verdictOf(records).counts, { pass: 1, fail: 1, warn: 0, skip: 0 });
  } finally { d.cleanup(); }
});

test("doctor --json: one JSON record (no text report), exit code as in text mode", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([{ name: "proxy running", ok: false, detail: "not running" }, { name: "solver", ok: null, detail: "idle" }]));
  try {
    const { exitCode, records } = await run(args(["doctor"], { json: true }), d.ctx);
    assert.equal(exitCode, 1);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "json");
    const { ok, failed, skipped, checks } = records[0].value;
    assert.deepEqual([ok, failed, skipped], [false, 1, 11]);
    assert.deepEqual(checks.slice(0, 2), [
      { name: "proxy running", ok: false, detail: "not running", status: "fail" },
      { name: "solver", ok: null, detail: "idle", status: "skip" },
    ]);
  } finally { d.cleanup(); }
});

test("doctor reads the manager's check records: no text parsing and no manager doctor spawn remain in the CLI (grep)", () => {
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const doctor = strip(readFileSync(join(ROOT, "cli", "commands", "doctor.mjs"), "utf8"));
  assert.match(doctor, /proxy-doctor\.mjs/, "the doctor command reads the manager's doctor module");
  // A verdict word inside a regex literal is a row parser.
  assert.doesNotMatch(doctor, /\/\^?\(?\??:?(?:PASS|FAIL|SKIP|WARN)\b/, "no regex over check rows");
  assert.doesNotMatch(doctor, /\.stdout\b/, "no manager stdout is read");
  for (const file of readdirSync(join(ROOT, "cli"), { recursive: true }).filter((f) => String(f).endsWith(".mjs"))) {
    const source = strip(readFileSync(join(ROOT, "cli", String(file)), "utf8"));
    assert.doesNotMatch(source, /\[\s*(?:manager|managerPath\([^)]*\))\s*,\s*["']doctor["']/, `cli/${file} spawns the manager's doctor`);
  }
});

test("doctor --forget: a missing or unknown id is a usage error (exit 2); an id with nothing stored is exit 0", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx(doctorRecord([]));
  try {
    for (const forget of [true, "", "nonsense"]) {
      assert.deepEqual(await run(args(["doctor"], { forget }), d.ctx), {
        exitCode: 2,
        records: [{ kind: "text", stream: "stderr", text: `Usage: zcode-kit doctor --forget <harness> (known: ${HARNESS_IDS})\n` }],
      });
    }
    assert.deepEqual(await run(args(["doctor"], { forget: "goose" }), d.ctx), {
      exitCode: 0,
      records: [{ kind: "text", stream: "stdout", text: "No stored decision for goose; nothing to forget.\n" }],
    });
    assert.equal(d.calls().length, 0, "--forget never asks the manager");
  } finally { d.cleanup(); }
});

// ------------------------------------------------- the entry renders records
// A few spawn tests of the CLI entry over a mini kit (cli/ + lib/ only, no
// key, no config): records keep their stream, and the records a module had
// collected before it threw are printed before the `zcode-kit:` error line.
// The expected bytes are what the pre-split entry printed.
async function cli(argv) {
  const root = mkdtempSync(join(tmpdir(), "cli-commands-entry-"));
  try {
    const { cpSync } = await import("node:fs");
    for (const member of ["cli", "lib", "package.json"]) cpSync(join(ROOT, member), join(root, member), { recursive: true });
  // Ticket 43: the output module's token set and width core re-export the
  // shared files under zcode-proxy-src/src/tui — part of every real kit
  // layout, so the fixture kit carries them too.
  mkdirSync(join(root, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(ROOT, "zcode-proxy-src", "src", "tui", f), join(root, "zcode-proxy-src", "src", "tui", f));
    mkdirSync(join(root, "proxy"));
    mkdirSync(join(root, "home"));
    const env = { PATH: process.env.PATH, HOME: join(root, "home"), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
    const res = spawnSync(process.execPath, [join(root, "cli", "zcode-kit.mjs"), ...argv], { encoding: "utf8", timeout: 30000, env });
    const { realpathSync } = await import("node:fs");
    const stderr = [realpathSync.native(root), root].reduce((text, spelling) => text.split(spelling).join("<root>"), res.stderr);
    return { code: res.status, stdout: res.stdout, stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("entry: usage errors from command modules go to stderr only, exit 2", async () => {
  const known = "omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose";
  assert.deepEqual(await cli(["proxy", "bogus"]), { code: 2, stdout: "", stderr: PROXY_USAGE });
  assert.deepEqual(await cli(["doctor", "--harness", "nope"]), { code: 2, stdout: "", stderr: `unknown harness "nope". Known: ${known}\n` });
  assert.deepEqual(await cli(["doctor", "--forget"]), { code: 2, stdout: "", stderr: `Usage: zcode-kit doctor --forget <harness> (known: ${known})\n` });
});

test("entry: a command that throws after collecting records prints them first, then the error, exit 2", async () => {
  assert.deepEqual(await cli(["models", "--show-key"]), {
    code: 2,
    stdout: "glm-5.3\nglm-5.3-flash\n",
    stderr: `\nlocal proxy key (never share; shown because --show-key was given):\nzcode-kit: ENOENT: no such file or directory, open '${join("<root>", ".proxykey")}'\n`,
  });
});

// ======================================================================
// Ticket 08 (contract): the remaining commands as modules. Each module is
// probed for import side effects like the first group, and its exit codes
// are asserted on `{ exitCode, records }` with the manager, the proxy CLI
// (spawnSync), the PATH commands (runCommandSync) and the proxy's HTTP
// endpoint (fetch) faked at the system boundary.
import { chmodSync, cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
const CONTRACT_MODULES = ["index", "help", "usage", "auth", "accounts", "rollback", "uninstall", "integrate", "run", "update", "setup"];
for (const name of CONTRACT_MODULES) {
  test(`importing cli/commands/${name}.mjs has no side effects`, () => {
    assert.deepEqual(probe(join(ROOT, "cli", "commands", `${name}.mjs`)), []);
  });
}

const errLine = (text) => ({ kind: "text", stream: "stderr", text });

/** A command ctx with every boundary failing unless the test fakes it. */
function fakeCtx(extra = {}) {
  const progress = [];
  return {
    progress,
    ctx: {
      kit: { root: KIT_ROOT, home: join(KIT_ROOT, "home"), key: () => "synthetic-key", port: () => 19081 },
      env: {},
      execPath: "node-under-test",
      platform: "linux",
      spawnSync: () => assert.fail("no process expected"),
      runCommandSync: () => assert.fail("no PATH command expected"),
      fetch: () => Promise.reject(new Error("no network in this test")),
      progress: (line) => progress.push(`out:${line}`),
      progressError: (line) => progress.push(`err:${line}`),
      ...extra,
    },
  };
}

test("help: the usage text on stdout, exit 0, naming every harness", async () => {
  const { run } = await load("help");
  const { exitCode, records } = await run(args(["help"]), fakeCtx().ctx);
  assert.equal(exitCode, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].stream, "stdout");
  assert.match(records[0].text, /^zcode-kit — local ZCode provider for your own agent harnesses\n\n {2}zcode-kit setup /);
  // Round39 / onboarding design §2.2: an unconfirmed batch is atomic; prior line answers stay applied.
  assert.match(records[0].text, /\n130 setup aborted with Ctrl-C \(unconfirmed checkbox batch not applied; prior applied answers remain\)\n\nHarnesses: omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose\n$/);
});

test("an unknown command: the error on stderr, then the usage text on stdout, exit 2", async () => {
  const { run, runUnknown } = await load("help");
  const help = await run(args(["help"]), fakeCtx().ctx);
  assert.deepEqual(await runUnknown(args(["frobnicate"]), fakeCtx().ctx), {
    exitCode: 2,
    records: [errLine("unknown command: frobnicate\n"), ...help.records],
  });
});

/** A proxy answer at the fetch boundary. */
const answer = (status, body) => () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("usage --json: the proxy's /quota body as JSON, exit 0 when it answers 2xx and 1 otherwise", async () => {
  const { run } = await load("usage");
  const requests = [];
  for (const [status, expected] of [[200, 0], [503, 1]]) {
    const body = { quota: { status } };
    const { ctx } = fakeCtx({ fetch: async (url, init) => { requests.push([url, init.headers.authorization]); return answer(status, body)(); } });
    assert.deepEqual(await run(args(["usage"], { json: true }), ctx), { exitCode: expected, records: [{ kind: "json", value: body }] });
  }
  assert.deepEqual(requests[0], ["http://127.0.0.1:19081/quota", "Bearer synthetic-key"]);
});

test("usage --json: a proxy that does not answer is a quota_unavailable JSON error, exit 1", async () => {
  const { run } = await load("usage");
  const { ctx } = fakeCtx({ fetch: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:19081"); } });
  assert.deepEqual(await run(args(["usage"], { json: true }), ctx), {
    exitCode: 1,
    records: [{ kind: "json", value: { error: { type: "quota_unavailable", message: "connect ECONNREFUSED 127.0.0.1:19081" } } }],
  });
});

test("auth status: the quota answer decides logged_in, exit 0; a proxy that does not answer is logged_in false, exit 1", async () => {
  const { run } = await load("auth");
  const snapshot = { provider: "zai", balances: [], serverTime: 1700000000000, jwt: { ageHours: 2, issuedAt: 1700000000, extra: "dropped" } };
  const up = fakeCtx({ fetch: async () => answer(200, snapshot)() });
  assert.deepEqual(await run(args(["auth"]), up.ctx), {
    exitCode: 0, records: [{ kind: "json", value: { logged_in: true, errors: [], jwt: { ageHours: 2, issuedAt: 1700000000 } } }],
  });
  const rejected = fakeCtx({ fetch: async () => answer(401, { error: { code: 401 } })() });
  const { exitCode, records } = await run(args(["auth", "status"]), rejected.ctx);
  assert.deepEqual([exitCode, records[0].value.logged_in, records[0].value.jwt], [0, false, null], "a rejected login is reported, not a failed command");
  const down = fakeCtx({ fetch: async () => { throw new Error("connect ECONNREFUSED"); } });
  assert.deepEqual(await run(args(["auth", "status"]), down.ctx), {
    exitCode: 1, records: [{ kind: "json", value: { logged_in: false, error: "connect ECONNREFUSED" } }],
  });
});

/** A ctx whose proxy CLI (`bun run src/index.ts …`) is faked at spawnSync. */
function proxyCliCtx(result, extra = {}) {
  const calls = [];
  const fake = fakeCtx({
    kit: { root: KIT_ROOT, home: join(KIT_ROOT, "home"), proxySrc: join(KIT_ROOT, "zcode-proxy-src") },
    // resolveBun takes ZCODE_KIT_BUN when it names a native executable.
    env: { ZCODE_KIT_BUN: process.execPath },
    spawnSync: (cmd, cmdArgs, opts) => { calls.push({ cmd, args: cmdArgs, opts }); return result; },
    ...extra,
  });
  return { calls, ...fake };
}
const proxyCliArgs = (calls) => calls.map((c) => [c.cmd, c.args.slice(0, 2), c.args.slice(2), c.opts.cwd, c.opts.stdio]);
const viaProxyCli = (rest) => [process.execPath, ["run", "src/index.ts"], rest, join(KIT_ROOT, "zcode-proxy-src"), "inherit"];

test("auth login: the proxy CLI's exit code passes through (no exit status is 1); a blank --account is exit 2", async () => {
  const { run } = await load("auth");
  for (const status of [0, 1, 5]) {
    const { ctx, calls } = proxyCliCtx({ status });
    assert.deepEqual(await run(args(["auth", "login", "bigmodel"], { import: true, account: "work" }), ctx), { exitCode: status, records: [] });
    assert.deepEqual(proxyCliArgs(calls), [viaProxyCli(["auth", "login", "bigmodel", "--import", "--account", "work"])]);
  }
  // The proxy CLI runs with the per-spawn proxy environment (lib/proxy-env.mjs): an ambient egress proxy is not inherited.
  const ambient = proxyCliCtx({ status: 0 });
  ambient.ctx.env = { ...ambient.ctx.env, HTTPS_PROXY: "http://ambient.invalid:3128" };
  await run(args(["auth", "login"]), ambient.ctx);
  assert.equal(ambient.calls[0].opts.env.HTTPS_PROXY, undefined);
  assert.equal(ambient.calls[0].opts.env.ZCODE_KIT_BUN, process.execPath);
  const killed = proxyCliCtx({ status: null, signal: "SIGINT" });
  assert.deepEqual(await run(args(["auth", "login"]), killed.ctx), { exitCode: 1, records: [] });
  assert.deepEqual(proxyCliArgs(killed.calls)[0][2], ["auth", "login", "zai"], "zai is the default provider");
  for (const account of [true, "  "]) {
    const blank = proxyCliCtx({ status: 0 });
    assert.deepEqual(await run(args(["auth", "login"], { account }), blank.ctx), { exitCode: 2, records: [errLine("--account requires an account ID.\n")] });
    assert.equal(blank.calls.length, 0);
  }
});

test("auth logout: without --yes it explains and exits 2; with --yes it removes only the proxy credential, exit 0; unknown subcommands are exit 2", async () => {
  const { run } = await load("auth");
  const dir = mkdtempSync(join(tmpdir(), "cli-commands-auth-"));
  try {
    const credFile = join(dir, "credentials.json");
    const { ctx } = fakeCtx({ env: { ZCODE_PROXY_CREDENTIALS_PATH: credFile } });
    const scope = [out(`This removes the kit proxy's effective credential store: ${credFile}\n`), out("Your ZCode Desktop login and its data are NOT touched.\n")];
    writeFileSync(credFile, "{}\n");
    assert.deepEqual(await run(args(["auth", "logout"]), ctx), { exitCode: 2, records: [...scope, out("Re-run with --yes to confirm.\n")] });
    assert.deepEqual(await run(args(["auth", "logout"], { yes: true }), ctx), { exitCode: 0, records: [...scope, out(`removed ${credFile} (proxy-only credential)\n`)] });
    assert.deepEqual(await run(args(["auth", "logout"], { yes: true }), ctx), { exitCode: 0, records: [...scope, out("no proxy credential present\n")] });
    assert.deepEqual(await run(args(["auth", "frob"]), ctx), { exitCode: 2, records: [errLine("unknown auth subcommand: frob\n")] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accounts: the proxy CLI's exit code passes through for every forwarded subcommand (no exit status is 1)", async () => {
  const { run } = await load("accounts");
  for (const [positional, flags, forwarded] of [
    [["accounts"], {}, ["auth", "accounts"]],
    [["accounts"], { json: true, live: true }, ["auth", "accounts", "--json", "--live"]],
    [["accounts", "remove", "personal"], { yes: true }, ["auth", "accounts", "remove", "personal", "--yes"]],
    [["accounts", "pause", "work"], {}, ["auth", "accounts", "pause", "work"]],
    [["accounts", "resume", "work"], {}, ["auth", "accounts", "resume", "work"]],
    [["accounts", "unlock"], { force: true }, ["auth", "accounts", "unlock", "--force"]],
    [["accounts", "explain"], { model: "glm-5.3", operation: "inference", json: true }, ["auth", "accounts", "explain", "--model", "glm-5.3", "--operation", "inference", "--json"]],
    [["accounts", "doctor"], { json: true }, ["auth", "accounts", "doctor", "--json"]],
    [["accounts", "quota"], {}, ["auth", "accounts", "quota"]],
    [["accounts", "health"], { json: true }, ["auth", "accounts", "health", "--json"]],
  ]) {
    for (const status of [0, 1, 2, 4, 5]) {
      const { ctx, calls } = proxyCliCtx({ status });
      assert.deepEqual(await run(args(positional, flags), ctx), { exitCode: status, records: [] }, positional.join(" "));
      assert.deepEqual(proxyCliArgs(calls), [viaProxyCli(forwarded)]);
    }
    const killed = proxyCliCtx({ status: null, signal: "SIGTERM" });
    assert.deepEqual(await run(args(positional, flags), killed.ctx), { exitCode: 1, records: [] });
  }
});

test("accounts: a missing account id and an unknown subcommand are usage errors, exit 2, and start nothing", async () => {
  const { run } = await load("accounts");
  for (const sub of ["remove", "pause", "resume"]) {
    const { ctx, calls } = proxyCliCtx({ status: 0 });
    assert.deepEqual(await run(args(["accounts", sub]), ctx), { exitCode: 2, records: [errLine(`Usage: zcode-kit accounts ${sub} ID [--yes]\n`)] });
    assert.equal(calls.length, 0);
  }
  const { ctx, calls } = proxyCliCtx({ status: 0 });
  assert.deepEqual(await run(args(["accounts", "frob"]), ctx), {
    exitCode: 2,
    records: [errLine("Usage: zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes] | accounts unlock [--force]\n")],
  });
  assert.equal(calls.length, 0);
});

/** A temp kit (installed layout: no .git, state in the root) with the proxy config template. */
async function tempKit(t, { config = true } = {}) {
  const { createCtx } = await import(pathToFileURL(join(ROOT, "cli", "context.mjs")).href);
  const root = mkdtempSync(join(tmpdir(), "cli-commands-kit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  mkdirSync(home);
  // Assigned in place: key() and port() read the context object they were created with.
  const kit = Object.assign(createCtx(root, home), {
    stateDir: root, generated: join(root, "generated"), backupDir: join(root, "backups"), logDir: join(root, "logs"),
    config: join(root, "proxy", "config.yaml"), keyFile: join(root, ".proxykey"),
  });
  // The proxy's own yaml package parses the config (account-setup.mjs).
  kit.proxySrc = join(ROOT, "zcode-proxy-src");
  if (config) {
    mkdirSync(join(root, "proxy"));
    writeFileSync(kit.config, readFileSync(join(ROOT, "proxy", "config.example.yaml"), "utf8").replace(/^  port: \d+/m, "  port: 19082"));
  }
  return kit;
}

test("accounts disable with the rotator already off: exit 0, nothing spawned, no restart", async (t) => {
  const { run } = await load("accounts");
  const kit = await tempKit(t);
  const { ctx } = fakeCtx({ kit });
  assert.deepEqual(await run(args(["accounts", "disable"]), ctx), { exitCode: 0, records: [out("Account Rotator disabled. Saved accounts are kept.\n")] });
});

test("accounts enable whose account import fails: the error ends the command (exit 2 at the entry) and the setup lock is released", async (t) => {
  const { run } = await load("accounts");
  const kit = await tempKit(t);
  const { ctx, calls } = proxyCliCtx({ status: 1, stdout: "" }, { kit: { ...kit } });
  await assert.rejects(run(args(["accounts", "enable"]), ctx), /Cannot activate Account Rotator: current account import failed/);
  assert.deepEqual(proxyCliArgs(calls).map((c) => c[2]), [["auth", "accounts", "import-current"]]);
  assert.equal(existsSync(join(kit.backupDir, ".setup-lock")), false);
});

test("rollback: nothing recorded is exit 0; a transaction whose external step needs a manual undo is exit 1", async (t) => {
  const { run } = await load("rollback");
  const kit = await tempKit(t, { config: false });
  const { ctx } = fakeCtx({ kit });
  assert.deepEqual(await run(args(["rollback"]), ctx), { exitCode: 0, records: [out("nothing to roll back\n")] });
  const { beginTransaction } = await import(pathToFileURL(join(ROOT, "lib", "transaction.mjs")).href);
  const created = join(kit.home, "created-by-kit.json");
  const tx = beginTransaction(kit.backupDir, "fixture");
  tx.expectWrite(created, "{}\n");
  writeFileSync(created, "{}\n");
  tx.external("fixture registration", "run the fixture undo");
  tx.finish();
  assert.deepEqual(await run(args(["rollback"]), ctx), {
    exitCode: 1,
    records: [out(`removed (kit-created): ${created}\n`), out("manual undo required: fixture registration\n  -> run the fixture undo\n")],
  });
});

test("rollback <tx-id> of a fully undone transaction is exit 0", async (t) => {
  const { run } = await load("rollback");
  const kit = await tempKit(t, { config: false });
  const { beginTransaction } = await import(pathToFileURL(join(ROOT, "lib", "transaction.mjs")).href);
  const created = join(kit.home, "created-by-kit.json");
  const tx = beginTransaction(kit.backupDir, "fixture");
  tx.expectWrite(created, "{}\n");
  writeFileSync(created, "{}\n");
  const id = tx.finish();
  assert.deepEqual(await run(args(["rollback", id]), fakeCtx({ kit }).ctx), { exitCode: 0, records: [out(`removed (kit-created): ${created}\n`)] });
});

const UNINSTALL_SCOPE = [
  "out:Scope: removes KIT-OWNED integrations and artifacts. Your ZCode Desktop login,",
  "out:~/.zcode-proxy/credentials.json (shared credential store) and harness data are NOT deleted.",
];
const UNINSTALL_DONE = "out:Recorded kit files were rolled back. Unrecorded generated data, Codex sessions, proxy key and logs are preserved.";

test("uninstall: undoes the claude MCP registration of this copy and removes the kit's own shim, exit 0", async (t) => {
  const { run } = await load("uninstall");
  const kit = await tempKit(t, { config: false });
  const { beginTransaction } = await import(pathToFileURL(join(ROOT, "lib", "transaction.mjs")).href);
  const tx = beginTransaction(kit.backupDir, "fixture setup");
  tx.external('claude MCP server "zcode-harness" registered (user scope)', "claude mcp remove zcode-harness --scope user");
  tx.finish();
  const shim = join(kit.home, ".local", "bin", "zcode-kit");
  mkdirSync(join(shim, ".."), { recursive: true });
  writeFileSync(shim, `#!/usr/bin/env sh\nexec node "${join(kit.root, "cli", "zcode-kit.mjs")}" "$@"\n`);
  const commands = [];
  const serverJs = join(kit.mcpDir, "dist", "index.js");
  const { ctx, progress } = fakeCtx({
    kit,
    runCommandSync: (cmd, cmdArgs, opts) => {
      commands.push([cmd, ...cmdArgs, opts.stdio]);
      return cmdArgs[1] === "get" ? { status: 0, stdout: `zcode-harness:\n  Args: ${serverJs} --stdio\n` } : { status: 0 };
    },
  });
  assert.deepEqual(await run(args(["uninstall"]), ctx), { exitCode: 0, records: [] });
  assert.deepEqual(commands, [
    ["claude", "mcp", "get", "zcode-harness", "pipe"],
    ["claude", "mcp", "remove", "zcode-harness", "--scope", "user", "inherit"],
  ]);
  assert.equal(existsSync(shim), false);
  assert.equal(progress[2].replace(/tx-\S+/, "<tx>").replace(/rollback \S+:/, "rollback <tx>:"), "out:rollback <tx>: 0 restored, 0 removed, 0 conflict(s)");
  assert.deepEqual([...progress.slice(0, 2), ...progress.slice(3)], [...UNINSTALL_SCOPE, UNINSTALL_DONE, `out:removed kit-owned command shim: ${shim}`]);
});

test("uninstall: an external step it cannot undo, or a claude entry of another kit copy, leaves it incomplete or untouched", async (t) => {
  const { run } = await load("uninstall");
  const kit = await tempKit(t, { config: false });
  const { beginTransaction } = await import(pathToFileURL(join(ROOT, "lib", "transaction.mjs")).href);
  const tx = beginTransaction(kit.backupDir, "fixture setup");
  tx.external("fixture registration", "run the fixture undo");
  tx.finish();
  const foreignShim = join(kit.home, ".local", "bin", "zcode-kit");
  mkdirSync(join(foreignShim, ".."), { recursive: true });
  writeFileSync(foreignShim, "#!/usr/bin/env sh\nexec node /elsewhere/cli/zcode-kit.mjs \"$@\"\n");
  const { ctx, progress } = fakeCtx({ kit });
  assert.deepEqual(await run(args(["uninstall"]), ctx), { exitCode: 1, records: [] });
  assert.deepEqual(progress.slice(3), [
    "out:manual undo required: fixture registration\n  -> run the fixture undo",
    UNINSTALL_DONE,
    "err:uninstall incomplete: a file conflict or external registration remains (see output above).",
  ]);
  assert.equal(existsSync(foreignShim), true, "a shim of another installation is never removed");
});

test("integrate: a missing or unknown harness is a usage error, exit 2, before anything is loaded or written", async () => {
  const { run } = await load("integrate");
  for (const positional of [["integrate"], ["integrate", "vim"]]) {
    const { ctx, progress } = fakeCtx();
    assert.deepEqual(await run(args(positional), ctx), {
      exitCode: 2, records: [errLine(`unknown harness "${positional[1]}". Known: ${HARNESS_IDS}\n`)],
    });
    assert.deepEqual(progress, []);
  }
});

test("integrate --dry-run: what would be written is streamed, nothing is written, exit 0", async (t) => {
  const { run } = await load("integrate");
  const kit = await tempKit(t, { config: false });
  const { ctx, progress } = fakeCtx({ kit });
  assert.deepEqual(await run(args(["integrate", "opencode"], { "dry-run": true }), ctx), { exitCode: 0, records: [] });
  assert.deepEqual(progress.slice(0, 2), ["out:== integrate opencode: DRY RUN (no changes written) ==", "out:  detected: no"]);
  assert.ok(progress.length > 2, "the adapter's plan is shown");
  assert.deepEqual(readdirSync(kit.home), [], "a dry run writes nothing into HOME");
});

test("integrate from a source checkout without the opt-in is refused before any write (exit 2 at the entry)", async (t) => {
  const { run } = await load("integrate");
  const kit = await tempKit(t, { config: false });
  mkdirSync(join(kit.root, ".git"));
  const { ctx } = fakeCtx({ kit });
  await assert.rejects(run(args(["integrate", "omp"]), ctx), /refusing to write user configs from a source checkout/);
  assert.equal(existsSync(kit.backupDir), false, "no lock, no transaction");
});

test("run: a missing or unknown harness is a usage error, exit 2; a harness without a launcher fails (exit 2 at the entry)", async () => {
  const { run } = await load("run");
  for (const positional of [["run"], ["run", "vim"]]) {
    assert.deepEqual(await run(args(positional), fakeCtx().ctx), {
      exitCode: 2, records: [errLine(`unknown harness "${positional[1]}". Known: ${HARNESS_IDS}\n`)],
    });
  }
  await assert.rejects(run(args(["run", "omp"]), fakeCtx().ctx), /^Error: run: no launcher for "omp" \(use setup\/integrate instead\)$/);
});

// `run` through the entry over a mini kit: the preflight's manager start
// decides first (a foreign listener on the port is exit 3 and the harness
// never starts); with this kit's proxy answering, the harness's own exit
// code is the command's (0, 7, 130). POSIX: the fake harness is a shell script.
test("entry: run passes the preflight's refusal (3) and the harness's exit code (0, 7, 130) through", { skip: process.platform === "win32" ? "the fake harness is a POSIX shell script (Windows: run is covered by cli-audit's claude.cmd test)" : false }, async (t) => {
  const http = await import("node:http");
  const root = mkdtempSync(join(tmpdir(), "cli-commands-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const member of ["cli", "lib", "package.json"]) cpSync(join(ROOT, member), join(root, member), { recursive: true });
  // Ticket 43: the output module's token set and width core re-export the
  // shared files under zcode-proxy-src/src/tui — part of every real kit
  // layout, so the fixture kit carries them too.
  mkdirSync(join(root, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(ROOT, "zcode-proxy-src", "src", "tui", f), join(root, "zcode-proxy-src", "src", "tui", f));
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "logs")); mkdirSync(join(root, "generated"));
  for (const file of ["config.example.yaml", "zcode-proxy-manager.mjs"]) cpSync(join(ROOT, "proxy", file), join(root, "proxy", file));
  const home = join(root, "home"); mkdirSync(home);
  const bin = join(root, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "opencode"), `#!/bin/sh\nexit "$FAKE_HARNESS_EXIT"\n`);
  chmodSync(join(bin, "opencode"), 0o755);
  let identity = "ours";
  const server = http.createServer((req, res) => {
    if (identity === "foreign") return res.writeHead(401).end("someone else");
    if (req.headers.authorization !== "Bearer synthetic-key") return res.writeHead(401).end("{}");
    if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", provider: "zai" }));
    if (req.url === "/quota") return res.end(JSON.stringify({ provider: "zai", serverTime: 1, jwt: null, balances: [], errors: [] }));
    res.writeHead(404).end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  writeFileSync(join(root, ".proxykey"), "synthetic-key");
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  port: ${server.address().port}\n  proxyApiKey: "synthetic-key"\n`);
  const { spawn } = await import("node:child_process");
  const kitRun = (exit) => new Promise((resolve, reject) => {
    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ZCODE_KIT_SKIP_DEPS: "1", FAKE_HARNESS_EXIT: String(exit) };
    const child = spawn(process.execPath, [join(root, "cli", "zcode-kit.mjs"), "run", "opencode", "--", "--version"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
  for (const exit of [0, 7, 130]) {
    const res = await kitRun(exit);
    assert.equal(res.code, exit, res.stderr);
  }
  identity = "foreign";
  const refused = await kitRun(0);
  assert.equal(refused.code, 3, refused.stderr);
  assert.match(refused.stderr, /ZCode port occupied or key mismatched/);
});

// update over a temp kit: the PATH commands (git, npm) are faked at
// runCommandSync, the manager and the setup re-run at spawnSync, the release
// lookup at fetch.
async function updateKit(t, { checkout = true, manager = true, version = "1.0.0" } = {}) {
  const kit = await tempKit(t, { config: false });
  if (checkout) mkdirSync(join(kit.root, ".git"));
  mkdirSync(join(kit.root, "proxy"), { recursive: true });
  if (manager) writeFileSync(join(kit.root, "proxy", "zcode-proxy-manager.mjs"), "// fixture manager\n");
  writeFileSync(join(kit.root, "package.json"), JSON.stringify({ name: "zcode-agent-kit", version, repository: { url: "git+https://github.com/fixture/kit.git" } }));
  return kit;
}

/** git answers by subcommand; the manager and the setup re-run answer by their first argument. */
function updateCtx(kit, { git = {}, setup = 0, stop = 0, start = 0, fetch } = {}) {
  const commands = [];
  const spawned = [];
  const fake = fakeCtx({
    kit,
    runCommandSync: (cmd, cmdArgs, opts) => {
      commands.push([cmd, ...cmdArgs]);
      const answer = git[cmdArgs[0]] ?? { status: 0, stdout: "" };
      return typeof answer === "function" ? answer(cmdArgs, opts) : answer;
    },
    spawnSync: (cmd, cmdArgs, opts) => {
      const what = cmdArgs[0].endsWith("zcode-kit.mjs") ? `setup ${cmdArgs.slice(2).join(" ")}`.trim() : cmdArgs[1];
      spawned.push(what);
      if (what.startsWith("setup")) {
        assert.equal(opts.env.ZCODE_KIT_ALLOW_CHECKOUT, "1", "update is the checkout-write opt-in for its own setup run");
        return { status: setup };
      }
      return { status: what === "stop" ? stop : start };
    },
    ...(fetch ? { fetch } : {}),
  });
  return { commands, spawned, ...fake };
}

test("update --version: anything but a release tag is a usage error, exit 2, before git, npm or the network", async (t) => {
  const { run } = await load("update");
  const kit = await updateKit(t);
  for (const [version, detail] of [["latest", ' (got "latest")'], [true, ""]]) {
    const { ctx, commands, spawned, progress } = updateCtx(kit);
    assert.deepEqual(await run(args(["update"], { version }), ctx), { exitCode: 2, records: [] });
    assert.deepEqual(progress, [`err:update: --version expects a release tag like v0.2.11${detail}.`]);
    assert.deepEqual([commands, spawned], [[], []]);
  }
});

test("update (checkout): git missing, a dirty tree, a failed fetch, an unknown tag or a diverged history stop it before setup", async (t) => {
  const { run } = await load("update");
  const kit = await updateKit(t);
  for (const [git, flags, exitCode, message] of [
    [{ status: { error: new Error("spawn git ENOENT"), status: null } }, {}, 2, "update: cannot run git (spawn git ENOENT) — install git or re-run the installer."],
    [{ status: { status: 0, stdout: " M cli/zcode-kit.mjs\n" } }, {}, 2, "update: working tree has changes — commit or stash first (refusing to mix user changes into an update)."],
    [{ fetch: { status: 128 } }, {}, 128, "update: git fetch failed."],
    [{ "rev-parse": { status: 1, stdout: "" } }, { version: "v9.9.9" }, 2, "update: release tag v9.9.9 does not exist on origin."],
    [{ merge: { status: 1 } }, {}, 1, "update: fast-forward not possible (history diverged). Resolve manually — the kit never force-updates."],
  ]) {
    const { ctx, spawned, progress } = updateCtx(kit, { git });
    assert.deepEqual(await run(args(["update"], flags), ctx), { exitCode, records: [] }, message);
    assert.equal(progress.at(-1), `err:${message}`);
    assert.ok(!spawned.some((s) => s.startsWith("setup")), "setup never runs after a refusal");
  }
});

test("update (checkout): stop, fast-forward, setup, start; setup's 20 and 130 still restart the proxy and are the exit code", async (t) => {
  const { run } = await load("update");
  const kit = await updateKit(t);
  for (const [setup, exitCode] of [[0, 0], [20, 20], [130, 130]]) {
    const { ctx, commands, spawned } = updateCtx(kit, { setup });
    assert.deepEqual(await run(args(["update"], { harness: "omp", "no-mcp": true }), ctx), { exitCode, records: [] });
    assert.deepEqual(commands.map((c) => c.slice(0, 2).join(" ")), ["git status", "git fetch", "git merge"]);
    assert.deepEqual(commands[2], ["git", "merge", "--ff-only", "origin/main"]);
    assert.deepEqual(spawned, ["stop", "setup --harness omp --no-mcp", "start"]);
  }
  const pinned = updateCtx(kit);
  await run(args(["update"], { version: "0.2.11" }), pinned.ctx);
  assert.deepEqual(pinned.commands.at(-1), ["git", "merge", "--ff-only", "refs/tags/v0.2.11"]);
});

test("update (checkout): a failed setup is its exit code with no proxy start; a failed start is the manager's exit code (3, 4, 5)", async (t) => {
  const { run } = await load("update");
  const kit = await updateKit(t);
  const failedSetup = updateCtx(kit, { setup: 1 });
  assert.deepEqual(await run(args(["update"]), failedSetup.ctx), { exitCode: 1, records: [] });
  assert.deepEqual(failedSetup.spawned, ["stop", "setup"]);
  for (const start of [3, 4, 5]) {
    const { ctx, progress } = updateCtx(kit, { start, stop: 3 });
    assert.deepEqual(await run(args(["update"]), ctx), { exitCode: start, records: [] });
    assert.equal(progress.at(-1), "err:update: the proxy did not start — the kit files are updated; run `zcode-kit doctor` (the exit code carries the reason).");
    assert.ok(!progress.some((line) => line.includes("proxy stop reported")), "a foreign service on the port (stop exit 3) is not a stop failure");
  }
});

test("update (checkout) in a kit layout without the proxy manager skips the proxy start, exit 0", async (t) => {
  const { run } = await load("update");
  const kit = await updateKit(t, { manager: false });
  const { ctx, spawned, progress } = updateCtx(kit, { stop: 2 });
  assert.deepEqual(await run(args(["update"]), ctx), { exitCode: 0, records: [] });
  assert.deepEqual(spawned, ["stop", "setup"]);
  assert.ok(progress.includes("err:update: proxy stop reported exit 2 — continuing; the proxy may need a manual restart."));
  assert.equal(progress.at(-1), "out:update: no proxy manager in this kit layout — skipping the proxy start.");
});

test("update (release): an unresolvable latest release is exit 2; already at the latest release is exit 0 with nothing changed", async (t) => {
  const { run } = await load("update");
  const kit = await updateKit(t, { checkout: false, version: "1.2.3" });
  const offline = updateCtx(kit, { fetch: async () => { throw new Error("getaddrinfo ENOTFOUND api.github.com"); } });
  assert.deepEqual(await run(args(["update"]), offline.ctx), { exitCode: 2, records: [] });
  assert.deepEqual(offline.progress, [
    "err:update: could not resolve the latest release (getaddrinfo ENOTFOUND api.github.com).",
    "err:  Pin one explicitly: zcode-kit update --version vX.Y.Z",
  ]);
  const urls = [];
  const current = updateCtx(kit, { fetch: async (url) => { urls.push(url); return answer(200, { tag_name: "v1.2.3" })(); } });
  assert.deepEqual(await run(args(["update"]), current.ctx), { exitCode: 0, records: [] });
  assert.deepEqual(urls, ["https://api.github.com/repos/fixture/kit/releases/latest"]);
  assert.deepEqual(current.progress, ["out:update: already at v1.2.3 (latest). Nothing to do."]);
  assert.deepEqual(current.spawned, [], "the proxy is not stopped for a no-op");
});

// setup's 0, 20 (a harness failed) and 130 (Ctrl-C) are pinned through the
// entry by tests/harness-consent.test.mjs (spawned setup runs), its Node
// floor refusal (exit 2) by tests/node-floor.test.mjs; the module-level
// cases here are the refusals before anything is written.
test("setup: an unknown harness in --harness or ZCODE_KIT_HARNESSES is a usage error, exit 2, before anything is written", async (t) => {
  const { run } = await load("setup");
  const kit = await tempKit(t, { config: false });
  for (const [flags, env, source] of [[{ harness: "vim" }, {}, "--harness"], [{}, { ZCODE_KIT_HARNESSES: "omp,vim" }, "ZCODE_KIT_HARNESSES"]]) {
    const { ctx, progress } = fakeCtx({ kit, env });
    assert.deepEqual(await run(args(["setup"], flags), ctx), {
      exitCode: 2,
      records: [errLine(`unknown harness "vim" in ${source}. Known: ${HARNESS_IDS}, none (or auto for detection)\n`)],
    });
    assert.deepEqual(progress, []);
  }
  assert.deepEqual(readdirSync(kit.root).sort(), ["home"], "no lock, no transaction, no state");
});

test("setup: a bad --account-rotator answer and a source checkout without the opt-in are refused before any write (exit 2 at the entry)", async (t) => {
  const { run } = await load("setup");
  const kit = await tempKit(t, { config: false });
  await assert.rejects(run(args(["setup"], { "account-rotator": "maybe", harness: "none" }), fakeCtx({ kit }).ctx), /^Error: Account Rotator choice must be y or n/);
  mkdirSync(join(kit.root, ".git"));
  await assert.rejects(run(args(["setup"], { harness: "omp" }), fakeCtx({ kit }).ctx), /refusing to write user configs from a source checkout/);
  const opted = fakeCtx({ kit, env: { ZCODE_KIT_ALLOW_CHECKOUT: "1" } });
  // With the opt-in the guard lets setup through to its lock (held here, so it stops there).
  mkdirSync(kit.backupDir);
  const { acquireLock, releaseLock } = await import(pathToFileURL(join(ROOT, "lib", "transaction.mjs")).href);
  acquireLock(kit.backupDir);
  try {
    await assert.rejects(run(args(["setup"], { harness: "none" }), opted.ctx), /^Error: another setup is running/);
  } finally {
    releaseLock(join(kit.backupDir, ".setup-lock"));
  }
});

test("setup and update declare the Node support floor; no other command does", async () => {
  for (const name of ["help", "setup", "integrate", "run", "doctor", "status", "proxy", "models", "usage", "auth", "accounts", "update", "rollback", "uninstall"]) {
    const mod = await load(name);
    assert.equal(mod.nodeFloor === true, name === "setup" || name === "update", name);
  }
});

// ------------------------------------------- the contract: the entry only dispatches
// Every command the CLI had before the split (its switch and the 07 table),
// plus `help`. The dispatch table (cli/commands/index.mjs) maps each to its
// module; the entry parses, refuses below the Node floor, dispatches and
// renders, and holds no command body.
const ALL_COMMANDS = ["help", "setup", "integrate", "run", "doctor", "status", "proxy", "models", "usage", "auth", "accounts", "update", "rollback", "uninstall"];

test("every command dispatches through its module in cli/commands/, and every command the help text names is in the table", async () => {
  const { COMMANDS, UNKNOWN_COMMAND } = await load("index");
  assert.deepEqual(Object.keys(COMMANDS).sort(), [...ALL_COMMANDS].sort());
  for (const name of ALL_COMMANDS) {
    const mod = await load(name);
    assert.equal(COMMANDS[name], mod, `${name} → cli/commands/${name}.mjs`);
    assert.equal(typeof mod.run, "function", `${name} exports run(args, ctx)`);
  }
  assert.equal(UNKNOWN_COMMAND.run, (await load("help")).runUnknown);
  const { records } = await COMMANDS.help.run(args(["help"]), fakeCtx().ctx);
  const named = new Set([...records[0].text.matchAll(/zcode-kit (\w+)|\| (\w+) \[/g)].map((m) => m[1] ?? m[2]));
  for (const name of named) assert.ok(Object.hasOwn(COMMANDS, name), `the help text names "${name}"`);
  assert.ok(named.size >= 10, `the help-text scan is not vacuous (${[...named]})`);
});

test("the CLI entry has no command bodies left: it imports only parsing, the floor check, the dispatch table and rendering", () => {
  const source = readFileSync(join(ROOT, "cli", "zcode-kit.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const specs = [...source.matchAll(/^\s*import\s[^;]*?\sfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]).sort();
  assert.deepEqual(specs, [
    "../lib/node-floor.mjs", "../lib/process.mjs", "../lib/term/load.mjs", "./commands/index.mjs", "./context.mjs",
    "node:child_process", "node:fs", "node:url",
  ]);
  const functions = [...source.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(functions, ["commandCtx", "dispatch", "main", "parseArgs", "render"]);
  assert.doesNotMatch(source, /\bswitch\s*\(/, "no inline command switch");
  assert.doesNotMatch(source, /\bcmd[A-Z]\w*/, "no cmd* command bodies");
});

test("entry: help, --help on any command and an unknown command keep their streams and exit codes", async () => {
  const help = await cli(["help"]);
  assert.equal(help.code, 0);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /^zcode-kit — local ZCode provider for your own agent harnesses\n/);
  assert.deepEqual(await cli(["status", "--help"]), help);
  assert.deepEqual(await cli(["frobnicate"]), { code: 2, stdout: help.stdout, stderr: "unknown command: frobnicate\n" });
});

test("entry: usage errors of the migrated commands go to stderr only, exit 2", async () => {
  const known = "omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose";
  assert.deepEqual(await cli(["integrate", "vim"]), { code: 2, stdout: "", stderr: `unknown harness "vim". Known: ${known}\n` });
  assert.deepEqual(await cli(["run"]), { code: 2, stdout: "", stderr: `unknown harness "undefined". Known: ${known}\n` });
  assert.deepEqual(await cli(["auth", "frob"]), { code: 2, stdout: "", stderr: "unknown auth subcommand: frob\n" });
  assert.deepEqual(await cli(["accounts", "remove"]), { code: 2, stdout: "", stderr: "Usage: zcode-kit accounts remove ID [--yes]\n" });
  assert.deepEqual(await cli(["setup", "--harness", "vim"]), { code: 2, stdout: "", stderr: `unknown harness "vim" in --harness. Known: ${known}, none (or auto for detection)\n` });
  assert.deepEqual(await cli(["update", "--version", "latest"]), { code: 2, stdout: "", stderr: 'update: --version expects a release tag like v0.2.11 (got "latest").\n' });
});

test("uninstall on Windows removes the installer's zcode-kit.cmd + .ps1 pair only when the .ps1 points at this kit", async (t) => {
  const { run } = await load("uninstall");
  const kit = await tempKit(t, { config: false });
  const local = join(kit.root, "Local AppData");
  const apps = join(local, "Microsoft", "WindowsApps");
  mkdirSync(apps, { recursive: true });
  const cmd = join(apps, "zcode-kit.cmd");
  const ps1 = join(apps, "zcode-kit.ps1");
  const shimPair = (entry) => {
    writeFileSync(cmd, '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zcode-kit.ps1" %*\r\n');
    // install.ps1 writes the entry path as a single-quoted PowerShell string.
    writeFileSync(ps1, `& node '${entry.replaceAll("'", "''")}' @args\r\n`);
  };
  const windows = () => fakeCtx({ kit, platform: "win32", env: { LOCALAPPDATA: local } });
  shimPair("C:\\elsewhere\\cli\\zcode-kit.mjs");
  const foreign = windows();
  assert.deepEqual(await run(args(["uninstall"]), foreign.ctx), { exitCode: 0, records: [] });
  assert.deepEqual([existsSync(cmd), existsSync(ps1)], [true, true], "another installation's shims stay");
  shimPair(join(kit.root, "cli", "zcode-kit.mjs"));
  const ours = windows();
  assert.deepEqual(await run(args(["uninstall"]), ours.ctx), { exitCode: 0, records: [] });
  assert.deepEqual([existsSync(cmd), existsSync(ps1)], [false, false]);
  assert.equal(ours.progress.at(-1), `out:removed kit-owned command shims: ${cmd}`);
});
