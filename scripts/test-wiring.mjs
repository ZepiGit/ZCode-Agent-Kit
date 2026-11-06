// Test-wiring guard: finds kit test files (`tests/*.test.mjs`) that no test
// script (`test` or `test:*` in package.json) references, so a test cannot sit
// outside `npm run test` and CI unnoticed. Used by tests/test-wiring.test.mjs.
//
// A file counts as wired only when a test script names it as a whole argument
// (`tests/<name>`, optionally `./`-prefixed or quoted); globs and directories
// are not expanded, so a script that relies on them reports its files unwired.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_FILE = /\.test\.mjs$/;

function scriptTokens(command) {
  return command
    .split(/\s+|&&|\|\||;/)
    .map((token) => token.replace(/^["']|["']$/g, "").replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean);
}

export function checkTestWiring(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const referenced = new Set();
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (name !== "test" && !name.startsWith("test:")) continue;
    for (const token of scriptTokens(String(command))) referenced.add(token);
  }
  const dir = join(root, "tests");
  const testFiles = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && TEST_FILE.test(entry.name))
      .map((entry) => `tests/${entry.name}`)
      .sort()
    : [];
  return { testFiles, unwired: testFiles.filter((file) => !referenced.has(file)) };
}
