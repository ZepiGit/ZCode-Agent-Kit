// S3 Concurrency: N simultaneous harness launches against ONE isolated
// installation, through the two real entry points:
//   - `zcode-kit run opencode` (cli/zcode-kit.mjs → launch.mjs → startupPreflight)
//     with a fake `opencode` that holds one MCP bridge session (fixtures/fake-session.mjs);
//   - the OMP autostart preflight (`node cli/heal.mjs --diagnostic-code`).
// The guarantee under test is its PURPOSE, not the happy path: every launch
// ends with a working proxy, there is never more than one proxy, and nothing
// the race leaves behind (locks, pids, processes) blocks the next session.
// This is the 10-launch process-count test (spec §18 PROCESSES): exactly 1
// proxy, 0 failed launches incl. a killed holder, 0 orphans after stop. The
// footprint verdict has two parts: (a) summed kit RSS at every sample ≤ the
// total, (b) every kit process's own peak ≤ its role target (budgets.mjs).
//
// Rounds (each from a stopped state):
//   race-5, race-10      mixed launches started at once
//   race-10-preflight    10 OMP preflights at once
//   kill-holder-10       10 preflights; the lock holder is SIGKILLed while it
//                        holds the start lock (a harness closed mid-start)
//   hung-10 (long, and --variant hung) the running proxy is SIGSTOPped past
//                        its startup grace, then 10 launches race the hung-own
//                        recovery; --variant hung also runs it once with the
//                        stale lock a killed holder leaves behind
//   --variant omp (the S3 OMP stub-host leg, ADR-0013 cond 4; lib/omp-leg.mjs)
//     omp-5              5 stub Bun hosts load the generated OMP extension and
//                        fire its hook at once: OMP preflight processes alive
//                        at once (≤ 1), each host's own cost (≤ 5 MB per waiter,
//                        reported, not kit footprint), and every waiter printed
//                        the starter's cause lines
//     omp-5-kill-starter the same, and the first host seen spawning a preflight
//                        is killed with its process tree as soon as it does
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startProxySession } from "../lib/proxy-session.mjs";
import { KIT_ROOT } from "../lib/isolated-kit.mjs";
import { scan, portsOf } from "../lib/sampler.mjs";
import { OMP_LEG, PROCESSES, s3Budgets } from "../lib/budgets.mjs";
import { generateOmpExtension, startOmpHost } from "../lib/omp-host.mjs";
import { causeLinesOf, ompLegChecks } from "../lib/omp-leg.mjs";
import { PREFLIGHT_WARNINGS } from "../../../cli/heal.mjs";
import { osLeg } from "../lib/catalogue.mjs";
import { resumeProcess, suspendProcess } from "../lib/win-process.mjs";
import { whileFrozen } from "../lib/freeze.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The promise's value, or `fallback` after `ms` (the timer never outlives the race). */
const within = (promise, ms, fallback = null) => { let t; return Promise.race([promise, new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t)); };
// SIGSTOP/SIGCONT; Windows has no stop signal: NtSuspendProcess/NtResumeProcess.
const freeze = (pid) => (process.platform === "win32" ? suspendProcess(pid) : process.kill(pid, "SIGSTOP"));
const thaw = (pid) => (process.platform === "win32" ? resumeProcess(pid) : process.kill(pid, "SIGCONT"));

// Preflights live about a second: sample 4 times a second so each one's own
// peak (VmHWM, read while it is alive) reaches the per-role verdict.
export const sampleIntervalMs = 250;

