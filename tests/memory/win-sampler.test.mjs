// The Windows sampler (seam 1, ticket 02), proved on any OS from recorded
// PowerShell output: `Get-CimInstance Win32_Process … | ConvertTo-Csv` polls
// (tests/memory/fixtures/win32/), the spec §1 unit mapping, kit-process
// selection by tree + run token, the units self-test against Get-Process and
// the poller protocol. The live self-tests on windows-latest are in
// loop.test.mjs (they skip elsewhere).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKitTracker, createPollParser, parseCimCsv, parseGetProcessCsv, pollStartNs, powershellPoller, unitsSelfTest } from "./lib/win-sampler.mjs";
import { commandFor, parseJobReport } from "./lib/caps.mjs";
import { parseProcessAction, processActionScript } from "./lib/win-process.mjs";
import { windowsStartCommand } from "./lib/process-identity.mjs";
import { parseSamplesCsv, rowsFromSamples, scan, settled, startSampler, survivors } from "./lib/sampler.mjs";
import { externalOf, listenersOf, parseNetstat } from "./lib/win-net.mjs";
import { osVerdict, rowsForMetric, verdict } from "./lib/verdict.mjs";

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

test("the loop's own tooling (netstat, PowerShell started by the loop root, their conhosts) is visible but never kit footprint; the kit's own PowerShell is", () => {
  const base = parseCimCsv(fixture("cim-poll.csv"));
  const like = (pid, ppid, name, commandLine, created) => ({ ...base.find((p) => p.pid === 3000), pid, ppid, name, executablePath: `C:\\Windows\\System32\\${name}`, commandLine, created, commitKb: 60000, rssKb: 70000 });
  const extra = [
    like(2800, 2000, "NETSTAT.EXE", "netstat -ano -p TCP", "134070000180000000"),
    like(2810, 2000, "powershell.exe", "powershell -NoProfile -NonInteractive -Command Get-CimInstance Win32_Process", "134070000180000000"),
    like(2811, 2810, "conhost.exe", "\\??\\C:\\Windows\\system32\\conhost.exe 0xffffffff -ForceV1", "134070000180100000"),
    like(2820, 2300, "powershell.exe", "powershell -NoProfile -NonInteractive -Command Get-CimInstance Win32_Process -Filter ProcessId=2400", "134070000180000000"),
  ];
  const kit = createKitTracker(RUN).select([...base, ...extra], { selfPid: 2200 });
  const role = (pid) => kit.find((p) => p.pid === pid)?.role;
  assert.deepEqual([role(2800), role(2810), role(2811), role(2820)], ["tooling", "tooling", "tooling", "other"]);
  // kit (working set, KB) = manager 2300 45056 + proxy 2400 122880 + orphan 2500 20480 + the manager's PowerShell 2820 70000 = 258416 KB.
  const v = verdict([{ t: 0, progress: 0, procs: kit }], { peaks: { kit: 1000 } });
  assert.equal(v.checks.find((c) => c.name === "peak:kit").value, 252.4);
});

test("a console host belongs to a fixture owner (never kit footprint) but stays kit 'other' under a kit process", () => {
  const base = parseCimCsv(fixture("cim-poll.csv"));
  const like = (pid, ppid, name, commandLine) => ({ ...base.find((p) => p.pid === 3000), pid, ppid, name, executablePath: `C:\\x\\${name}`, commandLine, created: "134070000190000000" });
  const extra = [
    like(2900, 2000, "node.exe", '"C:\\node.exe" D:\\kit\\mcp\\zcode-harness-mcp\\test\\fixture\\fake-harness.mjs --version'),
    like(2901, 2900, "conhost.exe", "\\??\\C:\\Windows\\system32\\conhost.exe 0x4"),
    like(2902, 2100, "conhost.exe", "\\??\\C:\\Windows\\system32\\conhost.exe 0x4"),
    like(2903, 2400, "conhost.exe", "\\??\\C:\\Windows\\system32\\conhost.exe 0x4"),
  ];
  const kit = createKitTracker(RUN).select([...base, ...extra], { selfPid: 2200 });
  const role = (pid) => kit.find((p) => p.pid === pid)?.role;
  assert.deepEqual([role(2900), role(2901), role(2902), role(2903)], ["fake-harness", "fake-harness", "mock-upstream", "other"]);
});

