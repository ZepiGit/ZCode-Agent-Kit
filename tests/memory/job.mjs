#!/usr/bin/env node
// The memory-budget job: every run of this OS leg's job (lib/catalogue.mjs
// JOB), each under a hard memory cap and a timeout, then the expected-RED
// ratchet (lib/ratchet.mjs) over the outcomes.
//
//   node tests/memory/job.mjs [--os linux|windows] [--out DIR] [--cap auto|systemd|prlimit|jobobject|none] [--only KEY,KEY]
//                             [--run-script PATH]   (tests only: a stand-in for run.mjs)
//   node tests/memory/job.mjs --measure-burst1 N [--os …] [--out DIR] [--cap …]
//
// --measure-burst1 N (off unless given; CI switches it on only while the
// marker file tests/memory/measure-burst1 exists, see ci.yml): instead of the
// job and its ratchet, N fresh, isolated S1/burst1 runs one after another,
// each under the same cap, timeout and evidence gate as a job run, recorded in
// <out>/measure-S1-burst1.{json,md} (lib/measure.mjs, Round 8 Q1 condition 2)
// and appended to $GITHUB_STEP_SUMMARY. Exit 0 when every run is a valid
// observation, 2 otherwise. It never decides n or the expected-RED list.
//
// Caps (--cap auto picks the first that works; lib/caps.mjs):
//   systemd    `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0`,
//              verified by reading the scope's memory.max from inside it;
//   prlimit    `prlimit --as=2×cap` per process (address space, a coarse
//              fallback where no user systemd manager is reachable);
//   jobobject  Windows: a Job Object with the job memory limit and
//              kill-on-close, read back before the run starts;
//   none       only when the caller already runs the job under a cap.
// Every run also gets a timeout (`timeout --kill-after=30` on Linux; on
// Windows the job kills the wrapper, and closing the Job Object kills the tree).
//
// Run keys in lib/budgets.mjs REPEATED (S1/burst1) run n times, one fresh
// isolated run after another, under <out>/<scenario>-<variant>/rep-<i>/, and
// are judged as one verdict on the median peak plus a per-run ceiling
// (lib/repetitions.mjs, Round 6 Q1); <out>/<scenario>-<variant>/summary.json
// records every repetition's value, the median and the ceiling check.
//
// Writes <out>/job-summary.json and <out>/job-summary.md (also appended to
// $GITHUB_STEP_SUMMARY when set); each run's samples.csv and summary.json
// stay under <out>/<scenario>-<variant>/. Exit 0 when the ratchet holds,
// 1 when it does not, 2 when the job itself cannot run.
// --only runs a subset (local use): runs left out are reported, not failed.
// Runs RED only on commit (Windows) are listed for the owner (build-time gate 3).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB, osLeg, parseRunKey } from "./lib/catalogue.mjs";
import { checkRatchet, issueIdsIn, readExpectedRed } from "./lib/ratchet.mjs";
import { assertSafeRun } from "./lib/isolated-kit.mjs";
import { bytes, chooseCap, commandFor, parseJobReport } from "./lib/caps.mjs";
import { runEvidence } from "./lib/completeness.mjs";
import { repetitionRule, runRepetitions } from "./lib/repetitions.mjs";
import { measureMarkdown, measureObservation, measureReport, parseMeasureCount } from "./lib/measure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
// Per-run (or per-scenario) cap and timeout: the caps protect the runner and
// sit far above every budget, so a cap kill is a harness failure, never a
// verdict. Today's worst: S1/burst32 (proxy 1.6 GB + 32 bodies in the
// client), S2's hang phase (5 × 256 MB parked). S5 is the longest run.
const CAP = { "S1/burst16": "4G", "S1/burst32": "6G", S2: "4G" };
const TIMEOUT_S = { S5: 1800 };
const DEFAULT_CAP = "3G";
const DEFAULT_TIMEOUT_S = 1200;
// Windows runs are slower (PowerShell polls, process start-up): twice the timeout.
const TIMEOUT_FACTOR = { windows: 2 };

