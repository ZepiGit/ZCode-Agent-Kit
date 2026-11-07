// Memory loop sampler: once per interval, find every process that carries this
// run's marker in its environment (ZCODE_MEMLOOP_RUN=<id>) and record RSS,
// peak RSS, threads, open FDs and its parent. Detached children (the proxy the
// manager spawns, reparented to init) keep the marker, so they stay visible —
// and anything still alive after the scenario stopped is an orphan.
//
// Linux reads /proc directly. Windows (ticket 02) cannot read another
// process's environment: one long-lived PowerShell poller reads Win32_Process
// and the run's processes are the tree below this process plus every process
// carrying the run id in its command line or executable path (lib/win-sampler.mjs).
import { readdirSync, readFileSync, readlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { createKitTracker, pollOnce, powershellPoller, startPoller } from "./win-sampler.mjs";
import * as winNet from "./win-net.mjs";

const PAGE_KB = 4; // getconf PAGESIZE on every supported Linux target = 4096

export function supported(platform = process.platform) {
  return platform === "linux" || platform === "win32";
}

// Windows sampling sessions, per marker: the tracker (tree + token, with every
// parent seen so far), the latest poll and how to take a fresh one.
const winSessions = new Map();
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };
function winSession(marker, { rootPid = process.pid, spawn = powershellPoller, alive = isAlive } = {}) {
  let s = winSessions.get(marker);
  if (!s) {
    s = { tracker: createKitTracker({ rootPid, token: marker.split("=")[1] }), latest: null, selfPid: null, live: false, spawn, alive };
    winSessions.set(marker, s);
  }
  return s;
}
const useWindows = (marker) => winSessions.has(marker) || process.platform === "win32";

function scanWindows(marker) {
  const s = winSession(marker);
  if (s.live && s.latest) return s.tracker.select(s.latest, { selfPid: s.selfPid }).filter((p) => s.alive(p.pid));
  // No live poller (before start, after stop): one fresh poll, same tracker.
  const f = pollOnce(s.spawn);
  return s.tracker.select(f.table, { selfPid: f.selfPid });
}

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

/** Classify a command line into the roles the budgets talk about. */
export function roleOf(argv) {
  const cmd = argv.join(" ");
  // The captcha solver process (ADR-0002; ticket 27): from source it runs the
  // solver entry module, compiled builds a self-exec subcommand. Either way its
  // argv names "captcha-solver"; the in-process worker thread has no process.
  if (/captcha[-_]solver/i.test(cmd)) return "solver";
  if (/src[\\/]index\.ts["']?\s+serve\b/.test(cmd) || /zcode-proxy(?:\.exe)?\s+serve\b/.test(cmd)) return "proxy";
  if (/zcode-proxy-manager\.mjs/.test(cmd)) return "manager";
  if (/cli[\\/]heal\.mjs/.test(cmd)) return "preflight";
  if (/cli[\\/](?:launch|zcode-kit)\.mjs/.test(cmd)) return "launcher";
  if (/zcode-harness-mcp[\\/]dist[\\/]index\.js/.test(cmd)) return "mcp-bridge";
  if (/fake-harness\.mjs/.test(cmd)) return "fake-harness";
  if (/tests[\\/]memory[\\/]lib[\\/]soak-mock\.mjs/.test(cmd)) return "mock-upstream";
  if (/tests[\\/]memory[\\/]scenarios[\\/]/.test(cmd)) return "scenario";
  if (/fake-bin[\\/]|tests[\\/]memory[\\/]fixtures[\\/]/.test(cmd)) return "fake-harness";
  return "other";
}

/** One /proc snapshot of a pid, or null when it vanished or is not ours. */
function snapshot(pid, marker, cache) {
  const stat = readText(`/proc/${pid}/stat`);
  if (!stat) return null;
  const close = stat.lastIndexOf(")");
  const fields = stat.slice(close + 2).split(" ");
  const state = fields[0];
  const ppid = Number(fields[1]);
  const starttime = fields[19];
  const key = `${pid}:${starttime}`;
  let meta = cache.get(key);
  if (meta === null) return null;
  // pid and start time survive an exec, the command line does not: a child
  // first seen between fork and exec shows its parent's argv (a proxy spawned
  // by a start lock holder killed inside spawn() was role "preflight" for a
  // whole S3/hung run). A marked process is re-read whenever its command line changed.
  const cmdline = readText(`/proc/${pid}/cmdline`) ?? "";
  if (meta === undefined || meta.cmdline !== cmdline) {
    const environ = readText(`/proc/${pid}/environ`);
    if (environ === null || !environ.split("\0").includes(marker)) {
      cache.set(key, null);
      return null;
    }
    const argv = cmdline.split("\0").filter(Boolean);
    meta = { cmdline, argv, role: roleOf(argv), comm: stat.slice(stat.indexOf("(") + 1, close) };
    cache.set(key, meta);
  }
  const status = readText(`/proc/${pid}/status`) ?? "";
  const kb = (name) => Number((status.match(new RegExp(`^${name}:\\s+(\\d+)`, "m")) ?? [])[1] ?? 0);
  let fds = 0;
  try { fds = readdirSync(`/proc/${pid}/fd`).length; } catch {}
  return {
    pid, ppid, state, key, role: meta.role, comm: meta.comm,
    rssKb: kb("VmRSS"), hwmKb: kb("VmHWM"), threads: kb("Threads"), fds,
    cmd: meta.argv.slice(0, 4).map((a) => a.split(/[\\/]/).slice(-2).join("/")).join(" ").slice(0, 120),
  };
}

/** All live processes carrying the marker. */
export function scan(marker, cache = new Map()) {
  if (useWindows(marker)) return scanWindows(marker);
  const out = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const snap = snapshot(Number(name), marker, cache);
    if (snap && snap.state !== "Z") out.push(snap);
  }
  return out;
}

/** TCP listeners per inode → port, to attribute listening ports to pids. */
export function listeningPorts() {
  const ports = new Map(); // inode -> port
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = readText(file);
    if (!text) continue;
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10 || cols[3] !== "0A") continue; // 0A = LISTEN
      ports.set(cols[9], parseInt(cols[1].split(":")[1], 16));
    }
  }
  return ports;
}

