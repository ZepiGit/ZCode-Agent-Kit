// Verifies the assembled launcher package payload (pack/dist):
//  - no secrets / local state ever ship (.proxykey, credentials, real config,
//    generated/, backups/, logs, VS Code or desktop data)
//  - required runtime files are present (CLI, manager, bridge build, resolver)
//  - no absolute paths containing the builder's user name leak into sources
// Exit 1 on any violation — CI gates publication on this.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "pack", "dist");

const FORBIDDEN_FILES = [
  /\.proxykey$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)config\.yaml$/,
  /(^|\/)generated\//,
  /(^|\/)backups\//,
  /(^|\/)logs\//,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules\//,
  /(^|\/)\.mimosa\//,
];

const REQUIRED_FILES = [
  "cli/zcode-kit.mjs",
  "cli/adapters/omp.mjs",
  "cli/adapters/pi.mjs",
  "cli/adapters/goose.mjs",
  "proxy/zcode-proxy-manager.mjs",
  "proxy/resolve-zcode-proxy-key.mjs",
  "proxy/config.example.yaml",
  "mcp/zcode-harness-mcp/dist/index.js",
  "setup.mjs",
  "bin/zcode-claude.cmd",
  "bin/zcode-codex.cmd",
];

const SECRET_PATTERNS = [
  /ey[J][A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT-shaped strings
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failed = 0;
const fail = (msg) => { console.error(`VERIFY-FAIL: ${msg}`); failed += 1; };

for (const f of FORBIDDEN_FILES) {
  if (existsSync(join(DIST, f.source ?? f)) || [...walk(DIST)].some((p) => f.test(relative(DIST, p).replace(/\\/g, "/")))) {
    fail(`forbidden path present: ${f}`);
  }
}

for (const req of REQUIRED_FILES) {
  if (!existsSync(join(DIST, req))) fail(`required file missing: ${req}`);
}

const home = process.env.USERPROFILE ?? "";
const homeName = home.split(/[\\/]/).pop() ?? "";
for (const file of walk(DIST)) {
  const rel = relative(DIST, file);
  if (statSync(file).size > 2 * 1024 * 1024) { fail(`oversized file: ${rel}`); continue; }
  const text = readFileSync(file, "utf8");
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) fail(`secret-shaped content in ${rel} (pattern ${re})`);
  }
  if (homeName && homeName.length > 3 && text.includes(homeName)) {
    fail(`builder home name "${homeName}" leaks in ${rel}`);
  }
}

if (failed > 0) {
  console.error(`verify-payload: ${failed} problem(s) — package is NOT shippable`);
  process.exit(1);
}
console.log("verify-payload: OK (no forbidden paths, all required files, no secret shapes, no builder paths)");
