// Per-harness consent (setup asks one y/n question per detected harness):
// prompt mechanics, explicit selections, stored decisions (one file per
// harness), refresh of kit-owned integrations, repair gating, per-harness
// savepoints and the CLI end to end against a disposable fixture kit + fake
// home (no real proxy, no real harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn, spawnSync } from "node:child_process";
import {
  ABORTED, HARNESS_CHOICES_DIR, HARNESS_SELECTION_ENV, NO_CONSENT_HINT, askYesNo, consentStatus, consentedForRepair,
  createPrompter, decideHarness, harnessQuestion, parseSelection, readHarnessChoices, recordHarnessChoice, resolveHarnessSelection,
} from "../cli/harness-consent.mjs";
import { ACCOUNT_ROTATOR_QUESTION, askAccountRotator } from "../cli/account-setup.mjs";
import { beginTransaction, rollbackTransaction } from "../lib/transaction.mjs";
import { commitFile } from "../lib/edit.mjs";

const KIT = join(import.meta.dirname, "..");
const IDS = ["omp", "pi", "claude-code", "codex", "opencode", "cline", "kilo-code", "aider", "continue", "goose"];

function ttyStreams() {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true;
  let transcript = "";
  output.on("data", (chunk) => { transcript += chunk; });
  return { input, output, text: () => transcript, done: () => { input.destroy(); output.destroy(); } };
}

// ------------------------------------------------------------- prompter
test("createPrompter: sequential questions on one terminal, typed-ahead answers stay in order, invalid answers repeat", async () => {
  const s = ttyStreams();
  const prompter = createPrompter({ input: s.input, output: s.output, env: {} });
  assert.equal(prompter.interactive, true);
  const first = prompter.ask(harnessQuestion("OMP / Oh My Pi"));
  s.input.write("\nmaybe\ny\nN\nn\n"); // one answer for each question, typed ahead of the prompts
  assert.equal(await first, true);
  assert.equal(await prompter.ask(harnessQuestion("pi")), false, "typed-ahead line answers the next question");
  assert.equal(await prompter.ask(ACCOUNT_ROTATOR_QUESTION), false);
  prompter.close();
  const text = s.text();
  assert.ok(text.includes("Configure ZCode as a provider with its supported models in OMP / Oh My Pi? [y/n]"));
  assert.ok(text.includes("Configure ZCode as a provider with its supported models in pi? [y/n]"));
  assert.ok(text.includes(`${ACCOUNT_ROTATOR_QUESTION} [y/n]`), "rotator question stays independent");
  assert.ok(text.includes("Please answer y or n"));
  s.done();
});

test("createPrompter / askYesNo never consent without a terminal, in CI, or on closed input", async () => {
  const plain = { input: new PassThrough(), output: new PassThrough() };
  assert.equal(createPrompter({ ...plain, env: {} }).interactive, false);
  assert.equal(await askYesNo("q?", { ...plain, env: {} }), undefined);
  const ci = ttyStreams();
  assert.equal(await askYesNo("q?", { input: ci.input, output: ci.output, env: { CI: "true" } }), undefined);
  assert.equal(createPrompter({ input: ci.input, output: ci.output, env: { CI: "0" } }).interactive, true, "CI=0 is not CI");
  ci.done();
  const eof = ttyStreams();
  const pending = askYesNo("q?", { input: eof.input, output: eof.output, env: {} });
  eof.input.end();
  assert.equal(await pending, undefined, "EOF is not consent");
  eof.output.destroy();
  const rotator = ttyStreams();
  const answer = askAccountRotator({ input: rotator.input, output: rotator.output, env: {} });
  rotator.input.write("y\n");
  assert.equal(await answer, true, "the rotator question uses the same y/n mechanics");
  rotator.done();
});

test("createPrompter: Ctrl-C rejects the pending question with ABORTED and every later question", async () => {
  const s = ttyStreams();
  const prompter = createPrompter({ input: s.input, output: s.output, env: {} });
  const pending = prompter.ask("first?");
  s.input.write("\x03"); // ETX: readline emits SIGINT on a terminal
  await assert.rejects(pending, (err) => err.code === ABORTED);
  assert.equal(prompter.aborted, true);
  await assert.rejects(prompter.ask("second?"), (err) => err.code === ABORTED, "no question is asked after an abort");
  prompter.close();
  s.done();
});

// ----------------------------------------------------- explicit selection
test("resolveHarnessSelection: auto is detection, lists are explicit, flag beats env, unknown ids fail", () => {
  assert.equal(resolveHarnessSelection(undefined, undefined, IDS), undefined);
  assert.equal(resolveHarnessSelection("auto", undefined, IDS), undefined);
  assert.deepEqual(resolveHarnessSelection("omp, codex,omp", undefined, IDS), { ids: ["omp", "codex"], none: false, source: "flag" });
  assert.deepEqual(resolveHarnessSelection(undefined, "pi", IDS), { ids: ["pi"], none: false, source: "env" });
  assert.deepEqual(resolveHarnessSelection("omp", "pi", IDS), { ids: ["omp"], none: false, source: "flag" });
  assert.deepEqual(resolveHarnessSelection("auto", "pi", IDS), { ids: ["pi"], none: false, source: "env" });
  assert.deepEqual(resolveHarnessSelection("none", undefined, IDS), { ids: [], none: true, source: "flag" });
  assert.deepEqual(resolveHarnessSelection(undefined, "none", IDS), { ids: [], none: true, source: "env" });
  assert.equal(resolveHarnessSelection(undefined, "", IDS), undefined, "an empty variable is auto");
  assert.throws(() => resolveHarnessSelection("nonsense", undefined, IDS), /unknown harness "nonsense" in --harness/);
  assert.throws(() => resolveHarnessSelection(undefined, "omp,bogus", IDS), new RegExp(`unknown harness "bogus" in ${HARNESS_SELECTION_ENV}`));
});

