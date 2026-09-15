// zcode-kit CLI tests: JSONC editor, new adapters against fake homes,
// dry-run semantics, idempotency, unknown-harness errors (audit §12.A lite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execFile } from "node:child_process";
import { parseJsonc, setTopLevelKey } from "../lib/jsonc.mjs";
import { createCtx, ensureRuntimeFiles } from "../cli/context.mjs";

const KIT = join(import.meta.dirname, "..");
const TMP = join(import.meta.dirname, "fakehome", "kit");

// A fresh checkout (CI) has no .proxykey / proxy/config.yaml (git-excluded by
// design). Adapter unit tests read them via ctx.port()/ctx.key() — create them
// race-safely; on a normal machine they already exist and this is a no-op.
ensureRuntimeFiles(createCtx(KIT));

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

// AUD-002 regression: an existing top-level key must be REPLACED (exactly
// one occurrence, byte-idempotent on re-run) — the old scanner was
// unreachable for the first quote of every key and always re-inserted.
test("setTopLevelKey replaces an existing key and is byte-idempotent", () => {
  const input = `{
  // user comment
  "provider": {
    "user-provider": { "name": "keep me" }
  }
}
`;
  const wanted = {
    "user-provider": { name: "keep me" },
    zcode: {
      name: "ZCode (local proxy)",
      options: { baseURL: "http://127.0.0.1:8457/v1", apiKey: "{env:ZCODE_PROXY_KEY}" },
    },
  };
  const once = setTopLevelKey(input, "provider", wanted);
  const twice = setTopLevelKey(once, "provider", wanted);
  assert.equal((twice.match(/"provider"\s*:/g) ?? []).length, 1, "never creates duplicate top-level keys");
  assert.equal(twice, once, "second application is byte-identical");
  const doc = parseJsonc(twice);
  assert.equal(doc.provider["user-provider"].name, "keep me", "sibling entries survive");
  assert.equal(doc.provider.zcode.name, "ZCode (local proxy)");
  assert.match(twice, /\/\/ user comment/, "comments outside the replaced subtree survive");
});

