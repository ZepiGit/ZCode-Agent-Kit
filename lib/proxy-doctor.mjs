// The manager's doctor. It runs the manager's checks over the lifecycle module's
// proofs and records and returns them as a check record; it prints nothing.
// Two renderers read the record: the manager CLI's own `doctor` (the legacy
// off-TTY grammar, byte for byte) and `zcode-kit doctor`, which no longer
// parses the manager's text.
//
//   managerDoctor({ root, home, env, lifecycle }) → doctor record
//
// A doctor record is `{ intent: "doctor", code, outcome, checks }`:
//   code     the manager CLI's `doctor` exit code: 0 when no check failed, 1 otherwise;
//   outcome  "ok" or "failed";
//   checks   `{ name, ok, detail }` in report order, where ok is true (PASS),
//            false (FAIL) or null (SKIP, never counted as a failure).
// `env` is the environment the checks read (the env overrides, an explicit
// credential store, the Bun lookup); it defaults to this process's. Pass a
// `lifecycle` to reuse one (the manager CLI does); otherwise one is created
// for `root`/`home`. Unexpected errors throw, as the lifecycle intents do.
//
// No component is a hard requirement: doctor checks only what is installed on
// this machine and separates auth validity from token age. This module is not
// on the preflight's import path (it reads the harness choices).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnoseQuota, quotaAuthValid } from "../cli/quota-diagnostics.mjs";
import { readHarnessChoices } from "../cli/harness-consent.mjs";
import { resolveBun } from "./process.mjs";
import { createLifecycle } from "./proxy-lifecycle.mjs";
import { proxyEnv } from "./proxy-env.mjs";

