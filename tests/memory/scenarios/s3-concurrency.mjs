// S3 Concurrency: N simultaneous harness launches against ONE isolated
// installation, through the two real entry points:
//   - `zcode-kit run opencode` (cli/zcode-kit.mjs → launch.mjs → startupPreflight)
//     with a fake `opencode` that holds one MCP bridge session (fixtures/fake-session.mjs);
//   - the OMP autostart preflight (`node cli/heal.mjs --diagnostic-code`).
// The guarantee under test is its PURPOSE, not the happy path: every launch
// ends with a working proxy, there is never more than one proxy, and nothing
// the race leaves behind (locks, pids, processes) blocks the next session.
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
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startProxySession } from "../lib/proxy-session.mjs";
import { KIT_ROOT } from "../lib/isolated-kit.mjs";
import { scan, portsOf } from "../lib/sampler.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(ctx) {
  const session = await startProxySession(ctx, { startProxy: false });
  const { kit } = session;
  // Fake harness binary on PATH (opencode needs no generated config).
  const bin = join(kit.dir, "fake-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "opencode"), `#!/bin/sh\nexec "${process.execPath}" "${join(KIT_ROOT, "tests", "memory", "fixtures", "fake-session.mjs")}"\n`);
  chmodSync(join(bin, "opencode"), 0o755);
  kit.env.PATH = `${bin}:${kit.env.PATH}`;
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

  const hungRound = async (name) => {
    const start = await kit.manager(["start"]);
    const pid = kit.pidRecord()?.pid;
    if (start.code !== 0 || !pid) return ctx.note(`${name}.skipped`, start.code);
    await sleep(65_000); // past the manager's 60 s startup grace
    process.kill(pid, "SIGSTOP"); // our own proxy, frozen: /health stops answering
    try { await round(name, 10, { kind: "mixed" }); }
    finally { try { process.kill(pid, "SIGCONT"); } catch {} }
  };
  const killHolder = async () => {
    await round("kill-holder-10", 10, {
      kind: "preflight",
      adversary: async () => {
        for (let i = 0; i < 200; i++) {
          try {
            const holder = JSON.parse(readFileSync(lockFile, "utf8"));
            if (Number.isInteger(holder.pid)) {
              // Only processes of this run carry the marker: never signal anything else.
              if (!scan(ctx.marker).some((p) => p.pid === holder.pid)) return { killed: null, reason: "holder not ours" };
              process.kill(holder.pid, "SIGKILL");
              return { killed: holder.pid };
            }
          } catch {}
          await sleep(25);
        }
        return { killed: null, reason: "no holder observed" };
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
  ctx.note("cleanup", cleanup);
  await session.stop();

  const worst = (k) => Math.max(0, ...rounds.map((r) => (Array.isArray(r[k]) ? r[k].length : r[k] ?? 0)));
  const failed = rounds.reduce((a, r) => a + r.failedLaunches.length, 0);
  return {
    settleMs: 3000,
    budgets: {
      counts: { proxy: 1 },
      peaks: { kit: 600 },
      orphans: 0,
      extra: [
        { name: "simultaneous-proxies", red: worst("maxSimultaneousProxies") > 1, value: worst("maxSimultaneousProxies"), budget: 1, unit: "procs" },
        // A hung-own recovery legitimately replaces the proxy once.
        { name: "proxy-generations/round", red: rounds.some((r) => r.distinctProxyProcesses > (r.name.startsWith("hung") ? 2 : 1)), value: worst("distinctProxyProcesses"), budget: 1, unit: "procs" },
        { name: "failed-launches", red: failed > 0, value: failed, budget: 0, unit: "launches" },
        { name: "stale-lock-after-round", red: rounds.some((r) => r.staleLockLeft), value: rounds.filter((r) => r.staleLockLeft).length, budget: 0, unit: "rounds" },
      ],
    },
  };
}
