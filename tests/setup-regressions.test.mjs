// setup.mjs integration regressions against a fake home:
// run 1 applies, run 2 is a no-op, rollback undoes run 1 exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createCtx, ensureRuntimeFiles } from "../cli/context.mjs";
import { freePort } from "./free-port.mjs";

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

/**
 * The kit state for one fake home (ticket 75): created first with this
 * checkout's .owner.json, so nothing of the checkout's own state is used, and
 * a proxy config on a free port of this run, so setup's probe can never meet
 * a listener of a parallel run or the owner's proxy on 8457.
 */
async function stateFor(home) {
  const state = `${home}-state`;
  if (existsSync(state)) return state;
  mkdirSync(join(state, "proxy"), { recursive: true });
  let identity = realpathSync(KIT);
  if (process.platform === "win32") identity = identity.toLowerCase();
  writeFileSync(join(state, ".owner.json"), JSON.stringify({ root: identity }) + "\n");
  writeFileSync(join(state, ".proxykey"), "synthetic-setup-regressions-key\n");
  writeFileSync(join(state, "proxy", "config.yaml"), readFileSync(join(KIT, "proxy", "config.example.yaml"), "utf8")
    .replace(/^  port: \d+/m, `  port: ${await freePort()}`).replace('proxyApiKey: "GENERATE_ME"', 'proxyApiKey: "synthetic-setup-regressions-key"'));
  return state;
}

async function runSetup(home, args = []) {
  // Ticket 43 made the compact report the default; this suite verifies the
  // full adapter pipeline (file contents, transactions), so it runs verbose,
  // where every line the command prints is on the screen. The compact report
  // and install.log have their own test below. (args stay first: the shim
  // reads its MODE from argv[0] — "--rollback" etc.)
  return execFileSync(process.execPath, [join(KIT, "setup.mjs"), ...args, "--verbose"], {
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      ZCODE_KIT_STATE_DIR: await stateFor(home),
      ZCODE_KIT_SKIP_DEPS: "1",
      // The suite runs the kit from a source checkout (KIT has .git); tests
      // intentionally write to the disposable fake home, so opt in.
      ZCODE_KIT_ALLOW_CHECKOUT: "1",
      // No terminal here: consent for the fake OMP is given explicitly, the
      // way unattended installs do (a missing TTY never counts as consent).
      ZCODE_KIT_HARNESSES: "omp",
      // Test isolation: hide the machine's real claude/codex/bun from PATH so
      // detection only sees the fake home (node.exe is spawned by absolute path).
      PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
    },
    encoding: "utf8",
  });
}

test("setup applies, is idempotent, and rolls back exactly", async () => {
  const { home, modelsYml, configYml } = fakeHome();
  const originalModels = readFileSync(modelsYml, "utf8");
  const originalConfig = readFileSync(configYml, "utf8");

  // ---- run 1: apply
  const out1 = await runSetup(home);
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
  assert.match(apiKeyLine, /apiKey: "[A-Za-z0-9_-]+"/, "apiKey is a literal key (omp 18+ ignores !node)");
  const txId = out1.match(/transaction (\S+) recorded/)[1];

  // ---- run 2: idempotent (no file changes, no new transaction)
  const h1 = [sha(modelsYml), sha(configYml), sha(extFile)];
  const out2 = await runSetup(home);
  assert.match(out2, /already up to date/);
  assert.match(out2, /extension already current/);
  assert.doesNotMatch(out2, /transaction \S+ recorded/, "no-op run records no transaction");
  const h2 = [sha(modelsYml), sha(configYml), sha(extFile)];
  assert.deepEqual(h2, h1, "second run changes nothing");

  // ---- rollback of run 1
  const outR = await runSetup(home, ["--rollback", txId]);
  assert.match(outR, /restored:/);
  assert.match(outR, /removed \(kit-created\):/);
  assert.equal(readFileSync(modelsYml, "utf8"), originalModels, "models.yml byte-identical to pre-setup");
  assert.equal(readFileSync(configYml, "utf8"), originalConfig, "config.yml byte-identical to pre-setup");
  assert.equal(existsSync(extFile), false, "kit-created extension removed");
  assert.equal(existsSync(join(home, ".omp", "agent", "mcp.json")), false, "kit-created mcp.json removed");
});

// Running setup from a source checkout would wire the user's harnesses to the
// checkout root instead of the installed copy (two kits, one home) — it must
// refuse unless ZCODE_KIT_ALLOW_CHECKOUT=1 opts in.
test("setup refuses to write user configs from a checkout without opt-in", () => {
  const { home } = fakeHome();
  let failed = false;
  try {
    execFileSync(process.execPath, [join(KIT, "setup.mjs")], {
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        APPDATA: join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(home, 'AppData', 'Local'),
        XDG_CONFIG_HOME: join(home, '.config'),
        ZCODE_KIT_SKIP_DEPS: "1",
        // deliberately NO ZCODE_KIT_ALLOW_CHECKOUT here
        PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
      },
      encoding: "utf8",
    });
    assert.fail("setup should have refused");
  } catch (err) {
    failed = true;
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    assert.match(out, /source checkout/);
    assert.match(out, /ZCODE_KIT_ALLOW_CHECKOUT=1/);
  }
  assert.ok(failed);
  assert.equal(existsSync(join(home, ".omp", "agent", "extensions")), false, "nothing written into the fake home");
});

