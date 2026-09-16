import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));

test("npm postinstall hint never launches setup or writes configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "zcode-postinstall-"));
  try {
    mkdirSync(join(dir, "cli"));
    mkdirSync(join(dir, "lib"));
    copyFileSync(join(root, "setup.mjs"), join(dir, "setup.mjs"));
    writeFileSync(join(dir, "lib", "transaction.mjs"), "export const listTransactions = () => [];\n");
    writeFileSync(join(dir, "cli", "zcode-kit.mjs"), "import {writeFileSync} from 'node:fs';writeFileSync(new URL('../setup-ran', import.meta.url), 'unexpected');process.exit(73);\n");
    const before = readdirSync(dir).sort();
    const result = spawnSync(process.execPath, [join(dir, "setup.mjs"), "--postinstall-hint"], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, HOME: dir, USERPROFILE: dir, APPDATA: dir, LOCALAPPDATA: dir },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /zcode-kit setup/);
    assert.equal(existsSync(join(dir, "setup-ran")), false);
    assert.deepEqual(readdirSync(dir).sort(), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
