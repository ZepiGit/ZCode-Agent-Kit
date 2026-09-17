#!/usr/bin/env node
// Credential helper for harnesses that support command-based key resolution.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { stateDirectory } from "../lib/state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_PATH = join(stateDirectory(ROOT, homedir()), ".proxykey");
try {
  const key = readFileSync(KEY_PATH, "utf8").trim();
  if (!key) {
    process.stderr.write("empty proxy key file\n");
    process.exit(1);
  }
  process.stdout.write(key);
} catch (err) {
  process.stderr.write(`cannot read ${KEY_PATH}: ${err.message}\n`);
  process.exit(1);
}
