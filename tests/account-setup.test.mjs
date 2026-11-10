import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { askAccountRotator, configureAccountRotator, rotatorChoice, ACCOUNT_ROTATOR_QUESTION } from "../cli/account-setup.mjs";

// Ticket 42 (A-22): the question is `[y/N]`, so Enter takes the default n
// (it used to ask again); an invalid answer still asks again, and only an
// explicit y opts in.
test("installer opts in only on an explicit y, repeats invalid answers, and Enter takes the default n", async () => {
  for (const [typed, expected] of [["maybe\ny\n", true], ["maybe\nn\n", false], ["maybe\n\n", false]]) {
    const input = new PassThrough(), output = new PassThrough();
    input.isTTY = output.isTTY = true;
    let transcript = "";
    output.on("data", chunk => transcript += chunk);
    const pending = askAccountRotator({ input, output, env: {} });
    input.write(typed);
    assert.equal(await pending, expected);
    assert.ok(transcript.includes(`? ${ACCOUNT_ROTATOR_QUESTION} [y/N]`));
    assert.ok(transcript.includes("Please answer y or n"));
    input.destroy(); output.destroy();
  }
});

test("terminal redraw keeps the y/n question visible before and during input", async () => {
  for (const columns of [100, 36]) for (const answer of ["y", "n"]) {
    const input = new PassThrough(), output = new PassThrough();
    input.isTTY = output.isTTY = true;
    output.columns = columns;
    let transcript = "";
    output.on("data", chunk => transcript += chunk);
    const pending = askAccountRotator({ input, output, env: {} });
    try {
      const question = `? ${ACCOUNT_ROTATOR_QUESTION} [y/N] `;
      // Round 2: the question is drawn once the capability record has loaded (one async step).
      for (let i = 0; i < 200 && !transcript.includes(question); i++) await new Promise((r) => setTimeout(r, 5));
      assert.ok(transcript.includes(question));
      transcript = "";
      output.emit("resize");
      assert.ok(transcript.includes(question), "redraw must not replace the question with the default > prompt");
      input.write(answer);
      transcript = "";
      output.emit("resize");
      assert.ok(transcript.includes(question + answer), "redraw must preserve the question and typed answer");
      input.write("\n");
      assert.equal(await pending, answer === "y");
    } finally {
      input.end();
      await pending;
      output.destroy();
    }
  }
});

test("headless install and closed terminal never silently opt in", async () => {
  const input = new PassThrough(), output = new PassThrough();
  assert.equal(await askAccountRotator({ input, output }), undefined);
  input.isTTY = output.isTTY = true;
  const answer = askAccountRotator({ input, output, env: {} });
  input.end();
  assert.equal(await answer, undefined);
  output.destroy();
  assert.equal(rotatorChoice(" Y "), true);
  assert.equal(rotatorChoice("n"), false);
  assert.equal(rotatorChoice(undefined), undefined);
  assert.throws(() => rotatorChoice("yes"), /must be y or n/);
});