// AUD-003 regression: a foreign provider.zcode (no kit signature) must be a
// hard conflict — refused byte-identically, never overwritten.
test("opencode adapter refuses a foreign provider.zcode byte-identically", async () => {
  const home = fakeHome("opencode-foreign");
  const prevAppData = process.env.APPDATA;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  try {
    const { configPath } = await import("../cli/adapters/opencode.mjs");
    const cfgFile = configPath(home);
    mkdirSync(dirname(cfgFile), { recursive: true });
    const original = `{
  // belongs to the user
  "provider": {
    "zcode": {
      "name": "Corporate gateway",
      "options": {
        "baseURL": "https://corp.example/v1",
        "apiKey": "{env:CORP_KEY}"
      }
    }
  }
}
`;
    writeFileSync(cfgFile, original);
    await assert.rejects(() => runAdapter("opencode", home), /does not own|not match the kit signature/i);
    assert.equal(readFileSync(cfgFile, "utf8"), original, "nothing written on conflict");
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  }
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

// ZAK-004: a hand-written zcode entry (no ownership marker) must be a hard
// conflict, never silently overwritten.
test("pi adapter refuses to overwrite a foreign zcode entry", async () => {
  const home = fakeHome("pi-foreign");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  const foreign = JSON.stringify({ providers: { zcode: { baseUrl: "http://127.0.0.1:9999", api: "openai-completions", apiKey: "my-own-key", models: [{ id: "my-model" }] } } }, null, 2);
  writeFileSync(join(agent, "models.json"), foreign);

  await assert.rejects(
    () => runAdapter("pi", home),
    /does not own/,
    "foreign entry is a conflict",
  );
  assert.equal(readFileSync(join(agent, "models.json"), "utf8"), foreign, "nothing written on conflict");
});

// Legacy kit entries (pre-marker, resolvable by their resolver shape) are
// taken over instead of treated as foreign.
test("pi adapter takes over legacy kit zcode entry", async () => {
  const home = fakeHome("pi-legacy");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  const legacyRoot = "C:/somewhere/old-kit";
  writeFileSync(join(agent, "models.json"), JSON.stringify({
    providers: {
      zcode: {
        baseUrl: "http://127.0.0.1:8457",
        api: "anthropic-messages",
        apiKey: `!node "${legacyRoot}/proxy/resolve-zcode-proxy-key.mjs"`,
        models: [{ id: "glm-5.3", name: "GLM-5.3" }],
      },
    },
  }, null, 2));

  const r = await runAdapter("pi", home);
  const doc = parseJsonc(readFileSync(join(agent, "models.json"), "utf8"));
  assert.equal(doc.providers.zcode["x-zcode-agent-kit"]?.managed, true, "ownership marker written");
  assert.ok(!JSON.stringify(doc).includes(legacyRoot), "old root path replaced");
  assert.match(r.logs.join("\n"), /kit-owned/);
});

// ZAK-008: --dry-run must be a zero-mutation guarantee — the codex adapter
// used to create generated/codex-home before reaching the commitFile guard.
test("codex dry-run creates no directories", async () => {
  const home = fakeHome("codex-dryrun");
  const { ctx, restore } = ctxWithAppData(home);
  // redirect the kit root so generated/ is observed inside the fake home,
  // not in the real checkout's already-existing generated/
  ctx.root = join(home, "kitroot");
  ctx.generated = join(ctx.root, "generated");
  ctx.dryRun = true;
  const mod = await import("../cli/adapters/codex.mjs");
  const logs = [];
  const result = await mod.default.apply(ctx, noopTx(), (m) => logs.push(m));
  restore();
  assert.equal(result.changed, false);
  assert.equal(existsSync(ctx.generated), false, "generated/ not created in dry-run");
  assert.equal(existsSync(join(ctx.generated, "codex-home")), false, "codex-home not created in dry-run");
  assert.ok(!logs.join("\n").includes("wrote "), "no write is announced as done");
});

test("opencode adapter writes JSONC-config and preserves comments", async () => {
  const home = fakeHome("opencode");
  // Resolve the adapter's platform path INSIDE the APPDATA override, exactly
  // like the adapter will see it — otherwise the fixture would land in the
  // real %APPDATA% (Windows) while the adapter writes into the fake home.
  const prevAppData = process.env.APPDATA;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  try {
    const { configPath } = await import("../cli/adapters/opencode.mjs");
    const cfgFile = configPath(home);
    mkdirSync(dirname(cfgFile), { recursive: true });
    writeFileSync(cfgFile, `{\n  // my theme setting\n  "theme": "dark",\n}`);

    const r1 = await runAdapter("opencode", home);
    const text = readFileSync(cfgFile, "utf8");
    assert.match(text, /\/\/ my theme setting/, "comments preserved");
    const doc = parseJsonc(text);
    assert.equal(doc.theme, "dark", "foreign keys preserved");
    assert.equal(doc.provider.zcode.npm, "@ai-sdk/openai-compatible");
    assert.equal(doc.provider.zcode.options.apiKey, "{env:ZCODE_PROXY_KEY}");

    const r2 = await runAdapter("opencode", home);
    assert.equal(r2.logs.join("\n").includes("already current"), true);

    const verify = r1.mod.default.verify(r1.ctx);
    assert.equal(verify[0].ok, true);
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  }
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
  // Resolve the adapter's platform path under the same APPDATA override the
  // adapter used (real %APPDATA% must never be touched by tests).
  const prevAppData = process.env.APPDATA;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  let file;
  try {
    const { providerDir } = await import("../cli/adapters/goose.mjs");
    file = join(providerDir(home), "zcode.json");
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  }
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

// ------------------------------------------- audit test backlog: dry-run matrix
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";

/** Recursive path → kind/content-hash snapshot of a directory tree. */
function snapshotTree(root) {
  const out = {};
  if (!existsSync(root)) return out;
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) { out[r] = "dir"; walk(full, r); }
      else if (e.isSymbolicLink()) out[r] = "symlink";
      else out[r] = "file:" + createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(root, "");
  return out;
}

/** Minimal detection fixture per adapter so its apply() reaches ALL its
 * write paths (structural skips would make the proof vacuous). */
function seedDryRunFixture(id, home) {
  switch (id) {
    case "omp":
      mkdirSync(join(home, ".omp", "agent"), { recursive: true });
      writeFileSync(join(home, ".omp", "agent", "models.yml"), "providers:\n  openai:\n    name: OpenAI\n");
      break;
    case "pi":
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {} }, null, 2));
      break;
    case "continue":
      mkdirSync(join(home, ".continue"), { recursive: true });
      writeFileSync(
        join(home, ".continue", "config.yaml"),
        "name: t\nversion: 0.0.1\nschema: v1\nmodels:\n  - name: GPT\n    provider: openai\n    model: gpt-4o\n    apiBase: https://api.openai.com/v1\n    apiKey: k\n",
      );
      break;
    case "opencode":
      mkdirSync(join(home, "AppData", "Roaming", "opencode"), { recursive: true });
      writeFileSync(join(home, "AppData", "Roaming", "opencode", "opencode.json"), '{\n  // mine\n  "theme": "dark"\n}');
      break;
    // codex/claude-code/cline/kilo-code/aider write under ctx.generated —
    // nothing in the home to seed; goose/opencode need APPDATA only.
  }
}

