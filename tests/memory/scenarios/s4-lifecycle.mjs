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
// Last, induced memory pressure on the real proxy (ticket 23, `pressure:*`).
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { startProxySession } from "../lib/proxy-session.mjs";
import { KIT_ROOT } from "../lib/isolated-kit.mjs";
import { scan, settled, portsOf } from "../lib/sampler.mjs";
import { PROCESSES, PROXY_COMMIT_BACKSTOP } from "../lib/budgets.mjs";
import { DELIVERY_LABELS, findReleaseLine, judgeWindowsTrial, parseSenderOut, parseSpawnerOut, reapAll, senderScript, spawnHelper, spawnerScript, waitForPidLine } from "../lib/win-console-event.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Induced memory pressure (ticket 23; ADR-0008 cond 1, ADR-0015, spec §18
// PROCESSES): the real proxy, started by the real manager, with its hard limit
// at 65 MB held for 3 samples 2 s apart, under a load of one ~5.4 MB request
// at a time that keeps every fresh proxy above it (light enough to stay far
// below the windows leg's 512 MB commit backstop). Each respawn the manager acknowledges
// drains the proxy and starts a fresh one; it allows 3 per 15 min, so the 4th
// request is refused, and the proxy that asked must keep serving (before
// ticket 23 it drained anyway: no proxy at all) and spawn no further hook.
const PRESSURE_CONFIG = "health:\n  memory:\n    softLimitMB: 64\n    hardLimitMB: 65\n    samples: 3\n    sampleIntervalSeconds: 2\n";
const PRESSURE_OBSERVE_SAMPLES = 40; // × 250 ms after the refusal

async function memoryPressure(ctx, kit, proxies, settle) {
  const logFile = join(kit.logDir, "proxy.log");
  // Only this phase's lines: after a marker line, across a rotation (proxy.log.1).
  const marker = `[s4] memory pressure phase ${Date.now()}`;
  appendFileSync(logFile, marker + "\n");
  const logText = () => {
    let text = "";
    for (const f of [`${logFile}.1`, logFile]) { try { text += readFileSync(f, "utf8"); } catch {} }
    const at = text.lastIndexOf(marker);
    return at === -1 ? "" : text.slice(at);
  };
  const count = (re) => (logText().match(re) ?? []).length;
  const MANAGER_REFUSED = /respawn refused: 3 restarts in 15 min/;
  const HOOKS = /respawn: requested for pid \d+ \(reason memory\)/g;
  const original = readFileSync(kit.config, "utf8");
  const out = { startCode: null, refusalSeen: false, samplesBefore: 0, maxProxiesBefore: 0, after: [], restartsReserved: null, hooksAtRefusal: null, hooksAfterObservation: null, errorLines: null, loadRequests: 0, loadFailures: 0 };
  writeFileSync(kit.config, original + PRESSURE_CONFIG);
  let active = true;
  const loaders = [];
  try {
    const started = await kit.manager(["start"]);
    out.startCode = started.code;
    const body = JSON.stringify({ model: "glm-5.3", max_tokens: 64, messages: [{ role: "user", content: "lorem ipsum dolor sit amet ".repeat(200_000) + "[[mock:ok]] pressure" }] });
    const headers = { authorization: `Bearer ${kit.key}`, "content-type": "application/json" };
    for (let i = 0; i < 1; i++) {
      loaders.push((async () => {
        while (active) {
          out.loadRequests++;
          try { await (await fetch(`${kit.base}/v1/messages`, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) })).text(); }
          catch { out.loadFailures++; await sleep(200); } // the gap between two proxies
        }
      })());
    }
    const deadline = Date.now() + 240_000;
    while (!MANAGER_REFUSED.test(logText()) && Date.now() < deadline) {
      out.samplesBefore++;
      out.maxProxiesBefore = Math.max(out.maxProxiesBefore, proxies().length);
      await sleep(250);
    }
    out.refusalSeen = MANAGER_REFUSED.test(logText());
    out.hooksAtRefusal = count(HOOKS);
    if (out.refusalSeen) {
      // The proxy whose request was refused, still under the load.
      await sleep(1_000);
      for (let i = 0; i < PRESSURE_OBSERVE_SAMPLES; i++) {
        out.after.push({ proxies: proxies().length, healthy: (await kit.health(2000)) !== null });
        await sleep(250);
      }
    }
    out.hooksAfterObservation = count(HOOKS);
    out.errorLines = count(/ ERROR supervisor respawn (?:refused|not acknowledged) by the kit manager; keeps serving [^\n]*restarts=exhausted/g);
    try { out.restartsReserved = JSON.parse(readFileSync(join(kit.logDir, "respawn.json"), "utf8")).events.length; } catch { out.restartsReserved = null; }
  } finally {
    active = false;
    await Promise.all(loaders);
    writeFileSync(kit.config, original);
    await settle();
  }
  ctx.log(`memory pressure: refusal ${out.refusalSeen}, restarts ${out.restartsReserved}, after ${out.after.filter((s) => s.proxies === 1 && s.healthy).length}/${out.after.length} serving`);
  return out;
}

