// install.log line-set comparison (ticket 43 acceptance): the compact report
// is the default now, but nothing the command printed before may be lost —
// install.log must contain EVERY line the old verbose output had.
//
// The fixture (tests/fixtures/install-log-old-verbose.txt) is the full
// verbose output of `setup --harness omp` on a fresh fake home, captured from
// the pre-ticket-43 code and normalised (paths, port, transaction id). The
// test runs the same scenario against the current code, reads install.log and
// compares line sets after the same normalisation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createCtx, ensureRuntimeFiles } from "../cli/context.mjs";
import { freePort } from "./free-port.mjs";

const KIT = join(import.meta.dirname, "..");
const TMP = join(import.meta.dirname, "fakehome", "install-log");
ensureRuntimeFiles(createCtx(KIT));

// split(/\r?\n/): the fixture is a plain text file (no -text attribute in
// .gitattributes), so a Windows checkout may hand it CRLF endings — every
// fixture line then carried a trailing \r and matched nothing (CI win24,
// run 42725722962). The comparison is about line content; install.log itself
// is written with LF only.
const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "install-log-old-verbose.txt"), "utf8")
  .split(/\r?\n/)
  .filter((line, i, all) => line !== "" || i < all.length - 1);

function fixtureHome() {
  const home = join(TMP, `home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const agent = join(home, ".omp", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "models.yml"), "providers:\n  openai:\n    name: OpenAI\n    models:\n      - id: gpt-test\n");
  writeFileSync(join(agent, "config.yml"), "disabledProviders:\n  - zcode\nallowTools:\n  - zcode\n");
  return home;
}

/** Same recipe as tests/setup-regressions.test.mjs: prepared state, fake home. */
async function stateFor(home) {
  const state = `${home}-state`;
  mkdirSync(join(state, "proxy"), { recursive: true });
  let identity = realpathSync(KIT);
  if (process.platform === "win32") identity = identity.toLowerCase();
  writeFileSync(join(state, ".owner.json"), JSON.stringify({ root: identity }) + "\n");
  writeFileSync(join(state, ".proxykey"), "synthetic-install-log-key\n");
  writeFileSync(join(state, "proxy", "config.yaml"), readFileSync(join(KIT, "proxy", "config.example.yaml"), "utf8")
    .replace(/^  port: \d+/m, `  port: ${await freePort()}`).replace('proxyApiKey: "GENERATE_ME"', 'proxyApiKey: "synthetic-install-log-key"'));
  return state;
}

const TX_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-\d{3}-[0-9a-f]{6}\b/g;

test("install.log keeps every line the old verbose output had (line-set comparison)", async () => {
  const home = fixtureHome();
  const state = await stateFor(home);
  execFileSync(process.execPath, [join(KIT, "setup.mjs")], {
    env: {
      ...process.env,
      USERPROFILE: home, HOME: home, ZCODE_KIT_STATE_DIR: state, ZCODE_KIT_SKIP_DEPS: "1",
      ZCODE_KIT_ALLOW_CHECKOUT: "1", ZCODE_KIT_HARNESSES: "omp",
      PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
    },
    encoding: "utf8",
  });
  assert.ok(existsSync(join(state, "logs", "install.log")), "install.log is written in every mode");
  const log = readFileSync(join(state, "logs", "install.log"), "utf8");
  const normalise = (s) => s
    // state first: the state dir shares the home path as its prefix
    .replaceAll(`${home}-state`, "<STATE>").replaceAll(home, "<HOME>").replaceAll(KIT, "<KIT>")
    .replace(/\b127\.0\.0\.1:\d{2,5}\b/g, "127.0.0.1:<PORT>")
    .replace(TX_RE, "<TX>");
  const logLines = new Set(log.split("\n").map(normalise));
  // The header and the compact-only rows are additive; every OLD line must be there.
  const missing = FIXTURE.filter((line) => !logLines.has(line));
  assert.deepEqual(missing, [], "every line of the old verbose output must be in install.log");
  assert.ok(log.split("\n").length > FIXTURE.length, "the log also carries the report rows (superset)");
});