test("activation imports before changing config and preserves policies/comments; failed import is non-destructive", t => {
  const root = mkdtempSync(join(tmpdir(), "kit-account-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "config.yaml");
  const proxySrc = join(import.meta.dirname, "..", "zcode-proxy-src");
  const ctx = { config, proxySrc };
  const initial = "# keep this comment\nprovider: zai\nauth:\n  proxyApiKey: synthetic-local-key\n  accounts:\n    enabled: false\n    path: /custom/accounts.json\n    allowedIds: [work]\n    pausedIds: [paused]\n    allowPaid: false\n";
  writeFileSync(config, initial);
  const writes = [];
  const tx = { touch: path => writes.push(path) };
  assert.throws(() => configureAccountRotator(ctx, tx, true, () => ({ status: 1 })), /import failed/);
  assert.equal(readFileSync(config, "utf8"), initial);
  const result = configureAccountRotator(ctx, tx, true, args => {
    assert.deepEqual(args, ["auth", "accounts", "import-current"]);
    assert.equal(readFileSync(config, "utf8"), initial);
    return { status: 0, stdout: '{"accountCount":2}' };
  });
  assert.deepEqual(result, { changed: true, accountCount: 2 });
  const yaml = createRequire(join(proxySrc, "package.json"))("yaml");
  const updated = readFileSync(config, "utf8");
  assert.ok(updated.includes("# keep this comment"));
  assert.deepEqual(yaml.parse(updated).auth.accounts, { ...yaml.parse(initial).auth.accounts, enabled: true });
  assert.deepEqual(writes, [config]);
  configureAccountRotator(ctx, tx, false, () => { throw new Error("disabled must not import"); });
  assert.equal(yaml.parse(readFileSync(config, "utf8")).auth.accounts.enabled, false);
});

// ------------------------------------------------------------------------
// Ticket 42 (seam 8, temp-HOME fixtures): the Account Rotator decision is
// asked once. The answer is stored under generated/ next to the harness
// choices (generated/account-rotator.json) through the setup transaction;
// `setup --reask` asks again; `--account-rotator` and
// ZCODE_KIT_ACCOUNT_ROTATOR=y|n still override; `auth.accounts.enabled: true`
// from an older kit is recorded as "yes" without asking; `accounts
// enable|disable` update the stored decision; nothing prompts without a
// terminal, and `update` never blocks without a usable TTY on stdin and stderr.
// The proxy CLI is a fixture script (no account store, no credentials: B2) and
// every fixture config names a free loopback port (FIXTURE_PORT, taken from
// the kernel: nothing of this or a parallel run listens there; ticket 75).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { C3_VARIANTS, matchSnapshot } from "./snapshot-harness.mjs";
import { freePort } from "./free-port.mjs";

const KIT = join(import.meta.dirname, "..");
const FIXTURE_PORT = await freePort();
const ROTATOR_PROMPT = `? ${ACCOUNT_ROTATOR_QUESTION} [y/N] `; // A-22: the `? ` prefix (ticket 43)
const loadAccountSetup = () => import(pathToFileURL(join(KIT, "cli", "account-setup.mjs")).href);

/**
 * A disposable kit. `layout`:
 *   "in-tree"  tarball/checkout install: state lives in the kit root;
 *   "npm"      an npm global install whose state still sits in the package
 *              root (older kits); the first command moves it to
 *              $XDG_STATE_HOME/zcode-agent-kit/installs/<id> (lib/state.mjs);
 *   "checkout" in-tree plus a git clone of a local bare origin, no proxy
 *              manager (update fast-forwards, re-runs setup, skips the start).
 * `accounts`: the config's auth.accounts.enabled (true/false) or "absent" for a
 * pre-rotator config without the accounts block. `generated`: "none" (pre-consent
 * kit, no generated/ at all) or "harness-choices" (a stored harness decision).
 * `eol`: "lf" or "crlf", the line endings of the user's proxy/config.yaml (a
 * Windows checkout, installer or editor writes CRLF). The example config is
 * read line-ending agnostic (a windows checkout has it as CRLF).
 */
function kitFixture(t, { layout = "in-tree", accounts = false, generated = "none", eol = "lf" } = {}) {
  const base = mkdtempSync(join(tmpdir(), "kit-rotator-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = layout === "npm" ? join(base, "lib", "node_modules", "zcode-agent-kit") : join(base, "kit");
  mkdirSync(root, { recursive: true });
  for (const member of ["cli", "lib"]) cpSync(join(KIT, member), join(root, member), { recursive: true });
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "zcode-proxy-src"));
  cpSync(join(KIT, "proxy", "config.example.yaml"), join(root, "proxy", "config.example.yaml"));
  // Ticket 43: the output module's token set and width core re-export the
  // shared files under zcode-proxy-src/src/tui — part of every real kit
  // layout, so the fixture kit carries them too.
  mkdirSync(join(root, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(KIT, "zcode-proxy-src", "src", "tui", f), join(root, "zcode-proxy-src", "src", "tui", f));
  if (layout !== "checkout") {
    cpSync(join(KIT, "proxy", "zcode-proxy-manager.mjs"), join(root, "proxy", "zcode-proxy-manager.mjs"));
    cpSync(join(KIT, "proxy", "zcode-proxy-autostart.ts"), join(root, "proxy", "zcode-proxy-autostart.ts"));
  }
  cpSync(join(KIT, "zcode-proxy-src", "package.json"), join(root, "zcode-proxy-src", "package.json"));
  symlinkSync(join(KIT, "zcode-proxy-src", "node_modules"), join(root, "zcode-proxy-src", "node_modules"), process.platform === "win32" ? "junction" : "dir");
  // The fixture proxy CLI: `<ZCODE_KIT_BUN> run src/index.ts <args>` with
  // ZCODE_KIT_BUN = node runs this file. It answers only the import of the
  // current login, with zero accounts, and logs every call.
  writeFileSync(join(root, "zcode-proxy-src", "run"), [
    "const a = process.argv.slice(3).join(' ');",
    "process.getBuiltinModule('node:fs').appendFileSync(process.env.ROTATOR_FIXTURE_CALLS, a + '\\n');",
    "if (a === 'auth accounts import-current') process.stdout.write('{\"accountCount\":0}\\n'); else process.exit(9);",
    "",
  ].join("\n"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "zcode-agent-kit", version: "0.2.42" }, null, 2) + "\n");
  // Older kit state, in the root where every older layout kept it.
  let config = readFileSync(join(KIT, "proxy", "config.example.yaml"), "utf8").replace(/\r\n/g, "\n")
    .replace(/^  port: \d+/m, `  port: ${FIXTURE_PORT}`)
    .replace('proxyApiKey: "GENERATE_ME"', 'proxyApiKey: "synthetic-fixture-key"');
  if (accounts === "absent") config = config.replace(/^  accounts:\n(?:    .*\n)+/m, "");
  else config = config.replace(/^    enabled: false$/m, `    enabled: ${accounts}`);
  assert.equal(/^    enabled: /m.test(config), accounts !== "absent", "fixture config shape");
  if (accounts !== "absent") assert.match(config, new RegExp(`^    enabled: ${accounts}$`, "m"), "fixture config shape");
  writeFileSync(join(root, "proxy", "config.yaml"), eol === "crlf" ? config.replace(/\n/g, "\r\n") : config);
  writeFileSync(join(root, ".proxykey"), "synthetic-fixture-key\n");
  if (generated === "harness-choices") {
    mkdirSync(join(root, "generated", "harness-choices"), { recursive: true });
    writeFileSync(join(root, "generated", "harness-choices", "pi.json"), JSON.stringify({ schema: 1, harness: "pi", decision: "skipped", source: "interactive", decidedAt: "" }));
  }
  const home = join(base, "home");
  mkdirSync(home);
  const calls = join(base, "proxy-cli-calls.log");
  writeFileSync(calls, "");
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(base, "localappdata"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(base, "state"), ZCODE_KIT_SKIP_DEPS: "1",
    ZCODE_PROXY_CREDENTIALS_PATH: join(home, "credentials.json"), ZCODE_KIT_BUN: process.execPath, ROTATOR_FIXTURE_CALLS: calls,
    PATH: process.platform === "win32" ? `C:\\Windows\\System32;${join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd")}` : "/usr/bin:/bin",
  };
  for (const name of ["ZCODE_KIT_HARNESSES", "ZCODE_KIT_STATE_DIR", "ZCODE_KIT_ACCOUNT_ROTATOR", "ZCODE_ACCOUNTS_ENABLED", "CI", "ZCODE_KIT_VERBOSE"]) delete env[name];
  if (layout === "checkout") {
    env.ZCODE_KIT_ALLOW_CHECKOUT = "1";
    writeFileSync(join(root, ".gitignore"), ".proxykey\nproxy/config.yaml\nlogs/\nbackups/\ngenerated/\nzcode-proxy-src/node_modules\n");
    const git = (cwd, ...a) => {
      const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...a], { cwd, env, encoding: "utf8" });
      assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
    };
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "fixture");
    git(base, "clone", "-q", "--bare", root, join(base, "origin.git"));
    git(root, "remote", "add", "origin", join(base, "origin.git"));
    git(root, "fetch", "-q", "origin");
    git(root, "branch", "-q", "--set-upstream-to=origin/main", "main");
  }
  const stateDir = () => {
    if (layout !== "npm") return root;
    const installs = join(base, process.platform === "win32" ? "localappdata" : "state", "zcode-agent-kit", "installs");
    const ids = existsSync(installs) ? readdirSync(installs).filter((n) => !n.includes(".")) : [];
    assert.ok(ids.length <= 1);
    return ids.length ? join(installs, ids[0]) : null;
  };
  const decisionFile = () => { const s = stateDir(); return s && join(s, "generated", "account-rotator.json"); };
  return {
    base, root, home, env, layout, stateDir, decisionFile,
    cli: join(root, "cli", "zcode-kit.mjs"),
    config: () => readFileSync(join(stateDir() ?? root, "proxy", "config.yaml"), "utf8"),
    decision() {
      const file = decisionFile();
      if (!file || !existsSync(file)) return null;
      const j = JSON.parse(readFileSync(file, "utf8"));
      return `${j.decision}/${j.source}`;
    },
    decisionBytes() { const file = decisionFile(); return file && existsSync(file) ? readFileSync(file, "utf8") : null; },
    proxyCliCalls: () => readFileSync(calls, "utf8").split("\n").filter(Boolean),
  };
}