// ------------------------------------------------------------ decisions
test("decideHarness: explicit lists win, stored decisions stand, answers decide, no answer never consents", async () => {
  const yes = async () => true, no = async () => false, none = async () => undefined;
  const base = { id: "omp", label: "OMP / Oh My Pi", detected: true, stored: undefined, owned: false, explicit: undefined };
  const y = await decideHarness({ ...base, ask: yes });
  assert.deepEqual([y.action, y.source, y.record, y.consent], ["configure", "interactive", true, true]);
  const n = await decideHarness({ ...base, ask: no });
  assert.deepEqual([n.action, n.source, n.reason, n.record, n.consent], ["skip", "interactive", "answered n", true, false]);
  const undecided = await decideHarness({ ...base, ask: none });
  assert.deepEqual([undecided.action, undecided.record, undecided.reason], ["skip", false, NO_CONSENT_HINT]);
  const headless = await decideHarness({ ...base, ask: null });
  assert.deepEqual([headless.action, headless.reason, headless.consent], ["skip", NO_CONSENT_HINT, false]);
  assert.equal((await decideHarness({ ...base, detected: false, ask: yes })).action, "ignore", "undetected harnesses are never asked");
  let asked = 0;
  const count = async () => { asked++; return false; };
  const stored = await decideHarness({ ...base, stored: "configured", ask: count });
  assert.deepEqual([stored.action, stored.source, stored.record, stored.consent, asked], ["configure", "stored", false, true, 0], "stored consent is not re-asked");
  const skippedStored = await decideHarness({ ...base, stored: "skipped", ask: async () => { asked++; return true; } });
  assert.deepEqual([skippedStored.action, skippedStored.source, asked], ["skip", "stored", 0], "a stored n is respected even on a terminal");
  assert.match(skippedStored.reason, /previously skipped \(change with: zcode-kit integrate omp, setup --harness omp, or setup --reask\)/);
  const reaskYes = await decideHarness({ ...base, stored: "skipped", reask: true, ask: yes });
  assert.deepEqual([reaskYes.action, reaskYes.source, reaskYes.record], ["configure", "interactive", true], "--reask asks a skipped harness again");
  const reaskNo = await decideHarness({ ...base, stored: "configured", reask: true, ask: no });
  assert.deepEqual([reaskNo.action, reaskNo.source, reaskNo.record], ["skip", "interactive", true], "--reask may withdraw stored consent");
  const reaskHeadless = await decideHarness({ ...base, stored: "configured", reask: true, ask: null });
  assert.deepEqual([reaskHeadless.action, reaskHeadless.source, reaskHeadless.record], ["configure", "stored", false], "--reask without a terminal keeps stored decisions");
  const reaskHeadlessN = await decideHarness({ ...base, stored: "skipped", reask: true, ask: null });
  assert.deepEqual([reaskHeadlessN.action, reaskHeadlessN.source], ["skip", "stored"]);
  const flag = { ids: ["pi"], none: false, source: "flag" };
  assert.equal((await decideHarness({ ...base, explicit: flag, ask: yes })).action, "ignore");
  const selected = await decideHarness({ ...base, id: "pi", explicit: flag, detected: false, ask: yes });
  assert.deepEqual(selected, { action: "configure", source: "flag", reason: "selected via --harness", record: true, consent: true, mcp: true }, "an explicit selection is documented to cover the MCP bridge");
  assert.equal((await decideHarness({ ...base, id: "pi", explicit: flag, detected: false, ask: yes, mcpAllowed: false })).mcp, false, "--no-mcp: an explicit selection never records MCP consent");
  // MCP consent is separate from provider consent: a y covers the bridge only
  // when the MCP note was shown before the question; stored decisions carry it.
  assert.equal(y.mcp, false, "y without the MCP note is provider consent only");
  assert.equal((await decideHarness({ ...base, ask: yes, mcpOffered: true })).mcp, true);
  assert.equal(stored.mcp, false, "a stored decision without the flag never implies MCP");
  assert.equal((await decideHarness({ ...base, stored: "configured", storedMcp: true, ask: count })).mcp, true);
  assert.equal((await decideHarness({ ...base, owned: true, ask: null })).mcp, undefined, "a refresh never registers MCP");
  const selectedOverSkip = await decideHarness({ ...base, id: "pi", stored: "skipped", explicit: flag, ask: null });
  assert.equal(selectedOverSkip.action, "configure", "an explicit selection overrides a stored n");
  const noneSel = { ids: [], none: true, source: "env" };
  assert.deepEqual(await decideHarness({ ...base, explicit: noneSel, ask: yes }), { action: "skip", source: "env", reason: `${HARNESS_SELECTION_ENV}=none`, record: true, consent: false });
  assert.equal((await decideHarness({ ...base, detected: false, explicit: noneSel, ask: yes })).action, "ignore");
});

test("decideHarness: a kit-owned integration is refreshed without consent, asked about on a terminal, and never wins over a stored n", async () => {
  const base = { id: "omp", label: "OMP / Oh My Pi", detected: true, stored: undefined, owned: true, explicit: undefined };
  const headless = await decideHarness({ ...base, ask: null });
  assert.deepEqual([headless.action, headless.source, headless.record, headless.consent], ["refresh", "existing", false, false]);
  assert.match(headless.reason, /consent not recorded/);
  let asked = 0;
  const y = await decideHarness({ ...base, ask: async () => { asked++; return true; } });
  assert.deepEqual([y.action, y.source, y.record, y.consent, asked], ["configure", "interactive", true, true, 1], "an owned integration is still asked about");
  assert.match(y.note, /existing kit integration found/);
  const n = await decideHarness({ ...base, ask: async () => false });
  assert.deepEqual([n.action, n.record], ["skip", true], "n on an owned integration records the decision and leaves the files alone");
  const eof = await decideHarness({ ...base, ask: async () => undefined });
  assert.deepEqual([eof.action, eof.source, eof.record, eof.consent], ["refresh", "existing", false, false], "no answer: refreshed, nothing recorded");
  const storedN = await decideHarness({ ...base, stored: "skipped", ask: null });
  assert.equal(storedN.action, "skip", "a stored n wins over an owned artifact");
  await assert.rejects(decideHarness({ ...base, ask: async () => { const e = new Error("x"); e.code = ABORTED; throw e; } }), (err) => err.code === ABORTED, "Ctrl-C propagates");
});

test("decideHarness: an unreadable decision file leaves the harness undecided and is never overwritten", async () => {
  const base = { id: "pi", label: "pi", detected: true, stored: undefined, unreadable: true, owned: true, explicit: undefined };
  const headless = await decideHarness({ ...base, ask: null });
  assert.deepEqual([headless.action, headless.record, headless.consent], ["skip", false, false], "no refresh shortcut on an unreadable decision");
  assert.match(headless.reason, /decision file unreadable/);
  const y = await decideHarness({ ...base, ask: async () => true });
  assert.deepEqual([y.action, y.record, y.consent], ["configure", false, true], "a y applies this run but is not recorded over the broken file");
  const n = await decideHarness({ ...base, ask: async () => false });
  assert.deepEqual([n.action, n.record], ["skip", false]);
  const explicit = await decideHarness({ ...base, explicit: { ids: ["pi"], none: false, source: "flag" }, ask: null });
  assert.deepEqual([explicit.action, explicit.record], ["configure", true], "explicit selection still applies (recordHarnessChoice refuses the write)");
});

