// The memory loop at process level (seam 1): the sampler finds every process
// carrying the run marker — including a detached child its parent left
// behind — and writes the CSV schema the verdict and reverdict read; the
// entry point refuses to run outside a capped, isolated run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSamplesCsv, roleOf, startSampler, supported, survivors } from "./lib/sampler.mjs";

const linuxOnly = { skip: supported() ? false : `no sampler on ${process.platform} yet (ticket 02)` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("a solver process is its own role, whatever runtime starts it", () => {
  assert.equal(roleOf(["/usr/bin/bun", "/kit/zcode-proxy-src/src/proxy/captcha-solver-child.ts"]), "solver");
  assert.equal(roleOf(["/kit/zcode-proxy", "captcha-solver"]), "solver");
  assert.equal(roleOf(["/usr/bin/bun", "/kit/zcode-proxy-src/src/index.ts", "serve"]), "proxy");
});

test("samples.csv keeps its columns and appends commit_kb, empty on Linux", linuxOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-sampler-"));
  const marker = `ZCODE_MEMLOOP_RUN=sampler-test-${process.pid}`;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { env: { ...process.env, ZCODE_MEMLOOP_RUN: marker.split("=")[1] }, stdio: "ignore" });
  try {
    const sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 200, progress: () => 7 });
    await sleep(700);
    const rows = await sampler.stop();
    const text = readFileSync(join(dir, "samples.csv"), "utf8");
    assert.equal(text.split("\n")[0], "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb");
    const parsed = parseSamplesCsv(text).filter((r) => r.pid === child.pid);
    assert.ok(parsed.length >= 2, "the marked child is sampled");
    assert.equal(parsed[0].commitKb, null);
    assert.ok(parsed[0].rssKb > 0 && parsed[0].hwmKb >= parsed[0].rssKb);
    assert.equal(parsed[0].ppid, process.pid);
    assert.equal(parsed[0].progress, 7);
    assert.ok(rows.some((r) => r.procs.some((p) => p.pid === child.pid)));
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// The entry point refuses to run any scenario outside a capped, isolated run.
const RUN = join(dirname(fileURLToPath(import.meta.url)), "run.mjs");
function runLoop(args, env) {
  const clean = { ...process.env };
  delete clean.ZCODE_OVERHAUL_RUN;
  delete clean.ZCODE_MEMLOOP_ALLOW;
  return spawnSync(process.execPath, [RUN, ...args], { env: { ...clean, ...env }, encoding: "utf8", timeout: 30_000 });
}

test("run.mjs refuses every scenario without ZCODE_OVERHAUL_RUN=1 or ZCODE_MEMLOOP_ALLOW=1 (exit 2, nothing started)", () => {
  const out = mkdtempSync(join(tmpdir(), "memloop-guard-"));
  try {
    for (const scenario of ["S2", "S5", "S6"]) {
      const r = runLoop([scenario, "--out", out], { HOME: out });
      assert.equal(r.status, 2, `${scenario}: ${r.stderr}`);
      assert.match(r.stderr, /refuses to run outside a capped run/);
    }
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("run.mjs refuses the real home directory as HOME inside a capped run", () => {
  const out = mkdtempSync(join(tmpdir(), "memloop-guard-"));
  try {
    const r = runLoop(["S6", "--out", out], { ZCODE_OVERHAUL_RUN: "1", HOME: userInfo().homedir });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /isolated HOME/);
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("run.mjs rejects an unknown scenario or variant with exit 2", () => {
  assert.equal(runLoop(["S9"], { ZCODE_OVERHAUL_RUN: "1" }).status, 2);
  const r = runLoop(["S1", "--variant", "burst99"], { ZCODE_OVERHAUL_RUN: "1" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /variants of S1: .*burst16/);
});

const JOB_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "job.mjs");
function runJob(args, env) {
  const clean = { ...process.env };
  delete clean.ZCODE_OVERHAUL_RUN;
  delete clean.ZCODE_MEMLOOP_ALLOW;
  return spawnSync(process.execPath, [JOB_ENTRY, ...args], { env: { ...clean, ...env }, encoding: "utf8", timeout: 30_000 });
}

test("job.mjs refuses to start outside a capped run, before any scenario runs", () => {
  const out = mkdtempSync(join(tmpdir(), "memloop-job-"));
  try {
    const r = runJob(["--os", "linux", "--out", join(out, "job"), "--cap", "none"], { HOME: out });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /refuses to run outside a capped run/);
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("job.mjs rejects a run that is not part of the leg's job", () => {
  const r = runJob(["--os", "linux", "--only", "S2/gc", "--cap", "none"], { ZCODE_OVERHAUL_RUN: "1" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /S2\/gc is not a run of the linux job/);
});

test("a detached child whose parent exited is still found as a survivor", linuxOnly, async () => {
  const marker = `ZCODE_MEMLOOP_RUN=orphan-test-${process.pid}`;
  // The parent starts a detached grandchild and exits at once; the grandchild
  // is reparented and keeps the marker in its environment.
  const parent = spawn(process.execPath, ["-e", `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { detached: true, stdio: "ignore" }); console.log(c.pid); c.unref();`], { env: { ...process.env, ZCODE_MEMLOOP_RUN: marker.split("=")[1] }, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  parent.stdout.on("data", (b) => { out += b; });
  await new Promise((r) => parent.on("close", r));
  const orphanPid = Number(out.trim());
  try {
    await sleep(100);
    const found = survivors(marker);
    assert.deepEqual(found.map((s) => s.pid), [orphanPid]);
    assert.notEqual(found[0].ppid, parent.pid);
  } finally {
    try { process.kill(orphanPid, "SIGKILL"); } catch {}
  }
});