/** The CLI without a terminal; stdin stays open and is never written (a script that never answers). */
function runPlain(f, args, { env = {}, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [f.cli, ...args], { env: { ...f.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code: code ?? `signal ${signal}`, stdout, stderr, text: `${stdout}\n${stderr}` }); });
  });
}

const script = process.platform === "linux" && spawnSync("script", ["--version"], { stdio: "ignore" }).status === 0;
if (process.platform === "linux" && process.env.CI && !script) throw new Error("script(1) is required on Linux CI for the pty tests");
/**
 * The CLI on a pty (util-linux `script`). `steps` are [{ after, send }] pairs
 * typed once `after` appeared; stdin is never closed, so an unexpected
 * question waits until the timeout instead of reading EOF. `redirect` is
 * appended to the shell command (for example `2>file`).
 */
function runPty(f, args, steps = [], { env = {}, timeout = 60000, redirect = "" } = {}) {
  return new Promise((resolve) => {
    const child = spawn("script", ["-qec", `${process.execPath} ${f.cli} ${args.join(" ")} ${redirect}`, "/dev/null"], { env: { ...f.env, ...env } });
    let raw = "", stderr = "";
    const pending = [...steps];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (chunk) => {
      raw += chunk;
      while (pending.length && raw.includes(pending[0].after)) child.stdin.write(pending.shift().send);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? `signal ${signal}`, out: raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), stderr, unsent: pending.length });
    });
  });
}
const asked = (text) => text.split(ACCOUNT_ROTATOR_QUESTION).length - 1;
// Ticket 43: on the compact screen the verbatim transaction line lives in
// install.log; --verbose keeps it on stdout. Reads both.
const txIdOf = (text, f) => text.match(/transaction (\S+) recorded/)?.[1]
  ?? (f ? (() => { try { return readFileSync(join(f.stateDir(), "logs", "install.log"), "utf8").match(/transaction (\S+) recorded/)?.[1]; } catch { return undefined; } })() : undefined);