const DRY_RUN_MATRIX = ["omp", "pi", "claude-code", "codex", "opencode", "cline", "kilo-code", "aider", "continue", "goose"];

test("dry-run matrix: no adapter mutates the fake home (zero-mutation proof)", async () => {
  for (const id of DRY_RUN_MATRIX) {
    // control: same fixture, real run — proves the adapter reaches its write
    // paths (a dry-run proof over paths that never write would be vacuous)
    const controlHome = fakeHome(`matrix-${id}-control`);
    seedDryRunFixture(id, controlHome);
    const control = ctxWithAppData(controlHome);
    control.ctx.root = join(controlHome, "kitroot");
    control.ctx.generated = join(control.ctx.root, "generated");
    if (id === "omp") control.ctx.root = KIT;
    const mod = await import(`../cli/adapters/${id}.mjs`);
    const controlBefore = snapshotTree(controlHome);
    await mod.default.apply(control.ctx, noopTx(), () => {});
    const controlAfter = snapshotTree(controlHome);
    control.restore();
    assert.notDeepEqual(controlAfter, controlBefore, `${id}: control run must actually write (fixture must reach write paths)`);

    // the actual proof: identical fixture, dry-run — zero mutation
    const home = fakeHome(`matrix-${id}`);
    seedDryRunFixture(id, home);
    const { ctx, restore } = ctxWithAppData(home);
    ctx.root = join(home, "kitroot");
    ctx.generated = join(ctx.root, "generated");
    if (id === "omp") ctx.root = KIT;
    ctx.dryRun = true;
    const before = snapshotTree(home);
    await mod.default.apply(ctx, noopTx(), () => {});
    const after = snapshotTree(home);
    restore();
    assert.deepEqual(after, before, `${id}: dry-run must not mutate anything`);
  }
});

test("dry-run leaves preexisting staging sentinels untouched", async () => {
  const home = fakeHome("staging-sentinel");
  const agent = join(home, ".omp", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "models.yml"), "providers:\n  openai:\n    name: OpenAI\n");
  const sentinel = join(agent, "models.yml.zcode-staging");
  writeFileSync(sentinel, "sentinel");
  const { ctx, restore } = ctxWithAppData(home);
  ctx.dryRun = true;
  const mod = await import("../cli/adapters/omp.mjs");
  await mod.default.apply(ctx, noopTx(), () => {});
  restore();
  assert.equal(readFileSync(sentinel, "utf8"), "sentinel", "sentinel untouched");
  assert.ok(!readdirSync(agent).some((f) => f.includes(".zcode-staging") && f !== "models.yml.zcode-staging"), "no new staging files");
});

