// The memory loop's Windows sampler (spec §1, ticket 02).
//
// One long-lived `powershell.exe -NoProfile -NonInteractive` child polls
// Win32_Process (Get-CimInstance … | ConvertTo-Csv) every interval and writes
// one framed block per poll to its stdout; the loop parses the blocks here,
// picks the kit's processes and reaps the child on exit.
//
// Units (spec §1): rss_kb = WorkingSetSize/1024 (bytes), commit_kb =
// PrivatePageCount/1024 (bytes), hwm_kb = PeakPageFileUsage (already KB: the
// peak commit charge), threads = ThreadCount, fds = HandleCount. The
// working-set peak (PeakWorkingSetSize, KB) is kept in memory only, for the
// working-set comparison verdict (a run RED only on commit goes to the owner).

import { spawn, spawnSync } from "node:child_process";
import { roleOf } from "./sampler.mjs";

/** RFC 4180 CSV (ConvertTo-Csv quotes every field and doubles inner quotes; fields may hold newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", quoted = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') { quoted = true; any = true; }
    else if (ch === ",") { row.push(cur); cur = ""; any = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (any || cur) { row.push(cur); rows.push(row); }
      row = []; cur = ""; any = false;
    } else { cur += ch; any = true; }
  }
  if (any || cur) { row.push(cur); rows.push(row); }
  return rows;
}

/** CSV text with a header row → objects keyed by header. */
export function csvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const int = (v) => (v === undefined || v === "" ? null : Number(v));

/** One Win32_Process poll (the poller's CSV) → process table rows in sampler units. */
export function parseCimCsv(text) {
  return csvObjects(text).map((o) => {
    const ws = int(o.WorkingSetSize), priv = int(o.PrivatePageCount);
    return {
      pid: int(o.ProcessId),
      ppid: int(o.ParentProcessId),
      created: o.CreationDate || "0",
      name: o.Name,
      executablePath: o.ExecutablePath || null,
      commandLine: o.CommandLine || null,
      rssKb: ws === null ? 0 : Math.round(ws / 1024),
      commitKb: priv === null ? null : Math.round(priv / 1024),
      hwmKb: int(o.PeakPageFileUsage) ?? 0,
      wsPeakKb: int(o.PeakWorkingSetSize) ?? 0,
      threads: int(o.ThreadCount) ?? 0,
      fds: int(o.HandleCount) ?? 0,
    };
  });
}

/** A Windows command line → argv (CommandLineToArgvW rules, enough for display and roles). */
export function splitCommandLine(line) {
  const out = [];
  let cur = "", quoted = false, any = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; any = true; }
    else if (!quoted && (ch === " " || ch === "\t")) { if (any) out.push(cur); cur = ""; any = false; }
    else { cur += ch; any = true; }
  }
  if (any) out.push(cur);
  return out;
}

// FILETIME values as decimal strings: compare as BigInt (they exceed 2^53).
const time = (s) => { try { return BigInt(s || "0"); } catch { return 0n; } };

/**
 * Which processes are this run's (spec §1): the tree below the loop root
 * (the run.mjs process; it is not counted itself) plus every process whose
 * command line or executable path carries the run-unique token (the run's own
 * bun copy, see prepareRunBun). Windows never reparents: a child keeps its
 * dead parent's pid, so a parent once seen keeps its descendants visible
 * (orphans included). A child created before its alleged parent is a pid
 * reuse and not ours. The sampler (selfPid) and its descendants (its conhost)
 * are excluded by pid.
 */
