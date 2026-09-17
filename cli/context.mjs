// Shared CLI context: paths, bootstrap (migrated from setup.mjs unchanged in
// behavior, with the audit fixes).
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, renameSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { resolveBun } from "../lib/process.mjs";
import { proxyEnv } from "../lib/proxy-env.mjs";
import { stateDirectory, ensureState } from "../lib/state.mjs";
import { commitFile } from "../lib/edit.mjs";

export function kitRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function homeDir() {
  const home = (process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
  if (!home) throw new Error("neither USERPROFILE nor HOME is set — cannot locate user config directories");
  return home;
}

export function createCtx(root = kitRoot(), home = homeDir()) {
  const stateDir = stateDirectory(root, home);
  const ctx = {
    root,
    home,
    stateDir,
    logDir: join(stateDir, "logs"),
    keyFile: join(stateDir, ".proxykey"),
    config: join(stateDir, "proxy", "config.yaml"),
    configExample: join(root, "proxy", "config.example.yaml"),
    proxySrc: join(root, "zcode-proxy-src"),
    mcpDir: join(root, "mcp", "zcode-harness-mcp"),
    generated: join(stateDir, "generated"),
    backupDir: join(stateDir, "backups"),
    port() {
      if (ctx.dryRun && !existsSync(ctx.config)) return 8457;
      return Number((readFileSync(ctx.config, "utf8").match(/^  port:\s*(\d+)/m) ?? [])[1] ?? 8457);
    },
    key() {
      if (ctx.dryRun && !existsSync(ctx.keyFile)) return "GENERATE_ME";
      return readFileSync(ctx.keyFile, "utf8").trim();
    },
  };
  return ctx;
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Create the kit's runtime files (.proxykey, proxy/config.yaml) if missing —
 * race-safe (exclusive create), so parallel test workers or parallel setups
 * converge on one consistent key/config pair. A fresh checkout (CI) starts
 * without both; nothing else may depend on them existing beforehand.
 */
export function ensureRuntimeFiles(ctx) {
  ensureState(ctx);
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(ctx.config), { recursive: true, mode: 0o700 });
  if (!existsSync(ctx.keyFile)) {
    try {
      const fd = openSync(ctx.keyFile, "wx", 0o600);
      writeFileSync(fd, randomBytes(32).toString("base64url") + "\n");
      closeSync(fd);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  if (!existsSync(ctx.config)) {
    const example = readFileSync(ctx.configExample, "utf8");
    const filled = example.replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${ctx.key()}"`);
    if (/proxyApiKey: "GENERATE_ME"/.test(filled)) throw new Error("config template key substitution failed");
    try {
      const fd = openSync(ctx.config, "wx", 0o600);
      writeFileSync(fd, filled);
      closeSync(fd);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}

// ------------------------------------------------------------------ bootstrap
const GIT_EXCLUDE_BLOCK = `# >>> zcode-kit local excludes (managed by setup) — local-only, never pushed
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

function ensureLocalGitExclude(ctx) {
  const gitDir = join(ctx.root, ".git");
  if (!existsSync(gitDir)) return;
  const infoDir = join(gitDir, "info");
  const excludeFile = join(infoDir, "exclude");
  mkdirSync(infoDir, { recursive: true });
  const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : "";
  if (existing.includes("zcode-kit local excludes")) return;
  writeFileSync(excludeFile, existing.replace(/\n*$/, "\n") + "\n" + GIT_EXCLUDE_BLOCK);
  console.log("  local git excludes installed (.git/info/exclude — never pushed)");
}

function ensureDeps(ctx, label, dir) {
  if (process.env.ZCODE_KIT_SKIP_DEPS === "1") {
    console.log(`  ${label} dependencies: check skipped (ZCODE_KIT_SKIP_DEPS=1)`);
    return;
  }
  const marker = join(dir, "node_modules", ".zcode-kit-installed");
  const lockfile = existsSync(join(dir, "bun.lock")) ? join(dir, "bun.lock") : null;
  const lockHash = lockfile ? sha256File(lockfile) : null;
  if (existsSync(marker)) {
    try {
      const prev = JSON.parse(readFileSync(marker, "utf8"));
      if (prev.lockHash === lockHash && prev.tool === "bun") {
        console.log(`  ${label} dependencies present and current`);
        return;
      }
    } catch {}
  }
  console.log(`  installing ${label} dependencies (bun, frozen lockfile)...`);
  try {
    const args = lockfile ? ["install", "--frozen-lockfile"] : ["install"];
    execFileSync(resolveBun(ctx.root), args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const detail = (err.stderr ?? err.stdout ?? err.message ?? "").toString().split("\n").slice(0, 6).join("\n    ");
    throw new Error(
      `bun install failed for ${label} — the kit is only half-installed and CANNOT be used.\n` +
        `    Fix manually and re-run setup:\n      cd ${dir} && bun install\n    Detail:\n    ${detail}`,
    );
  }
  if (!existsSync(join(dir, "node_modules"))) {
    throw new Error(`bun install reported success for ${label} but node_modules is missing — refusing to continue.`);
  }
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(marker, JSON.stringify({ tool: "bun", lockHash, installedAt: new Date().toISOString() }) + "\n");
  console.log(`  ${label} dependencies installed`);
}

/** Bootstrap the kit's own runtime files. Idempotent; transaction-aware via ctx.tx. */
export function bootstrap(ctx) {
  console.log("== bootstrap ==");
  ensureState(ctx);
  mkdirSync(ctx.logDir, { recursive: true, mode: 0o700 });
  mkdirSync(ctx.generated, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(ctx.config), { recursive: true, mode: 0o700 });
  ensureLocalGitExclude(ctx);

  if (!existsSync(ctx.keyFile)) {
    try {
      const fd = openSync(ctx.keyFile, "wx", 0o600);
      writeFileSync(fd, randomBytes(32).toString("base64url") + "\n");
      closeSync(fd);
      console.log("  generated local proxy key -> .proxykey (user-local secret, never committed)");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  if (!existsSync(ctx.config)) {
    const example = readFileSync(ctx.configExample, "utf8");
    const filled = example.replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${ctx.key()}"`);
    if (/proxyApiKey: "GENERATE_ME"/.test(filled)) throw new Error("config template key substitution failed");
    commitFile(ctx, ctx.tx ?? { touch() {} }, ctx.config, filled);
    console.log("  wrote proxy/config.yaml from example");
  } else {
    console.log("  proxy/config.yaml already present — left untouched");
  }

  ensureDeps(ctx, "proxy", ctx.proxySrc);
  ensureDeps(ctx, "mcp bridge", ctx.mcpDir);

  const credStore = process.env.ZCODE_PROXY_CREDENTIALS_PATH || join(ctx.home, ".zcode-proxy", "credentials.json");
  if (!existsSync(credStore)) {
    const desktopCfg = join(ctx.home, ".zcode", "v2", "config.json");
    if (existsSync(desktopCfg)) {
      console.log("  importing ZCode Desktop credential (start-plan)...");
      try {
        execFileSync(resolveBun(ctx.root), ["run", "src/index.ts", "auth", "login", "zai", "--import"], {
          cwd: ctx.proxySrc,
          env: { ...proxyEnv(ctx), ZCODE_PROXY_CREDENTIALS_PATH: credStore },
          timeout: 15000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        console.log("  credential imported from the existing ZCode Desktop login");
      } catch {
        console.log("  WARN: import failed. Manual options:");
        console.log(`    cd ${ctx.proxySrc}`);
        console.log(`    ZCODE_PROXY_CONFIG="${ctx.config}" bun run src/index.ts auth login zai --import`);
      }
    } else {
      console.log("  MANUAL STEP REQUIRED (once): log in with your ZCode account:");
      console.log(`    cd ${ctx.proxySrc}`);
      console.log(`    ZCODE_PROXY_CONFIG="${ctx.config}" bun run src/index.ts auth login zai`);
    }
  } else {
    console.log("  proxy credentials present");
  }
}