test("S3/omp: the stub OMP host and its console host are the harness; the preflight it spawns, with its PowerShell and console host, is kit", () => {
  const base = parseCimCsv(fixture("cim-poll.csv"));
  const like = (pid, ppid, name, commandLine) => ({ ...base.find((p) => p.pid === 3000), pid, ppid, name, executablePath: `C:\\x\\${name}`, commandLine, created: "134070000190000000", rssKb: 40000, commitKb: 100000 });
  const extra = [
    like(2950, 2000, "bun.exe", `"D:\\a\\_temp\\memloop\\S3-omp\\${RUN.token}\\bun\\bun.exe" D:\\a\\kit\\kit\\tests\\memory\\fixtures\\omp-host.ts C:\\h\\.omp\\agent\\extensions\\zcode-proxy-autostart.ts`),
    like(2951, 2950, "conhost.exe", "\\??\\C:\\Windows\\system32\\conhost.exe 0x4"),
    like(2952, 2950, "node.exe", '"C:\\node.exe" D:\\a\\kit\\kit\\cli\\heal.mjs --diagnostic-code'),
    like(2953, 2952, "powershell.exe", "powershell -NoProfile -NonInteractive -Command Get-CimInstance Win32_Process -Filter ProcessId=2400"),
    like(2954, 2952, "conhost.exe", "\\??\\C:\\Windows\\system32\\conhost.exe 0x4"),
  ];
  const kit = createKitTracker(RUN).select([...base, ...extra], { selfPid: 2200 });
  const role = (pid) => kit.find((p) => p.pid === pid)?.role;
  assert.deepEqual([2950, 2951, 2952, 2953, 2954].map(role), ["omp-host", "omp-host", "preflight", "other", "other"]);
  // Kit commit counts the preflight, its PowerShell and its console host (Round 7 Q2 condition 3), never the host's.
  const only = (pids) => kit.filter((p) => pids.includes(p.pid));
  const v = osVerdict([{ t: 0, progress: 0, procs: only([2950, 2951, 2952, 2953, 2954]) }], { peaks: { kit: 1000 } });
  const total = v.checks.find((c) => c.name === "peak:kit");
  assert.equal(total.gate, "commit");
  assert.equal(total.value, Number((3 * 100000 / 1024).toFixed(1)));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the Windows sampler writes commit_kb, excludes its poller, records its overhead and reaps the poller", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-"));
  const marker = `ZCODE_MEMLOOP_RUN=${RUN.token}`;
  let sampler;
  try {
    sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 100, progress: () => 3, windows: { rootPid: RUN.rootPid, spawn: fakePoller() } });
    const ready = await sampler.ready;
    assert.equal(ready.units.ok, true, ready.units.reason);
    await sleep(450);
    assert.deepEqual(scan(marker).map((s) => s.pid).sort(), [2100, 2300, 2400, 2500], "scan() reads the live poll");
    const rows = await sampler.stop();
    const csv = parseSamplesCsv(readFileSync(join(dir, "samples.csv"), "utf8"));
    assert.equal(readFileSync(join(dir, "samples.csv"), "utf8").split("\n")[0], "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb,ws_peak_kb");
    const proxy = csv.find((r) => r.pid === 2400);
    // ws_peak_kb = PeakWorkingSetSize (130000 KB): the WS peak is reproducible from the artefact (Round 7 Q1).
    assert.deepEqual({ role: proxy.role, rssKb: proxy.rssKb, commitKb: proxy.commitKb, hwmKb: proxy.hwmKb, wsPeakKb: proxy.wsPeakKb, progress: proxy.progress }, { role: "proxy", rssKb: 122880, commitKb: 153600, hwmKb: 190000, wsPeakKb: 130000, progress: 3 });
    // Read back from the CSV, the working-set verdict sees the same peak as the live run.
    const back = rowsForMetric(rowsFromSamples(csv), "rss").flatMap((r) => r.procs).find((p) => p.pid === 2400);
    assert.equal(back.hwmKb, 130000);
    assert.ok(!csv.some((r) => r.pid === 2200 || r.pid === 2210), "the poller and its conhost are never sampled");
    assert.ok(rows.length >= 3 && rows.every((r) => r.procs.length === 4));
    const o = sampler.overhead();
    assert.deepEqual({ pid: o.pid, polls: o.polls >= 3, peakCommitKb: o.peakCommitKb, peakRssKb: o.peakRssKb, pollMsMax: o.pollMsMax >= 180 }, { pid: 2200, polls: true, peakCommitKb: 65536, peakRssKb: 81920, pollMsMax: true });
    // The sampler's own handle on its poller, never the pid: stop() resolves on
    // the poller's exit, and a freed pid may already name a stranger (ticket 72).
    assert.equal(sampler.pollerRunning(), false, "the poller child is reaped on stop");
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
});

