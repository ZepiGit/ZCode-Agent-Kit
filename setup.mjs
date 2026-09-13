#!/usr/bin/env node
// ZCode access kit — one-command setup for a fresh clone.
//
//   node setup.mjs                     # bootstrap + wire all detected harnesses
//   node setup.mjs --only=omp,mcp      # subset: omp | claude-code | codex | mcp
//   node setup.mjs --rollback          # restore latest backups per file
//
// Target audience: a user with their own ZCode Desktop (logged in) and their
// own agent harness (OMP, Claude Code, Codex CLI, or any MCP/OpenAI/Anthropic
// capable client). Everything here is additive and namespaced: existing
// providers, model roles, MCP servers, and harness configs are never replaced.
//
// What it does:
//   0. bootstrap:  generate .proxykey + proxy/config.yaml (from example),
//                  bun install for proxy and MCP bridge, import the ZCode
//                  Desktop credential (or print the one manual login step)
//   1. omp:        models.yml managed provider block + autostart extension
//   2. claude-code: generated settings file + bin/zcode-claude.cmd wrapper
//                  (opt-in per invocation; never touches ~/.claude/settings.json)
//   3. codex:      isolated CODEX_HOME in generated/ + bin/zcode-codex.cmd
//                  (never touches ~/.codex)
//   4. mcp:        register zcode-harness-mcp with OMP (mcp.json merge) and
//                  Claude Code (`claude mcp add`, user scope); Codex gets it in
//                  its generated home; other MCP clients: see harnesses/README.md
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = (process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const BACKUP_DIR = join(ROOT, "backups");

const KEY_FILE = join(ROOT, ".proxykey");
const CONFIG_EXAMPLE = join(ROOT, "proxy", "config.example.yaml");
const CONFIG = join(ROOT, "proxy", "config.yaml");
const PROXY_SRC = join(ROOT, "zcode-proxy-src");
const MCP_DIR = join(ROOT, "mcp", "zcode-harness-mcp");
const GENERATED = join(ROOT, "generated");
const MARKER_BEGIN = "# >>> zcode-kit (managed block) — do not edit inside";
const MARKER_END = "# <<< zcode-kit";
const EXT_ENTRY_NAME = "zcode-proxy-autostart.ts";
const YAML_HAS_UNFILLED_KEY = /proxyApiKey: "GENERATE_ME"/;

const only = (() => {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  return arg ? arg.slice(7).split(",").map((s) => s.trim()) : null;
})();
const want = (name) => !only || only.includes(name);

function backup(file) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const target = join(BACKUP_DIR, `${STAMP}__${file.split(/[\\/]/).pop()}`);
  copyFileSync(file, target);
  console.log(`  backup: ${target}`);
}

