#!/usr/bin/env node
// The memory-budget job: every run of this OS leg's job (lib/catalogue.mjs
// JOB), each under a hard memory cap and a timeout, then the expected-RED
// ratchet (lib/ratchet.mjs) over the outcomes.
//
//   node tests/memory/job.mjs [--os linux|windows] [--out DIR] [--cap auto|systemd|prlimit|jobobject|none] [--only KEY,KEY]
//                             [--run-script PATH]   (tests only: a stand-in for run.mjs)
//   node tests/memory/job.mjs --measure-burst1 N [--os …] [--out DIR] [--cap …]
//   node tests/memory/job.mjs --measure-burst1 "N bun=<pinned>,<candidate>[,…]" --bun <pinned>=PATH,<candidate>=PATH[,…] [--os …] [--out DIR] [--cap …]
//
// The paired form (Round 10 Q1 condition 1; ticket 62's re-entry tool) runs
// N fresh S1/burst1 runs per arm, the arms interleaved in rotation (A, B, C,
// A, …), each run with ZCODE_KIT_BUN = its arm's binary. The first arm is the
// reference, the pinned Bun (1.4.2 since Round 11); the later arms are
// candidates. --bun exists only here and must name exactly the marker's
// arms. Every measurement run records the Bun its proxy actually executed and
// the runtime environment inside its cap scope (lib/runtime-probe.mjs); in
// the paired form a run whose proxy ran another Bun is invalid. The output
// carries per arm the count above 250 MB, the stable-unlisted check at the
// job's n, the over-400 runs, the one-sided Fisher p against the reference
// and the per-leg re-entry reading of Round 11 Q1 condition 4.
//
// --measure-burst1 N (off unless given; CI switches it on only while the
// marker file tests/memory/measure-burst1 exists, see ci.yml): instead of the
// job and its ratchet, N fresh, isolated S1/burst1 runs one after another,
// each under the same cap, timeout and evidence gate as a job run, recorded in
// <out>/measure-S1-burst1.{json,md} (lib/measure.mjs, Round 8 Q1 condition 2)
// and appended to $GITHUB_STEP_SUMMARY. Exit 0 when every run is a valid
// observation, 2 otherwise. It never decides n or the expected-RED list.
//
//   node tests/memory/job.mjs --measure-stalled N [--os …] [--out DIR] [--cap …]
//
// The S1/stalled attribution (ticket 61, Round 12 Q3 condition 1; CI: only
// while the marker tests/memory/measure-stalled exists): N rotations of
// S1/stalled and S1/drained (the same requests, every reader drains its
// answer), each with the measurement probes, recorded with the buckets of
// lib/measure.mjs in <out>/measure-S1-stalled.{json,md}. Same exit codes.
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
// Run keys in lib/budgets.mjs REPEATED run n times on the legs their rule names,
// one fresh isolated run after another, under <out>/<scenario>-<variant>/rep-<i>/,
// and are judged as one verdict (lib/repetitions.mjs): S1/burst1 (and linux
// S6/short) on the median plus a per-run ceiling (Round 6 Q1, Round 21 Q1);
// windows S1/short on a majority of RED repetitions under the unchanged
// growth() verdict plus a per-run ceiling (Round 17 Q3).
// <out>/<scenario>-<variant>/summary.json records every repetition's value
// (and trend), the median and the ceiling check.
//
// Writes <out>/job-summary.json and <out>/job-summary.md (also appended to
// $GITHUB_STEP_SUMMARY when set); each run's samples.csv and summary.json
// stay under <out>/<scenario>-<variant>/. Exit 0 when the ratchet holds,
// 1 when it does not, 2 when the job itself cannot run.
// --only runs a subset (local use): runs left out are reported, not failed.
// Runs RED only on commit (Windows) are listed for the owner (build-time gate 3).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB, osLeg, parseRunKey } from "./lib/catalogue.mjs";
import { checkRatchet, issueIdsIn, readExpectedRed, ticketsLabel } from "./lib/ratchet.mjs";
import { assertSafeRun, bunPath } from "./lib/isolated-kit.mjs";
import { bytes, chooseCap, commandFor, parseJobReport } from "./lib/caps.mjs";
import { runEvidence } from "./lib/completeness.mjs";
import { repetitionRule, runRepetitions } from "./lib/repetitions.mjs";
import { measureMarkdown, measureObservation, measureReport, pairedMarkdown, pairedReport, parseBunArms, parseMeasureSpec, parseStalledCount, STALLED_ARMS, stalledMarkdown, stalledObservation, stalledReport } from "./lib/measure.mjs";
import { heapAtCapLine } from "./lib/retained-heap.mjs";

