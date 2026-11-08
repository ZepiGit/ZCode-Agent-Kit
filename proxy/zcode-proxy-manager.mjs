#!/usr/bin/env node
// zcode-proxy service manager (user-local, no admin rights): the manager CLI
// and the respawn hook target (ZCODE_KIT_RESPAWN_MANAGER, frozen path).
//
// Commands: start | stop | restart | status | doctor | logs [n]
//           | respawn <pid> [--reason R] | help
//
// The lifecycle itself (start, stop, restart, the start lock, the pid record,
// the identity and hung-own proofs, the kill guard, respawn requests and the
// restart budget, with their safety rules) lives in lib/proxy-lifecycle.mjs,
// whose intents print nothing and return outcome records. This file renders
// them: `createManager` keeps its members (start/stop/restart/respawn return
// the exit code and print the narration lines as they happen), and status,
// doctor, logs and the connection details are the manager's own reports.
//   - No component is a hard requirement: doctor checks only what is
//     installed on this machine and separates auth validity from token age.
import { spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, openSync, closeSync, readSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diagnoseQuota, quotaAuthValid } from "../cli/quota-diagnostics.mjs";
import { proxyEnv } from "../lib/proxy-env.mjs";
import { createLifecycle } from "../lib/proxy-lifecycle.mjs";
import { configuredModelIds, configuredServer, connectionDetailsLines, connectionDetailsObject, shouldRevealKey } from "../cli/connection-details.mjs";
import { readHarnessChoices } from "../cli/harness-consent.mjs";

// ------------------------------------------------------------------ factory
const MANAGER_PATH = fileURLToPath(import.meta.url);