// --------------------------------------------------------- choices store
function txFixture(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const generated = join(root, "generated");
  const backupDir = join(root, "backups");
  mkdirSync(generated, { recursive: true }); mkdirSync(backupDir, { recursive: true });
  return { root, generated, backupDir, ctx: { generated, backupDir, dryRun: false, tx: null } };
}
const choiceFile = (generated, id) => join(generated, HARNESS_CHOICES_DIR, `${id}.json`);

test("harness choices: one file per harness, malformed files fail closed and are never overwritten, writes go through the transaction, dry-run writes nothing", (t) => {
  const f = txFixture(t, "kit-choices-");
  assert.deepEqual(readHarnessChoices(f.ctx), { harnesses: {}, unreadable: [], errors: [] });
  const dir = join(f.generated, HARNESS_CHOICES_DIR);
  mkdirSync(dir);
  writeFileSync(join(dir, "omp.json"), JSON.stringify({ schema: 1, harness: "omp", decision: "configured", source: "flag", decidedAt: "2026-01-01T00:00:00.000Z" }));
  writeFileSync(join(dir, "pi.json"), "{ not json");
  writeFileSync(join(dir, "codex.json"), JSON.stringify({ schema: 1, decision: "maybe" }));
  writeFileSync(join(dir, "notes.txt"), "ignored");
  const loaded = readHarnessChoices(f.ctx);
  assert.deepEqual(loaded.harnesses, { omp: { decision: "configured", source: "flag", decidedAt: "2026-01-01T00:00:00.000Z", mcp: false } }, "a decision without the flag never implies MCP consent");
  writeFileSync(join(dir, "aider.json"), JSON.stringify({ schema: 1, harness: "aider", decision: "configured", source: "interactive", decidedAt: "", mcp: true }));
  assert.equal(readHarnessChoices(f.ctx).harnesses.aider.mcp, true);
  rmSync(join(dir, "aider.json"));
  assert.deepEqual(loaded.unreadable.sort(), ["codex", "pi"], "malformed and unknown decisions count as unreadable, never as consent");
  assert.equal(loaded.errors.length, 2);
  assert.ok(loaded.errors.every((e) => /fix or remove the file/.test(e)));

  const tx = beginTransaction(f.backupDir, "test");
  f.ctx.tx = tx;
  recordHarnessChoice(f.ctx, tx, loaded, "goose", "skipped", "interactive", () => "2026-02-02T00:00:00.000Z");
  const written = JSON.parse(readFileSync(choiceFile(f.generated, "goose"), "utf8"));
  assert.deepEqual(written, { schema: 1, harness: "goose", decision: "skipped", source: "interactive", decidedAt: "2026-02-02T00:00:00.000Z" });
  assert.equal(loaded.harnesses.goose.decision, "skipped", "the in-memory view follows the write");
  assert.equal(tx.ops.length, 1, "recorded in the transaction");
  assert.equal(tx.ops[0].kind, "create");
  const firstHash = tx.ops[0].expectedHash;
  recordHarnessChoice(f.ctx, tx, loaded, "goose", "skipped", "interactive", () => "2026-03-03T00:00:00.000Z");
  assert.equal(readFileSync(choiceFile(f.generated, "goose"), "utf8"), JSON.stringify(written, null, 2) + "\n", "an unchanged decision is not rewritten");
  assert.equal(tx.ops[0].expectedHash, firstHash);
  recordHarnessChoice(f.ctx, tx, loaded, "goose", "configured", "flag", () => "2026-03-03T00:00:00.000Z");
  assert.equal(JSON.parse(readFileSync(choiceFile(f.generated, "goose"), "utf8")).decision, "configured", "a changed decision is rewritten");
  assert.equal(tx.ops.length, 1, "the same file stays one journalled op");
  assert.deepEqual(tx.ops[0].expectedHashes, [firstHash], "both write hashes stay known to the rollback");
  assert.notEqual(tx.ops[0].expectedHash, firstHash);

  recordHarnessChoice(f.ctx, tx, loaded, "pi", "configured", "flag");
  assert.equal(readFileSync(join(dir, "pi.json"), "utf8"), "{ not json", "an unreadable decision is never overwritten");
  assert.equal(loaded.harnesses.pi, undefined);

  const before = readdirSync(dir).sort();
  recordHarnessChoice({ ...f.ctx, dryRun: true }, tx, readHarnessChoices(f.ctx), "aider", "configured", "flag");
  assert.deepEqual(readdirSync(dir).sort(), before, "dry-run never writes");

  // Rolling the transaction back removes the decisions it recorded.
  const id = tx.finish();
  const r = rollbackTransaction(f.backupDir, id);
  assert.ok(r.complete, JSON.stringify(r));
  assert.equal(existsSync(choiceFile(f.generated, "goose")), false, "rollback removes the recorded decision");
  assert.equal(existsSync(join(dir, "omp.json")), true, "decisions from earlier runs stay");
});

test("an unreadable choices directory marks every harness unreadable", (t) => {
  const f = txFixture(t, "kit-choices-dir-");
  writeFileSync(join(f.generated, HARNESS_CHOICES_DIR), "a file where the directory should be");
  const loaded = readHarnessChoices(f.ctx);
  assert.deepEqual(loaded.harnesses, {});
  assert.deepEqual(loaded.unreadable, ["*"]);
  assert.equal(loaded.errors.length, 1);
  const tx = beginTransaction(f.backupDir, "test");
  recordHarnessChoice(f.ctx, tx, loaded, "omp", "configured", "flag");
  assert.equal(tx.ops.length, 0, "nothing is written over an unreadable store");
  assert.deepEqual(consentedForRepair(f.ctx, ["omp"], { omp: true }, { omp: { owned: () => true } }, loaded), [], "no repair while the store is unreadable");
  assert.match(consentStatus(f.ctx, "omp", { owned: () => true }, true, loaded).detail, /decision file unreadable/);
});