// Round 17 Q1 condition 3: a retained-heap minimum above this comes back as a question.
const RETAINED_HEAP_QUESTION_MB = 66;

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
    else if (argv[i] === "--measure-burst1") out.measure = parseMeasureSpec(argv[++i]);
    else if (argv[i] === "--bun") out.bun = parseBunArms(argv[++i]);
    else if (argv[i] === "--measure-stalled") out.measureStalled = parseStalledCount(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (out.measureStalled && (out.measure || out.bun || out.only)) throw new Error("--measure-stalled runs on its own (no --measure-burst1, --bun or --only)");
  // --bun exists only for the paired measurement, and names exactly its arms (Round 10 Q1 condition 1).
  if (out.bun && !out.measure) throw new Error("--bun exists only in measurement mode (--measure-burst1 \"N bun=<v>,<v>…\")");
  if (out.measure?.arms || out.bun) {
    const arms = out.measure.arms ?? [];
    const given = Object.keys(out.bun ?? {});
    if (!out.measure.arms) throw new Error(`--bun needs a marker that names the arms ("N bun=${given.join(",")}"); this one is a plain count`);
    if (!out.bun) throw new Error(`the marker names the Bun arms ${arms.join(", ")}: pass --bun ${arms.map((v) => `${v}=<path>`).join(",")}`);
    if (given.length !== arms.length || !arms.every((v) => out.bun[v])) throw new Error(`--bun gives ${given.join(", ")}, the marker names ${arms.join(", ")}: they must match exactly`);
    for (const v of arms) if (!existsSync(out.bun[v])) throw new Error(`--bun ${v}=${out.bun[v]}: no such file`);
  }
  return out;
}

