// Ticket 83: public capability/prompter/output seams, never private parser state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createHook } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import * as capabilities from "../lib/term/caps.mjs";
import { emitKeypressEvents } from "node:readline";
import { createOutput, renderRecords } from "../lib/term/out.mjs";
import { setupUi } from "../cli/setup-output.mjs";
import { C3_VARIANTS, matchSnapshot } from "./snapshot-harness.mjs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort } from "./free-port.mjs";

const FIXTURE_PORT = await freePort();
function fixtureSetup(t, args = [], harnesses = "none", { failure = false, env: extraEnv = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "t83-setup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state);
  const kit = join(import.meta.dirname, "..");
  writeFileSync(join(state, ".owner.json"), JSON.stringify({ root: kit }));
  mkdirSync(join(state, "proxy"));
  writeFileSync(join(state, "proxy/config.yaml"), `server:\n  host: "127.0.0.1"\n  port: ${FIXTURE_PORT}\n  proxyApiKey: "synthetic-t83-key"\nauth:\n  accounts:\n    enabled: false\n`);
  writeFileSync(join(state, ".proxykey"), "synthetic-t83-key\n");
  if (failure) { mkdirSync(join(home, ".config/opencode"), { recursive: true }); writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ provider: { zcode: { name: "foreign", options: { baseURL: "https://invalid.example/v1" } } } })); }
  let stdout, code = 0;
  try { stdout = execFileSync(process.execPath, [join(kit, "cli/zcode-kit.mjs"), "setup", ...args, "--account-rotator", "n"], {
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"),
      ZCODE_KIT_STATE_DIR: state, ZCODE_KIT_SKIP_DEPS: "1", ZCODE_KIT_SKIP_SMOKE: "1", ZCODE_KIT_ALLOW_CHECKOUT: "1",
      ZCODE_KIT_HARNESSES: harnesses, PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin", CI: "true", ...extraEnv },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }); } catch (err) { code = err.status; stdout = err.stdout; if (!failure) throw err; }
  return { stdout, code, home, state, kit, log: readFileSync(join(state, "logs/install.log"), "utf8") };
}

test("completed setup includes five base commands last in stdout and one plain log copy, also in installer mode", (t) => {
  for (const args of [[], ["--verbose"], ["--installer"]]) {
    const result = fixtureSetup(t, args);
    assert.equal(result.stdout.match(/Next steps/g)?.length, 1);
    assert.equal(result.log.match(/Next steps/g)?.length, 1);
    assert.equal(result.stdout.match(/^  zcode-kit /gm)?.length, 5);
    assert.ok(result.stdout.endsWith("  zcode-kit --help        Browse all commands\n"));
    assert.doesNotMatch(result.stdout, /zcode-kit run /);
    assert.doesNotMatch(result.log.split("Next steps")[1], /\x1b/);
  }
});

import { createPrompter, ABORTED, decideHarness, recordHarnessChoice, readHarnessChoices } from "../cli/harness-consent.mjs";
import { beginTransaction } from "../lib/transaction.mjs";
import { displayWidth } from "../lib/term/width.mjs";

const UTF8 = { TERM: "xterm-256color", LANG: "C.UTF-8" };
async function interactiveSetup(context, keys, { reask = false, seed, noMcp = false, lockedMcp = false, owned = false } = {}) {
  const fixture = fixtureSetup(context, [], owned ? "codex" : "none");
  rmSync(join(fixture.state, "generated/harness-choices/codex.json"), { force: true });
  mkdirSync(join(fixture.home, ".codex"));
  if (seed) {
    mkdirSync(join(fixture.state, "generated/harness-choices"), { recursive: true });
    writeFileSync(join(fixture.state, "generated/harness-choices/codex.json"), seed);
  }
  if (lockedMcp) {
    mkdirSync(join(fixture.home, ".omp/agent"), { recursive: true });
    writeFileSync(join(fixture.home, ".omp/agent/models.yml"), "providers:\n  openai:\n    name: OpenAI\n");
    writeFileSync(join(fixture.home, ".omp/agent/config.yml"), "extensions: []\n");
    mkdirSync(join(fixture.state, "generated/harness-choices"), { recursive: true });
    writeFileSync(join(fixture.state, "generated/harness-choices/omp.json"), JSON.stringify({ schema: 1, harness: "omp", decision: "configured", source: "fixture", decidedAt: "old", mcp: true }));
  }
  const extraArgs = [...(reask ? ["--reask"] : []), ...(noMcp ? ["--no-mcp"] : [])];
  const entry = pathToFileURL(join(fixture.kit, "cli/zcode-kit.mjs")).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.stdin.isTTY = true; process.stderr.isTTY = true;
    process.stderr.columns = 120; process.stderr.rows = 150;
    process.stdin.isRaw = false;
    process.stdin.setRawMode = function(raw) { this.isRaw = raw; return this; };
    process.argv = [process.execPath, ${JSON.stringify(join(fixture.kit, "cli/zcode-kit.mjs"))}, "setup", "--harness", "auto", "--account-rotator", "n", ...${JSON.stringify(extraArgs)}];
    await import(${JSON.stringify(entry)});
  `], { detached: process.platform !== "win32", env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, XDG_CONFIG_HOME: join(fixture.home, ".config"),
    ZCODE_KIT_STATE_DIR: fixture.state, ZCODE_KIT_ALLOW_CHECKOUT: "1", ZCODE_KIT_SKIP_DEPS: "1", ZCODE_KIT_SKIP_SMOKE: "1",
    ZCODE_KIT_HARNESSES: "auto", ZCODE_KIT_ACCOUNT_ROTATOR: "n", TERM: "xterm-256color", LANG: "C.UTF-8", CI: "false",
    NO_COLOR: "", PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (s) => { stdout += s; }); child.stderr.on("data", (s) => { stderr += s; });
  const completion = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  const timeout = setTimeout(() => { if (process.platform === "win32") child.kill(); else process.kill(-child.pid, "SIGKILL"); }, 10000);
  console.log(`owned fixture child pid=${child.pid} pgid=${process.platform === "win32" ? "job-inherited" : child.pid}`);
  try {
    for (let i = 0; i < 500 && !stderr.includes("editable checked"); i++) await delay(5);
    assert.match(stderr, /editable checked/);
    await turn(); if (keys === "") child.stdin.end(); else child.stdin.write(keys);
    const code = await completion;
    return { ...fixture, stdout, stderr, code, log: readFileSync(join(fixture.state, "logs/install.log"), "utf8") };
  } finally {
    clearTimeout(timeout); child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") child.kill(); else process.kill(-child.pid, "SIGKILL");
      await completion;
    }
  }
}

test("actual setup selector applies only confirmed batch and Ctrl-C writes no provisional choice", async (context) => {
  const confirmed = await interactiveSetup(context, " \r");
  assert.equal(confirmed.code, 0, confirmed.stderr);
  assert.match(confirmed.stdout, /zcode-kit run codex/);
  assert.equal(readHarnessChoices({ generated: join(confirmed.state, "generated") }).harnesses.codex.decision, "configured");
  const abort = await interactiveSetup(context, " \x03");
  assert.equal(abort.code, 130, abort.stderr);
  assert.equal(readHarnessChoices({ generated: join(abort.state, "generated") }).harnesses.codex, undefined);
  assert.doesNotMatch(abort.stdout, /Next steps/);
  assert.doesNotMatch(abort.log, /Next steps/);
});

test("setup reask none preserves saved yes but skips unowned this run; unreadable yes is run-only; no-mcp veto keeps locked bytes", async (context) => {
  const seed = JSON.stringify({ schema: 1, harness: "codex", decision: "configured", source: "fixture", decidedAt: "old", mcp: true }) + "\n";
  const absent = await interactiveSetup(context, "\x1b", { reask: true, seed });
  assert.equal(absent.code, 0, absent.stderr);
  assert.equal(readFileSync(join(absent.state, "generated/harness-choices/codex.json"), "utf8"), seed);
  assert.equal(existsSync(join(absent.state, "generated/codex-home/config.toml")), false);
  assert.doesNotMatch(absent.stdout, /^  zcode-kit run /m);
  const bad = await interactiveSetup(context, " \r", { seed: "{unsupported" });
  assert.equal(bad.code, 0, bad.stderr);
  assert.equal(readFileSync(join(bad.state, "generated/harness-choices/codex.json"), "utf8"), "{unsupported");
  assert.match(bad.stdout, /zcode-kit run codex/);
  const veto = await interactiveSetup(context, " \r", { lockedMcp: true, noMcp: true });
  assert.equal(veto.code, 0, veto.stderr);
  assert.equal(existsSync(join(veto.home, ".omp/agent/mcp.json")), false);
  assert.equal(readHarnessChoices({ generated: join(veto.state, "generated") }).harnesses.omp.mcp, true);
  assert.doesNotMatch(veto.stderr, /Selecting OMP/);
});

test("real setup absent reask actions preserve owned/unowned/unreadable choice bytes", async (context) => {
  for (const ending of ["\x1b", "\r", ""]) for (const owned of [false, true]) for (const stored of [undefined, "configured", "skipped", "unreadable"]) {
    const seed = stored === "unreadable" ? "{unsupported" : stored ? JSON.stringify({ schema: 1, decision: stored, source: "fixture", decidedAt: "old", mcp: true }) + "\n" : undefined;
    // A saved yes is prechecked under reask: clear it for an empty Enter.
    const keys = ending === "\r" && stored === "configured" ? " \r" : ending;
    const r = await interactiveSetup(context, keys, { reask: true, seed, owned });
    assert.equal(r.code, 0, r.stderr);
    const file = join(r.state, "generated/harness-choices/codex.json");
    assert.equal(existsSync(file), seed !== undefined);
    if (seed !== undefined) assert.equal(readFileSync(file, "utf8"), seed);
    if (owned && stored !== "unreadable") assert.match(r.stdout, /Codex CLI — existing kit integration refreshed/);
    else assert.match(r.stdout, /SKIP +Codex CLI/);
    assert.doesNotMatch(r.stdout, /^  zcode-kit run /m);
  }
});

test("completed setup stdout/stderr/log match accepted43 byte-for-byte apart from the exact additive suffix", (t) => {
  const fixture = fixtureSetup(t);
  const absoluteImports = (source, base) => source.replace(/(from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\2/g, (_, lead, quote, path) => `${lead}${JSON.stringify(new URL(path, base).href)}`);
  const data = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const oldConsent = data(absoluteImports(readFileSync(new URL("./fixtures/onboarding-accepted43-consent.mjs.txt", import.meta.url), "utf8"), new URL("../cli/harness-consent.mjs", import.meta.url)));
  const oldOutput = data(absoluteImports(readFileSync(new URL("./fixtures/onboarding-accepted43-output.mjs.txt", import.meta.url), "utf8"), new URL("../cli/setup-output.mjs", import.meta.url)));
  const setupBase = new URL("../cli/commands/setup.mjs", import.meta.url);
  const oldSetup = data(absoluteImports(readFileSync(new URL("./fixtures/onboarding-accepted43-setup.mjs.txt", import.meta.url), "utf8"), setupBase)
    .replace(JSON.stringify(new URL("../harness-consent.mjs", setupBase).href), JSON.stringify(oldConsent))
    .replace(JSON.stringify(new URL("../setup-output.mjs", setupBase).href), JSON.stringify(oldOutput)));
  for (const scenario of [{ flags: {}, selection: "none" }, { flags: { harness: "codex" }, selection: "none" }, { flags: { select: true }, selection: "auto" }, { flags: { verbose: true, installer: true }, selection: "none" }]) {
    const run = (entry) => {
      for (const name of ["generated", "backups", "logs"]) rmSync(join(fixture.state, name), { recursive: true, force: true });
      const script = `
        import crypto from 'node:crypto'; import { syncBuiltinESMExports } from 'node:module';
        crypto.randomBytes = (n) => Buffer.alloc(n, 1); syncBuiltinESMExports();
        const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : ['2026-11-10T00:00:00.000Z'])); } static now() { return 1794268800000; } };
        const { createCtx } = await import(${JSON.stringify(new URL("../cli/context.mjs", import.meta.url).href)});
        const { runCommandSync } = await import(${JSON.stringify(new URL("../lib/process.mjs", import.meta.url).href)});
        const { run } = await import(${JSON.stringify(entry)});
        const result = await run({flags: ${JSON.stringify({ ...scenario.flags, "account-rotator": "n" })}}, {kit:createCtx(${JSON.stringify(fixture.kit)}), env:process.env, execPath:process.execPath, platform:process.platform, runCommandSync, fetch:() => { throw new Error('offline fixture'); }});
        process.exitCode = result.exitCode;
      `;
      // A file avoids Windows' command-line length limit for the pinned source.
      const driver = join(fixture.home, "preservation-driver.mjs"); writeFileSync(driver, script);
      const result = spawnSync(process.execPath, [driver], { encoding: "utf8", env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, XDG_CONFIG_HOME: join(fixture.home, ".config"), ZCODE_KIT_STATE_DIR: fixture.state, ZCODE_KIT_SKIP_DEPS: "1", ZCODE_KIT_SKIP_SMOKE: "1", ZCODE_KIT_ALLOW_CHECKOUT: "1", ZCODE_KIT_HARNESSES: scenario.selection, CI: "true", NO_COLOR: "1", PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin" } });
      assert.equal(result.status, 0, result.stderr);
      return { stdout: result.stdout, stderr: result.stderr, log: readFileSync(join(fixture.state, "logs/install.log"), "utf8") };
    };
    const baseline = run(oldSetup), current = run(setupBase.href);
    const rows = [...BASE];
    if (scenario.flags.harness === "codex") rows.splice(1, 0, { command: "zcode-kit run codex", description: "Launch Codex CLI wired to ZCode" });
    const suffix = createOutput({ stdout: capture(), stderr: capture(), env: {} }).commandsText(rows, { title: "Next steps" });
    assert.ok(current.stdout.endsWith(suffix)); assert.ok(current.log.endsWith(suffix));
    assert.equal(current.stdout.slice(0, -suffix.length), baseline.stdout);
    assert.equal(current.stderr, baseline.stderr);
    assert.equal(current.log.slice(0, -suffix.length), baseline.log);
  }
});

test("launch overview uses real successful consented outcomes only, and any failure suppresses launch", (t) => {
  for (const id of ["claude-code", "codex", "opencode", "aider"]) {
    const r = fixtureSetup(t, [], id);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.match(/^  zcode-kit /gm).length, 6);
    assert.match(r.stdout, new RegExp(`^  zcode-kit run ${id} +Launch .+ wired to ZCode$`, "m"));
    assert.doesNotMatch(r.stdout, /synthetic-t83-key/);
  }
  for (const id of ["omp", "pi", "continue", "goose", "cline", "kilo-code"]) {
    const r = fixtureSetup(t, [], id);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.match(/^  zcode-kit /gm).length, 5, id);
    assert.doesNotMatch(r.stdout, /^  zcode-kit run /m);
  }
  const first = fixtureSetup(t, [], "aider,codex,claude-code,opencode");
  assert.match(first.stdout, /^  zcode-kit run claude-code /m);
  const failed = fixtureSetup(t, [], "codex,opencode", { failure: true });
  assert.equal(failed.code, 20);
  assert.equal(failed.stdout.match(/^  zcode-kit /gm).length, 5);
  assert.doesNotMatch(failed.stdout, /^  zcode-kit run /m);
  const envVerbose = fixtureSetup(t, [], "none", { env: { ZCODE_KIT_VERBOSE: "1" } });
  assert.equal(envVerbose.log.match(/Next steps/g).length, 1);
});

const BASE = [
  { command: "zcode-kit doctor", description: "Check the installation" },
  { command: "zcode-kit proxy start", description: "Start the proxy for manual clients" },
  { command: "zcode-kit proxy status", description: "Check proxy health and connection details" },
  { command: "zcode-kit auth status", description: "Check sign-in status" },
  { command: "zcode-kit --help", description: "Browse all commands" },
];
function capture(tty = false, columns = 80) {
  let text = "";
  return { isTTY: tty, columns, write(chunk) { text += chunk; return true; }, text: () => text };
}
test("described commands keep indivisible commands intact on narrow terminals and remain plain with forced color in scripts", () => {
  for (const columns of [12, 32, 40, 80, 120]) {
    const stdout = capture(true, columns), stderr = capture();
    createOutput({ stdout, stderr, env: { ...UTF8, NO_COLOR: "1" } }).commands(BASE, { title: "Next steps" });
    for (const row of BASE) assert.ok(stdout.text().includes(`  ${row.command}`));
    if (columns >= 40) for (const line of stdout.text().split("\n")) assert.ok(displayWidth(line) <= columns);
  }
  for (const env of [{ TERM: "dumb" }, { CI: "true", TERM: "xterm" }]) {
    const stdout = capture(true), stderr = capture();
    createOutput({ stdout, stderr, env, flags: { color: "always" } }).commands(BASE, { title: "Next steps" });
    assert.doesNotMatch(stdout.text(), /\x1b/);
  }
});

test("described commands are copyable, validated before both sinks and suppressed as a whole in JSON", () => {
  const stdout = capture(), stderr = capture();
  const out = createOutput({ stdout, stderr, env: {} });
  out.commands(BASE, { title: "Next steps" });
  assert.equal(stdout.text().split("\n").filter((s) => /^  zcode-kit /.test(s)).length, 5);
  assert.match(stdout.text(), /^\nNext steps -{69}\n/);
  assert.equal(stderr.text(), "");
  const json = capture();
  createOutput({ stdout: json, stderr, json: true }).commands(BASE, { title: "Next steps" });
  assert.equal(json.text(), "");
  for (const bad of ["", "x\ny", "x\rx", "x\x1by", "x\u0000y"]) {
    const sink = capture(); const renderer = createOutput({ stdout: sink, stderr });
    assert.throws(() => renderer.commands([{ command: bad, description: "safe" }]), TypeError);
    assert.throws(() => renderRecords(renderer, [{ kind: "heading", title: "must not leak" }, { kind: "commands", rows: BASE, note: bad }]), TypeError);
    assert.equal(sink.text(), "");
  }
  const log = [], screen = capture();
  const ui = setupUi({ out: createOutput({ stdout: screen, stderr }), log: (s) => log.push(s), stdout: screen, stderr });
  ui.commands(BASE, { title: "Next steps" });
  assert.equal(log.filter((s) => s.includes("Next steps")).length, 1);
  assert.equal(log.at(-1) + "\n", stdout.text());
  assert.equal(screen.text().match(/Next steps/g).length, 1);
});

const turn = () => new Promise(setImmediate);
function terminal() {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  output.columns = 120; output.rows = 150;
  let text = "";
  output.on("data", (chunk) => { text += chunk; });
  const prompter = createPrompter({ input, output, env: UTF8 });
  return { input, output, prompter, text: () => text, async ready() {
    for (let i = 0; i < 100 && !text.includes("editable checked"); i++) await turn();
    assert.match(text, /editable checked/);
    await turn();
  }, close() { prompter.close(); input.destroy(); output.destroy(); } };
}

for (const [name, variant] of Object.entries(C3_VARIANTS)) test(`selector or exact line fallback for C3 ${name}`, async () => {
  const t = terminal();
  t.input.isTTY = variant.tty; t.output.isTTY = variant.tty;
  t.output.columns = variant.columns;
  const prompter = createPrompter({ input: t.input, output: t.output, env: variant.env, platform: variant.platform });
  try {
    const pending = prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
    if (["pipe", "ci", "term-dumb", "no-color"].includes(name)) {
      assert.equal(await pending, null); assert.equal(t.text(), ""); assert.equal(t.input.isRaw, false);
    } else {
      await t.ready();
      const pointer = name === "ascii" ? ">" : name === "wgl4" ? "►" : "▸";
      assert.ok(t.text().includes(`  ${pointer} [ ] Codex CLI`));
      t.input.write(" \r"); assert.equal((await pending).answers.get("codex"), true);
    }
  } finally { prompter.close(); t.close(); }
});

test("stdin/stderr asymmetry gates interaction independently of stdout", async () => {
  for (const [stdin, stderr] of [[false, true], [true, false], [false, false]]) {
    const t = terminal(); t.input.isTTY = stdin; t.output.isTTY = stderr;
    const prompter = createPrompter({ input: t.input, output: t.output, env: UTF8 });
    try { assert.equal(prompter.interactive, false); assert.equal(await prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] }), null); }
    finally { prompter.close(); t.close(); }
  }
});

test("automatic checklist discloses consequences before fast Space+Enter and returns editable answers only", async () => {
  const t = terminal();
  try {
    const result = t.prompter.selectHarnesses({ rows: [
      { id: "pi", label: "pi", stored: "configured", owned: true },
      { id: "codex", label: "Codex CLI", owned: false },
      { id: "aider", label: "Aider", owned: true },
    ] });
    await t.ready();
    assert.match(t.text(), /Saved choices are locked/);
    assert.match(t.text(), /skips Codex CLI for this run/);
    assert.match(t.text(), /refreshes the existing kit integration for Aider/);
    t.input.write(" \r");
    const batch = await result;
    assert.deepEqual([...batch.answers], [["codex", true], ["aider", false]]);
    assert.equal(t.input.isRaw, false);
  } finally { t.close(); }
});

test("nonempty reask matrix records only readable answers; undisclosed MCP and unknown records remain unchanged", async () => {
  for (const stored of [undefined, "configured", "skipped"]) for (const owned of [false, true]) for (const unreadable of [false, true]) for (const checked of [false, true]) {
    const t = terminal(), root = mkdtempSync(join(tmpdir(), "t83-confirmed-"));
    const ctx = { generated: join(root, "generated"), backupDir: join(root, "backups"), dryRun: false };
    mkdirSync(join(ctx.generated, "harness-choices"), { recursive: true }); mkdirSync(ctx.backupDir);
    const file = join(ctx.generated, "harness-choices/codex.json"), unknown = join(ctx.generated, "harness-choices/unknown.json");
    const bytes = unreadable ? "{unreadable" : stored ? JSON.stringify({ schema: 1, decision: stored, source: "old", decidedAt: "old", mcp: true }) : null;
    if (bytes !== null) writeFileSync(file, bytes);
    writeFileSync(unknown, "unknown fixture bytes");
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI", stored, owned, unreadable }, { id: "aider", label: "Aider" }], reask: true });
      await t.ready();
      const seeded = !unreadable && stored === "configured";
      t.input.write(`${seeded !== checked ? " " : ""}\x1b[B \r`);
      const batch = await pending;
      assert.deepEqual([...batch.answers.values()], [checked, true]);
      const choices = readHarnessChoices(ctx);
      const decision = await decideHarness({ id: "codex", label: "Codex CLI", detected: true, stored, unreadable, owned, storedMcp: true, reask: true, ask: async () => batch.answers.get("codex") });
      assert.equal(decision.action, checked ? "configure" : "skip");
      assert.equal(decision.record, !unreadable);
      assert.notEqual(decision.mcp, true);
      const tx = beginTransaction(ctx.backupDir, "confirmed fixture");
      if (decision.record) recordHarnessChoice(ctx, tx, choices, "codex", checked ? "configured" : "skipped", decision.source, () => "fixture-now", { mcp: decision.mcp === true });
      tx.finish();
      if (unreadable) assert.equal(readFileSync(file, "utf8"), bytes);
      else { const saved = readHarnessChoices(ctx).harnesses.codex; assert.equal(saved.decision, checked ? "configured" : "skipped"); assert.equal(saved.source, "interactive"); assert.equal(saved.decidedAt, "fixture-now"); assert.equal(saved.mcp, false); }
      assert.equal(readFileSync(unknown, "utf8"), "unknown fixture bytes");
    } finally { t.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test("all arrows visit locked context; a twice from partial is empty across delivery partitions", async () => {
  for (const chunks of [["\x1b[A \x1b[D \x1b[B\x1b[Caa\r"], ["\x1b", "[A", " ", "\x1b[D", " ", "\x1b[B", "\x1b[C", "a", "a", "\r"]]) {
    const t = terminal();
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "pi", label: "pi", stored: "configured" }, { id: "codex", label: "Codex CLI" }, { id: "aider", label: "Aider" }] });
      await t.ready();
      // Let the persistent locked hint paint before the next navigation clears it.
      t.input.write("\x1b[A "); await turn(); await turn();
      assert.match(t.text(), /Saved choice is locked; use zcode-kit setup --reask/);
      t.input.write("\x1b[B"); await turn();
      for (const chunk of chunks) { t.input.write(chunk); await turn(); }
      const batch = await pending;
      assert.deepEqual([...batch.answers], [["codex", undefined], ["aider", undefined]]);
    } finally { t.close(); }
  }
});

test("MCP offers name only eligible editable rows, never a locked bit or another row", async () => {
  const t = terminal();
  try {
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "omp", label: "OMP", stored: "configured" }, { id: "claude-code", label: "Claude Code", unreadable: true }, { id: "codex", label: "Codex CLI" }], mcpIds: ["omp", "claude-code"] });
    await t.ready();
    assert.match(t.text(), /Selecting Claude Code also registers the kit's MCP bridge "zcode-harness"/);
    assert.doesNotMatch(t.text(), /Selecting OMP/);
    t.input.write(" \r"); const batch = await pending;
    assert.deepEqual([...batch.mcpIds], ["claude-code"]);
    const result = await decideHarness({ id: "claude-code", label: "Claude Code", detected: true, unreadable: true, ask: async () => batch.answers.get("claude-code"), mcpOffered: batch.mcpIds.has("claude-code") });
    assert.equal(result.mcp, true); assert.equal(result.record, false);
  } finally { t.close(); }
});

test("reask absent-answer matrix preserves decision bytes across saved directions, ownership and unreadability", async (context) => {
  for (const mode of ["empty", "escape", "eof"]) for (const stored of [undefined, "configured", "skipped"]) for (const owned of [false, true]) for (const unreadable of [false, true]) {
    const t = terminal();
    const root = mkdtempSync(join(tmpdir(), "t83-matrix-"));
    const ctx = { generated: join(root, "generated"), backupDir: join(root, "backups"), dryRun: false };
    mkdirSync(join(ctx.generated, "harness-choices"), { recursive: true }); mkdirSync(ctx.backupDir);
    const file = join(ctx.generated, "harness-choices/codex.json");
    const bytes = unreadable ? "{unreadable" : stored ? JSON.stringify({ schema: 1, harness: "codex", decision: stored, source: "stored-fixture", decidedAt: "2000-01-01T00:00:00Z", mcp: true }) + "\n" : null;
    if (bytes !== null) writeFileSync(file, bytes);
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI", stored, owned, unreadable }], reask: true });
      await t.ready();
      if (mode === "empty") { if (stored === "configured" && !unreadable) t.input.write(" "); t.input.write("\r"); }
      else if (mode === "escape") t.input.write("\x1b");
      else t.input.end();
      const batch = await pending;
      const decision = await decideHarness({ id: "codex", label: "Codex CLI", detected: true, stored, owned, unreadable, storedMcp: true,
        reask: true, ask: async () => batch.answers.get("codex") });
      assert.equal(decision.action, !unreadable && owned ? "refresh" : "skip", `${mode}/${stored}/${owned}/${unreadable}`);
      assert.equal(decision.record, false); assert.equal(decision.consent, false); assert.notEqual(decision.mcp, true);
      if (bytes !== null) assert.equal(readFileSync(file, "utf8"), bytes);
      assert.doesNotMatch(t.text(), /LABEL/);
    } finally { t.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test("Ctrl-C aborts unconfirmed batch; marked ETX is payload and real SIGINT still aborts", async () => {
  for (const signal of [false, true]) {
    const t = terminal();
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
      await t.ready(); t.input.write(" ");
      if (signal) { t.input.write("\x1b[200~ \r\x03"); process.emit("SIGINT"); }
      else t.input.write("\x03");
      await assert.rejects(pending, (err) => err.code === ABORTED);
      assert.equal(t.prompter.aborted, true); assert.equal(t.input.isRaw, false);
      await assert.rejects(t.prompter.ask("no later question"), (err) => err.code === ABORTED);
    } finally { t.close(); }
  }
});

test("maximum inventory counts all disclosure/feedback lines and spare margins with measured sub-40 width", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i === 0 ? "omp" : `fixture-${i}`, label: `Assistant ${i}`, stored: i % 3 === 0 ? "configured" : "skipped", owned: i % 2 === 0, unreadable: i % 3 === 1 }));
  const full = terminal(); full.output.columns = 32; full.output.rows = 1000;
  let count;
  try {
    const pending = full.prompter.selectHarnesses({ rows, reask: true, mcpIds: ["omp"] });
    await full.ready();
    const lines = full.text().split("\n").slice(0, -1); count = lines.length;
    for (const line of lines) assert.ok(displayWidth(line) <= 31, line);
    assert.ok(count > 100, "all wrapped prose, not just data rows, is measured");
    full.input.end(); await pending;
  } finally { full.close(); }
  const tooShort = terminal(); tooShort.output.columns = 32; tooShort.output.rows = count;
  try { assert.equal(await tooShort.prompter.selectHarnesses({ rows, reask: true, mcpIds: ["omp"] }), null); assert.equal(tooShort.text(), ""); assert.equal(tooShort.input.isRaw, false); }
  finally { tooShort.close(); }
});

test("unterminated marked paste remains discard-only through EOF and never logs payload", async () => {
  const t = terminal();
  try {
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
    await t.ready(); t.input.write("a\x1b[200~");
    for (let i = 0; i < 100; i++) t.input.write("PAYLOAD a\r\x03\x1b".repeat(100));
    t.input.end();
    assert.equal((await pending).answers.get("codex"), undefined);
    assert.doesNotMatch(t.text(), /PAYLOAD/); assert.equal(t.input.isRaw, false);
  } finally { t.close(); }
});

test("fit rejection is before raw/draw; safe resize retains checks and unsafe resize abandons them", async () => {
  for (const rows of [undefined, 1, NaN]) {
    const t = terminal(); t.output.rows = rows;
    try { assert.equal(await t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] }), null); assert.equal(t.text(), ""); assert.equal(t.input.isRaw, false); }
    finally { t.close(); }
  }
  for (const unsafe of [false, true]) {
    const t = terminal();
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
      await t.ready(); t.input.write(" ");
      t.output.columns = unsafe ? 10 : 80; t.output.emit("resize");
      if (unsafe) { assert.equal((await pending).fallback, true); assert.match(t.text(), /Terminal too small for the selector; continuing with individual questions\./); }
      else { await turn(); t.input.write("\r"); assert.equal((await pending).answers.get("codex"), true); }
      assert.equal(t.input.isRaw, false);
    } finally { t.close(); }
  }
});

for (const [name, v] of Object.entries(C3_VARIANTS)) test(`Next steps C3 bytes: ${name}`, () => {
  const stdout = capture(v.tty, v.columns), stderr = capture(v.tty, v.columns);
  const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform });
  out.commands(BASE, { title: "Next steps" });
  matchSnapshot(`onboarding/${name}.out`, stdout.text());
  const six = [...BASE]; six.splice(1, 0, { command: "zcode-kit run codex", description: "Launch Codex CLI wired to ZCode" });
  const launched = capture(v.tty, v.columns);
  createOutput({ stdout: launched, stderr, env: v.env, platform: v.platform }).commands(six, { title: "Next steps" });
  matchSnapshot(`onboarding/${name}-launch.out`, launched.text());
  if (["pipe", "ci", "term-dumb", "no-color"].includes(name)) assert.equal(launched.text().match(/^  zcode-kit /gm).length, 6);
  assert.equal(stderr.text(), "");
  if (["pipe", "ci", "term-dumb", "no-color"].includes(name)) assert.doesNotMatch(stdout.text(), /\x1b/);
});

for (const reason of ["empty", "escape", "eof", "ctrl-d"]) test(`absent ${reason} preserves locked rows and returns undefined even with checked seeds`, async () => {
  const t = terminal();
  try {
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "pi", label: "pi", stored: "configured" }, { id: "codex", label: "Codex CLI" }] });
    await t.ready();
    if (reason === "empty") t.input.write("\r");
    else if (reason === "escape") t.input.write("\x1b");
    else if (reason === "ctrl-d") t.input.write("\x04");
    else t.input.end();
    assert.deepEqual([...(await pending).answers], [["codex", undefined]]);
    if (reason === "eof" || reason === "ctrl-d") assert.equal(await t.prompter.ask("must not ask"), undefined);
  } finally { t.close(); }
});

test("complete disclosure drains before arming; pre-arm input is discarded and write failure cleans up", async () => {
  for (const broken of [false, true]) {
    const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
    input.setRawMode = (value) => { input.isRaw = value; };
    const { Writable } = await import("node:stream");
    let release, text = "", held = false;
    const output = new Writable({ write(chunk, encoding, callback) { text += chunk; if (!held) { held = true; release = callback; } else callback(); } });
    output.isTTY = true; output.columns = 120; output.rows = 150;
    const prompter = createPrompter({ input, output, env: UTF8 });
    const baseline = process.listenerCount("SIGINT");
    try {
      const pending = prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
      for (let i = 0; i < 100 && !release; i++) await turn();
      assert.match(text, /skips Codex CLI for this run/);
      input.write("a\r");
      let finished = false; pending.then(() => { finished = true; }, () => { finished = true; });
      await turn(); assert.equal(finished, false);
      release(broken ? new Error("fixture write failed") : undefined);
      if (broken) { await assert.rejects(pending, /fixture write failed/); assert.equal(input.isRaw, false); assert.equal(process.listenerCount("SIGINT"), baseline); }
      else {
        await turn(); input.write(" \r");
        assert.equal((await pending).answers.get("codex"), true);
      }
    } finally { prompter.close(); input.destroy(); output.destroy(); }
  }
});

test("selector close/raw exceptions clean owned listeners; geometry is checked at confirmation", async () => {
  for (const mode of ["close", "raw-error", "geometry"]) {
    const t = terminal();
    const foreign = () => {};
    t.input.on("data", foreign); t.output.on("resize", foreign);
    const baseline = process.listenerCount("SIGINT");
    if (mode === "raw-error") t.input.setRawMode = (raw) => { if (raw) throw new Error("fixture raw failure"); t.input.isRaw = raw; };
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
      if (mode === "raw-error") await assert.rejects(pending, /fixture raw failure/);
      else {
        await t.ready(); t.input.write(" ");
        if (mode === "close") t.prompter.close();
        else { t.output.rows = undefined; t.input.write("\r"); }
        const controller = new AbortController();
        const timeout = delay(1000, undefined, { signal: controller.signal }).then(() => { throw new Error(`selector ${mode} did not settle`); });
        let result;
        try { result = await Promise.race([pending, timeout]); }
        finally { controller.abort(); }
        if (mode === "geometry") assert.equal(result.fallback, true);
        else assert.equal(result.answers.get("codex"), undefined);
      }
      t.prompter.close(); await turn();
      assert.equal(t.input.isRaw, false);
      assert.equal(process.listenerCount("SIGINT"), baseline);
      assert.deepEqual(t.input.listeners("data"), [foreign]);
      assert.deepEqual(t.output.listeners("resize"), [foreign]);
    } finally { t.close(); }
  }
});

test("only decoded bare Escape acts; split arrows, modified/meta and malformed controls never become consent", async () => {
  for (const chunks of [["\x1b", "[", "B"], ["\x1bO", "C"], ["\x1b[1;5A"], ["\x1ba"], ["\x1b]title a \r\x07"], ["\x1b] a\r\x07"], ["\x1b[ \ra\r"], ["\x1b[[A"], ["\x1b", "[", "[", "A"]]) {
    const t = terminal();
    try {
      let done = false;
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }, { id: "aider", label: "Aider" }] }).then((r) => { done = true; return r; });
      await t.ready();
      for (const chunk of chunks) t.input.write(chunk);
      await turn(); await turn();
      assert.equal(done, false, `unsupported or navigation token cannot confirm: ${JSON.stringify(chunks)}`);
      t.input.write(" \r");
      const batch = await pending;
      assert.equal([...batch.answers.values()].filter((v) => v === true).length, 1);
    } finally { t.close(); }
  }
});

test("accepted43 legacy prompt, queue, retry, default, CI and resolver bytes/results remain exact", async () => {
  const baselineSource = readFileSync(new URL("./fixtures/onboarding-accepted43-consent.mjs.txt", import.meta.url), "utf8");
  const source = baselineSource.replaceAll('"../lib/edit.mjs"', JSON.stringify(new URL("../lib/edit.mjs", import.meta.url).href))
    .replaceAll('"../lib/term/load.mjs"', JSON.stringify(new URL("../lib/term/load.mjs", import.meta.url).href));
  const old = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  for (const env of [{ ...UTF8, NO_COLOR: "1" }, { TERM: "dumb" }, { CI: "true" }, UTF8]) {
    const run = async (create) => {
      const t = terminal(); const prompter = create({ input: t.input, output: t.output, env });
      try {
        assert.equal(prompter.interactive, env.CI !== "true", "CI bypass must be rejected before waiting for input");
        const pending = prompter.ask("Configure fixture?");
        t.input.write("\nmaybe\ny\nn\n");
        const values = [await pending, await prompter.ask("rotator?", { defaultAnswer: false })];
        if (prompter.interactive) t.input.write("\n");
        values.push(await prompter.ask("empty default?", { defaultAnswer: false }));
        return { text: t.text(), values };
      } finally { prompter.close(); t.close(); }
    };
    assert.deepEqual(await run(createPrompter), await run(old.createPrompter));
  }
  for (const [flag, env] of [[undefined, undefined], ["auto", "codex"], ["none", "codex"], ["", "codex"], ["codex,codex", "pi"]])
    assert.deepEqual(capabilities && (await import("../cli/harness-consent.mjs")).resolveHarnessSelection(flag, env, ["codex", "pi"]), old.resolveHarnessSelection(flag, env, ["codex", "pi"]));
  const args = { id: "codex", label: "Codex CLI", detected: true, stored: "configured", owned: false, reask: true, ask: async () => undefined };
  assert.deepEqual(await decideHarness(args), await old.decideHarness(args));
});

test("bounded decoder does not reinterpret an expired partial escape as a toggle", async () => {
  const t = terminal();
  try {
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }, { id: "aider", label: "Aider" }] });
    await t.ready(); t.input.write("\x1b[");
    await delay(550);
    t.input.write("A\r");
    const batch = await pending;
    assert.deepEqual([...batch.answers.values()], [undefined, undefined], "expired navigation is not an a key");
  } finally { t.close(); }
});

test("lexical delayed LF tail is consumed once, not every first rotator Enter", async () => {
  for (const intervening of [false, true]) {
    const t = terminal();
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
      await t.ready(); t.input.write(" \r"); await pending;
      if (intervening) t.input.write("x"); // old epoch discarded, but clears CR
      let answered = false;
      const line = t.prompter.ask("fresh LF?", { defaultAnswer: false }).then((value) => { answered = true; return value; });
      for (let i = 0; i < 100 && !t.text().includes("fresh LF?"); i++) await turn();
      await turn(); t.input.write("\n"); await turn();
      assert.equal(answered, intervening);
      if (!intervening) t.input.write("\r");
      assert.equal(await line, false);
    } finally { t.close(); }
  }
});

test("SIGINT during the fresh line phase restores prior raw true after readline closes", async () => {
  for (const signal of [false, true]) {
    const t = terminal(); t.input.isRaw = true;
    try {
      const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
      await t.ready(); t.input.write(" \r"); await pending;
      const line = t.prompter.ask("fresh abort?");
      for (let i = 0; i < 100 && !t.text().includes("fresh abort?"); i++) await turn();
      if (signal) process.emit("SIGINT"); else t.input.write("\x03");
      await assert.rejects(line, (err) => err.code === ABORTED);
      t.prompter.close(); assert.equal(t.input.isRaw, true);
    } finally { t.close(); }
  }
});

test("raw true is restored after selector and subsequent line close", async () => {
  const t = terminal(); t.input.isRaw = true;
  try {
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
    await t.ready(); t.input.write(" \r"); await pending;
    const line = t.prompter.ask("fresh?");
    for (let i = 0; i < 100 && !t.text().includes("fresh?"); i++) await turn();
    t.input.write("n\r"); await line;
    t.prompter.close();
    assert.equal(t.input.isRaw, true);
  } finally { t.close(); }
});

test("selector capabilities require measured prompt geometry without changing legacy caps", () => {
  const stream = { isTTY: true, columns: 32, rows: 100 };
  const old = capabilities.detectCaps(stream, { env: UTF8 });
  assert.equal(old.width, 40);
  assert.equal(capabilities.selectorCaps(stream, { env: UTF8 }).width, 31);
  assert.equal(capabilities.selectorCaps(stream, { env: UTF8 }).eligible, true);
  for (const dimension of [undefined, NaN, 0, -1, 1.5, Infinity]) {
    assert.equal(capabilities.selectorCaps({ ...stream, rows: dimension }, { env: UTF8 }).eligible, false);
    assert.equal(capabilities.selectorCaps({ ...stream, columns: dimension }, { env: UTF8 }).eligible, false);
  }
  assert.equal(capabilities.selectorCaps({ isTTY: true }, { env: { ...UTF8, COLUMNS: "120", LINES: "100" } }).eligible, false);
  assert.equal(capabilities.selectorCaps(stream, { env: { ...UTF8, NO_COLOR: "1" }, flags: { color: "always" } }).eligible, false);
  assert.equal(capabilities.detectCaps(stream, { env: { ...UTF8, NO_COLOR: "1" }, flags: { color: "always" } }).color, true);
  assert.deepEqual(capabilities.detectCaps(stream, { env: UTF8 }), old);
});

test("a split pending escape is discarded before fresh rotator input, with owned cleanup", async () => {
  const t = terminal();
  try {
    const baseline = process.listenerCount("SIGINT");
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] });
    await t.ready();
    t.input.write("\x1b[");
    t.input.write("B \r\nyn\r");
    assert.equal((await pending).answers.get("codex"), true);
    const answer = t.prompter.ask("Rotator?", { defaultAnswer: false });
    for (let i = 0; i < 100 && !t.text().includes("Rotator?"); i++) await turn();
    t.input.write("n\r");
    assert.equal(await answer, false);
    t.prompter.close();
    assert.equal(process.listenerCount("SIGINT"), baseline);
    assert.equal(t.output.listenerCount("resize"), 0);
    assert.equal(t.input.isRaw, false);
  } finally { t.close(); }
});

for (const chunks of [
  ["hello\r"], ["h", "el", "lo", "\r"],
  ["a\x1b[200~ a\r\x03\x1b[201~a\r"],
  ["a\x1b[2", "00~ a\r\x03\x1b[20", "1~a\r"],
  ["\x1b[" + "1".repeat(10000) + "a\r"],
  [Buffer.from([0xf0]), Buffer.from([0x9f, 0x98]), Buffer.from([0x80, 13])],
  ["ahello\r"],
  [Buffer.from([0xf0, 0x28, 0x8c, 0x28, 13])],
  ["a\x1b[200~", " a\r\x1b\x03".repeat(20000), "\x1b[201~a\r"],
]) test(`contamination/marked paste resets without accepting buffered suffix (${chunks.length} deliveries, ${chunks.map(c => c.length).join("/")})`, async () => {
  const t = terminal();
  try {
    let accepted = false;
    const pending = t.prompter.selectHarnesses({ rows: [{ id: "codex", label: "Codex CLI" }] }).then((value) => { accepted = true; return value; });
    await t.ready();
    for (const chunk of chunks) t.input.write(chunk);
    await turn(); await turn();
    assert.equal(accepted, false);
    t.input.write(" \r");
    assert.equal((await pending).answers.get("codex"), true);
    assert.equal(t.text().includes("hello"), false);
  } finally { t.close(); }
});

// Feasibility diagnostic: use only the supported decoder + an owned stream.
// Observing async resources is diagnostic instrumentation, not product access
// to Node's private decoder symbols. Disarmed NUL flush cancels its ESC timer.
test("supported readline decoding can release a pending bare-Esc timer on an owned stream", async () => {
  const input = new PassThrough();
  const timers = new Set();
  const hook = createHook({ init(id, type) { if (type === "Timeout") timers.add(id); }, destroy(id) { timers.delete(id); } });
  hook.enable();
  const keys = [];
  const onKey = (_, key) => keys.push(key.name);
  emitKeypressEvents(input);
  input.on("keypress", onKey);
  input.write(Buffer.from("\x1b"));
  assert.equal(timers.size, 1, "control: bare ESC starts the supported decoder window");
  input.write(Buffer.alloc(32)); // disarmed owned decoder; never terminal input
  input.removeListener("keypress", onKey);
  input.destroy();
  await new Promise(setImmediate);
  hook.disable();
  assert.equal(timers.size, 0, "no outstanding decoder timer after cleanup");
  assert.ok(!keys.includes("escape"), "cleanup must not manufacture none/consent");
});
