// setup.mjs integration regressions against a fake home (audit §12.A lite):
// run 1 applies, run 2 is a no-op, rollback undoes run 1 exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { yamlSingleQuoted } from "../cli/adapters/omp.mjs";
import { createCtx, ensureRuntimeFiles } from "../cli/context.mjs";

const KIT = join(import.meta.dirname, "..");
const TMP = join(import.meta.dirname, "fakehome", "setup");

// Fresh checkout (CI): setup's bootstrap needs the runtime files; create them
// race-safely if absent (no-op on a normal machine).
ensureRuntimeFiles(createCtx(KIT));

function sha(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fakeHome() {
  const home = join(TMP, `home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const agent = join(home, ".omp", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(
    join(agent, "models.yml"),
    [
      "# user models",
      "providers:",
      "  openai:",
      "    name: OpenAI",
      "    models:",
      "      - id: gpt-test",
    ].join("\n") + "\n",
  );
  writeFileSync(
    join(agent, "config.yml"),
    [
      "disabledProviders:",
      "  - zcode",
      "  - zai",
      "allowTools:",
      "  - zcode",
      "  - bash",
    ].join("\n") + "\n",
  );
  return { home, agent, modelsYml: join(agent, "models.yml"), configYml: join(agent, "config.yml") };
}

function runSetup(home, args = []) {
  return execFileSync(process.execPath, [join(KIT, "setup.mjs"), ...args], {
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      ZCODE_KIT_SKIP_DEPS: "1",
      // Test isolation: hide the machine's real claude/codex/bun from PATH so
      // detection only sees the fake home (node.exe is spawned by absolute path).
      PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
    },
    encoding: "utf8",
  });
}

test("setup applies, is idempotent, and rolls back exactly", () => {
  const { home, modelsYml, configYml } = fakeHome();
  const originalModels = readFileSync(modelsYml, "utf8");
  const originalConfig = readFileSync(configYml, "utf8");

  // ---- run 1: apply
  const out1 = runSetup(home);
  assert.match(out1, /models\.yml updated/);
  assert.match(out1, /transaction (\S+) recorded/);
  assert.match(out1, /detected harnesses: omp/);

  const models1 = readFileSync(modelsYml, "utf8");
  const config1 = readFileSync(configYml, "utf8");
  assert.match(models1, /# >>> zcode-kit \(managed block\)/);
  assert.match(models1, /glm-5\.3-flash/);
  assert.match(models1, /openai:/, "existing provider preserved");
  // scoped removal: unrelated list intact, disabledProviders cleaned
  assert.match(config1, /allowTools:\n  - zcode\n  - bash/);
  assert.doesNotMatch(config1, /disabledProviders:\n  - zcode/);
  assert.match(config1, /disabledProviders:\n  - zai/);
  assert.match(config1, /extensions:\n  - .+zcode-proxy-autostart\.ts/);
  const extFile = join(home, ".omp", "agent", "extensions", "zcode-proxy-autostart.ts");
  assert.ok(existsSync(extFile), "extension installed");
  assert.ok(existsSync(join(home, ".omp", "agent", "mcp.json")), "mcp.json created");
  const apiKeyLine = models1.split("\n").find((l) => l.includes("apiKey:"));
  assert.match(apiKeyLine, /apiKey: !node '/, "apiKey uses a quoted !node resolver");
  const txId = out1.match(/transaction (\S+) recorded/)[1];

  // ---- run 2: idempotent (no file changes, no new transaction)
  const h1 = [sha(modelsYml), sha(configYml), sha(extFile)];
  const out2 = runSetup(home);
  assert.match(out2, /already up to date/);
  assert.match(out2, /extension already current/);
  assert.doesNotMatch(out2, /transaction \S+ recorded/, "no-op run records no transaction");
  const h2 = [sha(modelsYml), sha(configYml), sha(extFile)];
  assert.deepEqual(h2, h1, "second run changes nothing");

  // ---- rollback of run 1
  const outR = runSetup(home, ["--rollback", txId]);
  assert.match(outR, /restored:/);
  assert.match(outR, /removed \(kit-created\):/);
  assert.equal(readFileSync(modelsYml, "utf8"), originalModels, "models.yml byte-identical to pre-setup");
  assert.equal(readFileSync(configYml, "utf8"), originalConfig, "config.yml byte-identical to pre-setup");
  assert.equal(existsSync(extFile), false, "kit-created extension removed");
  assert.equal(existsSync(join(home, ".omp", "agent", "mcp.json")), false, "kit-created mcp.json removed");
});

test("yamlSingleQuoted escapes apostrophes (paths with quotes cannot break YAML)", () => {
  assert.equal(yamlSingleQuoted("C:/Users/o'brien/kit/x.mjs"), "'C:/Users/o''brien/kit/x.mjs'");
  assert.equal(yamlSingleQuoted("C:/plain/path.mjs"), "'C:/plain/path.mjs'");
});