export async function managerDoctor({ root, home, env = process.env, lifecycle, bunResolver } = {}) {
  // Bun is looked up in the same environment the checks read.
  const lc = lifecycle ?? createLifecycle({ root, home, bunResolver: bunResolver ?? (() => resolveBun(lc.ROOT, env)) });
  const { ctx, HOME, PROXY_SRC, CONFIG, KEY_FILE, healthIdentify, readKey, loadPort, findBun } = lc;
  const OMP_AGENT = HOME ? HOME + "/.omp/agent" : null;
  const MCP_DIR = join(lc.ROOT, "mcp", "zcode-harness-mcp");
  const GENERATED = ctx.generated;
  const base = () => `http://127.0.0.1:${loadPort()}`;

  function ompHasZcode() {
    try {
      const yml = readFileSync(OMP_AGENT + "/models.yml", "utf8");
      return /^  zcode:\s*$/m.test(yml);
    } catch {
      return false;
    }
  }

  /** Proves Bun can actually be started (a PATH hit alone is not startable). */
  function bunStartable() {
    let bun;
    try {
      bun = findBun();
    } catch (err) {
      return { ok: false, detail: err.message };
    }
    const r = spawnSync(bun, ["--version"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10000, windowsHide: true });
    if (r.error || r.status !== 0) return { ok: false, detail: `${bun} cannot be started (${r.error?.message ?? `exit ${r.status}`})` };
    return { ok: true, detail: `${bun} (${(r.stdout ?? "").trim()})` };
  }

  /**
   * Proves the credential store is decryptable by THIS runtime, offline: the
   * proxy's own store module is loaded in a child that prints only a boolean.
   */
  function credentialStoreState(credentials) {
    if (!existsSync(credentials)) return { ok: false, detail: "no credential store — run: zcode-kit auth login" };
    let bun;
    try {
      bun = findBun();
    } catch {
      return { ok: null, detail: "store present; decryptability not checked (Bun unavailable)" };
    }
    const probe = 'import { loadCredential } from "./src/auth/store.ts"; const c = await loadCredential({ migrate: false }); console.log(c && typeof c.apiKey === "string" && c.apiKey.length > 0 ? "DECRYPTABLE" : "UNREADABLE");';
    const r = spawnSync(bun, ["-e", probe], {
      cwd: PROXY_SRC,
      env: { ...proxyEnv(ctx, env), ZCODE_PROXY_CREDENTIALS_PATH: credentials },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return { ok: null, detail: "store present; decryptability probe failed to run" };
    const decryptable = (r.stdout ?? "").trim().split("\n").pop() === "DECRYPTABLE";
    return { ok: decryptable, detail: decryptable ? "present and decryptable on this machine" : "present but NOT decryptable here — re-run: zcode-kit auth login" };
  }

  /**
   * Real auth validity from the account endpoint, separated from token age:
   * HTTP 200 → valid; 401/403 → invalid; quota-exhausted envelope → valid
   * account, exhausted quota (reported, not a failure).
   */
  async function authState() {
    try {
      const key = readKey();
      const q = await fetch(`${base()}/quota`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      const j = await q.json().catch(() => null);
      const diagnostic = diagnoseQuota(q.status, j);
      const valid = quotaAuthValid(q.status, j, diagnostic);
      const issuedAt = j?.jwt?.issuedAt;
      return {
        valid,
        detail: diagnostic.cause === "healthy" ? "valid" : diagnostic.detail,
        ageHours: Number.isFinite(issuedAt) ? (Date.now() / 1000 - issuedAt) / 3600 : null,
      };
    } catch {
      return { valid: false, detail: "auth check unreachable; quota authentication not proven", ageHours: null };
    }
  }

  const checks = [];
  // ok: true|false|null (null = skip, not counted as failure)
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const bunState = bunStartable();
  add("bun available", bunState.ok, bunState.detail);
  add("config exists", existsSync(CONFIG), CONFIG);
  add("key file exists", existsSync(KEY_FILE), KEY_FILE);
  add("proxy source installed", existsSync(join(PROXY_SRC, "node_modules")), join(PROXY_SRC, "node_modules"));
  const overrides = Object.keys(env).filter((k) => /^ZCODE_(?:PROXY_PORT|PROXY_API_KEY|CLAIM_|ASYNC_|DUMP_)/.test(k));
  if (overrides.length) add("proxy env overrides", false, `ignored by the kit-managed proxy (unset them): ${overrides.join(", ")}`);
  if (env.ZCODE_PROXY_CREDENTIALS_PATH || HOME) {
    const credentials = env.ZCODE_PROXY_CREDENTIALS_PATH || join(HOME, ".zcode-proxy", "credentials.json");
    const cred = credentialStoreState(credentials);
    add("credentials store", cred.ok, `${env.ZCODE_PROXY_CREDENTIALS_PATH ? "ZCODE_PROXY_CREDENTIALS_PATH (explicit store)" : "~/.zcode-proxy/credentials.json"}: ${cred.detail}`);
  } else {
    add("credentials store", null, "USERPROFILE/HOME not set — skipped");
  }

  // OMP checks only apply when OMP is actually installed here; a Codex-only
  // user must not get FAIL lines about OMP.
  const ompInstalled = !!OMP_AGENT && existsSync(join(OMP_AGENT, "models.yml"));
  // Only a consented or kit-managed OMP integration is checked: a declined
  // or never-answered harness is a choice, not a failed check.
  const ompChoice = readHarnessChoices({ generated: GENERATED }).harnesses.omp?.decision;
  const ompManaged = (() => {
    try { return readFileSync(join(OMP_AGENT, "models.yml"), "utf8").includes("# >>> zcode-kit (managed block)"); } catch { return false; }
  })();
  if (ompInstalled && (ompChoice === "configured" || (ompChoice !== "skipped" && ompManaged))) {
    add("omp provider registered", ompHasZcode(), "zcode block in ~/.omp/agent/models.yml");
    add("extension installed", existsSync(OMP_AGENT + "/extensions/zcode-proxy-autostart.ts"), "~/.omp/agent/extensions/zcode-proxy-autostart.ts");
  } else if (ompInstalled) {
    add("omp integration", null, ompChoice === "skipped" ? "not configured (your choice) — zcode-kit integrate omp to change" : "not configured (no consent yet) — answer y in zcode-kit setup or run zcode-kit integrate omp");
  } else {
    add("omp integration", null, "OMP not installed — skipped");
  }
  if (existsSync(MCP_DIR)) {
    add("mcp bridge installed", existsSync(join(MCP_DIR, "dist", "index.js")), join(MCP_DIR, "dist", "index.js"));
    add("mcp bridge deps", existsSync(join(MCP_DIR, "node_modules")), join(MCP_DIR, "node_modules"));
  }
  if (existsSync(join(GENERATED, "claude-zcode-settings.json"))) {
    add("claude adapter artifact", true, "generated/claude-zcode-settings.json");
  }
  if (existsSync(join(GENERATED, "codex-home", "config.toml"))) {
    add("codex adapter artifact", true, "generated/codex-home/config.toml");
  }

  if (existsSync(CONFIG)) {
    const state = await healthIdentify();
    add("proxy reachable + identity", state === "ours", `health=${state}`);
    if (state === "ours") {
      const q = await authState();
      add("account auth valid", q.valid, q.detail);
      if (q.ageHours !== null && q.ageHours !== undefined) {
        add("start-plan JWT age (info)", true, `${q.ageHours.toFixed(1)}h since issue — age is informational, validity is the auth check above`);
      }
    }
  } else {
    add("proxy reachable + identity", null, "no config — skipped");
  }

  const failed = checks.some((c) => c.ok === false);
  return { intent: "doctor", code: failed ? 1 : 0, outcome: failed ? "failed" : "ok", checks };
}
