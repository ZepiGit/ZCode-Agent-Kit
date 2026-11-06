// The Windows sampler (seam 1, ticket 02), proved on any OS from recorded
// PowerShell output: `Get-CimInstance Win32_Process … | ConvertTo-Csv` polls
// (tests/memory/fixtures/win32/), the spec §1 unit mapping, kit-process
// selection by tree + run token, the units self-test against Get-Process and
// the poller protocol. The live self-tests on windows-latest are in
// loop.test.mjs (they skip elsewhere).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKitTracker, parseCimCsv, parseGetProcessCsv, unitsSelfTest } from "./lib/win-sampler.mjs";
import { parseSamplesCsv, scan, startSampler } from "./lib/sampler.mjs";
import { externalOf, listenersOf, parseNetstat } from "./lib/win-net.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "win32");
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

test("a Win32_Process poll maps to the sampler columns in the spec's units", () => {
  const table = parseCimCsv(fixture("cim-poll.csv"));
  const proxy = table.find((p) => p.pid === 2400);
  // WorkingSetSize 125829120 B, PrivatePageCount 157286400 B, PeakPageFileUsage 190000 KB.
  assert.deepEqual(
    { ppid: proxy.ppid, rssKb: proxy.rssKb, commitKb: proxy.commitKb, hwmKb: proxy.hwmKb, threads: proxy.threads, fds: proxy.fds },
    { ppid: 2300, rssKb: 122880, commitKb: 153600, hwmKb: 190000, threads: 18, fds: 312 },
  );
  assert.equal(proxy.commandLine, '"D:\\a\\_temp\\memloop\\S1-short\\S1-short-20261106T1000-ab12cd\\bun\\bun.exe" "D:\\a\\kit\\kit\\zcode-proxy-src\\src\\index.ts" serve');
  assert.equal(table.length, 12);
});

// cim-poll.csv: 2000 is the loop root (run.mjs), 2200 the poller itself (2210
// its conhost), 2400 the proxy started by the manager 2300 with the run's own
// bun copy, 2500 a detached process of this run whose parent was never seen
// (only the run token in its executable path names it), 3000 an unrelated
// manager, 3100 an older process whose parent pid 2000 was reused by the root.
const RUN = { rootPid: 2000, token: "S1-short-20261106T1000-ab12cd" };

test("kit processes are the loop root's tree plus every process carrying the run token, never the sampler", () => {
  const tracker = createKitTracker(RUN);
  const kit = tracker.select(parseCimCsv(fixture("cim-poll.csv")), { selfPid: 2200 });
  assert.deepEqual(kit.map((p) => [p.pid, p.role]).sort((a, b) => a[0] - b[0]), [[2100, "mock-upstream"], [2300, "manager"], [2400, "proxy"], [2500, "other"]]);
});

test("a process whose parent exited is still found through the parent seen in an earlier poll, but a pid reuse is not", () => {
  const tracker = createKitTracker(RUN);
  const base = parseCimCsv(fixture("cim-poll.csv"));
  const heal = { ...base.find((p) => p.pid === 3000), pid: 2600, ppid: 2300, created: "134070000170000000", commandLine: '"C:\\node.exe" D:\\a\\kit\\kit\\cli\\heal.mjs --diagnostic-code' };
  const stranger = { ...heal, pid: 2700, created: "134070000120000000" }; // ppid 2300, but created before 2300 existed
  tracker.select([...base, heal], { selfPid: 2200 });
  const later = tracker.select([...base.filter((p) => p.pid !== 2300), heal, stranger], { selfPid: 2200 });
  const pids = later.map((p) => p.pid);
  assert.ok(pids.includes(2600), "the orphaned preflight is found");
  assert.ok(!pids.includes(2700), "a process created before its alleged parent is not the parent's child");
  assert.equal(later.find((p) => p.pid === 2600).role, "preflight");
});

test("the units self-test passes when commit_kb matches Get-Process PrivateMemorySize64", () => {
  const r = unitsSelfTest(parseCimCsv(fixture("cim-poll.csv")), parseGetProcessCsv(fixture("get-process.csv")));
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.compared >= 5, `compared ${r.compared}`);
});