test("consentedForRepair and consentStatus keep repairs and checks inside stored consent or kit-owned integrations", (t) => {
  const f = txFixture(t, "kit-repair-");
  const dir = join(f.generated, HARNESS_CHOICES_DIR);
  mkdirSync(dir);
  const write = (id, decision) => writeFileSync(join(dir, `${id}.json`), JSON.stringify({ schema: 1, harness: id, decision, source: "interactive", decidedAt: "" }));
  write("omp", "configured"); write("pi", "skipped"); write("cline", "configured");
  writeFileSync(join(dir, "kilo-code.json"), "broken");
  const adapters = {
    omp: { owned: () => false },
    pi: { owned: () => true },
    codex: { owned: () => true },
    aider: { owned: () => false },
    goose: { owned: () => { throw new Error("unreadable"); } },
    cline: { owned: () => false },
    "kilo-code": { owned: () => true },
  };
  const detected = { omp: true, pi: true, codex: true, aider: true, goose: true, cline: false, "kilo-code": true };
  const ids = ["omp", "pi", "codex", "aider", "goose", "cline", "kilo-code"];
  assert.deepEqual(consentedForRepair(f.ctx, ids, detected, adapters), ["omp", "codex"],
    "stored y or an owned integration; never a stored n, an undetected, an unowned or an unreadable harness");
  assert.deepEqual(consentedForRepair(f.ctx, ["omp"], { omp: false }, adapters), [], "undetected harnesses are never repaired");
  assert.deepEqual(consentStatus(f.ctx, "omp", adapters.omp, true), { verify: true });
  assert.deepEqual(consentStatus(f.ctx, "codex", adapters.codex, true), { verify: true }, "owned integrations are verified");
  const declined = consentStatus(f.ctx, "pi", adapters.pi, true);
  assert.equal(declined.verify, false); assert.match(declined.detail, /your choice.*zcode-kit integrate pi/);
  const undecided = consentStatus(f.ctx, "aider", adapters.aider, true);
  assert.equal(undecided.verify, false); assert.match(undecided.detail, /no consent yet/);
  assert.match(consentStatus(f.ctx, "goose", adapters.goose, false).detail, /not detected/);
  assert.match(consentStatus(f.ctx, "kilo-code", adapters["kilo-code"], true).detail, /decision file unreadable/);
});

// ------------------------------------------------------- savepoints
test("transaction savepoint/restoreSince undoes only the ops of one failed harness and keeps foreign edits", (t) => {
  const f = txFixture(t, "kit-savepoint-");
  const ctx = { generated: f.generated, backupDir: f.backupDir, dryRun: false };
  const tx = beginTransaction(f.backupDir, "test");
  ctx.tx = tx;
  const kept = join(f.root, "kept.txt");
  writeFileSync(kept, "before\n");
  commitFile(ctx, tx, kept, "first harness\n");
  const savepoint = tx.savepoint();
  assert.equal(savepoint, 1);
  const modified = join(f.root, "modified.txt");
  writeFileSync(modified, "original\n");
  const created = join(f.root, "created.txt");
  const foreign = join(f.root, "foreign.txt");
  writeFileSync(foreign, "original\n");
  commitFile(ctx, tx, modified, "kit write\n");
  commitFile(ctx, tx, created, "kit created\n");
  commitFile(ctx, tx, foreign, "kit write\n");
  writeFileSync(foreign, "changed by someone else\n");
  tx.external("registered elsewhere", "undo elsewhere");
  const result = tx.restoreSince(savepoint);
  assert.deepEqual(result, { restored: [modified], removed: [created], conflicts: [foreign] });
  assert.equal(readFileSync(modified, "utf8"), "original\n", "modified file restored from its backup");
  assert.equal(existsSync(created), false, "created file removed");
  assert.equal(readFileSync(foreign, "utf8"), "changed by someone else\n", "a file changed meanwhile is left alone");
  assert.equal(readFileSync(kept, "utf8"), "first harness\n", "ops before the savepoint stay applied");
  assert.deepEqual(tx.ops.map((op) => op.kind), ["modify", "modify", "external"], "conflicts and externals stay journalled");
  // A later touch of a file with the same basename must not reuse the kept
  // conflict op's backup name (its backup would be overwritten).
  const conflictBackup = join(tx.dir, tx.ops[1].backup);
  assert.equal(readFileSync(conflictBackup, "utf8"), "original\n");
  mkdirSync(join(f.root, "sub"));
  const sameName = join(f.root, "sub", "foreign.txt");
  writeFileSync(sameName, "second original\n");
  commitFile(ctx, tx, sameName, "kit write two\n");
  assert.notEqual(tx.ops[tx.ops.length - 1].backup, tx.ops[1].backup, "backup names never collide after restoreSince");
  assert.equal(readFileSync(conflictBackup, "utf8"), "original\n", "the kept conflict backup is intact");
  const id = tx.finish();
  const rolled = rollbackTransaction(f.backupDir, id);
  assert.equal(readFileSync(kept, "utf8"), "before\n", "the finished transaction still rolls back the kept op");
  assert.equal(rolled.conflicts.length, 1); assert.match(rolled.conflicts[0], /changed after the transaction/);
  assert.equal(rolled.external.length, 1, "the external op still asks for its manual undo");
  assert.equal(rolled.complete, false);
});

// ------------------------------------------------------------ CLI e2e
function fixture(t, { detect = ["omp", "pi"], mcpDist = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-consent-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const member of ["cli", "lib"]) cpSync(join(KIT, member), join(root, member), { recursive: true });
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "logs")); mkdirSync(join(root, "zcode-proxy-src"));
  cpSync(join(KIT, "proxy", "config.example.yaml"), join(root, "proxy", "config.example.yaml"));
  cpSync(join(KIT, "proxy", "zcode-proxy-manager.mjs"), join(root, "proxy", "zcode-proxy-manager.mjs"));
  cpSync(join(KIT, "proxy", "zcode-proxy-autostart.ts"), join(root, "proxy", "zcode-proxy-autostart.ts"));
  // The OMP adapter validates YAML with the proxy's `yaml` dependency.
  cpSync(join(KIT, "zcode-proxy-src", "package.json"), join(root, "zcode-proxy-src", "package.json"));
  symlinkSync(join(KIT, "zcode-proxy-src", "node_modules"), join(root, "zcode-proxy-src", "node_modules"), process.platform === "win32" ? "junction" : "dir");
  if (mcpDist) {
    mkdirSync(join(root, "mcp", "zcode-harness-mcp", "dist"), { recursive: true });
    writeFileSync(join(root, "mcp", "zcode-harness-mcp", "dist", "index.js"), "// fixture bridge\n");
  }
  const home = join(root, "home");
  mkdirSync(home);
  if (detect.includes("omp")) {
    mkdirSync(join(home, ".omp", "agent"), { recursive: true });
    writeFileSync(join(home, ".omp", "agent", "models.yml"), "# user models\nproviders:\n  openai:\n    name: OpenAI\n");
    writeFileSync(join(home, ".omp", "agent", "config.yml"), "extensions: []\n");
  }
  if (detect.includes("pi")) {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "llama" }] } } }, null, 2) + "\n");
  }
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"), ZCODE_KIT_SKIP_DEPS: "1", ZCODE_PROXY_CREDENTIALS_PATH: join(home, "credentials.json"),
    PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
  };
  delete env[HARNESS_SELECTION_ENV]; delete env.ZCODE_KIT_STATE_DIR; delete env.ZCODE_KIT_ACCOUNT_ROTATOR; delete env.CI;
  const choicesDir = join(root, "generated", HARNESS_CHOICES_DIR);
  return {
    root, home, env, choicesDir,
    omp: join(home, ".omp", "agent", "models.yml"), pi: join(home, ".pi", "agent", "models.json"),
    mcp: join(home, ".omp", "agent", "mcp.json"),
    choice: (id) => join(choicesDir, `${id}.json`),
    key: () => readFileSync(join(root, ".proxykey"), "utf8").trim(),
  };
}
function run(f, args, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(f.root, "cli", "zcode-kit.mjs"), ...args], { env: { ...f.env, ...extraEnv }, encoding: "utf8", timeout: 60000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? -1) : 0, stdout, stderr, text: `${stdout}\n${stderr}` }));
  });
}
/** { id: "decision/source" } for every readable decision file, null when none exist. */
function choicesOf(f) {
  if (!existsSync(f.choicesDir)) return null;
  const out = {};
  for (const name of readdirSync(f.choicesDir).sort()) {
    try { const j = JSON.parse(readFileSync(join(f.choicesDir, name), "utf8")); out[name.slice(0, -5)] = `${j.decision}/${j.source}`; } catch { out[name.slice(0, -5)] = "unreadable"; }
  }
  return Object.keys(out).length ? out : null;
}
const writeChoice = (f, id, decision, source = "interactive") => {
  mkdirSync(f.choicesDir, { recursive: true });
  writeFileSync(f.choice(id), JSON.stringify({ schema: 1, harness: id, decision, source, decidedAt: "" }));
};