export function portsOf(pid, ports) {
  if (process.platform === "win32") return winNet.listenersOf(winNet.netstat(), pid);
  ports ??= listeningPorts();
  const found = new Set();
  let entries = [];
  try { entries = readdirSync(`/proc/${pid}/fd`); } catch { return []; }
  for (const fd of entries) {
    let target;
    try { target = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
    const m = target.match(/^socket:\[(\d+)\]$/);
    if (m && ports.has(m[1])) found.add(ports.get(m[1]));
  }
  return [...found];
}

function hexAddr(hex) {
  const [ip, port] = hex.split(":");
  if (ip.length === 8) return `${[0, 2, 4, 6].map((i) => parseInt(ip.slice(i, i + 2), 16)).reverse().join(".")}:${parseInt(port, 16)}`;
  // IPv6 (4 little-endian words); loopback and v4-mapped loopback are what matter.
  const words = [0, 8, 16, 24].map((i) => ip.slice(i, i + 8).match(/../g).reverse().join(""));
  const v6 = words.join("");
  if (v6 === "00000000000000000000000000000001") return `[::1]:${parseInt(port, 16)}`;
  if (v6.startsWith("00000000000000000000ffff")) {
    const v4 = v6.slice(24);
    return `${[0, 2, 4, 6].map((i) => parseInt(v4.slice(i, i + 2), 16)).join(".")}:${parseInt(port, 16)}`;
  }
  return `[${v6}]:${parseInt(port, 16)}`;
}

/** Every TCP socket a pid holds: { local, remote, state } (state hex per /proc/net/tcp). */
export function connectionsOf(pid) {
  if (process.platform === "win32") return winNet.connectionsOf(winNet.netstat(), pid);
  const inodes = new Set();
  let entries = [];
  try { entries = readdirSync(`/proc/${pid}/fd`); } catch { return []; }
  for (const fd of entries) {
    try {
      const m = readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/);
      if (m) inodes.add(m[1]);
    } catch {}
  }
  const out = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = readText(file);
    if (!text) continue;
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10 || !inodes.has(cols[9])) continue;
      out.push({ local: hexAddr(cols[1]), remote: hexAddr(cols[2]), state: cols[3] });
    }
  }
  return out;
}

/** Non-loopback remote endpoints held by a pid (the "no real upstream" proof). */
export function externalConnections(pid) {
  if (process.platform === "win32") return winNet.externalOf(winNet.netstat(), pid).map((remote) => ({ remote }));
  return connectionsOf(pid).filter((c) => c.state !== "0A" && !/^(?:127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0):/.test(c.remote));
}

// commit_kb (ticket 02) and ws_peak_kb (Round 7 Q1) are additive (appended):
// commit charge and PeakWorkingSetSize on Windows, empty on Linux.
const HEADER = "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb,ws_peak_kb\n";

/** One CSV line → fields (the cmd column is double-quoted and may hold commas). */
function splitCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** samples.csv text → [{ t, pid, ppid, role, rssKb, hwmKb, threads, fds, heapMB, progress, cmd, commitKb, wsPeakKb }]. Reads files without commit_kb / ws_peak_kb too. */
export function parseSamplesCsv(text) {
  const num = (v) => (v === undefined || v === "" ? null : Number(v));
  return text.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const [t, pid, ppid, role, rss, hwm, threads, fds, heap, progress, cmd, commit, wsPeak] = splitCsvLine(line);
    return { t: Number(t), pid: Number(pid), ppid: Number(ppid), role, rssKb: Number(rss), hwmKb: Number(hwm), threads: Number(threads), fds: Number(fds), heapMB: num(heap), progress: Number(progress), cmd, commitKb: num(commit), wsPeakKb: num(wsPeak) };
  });
}

