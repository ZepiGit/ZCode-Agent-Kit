// An isolated kit instance for the memory loop. Every path the kit, the
// manager and the proxy resolve is redirected away from the user's install:
//
//   state dir   ZCODE_KIT_STATE_DIR (lib/state.mjs: explicit absolute override)
//                 → .proxykey, proxy/config.yaml, logs/ (pid, lock, proxy.log), generated/
//   config      <state>/proxy/config.yaml (cli/context.mjs); the manager passes it
//                 to the proxy as ZCODE_PROXY_CONFIG (lib/proxy-env.mjs)
//   port        `  port:` line of that config (manager loadPort / ctx.port); the
//                 proxy reads server.port from the same file. ZCODE_PROXY_PORT is
//                 stripped by proxyEnv, so the file is the only source.
//   HOME        isolated: credentials default (~/.zcode-proxy), CDN cache
//                 (~/.zcode-captcha-cdn-cache), OMP dirs, adapters
//   credential  ZCODE_PROXY_CREDENTIALS_PATH + ZCODE_PROXY_CREDENTIAL_SECRET
//                 (both survive proxyEnv) → a generated fixture, never a real login
//   upstream    providers.zai.{anthropic,openai}Base → the soak mock on loopback;
//                 claim, async, endpoint routing, client signing and MCP tools off,
//                 plan coding-plan (start-plan would warm the captcha pool against
//                 the real CDN — the captcha path is measured in-process in S2).
//
// Guards: refuses the default port 8457 and the UX agent's 18458, refuses to run
// with HOME equal to the real user home, and refuses without ZCODE_OVERHAUL_RUN=1
// unless ZCODE_MEMLOOP_ALLOW=1 (CI) is set.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FORBIDDEN_PORTS = new Set([8457, 18458]);

export function bunPath(env = process.env) {
  if (env.ZCODE_KIT_BUN) return env.ZCODE_KIT_BUN;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], { encoding: "utf8" });
  const found = (r.stdout ?? "").trim().split(/\r?\n/)[0];
  if (!found) throw new Error("bun not found: put it on PATH or set ZCODE_KIT_BUN");
  return found;
}

/**
 * The run's own bun executable (Windows sampler run token, spec §1): a hard
 * link, or a copy across volumes, of the bun in use, under the run directory
 * whose name is the run id. Every Bun process the run starts through
 * ZCODE_KIT_BUN (the manager's proxy, the S2 body) then carries the id in its
 * executable path, also after its parent exited.
 */
