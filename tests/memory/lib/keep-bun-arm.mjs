#!/usr/bin/env node
// CI helper for the paired Bun measurement:
//
//   node tests/memory/lib/keep-bun-arm.mjs <bun-path> <x.y.z> <arms-dir>
//
// setup-bun always installs to ~/.bun/bin, so each arm's binary is copied to
// <arms-dir>/<x.y.z>/bun[.exe] right after its setup-bun step. The copy counts
// only if it reports <x.y.z>+<commit> for --revision; otherwise it is removed
// and the step fails, so a mislabelled arm can never run.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

const [src, version, armsDir] = process.argv.slice(2);
if (!src || !/^\d+\.\d+\.\d+$/.test(version ?? "") || !armsDir) {
  console.error("usage: keep-bun-arm.mjs <bun-path> <x.y.z> <arms-dir>");
  process.exit(2);
}
const dir = join(armsDir, version);
const dest = join(dir, basename(src));
mkdirSync(dir, { recursive: true });
copyFileSync(src, dest);
const r = spawnSync(dest, ["--revision"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
const revision = (r.stdout ?? "").trim();
if (r.status !== 0 || !revision.startsWith(`${version}+`)) {
  rmSync(dir, { recursive: true, force: true });
  console.error(`keep-bun-arm: ${src} reports ${JSON.stringify(revision || r.stderr || String(r.error ?? `exit ${r.status}`))}, not Bun ${version}; the arm is not kept`);
  process.exit(1);
}
console.log(`keep-bun-arm: Bun ${revision} kept as ${dest}`);