function parseArgs(argv) {
  const out = { os: osLeg(), out: resolve(ROOT, ".memloop", "job"), cap: "auto", only: null, runScript: join(HERE, "run.mjs") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--os") out.os = argv[++i];
    else if (argv[i] === "--out") out.out = resolve(argv[++i]);
    else if (argv[i] === "--cap") out.cap = argv[++i];
    else if (argv[i] === "--only") out.only = argv[++i].split(",").filter(Boolean);
    else if (argv[i] === "--run-script") out.runScript = resolve(argv[++i]); // tests: a stand-in for run.mjs
    else if (argv[i] === "--measure-burst1") out.measure = parseMeasureCount(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

function runOne({ argv, timeoutMs }, logPath) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    const child = spawn(argv[0], argv.slice(1), { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let tail = "";
    const log = (b) => { process.stdout.write(b); appendFileSync(logPath, b); tail = (tail + b).slice(-8192); };
    child.stdout.on("data", log);
    child.stderr.on("data", log);
    // Windows: no `timeout` binary; killing the wrapper closes its Job Object, which kills the tree.
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs) : null;
    child.on("close", (code, signal) => { if (timer) clearTimeout(timer); resolveRun({ code: timedOut ? 124 : code ?? 2, signal, durationS: Math.round((Date.now() - t0) / 1000), job: parseJobReport(tail) }); });
    child.on("error", (err) => { if (timer) clearTimeout(timer); resolveRun({ code: 2, signal: null, durationS: 0, error: String(err), job: null }); });
  });
}

function readSummary(dir) {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name, "summary.json");
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
  }
  return null;
}

/** The run's samples.csv text (in run.mjs's run directory under `dir`), or null. */
function readSamples(dir) {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name, "samples.csv");
    if (existsSync(p)) { try { return readFileSync(p, "utf8"); } catch { return null; } }
  }
  return null;
}

