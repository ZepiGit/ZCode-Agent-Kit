// Repository guard (seam 9): every kit test file `tests/*.test.mjs` must be
// referenced by a test script (`test` or `test:*` in package.json), so no test
// can sit outside `npm run test` and CI unnoticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTestWiring } from "../scripts/test-wiring.mjs";

function fixtureRepo(t, { scripts, files }) {
  const root = mkdtempSync(join(tmpdir(), "zcode-test-wiring-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts }));
  mkdirSync(join(root, "tests"), { recursive: true });
  for (const name of files) writeFileSync(join(root, "tests", name), "// fixture\n");
  return root;
}

test("a scratch test file wired into no test script is reported unwired", (t) => {
  const root = fixtureRepo(t, {
    scripts: { test: "node --test tests/alpha.test.mjs" },
    files: ["alpha.test.mjs", "scratch.test.mjs"],
  });
  assert.deepEqual(checkTestWiring(root).unwired, ["tests/scratch.test.mjs"]);
});

test("only a whole-argument reference in a test script wires a file", (t) => {
  const root = fixtureRepo(t, {
    scripts: {
      test: "node --test ./tests/a.test.mjs \"tests/b.test.mjs\" tests/c.test.mjs.bak tests/pre-d.test.mjs",
      "test:extra": "node --test tests\\f.test.mjs",
      kit: "node tests/e.test.mjs",
    },
    files: ["a.test.mjs", "b.test.mjs", "c.test.mjs", "d.test.mjs", "e.test.mjs", "f.test.mjs", "helper.mjs"],
  });
  assert.deepEqual(checkTestWiring(root).unwired, ["tests/c.test.mjs", "tests/d.test.mjs", "tests/e.test.mjs"]);
});

test("a package without test scripts leaves every test file unwired", (t) => {
  const root = fixtureRepo(t, { scripts: undefined, files: ["a.test.mjs", "b.test.mjs"] });
  assert.deepEqual(checkTestWiring(root).unwired, ["tests/a.test.mjs", "tests/b.test.mjs"]);
});

test("every kit test file in this repository is wired into a test script", () => {
  const { testFiles, unwired } = checkTestWiring(join(import.meta.dirname, ".."));
  assert.ok(testFiles.includes("tests/test-wiring.test.mjs"), "the guard must see the repository's test files");
  assert.deepEqual(unwired, [], `wire these into a test script in package.json: ${unwired.join(", ")}`);
});

// Ticket 76: the proxy test run loads the egress guard. `npm run test:proxy`
// runs `bun test` inside zcode-proxy-src, where bunfig.toml preloads it, and
// both CI workflows run that script.
test("npm run test:proxy loads the egress guard preload, in CI too", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const repo = join(import.meta.dirname, "..");
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const bunfig = readFileSync(join(repo, "zcode-proxy-src", "bunfig.toml"), "utf8").replace(/\r\n/g, "\n");
  const testSection = /^\[test\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(bunfig)?.[1] ?? "";
  const preload = /^preload\s*=\s*\[([^\]]*)\]/m.exec(testSection)?.[1] ?? "";
  const preloads = [...preload.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const workflowsRunIt = ["ci.yml", "release.yml"].map((name) =>
    /^\s+run: npm run test:proxy$/m.test(readFileSync(join(repo, ".github", "workflows", name), "utf8")));
  assert.deepEqual({
    script: pkg.scripts["test:proxy"],
    preloads,
    preloadExists: preloads.every((p) => existsSync(join(repo, "zcode-proxy-src", p))),
    workflowsRunIt,
  }, {
    script: "cd zcode-proxy-src && bun test",
    preloads: ["./test-support/egress-guard-preload.ts"],
    preloadExists: true,
    workflowsRunIt: [true, true],
  });
});
