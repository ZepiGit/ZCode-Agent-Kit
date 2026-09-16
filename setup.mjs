#!/usr/bin/env node
// ZCode access kit — one-command setup for a fresh clone (compat entry).
//
//   node setup.mjs                        # bootstrap + wire all detected harnesses
//   node setup.mjs --only=omp,mcp         # subset: omp | claude-code | codex | mcp
//   node setup.mjs --rollback [tx-id]     # undo the newest (or named) transaction
//   node setup.mjs --list-transactions    # show recorded transaction ids
//
// Since the zcode-kit CLI exists, this file is a thin shim delegating to
// cli/zcode-kit.mjs — same behavior, one implementation (audit §6: no
// duplicated setup logic). Legacy flags map as: --only=<list> → --harness=<list>.
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listTransactions } from "./lib/transaction.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mode = argv[0] ?? "install";
const kit = join(ROOT, "cli", "zcode-kit.mjs");

if (mode === "--postinstall-hint") {
  console.log("ZCode Agent Kit installed. Run zcode-kit setup to configure your detected harnesses.");
} else if (mode === "--rollback" || mode === "rollback") {
  const res = spawnSync(process.execPath, [kit, "rollback", ...(argv[1] ? [argv[1]] : [])], { stdio: "inherit" });
  process.exit(res.status ?? 1);
} else if (mode === "--list-transactions") {
  const ids = listTransactions(join(ROOT, "backups"));
  console.log(ids.length ? ids.join("\n") : "no transactions recorded");
} else {
  const only = argv.find((a) => a.startsWith("--only="));
  const args = ["setup"];
  if (only) args.push(`--harness=${only.slice(7)}`);
  const res = spawnSync(process.execPath, [kit, ...args], { stdio: "inherit" });
  process.exit(res.status ?? 1);
}
