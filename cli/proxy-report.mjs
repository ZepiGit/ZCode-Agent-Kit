// The proxy commands' reports (ticket 40; design-language §4.5, §4.6, §7;
// ADR-0005): `status` / `proxy status` from a status record
// (lib/proxy-status.mjs), and the result of `proxy start|stop|restart` from
// the lifecycle's outcome records (lib/proxy-lifecycle.mjs). Pure apart from
// the Progress it finishes: records in, output-module records out.
//
// Streams: the status report, the state line and the connection details go to
// stdout; progress, result rows and error blocks (what / why / next) go to
// stderr. Exit codes are the lifecycle's and the status's, unchanged.

// ------------------------------------------------------------ human units

/** `45 s`, `12 min`, `1 h 02 min`, `3 d 4 h` (design-language §4.7). */
export function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
  const h = Math.floor((s % 86400) / 3600);
  return `${Math.floor(s / 86400)} d${h ? ` ${h} h` : ""}`;
}

const num = (v) => typeof v === "number" && Number.isFinite(v);
/** `2026-11-06` from epoch milliseconds (UTC). */
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
/** `2026-11-06 10:11 UTC` from epoch milliseconds. */
const minute = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// -------------------------------------------------------- connection card

/**
 * The connection-details record for a status record's `connection`, or a
 * warn block when its facts could not be read. The key goes into the record
 * only when it may be revealed; the output module shows it on a TTY only.
 */
export function connectionRecords(connection, { key = null, reveal = false, verbose = false } = {}) {
  if (!connection) return [];
  if (!connection.facts) {
    return [{ kind: "warn", what: "Connection details unavailable", why: connection.error, next: ["zcode-kit setup"] }];
  }
  const facts = { ...connection.facts, ...(reveal && key ? { key } : {}) };
  return [{ kind: "connection", facts, reveal: Boolean(reveal && key), verbose }];
}

// ------------------------------------------------------------------ status

function memoryRows(d) {
  if (!d || !num(d.rssMB)) return [];
  const extra = [num(d.heapUsedMB) && `heap ${d.heapUsedMB} MB`, num(d.eventLoopLagMs) && `event-loop lag ${d.eventLoopLagMs} ms`].filter(Boolean);
  return [["proxy", `${d.rssMB} MB${extra.length ? ` (${extra.join(", ")})` : ""}`]];
}

function quotaRows(q) {
  if (!q) return [];
  if (q.fetchError !== undefined) return [["quota", `unavailable (${q.fetchError})`]];
  if (q.bodyError !== null) return [["quota", `unavailable (${q.bodyError})`]];
  if (!q.ok) return [["quota", `unavailable (HTTP ${q.status})`]];
  const balances = Array.isArray(q.body?.balances) ? q.body.balances : [];
  if (!balances.length) return [["quota", "no packages reported"]];
  return balances.map((b) => {
    const left = num(b.remainingUnits) && num(b.totalUnits)
      ? `${b.remainingUnits} of ${b.totalUnits} ${b.unitType ?? "units"} left${b.totalUnits > 0 ? ` (${Math.round((b.remainingUnits / b.totalUnits) * 100)} %)` : ""}`
      : `${b.remainingUnits ?? "?"}/${b.totalUnits ?? "?"} ${b.unitType ?? ""}`.trim();
    return [String(b.showName ?? "package"), `${left}${num(b.expiresAt) ? `, expires ${day(b.expiresAt * 1000)}` : ""}`];
  });
}

