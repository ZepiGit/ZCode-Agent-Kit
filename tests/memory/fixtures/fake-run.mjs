#!/usr/bin/env node
// Stand-in for run.mjs in the job's completeness tests (loop.test.mjs):
// same arguments, writes into --out like run.mjs, starts nothing, uses no
// shell utility (it runs unchanged on Linux and Windows).
//   FAKE_RUN_MODE=exit0-nothing   the CI run 42221794531 symptom: the run dir and
//                                 the CSV header exist, then exit 0 (no summary.json)
//   FAKE_RUN_MODE=green-empty     a GREEN summary.json whose sampler saw nothing
//   FAKE_RUN_MODE=green-complete  a GREEN summary.json with real-looking evidence
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const scenario = argv[0];
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const variant = opt("--variant");
const key = `${scenario}/${variant ?? opt("--profile") ?? "short"}`;
const dir = join(opt("--out"), `${key.replace("/", "-")}-fake`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "samples.csv"), "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb\n");
const mode = process.env.FAKE_RUN_MODE;
if (mode === "exit0-nothing") process.exit(0);
const role = (maxCount) => ({ peakMB: 100, peakProcMB: 100, peakHwmMB: 120, maxCount, maxFds: 10, maxThreads: 10, distinctPids: maxCount, peakHeapMB: null });
const complete = mode === "green-complete";
// Consistent with the OS it runs on: a Windows run is judged on commit with a passed units self-test.
const win = process.platform === "win32";
const summary = {
  id: "fake", key, scenario, profile: "short", variant, platform: process.platform, outcome: "GREEN", metric: win ? "commit" : "rss",
  durationS: complete ? 300 : 1, red: false, checks: [],
  summary: complete ? { "*": role(2), kit: role(1), proxy: role(1), "mock-upstream": role(1) } : { "*": role(0), kit: role(0) },
  samples: complete ? 300 : 0, notes: { sampler: { units: win ? { ok: true, compared: 40 } : null, overhead: null } }, observations: [], orphans: [],
};
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
process.exit(0);
