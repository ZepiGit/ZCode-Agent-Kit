#!/usr/bin/env node
// Memory loop entry point: one command per scenario.
//
//   node tests/memory/run.mjs <S1..S7> [--profile short|long] [--variant NAME] [--out DIR]
//
// Each scenario drives the real code against an isolated instance (see
// lib/isolated-kit.mjs) and the soak mock or fixtures, while lib/sampler.mjs
// records per-process RSS, peak RSS, threads, FDs and (where reachable) JS heap
// once per second into samples.csv. The verdict (lib/verdict.mjs, budgets in
// lib/budgets.mjs) is written to summary.json together with the run key
// (lib/catalogue.mjs) the expected-RED ratchet uses;
// exit code 1 = RED, 0 = GREEN, 2 = harness failure (incl. usage errors).
// The whole job with the ratchet: tests/memory/job.mjs.
//
// Must run under a hard memory cap with an isolated HOME (run-capped.sh in the
// overhaul; ZCODE_MEMLOOP_ALLOW=1 in CI where the runner itself is disposable).
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { countRoles, startSampler, survivors, supported } from "./lib/sampler.mjs";
import { osVerdict } from "./lib/verdict.mjs";
import { assertSafeRun, bunPath, KIT_ROOT, prepareRunBun } from "./lib/isolated-kit.mjs";
import { proxyBunTracker, runtimeEnv } from "./lib/runtime-probe.mjs";
import { CATALOGUE, PROFILES, runKey } from "./lib/catalogue.mjs";

