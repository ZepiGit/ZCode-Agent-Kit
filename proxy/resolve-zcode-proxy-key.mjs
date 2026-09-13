#!/usr/bin/env node
// Resolves the local zcode-proxy client key for harness configs (OMP models.yml
// uses: apiKey: '!node <clone>/proxy/resolve-zcode-proxy-key.mjs').
// Reads the key file next to the clone root (portable — no absolute paths) and
// prints it to stdout. The key never appears inside configs, backups, or logs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".proxykey");
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