export function createKitTracker({ rootPid, token }) {
  const known = new Map(); // pid -> created (FILETIME string) of every process ever selected
  let rootCreated = null;
  const needle = token ? String(token).toLowerCase() : null;
  const carriesToken = (p) => !!needle && [p.commandLine, p.executablePath].some((s) => s && s.toLowerCase().includes(needle));
  return {
    known,
    select(table, { selfPid = null } = {}) {
      const byPid = new Map(table.map((p) => [p.pid, p]));
      const rootRow = byPid.get(rootPid);
      if (rootRow && rootCreated === null) rootCreated = rootRow.created;
      const excluded = new Set([rootPid]);
      if (selfPid !== null) {
        const self = new Map([[selfPid, byPid.get(selfPid)?.created ?? "0"]]);
        for (let grew = true; grew;) {
          grew = false;
          for (const p of table) {
            if (!self.has(p.pid) && self.has(p.ppid) && time(p.created) >= time(self.get(p.ppid))) { self.set(p.pid, p.created); grew = true; }
          }
        }
        for (const pid of self.keys()) excluded.add(pid);
      }
      const members = new Map();
      const parentCreated = (pid) => {
        if (pid === rootPid) return rootCreated ?? "0";
        if (members.has(pid)) return members.get(pid).created;
        if (known.has(pid)) {
          const live = byPid.get(pid);
          if (!live || live.created === known.get(pid)) return known.get(pid);
        }
        return null;
      };
      for (let grew = true; grew;) {
        grew = false;
        for (const p of table) {
          if (members.has(p.pid) || excluded.has(p.pid)) continue;
          const pc = parentCreated(p.ppid);
          if (carriesToken(p) || (pc !== null && time(p.created) >= time(pc))) { members.set(p.pid, p); grew = true; }
        }
      }
      const out = [];
      for (const p of members.values()) {
        known.set(p.pid, p.created);
        const argv = p.commandLine ? splitCommandLine(p.commandLine) : [p.executablePath ?? p.name ?? ""];
        out.push({
          pid: p.pid, ppid: p.ppid, state: "R", key: `${p.pid}:${p.created}`, role: roleOf(argv), comm: p.name,
          rssKb: p.rssKb, hwmKb: p.hwmKb, commitKb: p.commitKb, wsPeakKb: p.wsPeakKb, threads: p.threads, fds: p.fds,
          cmd: argv.slice(0, 4).map((a) => a.split(/[\\/]/).slice(-2).join("/")).join(" ").slice(0, 120),
        });
      }
      return out;
    },
  };
}

/** `Get-Process | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Csv` → rows in KB. */
export function parseGetProcessCsv(text) {
  return csvObjects(text).map((o) => ({ pid: int(o.Id), privateKb: int(o.PrivateMemorySize64) / 1024, workingSetKb: int(o.WorkingSet64) / 1024 }));
}

