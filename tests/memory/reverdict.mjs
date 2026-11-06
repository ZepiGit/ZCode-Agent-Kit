#!/usr/bin/env node
// Re-evaluate a finished memory-loop run from its samples.csv and summary.json
// (e.g. after a budget change):  node tests/memory/reverdict.mjs <run dir> [budgets.json]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSamplesCsv, rowsFromSamples } from "./lib/sampler.mjs";
import { osVerdict } from "./lib/verdict.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node tests/memory/reverdict.mjs <run dir> [budgets.json]"); process.exit(2); }
const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
const budgets = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : summary.budgets;
if (!budgets) { console.error(`${dir}: summary.json has no budgets (a harness failure?)`); process.exit(2); }
const rows = rowsFromSamples(parseSamplesCsv(readFileSync(join(dir, "samples.csv"), "utf8")));
// RSS on Linux, commit where the CSV carries commit_kb (Windows).
const v = osVerdict(rows, budgets, { orphans: summary.orphans ?? [], observations: summary.observations ?? [] });
console.log(`${summary.id}: ${v.red ? "RED" : "GREEN"} (${v.metric})${v.redOnlyOnCommit ? " — RED only on commit" : ""}`);
for (const c of v.checks) console.log(`${c.red ? "RED  " : "ok   "} ${c.name.padEnd(28)} ${String(c.value).padStart(10)} ${c.unit ?? ""} (budget ${c.budget})${c.detail?.windowMediansMB ? ` windows ${c.detail.windowMediansMB.join(" ")}` : ""}`);
process.exitCode = v.red ? 1 : 0;