function atomicWrite(file, content) {
  const tmp = file + ".zcode-staging";
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

function proxyPort() {
  return Number((readFileSync(CONFIG, "utf8").match(/^  port:\s*(\d+)/m) ?? [])[1] ?? 8457);
}

function readKey() {
  return readFileSync(KEY_FILE, "utf8").trim();
}

// ---------------------------------------------------------------- bootstrap
// Local-only git excludes (kept out of the repo on purpose: no .gitignore is
// committed). setup.mjs installs the same block into every clone's
// .git/info/exclude, which git never pushes — the repo listing stays clean.
const GIT_EXCLUDE_BLOCK = `# >>> zcode-kit local excludes (managed by setup.mjs) — local-only, never pushed
.proxykey
proxy/config.yaml
backups/
logs/
generated/
*.zcode-staging

tests/fakehome/
tests/dryhome/
tests/tooltrip/
tests/mock-requests.jsonl
tests/*.log
tests/*.jsonl
ext-probe.log

zcode-proxy-src/node_modules/
zcode-proxy-src/Android-APP/
zcode-proxy-src/config.yaml
zcode-proxy-src/.zcode-proxy/
zcode-proxy-src/.omo/
zcode-proxy-src/_reverse/
zcode-proxy-src/*.tsbuildinfo
zcode-proxy-src/zcode-proxy.exe
zcode-proxy-src/zcode-proxy-linux-*
zcode-proxy-src/zcode-proxy-darwin-*
zcode-proxy-src/.idea/
zcode-proxy-src/.DS_Store

mcp/zcode-harness-mcp/node_modules/
mcp/zcode-harness-mcp/demo-workspace/
mcp/zcode-harness-mcp/test/live-ws/
mcp/zcode-harness-mcp/test/live-data/
mcp/zcode-harness-mcp/*.log
.mimosa/
# <<< zcode-kit
`;

function ensureLocalGitExclude() {
  const gitDir = join(ROOT, ".git");
  if (!existsSync(gitDir)) return; // not a git checkout (e.g. zip download)
  const infoDir = join(gitDir, "info");
  const excludeFile = join(infoDir, "exclude");
  mkdirSync(infoDir, { recursive: true });
  const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : "";
  if (existing.includes("zcode-kit local excludes")) return;
  writeFileSync(excludeFile, existing.replace(/\n*$/, "\n") + "\n" + GIT_EXCLUDE_BLOCK);
  console.log("  local git excludes installed (.git/info/exclude — never pushed)");
}

function bootstrap() {
  console.log("== bootstrap ==");
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  mkdirSync(GENERATED, { recursive: true });
  ensureLocalGitExclude();

  if (!existsSync(KEY_FILE)) {
    writeFileSync(KEY_FILE, randomBytes(32).toString("base64url") + "\n");
    console.log("  generated local proxy key -> .proxykey (user-local secret, never committed)");
  }
  if (!existsSync(CONFIG)) {
    const example = readFileSync(CONFIG_EXAMPLE, "utf8");
    // Target the quoted value only — "GENERATE_ME" also appears in a comment.
    const filled = example.replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${readKey()}"`);
    if (YAML_HAS_UNFILLED_KEY.test(filled)) throw new Error("config template key substitution failed");
    atomicWrite(CONFIG, filled);
    console.log("  wrote proxy/config.yaml from example (port 8457, claim/async disabled)");
  } else {
    console.log("  proxy/config.yaml already present — left untouched");
  }

  for (const [label, dir] of [["proxy", PROXY_SRC], ["mcp bridge", MCP_DIR]]) {
    if (!existsSync(join(dir, "node_modules"))) {
      console.log(`  installing ${label} dependencies (bun)...`);
      try {
        execFileSync("bun", ["install"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        console.log(`  WARN: bun install failed for ${label}. Install manually: cd ${dir} && bun install`);
      }
    } else {
      console.log(`  ${label} dependencies present`);
    }
  }

  const credStore = join(HOME, ".zcode-proxy", "credentials.json");
  if (!existsSync(credStore)) {
    const desktopCfg = join(HOME, ".zcode", "v2", "config.json");
    if (existsSync(desktopCfg)) {
      console.log("  importing ZCode Desktop credential (start-plan)...");
      try {
        execFileSync("bun", ["run", "src/index.ts", "auth", "login", "zai", "--import"], {
          cwd: PROXY_SRC,
          env: { ...process.env, ZCODE_PROXY_CONFIG: CONFIG },
          stdio: ["ignore", "pipe", "pipe"],
        });
        console.log("  credential imported from the existing ZCode Desktop login");
      } catch {
        console.log("  WARN: import failed. Manual options:");
        console.log(`    cd ${PROXY_SRC}`);
        console.log(`    ZCODE_PROXY_CONFIG="${CONFIG}" bun run src/index.ts auth login zai --import`);
        console.log(`    (or browser login: ZCODE_PROXY_CONFIG="${CONFIG}" bun run src/index.ts auth login zai)`);
      }
    } else {
      console.log("  MANUAL STEP REQUIRED (once): log in with your ZCode account:");
      console.log(`    cd ${PROXY_SRC}`);
      console.log(`    ZCODE_PROXY_CONFIG="${CONFIG}" bun run src/index.ts auth login zai`);
      console.log("  (opens the Z.ai OAuth page in your browser; requires ZCode Desktop");
      console.log("   installed & logged in afterwards for the MCP bridge, and for the");
      console.log("   credential import shortcut: ZCODE_PROXY_CONFIG=... bun run src/index.ts auth login zai --import)");
    }
  } else {
    console.log("  proxy credentials present");
  }
}

// --------------------------------------------------------------------- omp
function ompProviderBlock(port) {
  return `${MARKER_BEGIN}
# Provider ZCode — GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy
# (start-plan access). Efforts low/high/max; default max. See EFFORT_MAPPING.md.
  zcode:
    name: ZCode
    baseUrl: http://127.0.0.1:${port}
    api: anthropic-messages
    apiKey: '!node ${ROOT.replace(/\\/g, "/")}/proxy/resolve-zcode-proxy-key.mjs'
    modelOverrides:
      glm-5.3:
        thinking:
          mode: anthropic-budget-effort
          efforts:
            - low
            - high
            - max
          defaultLevel: max
          requiresEffort: true
        compat:
          supportsOutputEffort: true
          supportsContextManagement: false
          replayUnsignedThinking: true
          injectClaudeCodeInstruction: false
      glm-5.3-flash:
        thinking:
          mode: anthropic-budget-effort
          efforts:
            - low
            - high
            - max
          defaultLevel: max
          requiresEffort: true
        compat:
          supportsOutputEffort: true
          supportsContextManagement: false
          replayUnsignedThinking: true
          injectClaudeCodeInstruction: false
    models:
      - id: glm-5.3
        name: GLM-5.3
        reasoning: true
        input:
          - text
        contextWindow: 1000000
        maxTokens: 131072
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
      - id: glm-5.3-flash
        name: GLM-5.3-Flash
        reasoning: true
        input:
          - text
          - image
        contextWindow: 1000000
        maxTokens: 131072
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
${MARKER_END}`;
}

function validateYaml(text, label) {
  try {
    const req = createRequire(join(ROOT, "zcode-proxy-src", "package.json"));
    req("yaml").parse(text, { strict: false });
    console.log(`  yaml ok: ${label}`);
  } catch (err) {
    throw new Error(`YAML validation failed for ${label}: ${err.message}`);
  }
}

function setupOmp() {
  const agentDir = join(HOME, ".omp", "agent");
  const modelsYml = join(agentDir, "models.yml");
  const configYml = join(agentDir, "config.yml");
  if (!existsSync(modelsYml)) {
    console.log("== omp: skipped (no ~/.omp/agent/models.yml) ==");
    return;
  }
  console.log("== omp ==");
  const models = readFileSync(modelsYml, "utf8");
  const port = proxyPort();

  let newModels = models;
  const begin = newModels.indexOf(MARKER_BEGIN);
  if (begin !== -1) {
    const end = newModels.indexOf(MARKER_END, begin);
    if (end === -1) throw new Error("managed block begin without end marker");
    newModels = (newModels.slice(0, begin) + newModels.slice(end + MARKER_END.length)).replace(/\n{3,}/g, "\n\n");
  }
  const m = newModels.match(/^providers:\s*$/m);
  if (!m || m.index === undefined) throw new Error("top-level `providers:` key not found in models.yml");
  const insertAt = m.index + m[0].length;
  newModels = newModels.slice(0, insertAt) + "\n" + ompProviderBlock(port) + newModels.slice(insertAt);
  validateYaml(newModels, "models.yml (staged)");

  let newConfig = existsSync(configYml) ? readFileSync(configYml, "utf8") : null;
  let configChanged = false;
  if (newConfig) {
    const cleaned = newConfig.replace(/^[ \t]*- zcode[ \t]*$\n?/gm, "");
    // The stale builtin id `zcode` would hide the custom provider; omp 18.x has
    // no builtin zcode provider, so removing the entry adds nothing else.
    const extEntry = `  - ${join(agentDir, "extensions", EXT_ENTRY_NAME).replace(/\\/g, "/")}`;
    let withExt = cleaned;
    if (!cleaned.includes(EXT_ENTRY_NAME)) {
      const em = cleaned.match(/^extensions:\s*$/m);
      withExt = em && em.index !== undefined
        ? cleaned.slice(0, em.index + em[0].length) + `\n${extEntry.trim()}` + cleaned.slice(em.index + em[0].length)
        : cleaned.replace(/\n*$/, "\n") + `extensions:\n${extEntry.trim()}\n`;
    }
    if (withExt !== newConfig) {
      configChanged = true;
      newConfig = withExt;
      validateYaml(newConfig, "config.yml (staged)");
    }
  }

  const extSrc = join(ROOT, "proxy", "zcode-proxy-autostart.ts");
  const extDst = join(agentDir, "extensions", EXT_ENTRY_NAME);
  mkdirSync(dirname(extDst), { recursive: true });
  const extContent = readFileSync(extSrc, "utf8")
    .replaceAll("__ZCODE_OM_ROOT__", ROOT.replace(/\\/g, "/"))
    .replaceAll("__ZCODE_OM_PORT__", String(port));
  if (!existsSync(extDst) || readFileSync(extDst, "utf8") !== extContent) {
    writeFileSync(extDst, extContent);
    console.log("  extension installed/updated: ~/.omp/agent/extensions/zcode-proxy-autostart.ts");
  } else {
    console.log("  extension already current");
  }

  if (newModels !== models) {
    backup(modelsYml);
    atomicWrite(modelsYml, newModels);
    console.log("  models.yml updated (zcode provider)");
  } else {
    console.log("  models.yml already up to date");
  }
  if (newConfig && configChanged) {
    backup(configYml);
    atomicWrite(configYml, newConfig);
    console.log("  config.yml updated (disabledProviders cleaned / extension registered)");
  } else if (newConfig) {
    console.log("  config.yml already up to date");
  }
}

// ------------------------------------------------------- claude-code adapter
function setupClaude() {
  console.log("== claude-code (opt-in wrapper; ~/.claude is NOT modified) ==");
  const port = proxyPort();
  const settingsPath = join(GENERATED, "claude-zcode-settings.json");
  // CLI --settings beats user settings.json, so machines that reroute Claude
  // through another local proxy keep working with their normal `claude`, and
  // `bin/zcode-claude.cmd` routes through ZCode only when explicitly used.
  const settings = {
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_AUTH_TOKEN: readKey(),
      ANTHROPIC_MODEL: "glm-5.3",
      ANTHROPIC_SMALL_FAST_MODEL: "glm-5.3-flash",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3",
      // glm-* models are not in Claude Code's built-in catalog; declare the
      // real context window so auto-compact math and window enforcement match.
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1000000",
    },
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`  wrote ${settingsPath} (contains the local proxy key — excluded via local git excludes)`);
  console.log("  use via: bin\\zcode-claude.cmd  (add --model glm-5.3-flash for the flash model)");
}

// ---------------------------------------------------------------- codex
function setupCodex() {
  console.log("== codex (isolated CODEX_HOME; ~/.codex is NOT modified) ==");
  const port = proxyPort();
  const home = join(GENERATED, "codex-home");
  mkdirSync(home, { recursive: true });
  const mcpEntry = ROOT.replace(/\\/g, "/");
  const toml = `# Generated by zcode-kit setup.mjs — isolated CODEX_HOME for the ZCode kit.
# Your normal ~/.codex is untouched; use bin\\zcode-codex.cmd to enter this setup.
model = "glm-5.3"
model_provider = "zcode"

[model_providers.zcode]
name = "ZCode (local proxy)"
base_url = "http://127.0.0.1:${port}/v1"
env_key = "ZCODE_PROXY_KEY"
wire_api = "responses"

[mcp_servers.zcode-harness]
command = "node"
args = ["${mcpEntry}/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
`;
  atomicWrite(join(home, "config.toml"), toml);
  console.log(`  wrote ${join(home, "config.toml")} (model provider + zcode-harness MCP)`);
  console.log("  use via: bin\\zcode-codex.cmd  (e.g. bin\\zcode-codex.cmd exec \"task\")");
}

// --------------------------------------------------------------------- mcp
function setupMcp() {
  console.log("== mcp: zcode-harness bridge ==");
  const serverJs = join(MCP_DIR, "dist", "index.js");
  if (!existsSync(serverJs)) {
    console.log(`  WARN: ${serverJs} missing — run setup again after bun install`);
    return;
  }
  // OMP: merge into ~/.omp/agent/mcp.json under a distinct name (an existing
  // "zcode" entry — e.g. a different bridge — is never touched).
  const ompMcp = join(HOME, ".omp", "agent", "mcp.json");
  if (existsSync(ompMcp)) {
    const raw = readFileSync(ompMcp, "utf8");
    let j;
    try {
      j = JSON.parse(raw);
    } catch (err) {
      console.log(`  WARN: mcp.json is not valid JSON (${err.message}) — skipped`);
      j = null;
    }
    if (j) {
      if (j.mcpServers?.["zcode-harness"]) {
        console.log('  omp: "zcode-harness" already registered');
      } else if (j.mcpServers?.zcode) {
        console.log('  omp: existing "zcode" MCP server found — registering alongside as "zcode-harness"');
      }
      if (!j.mcpServers?.["zcode-harness"]) {
        j.mcpServers = j.mcpServers ?? {};
        j.mcpServers["zcode-harness"] = {
          type: "stdio",
          command: "node",
          args: [serverJs, "--stdio"],
        };
        backup(ompMcp);
        atomicWrite(ompMcp, JSON.stringify(j, null, 2) + "\n");
        console.log("  omp: mcp.json updated (zcode-harness -> stdio bridge)");
      }
    }
  } else {
    console.log("  omp: no mcp.json found — skipped (see harnesses/README.md)");
  }
  // Claude Code: user-scope registration via its own CLI (additive; the user's
  // other MCP servers stay untouched).
  if (existsSync(join(HOME, ".claude"))) {
    try {
      execFileSync("claude", ["mcp", "get", "zcode-harness"], { stdio: "pipe" });
      console.log('  claude: "zcode-harness" already registered');
    } catch {
      try {
        execFileSync("claude", ["mcp", "add", "zcode-harness", "--scope", "user", "--", "node", serverJs, "--stdio"], { stdio: "pipe" });
        console.log('  claude: registered "zcode-harness" (user scope) — check with: claude mcp list');
      } catch (err) {
        console.log(`  WARN: claude mcp add failed (${err.message}). Manual command:`);
        console.log(`    claude mcp add zcode-harness --scope user -- node "${serverJs}" --stdio`);
      }
    }
  }
  console.log("  other MCP-capable harnesses: add a stdio server running");
  console.log(`    node "${serverJs}" --stdio   (see harnesses/README.md)`);
  console.log("  NOTE: model turns through the bridge require the ZCode Desktop app");
  console.log("  to be running (the desktop solves Z.AI captcha challenges).");
}

// ----------------------------------------------------------------- rollback
function rollback() {
  if (!existsSync(BACKUP_DIR)) return console.log("no backups found");
  const files = readdirSync(BACKUP_DIR).filter((f) => f.includes("__")).sort();
  if (files.length === 0) return console.log("no backups found");
  const latest = new Map();
  for (const f of files) {
    const [stamp, name] = f.split("__");
    latest.set(name, f);
  }
  for (const [name, file] of latest) {
    const candidates = {
      "models.yml": join(HOME, ".omp", "agent", "models.yml"),
      "config.yml": join(HOME, ".omp", "agent", "config.yml"),
      "mcp.json": join(HOME, ".omp", "agent", "mcp.json"),
      "config.yaml": CONFIG,
    };
    const target = candidates[name];
    if (target && existsSync(target)) {
      copyFileSync(join(BACKUP_DIR, file), target);
      console.log(`restored ${target} from ${file}`);
    }
  }
  console.log('claude MCP removal (if registered): claude mcp remove zcode-harness --scope user');
}

// --------------------------------------------------------------------- main
const mode = process.argv[2] ?? "install";
if (mode === "--rollback" || mode === "rollback") {
  rollback();
} else {
  bootstrap();
  if (want("omp")) setupOmp();
  if (want("claude-code")) setupClaude();
  if (want("codex")) setupCodex();
  if (want("mcp")) setupMcp();
  console.log("\ndone. Quick checks:");
  console.log(`  node proxy/zcode-proxy-manager.mjs doctor`);
  console.log(`  omp --model zcode/glm-5.3-flash --thinking low -p "hi"      (if OMP)`);
  console.log(`  bin\\zcode-claude.cmd -p "hi" --model glm-5.3-flash          (if Claude Code)`);
  console.log(`  bin\\zcode-codex.cmd exec "say hi" -m glm-5.3-flash          (if Codex)`);
}