function medianOf(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Start-up self-test (spec §1): the mapped CIM columns against Get-Process,
 * taken back to back by the poller. Per process the ratio commit_kb /
 * (PrivateMemorySize64/1024) and rss_kb / (WorkingSet64/1024); memory moves
 * between the two reads, so the medians over every comparable process (≥ 1 MB
 * in both) must sit within ±20 %. hwm_kb (PeakPageFileUsage, KB) is a peak of
 * the same commit charge: its median ratio to PrivateMemorySize64 must lie in [0.95, 64].
 * A unit slip (bytes vs KB) moves a ratio by 1024 and fails.
 */
export function unitsSelfTest(cimTable, getProcessRows, { minProcesses = 5 } = {}) {
  const gp = new Map(getProcessRows.map((r) => [r.pid, r]));
  const commit = [], rss = [], hwm = [];
  for (const p of cimTable) {
    const g = gp.get(p.pid);
    // Comparable = big enough in the reference (Get-Process); the mapped values
    // are what is under test, so they never decide what gets compared.
    if (!g || g.privateKb < 1024 || g.workingSetKb < 1024) continue;
    commit.push((p.commitKb ?? 0) / g.privateKb);
    rss.push(p.rssKb / g.workingSetKb);
    hwm.push(p.hwmKb / g.privateKb);
  }
  const result = { compared: commit.length };
  if (commit.length < minProcesses) return { ...result, ok: false, reason: `only ${commit.length} comparable processes (need ${minProcesses}) between Win32_Process and Get-Process` };
  Object.assign(result, { commitRatio: Number(medianOf(commit).toFixed(3)), rssRatio: Number(medianOf(rss).toFixed(3)), hwmToCommit: Number(medianOf(hwm).toFixed(3)) });
  const bad = [];
  if (result.commitRatio < 0.8 || result.commitRatio > 1.2) bad.push(`commit_kb / PrivateMemorySize64 median ${result.commitRatio}`);
  if (result.rssRatio < 0.8 || result.rssRatio > 1.2) bad.push(`rss_kb / WorkingSet64 median ${result.rssRatio}`);
  if (result.hwmToCommit < 0.95 || result.hwmToCommit > 64) bad.push(`hwm_kb / PrivateMemorySize64 median ${result.hwmToCommit}`);
  return { ...result, ok: bad.length === 0, reason: bad.length ? `units self-test failed: ${bad.join("; ")}` : null };
}

// ── The poller ──────────────────────────────────────────────────────────────

const CIM_PROPS = ["ProcessId", "ParentProcessId", "CreationDate", "Name", "ExecutablePath", "CommandLine", "WorkingSetSize", "PrivatePageCount", "PeakPageFileUsage", "PeakWorkingSetSize", "ThreadCount", "HandleCount"];

/**
 * The PowerShell 5.1 poller. Frames on stdout:
 *   @@UNITS <poller pid>\n<Win32_Process CSV>\n@@GETPROCESS\n<Get-Process CSV>\n@@END\n   (once, when units)
 *   @@POLL <poller pid> <poll ms>\n<Win32_Process CSV>\n@@END\n                         (every interval)
 *   @@ERROR <message>\n
 * It exits after one poll when `once`, and on its own as soon as `parentPid`
 * is gone or its stdout pipe breaks (the loop also kills it on stop and exit).
 */
export function pollerScript({ intervalMs = 1000, parentPid = 0, once = false, units = false } = {}) {
  const props = CIM_PROPS.map((p) => `'${p}'`).join(",");
  const select = CIM_PROPS.map((p) => (p === "CreationDate" ? "@{n='CreationDate';e={ if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 } }}" : `'${p}'`)).join(",");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    // Throws on some hosts without a console; the frames are ASCII apart from command lines.
    "try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}",
    `$interval = ${Math.max(100, Math.round(intervalMs))}; $parentPid = ${Number(parentPid) | 0}; $once = $${once ? "true" : "false"}; $units = $${units ? "true" : "false"}`,
    `$props = @(${props})`,
    `$sel = @(${select})`,
    "$out = [Console]::Out",
    "function Poll { @(Get-CimInstance -ClassName Win32_Process -Property $props | Select-Object -Property $sel | ConvertTo-Csv -NoTypeInformation) -join \"`n\" }",
    "try {",
    "  if ($units) {",
    "    $cim = Poll",
    "    $gp = @(Get-Process | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Csv -NoTypeInformation) -join \"`n\"",
    "    $out.Write(\"@@UNITS $PID`n$cim`n@@GETPROCESS`n$gp`n@@END`n\"); $out.Flush()",
    "  }",
    "  $sw = New-Object System.Diagnostics.Stopwatch",
    "  while ($true) {",
    "    $sw.Restart()",
    "    $csv = Poll",
    "    $ms = $sw.ElapsedMilliseconds",
    "    $out.Write(\"@@POLL $PID $ms`n$csv`n@@END`n\"); $out.Flush()",
    "    if ($once) { break }",
    "    if ($parentPid -gt 0 -and -not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }",
    "    $wait = $interval - $sw.ElapsedMilliseconds",
    "    if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }",
    "  }",
    "} catch { try { $out.Write(\"@@ERROR $($_.Exception.Message -replace '\\r?\\n', ' ')`n\"); $out.Flush() } catch {} ; exit 1 }",
  ].join("\n");
}

/** The real poller: one `powershell.exe -NoProfile -NonInteractive` child (script as -EncodedCommand, so no quoting). */
export function powershellPoller(opts) {
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(pollerScript(opts), "utf16le").toString("base64")],
  };
}

