// Memory loop sampler: once per interval, find every process that carries this
// run's marker in its environment (ZCODE_MEMLOOP_RUN=<id>) and record RSS,
// peak RSS, threads, open FDs and its parent. Detached children (the proxy the
// manager spawns, reparented to init) keep the marker, so they stay visible —
// and anything still alive after the scenario stopped is an orphan.
//
// Linux reads /proc directly. Other platforms are not supported yet: the
// Windows equivalent (Get-CimInstance Win32_Process + handle counts) is a
// missing seam, reported by `supported()`.
import { readdirSync, readFileSync, readlinkSync, writeFileSync, appendFileSync } from "node:fs";

const PAGE_KB = 4; // getconf PAGESIZE on every supported Linux target = 4096

export function supported() {
  return process.platform === "linux";
}

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

/** Classify a command line into the roles the budgets talk about. */
export function roleOf(argv) {
  const cmd = argv.join(" ");
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
  if (meta === undefined) {
    const environ = readText(`/proc/${pid}/environ`);
    if (environ === null || !environ.split("\0").includes(marker)) {
      cache.set(key, null);
      return null;
    }
    const argv = (readText(`/proc/${pid}/cmdline`) ?? "").split("\0").filter(Boolean);
    meta = { argv, role: roleOf(argv), comm: stat.slice(stat.indexOf("(") + 1, close) };
    cache.set(key, meta);
  }
  if (meta === null) return null;
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

export function portsOf(pid, ports = listeningPorts()) {
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
  return connectionsOf(pid).filter((c) => c.state !== "0A" && !/^(?:127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0):/.test(c.remote));
}

const HEADER = "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd\n";

/**
 * Start sampling. `probe(snapshots)` may return { [pid]: heapMB } for
 * processes whose JS heap is reachable (proxy /health, in-process reports).
 * `progress()` returns the scenario's work counter (requests, solves, …).
 */
export function startSampler({ marker, csvPath, intervalMs = 1000, probe = null, progress = () => 0 }) {
  if (!supported()) throw new Error(`memory loop sampler supports Linux /proc only (platform ${process.platform})`);
  const cache = new Map();
  const rows = []; // compact in-memory series for the verdict
  const t0 = Date.now();
  writeFileSync(csvPath, HEADER);
  let timer = null;
  let running = false;
  let heap = {};
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const t = Date.now() - t0;
      const snaps = scan(marker, cache);
      if (probe) {
        try { heap = (await probe(snaps)) ?? heap; } catch {}
      }
      const p = progress();
      let csv = "";
      for (const s of snaps) {
        const h = heap[s.pid];
        csv += `${t},${s.pid},${s.ppid},${s.role},${s.rssKb},${s.hwmKb},${s.threads},${s.fds},${h ?? ""},${p},"${s.cmd.replace(/"/g, "'")}"\n`;
      }
      if (csv) appendFileSync(csvPath, csv);
      rows.push({ t, progress: p, procs: snaps.map((s) => ({ pid: s.pid, key: s.key, role: s.role, rssKb: s.rssKb, hwmKb: s.hwmKb, threads: s.threads, fds: s.fds, heapMB: heap[s.pid] ?? null })) });
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return {
    rows,
    t0,
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
  return scan(marker).filter((s) => !except.has(s.pid));
}

export { PAGE_KB };
