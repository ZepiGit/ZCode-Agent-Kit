// Helper: summarize mimosa hardcoded-secret findings from `audit --json` output.
// Usage: node scripts/scan-report.cjs <report.json>
const fs = require("node:fs");
const path = require("node:path");

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: node scripts/scan-report.cjs <report.json>");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const root = process.cwd();

let total = 0;
const rows = [];
for (const entry of report.files ?? []) {
  const hits = (entry.findings ?? []).filter((f) => f.ruleId === "mimosa.hardcoded-secret");
  if (hits.length === 0) continue;
  const rel = path.relative(root, entry.file).split(path.sep).join("/");
  const lines = [...new Set(hits.map((h) => h.line))].sort((a, b) => a - b);
  total += lines.length;
  rows.push(`${rel}: ${lines.join(", ")}`);
}

if (rows.length === 0) console.log("NO hardcoded-secret findings");
else rows.sort().forEach((r) => console.log(r));
console.log(`TOTAL hardcoded-secret findings: ${total}`);
