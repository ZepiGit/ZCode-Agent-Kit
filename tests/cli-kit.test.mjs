// zcode-kit CLI tests: JSONC editor, new adapters against fake homes,
// dry-run semantics, idempotency, unknown-harness errors (audit §12.A lite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseJsonc, setTopLevelKey } from "../lib/jsonc.mjs";
import { createCtx } from "../cli/context.mjs";

const KIT = join(import.meta.dirname, "..");
const TMP = join(import.meta.dirname, "fakehome", "kit");

function fakeHome(name) {
  const home = join(TMP, `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function ctxFor(home) {
  const ctx = createCtx(KIT, home);
  return ctx;
}

function noopTx() {
  const touched = [];
  return { touched, touch(f) { touched.push(f); }, external() {} };
}

function ctxWithAppData(home) {
  // Windows adapters derive paths from APPDATA — point it at the fake home.
  const prev = process.env.APPDATA;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  return { ctx: ctxFor(home), restore: () => { if (prev === undefined) delete process.env.APPDATA; else process.env.APPDATA = prev; } };
}

// --------------------------------------------------------------- jsonc
test("parseJsonc tolerates comments and trailing commas", () => {
  const doc = parseJsonc(`{
    // provider comment
    "provider": { "x": { "a": 1, } }, /* block */
    "n": 2,
  }`);
  assert.deepEqual(doc, { provider: { x: { a: 1 } }, n: 2 });
});

test("setTopLevelKey replaces a value subtree and keeps comments elsewhere", () => {
  const text = `{
  // keep me
  "provider": { "other": { "keep": true } },
  "answer": 42, // trailing comment on another key
}`;
  const updated = setTopLevelKey(text, "answer", { deep: { ok: 1 } });
  const parsed = parseJsonc(updated);
  assert.deepEqual(parsed.provider, { other: { keep: true } });
  assert.deepEqual(parsed.answer, { deep: { ok: 1 } });
  assert.match(updated, /\/\/ keep me/);
  assert.match(updated, /\/\/ trailing comment on another key/);
});

test("setTopLevelKey inserts a missing key with correct commas", () => {
  const text = `{\n  "a": 1,\n  "b": { "c": 2 }\n}`;
  const updated = setTopLevelKey(text, "zcode", { npm: "@ai-sdk/openai-compatible" });
  assert.deepEqual(parseJsonc(updated), { a: 1, b: { c: 2 }, zcode: { npm: "@ai-sdk/openai-compatible" } });
  const empty = `{\n}`;
  assert.deepEqual(parseJsonc(setTopLevelKey(empty, "k", {})), { k: {} });
});

// ------------------------------------------------------------ adapters
async function runAdapter(id, home, { setupHome } = {}) {
  setupHome?.(home);
  const mod = await import(`../cli/adapters/${id}.mjs`);
  const { ctx, restore } = ctxWithAppData(home);
  const tx = noopTx();
  const logs = [];
  const result = mod.default.apply(ctx, tx, (m) => logs.push(m));
  return { result: await result, tx, logs, ctx, restore, mod };
}

test("pi adapter merges additively and is idempotent", async () => {
  const home = fakeHome("pi");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "llama3.1:8b" }] } } }, null, 2));

  const r1 = await runAdapter("pi", home);
  assert.equal(r1.logs.join("\n").includes("alongside existing providers"), true);
  const doc = parseJsonc(readFileSync(join(agent, "models.json"), "utf8"));
  assert.ok(doc.providers.ollama, "foreign provider preserved");
  assert.equal(doc.providers.zcode.api, "anthropic-messages");
  assert.ok(doc.providers.zcode.models.some((m) => m.id === "glm-5.3-flash" && m.input.includes("image")));

  const r2 = await runAdapter("pi", home);
  assert.equal(r2.logs.join("\n").includes("already current"), true, "second run is a no-op");

  const verify = r1.mod.default.verify(r1.ctx);
  assert.equal(verify[0].ok, true);
});

test("opencode adapter writes JSONC-config and preserves comments", async () => {
  const home = fakeHome("opencode");
  const cfgDir = join(home, "AppData", "Roaming", "opencode");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, "opencode.json"), `{\n  // my theme setting\n  "theme": "dark",\n}`);

  const r1 = await runAdapter("opencode", home);
  const text = readFileSync(join(cfgDir, "opencode.json"), "utf8");
  assert.match(text, /\/\/ my theme setting/, "comments preserved");
  const doc = parseJsonc(text);
  assert.equal(doc.theme, "dark", "foreign keys preserved");
  assert.equal(doc.provider.zcode.npm, "@ai-sdk/openai-compatible");
  assert.equal(doc.provider.zcode.options.apiKey, "{env:ZCODE_PROXY_KEY}");

  const r2 = await runAdapter("opencode", home);
  assert.equal(r2.logs.join("\n").includes("already current"), true);

  const verify = r1.mod.default.verify(r1.ctx);
  assert.equal(verify[0].ok, true);
});

test("continue adapter appends managed models block, keeps existing models", async () => {
  const home = fakeHome("continue");
  const cont = join(home, ".continue");
  mkdirSync(cont, { recursive: true });
  writeFileSync(join(cont, "config.yaml"), "name: My Config\nversion: 0.0.1\nschema: v1\nmodels:\n  - name: GPT\n    provider: openai\n    model: gpt-4o\n    apiBase: https://api.openai.com/v1\n    apiKey: gpt-key\n");

  const r1 = await runAdapter("continue", home);
  const text = readFileSync(join(cont, "config.yaml"), "utf8");
  assert.match(text, /name: GPT/, "existing model kept");
  assert.match(text, /ZCode GLM-5\.3/);
  assert.match(text, /\$\{ZCODE_PROXY_KEY\}/);
  assert.match(text, /# >>> zcode-kit managed models/);

  const r2 = await runAdapter("continue", home);
  assert.equal(r2.logs.join("\n").includes("already up to date"), true);
});

test("goose adapter writes custom provider file with auth helper", async () => {
  const home = fakeHome("goose");
  const r1 = await runAdapter("goose", home);
  const file = join(home, "AppData", "Roaming", "Block", "goose", "config", "custom_providers", "zcode.json");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(doc.name, "zcode");
  assert.equal(doc.engine, "openai");
  assert.equal(doc.base_url, `http://127.0.0.1:${r1.ctx.port()}/v1/chat/completions`);
  assert.equal(doc.auth.command, "node");
  assert.ok(doc.models.some((m) => m.name === "glm-5.3-flash"));

  const r2 = await runAdapter("goose", home);
  assert.equal(r2.logs.join("\n").includes("already current"), true);
});

test("aider adapter writes env file with the key (never logged)", async () => {
  const home = fakeHome("aider");
  const r1 = await runAdapter("aider", home);
  const envText = readFileSync(join(r1.ctx.generated, "aider-zcode.env"), "utf8");
  assert.match(envText, /OPENAI_API_BASE=http:\/\/127\.0\.0\.1:\d+\/v1/);
  assert.match(envText, /OPENAI_API_KEY=/);
  assert.equal(r1.logs.join("\n").includes(r1.ctx.key()), false, "key must not appear in logs");
  // launcher scripts exist and reference the env file
  assert.ok(existsSync(join(KIT, "bin", "zcode-aider.cmd")));
  assert.match(readFileSync(join(KIT, "bin", "zcode-aider.sh"), "utf8"), /aider-zcode\.env/);
});

test("cline/kilo adapters produce manual-confirmation sheets, no VS Code state touched", async () => {
  for (const id of ["cline", "kilo-code"]) {
    const home = fakeHome(id);
    const r = await runAdapter(id, home);
    assert.equal(r.result.manualConfirmationRequired, true, `${id} is manual-confirmation-required`);
    assert.ok(existsSync(join(r.ctx.generated, `${id === "cline" ? "cline" : "kilo"}-zcode-values.md`)));
    // The kit never writes into ~/.vscode — only detection reads it.
    assert.equal(existsSync(join(home, ".vscode")), false);
  }
});

// ----------------------------------------------------------------- CLI
function runKit(args, home, { expectCode = 0 } = {}) {
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    ZCODE_KIT_SKIP_DEPS: "1",
    PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
  };
  const prevAppData = env.APPDATA;
  delete env.APPDATA; // detection must not leak the real machine's AppData
  try {
    const out = execFileSync(process.execPath, [join(KIT, "cli", "zcode-kit.mjs"), ...args], { env, encoding: "utf8" });
    assert.equal(expectCode, 0);
    return out;
  } catch (err) {
    if (expectCode !== 0) return String(err.stdout ?? "") + String(err.stderr ?? "");
    throw err;
  } finally {
    if (prevAppData !== undefined) env.APPDATA = prevAppData;
  }
}

test("CLI: unknown harness name is an error, not a silent no-op", () => {
  const home = fakeHome("unknown-harness");
  const out = runKit(["integrate", "nonsense"], home, { expectCode: 2 });
  assert.match(out, /unknown harness "nonsense"/);
  assert.match(out, /Known:/);
});

test("CLI: integrate --dry-run writes nothing", () => {
  const home = fakeHome("dryrun");
  mkdirSync(join(home, ".continue"), { recursive: true });
  const prev = process.env.APPDATA;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  try {
    const out = runKit(["integrate", "continue", "--dry-run"], home);
    assert.match(out, /DRY RUN/);
    assert.equal(existsSync(join(home, ".continue", "config.yaml")), false, "no file written in dry-run");
  } finally {
    if (prev === undefined) delete process.env.APPDATA; else process.env.APPDATA = prev;
  }
});
