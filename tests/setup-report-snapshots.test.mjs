// The compact setup report in every C3 variant (ticket 43 acceptance,
// seam 5 style): a scripted setup run rendered through the setup ui adapter
// (cli/setup-output.mjs setupUi) over the output module with forced
// capabilities, byte-compared per variant (ANSI included). The same render
// must leave the old-format lines in the install.log sink — nothing printed
// today is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutput } from "../lib/term/out.mjs";
import { C3_VARIANTS, COLOURLESS_VARIANTS, matchSnapshot, normaliseSnapshot } from "./snapshot-harness.mjs";
import { fakeClock } from "./term-fixtures.mjs";
import { setupUi } from "../cli/setup-output.mjs";

function fakeStream(isTTY, columns) {
  const chunks = [];
  return { isTTY, columns: isTTY ? columns : undefined, write(chunk) { chunks.push(String(chunk)); return true; }, text: () => chunks.join("") };
}

/**
 * One full setup report as the command renders it: stage rows (1/4 as
 * Out.step progress), one result row per assistant, WARN with what/next
 * (bootstrap's manual-step block), the rotator lines, the end block with the
 * undo command, the connection check and the connection details.
 */
function driveSetup(ui, log) {
  const step1 = ui.step("Runtime and configuration");
  ui.detail("== bootstrap ==");
  ui.detail("  proxy/config.yaml already present — left untouched");
  ui.detail("  MANUAL STEP REQUIRED (once): log in with your ZCode account:");
  ui.detail("    cd <KIT>/zcode-proxy-src");
  ui.detail('    ZCODE_PROXY_CONFIG="<STATE>/proxy/config.yaml" bun run src/index.ts auth login zai');
  ui.flush();
  step1.done("runtime ready");
  ui.heading("Assistant integrations");
  ui.detail("detected harnesses: omp, pi — adapters run only after consent (y answer, stored decision, explicit selection) or to refresh a kit-owned integration");
  ui.note("an existing kit integration for OMP / Oh My Pi was found; y keeps it current, n leaves it untouched.");
  ui.result("ok", "OMP / Oh My Pi  + MCP bridge");
  ui.result("skip", "pi — answered n");
  ui.heading("Account Rotator");
  ui.progress("\n  Keep authorized logins as separate encrypted accounts.");
  ui.progress("  New logins are saved automatically while the feature is enabled.");
  ui.progress("  [OK] Account Rotator disabled. Saved accounts are kept.");
  ui.progress("  Enable later: zcode-kit accounts enable");
  ui.saved(
    ["Configuration saved.", "Assistants: 1 configured, 1 skipped, 0 failed."],
    [["Assistants", "1 configured, 1 skipped, 0 failed"], ["Undo", "zcode-kit rollback 2026-11-09T12-00-00-000-001-a1b2c3"], ["Setup log", "<STATE>/logs/install.log"]],
  );
  const check = ui.step("Connection check");
  ui.detail("  [SKIP] Setup live smoke skipped (CI/test or explicit ZCODE_KIT_SKIP_SMOKE=1).");
  check.done("Setup live smoke skipped (CI/test or explicit ZCODE_KIT_SKIP_SMOKE=1).");
  ui.dataLine("  Connection details (local ZCode proxy, from configuration; proxy not verified running)");
  ui.dataLine("    OpenAI-compatible base URL:    http://127.0.0.1:8457/v1   (POST /chat/completions, POST /responses, GET /models)");
  ui.dataLine("    Anthropic-compatible base URL: http://127.0.0.1:8457      (POST /v1/messages)");
  ui.dataLine("    API key (Bearer / x-api-key):  (redacted: not an interactive terminal — print it with: zcode-kit models --show-key)");
  ui.dataLine("    Model IDs:                     glm-5.3, glm-5.3-flash");
  return log;
}

for (const [name, v] of Object.entries(C3_VARIANTS)) {
  test(`snapshot: the compact setup report in ${name}`, () => {
    const stdout = fakeStream(v.tty, v.columns), stderr = fakeStream(v.tty, v.columns);
    const log = [];
    const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform, clock: fakeClock() });
    const banner = ["  ZCODE  /  AGENT KIT", "  v0.2.42  |  Your local AI workspace"];
    const ui = setupUi({ out, log: (t) => log.push(t), banner, stdout, stderr });
    driveSetup(ui, log);
    matchSnapshot(`setup-report/${name}.out`, normaliseSnapshot(stdout.text()));
    matchSnapshot(`setup-report/${name}.err`, normaliseSnapshot(stderr.text()));
  });
}

test("no escape sequence in any colourless variant of the compact report (Story 107)", () => {
  let scanned = 0;
  for (const name of COLOURLESS_VARIANTS) {
    const v = C3_VARIANTS[name];
    const stdout = fakeStream(v.tty, v.columns), stderr = fakeStream(v.tty, v.columns);
    const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform, clock: fakeClock() });
    const ui = setupUi({ out, log: () => {}, banner: ["  ZCODE  /  AGENT KIT"], stdout, stderr });
    driveSetup(ui, []);
    for (const text of [stdout.text(), stderr.text()]) {
      assert.equal(text.indexOf("\x1b"), -1, `ESC byte in ${name}: ${JSON.stringify(text.slice(Math.max(0, text.indexOf("\x1b") - 20), text.indexOf("\x1b") + 20))}`);
      scanned += text.length;
    }
  }
  assert.ok(scanned > 2000, "the scan must cover real renders");
});

test("the install.log sink keeps the old verbose shapes for every rendered row", () => {
  const v = C3_VARIANTS.pipe;
  const stdout = fakeStream(false), stderr = fakeStream(false);
  const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform, clock: fakeClock() });
  const log = [];
  const ui = setupUi({ out, log: (t) => log.push(t), banner: ["  ZCODE  /  AGENT KIT"], stdout, stderr });
  driveSetup(ui, log);
  const text = log.join("\n");
  // The old-format lines the old verbose output printed (subset; the full
  // line set is pinned by tests/install-log-lines.test.mjs end to end).
  for (const line of [
    "== bootstrap ==",
    "  proxy/config.yaml already present — left untouched",
    "  MANUAL STEP REQUIRED (once): log in with your ZCode account:",
    "    cd <KIT>/zcode-proxy-src",
    '    ZCODE_PROXY_CONFIG="<STATE>/proxy/config.yaml" bun run src/index.ts auth login zai',
    "detected harnesses: omp, pi — adapters run only after consent (y answer, stored decision, explicit selection) or to refresh a kit-owned integration",
    "  note: an existing kit integration for OMP / Oh My Pi was found; y keeps it current, n leaves it untouched.",
    "  [OK]   OMP / Oh My Pi  + MCP bridge",
    "  [SKIP] pi — answered n",
    "\n  Keep authorized logins as separate encrypted accounts.",
    "  [OK] Account Rotator disabled. Saved accounts are kept.",
    "\n  Configuration saved.",
    "  Assistants: 1 configured, 1 skipped, 0 failed.",
    "  [SKIP] Setup live smoke skipped (CI/test or explicit ZCODE_KIT_SKIP_SMOKE=1).",
    "  Connection details (local ZCode proxy, from configuration; proxy not verified running)",
  ]) {
    assert.ok(log.includes(line), `install.log must keep the old line: ${JSON.stringify(line)}`);
  }
  assert.ok(!text.includes("\x1b"), "the log carries no colour codes");
});
