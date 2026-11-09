#!/usr/bin/env node
// Stand-in for run.mjs in the job's completeness tests (loop.test.mjs):
// same arguments, writes into --out like run.mjs, starts nothing, uses no
// shell utility (it runs unchanged on Linux and Windows).
//   FAKE_RUN_MODE=exit0-nothing   the CI run 42221794531 symptom: the run dir and
//                                 the CSV header exist, then exit 0 (no summary.json)
//   FAKE_RUN_MODE=green-empty     a GREEN summary.json whose sampler saw nothing
//   FAKE_RUN_MODE=green-complete  a GREEN summary.json with real-looking evidence
//   FAKE_RUN_MODE=replay          writes FAKE_RUN_SUMMARY (a real run's summary.json)
//                                 and exits with the code its outcome implies
//   FAKE_RUN_MODE=burst1          an S1/burst1 run: proxy samples in samples.csv,
//                                 judged by the real osVerdict. FAKE_RUN_PEAKS is a
//                                 JSON array, one entry per repetition (rep-<i> in
//                                 --out, else the first), in MB: { rss, hwm } in the
//                                 linux shape, { ws, wsPeak, commit, units, job } in
//                                 the win32 shape (FAKE_RUN_SHAPE, default linux;
//                                 units/job false = a failed self-test / no Job Object).
//                                 In measurement mode (ZCODE_MEMLOOP_MEASURE_PROBES=1)
//                                 it reports the proxy's runtime Bun as run.mjs does:
//                                 FAKE_RUN_BUN_REVISIONS maps ZCODE_KIT_BUN → revision
//                                 ("" = none recorded), plus a fixed runtime environment.
//   FAKE_RUN_MODE=s1-reps         an S1/short run per repetition, windows-shaped by
//                                 default, from FAKE_RUN_REPS (see the mode below)
//   FAKE_RUN_MODE=s6-reps         an S6/short run per repetition from FAKE_RUN_REPS
//   FAKE_RUN_MODE=s7-series       an S7/short run whose responses-store check is read
//                                 and judged by the scenario's own code
//                                 (lib/retained-heap.mjs) from a fake /health:
//                                 FAKE_RUN_HEAP = { before, readings } (/health
//                                 details; a null reading = no answer). The other S7
//                                 checks are as on CI (proxy.log RED, ticket 33). An
//                                 incomplete series is a harness failure, as run.mjs
//                                 writes one (exit 2).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { osVerdict } from "../lib/verdict.mjs";
import { parseSamplesCsv, rowsFromSamples } from "../lib/sampler.mjs";
import { heapAtCapLine, readHeapSeries, storeHeapAtCap } from "../lib/retained-heap.mjs";