function pressureChecks(p) {
  const notOne = p.after.filter((s) => s.proxies !== 1 || !s.healthy).length;
  return [
    { name: "pressure:refusal-reached", red: !p.refusalSeen, value: p.refusalSeen ? 1 : 0, budget: 1, unit: "budget refusal under pressure" },
    { name: "pressure:restarts-in-window", red: p.restartsReserved === null || p.restartsReserved > PROCESSES.respawnsPer15Min, value: p.restartsReserved ?? "unreadable", budget: PROCESSES.respawnsPer15Min, unit: "restarts/15min" },
    { name: "pressure:max-proxies", red: p.maxProxiesBefore > PROCESSES.proxiesPerInstallation, value: p.maxProxiesBefore, budget: PROCESSES.proxiesPerInstallation, unit: "procs" },
    { name: "pressure:serving-proxy-after-refusal", red: !p.refusalSeen || notOne > 0, value: p.refusalSeen ? notOne : "not reached", budget: 0, unit: `samples of ${p.after.length} without exactly 1 healthy proxy` },
    { name: "pressure:hooks-after-refusal", red: p.hooksAtRefusal === null || p.hooksAfterObservation !== p.hooksAtRefusal, value: (p.hooksAfterObservation ?? 0) - (p.hooksAtRefusal ?? 0), budget: 0, unit: "hooks" },
    { name: "pressure:error-lines", red: p.refusalSeen && p.errorLines !== 1, value: p.errorLines, budget: 1, unit: "lines" },
  ];
}

