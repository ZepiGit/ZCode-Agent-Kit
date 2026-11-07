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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { osVerdict } from "../lib/verdict.mjs";
import { parseSamplesCsv, rowsFromSamples } from "../lib/sampler.mjs";

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
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  if (shape === "win32") process.stderr.write(p.job === false ? "@@JOB applied=0 error=fake\n" : `@@JOB applied=1 limit=${3 * 1024 ** 3} peak=${kb(p.commit) * 1024}\n`);
  process.exit(v.red ? 1 : 0);
}
const role = (maxCount) => ({ peakMB: 100, peakProcMB: 100, peakHwmMB: 120, maxCount, maxFds: 10, maxThreads: 10, distinctPids: maxCount, peakHeapMB: null });
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