/** The job's own Bun (ZCODE_KIT_BUN or PATH) as `x.y.z+commit`, or null: the paired mode's reference check. */
function jobBunRevision() {
  try {
    const r = spawnSync(bunPath(), ["--revision"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() || null : null;
  } catch { return null; }
}

function runOne({ argv, timeoutMs }, logPath, env = process.env) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    const child = spawn(argv[0], argv.slice(1), { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
    lines.push(`| ${row.key} | ${row.outcome}${row.state === "unstable" ? " (unstable)" : ""}${r?.redOnlyOnCommit ? " (only on commit)" : ""} | ${row.owners ? ticketsLabel(row.owners) : row.ticket ? `ticket ${row.ticket}` : "—"} | ${(r?.redChecks ?? []).join(", ") || "—"} | ${r?.durationS ?? ""} | ${r?.samples ?? "—"} | ${Object.entries(r?.rolesSeen ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} |`);
  }
  if (ratchet.failures.length) lines.push("", "Failures:", ...ratchet.failures.map((f) => `- ${f}`));
  // Round 9 Q1 condition 2, Round 13 Q1 condition 1: every passing run of an unstable entry says so.
  // Round 14 Q1 condition 2, Round 15 Q1 condition 4: every tolerated RED of a listed single run with
  // the tickets that own its checks, and every listed run passing GREEN on a flipping check.
  const owned = ratchet.rows.filter((row) => row.note && row.state !== "unstable");
  if (owned.length) lines.push("", "Tolerated REDs and flipping GREENs (Round 14 Q1, Round 15 Q1: each listed run RED only on checks its owners own, GREEN only while a check is marked `flips`; each owner removes only its own names, in its own commit):", ...owned.map((row) => `- ${row.note}`));
  const notes = ratchet.rows.filter((row) => row.note && row.state === "unstable");
  if (notes.length) lines.push("", "Unstable entries (Round 9 Q1, Round 13 Q1; each leaves only through its owner's measured exit: ticket 20's ≥ 20 runs, ticket 74's ≥ 10 runs):", ...notes.map((row) => `- ${row.note}`));
  const repeated = results.filter((r) => r.median);
  if (repeated.length) {
    lines.push("", "Judged on the median of n fresh repetitions (one verdict per run key; every repetition must also stay within the per-run ceiling; Windows: the WS gate, commit reported):", "", "| run | n | gate | repetitions (MB) | median | budget | ceiling | over ceiling | commit per repetition (MB) |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of repeated) {
      const m = r.median;
      const gate = m.gate === "ws" ? "WS" : m.gate === "commit" ? "commit" : "RSS";
      lines.push(`| ${r.key} | ${m.n} | ${gate} | ${m.values.map((v) => v ?? "—").join(", ")} | ${m.medianMB ?? "—"} | ≤ ${m.budgetMB} | ≤ ${m.ceilingMB} | ${m.overCeiling.length ? m.overCeiling.map((i) => `#${i}`).join(", ") : "none"} | ${m.commitValues ? `${m.commitValues.join(", ")} (median ${m.commitMedianMB})` : "—"} |`);
    }
  }
  const majority = results.filter((r) => r.majority);
  if (majority.length) {
    lines.push("", "Judged on n fresh repetitions, RED when at least k of them are RED under the unchanged verdict (Round 17 Q3; the value reported is the median; every repetition must also stay within the per-run ceiling on commit; every other check is judged in each repetition):", "", "| run | n | gate | values | trend | RED repetitions | median | budget | RED when | ceiling | over ceiling | WS per repetition |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of majority) {
      const m = r.majority;
      const gate = m.gate === "ws" ? "WS" : m.gate === "commit" ? "commit" : "RSS";
      lines.push(`| ${r.key} | ${m.n} | ${gate} | ${m.values.map((v) => v ?? "—").join(", ")} | ${m.trends.map((t) => t ?? "—").join(", ")} | ${m.redRepetitions.length ? m.redRepetitions.map((i) => `#${i}`).join(", ") : "none"} (${m.redRepetitions.length} of ${m.n}) | ${m.median ?? "—"} | ≤ ${m.budget} | ≥ ${m.redAtLeast} of ${m.n} | ≤ ${m.ceiling} | ${m.overCeiling.length ? m.overCeiling.map((i) => `#${i}`).join(", ") : "none"} | ${m.wsValues ? m.wsValues.join(", ") : "—"} |`);
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
  // Round 17 Q1 conditions 1 and 3: every run records the retained-heap series; a minimum
  // above 66 MB (the store's cluster is 59–65 MB) comes back as a question with the series.
  const heaps = results.filter((r) => r.retainedHeap?.detail);
  if (heaps.length) {
    lines.push("", "Responses store retained heap (Round 17 Q1: the minimum of the /health series after the load, minus h0; budget 96 MB):");
    for (const r of heaps) {
      const c = r.retainedHeap;
      lines.push(`- ${r.key} ${heapAtCapLine(c)}${c.value > RETAINED_HEAP_QUESTION_MB ? ` — minimum above ${RETAINED_HEAP_QUESTION_MB} MB: comes back as a question with the series (Round 17 Q1 condition 3)` : ""}`);
      lines.push(`  series (MB): ${c.detail.seriesMB.join(" ")}`);
    }
  }
  const onlyCommit = results.filter((r) => r.redOnlyOnCommit);
  if (onlyCommit.length) lines.push("", "RED only on commit (working set within budget) — raised to the owner, never adjusted silently (build-time gate 3):", ...onlyCommit.map((r) => `- ${r.key}: ${r.redChecks.join(", ")} (working set: ${r.workingSetRedChecks.join(", ") || "green"})`));
  // Ticket 81 (round 33 condition 4d): the job summary prints the event each trial delivered.
  const deliveries = results.filter((r) => r.sigintDelivery);
  if (deliveries.length) {
    lines.push("", "Ctrl-C-during-start trials (ticket 81, Round 33: windows delivers CTRL_BREAK_EVENT to the trial child's own process group; linux SIGINT (kill), unchanged):");
    for (const r of deliveries) {
      const d = r.sigintDelivery;
      const proof = d.provenByReleaseLine !== null && d.provenByReleaseLine !== undefined
        ? `, proven by the release line in ${d.provenByReleaseLine}, by the event exit in ${d.provenByEventExit}, start completed first in ${d.startCompletedFirst}${d.selfTest ? `; ${d.selfTest}` : ""}`
        : ", delivery is child.kill(SIGINT) on this platform";
      lines.push(`- ${r.key}: ${d.method}${d.trials ? `, ${d.trials} trials, ${d.delivered} delivered` : ""}${proof}`);
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (err) { console.error(`memory-budget: ${err.message}`); return 2; }
  const keys = JOB[args.os];
  if (!keys) { console.error(`memory-budget: no job for OS leg ${args.os}`); return 2; }
  const selected = args.only ?? keys;
  for (const k of selected) if (!keys.includes(k)) { console.error(`memory-budget: ${k} is not a run of the ${args.os} job`); return 2; }  try { assertSafeRun(); } catch (err) { console.error(`memory-budget: ${err.message}`); return 2; }
  const capChoice = chooseCap(args.cap);
  if (capChoice.error) { console.error(`memory-budget: ${capChoice.error}`); return 2; }
  let expected, issueIds;
  try {
    expected = readExpectedRed(join(HERE, "expected-red.json"));
    issueIds = issueIdsIn(join(ROOT, ".scratch", "kit-overhaul", "issues"));
  } catch (err) { console.error(`memory-budget: cannot read the expected-RED list or the issues: ${err.message}`); return 2; }
  mkdirSync(args.out, { recursive: true });
  console.log(args.measureStalled
    ? `memory-budget: S1/stalled attribution, ${args.measureStalled} rotations of ${STALLED_ARMS.join(" → ")} on ${args.os}, cap ${capChoice.cap}, output ${args.out}`
    : args.measure?.arms
    ? `memory-budget: S1/burst1 paired Bun measurement, ${args.measure.count} runs per arm (${args.measure.arms.join(" → ")} in rotation) on ${args.os}, cap ${capChoice.cap}, output ${args.out}`
    : args.measure ? `memory-budget: S1/burst1 measurement, ${args.measure.count} fresh runs on ${args.os}, cap ${capChoice.cap}, output ${args.out}` : `memory-budget: ${selected.length} runs on ${args.os}, cap ${capChoice.cap}, output ${args.out}`);

  // One fresh run of a key into `dir`, capped and timed out: its job result.
  // extraEnv (measurement mode only): the arm's Bun and the probes switch.
  async function runIn(key, dir, extraEnv = null) {
    const { scenario, profile, variant } = parseRunKey(key);
    mkdirSync(dir, { recursive: true });
    const runArgs = [scenario, "--profile", profile, ...(variant ? ["--variant", variant] : []), "--out", dir];
    const size = CAP[key] ?? CAP[scenario] ?? DEFAULT_CAP;
    const cmd = commandFor(capChoice.cap, size, (TIMEOUT_S[scenario] ?? DEFAULT_TIMEOUT_S) * (TIMEOUT_FACTOR[args.os] ?? 1), runArgs, { runScript: args.runScript });
    const r = await runOne(cmd, join(dir, "run.log"), extraEnv ? { ...process.env, ...extraEnv, ZCODE_MEMLOOP_CAP: size } : process.env);
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
      // Every check the run produced: the ratchet refuses an owned name the run never produces (Round 14 Q1).
      checkNames: (summary?.checks ?? []).map((c) => c.name),
      // S7: the responses store's retained-heap check with its series (Round 17 Q1).
      ...(() => { const c = (summary?.checks ?? []).find((x) => x.name === "responses-store:heap-at-cap" && x.detail?.seriesMB); return c ? { retainedHeap: c } : {}; })(),
      // Windows (Round 7 Q1): every memory check with both values and the metric that gates it.
      memoryChecks: (summary?.checks ?? []).filter((c) => c.commitValue !== undefined).map((c) => ({ name: c.name, red: c.red, gate: c.gate, commitMB: c.commitValue, wsMB: c.wsValue, budget: c.budget })),
      // Every growth check with its value, trend and sample count, insufficient ones included:
      // the ratchet judges an unstable growth band on it (lib/ratchet.mjs, Round 13 Q1).
      growthChecks: (summary?.checks ?? []).filter((c) => /^growth:/.test(c.name)).map((c) => ({ name: c.name, red: c.red, value: c.value ?? null, commitValue: c.commitValue ?? null, wsValue: c.wsValue ?? null, gate: c.gate ?? null, budget: c.budget, trend: c.trend === true, insufficient: c.detail?.insufficient === true, samples: c.detail?.samples ?? null, windowMediansMB: c.detail?.windowMediansMB ?? null, risingWindows: c.detail?.risingWindows ?? null, netRisePct: c.detail?.netRisePct ?? null })),
      // Ticket 81 (round 33 condition 4d): the event the S4 Ctrl-C trials delivered, with their proof counts.
      sigintDelivery: summary?.notes?.sigintDelivery ?? null,
      error: why ?? summary?.error ?? r.error ?? null };
    return { result, summary };
  }

  if (args.measureStalled) {
    // The S1/stalled attribution (ticket 61, Round 12 Q3 condition 1): the
    // stalled run and its drained reference in rotation, no verdict, no ratchet.
    const reps = [];
    let i = 0;
    for (let k = 1; k <= args.measureStalled; k++) {
      for (const arm of STALLED_ARMS) {
        i += 1;
        console.log(`\n── S1/stalled attribution run ${i} of ${args.measureStalled * STALLED_ARMS.length} (${arm}) ──`);
        const dir = join(args.out, "measure-S1-stalled", `rep-${k}-${arm.replace("/", "-")}`);
        const { result, summary } = await runIn(arm, dir, { ZCODE_MEMLOOP_MEASURE_PROBES: "1" });
        const obs = stalledObservation({ rep: k, arm, result, summary, csvText: readSamples(dir) });
        console.log(`${arm} attribution run ${k}: ${obs.outcome}, peak ${obs.gateMB ?? "—"} MB over a floor of ${obs.floorMB ?? "—"}, heap ${obs.heapPeakMB ?? "—"} over ${obs.floorHeapMB ?? "—"}${obs.valid ? "" : ` (invalid: ${obs.problems.join("; ")})`}`);
        reps.push(obs);
      }
    }
    const report = { ...stalledReport(reps, { os: args.os, requested: args.measureStalled }), cap: capChoice.cap, node: process.version };
    writeFileSync(join(args.out, "measure-S1-stalled.json"), JSON.stringify(report, null, 2));
    const md = stalledMarkdown(report);
    writeFileSync(join(args.out, "measure-S1-stalled.md"), md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    console.log(`\n${md}`);
    return report.complete ? 0 : 2;
  }

  if (args.measure) {
    // Measurement mode (Round 8 Q1 condition 2): the distribution, no verdict, no ratchet.
    // With arms (Round 10 Q1 condition 1): N runs per arm, interleaved in
    // rotation (never in blocks), each run on its arm's Bun.
    const key = "S1/burst1";
    const rule = repetitionRule(key);
    const arms = args.measure.arms;
    const plan = [];
    for (let k = 1; k <= args.measure.count; k++) for (const bun of arms ?? [null]) plan.push(bun);
    const reps = [];
    for (const [idx, bun] of plan.entries()) {
      const i = idx + 1;
      console.log(`\n── ${key} measurement run ${i} of ${plan.length}${bun ? ` (Bun ${bun} arm)` : ""} ──`);
      const dir = join(args.out, "measure-S1-burst1", bun ? `rep-${i}-bun-${bun}` : `rep-${i}`);
      const extraEnv = { ZCODE_MEMLOOP_MEASURE_PROBES: "1", ...(bun ? { ZCODE_KIT_BUN: args.bun[bun] } : {}) };
      const { result, summary } = await runIn(key, dir, extraEnv);
      const obs = measureObservation({ rep: i, result, summary, csvText: readSamples(dir), rule, arm: bun, bunPath: bun ? args.bun[bun] : null });
      console.log(`${key} measurement run ${i}${bun ? ` [${bun}, proxy ran ${obs.bunRuntime ?? "?"}]` : ""}: ${obs.outcome}, gate ${obs.gateMB ?? "—"} MB${obs.valid ? "" : ` (invalid: ${obs.problems.join("; ")})`}`);
      reps.push(obs);
    }
    const report = arms
      ? { ...pairedReport(reps, { key, os: args.os, arms, perArm: args.measure.count, rule, jobBun: jobBunRevision() }), cap: capChoice.cap, node: process.version }
      : { ...measureReport(reps, { key, os: args.os, requested: args.measure.count, rule }), cap: capChoice.cap, node: process.version };
    writeFileSync(join(args.out, "measure-S1-burst1.json"), JSON.stringify(report, null, 2));
    const md = arms ? pairedMarkdown(report) : measureMarkdown(report);
    writeFileSync(join(args.out, "measure-S1-burst1.md"), md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    console.log(`\n${md}`);
    return report.complete ? 0 : 2;
  }

  const results = [];
  for (const key of selected) {
    const dir = join(args.out, key.replace("/", "-"));
    const rule = repetitionRule(key, undefined, args.os);
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
    const majority = rule.kind === "majority";
    const repetitions = set.reps.map((r, i) => ({ rep: i + 1, exitCode: r.exitCode, value: set.values[i], ...(majority ? { trend: set.trends[i], red: set.redRepetitions.includes(i + 1), ...(set.wsValues ? { wsValue: set.wsValues[i] } : {}) } : {}), ...(set.commitValues ? { commitValue: set.commitValues[i] } : {}), redChecks: r.redChecks, durationS: r.durationS, samples: r.samples, units: r.units, ...(r.jobApplied !== undefined ? { jobApplied: r.jobApplied } : {}), ...(r.error ? { error: r.error } : {}) }));
    // Round 17 Q3: the majority rule reports every value, its trend and the median.
    const verdictOf = majority
      ? { majority: { n: rule.n, check: rule.check, gate: set.gate, unit: rule.unit, values: set.values, trends: set.trends, redRepetitions: set.redRepetitions, median: set.median, budget: rule.budget, redAtLeast: rule.redAtLeast, ceiling: rule.ceiling, overCeiling: set.overCeiling, ...(set.commitValues ? { commitValues: set.commitValues } : {}), ...(set.wsValues ? { wsValues: set.wsValues } : {}) } }
      : { median: { n: rule.n, check: rule.check, gate: set.gate, values: set.values, medianMB: set.medianMB, budgetMB: rule.budgetMB, ceilingMB: rule.ceilingMB, overCeiling: set.overCeiling, ...(set.commitValues ? { commitValues: set.commitValues, commitMedianMB: set.commitMedianMB } : {}) } };
    const first = set.reps[0] ?? {};
    const rolesSeen = {};
    for (const r of set.reps) for (const [role, c] of Object.entries(r.rolesSeen ?? {})) rolesSeen[role] = Math.max(rolesSeen[role] ?? 0, c ?? 0);
    const result = { key, exitCode: set.exitCode, cap: first.cap, durationS: set.reps.reduce((a, r) => a + (r.durationS ?? 0), 0), samples: set.reps.reduce((a, r) => a + (r.samples ?? 0), 0), rolesSeen, units: set.reps.find((r) => r.units && r.units.ok !== true)?.units ?? first.units ?? null, metric: first.metric ?? null, samplerOverhead: first.samplerOverhead ?? null, redOnlyOnCommit: set.redOnlyOnCommit, workingSetRedChecks: set.workingSetRedChecks, redChecks: set.redChecks, memoryChecks: [], error: set.error ?? null, ...verdictOf, repetitions };
    const ruleText = majority ? `RED when ≥ ${rule.redAtLeast} of ${rule.n} fresh repetitions are RED, every repetition ≤ ${rule.ceiling} ${rule.unit} (Round 17 Q3)` : "median of n fresh repetitions (Round 6 Q1)";
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ key, outcome: { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" }[set.exitCode], rule: ruleText, ...(majority ? verdictOf.majority : verdictOf.median), redChecks: set.redChecks, redOnlyOnCommit: set.redOnlyOnCommit, ...(set.error ? { error: set.error } : {}), repetitions }, null, 2));
    const outcome = { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" }[set.exitCode];
    if (majority) console.log(`${key}: ${rule.check} ${set.redRepetitions.length} of ${set.reps.length} repetitions RED, median ${set.median ?? "—"} ${rule.unit} of [${set.values.join(", ")}] trends [${set.trends.join(", ")}] (budget ${rule.budget}, RED when ≥ ${rule.redAtLeast} of ${rule.n}, every run ≤ ${rule.ceiling}${set.gate ? `, gate ${set.gate}` : ""}): ${outcome}${set.error ? ` (${set.error})` : ""}`);
    else console.log(`${key}: median ${set.medianMB ?? "—"} MB of [${set.values.join(", ")}] (budget ${rule.budgetMB}, every run ≤ ${rule.ceilingMB}${set.gate ? `, gate ${set.gate === "ws" ? "WS" : "commit"}` : ""}): ${outcome}${set.error ? ` (${set.error})` : ""}`);
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
