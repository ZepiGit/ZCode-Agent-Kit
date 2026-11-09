#!/usr/bin/env node
// Pools the S2 CDN cache A/B reports of several jobs (ticket 80 stage 1, Owner
// Proxy round 31 Q1) and reads the pre-registered rule over them:
//
//   node tests/memory/cdn-ab-pool.mjs [--json] measure-S2-cdn.json [measure-S2-cdn.json …]
//
// Every input is one job's <out>/measure-S2-cdn.json (job.mjs --measure-cdn),
// all from the same OS leg. Only valid runs enter the arms. The rule judges
// windows commit values and needs ≥ 30 valid runs per arm; a linux pool is
// recorded without it. The jobs' orders (ABAB / BABA) and trees are listed:
// a merge on S2's path between the jobs restarts the count (ticket 80).
// Prints Markdown (or the pooled report as JSON with --json). Exit 0, or 2
// when the inputs cannot be pooled.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { cdnMarkdown, cdnReport } from "./lib/measure-cdn.mjs";

function main(argv) {
  const json = argv.includes("--json");
  const files = argv.filter((a) => a !== "--json");
  if (!files.length) { console.error("cdn-ab-pool: name one or more measure-S2-cdn.json files"); return 2; }
  let reports;
  try { reports = files.map((f) => ({ file: f, report: JSON.parse(readFileSync(f, "utf8")) })); } catch (err) { console.error(`cdn-ab-pool: ${err.message}`); return 2; }
  const oses = [...new Set(reports.map(({ report }) => report.os))].sort();
  if (oses.length !== 1) { console.error(`cdn-ab-pool: one OS leg per pool (got ${oses.join(", ")})`); return 2; }
  const jobs = reports.map(({ file, report }) => ({ file: basename(file), order: report.order ?? null, attempt: report.attempt ?? null, tree: report.tree ?? null, runs: report.reps?.length ?? 0, valid: (report.reps ?? []).filter((r) => r.valid).length }));
  const reps = reports.flatMap(({ report }, j) => (report.reps ?? []).map((r) => ({ ...r, job: j + 1 })));
  const trees = [...new Set(jobs.map((j) => j.tree).filter(Boolean))];
  const pooled = { ...cdnReport(reps, { os: oses[0] }), jobs, trees };
  if (json) { process.stdout.write(JSON.stringify(pooled, null, 2) + "\n"); return 0; }
  const count = (o) => jobs.filter((j) => j.order === o).length;
  const head = `## S2 CDN cache A/B, pooled (${oses[0]}, ${jobs.length} jobs (ABAB ${count("ABAB")}, BABA ${count("BABA")}), ${trees.length} tree${trees.length === 1 ? "" : "s"} (${trees.join(", ") || "unknown"}))`;
  process.stdout.write(cdnMarkdown(pooled, { title: head }) + (trees.length > 1 ? "\nThe jobs ran on more than one tree: check that S2's path did not change between them (a merge on it restarts the count).\n" : ""));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