// A hung round: our running proxy is frozen past the manager's startup grace,
// then 10 mixed launches race the kit's hung-own recovery.
//
// Which proxy: the one the kit's pid record names, when it is a process of
// this run; otherwise the single proxy of this run that serves the isolated
// port. A start lock holder killed between spawning the proxy and writing
// proxy.pid leaves exactly that: a healthy proxy without a record, and
// `manager start` answers 0 (CI run 42281731448, ubuntu). That proxy is the
// state the round must test, not a reason to skip it. Anything else (no proxy
// of this run, none on the port, two on it, a failed start) is a skipped
// round, noted with its reason; the evidence gate makes the run a harness
// failure (lib/completeness.mjs). Only processes carrying the run marker are
// ever frozen (`proxies` is the run's own scan).
export function hungTarget({ startCode, record, proxies, port, portsOf }) {
  if (startCode !== 0) return { pid: null, reason: `manager start exited ${startCode}` };
  const ours = proxies.map((p) => p.pid);
  const recordedPid = record?.pid ?? null;
  if (recordedPid !== null && ours.includes(recordedPid)) return { pid: recordedPid, via: "pid-record", recordedPid };
  const serving = ours.filter((pid) => portsOf(pid).includes(port));
  if (serving.length === 1) return { pid: serving[0], via: "listener", recordedPid };
  const recorded = recordedPid === null ? "no pid record" : `pid record ${recordedPid} is not a proxy of this run`;
  return { pid: null, reason: `${recorded}, ${serving.length} proxies of this run serve port ${port}` };
}

export function makeHungRound({ kit, proxies, portsOf, round, note, freeze, thaw, alive, graceMs = 65_000 }) {
  return async (name) => {
    const start = await kit.manager(["start"]);
    if (start.code !== 0) return note(`${name}.skipped`, { startCode: start.code, reason: `manager start exited ${start.code}` });
    await sleep(graceMs); // past the manager's 60 s startup grace (Windows also sees a new process only at its next poll)
    const target = hungTarget({ startCode: start.code, record: kit.pidRecord(), proxies: proxies(), port: kit.port, portsOf });
    if (target.pid === null) return note(`${name}.skipped`, { startCode: start.code, reason: target.reason });
    note(`${name}.target`, target);
    // Our own proxy, frozen: /health stops answering. It is always thawed, and
    // a failed thaw ends the run as a harness failure (lib/freeze.mjs).
    await whileFrozen(target.pid, () => round(name, 10, { kind: "mixed" }), { freeze, thaw, ...(alive ? { alive } : {}) });
  };
}

