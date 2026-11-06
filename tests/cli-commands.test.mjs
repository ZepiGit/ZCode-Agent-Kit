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

test("status: the manager's exit code is the command's, with no records (the manager prints)", async () => {
  const { run } = await load("status");
  for (const status of [0, 1, 3]) {
    const { ctx, calls } = managerCtx({ status });
    assert.deepEqual(await run(args(["status"]), ctx), { exitCode: status, records: [] });
    assert.deepEqual(calls.map((c) => [c.cmd, c.args, c.opts.stdio]), [["node-under-test", [MANAGER, "status"], "inherit"]]);
  }
});

test("status: a manager killed by a signal (no exit status) is exit 1; --json is forwarded", async () => {
  const { run } = await load("status");
  const { ctx, calls } = managerCtx({ status: null, signal: "SIGKILL" });
  assert.deepEqual(await run(args(["status"], { json: true }), ctx), { exitCode: 1, records: [] });
  assert.deepEqual(calls[0].args, [MANAGER, "status", "--json"]);
});

const PROXY_USAGE = "Usage: zcode-kit proxy start|stop|restart|status|logs [n]\n";

test("proxy: a missing or unknown subcommand is a usage error, exit 2 on stderr, and starts nothing", async () => {
  const { run } = await load("proxy");
  for (const positional of [["proxy"], ["proxy", "bogus"]]) {
    const { ctx, calls } = managerCtx({ status: 0 });
    assert.deepEqual(await run(args(positional), ctx), { exitCode: 2, records: [{ kind: "text", stream: "stderr", text: PROXY_USAGE }] });
    assert.equal(calls.length, 0);
  }
});

test("proxy start|stop|restart|status: the manager's exit codes 0-5 pass through; no exit status is 2", async () => {
  const { run } = await load("proxy");
  for (const sub of ["start", "stop", "restart", "status"]) {
    for (const status of [0, 1, 2, 3, 4, 5]) {
      const { ctx, calls } = managerCtx({ status });
      assert.deepEqual(await run(args(["proxy", sub]), ctx), { exitCode: status, records: [] });
      assert.deepEqual(calls.map((c) => [c.args, c.opts.stdio]), [[[MANAGER, sub], "inherit"]]);
    }
    const { ctx } = managerCtx({ status: null, error: new Error("spawn failed") });
    assert.deepEqual(await run(args(["proxy", sub]), ctx), { exitCode: 2, records: [] });
  }
});

test("proxy status --json is forwarded; --json on other subcommands is not", async () => {
  const { run } = await load("proxy");
  const status = managerCtx({ status: 0 });
  await run(args(["proxy", "status"], { json: true }), status.ctx);
  assert.deepEqual(status.calls[0].args, [MANAGER, "status", "--json"]);
  const start = managerCtx({ status: 0 });
  await run(args(["proxy", "start"], { json: true }), start.ctx);
  assert.deepEqual(start.calls[0].args, [MANAGER, "start"]);
});

