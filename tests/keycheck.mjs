#!/usr/bin/env node
// Compare the key inside proxy/config.yaml (YAML-parsed) with .proxykey.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const req = createRequire(join(ROOT, "zcode-proxy-src", "package.json"));
const YAML = req("yaml");
const cfg = YAML.parse(readFileSync(join(ROOT, "proxy", "config.yaml"), "utf8"));
const keyFile = readFileSync(join(ROOT, ".proxykey"), "utf8").trim();
const keyCfg = String(cfg.auth.proxyApiKey).trim();
console.log("cfg key length:", keyCfg.length, "| file key length:", keyFile.length);
console.log("equal:", keyCfg === keyFile);
// Also replicate the manager's health request:
const res = await fetch("http://127.0.0.1:8457/health", {
  headers: { Authorization: `Bearer ${keyFile}` },
  signal: AbortSignal.timeout(3000),
});
console.log("health with keyfile key:", res.status, await res.text());