// AUD-010: an inline `models:` value cannot be block-edited — the adapter
// must refuse instead of appending a duplicate top-level key.
test("continue adapter fails closed on inline models value, appends after commented header", async () => {
  const home = fakeHome("continue-inline");
  const cont = join(home, ".continue");
  mkdirSync(cont, { recursive: true });
  const original = "name: t\nversion: 0.0.1\nschema: v1\nmodels: []\n";
  writeFileSync(join(cont, "config.yaml"), original);
  await assert.rejects(() => runAdapter("continue", home), /cannot safely edit/);
  assert.equal(readFileSync(join(cont, "config.yaml"), "utf8"), original, "nothing written on refusal");

  // a commented-out header is inert — appending a fresh models: is correct
  const home2 = fakeHome("continue-commented");
  mkdirSync(join(home2, ".continue"), { recursive: true });
  writeFileSync(join(home2, ".continue", "config.yaml"), "# models: disabled earlier\nname: t\n");
  const r = await runAdapter("continue", home2);
  const text = readFileSync(join(home2, ".continue", "config.yaml"), "utf8");
  assert.equal((text.match(/^models:/gm) ?? []).length, 1, "exactly one top-level models key");
  assert.match(text, /# models: disabled earlier/, "comment preserved");
  assert.match(r.logs.join("\n"), /kit models appended/);
});

// AUD test backlog: opencode adapter-level byte idempotence with a commented,
// kit-owned existing config (the jsonc replace path end-to-end).
test("opencode adapter is byte-idempotent on a commented config", async () => {
  const home = fakeHome("opencode-idem");
  const prevAppData = process.env.APPDATA;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  try {
    const { configPath } = await import("../cli/adapters/opencode.mjs");
    const cfgFile = configPath(home);
    mkdirSync(dirname(cfgFile), { recursive: true });
    writeFileSync(cfgFile, `{\n  // my theme setting\n  "theme": "dark"\n}`);
    const r1 = await runAdapter("opencode", home);
    const once = readFileSync(cfgFile, "utf8");
    assert.equal((once.match(/"provider"/g) ?? []).length, 1, "exactly one provider key");
    const r2 = await runAdapter("opencode", home);
    assert.equal(readFileSync(cfgFile, "utf8"), once, "second run is byte-identical");
    assert.match(r2.logs.join("\n"), /already current/);
    assert.match(once, /\/\/ my theme setting/, "comments preserved");
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  }
});

// Audit backlog: no kit-shipped config may enable automatic trial claiming —
// the claim block in BOTH example configs must be fail-closed false, and no
// kit launcher may set the enabling env var for its child processes.
test("shipped proxy configs keep claim disabled (no auto-trial-claiming)", async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(join(KIT, "zcode-proxy-src", "package.json"));
  const yaml = req("yaml");
  for (const f of ["proxy/config.example.yaml", "zcode-proxy-src/config.example.yaml"]) {
    const doc = yaml.parse(readFileSync(join(KIT, f), "utf8"));
    const claim = doc?.claim ?? {};
    assert.equal(claim.enabled, false, `${f}: claim.enabled must be false`);
    assert.equal(claim.auto, false, `${f}: claim.auto must be false`);
  }
  for (const f of readdirSync(join(KIT, "bin"))) {
    const text = readFileSync(join(KIT, "bin", f), "utf8");
    assert.doesNotMatch(text, /ZCODE_CLAIM_ENABLED\s*=\s*true/, `${f} must not enable claiming`);
    assert.doesNotMatch(text, /ZCODE_CLAIM_AUTO\s*=\s*true/, `${f} must not enable auto-claiming`);
  }
});

// ------------------------------------------------------- proxy-reporting CLI
// cmdModels/cmdAuth contract tests: spawn the real CLI against a mock proxy so
// the reported source/auth state is proven, not assumed. A minimal kit copy
// keeps ctx.port()/ctx.key() pointed at the mock without touching the real one.
import { cpSync } from "node:fs";
import { createServer } from "node:http";

function makeMiniKit() {
  const root = mkdtempSync(join(tmpdir(), "zk-mini-"));
  mkdirSync(join(root, "proxy"), { recursive: true });
  mkdirSync(join(root, "zcode-proxy-src", "src", "provider"), { recursive: true });
  cpSync(join(KIT, "cli"), join(root, "cli"), { recursive: true });
  cpSync(join(KIT, "lib"), join(root, "lib"), { recursive: true });
  writeFileSync(join(root, ".proxykey"), "kit-test-proxy-key\n");
  writeFileSync(join(root, "proxy", "config.yaml"), "provider: zai\nserver:\n  port: 1\n");
  writeFileSync(
    join(root, "zcode-proxy-src", "src", "provider", "models.ts"),
    'export const MODELS = [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }];\n',
  );
  return root;
}

