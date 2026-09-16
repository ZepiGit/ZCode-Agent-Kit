import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import continueAdapter from "../cli/adapters/continue.mjs";
import { createCtx } from "../cli/context.mjs";

const require = createRequire(new URL("../zcode-proxy-src/package.json", import.meta.url));
const { parse } = require("yaml");
const BEGIN = "# >>> zcode-kit managed models — do not edit inside";
const END = "# <<< zcode-kit";

// No real setup, runtime files, environment overrides, or user credentials.
function fixture(t, text) {
  const root = mkdtempSync(join(tmpdir(), "zk-continue-compat-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const dir = join(home, ".continue");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "proxy"));
  const key = randomBytes(32).toString("hex");
  writeFileSync(join(root, ".proxykey"), key + "\n");
  writeFileSync(join(root, "proxy", "config.yaml"), "server:\n  port: 18457\n");
  const file = join(dir, "config.yaml");
  writeFileSync(file, text);
  const ctx = createCtx(root, home);
  const touched = [];
  const logs = [];
  return {
    ctx, key, touched, logs,
    read: () => readFileSync(file, "utf8"),
    files: () => readdirSync(dir),
    apply: () => continueAdapter.apply(ctx, { touch: (path) => touched.push(path) }, (line) => logs.push(line)),
  };
}

for (const header of ["models: []", "models: [ ] # start empty", "models: []\t# models: preserved comment", "models: # user models", "models:   "]) {
  test(`Continue accepts ${JSON.stringify(header)} without losing unrelated content`, (t) => {
    const prefix = "# user configuration\nname: Personal\nversion: 1.0.0\nschema: v1\n";
    const suffix = "\n# tools stay below models\nmcpServers:\n  - name: local\n    command: node\n    args: [server.mjs]\n";
    const f = fixture(t, prefix + header + suffix);
    assert.doesNotThrow(() => assert.equal(f.apply().changed, true), "supported models header must integrate successfully");
    const once = f.read();
    assert.ok(once.startsWith(prefix));
    assert.ok(once.endsWith(suffix), "unrelated trailing content stays byte-identical");
    if (header.includes("#")) assert.ok(once.includes(header.slice(header.indexOf("#"))), "header comment survives");
    assert.equal((once.match(/^models:/gm) ?? []).length, 1);
    const doc = parse(once);
    assert.deepEqual(doc.models.map((m) => m.model), ["glm-5.3", "glm-5.3-flash"]);
    assert.deepEqual(doc.mcpServers, [{ name: "local", command: "node", args: ["server.mjs"] }]);
    assert.ok(doc.models.every((m) => m.apiKey === f.key), "managed models carry the actual local proxy key");
    assert.ok(!f.logs.join("\n").includes(f.key), "credentials are never logged");
    assert.equal(f.apply().changed, false);
    assert.equal(f.read(), once, "second apply is byte-idempotent");
    assert.equal(f.touched.length, 1, "no second write");
  });
}

test("Continue preserves existing models below a commented header while refreshing its managed block", (t) => {
  const userModels = "\n  # user model\n  - name: User\n    provider: openai\n    model: user-model\n    roles: [chat]\n";
  const f = fixture(t, "name: Personal\nmodels: # do not remove\n" + userModels + "context: []\n");
  f.apply();
  const once = f.read();
  assert.ok(once.includes(userModels));
  f.ctx.port = () => 18458;
  assert.equal(f.apply().changed, true);
  const updated = f.read();
  assert.equal((updated.match(/# >>> zcode-kit managed models/g) ?? []).length, 1);
  assert.ok(updated.includes(userModels));
  const doc = parse(updated);
  assert.equal(doc.models.length, 3);
  assert.deepEqual(doc.models[0], { name: "User", provider: "openai", model: "user-model", roles: ["chat"] });
  assert.ok(doc.models.slice(1).every((m) => m.apiBase === "http://127.0.0.1:18458/v1"));
  assert.equal(f.apply().changed, false);
  assert.equal(f.read(), updated);
});

for (const header of ["models: [{name: User, model: user-model}]", "models: [user-model] # keep", "models: {}", "models: null", "models: *shared", "models: !custom []", "models: [] trailing", "models: []#not-a-comment"]) {
  test(`Continue refuses unsupported ${JSON.stringify(header)} without writing`, (t) => {
    const original = `name: Personal\n${header}\ncontext: []\n`;
    const f = fixture(t, original);
    assert.throws(f.apply, /cannot safely edit/);
    assert.equal(f.read(), original);
    assert.equal(f.touched.length, 0);
    assert.deepEqual(f.files(), ["config.yaml"]);
  });
}

for (const text of [
  "models:\nmodels:\n",
  "models:\nmodels: []\n",
  "models: []\nmodels: [{name: User}]\n",
  "models:\n\"models\": []\n",
  `models:\n${BEGIN}\n  - name: stale\n${END}\nmodels: []\n`,
]) {
  test(`Continue refuses duplicate models keys in ${JSON.stringify(text)} before any managed-block edit`, (t) => {
    const f = fixture(t, text);
    assert.throws(f.apply, /duplicate|cannot safely edit/);
    assert.equal(f.read(), text);
    assert.equal(f.touched.length, 0);
  });
}

test("Continue appends a single models section after inert commented and nested keys", (t) => {
  const original = "# models: []\nname: Personal\ncustom:\n  models: [keep]\n";
  const f = fixture(t, original);
  f.apply();
  assert.ok(f.read().startsWith(original));
  const doc = parse(f.read());
  assert.deepEqual(doc.custom.models, ["keep"]);
  assert.equal(doc.models.length, 2);
  assert.equal(f.apply().changed, false);
});

test("Continue empty flow models respects dry-run with zero file mutation", (t) => {
  const original = "models: [] # empty\n";
  const f = fixture(t, original);
  f.ctx.dryRun = true;
  assert.equal(f.apply().changed, false);
  assert.equal(f.read(), original);
  assert.equal(f.touched.length, 0);
  assert.deepEqual(f.files(), ["config.yaml"]);
});

test("Continue accepts CRLF empty flow headers without moving the header comment", (t) => {
  const prefix = "name: Personal\r\n";
  const suffix = "\r\ncontext: []\r\n";
  const f = fixture(t, prefix + "models: [] # keep here" + suffix);
  f.apply();
  const once = f.read();
  assert.ok(once.startsWith(prefix + "models:  # keep here\r\n"));
  assert.ok(once.endsWith(suffix));
  assert.equal(parse(once).models.length, 2);
  assert.equal(f.apply().changed, false);
  assert.equal(f.read(), once);
});

for (const indent of ["", " ", "  ", "    "]) {
  test(`Continue appends after user models with ${indent.length}-space sequence indentation`, (t) => {
    const prefix = `name: Personal\nmodels: # keep user default\n${indent}- name: User\n${indent}  model: user-model\n${indent}  prompt: |\n${indent}    Preserve this block\n${indent}    # not a YAML comment\n${indent}  roles: [chat]\n${indent}# between models\n${indent}- name: Second\n${indent}  model: second-model\n`;
    const suffix = "# sibling comment\ncontext:\n  - provider: code\nmcpServers: []\n";
    const original = prefix + suffix;
    const before = parse(original);
    const f = fixture(t, original);
    f.apply();
    const once = f.read();
    const doc = parse(once);
    assert.deepEqual(doc.models.slice(0, 2), before.models, "user order/default and block scalar stay intact");
    assert.deepEqual(doc.models.slice(2).map((m) => m.model), ["glm-5.3", "glm-5.3-flash"]);
    assert.deepEqual(doc.context, before.context);
    assert.ok(once.startsWith(prefix), "user sequence stays byte-identical");
    assert.ok(once.endsWith(suffix), "sibling keys/comments stay byte-identical");
    assert.equal(f.apply().changed, false);
    assert.equal(f.read(), once);
    f.ctx.port = () => 18459;
    f.apply();
    assert.deepEqual(parse(f.read()).models.slice(0, 2), before.models);
  });
}

test("Continue moves an older prepended managed block behind the user's default model", (t) => {
  const user = "  - name: User\n    model: user-model\n";
  const suffix = "# sibling comment\ncontext: []\n";
  const original = `models:\n${BEGIN}\n  - name: stale kit\n${END}\n${user}${suffix}`;
  const f = fixture(t, original);
  f.apply();
  const once = f.read();
  assert.equal(parse(once).models[0].model, "user-model");
  assert.ok(once.startsWith("models:\n" + user));
  assert.ok(once.endsWith(suffix));
  assert.equal(f.apply().changed, false);
  assert.equal(f.read(), once);
});

for (const body of ["  unexpected: mapping\n", "  [user-model]\n"]) {
  test(`Continue refuses unsupported block structure ${JSON.stringify(body)} without writing`, (t) => {
    const original = "models:\n" + body + "context: []\n";
    const f = fixture(t, original);
    assert.throws(f.apply, /cannot safely edit/);
    assert.equal(f.read(), original);
    assert.equal(f.touched.length, 0);
  });
}

test("Continue detects and repairs rotated literal proxy keys without logging either key", (t) => {
  const f = fixture(t, "models: []\n");
  f.apply();
  assert.ok(continueAdapter.verify(f.ctx).every((check) => check.ok === true));
  const rotated = randomBytes(32).toString("hex") + ': # "quoted" \\ value';
  writeFileSync(f.ctx.keyFile, rotated + "\n");
  const stale = continueAdapter.verify(f.ctx);
  assert.ok(stale.some((check) => check.ok === false), "verification flags stale managed credentials");
  assert.ok(!JSON.stringify(stale).includes(f.key) && !JSON.stringify(stale).includes(rotated));
  assert.equal(f.apply().changed, true);
  assert.ok(parse(f.read()).models.every((model) => model.apiKey === rotated), "quoted YAML round-trips the key");
  assert.ok(continueAdapter.verify(f.ctx).every((check) => check.ok === true));
  assert.equal(f.apply().changed, false);
  assert.ok(!f.logs.join("\n").includes(f.key) && !f.logs.join("\n").includes(rotated));
});

test("Continue refuses an unterminated managed block without writing", (t) => {
  const original = `models:\n${BEGIN}\n  - name: stale\n`;
  const f = fixture(t, original);
  assert.throws(f.apply, /begin without end marker/);
  assert.equal(f.read(), original);
  assert.equal(f.touched.length, 0);
});