export function prepareRunBun(runDir, env = process.env) {
  const src = bunPath(env);
  const dir = join(runDir, "bun");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, process.platform === "win32" ? "bun.exe" : "bun");
  try { linkSync(src, path); } catch { copyFileSync(src, path); }
  return { path, remove() { try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

export function assertSafeEnvironment(port) {
  if (!Number.isInteger(port) || port < 18457 || port > 65000 || FORBIDDEN_PORTS.has(port)) {
    throw new Error(`memory loop port ${port} refused (allowed: 18457..65000 except ${[...FORBIDDEN_PORTS].join(", ")})`);
  }
  assertSafeRun();
}

/** Every scenario, with or without a proxy: only inside a capped run with an isolated HOME. */
export function assertSafeRun() {
  if (process.env.ZCODE_OVERHAUL_RUN !== "1" && process.env.ZCODE_MEMLOOP_ALLOW !== "1") {
    throw new Error("memory loop refuses to run outside a capped run (set ZCODE_OVERHAUL_RUN=1 via run-capped.sh, or ZCODE_MEMLOOP_ALLOW=1 in CI)");
  }
  const realHome = userInfo().homedir;
  if (process.env.HOME && resolve(process.env.HOME) === resolve(realHome) && process.env.ZCODE_MEMLOOP_ALLOW !== "1") {
    throw new Error(`memory loop refuses HOME=${realHome}: run it with an isolated HOME`);
  }
}

/** Fill the shipped template; every network-facing feature points at loopback or is off. */
export function isolatedConfig({ port, key, mockUrl, template = readFileSync(join(KIT_ROOT, "proxy", "config.example.yaml"), "utf8") }) {
  // Line-ending agnostic: a Windows checkout (core.autocrlf) has the template
  // with CRLF, and the contract below matches LF (CI run 42246379763). The
  // config is written with LF, which the proxy's YAML reader takes on every OS.
  let text = template
    .replace(/\r\n/g, "\n")
    .replace(/^  port: 8457$/m, `  port: ${port}`)
    .replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${key}"`)
    .replace(/^plan: start-plan$/m, "plan: coding-plan")
    .replace(/anthropicBase: "https:\/\/api\.z\.ai\/api\/anthropic"/, `anthropicBase: "${mockUrl}/api/anthropic"`)
    .replace(/openaiBase: "https:\/\/api\.z\.ai\/api\/coding\/paas\/v4"/, `openaiBase: "${mockUrl}/api/coding/paas/v4"`)
    .replace(/^claim:\n  enabled: true\n  auto: true/m, "claim:\n  enabled: false\n  auto: false")
    .replace(/^endpointRouting:\n  enabled: true/m, "endpointRouting:\n  enabled: false");
  text += "mcp:\n  enabled: false\n";
  for (const must of [`  port: ${port}`, `proxyApiKey: "${key}"`, "plan: coding-plan", `${mockUrl}/api/anthropic`, "claim:\n  enabled: false", "endpointRouting:\n  enabled: false"]) {
    if (!text.includes(must)) throw new Error(`config template contract changed: missing ${JSON.stringify(must)}`);
  }
  if (/https:\/\/api\.z\.ai\/api\/anthropic/.test(text.split("bigmodel:")[0])) throw new Error("zai upstream still points at the real service");
  return text;
}

/**
 * Create the isolated instance on disk. Returns paths, the env every kit
 * command must run with, and helpers. Nothing is started yet.
 */
export function createIsolatedKit({ baseDir, port = 18457, mockUrl, marker, extraEnv = {} }) {
  assertSafeEnvironment(port);
  mkdirSync(baseDir, { recursive: true });
  const dir = mkdtempSync(join(baseDir, "kit-"));
  const home = join(dir, "home");
  const stateDir = join(dir, "state");
  for (const d of [home, join(home, ".config"), join(home, ".local", "share"), join(home, ".local", "state"), join(home, ".cache"), join(home, "tmp"), join(stateDir, "proxy"), join(stateDir, "logs"), join(stateDir, "generated")]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  const key = randomBytes(24).toString("base64url");
  writeFileSync(join(stateDir, ".proxykey"), key + "\n", { mode: 0o600 });
  writeFileSync(join(stateDir, "proxy", "config.yaml"), isolatedConfig({ port, key, mockUrl }), { mode: 0o600 });
  const credentials = join(stateDir, "fixture-credentials.json");
  const bun = bunPath();
  const env = {
    ...process.env,
    HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"), XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: join(home, "tmp"),
    ZCODE_KIT_STATE_DIR: stateDir,
    ZCODE_KIT_BUN: bun,
    ZCODE_KIT_SKIP_SMOKE: "1",
    ZCODE_PROXY_CREDENTIALS_PATH: credentials,
    ZCODE_PROXY_CREDENTIAL_SECRET: randomBytes(24).toString("hex"),
    ZCODE_PROXY_ACCOUNTS_PATH: join(stateDir, "fixture-accounts.json"),
    // Keep retry ladders short so error scenarios finish; values only scale delays.
    ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS: "5",
    ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS: "5,5",
    ZCODE_MEMLOOP_RUN: marker.split("=")[1],
    ...extraEnv,
  };
  for (const k of Object.keys(env)) if (/^(?:https?|all|no)_proxy$/i.test(k)) delete env[k];
  // Fixture credential written by the proxy's own store module (format-correct,
  // encrypted with the per-run secret). Synthetic values only.
  const probe = `import { saveCredential, getStorePath } from ${JSON.stringify(join(KIT_ROOT, "zcode-proxy-src", "src", "auth", "store.ts"))};
await saveCredential({ apiKey: "fixture-key-" + crypto.randomUUID(), secret: "fixture-secret-" + crypto.randomUUID(), provider: "zai" });
console.log(getStorePath());`;
  const r = spawnSync(bun, ["-e", probe], { env, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0 || r.stdout.trim() !== credentials) throw new Error(`fixture credential setup failed: ${(r.stderr || r.stdout).slice(0, 400)}`);

  const kit = {
    dir, home, stateDir, key, port, env, bun,
    config: join(stateDir, "proxy", "config.yaml"),
    logDir: join(stateDir, "logs"),
    base: `http://127.0.0.1:${port}`,
    /** Run the real manager CLI (start|stop|restart|status|respawn …). */
    manager(args, { timeoutMs = 120_000 } = {}) {
      return run(process.execPath, [join(KIT_ROOT, "proxy", "zcode-proxy-manager.mjs"), ...args], { env, timeoutMs });
    },
    /** The OMP autostart preflight exactly as the extension runs it. */
    preflight({ timeoutMs = 120_000 } = {}) {
      return run(process.execPath, [join(KIT_ROOT, "cli", "heal.mjs"), "--diagnostic-code"], { env, timeoutMs, cwd: KIT_ROOT });
    },
    /** `zcode-kit run <harness>` through the real CLI entry. */
    launch(harness, args = [], { timeoutMs = 120_000, extraEnv: more = {} } = {}) {
      return run(process.execPath, [join(KIT_ROOT, "cli", "zcode-kit.mjs"), "run", harness, ...args], { env: { ...env, ...more }, timeoutMs, cwd: dir });
    },
    async health(timeoutMs = 2000) {
      try {
        const res = await fetch(`${kit.base}/health`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    },
    pidRecord() {
      try { return JSON.parse(readFileSync(join(stateDir, "logs", "proxy.pid"), "utf8")); } catch { return null; }
    },
    exists: (p) => existsSync(join(stateDir, p)),
  };
  return kit;
}

/** Spawn and collect (bounded output). */
export function run(cmd, args, { env, timeoutMs = 120_000, cwd } = {}) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (b) => { out = (out + b).slice(-64 * 1024); });
    child.stderr.on("data", (b) => { err = (err + b).slice(-64 * 1024); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => { clearTimeout(timer); resolveRun({ code, signal, out, err, ms: Date.now() - t0, pid: child.pid }); });
    child.on("error", (e) => { clearTimeout(timer); resolveRun({ code: null, signal: null, out, err: String(e), ms: Date.now() - t0, pid: child.pid }); });
  });
}

/** Start the soak mock as its own process (its RSS is reported, never counted as kit footprint). */
export async function startMock(env) {
  const child = spawn(process.execPath, [join(KIT_ROOT, "tests", "memory", "lib", "soak-mock.mjs")], { env: { ...env, MOCK_PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((resolveMock, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("soak mock did not start")), 10_000);
    child.stdout.on("data", (b) => {
      buf += b;
      const m = buf.match(/MOCK_READY (\d+)/);
      if (m) { clearTimeout(timer); resolveMock(Number(m[1])); }
    });
    child.on("exit", (code) => reject(new Error(`soak mock exited ${code}`)));
  });
  return {
    port, url: `http://127.0.0.1:${port}`, pid: child.pid,
    async stats() { try { return await (await fetch(`http://127.0.0.1:${port}/__stats`)).json(); } catch { return null; } },
    stop() { return new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 3000).unref(); }); },
  };
}
