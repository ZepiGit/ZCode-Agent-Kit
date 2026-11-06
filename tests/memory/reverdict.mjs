#!/usr/bin/env node
// Re-evaluate a finished memory-loop run from its samples.csv and summary.json
// (e.g. after a budget change):  node tests/memory/reverdict.mjs <run dir> [budgets.json]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verdict } from "./lib/verdict.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node tests/memory/reverdict.mjs <run dir> [budgets.json]"); process.exit(2); }
const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
const budgets = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : summary.budgets;
const rows = new Map();
for (const line of readFileSync(join(dir, "samples.csv"), "utf8").split("\n").slice(1)) {
  if (!line) continue;
  const [t, pid, , role, rss, hwm, threads, fds, heap, progress] = line.split(",");
  const key = Number(t);
  if (!rows.has(key)) rows.set(key, { t: key, progress: Number(progress), procs: [] });
  rows.get(key).procs.push({ pid: Number(pid), key: pid, role, rssKb: Number(rss), hwmKb: Number(hwm), threads: Number(threads), fds: Number(fds), heapMB: heap === "" ? null : Number(heap) });
}
const v = verdict([...rows.values()], budgets, { orphans: summary.orphans ?? [] });
console.log(`${summary.id}: ${v.red ? "RED" : "GREEN"}`);
for (const c of v.checks) console.log(`${c.red ? "RED  " : "ok   "} ${c.name.padEnd(28)} ${String(c.value).padStart(10)} ${c.unit ?? ""} (budget ${c.budget})${c.detail?.windowMediansMB ? ` windows ${c.detail.windowMediansMB.join(" ")}` : ""}`);
process.exitCode = v.red ? 1 : 0;
