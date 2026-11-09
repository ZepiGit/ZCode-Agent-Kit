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
// doctor reads too); `doctor` here renders it in the legacy grammar. Status
// and the log tail come from lib/proxy-status.mjs and lib/proxy-logs.mjs,
// which zcode-kit status / proxy logs read too (ticket 40); this file renders
// them in its own unchanged text.
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { managerDoctor } from "../lib/proxy-doctor.mjs";
import { readConnectionFacts, readProxyStatus, statusDocument, statusExitCode } from "../lib/proxy-status.mjs";
import { createLifecycle, RESPAWN_WAIT_MS } from "../lib/proxy-lifecycle.mjs";
import { readLogTail } from "../lib/proxy-logs.mjs";
import { connectionDetailsLines, shouldRevealKey } from "../cli/connection-details.mjs";

// ------------------------------------------------------------------ factory
const MANAGER_PATH = fileURLToPath(import.meta.url);

export function createManager({
  root, home, processStartMsImpl, processCommandLineImpl, bunResolver,
  // Hung-own proof and respawn timings (contract defaults; tests shorten them).
  startupGraceMs = 60_000, hungProbeCount = 3, hungProbeIntervalMs = 5_000, hungProbeTimeoutMs = 5_000,
  respawnWaitMs = RESPAWN_WAIT_MS,
} = {}) {
  const lifecycle = createLifecycle({
    root, home, processStartMsImpl, processCommandLineImpl, bunResolver, managerPath: MANAGER_PATH,
    startupGraceMs, hungProbeCount, hungProbeIntervalMs, hungProbeTimeoutMs, respawnWaitMs,
  });
  const { CONFIG, KEY_FILE, LOG_FILE, PID_FILE, LOG_DIR, RESPAWN_FILE } = lifecycle;
  const { healthIdentify, readPidFile, pidAlive, readKey, redact } = lifecycle;

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
  // The status is lib/proxy-status.mjs's record; this renders it in the
  // manager CLI's own text (unchanged) or as the shared --json document.
  async function status({ json = false } = {}) {
    const record = await readProxyStatus({ lifecycle, fetch });
    if (json) {
      // One object on stdout and nothing else; never the key.
      console.log(JSON.stringify(statusDocument(record), null, 2));
      return statusExitCode(record);
    }
    const { pidRecord: pidInfo, identity: state, alive } = record;
    console.log(`port:      ${record.port ?? "(config missing)"}`);
    console.log(`pid file:  ${pidInfo ? `${pidInfo.pid} (started ${pidInfo.startedIso ?? "unknown"})` : "none"}`);
    console.log(`health:    ${state}`);
    if (state === "down" && pidInfo && alive) {
      console.log(`  pid ${pidInfo.pid} is alive but not answering — next: zcode-kit proxy restart, then zcode-kit doctor`);
    }
    if (state === "ours") {
      for (const line of detailLines(record.details)) console.log(line);
      const q = record.quota;
      if (q.fetchError !== undefined) console.log(`  quota: unavailable (${q.fetchError})`);
      else if (q.bodyError !== null) console.log(`  quota: unavailable (${q.bodyError})`);
      else if (q.ok) {
        for (const b of q.body.balances ?? []) {
          console.log(`  quota: ${b.showName} ${b.remainingUnits}/${b.totalUnits} ${b.unitType} (expires ${new Date(b.expiresAt * 1000).toISOString()})`);
        }
      } else console.log(`  quota: HTTP ${q.status}`);
    }
    if (record.connection) {
      // Not running: configured values are still useful for manual client
      // setup, but they are labelled as unverified — never as "running".
      console.log("");
      const { facts, error } = record.connection;
      let lines = null;
      try {
        if (error !== null) throw new Error(error);
        lines = connectionDetailsLines({ ...facts, key: readKey(), reveal: shouldRevealKey() });
      } catch (err) {
        console.log(`  connection details unavailable: ${err.message}`);
      }
      for (const line of lines ?? []) console.log(line);
    } else if (state === "foreign") {
      console.log(`  connection details withheld: port ${record.port ?? "(config missing)"} is answered by a service that is not this kit's proxy`);
    } else if (state === "nokey") {
      console.log(`  connection details unavailable: ${KEY_FILE} missing — run setup first`);
    }
    return statusExitCode(record);
  }

  const connectionFacts = (source) => readConnectionFacts({ lifecycle, fetch, source });

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
  // The tail is lib/proxy-logs.mjs's; the proxy's own lines are shown
  // redacted too (ADR-0010 rule 4).
  function logs(n = 40) {
    const tail = readLogTail(LOG_FILE, { n, redact });
    console.log(tail.exists ? tail.lines.join("\n") : `(no log file at ${LOG_FILE})`);
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