test("rotator asked once: a terminal answer is stored; setup, doctor --fix and a checkout update never ask again; --reask asks; Enter means no", { skip: !script, timeout: 300000 }, async (t) => {
  const f = kitFixture(t, { layout: "checkout" });
  const first = await runPty(f, ["setup"], [{ after: ROTATOR_PROMPT, send: "n\n" }]);
  assert.equal(first.code, 0, first.out);
  assert.equal(asked(first.out), 1, first.out);
  assert.equal(f.decision(), "no/interactive");
  const stored = f.decisionBytes();
  for (const args of [["setup"], ["setup"], ["doctor", "--fix"], ["update"], ["setup", "--harness", "none"]]) {
    const again = await runPty(f, args, [], { timeout: 45000 });
    assert.notEqual(again.code, "signal SIGKILL", `${args.join(" ")} hung on a question:\n${again.out}`);
    assert.equal(asked(again.out), 0, `${args.join(" ")} asked again:\n${again.out}`);
    assert.equal(f.decisionBytes(), stored, `${args.join(" ")} left the stored decision byte-identical`);
  }
  const quiet = await runPty(f, ["setup"]);
  assert.match(quiet.out, /INFO {2}Account Rotator disabled \(saved choice; not asked again\)\./);
  assert.match(quiet.out, /Change it: zcode-kit accounts enable, or zcode-kit setup --reask/);
  const reask = await runPty(f, ["setup", "--reask"], [{ after: ROTATOR_PROMPT, send: "\r" }]);
  assert.equal(reask.code, 0, reask.out);
  assert.equal(asked(reask.out), 1, "--reask asks again");
  // Result-row grammar (design-language §4.3): a pty renders the status
  // column as `✓ OK    ` (glyph, space, the word padded to 4); a pipe keeps
  // `OK  `. This pty proof pins the status word and the label, not the pad.
  assert.match(reask.out, /(?:✓ )?OK {2,4}Account Rotator disabled\. Saved accounts are kept\./, "Enter takes the capitalised default N");
  assert.equal(f.decisionBytes(), stored, "the same answer again rewrites nothing");
  // Ticket 40 starts a down proxy through the lifecycle during doctor --fix,
  // even in this manager-less fixture. Its stand-in records `serve` and fails
  // closed; no account import (or any other proxy CLI call) is permitted.
  assert.deepEqual(f.proxyCliCalls(), ["serve"], "doctor --fix attempts only a proxy start; a no never imports an account");
});