export function createManager({
  root, home, processStartMsImpl, processCommandLineImpl, bunResolver,
  // Hung-own proof and respawn timings (contract defaults; tests shorten them).
  startupGraceMs = 60_000, hungProbeCount = 3, hungProbeIntervalMs = 5_000, hungProbeTimeoutMs = 5_000,
  respawnWaitMs = 30_000,
} = {}) {
  const lifecycle = createLifecycle({
    root, home, processStartMsImpl, processCommandLineImpl, bunResolver, managerPath: MANAGER_PATH,
    startupGraceMs, hungProbeCount, hungProbeIntervalMs, hungProbeTimeoutMs, respawnWaitMs,
  });
  const { ctx, HOME, PROXY_SRC, CONFIG, KEY_FILE, LOG_FILE, PID_FILE, LOG_DIR, RESPAWN_FILE } = lifecycle;
  const { healthIdentify, readPidFile, pidAlive, readKey, loadPort, redact, findBun } = lifecycle;
  const OMP_AGENT = HOME ? HOME + "/.omp/agent" : null;
  const MCP_DIR = join(lifecycle.ROOT, "mcp", "zcode-harness-mcp");
  const GENERATED = ctx.generated;
  const base = () => `http://127.0.0.1:${loadPort()}`;

  // The manager prints each narration line the moment the intent produces it
  // (stdout, as console.log always did).
  const print = (line) => console.log(line);
  /** Exit code of an ensure-running record; a lock it may not take throws, as start() always did. */
  function exitOf(record) {
    if (record.outcome === "start-lock-unavailable") throw new Error(record.error);
    return record.code;
  }

  // ---------------------------------------------------------- lifecycle
  const start = async ({ waitMs, onlyIfRecord } = {}) =>
    exitOf(await lifecycle.ensureRunning({ ...(waitMs === undefined ? {} : { waitMs }), onlyIfRecord: onlyIfRecord ?? null, observe: print }));
  const stop = async () => (await lifecycle.stop({ observe: print })).code;
  const restart = async () => exitOf(await lifecycle.restart({ observe: print }));
  const respawn = async (pid, reason) => exitOf(await lifecycle.requestRespawn(pid, reason, { observe: print }));
  const readState = () => lifecycle.readState();
  const killOwned = (pid, guard = null) => lifecycle.killOwned(pid, guard, { observe: print });
  const logEvent = (level, message, fields) => lifecycle.logEvent(level, message, fields, { observe: print });

  // ----------------------------------------------------------------- status
  async function status({ json = false } = {}) {
    if (json) return statusJson();
    const { pidRecord: pidInfo, identity: state, alive } = await readState();
    console.log(`port:      ${portOrNull()}`);
    console.log(`pid file:  ${pidInfo ? `${pidInfo.pid} (started ${pidInfo.startedIso ?? "unknown"})` : "none"}`);
    console.log(`health:    ${state}`);
    if (state === "down" && pidInfo && alive) {
      console.log(`  pid ${pidInfo.pid} is alive but not answering — next: zcode-kit proxy restart, then zcode-kit doctor`);
    }
    if (state === "ours") {
      for (const line of detailLines(await healthDetails())) console.log(line);
      const key = readKey();
      try {
        const q = await fetch(`${base()}/quota`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
        const j = await q.json();
        if (q.ok) {
          for (const b of j.balances ?? []) {
            console.log(`  quota: ${b.showName} ${b.remainingUnits}/${b.totalUnits} ${b.unitType} (expires ${new Date(b.expiresAt * 1000).toISOString()})`);
          }
        } else {
          console.log(`  quota: HTTP ${q.status}`);
        }
      } catch (err) {
        console.log(`  quota: unavailable (${err.message})`);
      }
      console.log("");
      await printConnectionDetails("running");
    } else if (state === "down") {
      // Not running: configured values are still useful for manual client
      // setup, but they are labelled as unverified — never as "running".
      console.log("");
      await printConnectionDetails("configured");
    } else if (state === "foreign") {
      console.log(`  connection details withheld: port ${portOrNull()} is answered by a service that is not this kit's proxy`);
    } else if (state === "nokey") {
      console.log(`  connection details unavailable: ${KEY_FILE} missing — run setup first`);
    }
    return state === "ours" ? 0 : 1;
  }

  /**
   * `status --json`: one object on stdout and nothing else. Connection
   * details only for the own proxy (running) or a stopped one (configured);
   * a foreign listener or a missing key yields none. The key itself is never
   * part of the JSON. Exit code as the text status: 0 only when ours.
   */
  async function statusJson() {
    const { pidRecord: pidInfo, identity: state, alive } = await readState();
    const out = {
      schemaVersion: 1,
      port: portOrNull(),
      pid: pidInfo ? { pid: pidInfo.pid, startedAt: pidInfo.startedIso ?? null, alive } : null,
      health: state,
      connection: null,
      quota: null,
    };
    if (state === "ours" || state === "down") {
      let source = state === "ours" ? "running" : "configured";
      // Re-proven right before reporting, like the text output.
      if (source === "running" && await healthIdentify(2500) !== "ours") source = "configured";
      try {
        out.connection = connectionDetailsObject(await connectionFacts(source));
      } catch (err) {
        out.connection = null;
        out.connectionError = String(err?.message ?? err).slice(0, 200);
      }
    }
    if (state === "ours") {
      try {
        const q = await fetch(`${base()}/quota`, { headers: { Authorization: `Bearer ${readKey()}` }, signal: AbortSignal.timeout(8000) });
        const j = await q.json().catch(() => null);
        out.quota = q.ok && Array.isArray(j?.balances)
          ? j.balances.map((b) => ({ name: String(b.showName ?? ""), remaining: b.remainingUnits ?? null, total: b.totalUnits ?? null, unit: b.unitType ?? null, expiresAt: Number.isFinite(b.expiresAt) ? new Date(b.expiresAt * 1000).toISOString() : null }))
          : { error: `HTTP ${q.status}` };
      } catch {
        out.quota = { error: "unavailable" };
      }
    }
    console.log(JSON.stringify(out, null, 2));
    return state === "ours" ? 0 : 1;
  }

  /** Port, models (live list when the own proxy answers) and listener facts; never the key. */
  async function connectionFacts(source) {
    let models = configuredModelIds(CONFIG);
    let modelsSource = "config";
    if (source === "running") {
      try {
        const res = await fetch(`${base()}/v1/models`, { headers: { Authorization: `Bearer ${readKey()}` }, signal: AbortSignal.timeout(5000) });
        const j = await res.json();
        const ids = (j?.data ?? []).map((m) => m?.id).filter((id) => typeof id === "string" && id.length > 0);
        if (res.ok && ids.length) { models = ids; modelsSource = "live"; }
      } catch {
        // config list stays, labelled as such
      }
    }
    const server = configuredServer(CONFIG);
    return { port: loadPort(), models, modelsSource, source, host: server.host, responsesEnabled: server.responsesEnabled };
  }

  /**
   * Connection details for manual client setup. `source` "running" is only
   * passed by callers that verified /health answered as ours; model ids then
   * come from the live /v1/models list, otherwise from the config file. The
   * key is read, never generated or rotated here.
   */
  async function connectionDetails(source) {
    const facts = await connectionFacts(source);
    return connectionDetailsLines({ ...facts, key: readKey(), reveal: shouldRevealKey() });
  }

  async function printConnectionDetails(source) {
    let lines;
    try {
      // "running" is re-proven right before printing: a proxy that stopped
      // between the start/status check and now must not be shown as verified.
      if (source === "running" && await healthIdentify(2500) !== "ours") source = "configured";
      lines = await connectionDetails(source);
    } catch (err) {
      console.log(`  connection details unavailable: ${err.message}`);
      return;
    }
    for (const line of lines) console.log(line);
  }

  /** /health `details` (newer proxies only); null when absent or unreadable. */
  async function healthDetails() {
    try {
      const res = await fetch(`${base()}/health`, { headers: { Authorization: `Bearer ${readKey()}` }, signal: AbortSignal.timeout(5000) });
      const j = await res.json();
      return j?.details && typeof j.details === "object" ? j.details : null;
    } catch {
      return null;
    }
  }

  function detailLines(d) {
    if (!d) return [];
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    const lines = [];
    const proc = [
      num(d.pid) && `pid ${d.pid}`,
      num(d.uptimeSec) && `up ${d.uptimeSec}s`,
      num(d.rssMB) && `rss ${d.rssMB} MB`,
      num(d.heapUsedMB) && `heap ${d.heapUsedMB} MB`,
      num(d.eventLoopLagMs) && `event-loop lag ${d.eventLoopLagMs} ms`,
    ].filter(Boolean);
    if (proc.length) lines.push(`process:   ${proc.join(", ")}`);
    const c = d.captcha;
    if (c === null) lines.push("captcha:   not loaded");
    else if (c && typeof c === "object") {
      lines.push(`captcha:   ${[
        num(c.ready) && `ready ${c.ready}/${num(c.target) ? c.target : "?"}`,
        num(c.activeSolves) && `active solves ${c.activeSolves}`,
        typeof c.storm === "boolean" && `storm ${c.storm ? "yes" : "no"}`,
        num(c.mintSuccessRate10m) && `mint success ${Math.round(c.mintSuccessRate10m * 100)}% (10 min)`,
      ].filter(Boolean).join(", ")}`);
      const s = c.solver;
      if (s && typeof s === "object") {
        const last = typeof s.lastRecycleReason === "string"
          ? ` (last: ${s.lastRecycleReason}${num(s.lastRecycleAt) ? ` at ${new Date(s.lastRecycleAt).toISOString()}` : ""})` : "";
        lines.push(`solver:    ${[
          num(s.generation) && `generation ${s.generation}`,
          num(s.recycles) && `recycles ${s.recycles}${last}`,
          num(s.totalSolves) && `solves ${s.totalSolves}`,
          num(s.totalFailures) && `failures ${s.totalFailures}`,
          typeof s.busy === "boolean" && (s.busy ? "busy" : "idle"),
        ].filter(Boolean).join(", ")}`);
        if (Array.isArray(s.lastSdkScripts)) {
          const scripts = s.lastSdkScripts.slice(0, 16)
            .filter(script => script && typeof script.filename === "string" && /^[\w.-]{1,64}$/.test(script.filename)
              && typeof script.sha256 === "string" && /^[0-9a-f]{64}$/.test(script.sha256))
            .map(script => `${script.filename} sha256=${script.sha256.slice(0, 12)}`);
          if (scripts.length) lines.push(`sdk:       ${scripts.join(", ")} (diagnostics, not compatibility proof)`);
        }
      }
    }
    return lines;
  }

  function portOrNull() {
    try { return loadPort(); } catch { return "(config missing)"; }
  }

  // ----------------------------------------------------------------- doctor
  function commandOnPath(cmd) {
    try {
      execSync(`${process.platform === "win32" ? "where" : "which"} ${cmd}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

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
      env: { ...proxyEnv(ctx), ZCODE_PROXY_CREDENTIALS_PATH: credentials },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return { ok: null, detail: "store present; decryptability probe failed to run" };
    const decryptable = (r.stdout ?? "").trim().split("\n").pop() === "DECRYPTABLE";
    return { ok: decryptable, detail: decryptable ? "present and decryptable on this machine" : "present but NOT decryptable here — re-run: zcode-kit auth login" };
  }

  async function doctor() {
    const checks = [];
    // ok: true|false|null (null = skip, not counted as failure)
    const add = (name, ok, detail) => checks.push({ name, ok, detail });
    const bunState = bunStartable();
    add("bun available", bunState.ok, bunState.detail);
    add("config exists", existsSync(CONFIG), CONFIG);
    add("key file exists", existsSync(KEY_FILE), KEY_FILE);
    add("proxy source installed", existsSync(join(PROXY_SRC, "node_modules")), join(PROXY_SRC, "node_modules"));
    const overrides = Object.keys(process.env).filter((k) => /^ZCODE_(?:PROXY_PORT|PROXY_API_KEY|CLAIM_|ASYNC_|DUMP_)/.test(k));
    if (overrides.length) add("proxy env overrides", false, `ignored by the kit-managed proxy (unset them): ${overrides.join(", ")}`);
    if (process.env.ZCODE_PROXY_CREDENTIALS_PATH || HOME) {
      const credentials = process.env.ZCODE_PROXY_CREDENTIALS_PATH || join(HOME, ".zcode-proxy", "credentials.json");
      const cred = credentialStoreState(credentials);
      add("credentials store", cred.ok, `${process.env.ZCODE_PROXY_CREDENTIALS_PATH ? "ZCODE_PROXY_CREDENTIALS_PATH (explicit store)" : "~/.zcode-proxy/credentials.json"}: ${cred.detail}`);
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

    let state = "down";
    let configOk = existsSync(CONFIG);
    if (configOk) {
      state = await healthIdentify();
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

    let failed = 0, skipped = 0;
    for (const c of checks) {
      const tag = c.ok === null ? "SKIP" : c.ok ? "PASS" : "FAIL";
      if (c.ok === false) failed++;
      if (c.ok === null) skipped++;
      console.log(`${tag}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.log(failed === 0 ? `doctor: ${skipped} skipped, ${failed} failed — OK` : `doctor: ${failed} check(s) failed`);
    return failed === 0 ? 0 : 1;
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

  // ------------------------------------------------------------------- logs
  function logs(n = 40) {
    if (!existsSync(LOG_FILE)) {
      console.log(`(no log file at ${LOG_FILE})`);
      return 0;
    }
    const size = statSync(LOG_FILE).size;
    const tailBytes = Math.min(size, 64 * 1024);
    const fh = openSync(LOG_FILE, "r");
    try {
      const buf = Buffer.alloc(tailBytes);
      readSync(fh, buf, 0, tailBytes, size - tailBytes);
      const lines = buf.toString("utf8").split("\n").filter(Boolean);
      // The proxy's own lines are shown redacted too (ADR-0010 rule 4).
      console.log(redact(lines.slice(-n).join("\n")));
    } finally {
      closeSync(fh);
    }
    return 0;
  }

  return {
    start, stop, restart, respawn, readState, status, doctor, logs, logEvent, healthIdentify, readPidFile,
    verifyOwnProcess: lifecycle.verifyOwnProcess, proveHungOwn: lifecycle.proveHungOwn,
    pidAlive, processStartMs: lifecycle.processStartMs, killOwned, lastRecovery: lifecycle.lastRecovery, connectionDetails, printConnectionDetails,
    LOG_FILE, PID_FILE, CONFIG, KEY_FILE, LOG_DIR, RESPAWN_FILE,
  };
}

// ---------------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const m = createManager();
  async function main() {
    const cmd = process.argv[2] ?? "help";
    switch (cmd) {
      // After a successful start (including "already running") the operator
      // gets the connection details of the verified instance.
      case "start": {
        const code = await m.start();
        if (code === 0) { console.log(""); await m.printConnectionDetails("running"); }
        process.exit(code);
        break;
      }
      case "stop": process.exit(await m.stop()); break;
      case "restart": {
        const code = await m.restart();
        if (code === 0) { console.log(""); await m.printConnectionDetails("running"); }
        process.exit(code);
        break;
      }
      case "status": process.exit(await m.status({ json: process.argv.includes("--json") })); break;
      case "doctor": process.exit(await m.doctor()); break;
      case "logs": process.exit(m.logs(Number(process.argv[3] ?? 40) || 40)); break;
      case "respawn": {
        const at = process.argv.indexOf("--reason");
        process.exit(await m.respawn(Number(process.argv[3]), at > 0 ? process.argv[at + 1] : undefined));
        break;
      }
      case "help":
      default:
        console.log("zcode-proxy-manager — start | stop | restart | status | doctor | logs [n] | respawn <pid> [--reason R] | help");
    }
  }
  main().catch((err) => {
    console.error("manager error:", err.message);
    process.exit(1);
  });
}
