#!/usr/bin/env node
// Stand-in for run.mjs for S5 at the job seam (loop.test.mjs; ticket 74,
// Owner Proxy Round 24 Q1 condition 6): same arguments, writes into --out like
// run.mjs, starts nothing. FAKE_S5_SERIES names a JSON fixture series:
//   { shape: "linux" | "win32", loadStartMs, loadEndMs, emptyMB, rebootMB,
//     failures, samples: [{ t, progress, mb, commitMB? }] }
// `mb` is the bridge's RSS (linux) or working set (win32); `commitMB` its
// commit (win32 only). The series is judged with the scenario's own budgets
// (scenarios/s5-mcp.mjs s5Budgets) by the real osVerdict, as run.mjs does,
// and the run exits with the code its verdict implies.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { osVerdict } from "../lib/verdict.mjs";
import { s5Budgets } from "../scenarios/s5-mcp.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const profile = opt("--profile") ?? "short";
const key = `${argv[0]}/${profile}`;
const dir = join(opt("--out"), `${key.replace("/", "-")}-fake`);
mkdirSync(dir, { recursive: true });
const f = JSON.parse(readFileSync(process.env.FAKE_S5_SERIES, "utf8"));
const win = f.shape === "win32";
// The bridge (pid 5151) and the fixture runtime it drives, one process each per
// sample, in the sampler's row shape. KB stay unrounded, so a fixture value is
// exact (samples.csv, written beside it, rounds to whole KB as the sampler does).
const kb = (mb) => mb * 1024;
const rows = f.samples.map((s) => ({
  t: s.t, progress: s.progress,
  procs: [
    { pid: 5151, ppid: 1, key: "5151", role: "mcp-bridge", rssKb: kb(s.mb), hwmKb: kb(win ? s.commitMB : s.mb), threads: 12, fds: win ? 0 : 30, heapMB: null, commitKb: win ? kb(s.commitMB) : null, ...(win ? { wsPeakKb: kb(s.mb) } : {}) },
    { pid: 5152, ppid: 5151, key: "5152", role: "fake-harness", rssKb: kb(40), hwmKb: kb(40), threads: 8, fds: win ? 0 : 12, heapMB: null, commitKb: win ? kb(45) : null, ...(win ? { wsPeakKb: kb(40) } : {}) },
  ],
}));
let csv = "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb,ws_peak_kb\n";
for (const r of rows) for (const p of r.procs) csv += `${r.t},${p.pid},${p.ppid},${p.role},${Math.round(p.rssKb)},${Math.round(p.hwmKb)},${p.threads},${p.fds},,${r.progress},"${p.role}",${p.commitKb === null ? "" : Math.round(p.commitKb)},${p.wsPeakKb === undefined ? "" : Math.round(p.wsPeakKb)}\n`;
writeFileSync(join(dir, "samples.csv"), csv);
const budgets = s5Budgets({ long: profile === "long", os: win ? "windows" : "linux", loadStart: f.loadStartMs, loadEnd: f.loadEndMs, emptyRss: f.emptyMB, rebootRss: f.rebootMB, failures: f.failures ?? 0 });
const v = osVerdict(rows, budgets, { orphans: [] });
const durationS = Math.round((f.samples.at(-1).t - f.samples[0].t) / 1000);
const summary = {
  id: "fake-s5", key, scenario: argv[0], profile, variant: null, platform: win ? "win32" : "linux", outcome: v.red ? "RED" : "GREEN", metric: v.metric,
  ...(v.workingSet ? { workingSet: v.workingSet, redOnlyOnCommit: v.redOnlyOnCommit } : {}),
  durationS, red: v.red, checks: v.checks, summary: v.summary, budgets, orphans: [], observations: [],
  notes: { sampler: { units: win ? { ok: true, compared: 40 } : null, overhead: null } }, samples: f.samples.length,
};
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
process.exit(v.red ? 1 : 0);