test("rotator: Ctrl-C at the question leaves the config and the stored decision untouched (fresh and under --reask)", { skip: !script, timeout: 120000 }, async (t) => {
  const f = kitFixture(t);
  const configBefore = f.config();
  const r = await runPty(f, ["setup"], [{ after: ROTATOR_PROMPT, send: "\x03" }]);
  assert.equal(r.code, 130, r.out);
  assert.equal(f.decision(), null, "no decision recorded");
  assert.equal(f.config(), configBefore, "config untouched");
  assert.equal((await runPty(f, ["setup"], [{ after: ROTATOR_PROMPT, send: "n\n" }])).code, 0);
  const stored = f.decisionBytes();
  const configStored = f.config();
  const re = await runPty(f, ["setup", "--reask"], [{ after: ROTATOR_PROMPT, send: "\x03" }]);
  assert.equal(re.code, 130, re.out);
  assert.equal(f.decisionBytes(), stored, "an aborted --reask keeps the stored decision byte-identical");
  assert.equal(f.config(), configStored);
});

test("rotator: without a terminal, or under CI, nothing prompts and nothing hangs (stdin left open)", { timeout: 180000 }, async (t) => {
  const f = kitFixture(t);
  for (const env of [{}, { CI: "true" }]) {
    const r = await runPlain(f, ["setup"], { env, timeout: 45000 });
    assert.equal(r.code, 0, r.text);
    assert.equal(asked(r.text), 0, r.text);
    assert.match(r.stdout, /Account Rotator setting unchanged \(no interactive answer\)\./);
    const fix = await runPlain(f, ["doctor", "--fix"], { env, timeout: 45000 });
    assert.notEqual(fix.code, "signal SIGKILL", fix.text);
    assert.equal(asked(fix.text), 0, fix.text);
  }
  assert.equal(f.decision(), null, "no answer, no stored decision");
  if (script) {
    const ci = await runPty(f, ["setup"], [], { env: { CI: "true" }, timeout: 45000 });
    assert.equal(ci.code, 0, `CI on a terminal must not ask:\n${ci.out}`);
    assert.equal(asked(ci.out), 0);
  }
});

test("update never blocks without a usable TTY on stdin and stderr: stderr redirected on a terminal, undecided rotator", { skip: !script, timeout: 120000 }, async (t) => {
  const f = kitFixture(t, { layout: "checkout" });
  const err = join(f.base, "update.stderr");
  const r = await runPty(f, ["update"], [], { redirect: `2>${err}`, timeout: 45000 });
  assert.notEqual(r.code, "signal SIGKILL", `update hung on a question:\n${r.out}`);
  assert.equal(asked(r.out + readFileSync(err, "utf8")), 0, r.out);
  assert.equal(f.decision(), null, "nothing answered, nothing recorded");
  // With a usable terminal on every stream the undecided question is asked once.
  const tty = await runPty(f, ["update"], [{ after: ROTATOR_PROMPT, send: "n\n" }], { timeout: 45000 });
  assert.equal(asked(tty.out), 1, tty.out);
  assert.equal(f.decision(), "no/interactive");
});

for (const [name, opts] of [
  ["in-tree state of a pre-consent kit (no generated/)", { layout: "in-tree", generated: "none" }],
  ["in-tree state with stored harness choices", { layout: "in-tree", generated: "harness-choices" }],
  ["npm install with its state still in the package root", { layout: "npm", generated: "harness-choices" }],
]) {
  test(`rotator migration, ${name}: enabled: true is recorded as yes without asking, once; replayed it changes nothing; rollback undoes it and the next run migrates again`, { timeout: 180000 }, async (t) => {
    const f = kitFixture(t, { ...opts, accounts: true });
    const one = await runPlain(f, ["setup"]);
    assert.equal(one.code, 0, one.text);
    assert.equal(asked(one.text), 0);
    assert.equal(f.decision(), "yes/migration");
    assert.match(one.stdout, /INFO {2}Account Rotator enabled \(saved choice; not asked again\)\./);
    assert.match(one.stdout, /Change it: zcode-kit accounts disable, or zcode-kit setup --reask/);
    const configAfter = f.config();
    assert.match(configAfter, /^    enabled: true$/m, "the migration never touches the config");
    assert.deepEqual(f.proxyCliCalls(), [], "recording yes imports nothing");
    if (opts.generated === "harness-choices") assert.ok(existsSync(join(f.stateDir(), "generated", "harness-choices", "pi.json")), "harness choices kept");
    const bytes = f.decisionBytes();
    const manifests = () => readdirSync(join(f.stateDir(), "backups")).filter((n) => n.endsWith(".manifest.json")).sort();
    const recorded = manifests();
    const firstTx = txIdOf(one.stdout, f);
    assert.deepEqual(recorded, [`tx-${firstTx}.manifest.json`], "the migration is one recorded transaction");
    assert.ok(JSON.parse(readFileSync(join(f.stateDir(), "backups", recorded[0]), "utf8")).ops.some((op) => String(op.target).endsWith("account-rotator.json")));
    const two = await runPlain(f, ["setup"]);
    assert.equal(two.code, 0, two.text);
    assert.equal(f.decisionBytes(), bytes, "replay: decision byte-identical");
    assert.equal(f.config(), configAfter, "replay: config byte-identical");
    assert.equal(txIdOf(two.stdout, f), undefined, "replay: nothing to record");
    assert.deepEqual(manifests(), recorded, "replay: no new transaction");
    assert.ok(firstTx, one.stdout);
    const rb = await runPlain(f, ["rollback", firstTx]);
    assert.equal(rb.code, 0, rb.text);
    assert.equal(f.decision(), null, "rolling back the migrating setup removes the decision");
    assert.match(f.config(), /^    enabled: true$/m);
    const three = await runPlain(f, ["setup"]);
    assert.equal(three.code, 0, three.text);
    assert.equal(f.decision(), "yes/migration", "the next run migrates again");
  });
}