test("the units self-test fails when the commit charge arrives in another unit", () => {
  const r = unitsSelfTest(parseCimCsv(fixture("cim-poll-commit-in-kb.csv")), parseGetProcessCsv(fixture("get-process.csv")));
  assert.equal(r.ok, false);
  assert.match(r.reason, /commit_kb/);
});

// The sampler with its Windows backend, the poller replaced by fake-poller.mjs
// (the recorded output, framed as the PowerShell poller frames it).
const fakePoller = (extra = {}) => (opts) => ({ command: process.execPath, args: [join(FIXTURES, "fake-poller.mjs"), JSON.stringify({ ...opts, selfPid: 2200, ...extra })] });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the Windows sampler writes commit_kb, excludes its poller, records its overhead and reaps the poller", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-"));
  const marker = `ZCODE_MEMLOOP_RUN=${RUN.token}`;
  try {
    const sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 100, progress: () => 3, windows: { rootPid: RUN.rootPid, spawn: fakePoller(), alive: () => true } });
    const ready = await sampler.ready;
    assert.equal(ready.units.ok, true, ready.units.reason);
    await sleep(450);
    assert.deepEqual(scan(marker).map((s) => s.pid).sort(), [2100, 2300, 2400, 2500], "scan() reads the live poll");
    const pollerPid = sampler.pollerPid;
    const rows = await sampler.stop();
    const csv = parseSamplesCsv(readFileSync(join(dir, "samples.csv"), "utf8"));
    assert.equal(readFileSync(join(dir, "samples.csv"), "utf8").split("\n")[0], "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb");
    const proxy = csv.find((r) => r.pid === 2400);
    assert.deepEqual({ role: proxy.role, rssKb: proxy.rssKb, commitKb: proxy.commitKb, hwmKb: proxy.hwmKb, progress: proxy.progress }, { role: "proxy", rssKb: 122880, commitKb: 153600, hwmKb: 190000, progress: 3 });
    assert.ok(!csv.some((r) => r.pid === 2200 || r.pid === 2210), "the poller and its conhost are never sampled");
    assert.ok(rows.length >= 3 && rows.every((r) => r.procs.length === 4));
    const o = sampler.overhead();
    assert.deepEqual({ pid: o.pid, polls: o.polls >= 3, peakCommitKb: o.peakCommitKb, peakRssKb: o.peakRssKb, pollMsMax: o.pollMsMax >= 180 }, { pid: 2200, polls: true, peakCommitKb: 65536, peakRssKb: 81920, pollMsMax: true });
    await sleep(200);
    assert.equal(alive(pollerPid), false, "the poller child is reaped on stop");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a units self-test failure stops the Windows sampler before it samples anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-"));
  try {
    const sampler = startSampler({ marker: `ZCODE_MEMLOOP_RUN=${RUN.token}`, csvPath: join(dir, "samples.csv"), intervalMs: 100, windows: { rootPid: RUN.rootPid, spawn: fakePoller({ unitsCim: "cim-poll-commit-in-kb.csv" }), alive: () => true } });
    await assert.rejects(sampler.ready, /units self-test failed: commit_kb/);
    const pollerPid = sampler.pollerPid;
    await sampler.stop();
    await sleep(200);
    assert.equal(alive(pollerPid), false);
    assert.equal(readFileSync(join(dir, "samples.csv"), "utf8").split("\n").filter(Boolean).length, 1, "header only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("netstat -ano gives each pid's listening ports and its non-loopback peers", () => {
  const entries = parseNetstat(fixture("netstat-ano.txt"));
  assert.deepEqual(listenersOf(entries, 2400), [19020, 19021]);
  assert.deepEqual(listenersOf(entries, 2100), [61001]);
  assert.deepEqual(externalOf(entries, 2400), ["140.82.112.21:443"], "a TIME_WAIT to a real host still counts");
  assert.deepEqual(externalOf(entries, 2100), [], "loopback peers are not external");
  assert.deepEqual(listenersOf(entries, 9999), []);
});

test("the units self-test refuses to pass on too few comparable processes", () => {
  const r = unitsSelfTest(parseCimCsv(fixture("cim-poll.csv")).slice(0, 3), parseGetProcessCsv(fixture("get-process.csv")));
  assert.equal(r.ok, false);
  assert.match(r.reason, /comparable/);
});
