#!/usr/bin/env node
// The memory-budget job: every run of this OS leg's job (lib/catalogue.mjs
// JOB), each under a hard memory cap and a timeout, then the expected-RED
// ratchet (lib/ratchet.mjs) over the outcomes.
//
//   node tests/memory/job.mjs [--os linux] [--out DIR] [--cap auto|systemd|prlimit|none] [--only KEY,KEY]
//
// Caps (--cap auto picks the first that works):
//   systemd  `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0`,
//            verified by reading the scope's memory.max from inside it;
//   prlimit  `prlimit --as=2×cap` per process (address space, a coarse
//            fallback where no user systemd manager is reachable);
//   none     only when the caller already runs the job under a cap.
// Every run also gets `timeout --kill-after=30`.
//
// Writes <out>/job-summary.json and <out>/job-summary.md (also appended to
// $GITHUB_STEP_SUMMARY when set); each run's samples.csv and summary.json
// stay under <out>/<scenario>-<variant>/. Exit 0 when the ratchet holds,
// 1 when it does not, 2 when the job itself cannot run.
// --only runs a subset (local use): runs left out are reported, not failed.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB, osLeg, parseRunKey } from "./lib/catalogue.mjs";
import { checkRatchet, issueIdsIn, readExpectedRed } from "./lib/ratchet.mjs";
import { assertSafeRun } from "./lib/isolated-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
// Per-scenario cap and timeout. S2's hang phase parks 5 × 256 MB; S5 is the longest.
const CAP = { S2: "4G" };
const TIMEOUT_S = { S5: 1800 };
const DEFAULT_CAP = "3G";
const DEFAULT_TIMEOUT_S = 1200;

function parseArgs(argv) {
  const out = { os: osLeg(), out: resolve(ROOT, ".memloop", "job"), cap: "auto", only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--os") out.os = argv[++i];
    else if (argv[i] === "--out") out.out = resolve(argv[++i]);
    else if (argv[i] === "--cap") out.cap = argv[++i];
    else if (argv[i] === "--only") out.only = argv[++i].split(",").filter(Boolean);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

const bytes = (size) => Number(size.replace(/G$/, "")) * 1024 ** 3;

/** Does a user systemd scope apply MemoryMax here? Reads memory.max from inside the scope. */
function systemdScopeWorks() {
  const want = 64 * 1024 * 1024;
  const r = spawnSync("systemd-run", ["--user", "--scope", "--quiet", "-p", `MemoryMax=${want}`, "-p", "MemorySwapMax=0", "--", "sh", "-c", 'cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max"'], { encoding: "utf8", timeout: 30_000 });
  return r.status === 0 && r.stdout.trim() === String(want) ? { ok: true } : { ok: false, why: (r.stderr || r.stdout || String(r.error ?? "")).trim().split("\n").slice(-1)[0] };
}

function chooseCap(requested) {
  if (requested === "none") return { cap: "none" };
  if (process.platform !== "linux") return { error: `no cap mechanism for ${process.platform} yet (the windows leg uses a Job Object, ticket 02)` };
  if (requested === "systemd" || requested === "auto") {
    const s = systemdScopeWorks();
    if (s.ok) return { cap: "systemd" };
    if (requested === "systemd") return { error: `systemd-run --user scope with MemoryMax is not available: ${s.why}` };
    console.error(`memory-budget: systemd user scope unavailable (${s.why}); falling back to prlimit`);
  }
  if (spawnSync("prlimit", ["--version"]).status === 0) return { cap: "prlimit" };
  return { error: "neither a systemd user scope nor prlimit is available: the job never runs uncapped" };
}

function commandFor(cap, size, timeoutS, args) {
  const inner = ["timeout", "--kill-after=30", String(timeoutS), process.execPath, join(HERE, "run.mjs"), ...args];
  if (cap === "systemd") return ["systemd-run", "--user", "--scope", "--quiet", "-p", `MemoryMax=${size}`, "-p", "MemorySwapMax=0", "--", ...inner];
  if (cap === "prlimit") return ["prlimit", `--as=${2 * bytes(size)}`, "--", ...inner];
  return inner;
}

function runOne(argv, logPath) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    const child = spawn(argv[0], argv.slice(1), { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const log = (b) => { process.stdout.write(b); appendFileSync(logPath, b); };
    child.stdout.on("data", log);
    child.stderr.on("data", log);
    child.on("close", (code, signal) => resolveRun({ code: code ?? 2, signal, durationS: Math.round((Date.now() - t0) / 1000) }));
    child.on("error", (err) => resolveRun({ code: 2, signal: null, durationS: 0, error: String(err) }));
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

function markdown({ os, cap, ratchet, results, partial }) {
  const lines = [`## memory-budget (${os}, short profile): ${ratchet.ok ? "ratchet holds" : "ratchet FAILED"}`, "", `cap: ${cap} · node ${process.version}${partial ? " · partial run (--only)" : ""}`, "", "| run | outcome | expected-RED | red checks | s |", "|---|---|---|---|---|"];
  for (const row of ratchet.rows) {
    const r = results.find((x) => x.key === row.key);
    lines.push(`| ${row.key} | ${row.outcome} | ${row.ticket ? `ticket ${row.ticket}` : "—"} | ${(r?.redChecks ?? []).join(", ") || "—"} | ${r?.durationS ?? ""} |`);
  }
  if (ratchet.failures.length) lines.push("", "Failures:", ...ratchet.failures.map((f) => `- ${f}`));
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
  console.log(`memory-budget: ${selected.length} runs on ${args.os}, cap ${capChoice.cap}, output ${args.out}`);

  const results = [];
  for (const key of selected) {
    const { scenario, profile, variant } = parseRunKey(key);
    const dir = join(args.out, key.replace("/", "-"));
    mkdirSync(dir, { recursive: true });
    const runArgs = [scenario, "--profile", profile, ...(variant ? ["--variant", variant] : []), "--out", dir];
    console.log(`\n── ${key} ──`);
    const r = await runOne(commandFor(capChoice.cap, CAP[scenario] ?? DEFAULT_CAP, TIMEOUT_S[scenario] ?? DEFAULT_TIMEOUT_S, runArgs), join(dir, "run.log"));
    const summary = readSummary(dir);
    // run.mjs exits 0/1/2; anything else (timeout 124, a cap kill 137) is a harness failure.
    const exitCode = [0, 1, 2].includes(r.code) ? r.code : 2;
    results.push({ key, exitCode, rawExit: r.code, signal: r.signal, durationS: r.durationS, redChecks: (summary?.checks ?? []).filter((c) => c.red).map((c) => c.name), error: summary?.error ?? r.error ?? null });
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