// `zcode-kit update` ends with a re-setup, which used to die on the
// checkout-write guard — update requires a checkout, yet could never finish on
// one. Explicitly running `update` is itself the opt-in, so cmdUpdate sets
// ZCODE_KIT_ALLOW_CHECKOUT=1 for its own re-setup step. Proven end-to-end
// against a minimal fixture kit inside a real (local, offline) git repo.
test("update from a checkout completes — re-setup implies the checkout opt-in (H3)", async () => {
  const gitProbe = spawnSync("git", ["--version"]);
  if (gitProbe.status !== 0) {
    console.warn("git not on PATH — skipping the update e2e test (update itself requires git)");
    return;
  }
  const base = join(TMP, `update-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const origin = join(base, "origin.git");
  const checkout = join(base, "checkout");
  const home = join(base, "home");
  mkdirSync(join(home, ".omp", "agent"), { recursive: true }); // fake home, no harness configs
  mkdirSync(join(checkout, "proxy"), { recursive: true });
  // Minimal runnable kit: the fixture copy is the code under test, so a
  // regression of the fix fails here immediately. The live proxy/config.yaml
  // (real key) is deliberately NOT copied — only the example scaffold. The
  // stub manager pins the restart contract: update must invoke it.
  cpSync(join(KIT, "cli"), join(checkout, "cli"), { recursive: true });
  cpSync(join(KIT, "lib"), join(checkout, "lib"), { recursive: true });
  // Ticket 43: setup renders through the output module, whose token set and
  // width core re-export the shared files under zcode-proxy-src/src/tui —
  // part of every real kit layout, so the minimal fixture kit carries them.
  mkdirSync(join(checkout, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(KIT, "zcode-proxy-src", "src", "tui", f), join(checkout, "zcode-proxy-src", "src", "tui", f));
  // Template port: a free port of this run (ticket 75), as the re-setup probes it.
  writeFileSync(join(checkout, "proxy", "config.example.yaml"), readFileSync(join(KIT, "proxy", "config.example.yaml"), "utf8").replace(/^  port: \d+/m, `  port: ${await freePort()}`));
  writeFileSync(join(checkout, "proxy", "zcode-proxy-manager.mjs"), "console.log('stub manager:', process.argv[2] ?? 'none');\n");
  const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });
  try {
    git(["init", "-b", "main"], checkout);
    git(["-c", "core.autocrlf=false", "add", "-A"], checkout);
    git(["-c", "user.email=kit@test", "-c", "user.name=kit", "commit", "-m", "fixture"], checkout);
    git(["init", "--bare", "-b", "main", origin], base);
    git(["remote", "add", "origin", origin], checkout);
    git(["push", "-u", "origin", "main"], checkout);

    const out = execFileSync(process.execPath, [join(checkout, "cli", "zcode-kit.mjs"), "update"], {
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        APPDATA: join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(home, 'AppData', 'Local'),
        XDG_CONFIG_HOME: join(home, '.config'),
        ZCODE_KIT_SKIP_DEPS: "1",
        // deliberately NOT opted in at the env level — update must imply it
        ZCODE_KIT_ALLOW_CHECKOUT: "0",
      },
      encoding: "utf8",
    });
    assert.match(out, /refreshing consented integrations/);
    assert.match(out, /Connection details unavailable: no proxy manager in this kit layout/, "a stub manager must not abort the re-setup");
    assert.match(out, /starting the proxy on the updated code/, "update must restart the proxy after re-setup");
    assert.match(out, /stub manager: start/, "the manager must be invoked with the start subcommand");
    assert.doesNotMatch(out, /refusing to write user configs from a source checkout/);
    assert.ok(existsSync(join(checkout, ".proxykey")), "re-setup must have bootstrapped from the checkout root");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Models the real-world migration case: a machine with the previous-generation
// integration's managed block already in models.yml. The kit must take that
// block over (exactly one zcode provider afterwards), not insert a duplicate
// (duplicate map keys made setup abort fail-closed in v0.2.0).
test("omp adapter takes over legacy zcode-omp-integration managed block", async () => {
  const home = join(TMP, `home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const agent = join(home, ".omp", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(
    join(agent, "models.yml"),
    [
      "# user models",
      "providers:",
      "",
      "# >>> zcode-omp-integration (managed block) — do not edit inside",
      "# Provider ZCode — GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy",
      "# zcode-omp-integration/EFFORT_MAPPING.md.",
      "  zcode:",
      "    name: ZCode",
      "    baseUrl: http://127.0.0.1:8457",
      "    api: anthropic-messages",
      "    apiKey: !node 'C:/Users/someone/zcode-omp-integration/proxy/resolve-zcode-proxy-key.mjs'",
      "    models:",
      "      - id: glm-5.3",
      "        name: GLM-5.3",
      "# <<< zcode-omp-integration",
      "  LiteLLMFree:",
      "    name: LiteLLM",
      "",
    ].join("\n"),
  );
  const modelsYml = join(agent, "models.yml");

  const out1 = await runSetup(home);
  assert.match(out1, /models\.yml updated/);
  const models1 = readFileSync(modelsYml, "utf8");
  assert.doesNotMatch(models1, /zcode-omp-integration/, "legacy markers and content gone");
  assert.match(models1, /# >>> zcode-kit \(managed block\)/, "kit block present");
  assert.equal((models1.match(/^  zcode:$/gm) ?? []).length, 1, "exactly one zcode provider entry");
  assert.match(models1, /LiteLLMFree:/, "unrelated provider preserved");
  assert.match(models1, /apiKey: "[A-Za-z0-9_-]+"/, "literal key in place (old root path gone)");

  // second run: byte-identical, no new transaction
  const sha1 = sha(modelsYml);
  const out2 = await runSetup(home);
  assert.match(out2, /already up to date/);
  assert.equal(sha(modelsYml), sha1, "re-run changes nothing");
});

// A `zcode` entry nobody managed (hand-written, no markers) must not be
// overwritten and must not be duplicated — the adapter aborts, nothing written.
test("omp adapter fails closed on hand-written zcode entry outside managed blocks", async () => {
  const home = join(TMP, `home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const agent = join(home, ".omp", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(
    join(agent, "models.yml"),
    [
      "providers:",
      "  zcode:",
      "    name: My own zcode",
      "    baseUrl: http://127.0.0.1:9999",
      "  Other:",
      "    name: Other",
      "",
    ].join("\n"),
  );
  const modelsYml = join(agent, "models.yml");
  const before = readFileSync(modelsYml, "utf8");

  try {
    await runSetup(home);
    assert.fail("setup should have failed");
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    assert.match(out, /outside any managed block/);
  }
  assert.equal(readFileSync(modelsYml, "utf8"), before, "nothing written on refusal");
});

// Ticket 43: the compact report is the default. The screen shows the report
// (banner, stage rows, one result row per assistant, the connection check,
// the undo command, the connection details) and install.log carries the full
// output — every line the old verbose output had (the line-set comparison
// against the committed fixture lives in tests/install-log-lines.test.mjs).
test("compact setup by default: report on the screen, full output in install.log", async () => {
  const { home } = fakeHome();
  const state = await stateFor(home);
  // Both streams: the stage rows are progress and go to stderr (ADR-0005);
  // the report rows go to stdout. install.log carries both.
  const spawned = spawnSync(process.execPath, [join(KIT, "setup.mjs")], {
    env: {
      ...process.env,
      USERPROFILE: home, HOME: home, ZCODE_KIT_STATE_DIR: state, ZCODE_KIT_SKIP_DEPS: "1",
      ZCODE_KIT_ALLOW_CHECKOUT: "1", ZCODE_KIT_HARNESSES: "omp",
      PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
    },
    encoding: "utf8",
  });
  const out = `${spawned.stdout ?? ""}${spawned.stderr ?? ""}`;
  // The compact report on the screen (pipe: plain rows, no escapes).
  assert.match(out, /ZCODE  \/  AGENT KIT/, "the kit banner");
  assert.match(out, /OK\s+OMP \/ Oh My Pi/, "one result row per assistant");
  assert.match(out, /Assistants\s+\d+ configured/, "the summary block");
  assert.match(out, /Undo\s+zcode-kit rollback \S+/, "the undo command");
  assert.match(out, /Setup log\s+\S+/, "the log path");
  assert.match(out, /Connection details \(local ZCode proxy/, "the connection details");
  assert.match(out, /Connection check/, "the connection check");
  assert.doesNotMatch(out, /models\.yml updated/, "adapter diagnostics live in the log, not on the compact screen");
  assert.equal(out.indexOf("\x1b"), -1, "no escape sequence off a TTY");
  // The full output in install.log.
  const log = readFileSync(join(state, "logs", "install.log"), "utf8");
  assert.match(log, /models\.yml updated/);
  assert.match(log, /== omp: OMP \/ Oh My Pi/);
  assert.match(log, /transaction \S+ recorded — undo with: zcode-kit rollback \S+/);
  assert.match(log, /Connection details \(local ZCode proxy/);
});
