// S4 Lifecycle: repeated start/stop/restart, crash (SIGKILL) + start, and a
// simulated update (stop → start, which is what every update path does around
// its code swap), all through the real manager CLI. After every cycle: is
// anything still running or listening, what did the cycle leave in logs/?
// Every crash cycle counts solver processes right after the proxy's SIGKILL
// (0 allowed), and every sample allows ≤ 1 solver per proxy. With today's
// coding-plan proxy no solver spawns; the counts become live with the solver
// process (ticket 27).
// Then two adversarial checks:
//   - Ctrl-C (SIGINT) of a `proxy start` while it holds the start lock;
//   - a respawn storm: the proxy's own restart hook asked 6 times in a row
//     (the manager allows 3 per 15 minutes).
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { startProxySession } from "../lib/proxy-session.mjs";
import { KIT_ROOT } from "../lib/isolated-kit.mjs";
import { scan, portsOf } from "../lib/sampler.mjs";
import { PROCESSES, PROXY_COMMIT_BACKSTOP } from "../lib/budgets.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(ctx) {
  const session = await startProxySession(ctx, { startProxy: false });
  const { kit } = session;
  const lockFile = join(kit.logDir, "manager.lock");
  const proxies = () => scan(ctx.marker).filter((p) => p.role === "proxy");
  const listening = () => proxies().filter((p) => portsOf(p.pid).includes(kit.port)).length;
  const logFiles = () => readdirSync(kit.logDir).sort();
  const cycles = [];
  const n = ctx.long ? 200 : 50;
  const plan = Array.from({ length: n }, (_, i) => ["start-stop", "restart", "crash", "update"][i % 10 < 4 ? 0 : i % 10 < 8 ? 1 : i % 10 === 8 ? 2 : 3]);

  for (let i = 0; i < n; i++) {
    const kind = plan[i];
    const rec = { i, kind, codes: [] };
    const step = async (args) => { const r = await kit.manager(args, { timeoutMs: 90_000 }); rec.codes.push(`${args[0]}=${r.code}`); return r; };
    if (kind === "start-stop") { await step(["start"]); await step(["stop"]); }
    else if (kind === "restart") { await step(["start"]); await step(["restart"]); await step(["stop"]); }
    else if (kind === "crash") {
      await step(["start"]);
      const pid = kit.pidRecord()?.pid;
      if (pid && proxies().some((p) => p.pid === pid)) process.kill(pid, "SIGKILL");
      await sleep(300);
      ctx.observe(`after-proxy-sigkill:cycle-${i}`); // no solver may outlive its proxy
      await step(["start"]); // the next harness session after a crash
      await step(["stop"]);
    } else {
      await step(["start"]);
      await step(["stop"]); // update: stopProxyIfRunning … code swap … setup …
      await step(["start"]); // … restart on the new code
      await step(["stop"]);
    }
    rec.proxiesAfter = proxies().length;
    rec.listenersAfter = listening();
    rec.lockLeft = existsSync(lockFile);
    rec.logFiles = logFiles().length;
    rec.proxyLogBytes = existsSync(join(kit.logDir, "proxy.log")) ? statSync(join(kit.logDir, "proxy.log")).size : 0;
    rec.failed = rec.codes.filter((c) => !c.endsWith("=0"));
    cycles.push(rec);
    ctx.setProgress(i + 1);
    if (rec.proxiesAfter || rec.lockLeft || rec.failed.length) ctx.log(`cycle ${i} ${kind}: ${rec.codes.join(" ")} proxiesAfter=${rec.proxiesAfter} lock=${rec.lockLeft}`);
  }
  ctx.note("cycles.summary", {
    cycles: n,
    withLeftoverProxy: cycles.filter((c) => c.proxiesAfter).length,
    withListenerAfterStop: cycles.filter((c) => c.listenersAfter).length,
    withLockLeft: cycles.filter((c) => c.lockLeft).length,
    failedSteps: cycles.flatMap((c) => c.failed.map((f) => `${c.i}:${c.kind}:${f}`)),
    logFilesFirst: cycles[0]?.logFiles, logFilesLast: cycles.at(-1)?.logFiles, logDir: logFiles(),
    proxyLogBytesLast: cycles.at(-1)?.proxyLogBytes,
  });

  // Respawn storm: the proxy asks for a restart (memory guard / watchdog path).
  const storm = [];
  await kit.manager(["start"]);
  for (let k = 0; k < 6; k++) {
    const pid = kit.pidRecord()?.pid;
    const r = await kit.manager(["respawn", String(pid), "--reason", "memory"], { timeoutMs: 120_000 });
    storm.push({ k, pid, code: r.code, newPid: kit.pidRecord()?.pid, proxies: proxies().length, last: (r.out + r.err).trim().split("\n").slice(-1)[0]?.slice(0, 160) });
  }
  ctx.note("respawnStorm", storm);
  ctx.note("respawnHistory", (() => { try { return JSON.parse(readFileSync(join(kit.logDir, "respawn.json"), "utf8")).events.length; } catch { return null; } })());
  await kit.manager(["stop"]);

  // Ctrl-C during start: SIGINT the manager once it holds the lock.
  const sigint = [];
  for (let t = 0; t < (ctx.long ? 20 : 8); t++) {
    const child = spawn(process.execPath, [join(KIT_ROOT, "proxy", "zcode-proxy-manager.mjs"), "start"], { env: kit.env, stdio: "ignore" });
    let sent = false;
    for (let k = 0; k < 400 && !sent; k++) {
      // Vary the moment: right after the lock (before spawn) up to ~1 s later
      // (proxy spawned, health wait running).
      try { if (JSON.parse(readFileSync(lockFile, "utf8")).pid === child.pid) { await sleep((t % 8) * 150); child.kill("SIGINT"); sent = true; } } catch {}
      if (!sent) await sleep(10);
    }
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
    await sleep(500);
    const stale = existsSync(lockFile);
    const orphanedChild = proxies().map((p) => p.pid);
    const pidRecord = kit.pidRecord();
    const nextStart = await kit.manager(["start"], { timeoutMs: 60_000 });
    const nextStop = await kit.manager(["stop"], { timeoutMs: 60_000 });
    const entry = { delayMs: (t % 8) * 150, sent, staleLock: stale, childSurvived: orphanedChild.length > 0, pidRecordStartedMs: pidRecord ? pidRecord.startedMs ?? null : "no record", nextStart: nextStart.code, nextStop: nextStop.code, nextStopTail: (nextStop.out + nextStop.err).trim().split("\n").slice(-1)[0]?.slice(0, 200), proxiesAfter: proxies().length };
    // Clean state for the next trial: our own lock file, then the kit's stop
    // once more; whatever the kit still cannot stop is ours and is killed here.
    if (existsSync(lockFile)) unlinkSync(lockFile);
    if (proxies().length) {
      const retry = await kit.manager(["stop"], { timeoutMs: 60_000 });
      entry.stopAfterLockRemoved = retry.code;
      for (const p of proxies()) { try { process.kill(p.pid, "SIGKILL"); entry.killedByHarness = (entry.killedByHarness ?? 0) + 1; } catch {} }
      try { unlinkSync(join(kit.logDir, "proxy.pid")); } catch {}
    }
    sigint.push(entry);
  }
  ctx.note("sigintDuringStart", sigint);

  // The proxy's own restart path with a stale lock present (what a Ctrl-C'd
  // start leaves): the memory guard / watchdog launch `respawn <pid>` and then
  // exit. Emulated exactly: respawn for the recorded pid, then the proxy exits.
  // The storm above used this run's restart budget; reset that history first.
  try { unlinkSync(join(kit.logDir, "respawn.json")); } catch {}
  const staleRespawn = {};
  await kit.manager(["start"]);
  const victim = kit.pidRecord()?.pid;
  writeFileSync(lockFile, JSON.stringify({ pid: 2147483646, startedAt: new Date(0).toISOString(), nonce: "s4-stale" }));
  const respawning = kit.manager(["respawn", String(victim), "--reason", "memory"], { timeoutMs: 120_000 });
  await sleep(1000);
  try { process.kill(victim, "SIGTERM"); } catch {}
  const rr = await respawning;
  await sleep(1000);
  Object.assign(staleRespawn, { respawnCode: rr.code, respawnTail: (rr.out + rr.err).trim().split("\n").slice(-1)[0]?.slice(0, 200), proxiesAfter: proxies().length, healthy: (await kit.health()) !== null });
  unlinkSync(lockFile);
  ctx.note("respawnWithStaleLock", staleRespawn);

  await kit.manager(["stop"]);
  await session.stop();

  const leftovers = cycles.filter((c) => c.proxiesAfter || c.listenersAfter).length;
  const staleAfterSigint = sigint.filter((s) => s.staleLock).length;
  const unstoppable = sigint.filter((s) => s.stopAfterLockRemoved !== undefined && s.stopAfterLockRemoved !== 0).length;
  const respawnsDone = storm.filter((s) => s.code === 0).length;
  return {
    budgets: {
      counts: { proxy: PROCESSES.proxiesPerInstallation },
      commitBackstop: PROXY_COMMIT_BACKSTOP, // paced (Round 7 Q1)
      perParent: [{ role: "solver", max: PROCESSES.solversPerProxy }],
      observed: [{ name: "solver:after-proxy-sigkill", label: "after-proxy-sigkill", role: "solver", max: PROCESSES.solversAfterProxyKill }],
      orphans: PROCESSES.orphans,
      extra: [
        { name: "proxy-left-after-stop", red: leftovers > 0, value: leftovers, budget: 0, unit: "cycles" },
        { name: "failed-lifecycle-steps", red: cycles.some((c) => c.failed.length), value: cycles.reduce((a, c) => a + c.failed.length, 0), budget: 0, unit: "steps" },
        { name: "stale-lock-after-ctrl-c", red: staleAfterSigint > PROCESSES.staleLocks, value: staleAfterSigint, budget: PROCESSES.staleLocks, unit: `of ${sigint.length}` },
        { name: "unstoppable-proxy-after-ctrl-c", red: unstoppable > 0, value: unstoppable, budget: 0, unit: `of ${sigint.length}` },
        { name: "respawn-recovers-despite-stale-lock", red: !staleRespawn.healthy, value: staleRespawn.healthy ? 1 : 0, budget: 1, unit: "proxy up" },
        { name: "respawns-in-window", red: respawnsDone > PROCESSES.respawnsPer15Min, value: respawnsDone, budget: PROCESSES.respawnsPer15Min, unit: "restarts/15min" },
        { name: "log-dir-files", red: (cycles.at(-1)?.logFiles ?? 0) > PROCESSES.logDirFiles, value: cycles.at(-1)?.logFiles ?? 0, budget: PROCESSES.logDirFiles, unit: "files" },
      ],
    },
  };
}