for (const [name, accounts] of [["enabled: false", false], ["a pre-rotator config without auth.accounts", "absent"]]) {
  test(`rotator migration, ${name}: stays undecided without a terminal (replayed twice), then asked once on the next terminal setup`, { timeout: 180000 }, async (t) => {
    const f = kitFixture(t, { accounts });
    const configBefore = f.config();
    for (let i = 0; i < 2; i++) {
      const r = await runPlain(f, ["setup"]);
      assert.equal(r.code, 0, r.text);
      assert.equal(f.decision(), null, `run ${i + 1}: nothing recorded`);
      assert.equal(f.config(), configBefore, `run ${i + 1}: config untouched`);
    }
    if (!script) return;
    const tty = await runPty(f, ["setup"], [{ after: ROTATOR_PROMPT, send: "n\n" }]);
    assert.equal(asked(tty.out), 1, tty.out);
    assert.equal(f.decision(), "no/interactive");
    assert.equal(asked((await runPty(f, ["setup"], [], { timeout: 45000 })).out), 0, "asked once");
  });
}

// Round 3: a Windows user's proxy/config.yaml has CRLF line endings. The
// migration reads it; an answer rewrites it. Both must give the same result as
// on an LF config, byte for byte up to the line endings, which are kept.
const bareLf = (text) => /(^|[^\r])\n/.test(text);
for (const [label, accounts] of [["enabled: true", true], ["enabled: false", false], ["auth.accounts absent", "absent"]]) {
  test(`rotator on a CRLF proxy/config.yaml (${label}): the migration decides as on LF, and every rewrite keeps CRLF with nothing duplicated`, { timeout: 180000 }, async (t) => {
    const crlf = kitFixture(t, { accounts, eol: "crlf" });
    const lf = kitFixture(t, { accounts });
    const before = crlf.config();
    assert.ok(before.includes("\r\n") && !bareLf(before), "the fixture config is CRLF throughout");
    for (let i = 0; i < 2; i++) {
      const r = await runPlain(crlf, ["setup"]);
      assert.equal(r.code, 0, r.text);
      assert.equal(crlf.decision(), accounts === true ? "yes/migration" : null, `replay ${i + 1}: decision`);
      assert.equal(crlf.config(), before, `replay ${i + 1}: config byte-identical`);
    }
    const yaml = createRequire(join(KIT, "zcode-proxy-src", "package.json"))("yaml");
    // An answer that changes the setting, then the opposite one through accounts.
    const answer = accounts === true ? "n" : "y";
    const steps = [["setup", "--account-rotator", answer], ["accounts", answer === "y" ? "disable" : "enable"]];
    for (const args of steps) {
      for (const f of [crlf, lf]) {
        const r = await runPlain(f, args);
        assert.equal(r.code, 0, `${args.join(" ")}: ${r.text}`);
      }
      const out = crlf.config();
      assert.ok(!bareLf(out), `${args.join(" ")}: no bare LF in the rewritten config`);
      assert.equal(out, lf.config().replace(/\n/g, "\r\n"), `${args.join(" ")}: the same bytes as the LF config, with CRLF`);
      assert.equal((out.match(/^    enabled: /gm) ?? []).length, 1, `${args.join(" ")}: auth.accounts.enabled exactly once`);
      const enabled = args[0] === "setup" ? answer === "y" : answer !== "y";
      assert.equal(yaml.parse(out).auth.accounts.enabled, enabled);
      assert.equal(crlf.decision(), `${enabled ? "yes" : "no"}/${args[0] === "setup" ? "flag" : "accounts"}`);
      const replay = await runPlain(crlf, args);
      assert.equal(replay.code, 0, replay.text);
      assert.equal(crlf.config(), out, `${args.join(" ")} replayed: config byte-identical`);
    }
  });
}