function captchaRows(d) {
  if (!d || !("captcha" in d)) return [];
  const c = d.captcha;
  if (c === null) return [["captcha", "not loaded"]];
  if (!c || typeof c !== "object") return [];
  const rows = [];
  const pool = [
    num(c.ready) && `ready ${c.ready}/${num(c.target) ? c.target : "?"}`,
    num(c.activeSolves) && plural(c.activeSolves, "active solve"),
    typeof c.storm === "boolean" && (c.storm ? "storm" : "no storm"),
  ].filter(Boolean);
  if (pool.length) rows.push(["workers", pool.join(", ")]);
  if (num(c.mintSuccessRate10m)) rows.push(["mint success", `${Math.round(c.mintSuccessRate10m * 100)} % (10 min)`]);
  const s = c.solver;
  if (s && typeof s === "object") {
    const last = typeof s.lastRecycleReason === "string" ? ` (last: ${s.lastRecycleReason}${num(s.lastRecycleAt) ? `, ${minute(s.lastRecycleAt)}` : ""})` : "";
    const solver = [
      num(s.generation) && `generation ${s.generation}`,
      num(s.recycles) && `${plural(s.recycles, "recycle")}${last}`,
      num(s.totalSolves) && plural(s.totalSolves, "solve"),
      num(s.totalFailures) && plural(s.totalFailures, "failure"),
      typeof s.busy === "boolean" && (s.busy ? "busy" : "idle"),
    ].filter(Boolean);
    if (solver.length) rows.push(["solver", solver.join(", ")]);
    if (Array.isArray(s.lastSdkScripts)) {
      const scripts = s.lastSdkScripts.slice(0, 16)
        .filter((script) => script && typeof script.filename === "string" && /^[\w.-]{1,64}$/.test(script.filename)
          && typeof script.sha256 === "string" && /^[0-9a-f]{64}$/.test(script.sha256))
        .map((script) => `${script.filename} sha256=${script.sha256.slice(0, 12)}`);
      if (scripts.length) rows.push(["sdk", `${scripts.join(", ")} (diagnostics, not compatibility proof)`]);
    }
  }
  return rows;
}

/** A titled key/value section, or nothing when it has no rows. */
const section = (title, pairs) => (pairs.length ? [{ kind: "heading", title }, { kind: "kv", pairs }, { kind: "blank" }] : []);

/**
 * `status` / `proxy status` text: a state line first (human units, A-17),
 * then Memory, Quota and Captcha for the own proxy, then the connection
 * details once (A-12). A foreign listener or a missing key is an error block.
 */
export function statusRecords(status, { key = null, reveal = false, verbose = false } = {}) {
  const exitCode = status.identity === "ours" ? 0 : 1;
  const where = status.port === null ? "" : ` on 127.0.0.1:${status.port}`;
  const pid = status.pidRecord?.pid ?? (num(status.details?.pid) ? status.details.pid : null);
  const card = () => connectionRecords(status.connection, { key, reveal, verbose });
  switch (status.identity) {
    case "ours": {
      const up = num(status.details?.uptimeSec) ? `, up ${formatDuration(status.details.uptimeSec)}` : "";
      return {
        exitCode,
        records: [
          { kind: "state", status: "run", text: `running${where}${up}${pid ? ` (pid ${pid})` : ""}` },
          { kind: "blank" },
          ...section("Memory", memoryRows(status.details)),
          ...section("Quota", quotaRows(status.quota)),
          ...section("Captcha", captchaRows(status.details)),
          ...card(),
        ],
      };
    }
    case "down": {
      const stuck = status.pidRecord && status.alive;
      return {
        exitCode,
        records: [
          stuck
            ? { kind: "state", status: "warn", text: `not answering${where}: pid ${status.pidRecord.pid} is alive, but no proxy of this kit answers` }
            : { kind: "state", status: "stop", text: `stopped${status.port === null ? "" : ` (port ${status.port})`}` },
          { kind: "next", commands: stuck ? ["zcode-kit proxy restart", "zcode-kit doctor"] : ["zcode-kit proxy start"] },
          { kind: "blank" },
          ...card(),
        ],
      };
    }
    case "foreign":
      return {
        exitCode,
        records: [{
          kind: "error",
          what: `Port ${status.port ?? "?"} is answered by another service`,
          why: "it does not prove this kit's identity, so no connection details are shown; the kit never stops a service it did not start",
          next: ["change server.port in proxy/config.yaml, then zcode-kit proxy start", "zcode-kit doctor"],
          exit: exitCode,
        }],
      };
    default:
      return {
        exitCode,
        records: [{
          kind: "error",
          what: "The local proxy key is missing",
          why: `${status.keyFile} not found, so the proxy's identity cannot be proven`,
          next: ["zcode-kit setup"],
          exit: exitCode,
        }],
      };
  }
}

// ------------------------------------------------- start / stop / restart

/** The lifecycle's own explanation of a failed intent: its last ERROR narration (or line), without the prefix. */
function narratedWhy(record) {
  if (record.error) return String(record.error);
  const lines = Array.isArray(record.lines) ? record.lines : [];
  const line = [...lines].reverse().find((l) => /^ERROR\b/.test(l)) ?? lines.at(-1) ?? "";
  return line.replace(/^ERROR:?\s*/, "") || `outcome ${record.outcome}`;
}

const portOf = (lifecycle) => { try { return lifecycle.loadPort(); } catch { return null; } };

