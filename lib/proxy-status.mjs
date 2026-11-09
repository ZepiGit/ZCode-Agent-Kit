// The proxy's status as data (ticket 40): what `status` / `proxy status`
// report, gathered once over the lifecycle module's proofs and the own
// proxy's endpoints, printing nothing. Two renderers read it: the manager
// CLI's legacy `status` text and `--json` (proxy/zcode-proxy-manager.mjs) and
// `zcode-kit status` / `proxy status`, which render it through the output
// module (cli/proxy-report.mjs). `statusDocument` is the `--json` document
// both print, so it stays one definition (C2: keys may only be added).
//
//   readProxyStatus({ lifecycle, fetch }) → status record
//
// A status record is
//   { identity, pidRecord, alive, port, portError, keyFile, details, quota, connection }:
//   identity    "ours" | "down" | "foreign" | "nokey" (the identity proof);
//   pidRecord   the pid record or null; alive: whether its pid is alive;
//   port        the configured port, or null when the config is missing
//               (portError then holds why);
//   details     the own proxy's /health `details` object, or null;
//   quota       for the own proxy: { ok, status, body, bodyError } from /quota
//               (body null and bodyError set when it was not JSON), or
//               { fetchError } when it did not answer; null otherwise;
//   connection  for the own or a stopped proxy: { source, facts, error }:
//               source "running" only when the identity was re-proven right
//               before (otherwise "configured"); facts as
//               cli/connection-details.mjs takes them (never the key), or
//               null with `error` when they could not be read; null for a
//               foreign listener or a missing key.
//
// This module imports no presentation code (ADR-0011 cond 3): the manager
// CLI loads it.
import { configuredModelIds, configuredServer, connectionDetailsObject } from "../cli/connection-details.mjs";

export async function readProxyStatus({ lifecycle, fetch = globalThis.fetch }) {
  const { readKey, loadPort, healthIdentify } = lifecycle;
  const base = () => `http://127.0.0.1:${loadPort()}`;
  const authed = (path, timeoutMs) => fetch(`${base()}${path}`, { headers: { Authorization: `Bearer ${readKey()}` }, signal: AbortSignal.timeout(timeoutMs) });

  const { pidRecord, identity, alive } = await lifecycle.readState();
  let port = null;
  let portError = null;
  try { port = loadPort(); } catch (err) { portError = String(err?.message ?? err); }
  const status = { identity, pidRecord, alive, port, portError, keyFile: lifecycle.KEY_FILE, details: null, quota: null, connection: null };

  if (identity === "ours") {
    try {
      const res = await authed("/health", 5000);
      const j = await res.json();
      status.details = j?.details && typeof j.details === "object" ? j.details : null;
    } catch {
      status.details = null;
    }
    try {
      const res = await authed("/quota", 8000);
      let body = null;
      let bodyError = null;
      try { body = await res.json(); } catch (err) { bodyError = String(err?.message ?? err); }
      status.quota = { ok: res.ok, status: res.status, body, bodyError };
    } catch (err) {
      status.quota = { fetchError: String(err?.message ?? err) };
    }
  }

  if (identity === "ours" || identity === "down") {
    let source = identity === "ours" ? "running" : "configured";
    // Re-proven right before reporting: a proxy that stopped meanwhile is
    // never shown as verified.
    if (source === "running" && await healthIdentify(2500) !== "ours") source = "configured";
    try {
      status.connection = { source, facts: await readConnectionFacts({ lifecycle, fetch, source }), error: null };
    } catch (err) {
      status.connection = { source, facts: null, error: String(err?.message ?? err) };
    }
  }
  return status;
}

/**
 * Port, models (the live /v1/models list when `source` is "running", else
 * the configured list) and listener facts for the connection details; never
 * the key. Throws when the config cannot be read.
 */
export async function readConnectionFacts({ lifecycle, fetch = globalThis.fetch, source }) {
  const { readKey, loadPort, CONFIG } = lifecycle;
  let models = configuredModelIds(CONFIG);
  let modelsSource = "config";
  if (source === "running") {
    try {
      const res = await fetch(`http://127.0.0.1:${loadPort()}/v1/models`, { headers: { Authorization: `Bearer ${readKey()}` }, signal: AbortSignal.timeout(5000) });
      const j = await res.json();
      const ids = (j?.data ?? []).map((m) => m?.id).filter((id) => typeof id === "string" && id.length > 0);
      if (res.ok && ids.length) { models = ids; modelsSource = "live"; }
    } catch {
      // the configured list stays, labelled as such
    }
  }
  const server = configuredServer(CONFIG);
  return { port: loadPort(), models, modelsSource, source, host: server.host, responsesEnabled: server.responsesEnabled };
}

/**
 * The `status --json` document: one object, connection details without the
 * key (only for the own or a stopped proxy), the quota of the own proxy.
 */
export function statusDocument(status) {
  const { identity, pidRecord, alive } = status;
  const out = {
    schemaVersion: 1,
    port: status.port ?? "(config missing)",
    pid: pidRecord ? { pid: pidRecord.pid, startedAt: pidRecord.startedIso ?? null, alive } : null,
    health: identity,
    connection: null,
    quota: null,
  };
  if (status.connection) {
    if (status.connection.facts) out.connection = connectionDetailsObject(status.connection.facts);
    else out.connectionError = status.connection.error.slice(0, 200);
  }
  if (identity === "ours" && status.quota) {
    const q = status.quota;
    out.quota = q.fetchError !== undefined ? { error: "unavailable" }
      : q.ok && Array.isArray(q.body?.balances)
        ? q.body.balances.map((b) => ({ name: String(b.showName ?? ""), remaining: b.remainingUnits ?? null, total: b.totalUnits ?? null, unit: b.unitType ?? null, expiresAt: Number.isFinite(b.expiresAt) ? new Date(b.expiresAt * 1000).toISOString() : null }))
        : { error: `HTTP ${q.status}` };
  }
  return out;
}

/** Exit code of `status` / `proxy status`: 0 only when this kit's proxy answers. */
export const statusExitCode = (status) => (status.identity === "ours" ? 0 : 1);