export async function run(ctx) {
  const session = await startProxySession(ctx, { startProxy: false });
  const { kit } = session;
  // Fake harness binary on PATH (opencode needs no generated config).
  const bin = join(kit.dir, "fake-bin");
  mkdirSync(bin, { recursive: true });
  const fakeSession = join(KIT_ROOT, "tests", "memory", "fixtures", "fake-session.mjs");
  if (process.platform === "win32") {
    // An npm-style shim, the only .cmd form the kit runs (lib/process.mjs unwrapShim).
    writeFileSync(join(bin, "opencode-session.mjs"), `await import(${JSON.stringify(pathToFileURL(fakeSession).href)});\n`);
    writeFileSync(join(bin, "opencode.cmd"), `"${process.execPath}" "%~dp0\\opencode-session.mjs" %*\r\n`);
  } else {
    writeFileSync(join(bin, "opencode"), `#!/bin/sh\nexec "${process.execPath}" "${fakeSession}"\n`);
    chmodSync(join(bin, "opencode"), 0o755);
  }
  // Windows env blocks carry `Path`: prepend to whichever spelling is there.
  const pathKey = Object.keys(kit.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  kit.env[pathKey] = `${bin}${delimiter}${kit.env[pathKey] ?? ""}`;
  kit.env.S3_HOLD_MS = ctx.long ? "15000" : "8000";

  const lockFile = join(kit.logDir, "manager.lock");
  const rounds = [];
  const proxies = () => scan(ctx.marker).filter((p) => p.role === "proxy");

  async function stopAll(label) {
    const r = await kit.manager(["stop"], { timeoutMs: 90_000 });
    const left = proxies();
    return { label, code: r.code, tail: (r.out + r.err).trim().split("\n").slice(-2), proxiesLeft: left.length };
  }

  async function round(name, n, { kind = "mixed", adversary = null } = {}) {
    const before = proxies().length;
    const seen = new Set();
    let maxSimultaneous = 0, maxListeners = 0;
    const tFrom = ctx.elapsed();
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const ps = proxies();
        for (const p of ps) seen.add(p.key);
        maxSimultaneous = Math.max(maxSimultaneous, ps.length);
        maxListeners = Math.max(maxListeners, ps.filter((p) => portsOf(p.pid).includes(kit.port)).length);
        await sleep(100);
      }
    })();
    const launches = Array.from({ length: n }, (_, i) => {
      const useRun = kind === "run" || (kind === "mixed" && i % 2 === 0);
      return (useRun ? kit.launch("opencode") : kit.preflight()).then((r) => ({ i, via: useRun ? "run" : "preflight", code: r.code, ms: r.ms, tail: (r.out + r.err).trim().split("\n").slice(-1)[0]?.slice(0, 200) }));
    });
    const adv = adversary ? adversary() : null;
    const results = await Promise.all(launches);
    const advResult = adv ? await adv : null;
    await sleep(1500);
    polling = false;
    await poll;
    const after = proxies();
    const rec = kit.pidRecord();
    const result = {
      name, n, kind, tFrom, tTo: ctx.elapsed(),
      proxiesBefore: before,
      maxSimultaneousProxies: maxSimultaneous,
      maxSimultaneousListeners: maxListeners,
      distinctProxyProcesses: seen.size,
      proxiesAfter: after.length,
      pidFileMatchesListener: !!rec && after.some((p) => p.pid === rec.pid && portsOf(p.pid).includes(kit.port)),
      failedLaunches: results.filter((r) => r.code !== 0).map((r) => `${r.via}#${r.i} code=${r.code} ${r.tail ?? ""}`),
      launchMs: results.map((r) => r.ms).sort((a, b) => a - b),
      staleLockLeft: existsSync(lockFile) ? readFileSync(lockFile, "utf8").slice(0, 120) : null,
      adversary: advResult,
    };
    ctx.log(`${name}: max simultaneous proxies ${maxSimultaneous}, distinct ${seen.size}, failed launches ${result.failedLaunches.length}/${n}, stale lock ${result.staleLockLeft ? "YES" : "no"}`);
    result.stop = await stopAll(name);
    rounds.push(result);
    return result;
  }

  const hungRound = makeHungRound({ kit, proxies, portsOf, round, note: ctx.note, freeze, thaw });
  const killHolder = async () => {
    await round("kill-holder-10", 10, {
      kind: "preflight",
      adversary: async () => {
        let notOurs = null;
        for (let i = 0; i < 200; i++) {
          try {
            const holder = JSON.parse(readFileSync(lockFile, "utf8"));
            if (Number.isInteger(holder.pid)) {
              // Only processes of this run carry the marker: never signal anything else.
              // (Windows sees a new process with the next poll, so keep looking until then.)
              if (scan(ctx.marker).some((p) => p.pid === holder.pid)) {
                process.kill(holder.pid, "SIGKILL");
                return { killed: holder.pid };
              }
              notOurs = holder.pid;
            }
          } catch {}
          await sleep(25);
        }
        return { killed: null, reason: notOurs !== null ? `holder ${notOurs} not ours` : "no holder observed" };
      },
    });
    // What the next session sees after that round (the lock may be stale now).
    const next = await kit.preflight();
    const nextStop = await kit.manager(["stop"], { timeoutMs: 60_000 });
    ctx.note("afterKillHolder", { nextPreflight: next.code, nextPreflightTail: (next.out + next.err).trim().split("\n").slice(-1)[0], stopCode: nextStop.code, stopTail: (nextStop.out + nextStop.err).trim().split("\n").slice(-1)[0], proxiesLeft: proxies().length, staleLock: existsSync(lockFile) });
  };
  const clearStaleLock = async (label) => {
    if (!existsSync(lockFile)) return;
    writeFileSync(`${lockFile}.${label}.evidence`, readFileSync(lockFile));
    unlinkSync(lockFile); // this run's own lock file
    await stopAll(`${label}-cleanup`);
  };

  if (ctx.variant === "omp") return ompLeg();

  // ── S3 OMP stub-host leg ──────────────────────────────────────────────────
  async function ompRound(name, extension, { killStarter = false } = {}) {
    const hosts = Array.from({ length: OMP_LEG.hosts }, () => startOmpHost({ bun: kit.bun, extension, env: kit.env, cwd: kit.dir }));
    const byPid = new Map(hosts.map((h, id) => [h.pid, { id, host: h, preflights: new Set() }]));
    const tFrom = ctx.elapsed();
    let maxConcurrent = 0, maxProxies = 0, killed = null;
    const preflights = new Set();
    let polling = true;
    try {
      const ready = await Promise.all(hosts.map((h) => within(h.ready, 60_000)));
      const notReady = ready.map((r, i) => (r ? null : `host ${i}: ${hosts[i].stderr().trim().split("\n").slice(-1)[0] ?? ""}`)).filter(Boolean);
      if (notReady.length) throw new Error(`${name}: stub OMP host did not start: ${notReady.join("; ")}`);
      // Short-lived preflights: a 50 ms poll sees every overlap.
      const cache = new Map();
      const poll = (async () => {
        while (polling) {
          const procs = scan(ctx.marker, cache);
          const live = procs.filter((p) => p.role === "preflight");
          maxConcurrent = Math.max(maxConcurrent, live.length);
          maxProxies = Math.max(maxProxies, procs.filter((p) => p.role === "proxy").length);
          for (const p of live) {
            preflights.add(p.key);
            const owner = byPid.get(p.ppid);
            if (!owner) continue;
            owner.preflights.add(p.key);
            // The starter: the first host seen with a preflight child, killed with its tree at once.
            if (killStarter && killed === null) { killed = owner; owner.host.killTree(); }
          }
          await sleep(50);
        }
      })();
      for (const h of hosts) h.go();
      // Past the extension's START_TIMEOUT_MS (120 s): a waiter that never returns is a finding.
      const done = await Promise.all(hosts.map((h) => within(Promise.race([h.done, h.exited.then(() => null)]), 150_000)));
      await sleep(1500);
      polling = false;
      await poll;
      const result = {
        name, tFrom, tTo: ctx.elapsed(), killExpected: killStarter,
        maxConcurrentPreflights: maxConcurrent,
        distinctPreflights: preflights.size,
        maxSimultaneousProxies: maxProxies,
        hosts: hosts.map((h, id) => {
          const own = byPid.get(h.pid);
          return {
            id, pid: h.pid, killed: killed === own,
            preflights: own.preflights.size,
            causeLines: causeLinesOf(h.stderr(), PREFLIGHT_WARNINGS),
            costMB: done[id]?.costMB ?? null,
            baselineMB: done[id]?.baselineMB ?? ready[id]?.baselineMB ?? null,
            peakMB: done[id]?.peakMB ?? null,
            metric: ready[id]?.metric ?? null,
            hookMs: done[id]?.ms ?? null,
            finished: done[id] !== null,
            lastLine: h.stderr().trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? "",
          };
        }),
      };
      ctx.log(`${name}: max ${maxConcurrent} OMP preflights at once (${preflights.size} spawned), killed ${killed ? `host ${killed.id}` : "none"}, waiter cost ${result.hosts.filter((x) => !x.killed && x.preflights === 0).map((x) => x.costMB).join("/") || "no waiter"} MB`);
      return result;
    } finally {
      polling = false;
      for (const h of hosts) h.close();
      await Promise.all(hosts.map(async (h) => { if ((await within(h.exited, 10_000, "running")) === "running") h.killTree(); }));
    }
  }

  async function ompLeg() {
    const extension = generateOmpExtension({ root: KIT_ROOT, home: kit.home, keyFile: join(kit.stateDir, ".proxykey"), port: kit.port, key: kit.key });
    const omp = [];
    for (const [name, opts] of [["omp-5", {}], ["omp-5-kill-starter", { killStarter: true }]]) {
      const r = await ompRound(name, extension, opts);
      omp.push(r);
      // A killed starter's preflight may have held the start lock: this run's own lock, cleared as in kill-holder.
      await clearStaleLock(name);
      r.stop = await stopAll(name);
    }
    ctx.note("ompRounds", omp);
    await session.stop();
    const worstProxies = Math.max(0, ...omp.map((r) => r.maxSimultaneousProxies));
    return {
      settleMs: 3000,
      budgets: {
        ...s3Budgets(osLeg()),
        extra: [
          ...ompLegChecks(omp),
          { name: "simultaneous-proxies", red: worstProxies > PROCESSES.proxiesPerInstallation, value: worstProxies, budget: PROCESSES.proxiesPerInstallation, unit: "procs" },
        ],
      },
    };
  }

  if (ctx.variant === "hung") {
    // A hung proxy while a stale lock is present (the chain a killed start leaves) …
    await killHolder();
    await hungRound("hung-10-with-stale-lock");
    await clearStaleLock("hung-stale");
    // … and a clean hung-own recovery raced by 10 launches.
    await hungRound("hung-10");
  } else {
    const reps = ctx.long ? 3 : 1;
    for (let r = 0; r < reps; r++) {
      await round(`race-5#${r}`, 5);
      await round(`race-10#${r}`, 10);
      await round(`race-10-preflight#${r}`, 10, { kind: "preflight" });
    }
    await killHolder();
    await clearStaleLock("kill-holder");
    if (ctx.long) await hungRound("hung-10");
  }

  ctx.note("rounds", rounds);
  // Leave nothing behind: a stale lock blocks `stop`, so remove our own run's
  // lock file explicitly and stop again, then report what was still running.
  const cleanup = { staleLockRemoved: false };
  if (existsSync(lockFile)) {
    await clearStaleLock("final");
    cleanup.staleLockRemoved = true;
  }
  cleanup.finalStop = await stopAll("final");
  // What the kit recorded for a proxy it could not stop (a pid record without a
  // start time makes every stop fail closed: evidence for the orphan check).
  if (cleanup.finalStop.proxiesLeft) cleanup.pidRecordLeft = kit.pidRecord();
  ctx.note("cleanup", cleanup);
  await session.stop();

  const worst = (k) => Math.max(0, ...rounds.map((r) => (Array.isArray(r[k]) ? r[k].length : r[k] ?? 0)));
  const failed = rounds.reduce((a, r) => a + r.failedLaunches.length, 0);
  // Exactly one proxy: every round ends with one proxy, the one proxy.pid names, on the port.
  const notExactlyOne = rounds.filter((r) => r.proxiesAfter !== PROCESSES.proxiesPerInstallation || !r.pidFileMatchesListener);
  return {
    settleMs: 3000,
    budgets: {
      // Part (a) summed kit RSS ≤ the total, part (b) every process within its role target.
      ...s3Budgets(osLeg()),
      extra: [
        { name: "simultaneous-proxies", red: worst("maxSimultaneousProxies") > PROCESSES.proxiesPerInstallation, value: worst("maxSimultaneousProxies"), budget: PROCESSES.proxiesPerInstallation, unit: "procs" },
        { name: "exactly-one-proxy-after-round", red: notExactlyOne.length > 0, value: notExactlyOne.length, budget: 0, unit: "rounds without exactly 1", detail: notExactlyOne.map((r) => `${r.name}: ${r.proxiesAfter} proxies, pid file ${r.pidFileMatchesListener ? "matches" : "does not match"}`) },
        // A hung-own recovery legitimately replaces the proxy once.
        { name: "proxy-generations/round", red: rounds.some((r) => r.distinctProxyProcesses > (r.name.startsWith("hung") ? 2 : 1)), value: worst("distinctProxyProcesses"), budget: 1, unit: "procs" },
        { name: "failed-launches", red: failed > PROCESSES.failedLaunches, value: failed, budget: PROCESSES.failedLaunches, unit: "launches" },
        { name: "stale-lock-after-round", red: rounds.filter((r) => r.staleLockLeft).length > PROCESSES.staleLocks, value: rounds.filter((r) => r.staleLockLeft).length, budget: PROCESSES.staleLocks, unit: "rounds" },
      ],
    },
  };
}