/** The error block of a failed start (ensure-running outcome), with what / why / next. */
export function startFailure(record, lifecycle) {
  const port = portOf(lifecycle);
  const why = narratedWhy(record);
  const block = (what, next, whyText = why) => ({ what, why: whyText, next, exit: record.code });
  switch (record.outcome) {
    case "foreign":
    case "foreign-during-start":
      return block(`Port ${port ?? "?"} is in use by another service`,
        ["zcode-kit proxy status", "change server.port in proxy/config.yaml, then zcode-kit proxy start"],
        "it answered /health without this kit's identity; the kit never stops a service it did not start");
    case "no-key":
      return block("The local proxy key is missing", ["zcode-kit setup"], `${lifecycle.KEY_FILE} not found, so the proxy's identity cannot be proven`);
    case "identity-error":
      return block("The proxy's identity could not be checked", ["zcode-kit setup", "zcode-kit doctor"]);
    case "start-lock-unavailable":
      return block("The proxy start lock is unavailable", ["zcode-kit doctor"]);
    case "contention-timeout":
      return block("Another start did not bring the proxy up", ["zcode-kit proxy logs 50", "zcode-kit doctor"]);
    case "unproven-live-record":
      return block("A recorded proxy process is alive but not answering", ["zcode-kit proxy restart", "zcode-kit doctor"]);
    case "hung-recovery-failed":
      return block("A hung proxy could not be stopped", ["zcode-kit doctor"]);
    case "dependencies-missing":
      return block("The proxy's dependencies are missing", ["zcode-kit setup"]);
    case "bun-unavailable":
      return block("Bun cannot be started", ["install Bun, or set ZCODE_KIT_BUN to its executable path"]);
    case "spawn-failed":
      return block("The proxy process could not be spawned", ["zcode-kit doctor"]);
    case "exited":
      return block("The proxy exited right after it started", ["zcode-kit proxy logs 50", "zcode-kit doctor"]);
    case "unhealthy":
      return block("The proxy did not become healthy in time", ["zcode-kit proxy logs 50", "zcode-kit proxy restart"]);
    default:
      return block("The proxy did not start", ["zcode-kit doctor"]);
  }
}

/** The error block of a failed stop (stop outcome). */
export function stopFailure(record, lifecycle) {
  const port = portOf(lifecycle);
  const why = narratedWhy(record);
  const block = (what, next, whyText = why) => ({ what, why: whyText, next, exit: record.code });
  switch (record.outcome) {
    case "foreign":
      return block(`Port ${port ?? "?"} is answered by another service; nothing was stopped`,
        ["zcode-kit proxy status"], "it does not prove this kit's identity; the kit never stops a service it did not start");
    case "no-key":
      return block("The local proxy key is missing; nothing was stopped", ["zcode-kit setup"],
        `${lifecycle.KEY_FILE} not found, so the proxy's identity cannot be proven`);
    case "lock-unavailable":
      return block("The stop was refused: the proxy start lock is unavailable", ["zcode-kit doctor"]);
    case "kill-failed":
    case "hung-recovery-failed":
      return block("The proxy could not be stopped", ["zcode-kit doctor"]);
    default:
      // unproven-live-record, no-pid-record, recorded-pid-gone, reuse-suspect, start-unknown
      return block("The proxy was left running: its process is not proven to be this kit's", ["zcode-kit doctor"]);
  }
}

/** Finish a start's Progress from its ensure-running record; true when the proxy runs. */
export function finishStart(progress, record, lifecycle) {
  if (record.code !== 0) {
    progress.fail(startFailure(record, lifecycle));
    return false;
  }
  const port = portOf(lifecycle);
  const pid = record.pid ?? lifecycle.readPidFile()?.pid ?? null;
  const verb = record.outcome === "already-running" ? "already running" : "started";
  const recovered = record.recovered ? `; replaced hung pid ${record.recovered.pid}` : "";
  progress.done(`${verb}${port === null ? "" : ` on 127.0.0.1:${port}`}${pid ? ` (pid ${pid})` : ""}${recovered}`);
  return true;
}

/** Finish a stop's Progress from its stop record; true when nothing of this kit runs any more. */
export function finishStop(progress, record, lifecycle) {
  if (record.code !== 0) {
    progress.fail(stopFailure(record, lifecycle));
    return false;
  }
  if (record.outcome === "not-running") progress.skip("not running");
  else progress.done(`${record.outcome === "stopped-hung" ? "stopped a hung proxy" : "stopped"}${record.pid ? ` (pid ${record.pid})` : ""}`);
  return true;
}