test("proxy logs [n]: the line count is forwarded as given and the manager's exit code is kept", async () => {
  for (const [name, positional, expected] of [
    ["proxy", ["proxy", "logs"], [MANAGER, "logs"]],
    ["proxy", ["proxy", "logs", "50"], [MANAGER, "logs", "50"]],
    ["logs", ["proxy", "logs", "7"], [MANAGER, "logs", "7"]],
  ]) {
    const { run } = await load(name);
    const { ctx, calls } = managerCtx({ status: 1 });
    assert.deepEqual(await run(args(positional), ctx), { exitCode: 1, records: [] });
    assert.deepEqual(calls.map((c) => [c.args, c.opts.stdio]), [[expected, "inherit"]]);
  }
  const { run } = await load("logs");
  const { ctx } = managerCtx({ status: null, signal: "SIGTERM" });
  assert.deepEqual(await run(args(["proxy", "logs"]), ctx), { exitCode: 2, records: [] });
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
// kit integration anywhere) with the manager's own `doctor` faked at the
// spawn boundary.
const HARNESS_IDS = "omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose";

async function doctorCtx(managerResult) {
  const { createCtx } = await import(pathToFileURL(join(ROOT, "cli", "context.mjs")).href);
  const root = mkdtempSync(join(tmpdir(), "cli-commands-doctor-"));
  const home = join(root, "home");
  mkdirSync(home);
  const kit = { ...createCtx(root, home), stateDir: root, generated: join(root, "generated"), backupDir: join(root, "backups") };
  const calls = [];
  return {
    calls,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    ctx: {
      kit,
      env: {},
      execPath: "node-under-test",
      spawnSync: (cmd, cmdArgs, opts) => { calls.push({ cmd, args: cmdArgs, opts }); return managerResult; },
      fetch: () => Promise.reject(new Error("no network in this test")),
      progress: () => assert.fail("doctor without --fix streams nothing"),
    },
  };
}
const texts = (records) => records.map((r) => { assert.equal(r.kind, "text"); return `${r.stream}:${r.text}`; });

test("doctor: unknown --harness ids are a usage error, exit 2 on stderr, before anything runs", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx({ status: 0, stdout: "" });
  try {
    assert.deepEqual(await run(args(["doctor"], { harness: "omp,nope" }), d.ctx), {
      exitCode: 2,
      records: [{ kind: "text", stream: "stderr", text: `unknown harness "nope". Known: ${HARNESS_IDS}\n` }],
    });
    assert.equal(d.calls.length, 0);
  } finally { d.cleanup(); }
});

test("doctor: a clean manager and only unconsented harnesses is exit 0; the manager's report comes first, verbatim", async () => {
  const { run } = await load("doctor");
  const manager = "PASS  proxy running — pid 4242\nPASS  key file — present\n";
  const d = await doctorCtx({ status: 0, stdout: manager });
  try {
    const { exitCode, records } = await run(args(["doctor"]), d.ctx);
    assert.equal(exitCode, 0);
    const lines = texts(records);
    assert.equal(lines[0], `stdout:${manager}`);
    assert.deepEqual(lines.slice(1, 3), ["stdout:PASS  proxy running — pid 4242\n", "stdout:PASS  key file — present\n"]);
    assert.equal(lines.length, 3 + 10 + 1, "one row per harness, then the summary");
    for (const line of lines.slice(3, 13)) assert.match(line, /^stdout:SKIP {2}[a-z-]+: integration — /);
    assert.equal(lines.at(-1), "stdout:doctor: 10 skipped, 0 failed — OK\n");
    assert.deepEqual(d.calls.map((c) => [c.cmd, c.args, c.opts.encoding]), [["node-under-test", [join(d.ctx.kit.root, "proxy", "zcode-proxy-manager.mjs"), "doctor"], "utf8"]]);
  } finally { d.cleanup(); }
});

test("doctor: a FAIL from the manager is exit 1 and counted in the summary", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx({ status: 1, stdout: "FAIL  proxy running — not running\n" });
  try {
    const { exitCode, records } = await run(args(["doctor"]), d.ctx);
    assert.equal(exitCode, 1);
    assert.equal(texts(records).at(-1), "stdout:doctor: 1 check(s) failed\n");
  } finally { d.cleanup(); }
});

test("doctor: a manager that times out, or fails without a FAIL row, still fails the report (exit 1)", async () => {
  const { run } = await load("doctor");
  for (const [result, detail] of [
    [{ status: null, signal: "SIGTERM", error: new Error("ETIMEDOUT"), stdout: "" }, "manager check failed or timed out"],
    [{ status: 3, stdout: "PASS  proxy running — pid 1\n" }, "manager check exited 3 without a diagnostic failure result"],
  ]) {
    const d = await doctorCtx(result);
    try {
      const { exitCode, records } = await run(args(["doctor"]), d.ctx);
      assert.equal(exitCode, 1);
      assert.ok(texts(records).includes(`stdout:FAIL  manager doctor completed — ${detail}\n`), detail);
    } finally { d.cleanup(); }
  }
});

test("doctor --harness codex verifies a requested harness without consent: its missing artifact fails, exit 1", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx({ status: 0, stdout: "PASS  proxy running — pid 1\n" });
  try {
    const { exitCode, records } = await run(args(["doctor"], { harness: "codex" }), d.ctx);
    assert.equal(exitCode, 1);
    assert.deepEqual(texts(records).slice(1), [
      "stdout:PASS  proxy running — pid 1\n",
      "stdout:FAIL  codex: codex adapter artifact — generated/codex-home/config.toml\n",
      "stdout:doctor: 1 check(s) failed\n",
    ]);
  } finally { d.cleanup(); }
});

test("doctor --json: one JSON record (the manager's text is not echoed), exit code as in text mode", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx({ status: 1, stdout: "FAIL  proxy running — not running\nSKIP  solver — idle\n" });
  try {
    const { exitCode, records } = await run(args(["doctor"], { json: true }), d.ctx);
    assert.equal(exitCode, 1);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "json");
    const { ok, failed, skipped, checks } = records[0].value;
    assert.deepEqual([ok, failed, skipped], [false, 1, 11]);
    assert.deepEqual(checks.slice(0, 2), [
      { name: "proxy running", ok: false, detail: "not running" },
      { name: "solver", ok: null, detail: "idle" },
    ]);
  } finally { d.cleanup(); }
});

test("doctor --forget: a missing or unknown id is a usage error (exit 2); an id with nothing stored is exit 0", async () => {
  const { run } = await load("doctor");
  const d = await doctorCtx({ status: 0, stdout: "" });
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
    assert.equal(d.calls.length, 0, "--forget never asks the manager");
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