/** Parsed CSV rows → the verdict's per-sample series. */
export function rowsFromSamples(samples) {
  const byT = new Map();
  for (const s of samples) {
    if (!byT.has(s.t)) byT.set(s.t, { t: s.t, progress: s.progress, procs: [] });
    byT.get(s.t).procs.push({ pid: s.pid, ppid: s.ppid, key: String(s.pid), role: s.role, rssKb: s.rssKb, hwmKb: s.hwmKb, threads: s.threads, fds: s.fds, heapMB: s.heapMB, commitKb: s.commitKb, ...(s.wsPeakKb !== null ? { wsPeakKb: s.wsPeakKb } : {}) });
  }
  return [...byT.values()];
}

/** Counts per role of the marked processes alive right now (for verdict `observed`). */
export function countRoles(marker) {
  const counts = {};
  for (const s of scan(marker)) counts[s.role] = (counts[s.role] ?? 0) + 1;
  return counts;
}

/**
 * Start sampling. `probe(snapshots)` may return { [pid]: heapMB } for
 * processes whose JS heap is reachable (proxy /health, in-process reports).
 * `progress()` returns the scenario's work counter (requests, solves, …).
 * `ready` resolves once sampling runs (at once on Linux; on Windows after the
 * units self-test, and it rejects when that fails). `windows` selects the
 * Windows backend off Windows too (tests: { rootPid, spawn, alive }).
 */
export function startSampler({ marker, csvPath, intervalMs = 1000, probe = null, progress = () => 0, windows = null }) {
  const onWindows = windows !== null || process.platform === "win32";
  if (!onWindows && !supported()) throw new Error(`memory loop sampler supports Linux /proc and Windows only (platform ${process.platform})`);
  const cache = new Map();
  const rows = []; // compact in-memory series for the verdict
  const t0 = Date.now();
  writeFileSync(csvPath, HEADER);
  let timer = null;
  let running = false;
  let heap = {};
  const record = async (snaps) => {
    if (running) return;
    running = true;
    try {
      const t = Date.now() - t0;
      if (probe) {
        try { heap = (await probe(snaps)) ?? heap; } catch {}
      }
      const p = progress();
      let csv = "";
      for (const s of snaps) {
        const h = heap[s.pid];
        csv += `${t},${s.pid},${s.ppid},${s.role},${s.rssKb},${s.hwmKb},${s.threads},${s.fds},${h ?? ""},${p},"${s.cmd.replace(/"/g, "'")}",${s.commitKb ?? ""},${s.wsPeakKb ?? ""}\n`;
      }
      if (csv) appendFileSync(csvPath, csv);
      rows.push({ t, progress: p, procs: snaps.map((s) => ({ pid: s.pid, ppid: s.ppid, key: s.key, role: s.role, rssKb: s.rssKb, hwmKb: s.hwmKb, threads: s.threads, fds: s.fds, heapMB: heap[s.pid] ?? null, commitKb: s.commitKb ?? null, ...(s.wsPeakKb !== undefined ? { wsPeakKb: s.wsPeakKb } : {}) })) });
    } finally {
      running = false;
    }
  };

  if (onWindows) {
    winSessions.delete(marker);
    const session = winSession(marker, windows ?? {});
    const poller = startPoller({
      intervalMs,
      spawnSpec: session.spawn,
      onPoll(f) {
        session.latest = f.table;
        session.selfPid = f.selfPid;
        void record(session.tracker.select(f.table, { selfPid: f.selfPid }));
      },
    });
    session.live = true;
    const ready = poller.ready.then((r) => ({ units: r.units }), (err) => { session.live = false; throw err; });
    ready.catch(() => {});
    return {
      rows,
      t0,
      ready,
      pollerPid: poller.child.pid,
      overhead: () => poller.overhead(),
      async stop() {
        await poller.stop();
        session.live = false;
        while (running) await new Promise((r) => setTimeout(r, 20));
        return rows;
      },
    };
  }

  const tick = () => record(scan(marker, cache));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return {
    rows,
    t0,
    ready: Promise.resolve({ units: null }),
    pollerPid: null,
    overhead: () => null,
    async stop() {
      clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 20));
      await tick();
      return rows;
    },
  };
}

/** Pids still alive with the marker (orphans after stop, excluding `exceptPids`). */
export function survivors(marker, exceptPids = []) {
  const except = new Set(exceptPids);
  // Windows: the loop's own netstat/PowerShell (role "tooling") is not a kit orphan.
  return scan(marker).filter((s) => !except.has(s.pid) && s.role !== "tooling");
}

export { PAGE_KB };
