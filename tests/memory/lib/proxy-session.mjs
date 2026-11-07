// Start an isolated kit proxy through the REAL manager (`start`), prove the
// isolation on the live process, and expose a heap probe via /health.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processCommandLine } from "../../../lib/process.mjs";
import { createIsolatedKit, startMock } from "./isolated-kit.mjs";
import { externalConnections, portsOf } from "./sampler.mjs";

function environOf(pid) {
  try {
    return Object.fromEntries(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }));
  } catch { return {}; }
}

/**
 * Facts about a live proxy that prove (or disprove) isolation. Never returns secret values.
 * Windows cannot read another process's environment: the env facts are null
 * there, and the proof is the run's own bun as the proxy's executable (it can
 * only come from the isolated ZCODE_KIT_BUN), the isolated port as its only
 * listener (the port comes only from the isolated config) and an answer to
 * /health with the run's own key (startProxySession adds healthWithRunKey).
 */
export function isolationFacts(kit, pid, platform = process.platform) {
  const listening = { listeningPorts: portsOf(pid), externalConnections: externalConnections(pid).map((c) => c.remote) };
  if (platform === "win32") {
    const exe = processCommandLine(pid)?.executablePath ?? null;
    return { pid, platform, homeIsolated: null, configIsolated: null, stateDirIsolated: null, credentialsIsolated: null, executableIsRunBun: exe !== null && resolve(exe).toLowerCase() === resolve(kit.bun).toLowerCase(), ...listening };
  }
  const env = environOf(pid);
  return {
    pid,
    homeIsolated: env.HOME === kit.home,
    configIsolated: env.ZCODE_PROXY_CONFIG === kit.config,
    stateDirIsolated: env.ZCODE_KIT_STATE_DIR === kit.stateDir,
    credentialsIsolated: env.ZCODE_PROXY_CREDENTIALS_PATH?.startsWith(kit.stateDir) === true,
    ...listening,
  };
}

export function assertIsolated(facts, port) {
  const bad = [];
  if (facts.platform === "win32") {
    if (facts.executableIsRunBun !== true) bad.push("executable is not the run's bun");
    if (facts.healthWithRunKey !== true) bad.push("/health with the run's key");
  } else {
    if (!facts.homeIsolated) bad.push("HOME");
    if (!facts.configIsolated) bad.push("ZCODE_PROXY_CONFIG");
    if (!facts.stateDirIsolated) bad.push("ZCODE_KIT_STATE_DIR");
    if (!facts.credentialsIsolated) bad.push("credentials path");
  }
  if (facts.listeningPorts.length !== 1 || facts.listeningPorts[0] !== port) bad.push(`listening ports ${JSON.stringify(facts.listeningPorts)}`);
  if (facts.externalConnections.length) bad.push(`external connections ${facts.externalConnections.join(",")}`);
  if (bad.length) throw new Error(`isolation not proven for pid ${facts.pid}: ${bad.join("; ")}`);
}

export async function startProxySession(ctx, { port = Number(process.env.ZCODE_MEMLOOP_PORT || 18457), extraEnv = {}, startProxy = true } = {}) {
  const mock = await startMock({ ...process.env, ZCODE_MEMLOOP_RUN: ctx.id });
  const kit = createIsolatedKit({ baseDir: `${ctx.outDir}/tmp`, port, mockUrl: mock.url, marker: ctx.marker, extraEnv });
  ctx.note("isolation.stateDir", kit.stateDir);
  ctx.note("isolation.home", kit.home);
  ctx.note("isolation.port", port);
  ctx.addHeapProbe(async () => {
    const h = await kit.health(1500);
    return h?.details ? { [h.details.pid]: h.details.heapUsedMB } : {};
  });
  const session = { kit, mock, proxyPid: null, external: [] };
  if (startProxy) {
    const r = await kit.manager(["start"]);
    ctx.note("start.code", r.code);
    if (r.code !== 0) throw new Error(`manager start failed (${r.code}): ${(r.out + r.err).slice(-800)}`);
    const rec = kit.pidRecord();
    session.proxyPid = rec?.pid ?? null;
    const facts = isolationFacts(kit, session.proxyPid);
    if (facts.platform === "win32") facts.healthWithRunKey = (await kit.health(5000)) !== null;
    ctx.note("isolation.facts", facts);
    assertIsolated(facts, port);
  }
  // Re-prove "no real upstream" every 5 s for the whole run.
  session.watch = setInterval(() => {
    if (!session.proxyPid) return;
    const ext = externalConnections(session.proxyPid).map((c) => c.remote);
    if (ext.length) session.external.push(...ext);
  }, 5000);
  session.watch.unref();
  session.stop = async () => {
    clearInterval(session.watch);
    ctx.note("isolation.externalConnectionsDuringRun", [...new Set(session.external)]);
    const r = await kit.manager(["stop"]);
    ctx.note("stop.code", r.code);
    ctx.note("stop.output", (r.out + r.err).trim().split("\n").slice(-3));
    await mock.stop();
    return r;
  };
  return session;
}