function markdown({ os, cap, ratchet, results, partial }) {
  const lines = [`## memory-budget (${os}, short profile): ${ratchet.ok ? "ratchet holds" : "ratchet FAILED"}`, "", `cap: ${cap} · node ${process.version}${partial ? " · partial run (--only)" : ""}`, "", "| run | outcome | expected-RED | red checks | s | samples | roles seen |", "|---|---|---|---|---|---|---|"];
  for (const row of ratchet.rows) {
    const r = results.find((x) => x.key === row.key);
    lines.push(`| ${row.key} | ${row.outcome}${r?.redOnlyOnCommit ? " (only on commit)" : ""} | ${row.ticket ? `ticket ${row.ticket}` : "—"} | ${(r?.redChecks ?? []).join(", ") || "—"} | ${r?.durationS ?? ""} | ${r?.samples ?? "—"} | ${Object.entries(r?.rolesSeen ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} |`);
  }
  if (ratchet.failures.length) lines.push("", "Failures:", ...ratchet.failures.map((f) => `- ${f}`));
  const repeated = results.filter((r) => r.median);
  if (repeated.length) {
    lines.push("", "Judged on the median of n fresh repetitions (one verdict per run key; every repetition must also stay within the per-run ceiling; Windows: the WS gate, commit reported):", "", "| run | n | gate | repetitions (MB) | median | budget | ceiling | over ceiling | commit per repetition (MB) |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of repeated) {
      const m = r.median;
      const gate = m.gate === "ws" ? "WS" : m.gate === "commit" ? "commit" : "RSS";
      lines.push(`| ${r.key} | ${m.n} | ${gate} | ${m.values.map((v) => v ?? "—").join(", ")} | ${m.medianMB ?? "—"} | ≤ ${m.budgetMB} | ≤ ${m.ceilingMB} | ${m.overCeiling.length ? m.overCeiling.map((i) => `#${i}`).join(", ") : "none"} | ${m.commitValues ? `${m.commitValues.join(", ")} (median ${m.commitMedianMB})` : "—"} |`);
    }
  }
  const overheads = results.filter((r) => r.samplerOverhead?.polls);
  if (overheads.length) {
    const mb = (kb) => Math.round(kb / 1024);
    lines.push("", "Sampler overhead (the Windows poller, excluded from every verdict): " + overheads.map((r) => `${r.key} ${mb(r.samplerOverhead.peakCommitKb)} MB commit / ${mb(r.samplerOverhead.peakRssKb)} MB WS, poll ${r.samplerOverhead.pollMsMedian} ms (max ${r.samplerOverhead.pollMsMax})`).join("; "));
  }
  const withValues = results.filter((r) => r.memoryChecks?.length);
  if (withValues.length) {
    lines.push("", "Memory checks, commit / working set (Round 7 Q1: WS gates the per-process peak and steady budgets of proxy, launcher, mcp-bridge and preflight; commit gates the rest):");
    for (const r of withValues) for (const c of r.memoryChecks) lines.push(`- ${r.key} ${c.name}: commit ${c.commitMB} / WS ${c.wsMB} MB (budget ${c.budget}, gate ${c.gate === "ws" ? "WS" : "commit"}) ${c.red ? "RED" : "ok"}`);
  }
  const onlyCommit = results.filter((r) => r.redOnlyOnCommit);
  if (onlyCommit.length) lines.push("", "RED only on commit (working set within budget) — raised to the owner, never adjusted silently (build-time gate 3):", ...onlyCommit.map((r) => `- ${r.key}: ${r.redChecks.join(", ")} (working set: ${r.workingSetRedChecks.join(", ") || "green"})`));
  return lines.join("\n") + "\n";
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (err) { console.error(`memory-budget: ${err.message}`); return 2; }
  const keys = JOB[args.os];
  if (!keys) { console.error(`memory-budget: no job for OS leg ${args.os}`); return 2; }
  const selected = args.only ?? keys;
  for (const k of selected) if (!keys.includes(k)) { console.error(`memory-budget: ${k} is not a run of the ${args.os} job`); return 2; }
  try { assertSafeRun(); } catch (err) { console.error(`memory-budget: ${err.message}`); return 2; }
  const capChoice = chooseCap(args.cap);
  if (capChoice.error) { console.error(`memory-budget: ${capChoice.error}`); return 2; }
  let expected, issueIds;
  try {
    expected = readExpectedRed(join(HERE, "expected-red.json"));
    issueIds = issueIdsIn(join(ROOT, ".scratch", "kit-overhaul", "issues"));
  } catch (err) { console.error(`memory-budget: cannot read the expected-RED list or the issues: ${err.message}`); return 2; }
  mkdirSync(args.out, { recursive: true });
  console.log(args.measure ? `memory-budget: S1/burst1 measurement, ${args.measure} fresh runs on ${args.os}, cap ${capChoice.cap}, output ${args.out}` : `memory-budget: ${selected.length} runs on ${args.os}, cap ${capChoice.cap}, output ${args.out}`);

  // One fresh run of a key into `dir`, capped and timed out: its job result.
  async function runIn(key, dir) {
    const { scenario, profile, variant } = parseRunKey(key);
    mkdirSync(dir, { recursive: true });
    const runArgs = [scenario, "--profile", profile, ...(variant ? ["--variant", variant] : []), "--out", dir];
    const size = CAP[key] ?? CAP[scenario] ?? DEFAULT_CAP;
    const cmd = commandFor(capChoice.cap, size, (TIMEOUT_S[scenario] ?? DEFAULT_TIMEOUT_S) * (TIMEOUT_FACTOR[args.os] ?? 1), runArgs, { runScript: args.runScript });
    const r = await runOne(cmd, join(dir, "run.log"));
    const summary = readSummary(dir);
    // run.mjs exits 0/1/2; anything else (timeout 124, a cap kill 137 / SIGKILL) is a harness failure.
    let exitCode = [0, 1, 2].includes(r.code) ? r.code : 2;
    let why = exitCode === 2 && !summary?.error ? (r.code === 124 ? "timed out" : r.code === 137 || r.signal === "SIGKILL" || (r.job?.applied && r.job.peakBytes >= 0.95 * bytes(size)) ? `killed (memory cap ${size}?)` : `exit ${r.code}${r.signal ? ` ${r.signal}` : ""}`) : null;
    // A Job Object run counts only if the wrapper proved the cap (never uncapped).
    if (capChoice.cap === "jobobject" && r.code !== 124 && !r.job?.applied) { exitCode = 2; why = `Job Object cap not applied: ${r.job?.error ?? "no @@JOB report"}`; }
    // A verdict counts only with evidence that the scenario ran (lib/completeness.mjs).
    const evidence = runEvidence(summary, { key, exitCode });
    if (!evidence.ok) { exitCode = 2; why = `no evidence the scenario ran: ${evidence.problems.join("; ")}`; }
    if (why) console.log(`${key}: harness failure: ${why}`);
    const result = { key, exitCode, rawExit: r.code, signal: r.signal, cap: size, durationS: r.durationS, scenarioS: summary?.durationS ?? null, samples: summary?.samples ?? null, rolesSeen: Object.fromEntries(Object.entries(summary?.summary ?? {}).filter(([role]) => role !== "*" && role !== "kit").map(([role, s]) => [role, s.maxCount])), units: summary?.notes?.sampler?.units ?? null, ...(r.job ? { jobApplied: r.job.applied === true, jobPeakMB: r.job.applied ? Math.round(r.job.peakBytes / 1048576) : null } : {}), metric: summary?.metric ?? null, samplerOverhead: summary?.notes?.sampler?.overhead ?? null, redOnlyOnCommit: summary?.redOnlyOnCommit === true, workingSetRedChecks: summary?.workingSet?.redChecks ?? [], redChecks: (summary?.checks ?? []).filter((c) => c.red).map((c) => c.name),
      // Windows (Round 7 Q1): every memory check with both values and the metric that gates it.
      memoryChecks: (summary?.checks ?? []).filter((c) => c.commitValue !== undefined).map((c) => ({ name: c.name, red: c.red, gate: c.gate, commitMB: c.commitValue, wsMB: c.wsValue, budget: c.budget })),
      error: why ?? summary?.error ?? r.error ?? null };
    return { result, summary };
  }

  if (args.measure) {
    // Measurement mode (Round 8 Q1 condition 2): the distribution, no verdict, no ratchet.
    const key = "S1/burst1";
    const rule = repetitionRule(key);
    const reps = [];
    for (let i = 1; i <= args.measure; i++) {
      console.log(`\n── ${key} measurement run ${i} of ${args.measure} ──`);
      const dir = join(args.out, "measure-S1-burst1", `rep-${i}`);
      const { result, summary } = await runIn(key, dir);
      const obs = measureObservation({ rep: i, result, summary, csvText: readSamples(dir), rule });
      console.log(`${key} measurement run ${i}: ${obs.outcome}, gate ${obs.gateMB ?? "—"} MB${obs.valid ? "" : ` (invalid: ${obs.problems.join("; ")})`}`);
      reps.push(obs);
    }
    const report = { ...measureReport(reps, { key, os: args.os, requested: args.measure, rule }), cap: capChoice.cap, node: process.version };
    writeFileSync(join(args.out, "measure-S1-burst1.json"), JSON.stringify(report, null, 2));
    const md = measureMarkdown(report);
    writeFileSync(join(args.out, "measure-S1-burst1.md"), md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    console.log(`\n${md}`);
    return report.complete ? 0 : 2;
  }

  const results = [];
  for (const key of selected) {
    const dir = join(args.out, key.replace("/", "-"));
    const rule = repetitionRule(key);
    if (!rule) {
      console.log(`\n── ${key} ──`);
      results.push((await runIn(key, dir)).result);
      continue;
    }
    // Judged on the median of n fresh, sequential repetitions (lib/repetitions.mjs, Round 6 Q1).
    const set = await runRepetitions(rule, async (i) => {
      console.log(`\n── ${key} (repetition ${i} of ${rule.n}) ──`);
      const { result, summary } = await runIn(key, join(dir, `rep-${i}`));
      return { ...result, checks: summary?.checks ?? [] };
    });
    const repetitions = set.reps.map((r, i) => ({ rep: i + 1, exitCode: r.exitCode, value: set.values[i], ...(set.commitValues ? { commitValue: set.commitValues[i] } : {}), redChecks: r.redChecks, durationS: r.durationS, samples: r.samples, units: r.units, ...(r.jobApplied !== undefined ? { jobApplied: r.jobApplied } : {}), ...(r.error ? { error: r.error } : {}) }));
    const median = { n: rule.n, check: rule.check, gate: set.gate, values: set.values, medianMB: set.medianMB, budgetMB: rule.budgetMB, ceilingMB: rule.ceilingMB, overCeiling: set.overCeiling, ...(set.commitValues ? { commitValues: set.commitValues, commitMedianMB: set.commitMedianMB } : {}) };
    const first = set.reps[0] ?? {};
    const rolesSeen = {};
    for (const r of set.reps) for (const [role, c] of Object.entries(r.rolesSeen ?? {})) rolesSeen[role] = Math.max(rolesSeen[role] ?? 0, c ?? 0);
    const result = { key, exitCode: set.exitCode, cap: first.cap, durationS: set.reps.reduce((a, r) => a + (r.durationS ?? 0), 0), samples: set.reps.reduce((a, r) => a + (r.samples ?? 0), 0), rolesSeen, units: set.reps.find((r) => r.units && r.units.ok !== true)?.units ?? first.units ?? null, metric: first.metric ?? null, samplerOverhead: first.samplerOverhead ?? null, redOnlyOnCommit: set.redOnlyOnCommit, workingSetRedChecks: set.workingSetRedChecks, redChecks: set.redChecks, memoryChecks: [], error: set.error ?? null, median, repetitions };
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ key, outcome: { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" }[set.exitCode], rule: "median of n fresh repetitions (Round 6 Q1)", ...median, redChecks: set.redChecks, redOnlyOnCommit: set.redOnlyOnCommit, ...(set.error ? { error: set.error } : {}), repetitions }, null, 2));
    console.log(`${key}: median ${set.medianMB ?? "—"} MB of [${set.values.join(", ")}] (budget ${rule.budgetMB}, every run ≤ ${rule.ceilingMB}${set.gate ? `, gate ${set.gate === "ws" ? "WS" : "commit"}` : ""}): ${{ 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" }[set.exitCode]}${set.error ? ` (${set.error})` : ""}`);
    results.push(result);
  }

  const ratchet = checkRatchet({ expected, os: args.os, results, issueIds });
  if (args.only) {
    // A partial run cannot judge the runs it left out.
    ratchet.failures = ratchet.failures.filter((f) => !/: did not run in the /.test(f));
    ratchet.rows = ratchet.rows.filter((row) => selected.includes(row.key));
    ratchet.ok = ratchet.failures.length === 0;
  }
  const report = { os: args.os, cap: capChoice.cap, node: process.version, partial: !!args.only, ok: ratchet.ok, failures: ratchet.failures, rows: ratchet.rows, results };
  writeFileSync(join(args.out, "job-summary.json"), JSON.stringify(report, null, 2));
  const md = markdown({ os: args.os, cap: capChoice.cap, ratchet, results, partial: !!args.only });
  writeFileSync(join(args.out, "job-summary.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(`\n${md}`);
  return ratchet.ok ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 2; });