// CI run 42221794531: every windows run wrote the CSV header and exited 0 at
// once — the process waited only on the poller's answer, and an unref'd
// poller let the event loop empty first. The sampler must hold its process.
test("the Windows sampler keeps its process alive until the poller answers (nothing else holds the loop)", () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-alive-"));
  try {
    const script = `import { startSampler } from ${JSON.stringify(new URL("./lib/sampler.mjs", import.meta.url).href)};
const s = startSampler({ marker: "ZCODE_MEMLOOP_RUN=${RUN.token}", csvPath: ${JSON.stringify(join(dir, "samples.csv"))}, intervalMs: 100,
  windows: { rootPid: ${RUN.rootPid}, spawn: (o) => ({ command: process.execPath, args: [${JSON.stringify(join(FIXTURES, "fake-poller.mjs"))}, JSON.stringify({ ...o, selfPid: 2200, delayMs: 300 })] }) } });
const r = await s.ready;
console.log("READY", r.units.ok);
await new Promise((ok) => setTimeout(ok, 350));
await s.stop();
console.log("ROWS", s.rows.length);`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 30_000 });
    assert.match(r.stdout, /READY true/, `exit ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /ROWS [1-9]/);
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("after the sampler stops, survivors come from a fresh poll and never include the loop's own tooling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-surv-"));
  const marker = `ZCODE_MEMLOOP_RUN=${RUN.token}`;
  let sampler;
  try {
    sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 100, windows: { rootPid: RUN.rootPid, spawn: fakePoller({ cim: "cim-poll-tooling.csv" }) } });
    await sampler.ready;
    await sleep(250);
    await sampler.stop();
    const left = survivors(marker);
    assert.deepEqual(left.map((s) => s.pid).sort((a, b) => a - b), [2100, 2300, 2400, 2500]);
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("a units self-test failure stops the Windows sampler before it samples anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-"));
  let sampler;
  try {
    sampler = startSampler({ marker: `ZCODE_MEMLOOP_RUN=${RUN.token}`, csvPath: join(dir, "samples.csv"), intervalMs: 100, windows: { rootPid: RUN.rootPid, spawn: fakePoller({ unitsCim: "cim-poll-commit-in-kb.csv" }) } });
    await assert.rejects(sampler.ready, /units self-test failed: commit_kb/);
    await sampler.stop();
    assert.equal(sampler.pollerRunning(), false, "the poller is reaped");
    assert.equal(readFileSync(join(dir, "samples.csv"), "utf8").split("\n").filter(Boolean).length, 1, "header only");
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
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

// CI run 42221794531: PowerShell 5.1 under -EncodedCommand with redirected
// streams prints its progress ("Preparing modules for first use") as CLIXML.
const CLIXML = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>';

test("poller frames glued to a CLIXML progress record are still read, units first", () => {
  const frames = [];
  const feed = createPollParser((f) => frames.push(f));
  const cim = fixture("cim-poll.csv").trimEnd();
  feed(`${CLIXML}@@UNITS 2200\n${cim}\n@@GETPROCESS\n${fixture("get-process.csv").trimEnd()}\n@@END\n`);
  feed(`${CLIXML}\r\n@@POLL 2200 210\n${cim}\n@@END\n`);
  assert.deepEqual(frames.map((f) => f.type), ["units", "poll"]);
  assert.equal(frames[0].table.length, 12);
  assert.equal(frames[0].getProcess.length, 12);
  assert.equal(frames[1].pollMs, 210);
});

test("every PowerShell we start silences progress before it loads a module, and asks for text output", () => {
  const scripts = {
    poller: { argv: powershellPoller({ intervalMs: 1000 }).args },
    jobObject: { argv: commandFor("jobobject", "1G", 60, ["x"], { node: "node.exe", runScript: "run.mjs" }).argv.slice(1) },
    processStart: { argv: windowsStartCommand(4242).args },
  };
  for (const [name, { argv }] of Object.entries(scripts)) {
    assert.ok(argv.includes("-OutputFormat") && argv[argv.indexOf("-OutputFormat") + 1] === "Text", `${name}: -OutputFormat Text`);
    const script = Buffer.from(argv.at(-1), "base64").toString("utf16le");
    const first = script.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"));
    assert.match(first, /^\$ProgressPreference = 'SilentlyContinue'/, `${name}: first statement`);
  }
  for (const action of ["suspend", "resume", "terminate"]) {
    assert.match(processActionScript({ pid: 4242, start: "134070000140000000" }, action).split("\n")[0], /^\$ProgressPreference = 'SilentlyContinue'/, `${action}: first statement`);
  }
});

test("the Job Object report is read from the real CI run log despite the CLIXML around it", () => {
  assert.deepEqual(parseJobReport(fixture("ci-42221794531-run-log.txt")), { applied: true, limitBytes: 3221225472, peakBytes: 103886848 });
});

// ── Reads after an event judge processes by the poll, never by a pid (ticket 73) ──
// The live scan is the latest poll: each process is its pid and creation time
// as the poll saw them, and no pid is asked whether it is alive (Windows may
// hand a freed pid to a stranger at once, tickets 70, 72). A read after an
// event (a stop, a kill) awaits `settled`: the first poll that started after
// it. The fake poller re-reads its table file at the start of every poll and
// takes `lagMs` to answer, as the Win32_Process query does.
const CIM_RUNNING = fixture("cim-poll.csv").trimEnd();
const CIM_PROXY_EXITED = CIM_RUNNING.split("\n").filter((l) => !l.startsWith('"2400",')).join("\n");

test("a read after the proxy exits never counts it, and a read while it runs always does, whenever the read falls in the poll cycle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-settled-"));
  const table = join(dir, "table.csv");
  writeFileSync(table, CIM_RUNNING);
  const marker = `ZCODE_MEMLOOP_RUN=${RUN.token}`;
  const proxies = () => scan(marker).filter((p) => p.role === "proxy").map((p) => p.pid);
  let sampler;
  try {
    sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 50, windows: { rootPid: RUN.rootPid, spawn: fakePoller({ table, lagMs: 150 }) } });
    await sampler.ready;
    // One poll cycle is ~200 ms (150 ms query + 50 ms wait): the exit lands before, inside and after a poll in flight.
    for (const offset of [0, 40, 80, 120, 160, 200]) {
      writeFileSync(table, CIM_RUNNING);
      await settled(marker);
      assert.deepEqual(proxies(), [2400], `offset ${offset}: the running proxy is counted`);
      await sleep(offset);
      writeFileSync(table, CIM_PROXY_EXITED); // the stop returned: the proxy is gone, its pid free for anyone
      await settled(marker);
      assert.deepEqual(proxies(), [], `offset ${offset}: a proxy that exited before the read is not counted`);
    }
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("a read waits for a poll that started after it; frames without a start stamp never satisfy it, and a stopped sampler releases it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-settled-"));
  const marker = `ZCODE_MEMLOOP_RUN=${RUN.token}`;
  let sampler;
  try {
    sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 50, windows: { rootPid: RUN.rootPid, spawn: fakePoller({ noStamp: true }) } });
    await sampler.ready;
    await assert.rejects(settled(marker, { timeoutMs: 400 }), /no process table poll started within 400 ms after this read/);
    const waiting = settled(marker, { timeoutMs: 60_000 });
    await sampler.stop();
    await waiting; // after stop every scan polls afresh
    await settled(marker); // and resolves at once
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
  await settled("ZCODE_MEMLOOP_RUN=no-windows-session"); // Linux /proc scans are always current
});

test("a poll head's start stamp is read on the monotonic clock in nanoseconds; a head without one has none", () => {
  const frames = [];
  const feed = createPollParser((f) => frames.push(f));
  const cim = fixture("cim-poll.csv").trimEnd();
  feed(`@@POLL 2200 31 123456789012 10000000\n${cim}\n@@END\n@@POLL 2200 30\n${cim}\n@@END\n`);
  assert.deepEqual(frames.map((f) => f.startNs), [12345678901200n, null]);
  assert.equal(pollStartNs("10", "0"), null);
  assert.equal(pollStartNs("x", "10000000"), null);
  // The PowerShell poller stamps each poll before its query, on QueryPerformanceCounter (Stopwatch).
  const script = Buffer.from(powershellPoller({ intervalMs: 1000 }).args.at(-1), "base64").toString("utf16le");
  assert.match(script, /\$t0 = \[System\.Diagnostics\.Stopwatch\]::GetTimestamp\(\)\n\s*\$csv = Poll/);
  assert.match(script, /@@POLL \$PID \$ms \$t0 \$freq/);
});

// ── Windows freeze / thaw / kill by identity (lib/win-process.mjs) ──────────
test("a Windows process action holds the pid before it asks who holds it, and acts only on the expected start time", () => {
  const id = { pid: 4242, start: "134070000140000000" };
  const script = processActionScript(id, "resume");
  const at = (re) => script.search(re);
  assert.ok(at(/\[MemloopProcess\]::Open\(4242, 2048, \[ref\]\$err\)/) >= 0, "a PROCESS_SUSPEND_RESUME handle on the pid");
  assert.ok(at(/\[MemloopProcess\]::Open/) < at(/Get-CimInstance Win32_Process -Filter 'ProcessId=4242'/), "the handle is held before the start time is asked");
  assert.match(script, /if \(\$start -ne 'START 134070000140000000'\) \{ \[Console\]::Out\.Write\('OTHER ' \+ \$start\) \}/);
  assert.ok(at(/::Act\(\$h, 'resume'\)/) > at(/-ne 'START 134070000140000000'/), "the action only after the identity matched");
  assert.match(processActionScript(id, "terminate"), /::Open\(4242, 1, \[ref\]\$err\)/, "PROCESS_TERMINATE");
  assert.throws(() => processActionScript({ pid: 4242 }, "resume"), /no start time/);
  assert.throws(() => processActionScript({ pid: 4242, start: "1; Stop-Computer" }, "resume"), /no start time/);
  // Its answers: done, another process (nothing done), or a failure that never reads as either.
  assert.equal(parseProcessAction(id, "resume", { status: 0, stdout: "DONE 0" }), true);
  assert.equal(parseProcessAction(id, "resume", { status: 0, stdout: "OTHER NONE" }), false);
  assert.equal(parseProcessAction(id, "resume", { status: 0, stdout: "OTHER START 134070000990000000" }), false);
  for (const r of [{ status: 0, stdout: "DONE -1073741790" }, { status: 0, stdout: "OPENFAIL 5" }, { status: 1, stdout: "", stderr: "Add-Type failed" }, { status: null, stdout: "" }, { status: 0, stdout: "" }]) {
    assert.throws(() => parseProcessAction(id, "resume", r), /resume pid 4242 \(start 134070000140000000\) failed/, JSON.stringify(r));
  }
});