function parseArgs(argv) {
  const out = { scenario: argv[0], profile: "short", out: null, variant: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--profile") out.profile = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--variant") out.variant = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entry = CATALOGUE[args.scenario];
  if (!entry || !PROFILES.includes(args.profile) || (args.variant !== null && !entry.variants.includes(args.variant))) {
    console.error(`usage: node tests/memory/run.mjs <${Object.keys(CATALOGUE).join("|")}> [--profile ${PROFILES.join("|")}] [--variant NAME] [--out DIR]`);
    if (entry && args.variant !== null) console.error(`  variants of ${args.scenario}: ${entry.variants.join(", ") || "(none)"}`);
    return 2;
  }
  try { assertSafeRun(); } catch (err) { console.error(`memory loop: ${err.message}`); return 2; }
  if (!supported()) {
    console.error(`memory loop: platform ${process.platform} has no sampler (Linux /proc and Windows only) — skipped`);
    return 2;
  }
  const id = `${args.scenario}-${args.profile}${args.variant ? `-${args.variant}` : ""}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
  const outDir = resolve(args.out ?? process.env.ZCODE_MEMLOOP_OUT ?? join(KIT_ROOT, ".memloop"), id);
  mkdirSync(outDir, { recursive: true });
  const marker = `ZCODE_MEMLOOP_RUN=${id}`;
  // Children inherit the marker; this process itself was exec'd without it,
  // so the runner never counts itself.
  process.env.ZCODE_MEMLOOP_RUN = id;
  // Windows cannot read another process's environment: every Bun process of
  // the run (proxy, S2 body) starts from the run's own bun copy, so its
  // executable path carries the run id (the sampler's run token).
  let runBun = null;
  if (process.platform === "win32") {
    try { runBun = prepareRunBun(outDir); process.env.ZCODE_KIT_BUN = runBun.path; } catch (err) { console.error(`memory loop: cannot prepare the run's bun copy: ${err.message}`); return 2; }
  }

  const key = runKey(args.scenario, args);
  const mod = await import(entry.module);
  let progress = 0;
  const heapByPid = {};
  const probes = [];
  const notes = {};
  const observations = [];
  const ctx = {
    id, outDir, marker, profile: args.profile, variant: args.variant,
    long: args.profile === "long",
    setProgress(n) { progress = n; },
    addProgress(n = 1) { progress += n; },
    addHeapProbe(fn) { probes.push(fn); },
    reportHeap(pid, mb) { heapByPid[pid] = mb; },
    note(k, value) { notes[k] = value; },
    /** Count the marked processes per role right now, under a label the budgets name. */
    observe(label) { const counts = countRoles(marker); observations.push({ label, tMs: ctx.elapsed(), counts }); return counts; },
    log(line) { console.log(`[${args.scenario}] ${line}`); },
  };
  // Measurement mode only (job.mjs --measure-burst1 sets it; Round 10 Q1
  // condition 1): the runtime environment inside this cap scope, before the
  // sampler starts, and the Bun every proxy of the run actually executes.
  let bunTracker = null;
  if (process.env.ZCODE_MEMLOOP_MEASURE_PROBES === "1") {
    notes.runtimeEnv = runtimeEnv({ bun: bunPath() });
    bunTracker = proxyBunTracker();
    probes.push((snaps) => bunTracker.probe(snaps));
  }
  const recordBun = () => {
    if (!bunTracker) return;
    notes.bunRuntime = bunTracker.resolve();
    console.log(`[${args.scenario}] runtime Bun of the proxy: ${notes.bunRuntime.proxies.map((p) => `pid ${p.pid} ${p.revision ?? "unknown"} (${p.exe ?? "no executable"})`).join("; ") || "no proxy seen"}`);
  };
  const sampler = startSampler({
    marker,
    csvPath: join(outDir, "samples.csv"),
    // Scenarios with short-lived processes (S3 preflights live ~1 s) sample faster.
    intervalMs: mod.sampleIntervalMs ?? 1000,
    progress: () => progress,
    probe: async (snaps) => {
      for (const fn of probes) {
        try { Object.assign(heapByPid, (await fn(snaps)) ?? {}); } catch {}
      }
      return { ...heapByPid };
    },
  });

  ctx.elapsed = () => Date.now() - sampler.t0;
  let result;
  const t0 = Date.now();
  try {
    // Windows: the units self-test against Get-Process runs before any sample.
    notes.sampler = { ...(await sampler.ready) };
    result = await mod.run(ctx);
  } catch (err) {
    await sampler.stop();
    notes.sampler = { ...notes.sampler, overhead: sampler.overhead() };
    recordBun();
    console.error(`[${args.scenario}] harness failure: ${err?.stack ?? err}`);
    const left = survivors(marker);
    for (const o of left) { try { process.kill(o.pid, "SIGKILL"); } catch {} }
    notes.reapedAfterFailure = left.map((o) => `${o.pid} ${o.role}`);
    writeFileSync(join(outDir, "summary.json"), JSON.stringify({ id, key, scenario: args.scenario, profile: args.profile, variant: args.variant, outcome: "HARNESS FAILURE", error: String(err?.message ?? err), notes, observations }, null, 2));
    return 2;
  }
  const rows = await sampler.stop();
  // The sampler's own cost (Windows: the poller's commit/working set and poll time); it never counts as kit.
  notes.sampler = { ...notes.sampler, overhead: sampler.overhead() };
  recordBun();
  // Orphans: anything still marked after the scenario's own stop sequence,
  // minus processes the scenario deliberately keeps (none by default).
  await new Promise((r) => setTimeout(r, result.settleMs ?? 2000));
  const orphans = survivors(marker, result.keepPids ?? []);
  // RSS on Linux, commit on Windows (with the working-set verdict beside it).
  const v = osVerdict(rows, result.budgets, { orphans, observations });
  // The loop never leaves its own processes behind: orphans are recorded as
  // evidence above, then reaped (only marked processes, i.e. ones this run started).
  for (const o of orphans) { try { process.kill(o.pid, "SIGTERM"); } catch {} }
  if (orphans.length) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const o of survivors(marker)) { try { process.kill(o.pid, "SIGKILL"); } catch {} }
  }
  const summary = { id, key, scenario: args.scenario, profile: args.profile, variant: args.variant, platform: process.platform, node: process.version, outcome: v.red ? "RED" : "GREEN", metric: v.metric, ...(v.workingSet ? { workingSet: v.workingSet, redOnlyOnCommit: v.redOnlyOnCommit } : {}), durationS: Math.round((Date.now() - t0) / 1000), red: v.red, checks: v.checks, summary: v.summary, budgets: result.budgets, orphans: orphans.map((o) => ({ pid: o.pid, role: o.role, cmd: o.cmd })), observations, notes, samples: rows.length, csv: join(outDir, "samples.csv") };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\n== memory loop ${key} (${id}): ${v.red ? "RED" : "GREEN"} ==`);
  for (const c of v.checks) {
    console.log(`${c.red ? "RED  " : "ok   "} ${c.name.padEnd(28)} ${String(c.value).padStart(10)} ${c.unit ?? ""} (${c.ceiling !== undefined ? "ceiling" : "budget"} ${c.budget})${c.trend !== undefined ? ` trend=${c.trend}` : ""}${c.commitValue !== undefined ? `  [commit ${c.commitValue} / WS ${c.wsValue}, gate ${c.gate === "ws" ? "WS" : "commit"}]` : ""}`);
    // A window bounded in work units (S5/short, Round 24 Q1): its bounds in tasks and samples.
    const w = c.detail?.window;
    if (w) console.log(`      window tasks ${w.firstTask}–${w.lastTask} (from ${w.fromTask ?? "load start"} until ${w.untilTask ?? "load end"}), samples ${w.firstSample}–${w.lastSample} of ${w.ofSamples} (${w.samples}, warm-up ${w.warmupSamples}); slope ${c.detail.slopeMBPer1k} MB/1k, mean ${c.detail.meanMB} MB, medians ${(c.detail.windowMediansMB ?? []).join(" ")}`);
  }
  for (const [role, s] of Object.entries(v.summary)) console.log(`  role ${role.padEnd(14)} peak ${String(s.peakMB).padStart(8)} MB  max/proc ${String(s.peakProcMB).padStart(8)} MB  hwm ${String(s.peakHwmMB).padStart(8)} MB  procs ${s.maxCount} (distinct ${s.distinctPids})  fds ${s.maxFds}  threads ${s.maxThreads}${s.peakHeapMB !== null ? `  heap ${s.peakHeapMB} MB` : ""}`);
  if (v.redOnlyOnCommit) console.log(`  RED only on commit (working set within budget): raised to the owner (build-time gate 3)`);
  console.log(`  summary: ${join(outDir, "summary.json")}`);
  runBun?.remove();
  return v.red ? 1 : 0;
}

// Until main() settles the run is a harness failure: if the event loop
// empties first (nothing left to wait on, CI run 42221794531), Node exits with
// this code instead of 0.
process.exitCode = 2;
let settled = false;
process.on("beforeExit", () => { if (!settled) console.error("memory loop: the event loop emptied before the scenario finished — harness failure"); });
main().then((code) => { settled = true; process.exitCode = code; }, (err) => { settled = true; console.error(err); process.exitCode = 2; });
