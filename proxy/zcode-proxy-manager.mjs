#!/usr/bin/env node
// zcode-proxy service manager (user-local, no admin rights).
//
// Commands: start | stop | restart | status | doctor | logs [n] | help
//
// Safety rules:
//   - Identity: a process on the configured port counts as OURS only when an
//     authenticated /health request (with the local key) answers
//     {"status":"ok","provider":"zai"}.
//   - Fail-closed stop: stop/restart kill a process ONLY when identity is
//     "ours", the pid file matches, and the live process's start time matches
//     the one recorded at spawn (PID-reuse protection). Anything doubtful is
//     reported and left running — a foreign or reused pid is never killed.
//   - start holds an exclusive lock; parallel invocations cannot race, and a
//     crashed holder's stale lock is taken over only when its pid is gone.
//   - Graceful shutdown first, forced kill only as escalation, and only for
//     verified-own processes.
//   - No component is a hard requirement: doctor checks only what is
//     installed on this machine and separates auth validity from token age.
import { spawn, spawnSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, openSync, closeSync, readSync } from "node:fs";
import { existsSync, readFileSync, statSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diagnoseQuota, quotaAuthValid } from "../cli/quota-diagnostics.mjs";

// ------------------------------------------------------------------ factory
export function createManager({ root, home, processStartMsImpl } = {}) {
  const ROOT = root ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const HOME = (home ?? process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
  const OMP_AGENT = HOME ? HOME + "/.omp/agent" : null;
  const PROXY_SRC = join(ROOT, "zcode-proxy-src");
  const MCP_DIR = join(ROOT, "mcp", "zcode-harness-mcp");
  const CONFIG = join(ROOT, "proxy", "config.yaml");
  const KEY_FILE = join(ROOT, ".proxykey");
  const LOG_DIR = join(ROOT, "logs");
  const LOG_FILE = join(LOG_DIR, "proxy.log");
  const PID_FILE = join(LOG_DIR, "proxy.pid");
  const LOCK_FILE = join(LOG_DIR, "manager.lock");
  const MAX_LOG_BYTES = 5 * 1024 * 1024;

  // Lazy config: a missing config.yaml must not crash help/doctor — only the
  // commands that actually need the port resolve (and report) it.
  let portCache = null;
  function loadPort() {
    if (portCache === null) {
      if (!existsSync(CONFIG)) {
        throw new Error(`config not found: ${CONFIG} — run setup first (node setup.mjs)`);
      }
      portCache = Number((readFileSync(CONFIG, "utf8").match(/^  port:\s*(\d+)/m) ?? [])[1] ?? 8457);
    }
    return portCache;
  }
  const base = () => `http://127.0.0.1:${loadPort()}`;

  function readKey() {
    return readFileSync(KEY_FILE, "utf8").trim();
  }

  function logLine(msg) {
    console.log(msg);
    try {
      mkdirSync(LOG_DIR, { recursive: true });
      appendFileSync(LOG_FILE, `[manager ${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  }

  function rotateLogIfNeeded() {
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) {
        const old = LOG_FILE + ".1";
        try { unlinkSync(old); } catch {}
        renameSync(LOG_FILE, old);
      }
    } catch {}
  }

  async function healthIdentify(timeoutMs = 2500) {
    // Authenticated identity check: only OUR proxy knows the key AND reports
    // the expected identity payload. Returns "ours" | "foreign" | "down" | "nokey".
    let key;
    try {
      key = readKey();
    } catch {
      return "nokey";
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base()}/health`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 401) return "foreign"; // something answered, wrong secret
      if (res.status !== 200) return "foreign";
      const j = JSON.parse(text);
      if (j?.status === "ok" && j?.provider === "zai") return "ours";
      return "foreign";
    } catch {
      return "down";
    } finally {
      clearTimeout(t);
    }
  }

  function readPidFile() {
    try {
      const raw = readFileSync(PID_FILE, "utf8").trim();
      // Current format: JSON { pid, startedMs, startedIso, name? }
      try {
        const j = JSON.parse(raw);
        if (Number.isInteger(j.pid) && j.pid > 0) {
          return { pid: j.pid, startedMs: j.startedMs ?? parseIsoMs(j.startedIso), startedIso: j.startedIso ?? null };
        }
      } catch {}
      // Legacy format (setup <= kit-1): "<pid>\n<ISO timestamp>"
      const [pid, iso] = raw.split("\n");
      const p = Number(pid);
      if (Number.isInteger(p) && p > 0) return { pid: p, startedMs: parseIsoMs(iso), startedIso: iso ?? null };
      return null;
    } catch {
      return null;
    }
  }

  function parseIsoMs(iso) {
    const ms = Date.parse(iso ?? "");
    return Number.isFinite(ms) ? ms : null;
  }

  function writePidFile(pid, startedMs) {
    mkdirSync(LOG_DIR, { recursive: true });
    const startedIso = new Date(startedMs ?? Date.now()).toISOString();
    writeFileSync(PID_FILE, JSON.stringify({ pid, startedMs: startedMs ?? null, startedIso }) + "\n");
  }

  function pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // AUD-001: only "no such process" proves death; EPERM and unknown
      // errors fail closed — the process counts as alive.
      return err?.code !== "ESRCH";
    }
  }

  // Process start time — the PID-reuse guard. Windows asks PowerShell (ticks
  // are locale-independent); POSIX reads /proc. null = not determinable here,
  // and the caller MUST treat that as fail-closed (never kill).
  let bootTimeMs = null;
  function processStartMs(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (process.platform === "win32") {
      // Two attempts: PowerShell cold start on busy CI runners can exceed a
      // single short timeout.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const out = execSync(
            `powershell -NoProfile -Command "(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks"`,
            { stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
          ).toString().trim();
          const ticks = Number(out);
          if (Number.isFinite(ticks) && ticks > 0) return ticks / 10000 - 62135596800000;
        } catch {}
      }
      return null;
    }
    if (process.platform === "darwin") {
      // AUD-007: macOS has no /proc — read the process start time via ps.
      // LC_ALL=C keeps the date format locale-independent; Date.parse handles
      // the "Mon Sep 13 18:00:00 2026" ctime format.
      try {
        const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          timeout: 15000,
          env: { ...process.env, LC_ALL: "C" },
        });
        if (r.status === 0) {
          const ms = Date.parse((r.stdout ?? "").trim());
          if (Number.isFinite(ms)) return ms;
        }
      } catch {}
      return null;
    }
    try {
      if (bootTimeMs === null) {
        const stat = readFileSync("/proc/stat", "utf8");
        const m = stat.match(/^btime (\d+)$/m);
        if (m) bootTimeMs = Number(m[1]) * 1000;
      }
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const starttime = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
      if (Number.isFinite(starttime) && bootTimeMs !== null) {
        return bootTimeMs + (starttime * 1000) / 100; // CLK_TCK is 100 on Linux
      }
    } catch {}
    return null;
  }

  /**
   * Compare a live process against the pid-file record.
   * Returns "match" | "dead" | "reuse-suspect" | "start-unknown".
   */
  function verifyOwnProcess(pidInfo) {
    if (!pidAlive(pidInfo.pid)) return "dead";
    const liveStart = (processStartMsImpl ?? processStartMs)(pidInfo.pid);
    if (liveStart === null) return "start-unknown"; // platform limitation
    const recorded = pidInfo.startedMs ?? parseIsoMs(pidInfo.startedIso);
    if (recorded === null) {
      // Legacy pid file without a usable timestamp: the health identity check
      // plus an existing pid is the best available evidence here.
      return "match";
    }
    return Math.abs(liveStart - recorded) <= 10_000 ? "match" : "reuse-suspect";
  }

  async function waitForExit(pid, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(300);
      if (!pidAlive(pid)) return true;
    }
    return !pidAlive(pid);
  }

  /** Kill a verified-own process tree: graceful first, forced as escalation. */
  async function killOwned(pid) {
    if (process.platform === "win32") {
      try { execSync(`taskkill /PID ${pid} /T`, { stdio: "pipe", timeout: 10000 }); } catch {}
      if (await waitForExit(pid, 5000)) return true;
      try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe", timeout: 10000 }); } catch {}
      return waitForExit(pid, 5000);
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return true; // gone already
    }
    if (await waitForExit(pid, 5000)) return true;
    try { process.kill(pid, "SIGKILL"); } catch {}
    return waitForExit(pid, 5000);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function openLogStream() {
    mkdirSync(LOG_DIR, { recursive: true });
    const fd = openSync(LOG_FILE, "a");
    return { fd, close: () => { try { closeSync(fd); } catch {} } };
  }

  // Manager start lock: guards two parallel `start` invocations. AUD-001:
  // no automatic stale takeover — an unconditional unlink after a stale
  // observation lets two contenders delete each other's fresh locks and both
  // believe they own the lock. A live holder blocks; a stale/unreadable lock
  // must be removed manually (the error names the path). Release deletes the
  // file only when the on-disk nonce still matches our own acquisition.
  let startLockNonce = null;
  function acquireStartLock() {
    mkdirSync(LOG_DIR, { recursive: true });
    const nonce = randomBytes(8).toString("hex");
    try {
      writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce }), { flag: "wx" });
      startLockNonce = nonce;
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try { holder = JSON.parse(readFileSync(LOCK_FILE, "utf8")); } catch {}
      if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
        throw new Error(`another manager start is in progress (pid ${holder.pid}, started ${holder.startedAt}). If that is wrong (e.g. pid reuse), remove ${LOCK_FILE}`);
      }
      throw new Error(
        `stale or unreadable manager start lock at ${LOCK_FILE}` +
          (holder ? ` (holder pid ${holder.pid} is not alive, started ${holder.startedAt})` : "") +
          ` — refusing automatic takeover. If no start is actually running, remove ${LOCK_FILE} manually and retry.`,
      );
    }
  }

  function releaseStartLock() {
    if (!startLockNonce) return;
    const nonce = startLockNonce;
    startLockNonce = null;
    try {
      const holder = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (holder.nonce !== nonce) return; // belongs to a successor — leave it alone
    } catch {
      return;
    }
    try { unlinkSync(LOCK_FILE); } catch {}
  }

  // ------------------------------------------------------------------ start
  async function start({ waitMs = 25000 } = {}) {
    rotateLogIfNeeded();
    let state;
    try {
      state = await healthIdentify();
    } catch (err) {
      logLine(`ERROR: ${err.message}`);
      return 4;
    }
    if (state === "ours") {
      const pidInfo = readPidFile();
      logLine("already running" + (pidInfo ? ` (pid ${pidInfo.pid})` : ""));
      return 0;
    }
    if (state === "foreign") {
      logLine(`ERROR: port ${loadPort()} is occupied by a foreign service (auth failed). Not touching it.`);
      return 3;
    }
    if (state === "nokey") {
      logLine(`ERROR: ${KEY_FILE} missing — cannot verify identity. Run setup first (node setup.mjs).`);
      return 5;
    }
    acquireStartLock();
    try {
      const stale = readPidFile();
      if (stale && !pidAlive(stale.pid)) {
        try { unlinkSync(PID_FILE); } catch {}
      }
      if (!existsSync(join(PROXY_SRC, "node_modules"))) {
        logLine("ERROR: proxy dependencies missing. Run: cd zcode-proxy-src && bun install --frozen-lockfile");
        return 4;
      }
      logLine("starting zcode-proxy ...");
      const out = openLogStream();
      let spawnError = null;
      const child = spawn("bun", ["run", "src/index.ts", "serve"], {
        cwd: PROXY_SRC,
        env: { ...process.env, ZCODE_PROXY_CONFIG: CONFIG, ZCODE_LOG_FORMAT: "compact" },
        detached: true,
        stdio: ["ignore", out.fd, out.fd],
      });
      child.on("error", (err) => { spawnError = err; });
      child.unref();
      // Record start time as soon as it is queryable (may lag one loop tick).
      let recordedStart = processStartMs(child.pid);
      for (let i = 0; i < 10 && recordedStart === null; i++) {
        await sleep(300);
        recordedStart = processStartMs(child.pid);
      }
      writePidFile(child.pid, recordedStart);
      const t0 = Date.now();
      while (Date.now() - t0 < waitMs) {
        if (spawnError) {
          logLine(`ERROR: failed to spawn bun (${spawnError.message}). Is bun on PATH?`);
          try { unlinkSync(PID_FILE); } catch {}
          out.close();
          return 4;
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          logLine(`ERROR: proxy exited immediately (code ${child.exitCode}). See ${LOG_FILE}`);
          try { unlinkSync(PID_FILE); } catch {}
          out.close();
          return 2;
        }
        await sleep(600);
        const s = await healthIdentify(1500);
        if (s === "ours") {
          logLine(`started (pid ${child.pid}) — healthy on ${base()}`);
          out.close();
          return 0;
        }
        if (s === "foreign") {
          // The port was taken during startup — the child we spawned is our
          // own, so killing it is safe.
          logLine(`ERROR: port ${loadPort()} taken by a foreign service during startup (our pid ${child.pid}).`);
          await killOwned(child.pid);
          try { unlinkSync(PID_FILE); } catch {}
          out.close();
          return 3;
        }
      }
      logLine(`ERROR: proxy did not become healthy within ${waitMs}ms (pid ${child.pid}). See ${LOG_FILE}`);
      await killOwned(child.pid); // our own child — safe to kill on failure
      try { unlinkSync(PID_FILE); } catch {}
      out.close();
      return 2;
    } finally {
      releaseStartLock();
    }
  }

  // ------------------------------------------------------------------- stop
  async function stop() {
    let portStr = String(loadPort());
    const pidInfo = readPidFile();
    const state = await healthIdentify();
    if (state === "foreign") {
      logLine(`ERROR: something foreign is on port ${portStr}. Refusing to stop anything.`);
      return 3;
    }
    if (state === "down") {
      if (pidInfo && !pidAlive(pidInfo.pid)) {
        try { unlinkSync(PID_FILE); } catch {}
      }
      logLine("not running");
      return 0;
    }
    if (state === "nokey") {
      // Fail-closed: without the key we cannot tell OUR proxy from a foreign
      // one that happens to answer — never kill on an unverifiable identity.
      logLine(`ERROR: ${KEY_FILE} missing — identity cannot be verified, refusing to stop anything on port ${portStr}.`);
      return 5;
    }
    // state === "ours"
    if (!pidInfo) {
      logLine("ERROR: proxy healthy but no pid file — refusing to guess. Remove it manually if intended.");
      return 4;
    }
    const verdict = verifyOwnProcess(pidInfo);
    if (verdict === "dead") {
      logLine(
        `ERROR: pid ${pidInfo.pid} from the pid file is gone but something still answers on port ${portStr}. ` +
          `Find the listening process manually: netstat -ano | findstr :${portStr}`,
      );
      return 4;
    }
    if (verdict === "reuse-suspect") {
      logLine(`ERROR: pid ${pidInfo.pid} exists but its start time does not match the pid file (PID reuse suspected) — refusing to kill.`);
      return 4;
    }
    if (verdict === "start-unknown") {
      // Fail-closed (audit §7): when the live start time cannot be determined,
      // PID-reuse cannot be ruled out — never kill on doubtful evidence.
      logLine(`ERROR: start time of pid ${pidInfo.pid} is not determinable — PID reuse cannot be ruled out, refusing to kill. Find the process manually: netstat -ano | findstr :${portStr}`);
      return 4;
    }
    if (!await killOwned(pidInfo.pid)) {
      logLine(`ERROR killing pid ${pidInfo.pid}`);
      return 2;
    }
    try { unlinkSync(PID_FILE); } catch {}
    logLine(`stopped (pid ${pidInfo.pid})`);
    return 0;
  }

  async function restart() {
    const s = await stop();
    if (s !== 0) return s;
    return start();
  }

  // ----------------------------------------------------------------- status
  async function status() {
    const pidInfo = readPidFile();
    const state = await healthIdentify();
    console.log(`port:      ${portOrNull()}`);
    console.log(`pid file:  ${pidInfo ? `${pidInfo.pid} (started ${pidInfo.startedIso ?? "unknown"})` : "none"}`);
    console.log(`health:    ${state}`);
    if (state === "ours") {
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
    }
    return state === "ours" ? 0 : 1;
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

  async function doctor() {
    const checks = [];
    // ok: true|false|null (null = skip, not counted as failure)
    const add = (name, ok, detail) => checks.push({ name, ok, detail });
    add("bun available", commandOnPath("bun") || commandOnPath("bun.exe"), "bun must be on PATH");
    add("config exists", existsSync(CONFIG), CONFIG);
    add("key file exists", existsSync(KEY_FILE), KEY_FILE);
    add("proxy source installed", existsSync(join(PROXY_SRC, "node_modules")), join(PROXY_SRC, "node_modules"));
    if (process.env.ZCODE_PROXY_CREDENTIALS_PATH || HOME) {
      const credentials = process.env.ZCODE_PROXY_CREDENTIALS_PATH || join(HOME, ".zcode-proxy", "credentials.json");
      add("credentials store", existsSync(credentials), process.env.ZCODE_PROXY_CREDENTIALS_PATH ? "ZCODE_PROXY_CREDENTIALS_PATH (explicit store)" : "~/.zcode-proxy/credentials.json");
    } else {
      add("credentials store", null, "USERPROFILE/HOME not set — skipped");
    }

    // OMP checks only apply when OMP is actually installed here; a Codex-only
    // user must not get FAIL lines about OMP.
    const ompInstalled = !!OMP_AGENT && existsSync(join(OMP_AGENT, "models.yml"));
    if (ompInstalled) {
      add("omp provider registered", ompHasZcode(), "zcode block in ~/.omp/agent/models.yml");
      add("extension installed", existsSync(OMP_AGENT + "/extensions/zcode-proxy-autostart.ts"), "~/.omp/agent/extensions/zcode-proxy-autostart.ts");
    } else {
      add("omp integration", null, "OMP not installed — skipped");
    }
    if (existsSync(MCP_DIR)) {
      add("mcp bridge installed", existsSync(join(MCP_DIR, "dist", "index.js")), join(MCP_DIR, "dist", "index.js"));
      add("mcp bridge deps", existsSync(join(MCP_DIR, "node_modules")), join(MCP_DIR, "node_modules"));
    }
    if (existsSync(join(ROOT, "generated", "claude-zcode-settings.json"))) {
      add("claude adapter artifact", true, "generated/claude-zcode-settings.json");
    }
    if (existsSync(join(ROOT, "generated", "codex-home", "config.toml"))) {
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
      console.log(lines.slice(-n).join("\n"));
    } finally {
      closeSync(fh);
    }
    return 0;
  }

  return { start, stop, restart, status, doctor, logs, healthIdentify, readPidFile, verifyOwnProcess, pidAlive, processStartMs, killOwned, LOG_FILE, PID_FILE, CONFIG, KEY_FILE, LOG_DIR };
}

// ---------------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const m = createManager();
  async function main() {
    const cmd = process.argv[2] ?? "help";
    switch (cmd) {
      case "start": process.exit(await m.start()); break;
      case "stop": process.exit(await m.stop()); break;
      case "restart": process.exit(await m.restart()); break;
      case "status": process.exit(await m.status()); break;
      case "doctor": process.exit(await m.doctor()); break;
      case "logs": process.exit(m.logs(Number(process.argv[3] ?? 40) || 40)); break;
      case "help":
      default:
        console.log("zcode-proxy-manager — start | stop | restart | status | doctor | logs [n] | help");
    }
  }
  main().catch((err) => {
    console.error("manager error:", err.message);
    process.exit(1);
  });
}