// execFile (NOT execFileSync): the mock proxy lives in THIS process — a sync
// spawn would block the event loop and starve the mock of responses.
function miniSpawn(root, args, extraEnv) {
  return new Promise((resolveRej, rejectRej) => {
    execFile(process.execPath, [join(root, "cli", "zcode-kit.mjs"), ...args], { encoding: "utf8", timeout: 30000, env: { ...process.env, ...(extraEnv ?? {}) } }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        rejectRej(err);
      } else resolveRej(stdout);
    });
  });
}

function withMockProxy(root, handler, run) {
  const server = createServer(handler);
  return new Promise((resolveRun, rejectRun) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      writeFileSync(join(root, "proxy", "config.yaml"), `provider: zai\nserver:\n  port: ${port}\n`);
      Promise.resolve()
        .then(run)
        .then(resolveRun, rejectRun)
        .finally(() => server.close());
    });
    server.on("error", rejectRun);
  });
}

test("models --json reports source proxy only when the proxy actually answers", async () => {
  const root = makeMiniKit();
  try {
    await withMockProxy(
      root,
      (req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "mock-model-a" }, { id: "mock-model-b" }] }));
      },
      async () => {
        const out = JSON.parse(await miniSpawn(root, ["models", "--json"]));
        assert.equal(out.source, "proxy");
        assert.deepEqual(out.models, ["mock-model-a", "mock-model-b"]);
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("models --json admits the registry fallback when the proxy is down (no fake 'source: proxy')", async () => {
  const root = makeMiniKit();
  try {
    const server = createServer(() => {});
    const freePort = await new Promise((res) => {
      server.listen(0, "127.0.0.1", () => res(server.address().port));
    });
    server.close();
    writeFileSync(join(root, "proxy", "config.yaml"), `provider: zai\nserver:\n  port: ${freePort}\n`);
    const out = JSON.parse(await miniSpawn(root, ["models", "--json"]));
    assert.equal(out.source, "registry", "registry fallback must not be labeled as 'proxy'");
    assert.ok(out.models.includes("glm-5.3"), "fallback list comes from the MODELS registry");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auth status must not claim logged_in on a proxy auth error (401)", async () => {
  const root = makeMiniKit();
  try {
    await withMockProxy(
      root,
      (req, res) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "authentication_error", message: "Invalid or missing proxy API key" } }));
      },
      async () => {
        const out = JSON.parse(await miniSpawn(root, ["auth", "status"]));
        assert.equal(out.logged_in, false, "401 from the proxy must mean logged_in:false");
        assert.ok(Array.isArray(out.errors) && out.errors.length > 0, "the error must be reported");
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auth status reports logged_in false when z.ai answers with code 3012", async () => {
  const root = makeMiniKit();
  try {
    await withMockProxy(
      root,
      (req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 3012, errors: ["not logged in upstream"] }));
      },
      async () => {
        const out = JSON.parse(await miniSpawn(root, ["auth", "status"]));
        assert.equal(out.logged_in, false);
        assert.ok(out.errors.includes("not logged in upstream"));
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auth status reports logged_in true only on a real quota snapshot", async () => {
  const root = makeMiniKit();
  try {
    await withMockProxy(
      root,
      (req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ provider: "zai", balances: [{ plan: "glm-coding-plan", used: 1 }], serverTime: 1 }));
      },
      async () => {
        const out = JSON.parse(await miniSpawn(root, ["auth", "status"]));
        assert.equal(out.logged_in, true);
        assert.deepEqual(out.errors, []);
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// BUG: doctor --harness <id> printed the manager's FAIL lines but its text
// summary ("0 failed — OK") and exit code only counted the adapter checks.
test("doctor --harness text summary counts manager FAIL lines (no false OK, exit 1)", async () => {
  const root = makeMiniKit();
  try {
    // makeMiniKit ships no manager: install a deterministic stub whose doctor
    // output contains a FAIL line the text summary must count (and it must
    // flip the exit code to 1 even when --harness filters the adapter checks).
    writeFileSync(
      join(root, "proxy", "zcode-proxy-manager.mjs"),
      'console.log("FAIL  credentials store — no credentials present");\nconsole.log("PASS  config exists — ok");\n',
    );
    let captured;
    try {
      const out = await miniSpawn(root, ["doctor", "--harness", "omp"]);
      captured = { code: 0, stdout: out, stderr: "" };
    } catch (e) {
      captured = { code: e.code ?? 1, stderr: e.stderr ?? "", stdout: e.stdout ?? "" };
    }
    const text = `${captured.stdout}\n${captured.stderr}`;
    assert.doesNotMatch(text, /0 failed — OK/, "summary must not say OK while FAIL lines are printed");
    assert.match(text, /check\(s\) failed/, "summary must report the failing checks");
    assert.equal(captured.code, 1, "doctor must exit 1 when checks failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Self-heal chain: verify() must detect when the managed block's !node key
// resolver points at ANOTHER kit copy (copy switches leave a stale resolver
// whose key the running proxy rejects with 401); integrate/setup repairs it
// automatically by rebuilding the block from this copy.
test("omp adapter self-check: detects resolver drift to another copy, integrate repairs it", async () => {
  const omp = (await import("../cli/adapters/omp.mjs")).default;
  const home = fakeHome("omp-drift");
  const agentDir = join(home, ".omp", "agent");
  mkdirSync(agentDir, { recursive: true });
  // the "foreign copy" resolver must EXIST so the drift check (not the
  // missing-file check) fires — build it in the temp dir
  const foreignCopy = mkdtempSync(join(tmpdir(), "zk-foreign-copy-"));
  const foreignResolver = `${foreignCopy.replace(/\\/g, "/")}/proxy/resolve-zcode-proxy-key.mjs`;
  mkdirSync(join(foreignCopy, "proxy"), { recursive: true });
  writeFileSync(foreignResolver, "");
  writeFileSync(
    join(agentDir, "models.yml"),
    `providers:\n# >>> zcode-kit (managed block) — do not edit inside\n  zcode:\n    name: ZCode\n    apiKey: !node '${foreignResolver}'\n# <<< zcode-kit\n`,
  );
  const { ctx } = ctxWithAppData(home);
  try {
    const before = omp.verify(ctx).find((c) => c.name === "omp key resolver");
    assert.equal(before?.ok, false, "verify must flag a resolver pointing at another copy");
    assert.match(String(before?.detail ?? ""), /another copy/);
    const res = omp.apply(ctx, noopTx(), () => {});
    assert.equal(res.changed, true, "integrate must repair the drifted block");
    const after = omp.verify(ctx).find((c) => c.name === "omp key resolver");
    assert.equal(after?.ok, true, "verify passes after the automatic repair");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(foreignCopy, { recursive: true, force: true });
  }
});
// BUG: integrate continue crashed with a raw ENOENT when ~/.continue/config.yaml
// does not exist, instead of skipping like the omp adapter does.
test("integrate continue skips cleanly when ~/.continue/config.yaml is absent", async () => {
  const root = makeMiniKit();
  try {
    const home = mkdtempSync(join(tmpdir(), "zk-continue-missing-"));
    const { code, text } = await new Promise((resolveP) => {
      execFile(
        process.execPath,
        [join(root, "cli", "zcode-kit.mjs"), "integrate", "continue", "--scope", "user"],
        {
          encoding: "utf8",
          timeout: 60000,
          env: {
            ...process.env,
            USERPROFILE: home,
            HOME: home,
            APPDATA: join(home, "AppData", "Roaming"),
            LOCALAPPDATA: join(home, "AppData", "Local"),
            ZCODE_KIT_ALLOW_CHECKOUT: "1",
            ZCODE_KIT_SKIP_DEPS: "1",
          },
        },
        (err, stdout, stderr) => resolveP({ code: err ? (err.code ?? -1) : 0, text: `${stdout}\n${stderr}` }),
      );
    });
    assert.match(text, /skipped \(no .*\.continue[\\/]config\.yaml\)/, "absent config must be a clean skip, not a crash");
    assert.doesNotMatch(text, /ENOENT/, "raw ENOENT must not leak to the user");
    assert.equal(code, 0, "a clean skip must exit 0, not 2 (runtime error)");
    rmSync(home, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