test("rotator overrides win over the stored decision and are recorded: --account-rotator y, then ZCODE_KIT_ACCOUNT_ROTATOR=n", { timeout: 180000 }, async (t) => {
  const f = kitFixture(t);
  assert.equal((await runPlain(f, ["accounts", "disable"])).code, 0);
  assert.equal(f.decision(), "no/accounts");
  const y = await runPlain(f, ["setup", "--account-rotator", "y", "--reask"]);
  assert.equal(y.code, 0, y.text);
  assert.match(y.stdout, /OK {2}Account Rotator enabled \(0 saved accounts\)\./);
  assert.equal(f.decision(), "yes/flag");
  assert.match(f.config(), /^    enabled: true$/m);
  assert.deepEqual(f.proxyCliCalls(), ["auth accounts import-current"]);
  const n = await runPlain(f, ["setup"], { env: { ZCODE_KIT_ACCOUNT_ROTATOR: "n" } });
  assert.equal(n.code, 0, n.text);
  assert.equal(f.decision(), "no/env");
  assert.match(f.config(), /^    enabled: false$/m);
  // An override left set for every run (unattended installs) is a replay: nothing is rewritten.
  const bytes = f.decisionBytes();
  const again = await runPlain(f, ["setup"], { env: { ZCODE_KIT_ACCOUNT_ROTATOR: "n" } });
  assert.equal(again.code, 0, again.text);
  assert.equal(f.decisionBytes(), bytes, "replayed override: decision byte-identical");
  assert.equal(txIdOf(again.stdout, f), undefined, "replayed override: no transaction");
  const bad = await runPlain(f, ["setup", "--account-rotator", "maybe"]);
  assert.equal(bad.code, 2, bad.text);
  assert.equal(f.decision(), "no/env", "a bad override writes nothing");
});

test("accounts enable|disable update the stored decision through their transaction; rollback restores the previous decision", { timeout: 180000 }, async (t) => {
  const f = kitFixture(t);
  assert.equal((await runPlain(f, ["accounts", "enable"])).code, 0);
  assert.equal(f.decision(), "yes/accounts");
  const yes = f.decisionBytes();
  const off = await runPlain(f, ["accounts", "disable"]);
  assert.equal(off.code, 0, off.text);
  assert.equal(f.decision(), "no/accounts");
  const setup = await runPlain(f, ["setup"]);
  assert.match(setup.stdout, /INFO {2}Account Rotator disabled \(saved choice; not asked again\)\./, "one meaning: setup reads what accounts disable stored");
  assert.equal(txIdOf(setup.stdout, f), undefined, "that setup changed nothing");
  assert.equal((await runPlain(f, ["rollback"])).code, 0, "undo accounts disable");
  assert.equal(f.decisionBytes(), yes, "the decision accounts enable stored is back");
  assert.match(f.config(), /^    enabled: true$/m);
  const after = await runPlain(f, ["setup"]);
  assert.match(after.stdout, /INFO {2}Account Rotator enabled \(saved choice; not asked again\)\./);
});

