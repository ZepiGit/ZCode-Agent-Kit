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
// doctor, logs and the connection details are the manager's own reports. The
// doctor's checks are a record from lib/proxy-doctor.mjs (which zcode-kit
// doctor reads too); `doctor` here renders it in the legacy grammar.
import { existsSync, statSync, openSync, closeSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { managerDoctor } from "../lib/proxy-doctor.mjs";
import { createLifecycle } from "../lib/proxy-lifecycle.mjs";
import { configuredModelIds, configuredServer, connectionDetailsLines, connectionDetailsObject, shouldRevealKey } from "../cli/connection-details.mjs";

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
  const { CONFIG, KEY_FILE, LOG_FILE, PID_FILE, LOG_DIR, RESPAWN_FILE } = lifecycle;
  const { healthIdentify, readPidFile, pidAlive, readKey, loadPort, redact } = lifecycle;
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
  // The checks are lib/proxy-doctor.mjs's record; this renders it in the
  // legacy off-TTY grammar (ADR-0001 rule 1), which the manager CLI keeps.
  async function doctor() {
    const { checks, code } = await managerDoctor({ lifecycle });
    let failed = 0, skipped = 0;
    for (const c of checks) {
      const tag = c.ok === null ? "SKIP" : c.ok ? "PASS" : "FAIL";
      if (c.ok === false) failed++;
      if (c.ok === null) skipped++;
      console.log(`${tag}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.log(failed === 0 ? `doctor: ${skipped} skipped, ${failed} failed — OK` : `doctor: ${failed} check(s) failed`);
    return code;
  }

  // ------------------------------------------------------------------- logs
  /** The lines in the last 64 KB of `file` ([] when it does not exist), and whether that was the whole file. */
  function tailLines(file) {
    let fh;
    try { fh = openSync(file, "r"); } catch (err) { if (err?.code === "ENOENT") return { lines: [], whole: true }; throw err; }
    try {
      const size = statSync(file).size;
      const tailBytes = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(tailBytes);
      const read = readSync(fh, buf, 0, tailBytes, size - tailBytes);
      return { lines: buf.subarray(0, read).toString("utf8").split("\n").filter(Boolean), whole: tailBytes === size };
    } finally {
      closeSync(fh);
    }
  }

  // The last n lines across proxy.log.1 and proxy.log (the proxy rotates
  // while it runs, so the recent lines may start in the rotated file).
  function logs(n = 40) {
    const rotated = `${LOG_FILE}.1`;
    if (!existsSync(LOG_FILE) && !existsSync(rotated)) {
      console.log(`(no log file at ${LOG_FILE})`);
      return 0;
    }
    const current = tailLines(LOG_FILE);
    const lines = current.lines.length < n && current.whole ? [...tailLines(rotated).lines, ...current.lines] : current.lines;
    // The proxy's own lines are shown redacted too (ADR-0010 rule 4).
    console.log(redact(lines.slice(-n).join("\n")));
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
