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
import { verdict } from "./lib/verdict.mjs";
import { assertSafeRun, KIT_ROOT } from "./lib/isolated-kit.mjs";
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
    console.error(`memory loop: platform ${process.platform} has no sampler yet (Linux /proc only) — skipped`);
    return 2;
  }
  const id = `${args.scenario}-${args.profile}${args.variant ? `-${args.variant}` : ""}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
  const outDir = resolve(args.out ?? process.env.ZCODE_MEMLOOP_OUT ?? join(KIT_ROOT, ".memloop"), id);
  mkdirSync(outDir, { recursive: true });
  const marker = `ZCODE_MEMLOOP_RUN=${id}`;
  // Children inherit the marker; this process itself was exec'd without it,
  // so the runner never counts itself.
  process.env.ZCODE_MEMLOOP_RUN = id;

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
    result = await mod.run(ctx);
  } catch (err) {
    await sampler.stop();
    console.error(`[${args.scenario}] harness failure: ${err?.stack ?? err}`);
    const left = survivors(marker);
    for (const o of left) { try { process.kill(o.pid, "SIGKILL"); } catch {} }
    notes.reapedAfterFailure = left.map((o) => `${o.pid} ${o.role}`);
    writeFileSync(join(outDir, "summary.json"), JSON.stringify({ id, key, scenario: args.scenario, profile: args.profile, variant: args.variant, outcome: "HARNESS FAILURE", error: String(err?.message ?? err), notes, observations }, null, 2));
    return 2;
  }
  const rows = await sampler.stop();
  // Orphans: anything still marked after the scenario's own stop sequence,
  // minus processes the scenario deliberately keeps (none by default).
  await new Promise((r) => setTimeout(r, result.settleMs ?? 2000));
  const orphans = survivors(marker, result.keepPids ?? []);
  const v = verdict(rows, result.budgets, { orphans, observations });
  // The loop never leaves its own processes behind: orphans are recorded as
  // evidence above, then reaped (only marked processes, i.e. ones this run started).
  for (const o of orphans) { try { process.kill(o.pid, "SIGTERM"); } catch {} }
  if (orphans.length) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const o of survivors(marker)) { try { process.kill(o.pid, "SIGKILL"); } catch {} }
  }
  const summary = { id, key, scenario: args.scenario, profile: args.profile, variant: args.variant, platform: process.platform, node: process.version, outcome: v.red ? "RED" : "GREEN", durationS: Math.round((Date.now() - t0) / 1000), red: v.red, checks: v.checks, summary: v.summary, budgets: result.budgets, orphans: orphans.map((o) => ({ pid: o.pid, role: o.role, cmd: o.cmd })), observations, notes, samples: rows.length, csv: join(outDir, "samples.csv") };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\n== memory loop ${key} (${id}): ${v.red ? "RED" : "GREEN"} ==`);
  for (const c of v.checks) console.log(`${c.red ? "RED  " : "ok   "} ${c.name.padEnd(28)} ${String(c.value).padStart(10)} ${c.unit ?? ""} (budget ${c.budget})${c.trend !== undefined ? ` trend=${c.trend}` : ""}`);
  for (const [role, s] of Object.entries(v.summary)) console.log(`  role ${role.padEnd(14)} peak ${String(s.peakMB).padStart(8)} MB  max/proc ${String(s.peakProcMB).padStart(8)} MB  hwm ${String(s.peakHwmMB).padStart(8)} MB  procs ${s.maxCount} (distinct ${s.distinctPids})  fds ${s.maxFds}  threads ${s.maxThreads}${s.peakHeapMB !== null ? `  heap ${s.peakHeapMB} MB` : ""}`);
  console.log(`  summary: ${join(outDir, "summary.json")}`);
  return v.red ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 2; });