/** Incremental parser for the poller's frames; independent of chunk boundaries. */
export function createPollParser(onFrame) {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    for (;;) {
      if (!buf.startsWith("@@")) {
        const at = buf.indexOf("\n@@");
        if (at < 0) { buf = buf.length > 1 << 20 ? "" : buf; return; }
        buf = buf.slice(at + 1); // noise before a frame (a stray warning line)
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const head = buf.slice(0, nl).replace(/\r$/, "").split(" ");
      if (head[0] === "@@ERROR") { onFrame({ type: "error", message: head.slice(1).join(" ") }); buf = buf.slice(nl + 1); continue; }
      const end = buf.search(/\r?\n@@END\r?\n/);
      if (end < 0) return;
      const body = buf.slice(nl + 1, end);
      buf = buf.slice(end + buf.slice(end).indexOf("@@END") + 5).replace(/^\r?\n/, "");
      if (head[0] === "@@POLL") onFrame({ type: "poll", selfPid: Number(head[1]), pollMs: Number(head[2]), table: parseCimCsv(body) });
      else if (head[0] === "@@UNITS") {
        const [cim, gp = ""] = body.split(/\r?\n@@GETPROCESS\r?\n/);
        onFrame({ type: "units", selfPid: Number(head[1]), table: parseCimCsv(cim), getProcess: parseGetProcessCsv(gp) });
      }
    }
  };
}

/** One synchronous poll (used where a fresh table is needed after the live poller stopped). */
export function pollOnce(spawnSpec = powershellPoller, { timeoutMs = 60_000 } = {}) {
  const { command, args } = spawnSpec({ once: true, units: false, intervalMs: 1000, parentPid: 0 });
  const r = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let frame = null;
  createPollParser((f) => { if (!frame) frame = f; })(r.stdout ?? "");
  if (!frame || frame.type !== "poll") throw new Error(`process table poll failed: ${frame?.message ?? (r.stderr || String(r.error ?? `exit ${r.status}`)).trim().slice(0, 300)}`);
  return frame;
}

/**
 * The long-lived poller. `onPoll(frame)` sees every poll once the units
 * self-test passed; `ready` resolves with { units } or rejects with the
 * self-test failure (the poller is then already reaped). `overhead()` is the
 * poller's own cost, read from its own row of every poll.
 */
export function startPoller({ intervalMs = 1000, spawnSpec = powershellPoller, onPoll }) {
  const { command, args } = spawnSpec({ intervalMs, parentPid: process.pid, once: false, units: true });
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const reap = () => { try { child.kill(); } catch {} };
  process.once("exit", reap);
  // Like the Linux sampler's timer: a forgotten poller never keeps the loop alive (exit reaps it).
  child.unref();
  child.stdout.unref?.();
  child.stderr.unref?.();
  const ov = { pid: null, polls: 0, pollMs: [], peakCommitKb: 0, peakRssKb: 0 };
  let passed = false, settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  ready.catch(() => {});
  let errTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (s) => { errTail = (errTail + s).slice(-2000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", createPollParser((f) => {
    if (f.type === "error") { if (!passed) { reap(); settle.reject(new Error(`windows poller: ${f.message}`)); } return; }
    if (f.type === "units") {
      const units = unitsSelfTest(f.table, f.getProcess);
      if (!units.ok) { reap(); settle.reject(new Error(units.reason)); return; }
      passed = true;
      settle.resolve({ units, pollerPid: f.selfPid });
      return;
    }
    if (!passed) return;
    ov.pid = f.selfPid;
    ov.polls += 1;
    ov.pollMs.push(f.pollMs);
    const self = f.table.find((p) => p.pid === f.selfPid);
    if (self) { ov.peakCommitKb = Math.max(ov.peakCommitKb, self.commitKb ?? 0); ov.peakRssKb = Math.max(ov.peakRssKb, self.rssKb); }
    onPoll(f);
  }));
  child.on("exit", (code) => { process.removeListener("exit", reap); if (!passed) settle.reject(new Error(`windows poller exited ${code} before its units self-test: ${errTail.trim().slice(-300)}`)); });
  child.on("error", (err) => { if (!passed) settle.reject(new Error(`windows poller did not start: ${err.message}`)); });
  return {
    child,
    ready,
    stop() {
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", () => resolve());
        reap();
      });
    },
    overhead() {
      const s = [...ov.pollMs].sort((a, b) => a - b);
      return { pid: ov.pid, polls: ov.polls, pollMsMedian: s.length ? s[s.length >> 1] : null, pollMsMax: s.length ? s.at(-1) : null, peakCommitKb: ov.peakCommitKb, peakRssKb: ov.peakRssKb };
    },
  };
}