test("setup without a terminal skips every undecided harness, writes nothing, exits 0 and redacts the key", async (t) => {
  const f = fixture(t);
  const before = [readFileSync(f.omp, "utf8"), readFileSync(f.pi, "utf8")];
  const r = await run(f, ["setup"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /No interactive terminal: harnesses without a saved decision are skipped/);
  assert.match(r.stdout, /\[SKIP\] OMP \/ Oh My Pi — no interactive consent/);
  assert.match(r.stdout, /\[SKIP\] pi — no interactive consent/);
  assert.match(r.stdout, /Assistants: 0 configured, 2 skipped, 0 failed/);
  assert.match(r.stdout, /Undecided harnesses can be configured later/);
  assert.match(r.stdout, /Account Rotator setting unchanged \(no interactive answer\)/, "rotator question stays independent");
  assert.doesNotMatch(r.stdout, /Configure ZCode as a provider/, "no question is printed without a terminal");
  assert.deepEqual([readFileSync(f.omp, "utf8"), readFileSync(f.pi, "utf8")], before, "harness configs untouched");
  assert.equal(existsSync(f.mcp), false, "no MCP registration without consent");
  assert.equal(choicesOf(f), null, "no answer, no stored decision");
  assert.match(r.stdout, /OpenAI-compatible base URL:\s+http:\/\/127\.0\.0\.1:8457\/v1/);
  assert.match(r.stdout, /Anthropic-compatible base URL: http:\/\/127\.0\.0\.1:8457 /);
  assert.match(r.stdout, /proxy not verified running/);
  assert.ok(!r.text.includes(f.key()), "the local proxy key never appears in non-terminal output");
});

test("explicit --harness selection configures only the named harness, records it, and later auto runs keep it without re-asking", async (t) => {
  const f = fixture(t);
  const piBefore = readFileSync(f.pi, "utf8");
  const r1 = await run(f, ["setup", "--harness", "omp"]);
  assert.equal(r1.code, 0, r1.text);
  assert.match(r1.stdout, /\[OK\]\s+OMP \/ Oh My Pi/);
  assert.match(r1.stdout, /Assistants: 1 configured, 0 skipped, 0 failed/);
  assert.doesNotMatch(r1.stdout, /No interactive terminal/, "an explicit selection needs no terminal");
  assert.match(readFileSync(f.omp, "utf8"), /# >>> zcode-kit \(managed block\)/);
  assert.equal(readFileSync(f.pi, "utf8"), piBefore, "unselected harness untouched");
  assert.ok(existsSync(f.mcp), "MCP registered for the consented harness only");
  assert.deepEqual(choicesOf(f), { omp: "configured/flag" });
  const ompAfter = readFileSync(f.omp, "utf8");
  const r2 = await run(f, ["setup"]);
  assert.equal(r2.code, 0, r2.text);
  assert.match(r2.stdout, /\[OK\]\s+OMP \/ Oh My Pi\s*$/m, "stored consent is honoured without a refresh note");
  assert.match(r2.stdout, /\[SKIP\] pi — no interactive consent/);
  assert.equal(readFileSync(f.omp, "utf8"), ompAfter, "idempotent");
  assert.doesNotMatch(r2.stdout, /transaction \S+ recorded/, "no-op run records no transaction");
  const r3 = await run(f, ["setup"], { [HARNESS_SELECTION_ENV]: "pi" });
  assert.equal(r3.code, 0, r3.text);
  assert.match(r3.stdout, /\[OK\]\s+pi/);
  assert.ok(JSON.parse(readFileSync(f.pi, "utf8")).providers.zcode, "env selection configures pi");
  assert.deepEqual(choicesOf(f), { omp: "configured/flag", pi: "configured/env" }, "env selection leaves other decisions alone");
  const bad = await run(f, ["setup", "--harness", "nonsense"]);
  assert.equal(bad.code, 2, "an unknown harness is an error, not a no-op");
  assert.match(bad.stderr, /unknown harness "nonsense"/);
});

test("`none` records skipped decisions that later runs respect; an explicit selection or --reask changes them, n never deletes", async (t) => {
  const f = fixture(t);
  const r1 = await run(f, ["setup"], { [HARNESS_SELECTION_ENV]: "none" });
  assert.equal(r1.code, 0, r1.text);
  assert.match(r1.stdout, new RegExp(`\\[SKIP\\] OMP / Oh My Pi — ${HARNESS_SELECTION_ENV}=none`));
  assert.match(r1.stdout, /Assistants: 0 configured, 2 skipped, 0 failed/);
  assert.deepEqual(choicesOf(f), { omp: "skipped/env", pi: "skipped/env" });
  const r2 = await run(f, ["setup"]);
  assert.match(r2.stdout, /\[SKIP\] OMP \/ Oh My Pi — previously skipped \(change with: zcode-kit integrate omp, setup --harness omp, or setup --reask\)/);
  assert.doesNotMatch(r2.stdout, /Undecided harnesses/, "a stored n is a decision, not an open question");
  assert.doesNotMatch(readFileSync(f.omp, "utf8"), /zcode-kit/);
  const r3 = await run(f, ["setup", "--harness", "pi"]);
  assert.equal(r3.code, 0, r3.text);
  assert.deepEqual(choicesOf(f), { omp: "skipped/env", pi: "configured/flag" });
  const configured = readFileSync(f.pi, "utf8");
  const r4 = await run(f, ["setup", "--reask"]);
  assert.equal(r4.code, 0, r4.text);
  assert.match(r4.stdout, /\[SKIP\] OMP \/ Oh My Pi — previously skipped/, "--reask without a terminal keeps stored decisions");
  assert.match(r4.stdout, /\[OK\]\s+pi\s*$/m);
  assert.deepEqual(choicesOf(f), { omp: "skipped/env", pi: "configured/flag" }, "--reask without an answer changes no decision");
  assert.equal(readFileSync(f.pi, "utf8"), configured, "and deletes nothing");
});

test("a kit-owned integration without a stored decision is refreshed (no consent recorded, no MCP); a stored n never deletes it", async (t) => {
  const f = fixture(t);
  assert.equal((await run(f, ["setup", "--harness", "omp"])).code, 0);
  const configured = readFileSync(f.omp, "utf8");
  rmSync(f.choicesDir, { recursive: true });
  rmSync(f.mcp);
  const r = await run(f, ["setup"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /\[OK\]\s+OMP \/ Oh My Pi — existing kit integration refreshed \(no consent recorded\)/);
  assert.equal(choicesOf(f), null, "a refresh never records consent");
  assert.equal(readFileSync(f.omp, "utf8"), configured);
  assert.equal(existsSync(f.mcp), false, "MCP registration follows consent, not a refresh");
  writeChoice(f, "omp", "skipped");
  const r2 = await run(f, ["setup"]);
  assert.match(r2.stdout, /\[SKIP\] OMP \/ Oh My Pi — previously skipped/);
  assert.equal(readFileSync(f.omp, "utf8"), configured, "n leaves the existing block untouched");
});

test("an unreadable decision file blocks the refresh shortcut and is left alone; the run still succeeds", async (t) => {
  const f = fixture(t);
  assert.equal((await run(f, ["setup", "--harness", "omp"])).code, 0);
  writeFileSync(f.choice("omp"), "{ broken");
  const r = await run(f, ["setup"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /\[SKIP\] OMP \/ Oh My Pi — decision file unreadable — fix or remove it/);
  assert.match(r.text, /omp\.json: .*fix or remove the file/);
  assert.equal(readFileSync(f.choice("omp"), "utf8"), "{ broken", "never overwritten");
  const r2 = await run(f, ["setup", "--harness", "omp"]);
  assert.equal(r2.code, 0, r2.text);
  assert.match(r2.stdout, /\[OK\]\s+OMP \/ Oh My Pi/, "an explicit selection still applies");
  assert.equal(readFileSync(f.choice("omp"), "utf8"), "{ broken", "still never overwritten");
});

test("one failing harness does not stop the others: its partial writes are undone, summary distinguishes configured and failed, exit 20", async (t) => {
  const f = fixture(t);
  writeFileSync(f.pi, "{ this is not json");
  const r = await run(f, ["setup", "--harness", "omp,pi"]);
  assert.equal(r.code, 20, `exit 20 = kit configured, a harness failed (never 1, which a crash also yields)\n${r.text}`);
  assert.match(r.stdout, /\[OK\]\s+OMP \/ Oh My Pi/);
  assert.match(r.stdout, /\[FAIL\] pi — .*not valid JSON/);
  assert.match(r.stdout, /Assistants: 1 configured, 0 skipped, 1 failed/);
  assert.match(r.stdout, /failed: pi — /);
  assert.match(readFileSync(f.omp, "utf8"), /# >>> zcode-kit \(managed block\)/);
  assert.deepEqual(choicesOf(f), { omp: "configured/flag" }, "a failed harness is never recorded as configured");
  assert.equal(readFileSync(f.pi, "utf8"), "{ this is not json", "refused file left byte-identical");
});

test("no detected harness is not an error; integrate records consent; doctor reports declined harnesses as SKIP and --fix repairs only consented ones", async (t) => {
  const f = fixture(t, { detect: [] });
  const r = await run(f, ["setup"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /No supported assistant detected/);
  assert.match(r.stdout, /Assistants: 0 configured, 0 skipped, 0 failed/);
  const g = fixture(t);
  assert.equal((await run(g, ["integrate", "pi"])).code, 0);
  assert.deepEqual(choicesOf(g), { pi: "configured/integrate" });
  writeChoice(g, "omp", "skipped");
  const doctor = await run(g, ["doctor", "--json"]);
  const checks = JSON.parse(doctor.stdout.slice(doctor.stdout.indexOf("{"))).checks;
  const omp = checks.find((c) => c.name === "omp: integration");
  assert.equal(omp?.ok, null, "a declined harness is a SKIP, not a FAIL");
  assert.match(omp.detail, /your choice/);
  assert.ok(checks.some((c) => c.name.startsWith("pi: ") && c.ok === true), "the consented harness is verified");
  assert.ok(!checks.some((c) => c.name.startsWith("omp: ") && c.ok === false), `no OMP failure\n${doctor.stdout}`);
  const piDoc = JSON.parse(readFileSync(g.pi, "utf8"));
  delete piDoc.providers.zcode; // drift: the consented integration is missing again
  writeFileSync(g.pi, JSON.stringify(piDoc, null, 2) + "\n");
  const ompBefore = readFileSync(g.omp, "utf8");
  const fix = await run(g, ["doctor", "--fix"]);
  assert.ok(JSON.parse(readFileSync(g.pi, "utf8")).providers.zcode, `doctor --fix re-applies the consented harness\n${fix.text}`);
  assert.equal(readFileSync(g.omp, "utf8"), ompBefore, "doctor --fix never integrates a skipped harness");
});

test("integrate records provider consent only: a later setup refreshes the harness but never registers MCP from it", async (t) => {
  const f = fixture(t);
  const r1 = await run(f, ["integrate", "omp"]);
  assert.equal(r1.code, 0, r1.text);
  assert.deepEqual(choicesOf(f), { omp: "configured/integrate" });
  assert.equal(existsSync(f.mcp), false, "integrate never registers the bridge");
  const r2 = await run(f, ["setup"]);
  assert.equal(r2.code, 0, r2.text);
  assert.match(r2.stdout, /\[OK\]\s+OMP \/ Oh My Pi\s*$/m, "stored consent refreshes the provider integration");
  assert.equal(existsSync(f.mcp), false, "a stored decision without MCP consent never registers the bridge");
  assert.equal(JSON.parse(readFileSync(f.choice("omp"), "utf8")).mcp, undefined, "the flag is not invented later");
  const r3 = await run(f, ["setup", "--harness", "omp"]);
  assert.equal(r3.code, 0, r3.text);
  assert.equal(existsSync(f.mcp), true, "an explicit selection is documented MCP consent");
  assert.equal(JSON.parse(readFileSync(f.choice("omp"), "utf8")).mcp, true);
});

test("--no-mcp with an explicit selection records provider consent only; later runs never register the declined bridge; integrate keeps a recorded MCP consent", async (t) => {
  const f = fixture(t);
  const r1 = await run(f, ["setup", "--harness", "omp", "--no-mcp"]);
  assert.equal(r1.code, 0, r1.text);
  assert.match(r1.stdout, /\[OK\]\s+OMP \/ Oh My Pi/);
  assert.equal(existsSync(f.mcp), false, "--no-mcp skips the bridge");
  assert.equal(JSON.parse(readFileSync(f.choice("omp"), "utf8")).mcp, undefined, "a declined bridge is not stored as consent");
  const r2 = await run(f, ["setup"]);
  assert.equal(r2.code, 0, r2.text);
  assert.equal(existsSync(f.mcp), false, "a later plain setup never registers the bridge the user declined");
  const r3 = await run(f, ["setup", "--harness", "omp"]);
  assert.equal(r3.code, 0, r3.text);
  assert.equal(existsSync(f.mcp), true, "selecting the harness again without --no-mcp is the documented MCP consent");
  assert.equal(JSON.parse(readFileSync(f.choice("omp"), "utf8")).mcp, true);
  const r4 = await run(f, ["integrate", "omp"]);
  assert.equal(r4.code, 0, r4.text);
  const after = JSON.parse(readFileSync(f.choice("omp"), "utf8"));
  assert.equal(after.source, "integrate");
  assert.equal(after.mcp, true, "integrate neither grants nor revokes the MCP consent recorded earlier");
});

test("parseSelection: numbers, all, none; anything else is asked again", () => {
  assert.deepEqual([...parseSelection("1,3", 3)], [0, 2]);
  assert.deepEqual([...parseSelection(" 2  1 ", 3)].sort(), [0, 1]);
  assert.deepEqual([...parseSelection("ALL", 2)], [0, 1]);
  assert.equal(parseSelection("none", 2).size, 0);
  for (const bad of ["", "0", "4", "1,x", "1-2", "y"]) assert.equal(parseSelection(bad, 3), undefined, bad);
});

test("--select without a terminal or next to an explicit selection changes nothing", async (t) => {
  const f = fixture(t);
  const r = await run(f, ["setup", "--select"]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /--select needs an interactive terminal — ignored/);
  assert.match(r.stdout, /\[SKIP\] OMP \/ Oh My Pi — no interactive consent/);
  assert.equal(choicesOf(f), null);
  const e = await run(f, ["setup", "--select", "--harness", "pi"]);
  assert.equal(e.code, 0, e.text);
  assert.match(e.stdout, /--select ignored — the explicit selection \(--harness\) decides/);
  assert.deepEqual(choicesOf(f), { pi: "configured/flag" });
});

test("doctor reports decision files (unreadable = FAIL with the way out, undetected/unknown = SKIP); --forget removes one through a transaction", async (t) => {
  const f = fixture(t);
  writeChoice(f, "omp", "configured");
  writeChoice(f, "codex", "skipped"); // not detected in this fixture
  writeFileSync(f.choice("pi"), "{ broken");
  writeFileSync(f.choice("mystery"), JSON.stringify({ schema: 1, harness: "mystery", decision: "skipped", source: "x", decidedAt: "" }));
  const doctor = await run(f, ["doctor", "--json"]);
  const checks = JSON.parse(doctor.stdout.slice(doctor.stdout.indexOf("{"))).checks;
  const by = (name) => checks.find((c) => c.name === name);
  assert.equal(by("pi: decision file")?.ok, false, "an unreadable decision is a failure");
  assert.match(by("pi: decision file").detail, /zcode-kit doctor --forget pi/);
  assert.equal(by("codex: decision file")?.ok, null);
  assert.match(by("codex: decision file").detail, /not detected/);
  assert.equal(by("mystery: decision file")?.ok, null);
  assert.equal(by("omp: decision file"), undefined, "a readable decision of a detected harness needs no line");
  const piBefore = readFileSync(f.pi, "utf8");
  const brokenBytes = readFileSync(f.choice("pi"));
  const forget = await run(f, ["doctor", "--forget", "pi"]);
  assert.equal(forget.code, 0, forget.text);
  assert.match(forget.stdout, /Decision for pi removed\. Its integration is unchanged; the next zcode-kit setup asks again\./);
  assert.equal(existsSync(f.choice("pi")), false);
  assert.equal(readFileSync(f.pi, "utf8"), piBefore, "the integration itself is never touched");
  const tx = forget.stdout.match(/undo with: zcode-kit rollback (\S+)/)?.[1];
  assert.ok(tx, forget.stdout);
  const rb = await run(f, ["rollback", tx]);
  assert.equal(rb.code, 0, rb.text);
  assert.deepEqual(readFileSync(f.choice("pi")), brokenBytes, "rollback restores the file byte for byte");
  assert.equal((await run(f, ["doctor", "--forget", "goose"])).code, 0, "no decision: nothing to forget");
  const unknown = await run(f, ["doctor", "--forget", "nonsense"]);
  assert.equal(unknown.code, 2);
  assert.equal((await run(f, ["doctor", "--forget"])).code, 2, "a missing id changes nothing");
  assert.equal((await run(f, ["doctor", "--forget", "mystery"])).code, 0, "a stored unknown id can be removed");
  assert.equal(existsSync(f.choice("mystery")), false);
});

test("rolling back a setup removes the decisions it recorded together with the integration", async (t) => {
  const f = fixture(t);
  const r = await run(f, ["setup", "--harness", "omp"]);
  assert.equal(r.code, 0, r.text);
  const before = readFileSync(f.omp, "utf8");
  const rb = await run(f, ["rollback"]);
  assert.equal(rb.code, 0, rb.text);
  assert.doesNotMatch(readFileSync(f.omp, "utf8"), /zcode-kit/, "integration undone");
  assert.notEqual(readFileSync(f.omp, "utf8"), before);
  assert.equal(choicesOf(f), null, "the decision recorded by that setup is gone too");
});

// Real terminal proof (Linux `script` allocates a pty): questions are asked in
// order, y configures, n skips, the rotator question follows separately, and
// Ctrl-C stops the questions without touching what was not consented to.
const script = process.platform === "linux" && spawnSync("script", ["--version"], { stdio: "ignore" }).status === 0;
// The interactive proofs must not vanish silently from CI: Linux runners
// ship util-linux, so a missing `script` there is an environment error.
if (process.platform === "linux" && process.env.CI && !script) throw new Error("script(1) is required on Linux CI for the pty tests");
/**
 * Run the CLI on a pty. `input` is either a string typed ahead before the
 * first question, or [{ after, send }] pairs typed once `after` appeared in
 * the output (needed for keys the line discipline would act on itself, such
 * as Ctrl-C before readline switched the pty to raw mode).
 */
function runPty(f, args, input, timeout = 90000) {
  const cli = join(f.root, "cli", "zcode-kit.mjs");
  return new Promise((resolve) => {
    const child = spawn("script", ["-qec", `${process.execPath} ${cli} ${args.join(" ")}`, "/dev/null"], { env: f.env });
    let raw = "", stderr = "";
    const scripted = Array.isArray(input) ? [...input] : null;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (chunk) => {
      raw += chunk;
      while (scripted?.length && raw.includes(scripted[0].after)) child.stdin.write(scripted.shift().send);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? `signal ${signal}`, out: raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""), stderr });
    });
    if (!scripted) { child.stdin.write(input); child.stdin.end(); }
  });
}
test("interactive setup asks per harness and applies the answers", { skip: !script }, async (t) => {
  const f = fixture(t);
  const r = await runPty(f, ["setup"], "y\nn\nn\n");
  assert.equal(r.code, 0, `${r.out}\n${r.stderr}`);
  assert.ok(r.out.indexOf("in OMP / Oh My Pi? [y/n]") < r.out.indexOf("in pi? [y/n]"), "questions in detection order");
  assert.ok(r.out.indexOf("in pi? [y/n]") < r.out.indexOf(`${ACCOUNT_ROTATOR_QUESTION} [y/n]`), "rotator question comes after the harness questions");
  assert.match(r.out, /note: y also registers the kit's MCP bridge "zcode-harness" for OMP \/ Oh My Pi/);
  assert.match(r.out, /\[OK\]\s+OMP \/ Oh My Pi/);
  assert.match(r.out, /\[SKIP\] pi — answered n/);
  assert.match(readFileSync(f.omp, "utf8"), /# >>> zcode-kit \(managed block\)/);
  assert.ok(!JSON.parse(readFileSync(f.pi, "utf8")).providers.zcode, "n writes nothing");
  assert.ok(existsSync(f.mcp), "MCP registered after y");
  assert.deepEqual(choicesOf(f), { omp: "configured/interactive", pi: "skipped/interactive" });
  assert.ok(r.out.includes(f.key()), "an interactive terminal shows the copyable key");
  // A second interactive run neither re-asks the decided harnesses nor changes them.
  const again = await runPty(f, ["setup"], "n\n");
  assert.equal(again.code, 0, `${again.out}\n${again.stderr}`);
  assert.doesNotMatch(again.out, /in OMP \/ Oh My Pi\? \[y\/n\]/, "stored y is not asked again");
  assert.doesNotMatch(again.out, /in pi\? \[y\/n\]/, "stored n is not asked again");
  assert.match(again.out, /\[SKIP\] pi — previously skipped/);
  assert.deepEqual(choicesOf(f), { omp: "configured/interactive", pi: "skipped/interactive" });
  // --reask asks both again; the owned OMP integration is announced before its question.
  const reask = await runPty(f, ["setup", "--reask"], "n\ny\nn\n");
  assert.equal(reask.code, 0, `${reask.out}\n${reask.stderr}`);
  assert.match(reask.out, /note: an existing kit integration for OMP \/ Oh My Pi was found; y keeps it current, n leaves it untouched/);
  assert.match(reask.out, /\[SKIP\] OMP \/ Oh My Pi — answered n/);
  assert.match(reask.out, /\[OK\]\s+pi/);
  assert.match(readFileSync(f.omp, "utf8"), /# >>> zcode-kit \(managed block\)/, "n never deletes an existing integration");
  assert.ok(JSON.parse(readFileSync(f.pi, "utf8")).providers.zcode);
  assert.deepEqual(choicesOf(f), { omp: "skipped/interactive", pi: "configured/interactive" });
});

test("setup --select: one numbered list, invalid answers repeat, chosen = configured, the rest = skipped, no per-harness question", { skip: !script }, async (t) => {
  const f = fixture(t);
  const r = await runPty(f, ["setup", "--select"], [
    { after: "(numbers, all, none)", send: "7\n" },
    { after: "Please enter numbers from the list", send: "2\n" },
    { after: "[y/n]", send: "n\n" },
  ]);
  assert.equal(r.code, 0, `${r.out}\n${r.stderr}`);
  assert.match(r.out, /1\) OMP \/ Oh My Pi\s*\n\s*2\) pi/);
  assert.match(r.out, /note: selecting OMP \/ Oh My Pi also registers the kit's MCP bridge/);
  assert.doesNotMatch(r.out, /in OMP \/ Oh My Pi\? \[y\/n\]/, "no per-harness question");
  assert.match(r.out, /\[SKIP\] OMP \/ Oh My Pi — answered n/);
  assert.match(r.out, /\[OK\]\s+pi/);
  assert.deepEqual(choicesOf(f), { omp: "skipped/interactive", pi: "configured/interactive" });
  assert.equal(existsSync(f.mcp), false, "the bridge only for a chosen harness");
  const all = await runPty(f, ["setup", "--select"], [{ after: "(numbers, all, none)", send: "all\n" }, { after: "[y/n]", send: "n\n" }]);
  assert.equal(all.code, 0, `${all.out}\n${all.stderr}`);
  assert.match(all.out, /1\) OMP \/ Oh My Pi \(currently skipped\)/, "stored decisions are shown");
  assert.deepEqual(choicesOf(f), { omp: "configured/interactive", pi: "configured/interactive" });
  assert.ok(existsSync(f.mcp), "chosen after the MCP note: bridge registered");
});

test("Ctrl-C during the questions stops setup: answered harnesses stay, the rest is skipped, exit 130", { skip: !script }, async (t) => {
  const f = fixture(t);
  const piBefore = readFileSync(f.pi, "utf8");
  const r = await runPty(f, ["setup"], [{ after: "in OMP / Oh My Pi? [y/n]", send: "y\n" }, { after: "in pi? [y/n]", send: "\x03" }]);
  assert.equal(r.code, 130, `${r.out}\n${r.stderr}`);
  assert.match(r.out, /\[OK\]\s+OMP \/ Oh My Pi/, "the y given before Ctrl-C is applied");
  assert.match(r.out, /\[SKIP\] pi — aborted/);
  assert.match(r.out, /Aborted by the user: remaining questions were skipped/);
  assert.match(r.out, /\[SKIP\] aborted by the user/, "no connection check after an abort");
  assert.doesNotMatch(r.out, /Account Rotator enabled|Account Rotator disabled/, "the rotator question is not answered by the abort");
  assert.match(readFileSync(f.omp, "utf8"), /# >>> zcode-kit \(managed block\)/);
  assert.equal(readFileSync(f.pi, "utf8"), piBefore, "the aborted harness is untouched");
  assert.deepEqual(choicesOf(f), { omp: "configured/interactive" }, "only the given answer is recorded");
});
