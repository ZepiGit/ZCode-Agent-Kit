#!/usr/bin/env node
// Inventory: files on disk that git does not track (excluding runtime dirs).
import { readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const tracked = new Set(execSync("git ls-files", { encoding: "utf8", cwd: process.cwd() }).trim().split("\n").map((s) => s.replace(/\\/g, "/")));
const skipDirs = new Set(["node_modules", ".git", "Android-APP", "fakehome", "tooltrip", "dryhome", "generated", "logs", "backups", "__pycache__", ".mimosa"]);
const missing = [];
const walk = (dir, rel) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(dir + "/" + e.name, r); }
    else if (!tracked.has(r)) missing.push(r);
  }
};
walk(".", "");
console.log("untracked-but-on-disk:");
for (const m of missing) console.log(" ", m);
console.log("total:", missing.length);