const argv = process.argv.slice(2);
const scenario = argv[0];
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const variant = opt("--variant");
const key = `${scenario}/${variant ?? opt("--profile") ?? "short"}`;
const dir = join(opt("--out"), `${key.replace("/", "-")}-fake`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "samples.csv"), "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb,ws_peak_kb\n");
const mode = process.env.FAKE_RUN_MODE;
if (mode === "exit0-nothing") process.exit(0);
if (mode === "replay") {
  const replayed = readFileSync(process.env.FAKE_RUN_SUMMARY, "utf8");
  writeFileSync(join(dir, "summary.json"), replayed);
  process.exit(JSON.parse(replayed).outcome === "RED" ? 1 : 0);
}
if (mode === "burst1") {
  const rep = Number(opt("--out").match(/rep-(\d+)/)?.[1] ?? 1);
  const p = JSON.parse(process.env.FAKE_RUN_PEAKS)[rep - 1];
  const shape = process.env.FAKE_RUN_SHAPE ?? "linux";
  const kb = (mb) => Math.round(mb * 1024);
  // Six samples of one proxy (pid 4242) and the mock upstream; the peak in the middle.
  let csv = "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb,ws_peak_kb\n";
  for (let i = 0; i < 6; i++) {
    const f = i === 3 ? 1 : 0.6;
    if (shape === "win32") csv += `${i * 1000},4242,1,proxy,${kb(p.ws * f)},${kb(p.commit)},20,0,,${i},"bun proxy",${kb(p.commit * f)},${kb(p.wsPeak ?? p.ws)}\n`;
    else csv += `${i * 1000},4242,1,proxy,${kb(p.rss * f)},${kb(p.hwm ?? p.rss)},20,30,,${i},"bun proxy",,\n`;
    csv += `${i * 1000},4243,1,mock-upstream,${kb(50)},${kb(50)},5,10,,${i},"node mock",${shape === "win32" ? kb(60) : ""},${shape === "win32" ? kb(50) : ""}\n`;
  }
  writeFileSync(join(dir, "samples.csv"), csv);
  const v = osVerdict(rowsFromSamples(parseSamplesCsv(csv)), { procPeaks: { proxy: 250 }, counts: { proxy: 1 }, orphans: 0 }, { orphans: [] });
  const summary = {
    id: "fake", key, scenario, profile: "short", variant, platform: shape, outcome: v.red ? "RED" : "GREEN", metric: v.metric, durationS: 20, red: v.red,
    checks: v.checks, summary: v.summary, workingSet: v.workingSet, redOnlyOnCommit: v.redOnlyOnCommit, samples: 6,
    notes: { sampler: { units: shape === "win32" ? { ok: p.units !== false, compared: 12 } : null, overhead: null } }, observations: [], orphans: [],
  };
  if (process.env.ZCODE_MEMLOOP_MEASURE_PROBES === "1") {
    const revision = JSON.parse(process.env.FAKE_RUN_BUN_REVISIONS ?? "{}")[process.env.ZCODE_KIT_BUN ?? ""] ?? null;
    summary.notes.bunRuntime = { proxies: [{ pid: 4242, exe: process.env.ZCODE_KIT_BUN ?? null, revision: revision || null }] };
    summary.notes.runtimeEnv = { capRequested: process.env.ZCODE_MEMLOOP_CAP ?? null, bun: { revision: revision || null, constrainedMemory: 3221225472, availableMemory: 3000000000 + rep, hardwareConcurrency: 4, availableParallelism: 4, cpuModel: "Fake CPU" }, nproc: 4, cgroup: { type: "v2-only", v2Path: `/app.slice/run-r${rep}.scope`, memoryMax: "3221225472" } };
  }
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  if (shape === "win32") process.stderr.write(p.job === false ? "@@JOB applied=0 error=fake\n" : `@@JOB applied=1 limit=${3 * 1024 ** 3} peak=${kb(p.commit) * 1024}\n`);
  process.exit(v.red ? 1 : 0);
}
const role = (maxCount) => ({ peakMB: 100, peakProcMB: 100, peakHwmMB: 120, maxCount, maxFds: 10, maxThreads: 10, distinctPids: maxCount, peakHeapMB: null });
if (mode === "s1-reps") {
  // FAKE_RUN_REPS: one entry per repetition (rep-<i> in --out, else the first):
  // { growth (commit %/1k, null = insufficient samples), trend, red: [other check
  // names RED], harness: "why" (a harness failure, exit 2) }. growth:proxy is RED
  // as growth() makes it: growth > 5 AND trend. FAKE_RUN_SHAPE win32 (default) or linux.
  const rep = Number(opt("--out").match(/rep-(\d+)/)?.[1] ?? 1);
  const p = JSON.parse(process.env.FAKE_RUN_REPS)[rep - 1];
  const win = (process.env.FAKE_RUN_SHAPE ?? "win32") === "win32";
  const base = { id: "fake", key, scenario, profile: "short", variant, platform: win ? "win32" : "linux", metric: win ? "commit" : "rss", durationS: 300, samples: 300, observations: [], orphans: [] };
  if (!p || p.harness) {
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...base, outcome: "HARNESS FAILURE", error: p?.harness ?? `no fixture for repetition ${rep}`, notes: {} }, null, 2));
    process.exit(2);
  }
  const reds = new Set(p.red ?? []);
  const mem = (name, value, budget, gate) => ({ name, red: reds.has(name), value, budget, unit: "MB", ...(win ? { gate, commitValue: gate === "ws" ? value + 150 : value, wsValue: value } : {}) });
  const ws = p.ws ?? 1.4;
  const growthCheck = p.growth === null
    ? { name: "growth:proxy", red: false, budget: 5, unit: "%/1k", trend: false, detail: { samples: 3, insufficient: true } }
    : { name: "growth:proxy", red: p.growth > 5 && p.trend === true, value: p.growth, budget: 5, unit: "%/1k", trend: p.trend === true, detail: { samples: 280, windowMediansMB: [180, 182, 184, 186, 188, 190] }, ...(win ? { gate: "commit", commitValue: p.growth, wsValue: ws } : {}) };
  const checks = [
    growthCheck,
    mem("procPeak:proxy", 190, 250, "ws"),
    mem("steady:proxy", 120, 160, "ws"),
    { name: "count:proxy", red: reds.has("count:proxy"), value: reds.has("count:proxy") ? 2 : 1, budget: 1, unit: "procs" },
    { name: "orphans", red: reds.has("orphans"), value: reds.has("orphans") ? 1 : 0, budget: 0, unit: "procs", detail: [] },
    ...(win ? [{ name: "commit-backstop:proxy", red: reds.has("commit-backstop:proxy"), value: reds.has("commit-backstop:proxy") ? 530 : 400, budget: 512, unit: "MB commit (per sample, ADR-0008 soft limit)", gate: "commit" }] : []),
  ];
  const red = checks.some((c) => c.red);
  const wsRed = [...(ws > 5 && p.trend === true ? ["growth:proxy"] : []), ...checks.filter((c) => c.red && c.name !== "growth:proxy").map((c) => c.name)];
  const summary = { ...base, outcome: red ? "RED" : "GREEN", red, checks, summary: { "*": role(2), kit: role(1), proxy: role(1), "mock-upstream": role(1) },
    ...(win ? { workingSet: { red: wsRed.length > 0, redChecks: wsRed }, redOnlyOnCommit: red && wsRed.length === 0 } : {}),
    notes: { sampler: { units: win ? { ok: true, compared: 40 } : null, overhead: null } } };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  process.exit(red ? 1 : 0);
}
if (mode === "s6-reps") {
  // FAKE_RUN_REPS: one entry per repetition (rep-<i> in --out): { adversarial
  // (tui:adversarial-line-heap in MB, RED above 16 as the scenario judges it; any
  // non-number is written as is), red: [other check names RED], harness: "why" }.
  const rep = Number(opt("--out").match(/rep-(\d+)/)?.[1] ?? 1);
  const p = JSON.parse(process.env.FAKE_RUN_REPS)[rep - 1];
  const base = { id: "fake", key, scenario, profile: "short", variant, platform: "linux", metric: "rss", durationS: 4, samples: 4, observations: [], orphans: [] };
  if (!p || p.harness) {
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...base, outcome: "HARNESS FAILURE", error: p?.harness ?? `no fixture for repetition ${rep}`, notes: {} }, null, 2));
    process.exit(2);
  }
  const reds = new Set(p.red ?? []);
  const tui = (name, value, budget) => ({ name, red: reds.has(name), value: reds.has(name) ? budget + 1 : value, budget, unit: "MB" });
  const checks = [
    { name: "orphans", red: reds.has("orphans"), value: reds.has("orphans") ? 1 : 0, budget: 0, unit: "procs", detail: [] },
    tui("tui:log-pane-heap", 3, 16), tui("tui:resize-storm-heap", 1, 8), tui("tui:long-line-heap", 8, 16),
    { name: "tui:adversarial-line-heap", red: typeof p.adversarial === "number" && p.adversarial > 16, value: p.adversarial, budget: 16, unit: "MB" },
  ];
  const red = checks.some((c) => c.red);
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...base, outcome: red ? "RED" : "GREEN", red, checks, summary: { "*": role(1), kit: role(0) }, notes: { sampler: { units: null, overhead: null } } }, null, 2));
  process.exit(red ? 1 : 0);
}
if (mode === "s7-series") {
  const { before, readings } = JSON.parse(process.env.FAKE_RUN_HEAP);
  let next = 0;
  const health = async () => { const d = readings[next++]; return d === null ? null : { details: d }; };
  const series = await readHeapSeries(health, { readings: readings.length, sleep: async () => {} });
  const base = { id: "fake", key, scenario, profile: "short", variant, platform: "linux", metric: "rss", durationS: 90, samples: 90, observations: [], orphans: [] };
  let heap;
  try { heap = storeHeapAtCap({ before, series, budgetMB: 96 }); } catch (err) {
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...base, outcome: "HARNESS FAILURE", error: String(err.message), notes: {} }, null, 2));
    process.exit(2);
  }
  console.log(heapAtCapLine(heap));
  const checks = [
    { name: "procPeak:proxy", red: false, value: 217, budget: 250, unit: "MB" },
    { name: "orphans", red: false, value: 0, budget: 0, unit: "procs", detail: [] },
    // Since ticket 33 the proxy rotates proxy.log while it runs (0.08 MB in its loop run).
    { name: "proxy.log:bounded-while-running", red: false, value: 0.08, budget: 6, unit: "MB" },
    { name: "proxy.early.log:bounded", red: false, value: 0, budget: 1, unit: "MB (+64 KB overshoot)" },
    heap,
  ];
  const red = checks.some((c) => c.red);
  const summary = { ...base, outcome: red ? "RED" : "GREEN", red, checks, summary: { "*": role(2), kit: role(1), proxy: role(1), "mock-upstream": role(1) },
    notes: { sampler: { units: null, overhead: null }, responsesStore: { heapBeforeMB: before.heapUsedMB, heapAfterMB: series[0].heapUsedMB, heapSeriesMB: series.map((x) => x.heapUsedMB) } } };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  process.exit(red ? 1 : 0);
}
const complete = mode === "green-complete";
// Consistent with the OS it runs on: a Windows run is judged on commit with a passed units self-test.
const win = process.platform === "win32";
const summary = {
  id: "fake", key, scenario, profile: "short", variant, platform: process.platform, outcome: "GREEN", metric: win ? "commit" : "rss",
  durationS: complete ? 300 : 1, red: false,
  // One memory check as osVerdict reports it on Windows: both values and the gate (Round 7 Q1).
  checks: complete ? [{ name: "procPeak:proxy", red: false, value: 120, budget: 250, unit: "MB", gate: "ws", commitValue: 310, wsValue: 120 }] : [],
  summary: complete ? { "*": role(2), kit: role(1), proxy: role(1), "mock-upstream": role(1) } : { "*": role(0), kit: role(0) },
  samples: complete ? 300 : 0, notes: { sampler: { units: win ? { ok: true, compared: 40 } : null, overhead: null } }, observations: [], orphans: [],
};
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
process.exit(0);