export async function run(ctx) {
  const session = await startProxySession(ctx, { startProxy: false });
  const { kit } = session;
  const lockFile = join(kit.logDir, "manager.lock");
  const proxies = () => scan(ctx.marker).filter((p) => p.role === "proxy");
  // What is left after a lifecycle step is read from the process table as it is
  // after the step (on Windows the first poll that started after it): a proxy
  // that exited is never counted, whatever its pid names by then (ticket 73).
  const settle = () => settled(ctx.marker);
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
      await ctx.observe(`after-proxy-sigkill:cycle-${i}`); // no solver may outlive its proxy
      await step(["start"]); // the next harness session after a crash
      await step(["stop"]);
    } else {
      await step(["start"]);
      await step(["stop"]); // update: stopProxyIfRunning … code swap … setup …
      await step(["start"]); // … restart on the new code
      await step(["stop"]);
    }
    await settle();
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
    await settle();
    storm.push({ k, pid, code: r.code, newPid: kit.pidRecord()?.pid, proxies: proxies().length, last: (r.out + r.err).trim().split("\n").slice(-1)[0]?.slice(0, 160) });
  }
  ctx.note("respawnStorm", storm);
  ctx.note("respawnHistory", (() => { try { return JSON.parse(readFileSync(join(kit.logDir, "respawn.json"), "utf8")).events.length; } catch { return null; } })());
  await kit.manager(["stop"]);

  // Ctrl-C during start: interrupt the manager once it holds the lock. Linux
  // delivers SIGINT via child.kill, unchanged from ticket 17's trial (round 33
  // condition 4e: only the additive label differs). Windows delivers a REAL
  // console control event (ticket 81, Owner Proxy round 33): a helper creates
  // the trial child with CREATE_NEW_PROCESS_GROUP and a second helper sends
  // GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, <child pid>) — the child's own
  // group, never group 0, never CTRL_C_EVENT — with per-trial proof of
  // delivery (the child's own `start lock released on signal signal=SIGBREAK`
  // event line, or the console-event death 0xC000013A when no handler ran, as
  // in the round-33 mutant). A trial whose delivery cannot be proven is a
  // harness failure, never GREEN, never a fallback to child.kill.
  const isWindows = process.platform === "win32";
  const method = isWindows ? DELIVERY_LABELS.windows : DELIVERY_LABELS.linux;
  const managerPath = join(KIT_ROOT, "proxy", "zcode-proxy-manager.mjs");
  const sigint = [];
  for (let t = 0; t < (ctx.long ? 20 : 8); t++) {
    const delayMs = (t % 8) * 150;
    const entry = { trial: t, method, ...(isWindows && t === 0 ? { selfTest: true } : {}) };
    const trialStartMs = Date.now();
    const helperPids = []; // reaped at the end of the trial and on every failure path (round 33 condition 4b)
    let child = null; // linux: the trial child
    let win = null; // windows: { childPid, spawner, sender, senderReport, childExitCode }
    let sent = false;
    try {
      if (isWindows) {
        win = {};
        const spawner = spawnHelper(spawnerScript(process.execPath, [managerPath, "start"]), kit.env, { timeoutMs: 180_000 });
        helperPids.push(spawner.pid);
        win.spawner = spawner;
        const withPid = await waitForPidLine(spawner, { timeoutMs: 60_000 });
        if (withPid.childPid === null) {
          const reaped = reapAll(helperPids);
          entry.helpersReaped = reaped.pids;
          throw new Error(`windows S4 trial ${t}: the spawner helper created no trial child (createError ${withPid.createError}) — spawner out: ${(spawner.state.out() || "(none)").slice(-300)} err: ${(spawner.state.err() || "(none)").slice(-300)}`);
        }
        win.childPid = withPid.childPid;
        entry.childPid = win.childPid;
        for (let k = 0; k < 400 && !sent; k++) {
          // Vary the moment exactly as on linux: right after the lock (before
          // spawn) up to ~1 s later (proxy spawned, health wait running). The
          // sender's own start-up latency is part of the recorded evidence.
          try {
            if (JSON.parse(readFileSync(lockFile, "utf8")).pid === win.childPid) {
              await sleep(delayMs);
              const sender = spawnHelper(senderScript(win.childPid), kit.env, { timeoutMs: 60_000 });
              helperPids.push(sender.pid);
              win.sender = sender;
              const senderDone = await sender.done;
              const parsed = parseSenderOut(senderDone.out);
              win.senderReport = { sent: parsed.sent, error: parsed.error, timedOut: senderDone.timedOut, code: senderDone.code };
              entry.sender = win.senderReport;
              sent = parsed.sent;
            }
          } catch {}
          if (!sent) await sleep(10);
        }
        entry.sent = sent;
        const spawnerDone = await spawner.done;
        if (spawnerDone.timedOut) {
          // The helper still holds a handle on the child, so the child's pid
          // is still the child's: end the child first, then the helper.
          const reapedChild = reapAll([win.childPid]);
          const reapedHelpers = reapAll(helperPids);
          entry.helpersReaped = [...reapedChild.pids, ...reapedHelpers.pids];
          throw new Error(`windows S4 trial ${t}: the spawner helper did not report the child's exit (child ${win.childPid}, reaped ${entry.helpersReaped.join(", ")})`);
        }
        win.childExitCode = parseSpawnerOut(spawnerDone.out).childExitCode;
        entry.childExitCode = win.childExitCode;
      } else {
        child = spawn(process.execPath, [managerPath, "start"], { env: kit.env, stdio: "ignore" });
        for (let k = 0; k < 400 && !sent; k++) {
          // Vary the moment: right after the lock (before spawn) up to ~1 s later
          // (proxy spawned, health wait running).
          try { if (JSON.parse(readFileSync(lockFile, "utf8")).pid === child.pid) { await sleep(delayMs); child.kill("SIGINT"); sent = true; } } catch {}
          if (!sent) await sleep(10);
        }
        entry.sent = sent;
        await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
      }
      await sleep(500);
      await settle();
      const stale = existsSync(lockFile);
      const orphanedChild = proxies().map((p) => p.pid);
      const pidRecord = kit.pidRecord();
      const nextStart = await kit.manager(["start"], { timeoutMs: 60_000 });
      const nextStop = await kit.manager(["stop"], { timeoutMs: 60_000 });
      await settle();
      Object.assign(entry, { delayMs, sent, staleLock: stale, childSurvived: orphanedChild.length > 0, pidRecordStartedMs: pidRecord ? pidRecord.startedMs ?? null : "no record", nextStart: nextStart.code, nextStop: nextStop.code, nextStopTail: (nextStop.out + nextStop.err).trim().split("\n").slice(-1)[0]?.slice(0, 200), proxiesAfter: proxies().length });
      if (isWindows) {
        const proof = findReleaseLine(kit.logDir, win.childPid, { notBeforeMs: trialStartMs });
        entry.proof = proof?.line ?? null;
        entry.proofFile = proof?.file ?? null;
        const judge = judgeWindowsTrial({ first: t === 0, sender: win.senderReport ?? { sent: false, timedOut: false, error: "the sender never ran (the lock never named the child)" }, childExitCode: win.childExitCode, releaseLine: proof });
        entry.delivered = judge.delivered;
        if (judge.proofVia) entry.proofVia = judge.proofVia;
        if (judge.reason) entry.reason = judge.reason;
        if (judge.failure) {
          throw new Error(`windows S4 trial ${t} (ticket 81, round 33 condition 4c): harness failure — ${judge.failure}. Trial evidence: ${JSON.stringify({ ...entry, spawnerErr: (win.spawner?.state.err() ?? "").slice(-200) }).slice(0, 1200)}`);
        }
      }
      // Clean state for the next trial: our own lock file, then the kit's stop
      // once more; whatever the kit still cannot stop is ours and is killed here.
      if (existsSync(lockFile)) unlinkSync(lockFile);
      if (proxies().length) {
        const retry = await kit.manager(["stop"], { timeoutMs: 60_000 });
        entry.stopAfterLockRemoved = retry.code;
        await settle();
        for (const p of proxies()) { try { process.kill(p.pid, "SIGKILL"); entry.killedByHarness = (entry.killedByHarness ?? 0) + 1; } catch {} }
        try { unlinkSync(join(kit.logDir, "proxy.pid")); } catch {}
      }
      sigint.push(entry);
    } finally {
      if (isWindows) {
        const reap = reapAll(helperPids);
        if (reap.count) entry.helpersReaped = [...(entry.helpersReaped ?? []), ...reap.pids];
      }
    }
  }
  const provenByReleaseLine = sigint.filter((s) => s.proofVia === "release-line").length;
  const provenByEventExit = sigint.filter((s) => s.proofVia === "event-exit").length;
  const startCompletedFirst = sigint.filter((s) => !s.delivered && s.reason).length;
  ctx.note("sigintDelivery", {
    method,
    trials: sigint.length,
    delivered: isWindows ? sigint.filter((s) => s.delivered).length : sigint.filter((s) => s.sent).length,
    provenByReleaseLine: isWindows ? provenByReleaseLine : null,
    provenByEventExit: isWindows ? provenByEventExit : null,
    startCompletedFirst: isWindows ? startCompletedFirst : null,
    selfTest: isWindows ? "trial 0: delivery must be proven or the run fails (round 33 condition 4c)" : null,
  });
  ctx.log(`ctrl-c trials delivered ${method}: ${sigint.filter((s) => s.delivered ?? s.sent).length}/${sigint.length} delivered (release line ${provenByReleaseLine}, event exit ${provenByEventExit}), start completed first ${startCompletedFirst}`);
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
  await settle();
  Object.assign(staleRespawn, { respawnCode: rr.code, respawnTail: (rr.out + rr.err).trim().split("\n").slice(-1)[0]?.slice(0, 200), proxiesAfter: proxies().length, healthy: (await kit.health()) !== null });
  // Since ticket 16 the kit takes this dead holder's lock over (proof: pid
  // dead), so it may be gone already; remove it only if it is still there.
  staleRespawn.staleLockLeft = existsSync(lockFile);
  if (staleRespawn.staleLockLeft) unlinkSync(lockFile);
  ctx.note("respawnWithStaleLock", staleRespawn);

  await kit.manager(["stop"]);
  // The stale-lock phase used one slot of this run's restart budget.
  try { unlinkSync(join(kit.logDir, "respawn.json")); } catch {}
  const pressure = await memoryPressure(ctx, kit, proxies, settle);
  ctx.note("memoryPressure", pressure);

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
        { name: "stale-lock-after-ctrl-c", red: staleAfterSigint > PROCESSES.staleLocks, value: staleAfterSigint, budget: PROCESSES.staleLocks, unit: `of ${sigint.length} (${method})` },
        { name: "unstoppable-proxy-after-ctrl-c", red: unstoppable > 0, value: unstoppable, budget: 0, unit: `of ${sigint.length}` },
        { name: "respawn-recovers-despite-stale-lock", red: !staleRespawn.healthy, value: staleRespawn.healthy ? 1 : 0, budget: 1, unit: "proxy up" },
        { name: "respawns-in-window", red: respawnsDone > PROCESSES.respawnsPer15Min, value: respawnsDone, budget: PROCESSES.respawnsPer15Min, unit: "restarts/15min" },
        ...pressureChecks(pressure),
        { name: "log-dir-files", red: (cycles.at(-1)?.logFiles ?? 0) > PROCESSES.logDirFiles, value: cycles.at(-1)?.logFiles ?? 0, budget: PROCESSES.logDirFiles, unit: "files" },
      ],
    },
  };
}