test("rotator: an unreadable decision file fails closed: reported, never overwritten, the setting is left alone", { timeout: 120000 }, async (t) => {
  const f = kitFixture(t);
  mkdirSync(join(f.root, "generated"), { recursive: true });
  writeFileSync(f.decisionFile(), "{ not json");
  const configBefore = f.config();
  const r = await runPlain(f, ["setup"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /account-rotator\.json: .* fix or remove the file; the Account Rotator counts as undecided until then/);
  assert.match(r.stdout, /Account Rotator setting unchanged \(no interactive answer\)\./);
  const n = await runPlain(f, ["accounts", "disable"]);
  assert.equal(n.code, 0, n.text);
  assert.equal(readFileSync(f.decisionFile(), "utf8"), "{ not json", "never overwritten");
  assert.equal(f.config(), configBefore);
});

test("update spawns its setup with stdin attached only when stdin and stderr are terminals (and not CI)", async (t) => {
  const update = await import(pathToFileURL(join(KIT, "cli", "commands", "update.mjs")).href);
  const tty = { isTTY: true }, pipe = { isTTY: false };
  for (const [stdin, stderr, env, expected] of [
    [tty, tty, {}, "inherit"], [tty, pipe, {}, "ignore"], [pipe, tty, {}, "ignore"], [tty, tty, { CI: "true" }, "ignore"], [undefined, undefined, {}, "ignore"],
  ]) {
    assert.equal(update.setupStdin({ terminal: stdin && { stdin, stderr }, env }), expected, JSON.stringify([stdin, stderr, env]));
  }
});

// Prompt snapshots (seam 5 style, TTY variants): the rotator step and one
// harness question as the kit writes them on a terminal, undecided, answered
// n. In the plain variants (no-color, term-dumb) the typed answer is echoed by
// the terminal, not by the kit, so it is not in the kit's bytes.
// Their bytes are decided by the capability record of the variant (forced
// streams and env), never by the test process's own TERM: Node's readline
// redraws a prompt unless process.env.TERM is "dumb" (round 2: the snapshots
// taken under TERM=dumb failed on CI, where TERM is not dumb). Each render is
// repeated under three process TERM values and must be byte-identical.
const PROCESS_TERMS = [undefined, "dumb", "xterm-256color"];
async function withProcessTerm(term, fn) {
  const saved = process.env.TERM;
  if (term === undefined) delete process.env.TERM; else process.env.TERM = term;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.TERM; else process.env.TERM = saved; }
}
async function renderQuestion(t, variant, kind, { after } = {}) {
  const { decideAccountRotator } = await loadAccountSetup();
  const { createPrompter, harnessQuestion } = await import(pathToFileURL(join(KIT, "cli", "harness-consent.mjs")).href);
  const root = mkdtempSync(join(tmpdir(), "kit-rotator-snap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "config.yaml");
  writeFileSync(config, "auth:\n  accounts:\n    enabled: false\n");
  const ctx = { config, generated: join(root, "generated"), proxySrc: join(KIT, "zcode-proxy-src") };
  const v = C3_VARIANTS[variant];
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true;
  output.columns = v.columns;
  let transcript = "";
  output.on("data", (chunk) => { transcript += chunk; });
  const prompter = createPrompter({ input, output, env: v.env, platform: v.platform });
  const pending = kind === "rotator"
    ? decideAccountRotator({
      ctx, tx: { touch() {} }, explicit: undefined, explicitSource: null, reask: false, prompter, aborted: false,
      progress: (line) => output.write(line + "\n"), warn: (line) => output.write(`  WARN: ${line}\n`),
      runProxyCli: () => assert.fail("a no never imports"),
    })
    : prompter.ask(harnessQuestion("Codex CLI"));
  // Type only once the question is on screen (a line typed ahead takes another path).
  for (let i = 0; i < 200 && !/\[y\/[nN]\] $/.test(transcript); i++) await new Promise((r) => setTimeout(r, 5));
  assert.match(transcript, /\[y\/[nN]\] $/, "the question is written before input is read");
  if (after) after({ input, output });
  input.write("n\n");
  const result = await pending;
  prompter.close();
  return { transcript, result };
}
const TTY_VARIANTS = Object.keys(C3_VARIANTS).filter((v) => C3_VARIANTS[v].tty);
for (const variant of TTY_VARIANTS) {
  for (const [kind, file] of [["rotator", "rotator-prompt"], ["harness", "harness-prompt"]]) {
    test(`snapshot: the ${kind === "rotator" ? "Account Rotator" : "per-harness"} question in ${variant}, whatever the process TERM`, async (t) => {
      const renders = [];
      for (const term of PROCESS_TERMS) renders.push(await withProcessTerm(term, () => renderQuestion(t, variant, kind)));
      assert.deepEqual(renders[0].result, kind === "rotator" ? { changed: false, aborted: false } : false);
      for (const r of renders.slice(1)) assert.equal(r.transcript, renders[0].transcript, "the process TERM must not change the bytes");
      matchSnapshot(`setup/${file}/${variant}.txt`, renders[0].transcript);
    });
  }
}

// design-language §3.3/§4.10 (R6, R15): no cursor control and no escape
// sequence where the capability record turns colour or motion off, even when
// the terminal is resized or a key is erased during the question.
for (const variant of TTY_VARIANTS.filter((v) => ["no-color", "term-dumb"].includes(v))) {
  for (const kind of ["rotator", "harness"]) {
    test(`no escape sequence in the ${kind} question under ${variant}, with a resize and a backspace, whatever the process TERM`, async (t) => {
      for (const term of PROCESS_TERMS) {
        const { transcript } = await withProcessTerm(term, () => renderQuestion(t, variant, kind, {
          // In plain mode the terminal's line discipline edits; here the erased
          // key arrives as an invalid line, so the question is asked once more.
          after: ({ input, output }) => { input.write("x\x7f\n"); output.emit("resize"); },
        }));
        assert.equal(transcript.indexOf("\x1b"), -1, `ESC under ${variant} (process TERM ${term}): ${JSON.stringify(transcript)}`);
      }
    });
  }
}
