// Measurement-mode probes (Round 10 Q1 condition 1, ticket 09). run.mjs
// turns them on only when job.mjs sets ZCODE_MEMLOOP_MEASURE_PROBES=1, i.e.
// in measurement mode; a ratchet run never starts them.
//
// runtimeEnv(): once per run, inside the run's cap scope, before the sampler
// starts: what the Bun under test sees (process.constrainedMemory(),
// navigator.hardwareConcurrency, os.availableParallelism(), the CPU model;
// Bun 1.4.4 changed GC heap sizing to honour cgroup v2 limits on hybrid
// hosts, research/bun.md §1) plus nproc, the cgroup filesystem type and the
// scope's memory.max as the kernel reports it.
//
// proxyBunTracker(): the Bun the proxy actually ran. For every proxy process
// the sampler sees, its executable is read from the OS while it lives
// (Linux /proc/<pid>/exe, Windows the CIM ExecutablePath), then that binary is
// asked for its --revision. The flag value is never trusted.
//
// Both spawn Bun without the run marker, so the sampler never counts them.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, statfsSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

const CGROUP2_SUPER_MAGIC = 0x63677270;
const TMPFS_MAGIC = 0x01021994;

/** The environment without the run marker: what the probe's Bun runs with. */
export function unmarkedEnv(env = process.env) {
  const out = { ...env };
  delete out.ZCODE_MEMLOOP_RUN;
  return out;
}

/**
 * cgroup type and the caller's memory limits. Injectable for tests:
 * procSelfCgroup (text of /proc/self/cgroup), statfsType(path) → magic|null,
 * read(path) → text|null, exists(path).
 */
export function cgroupInfo({
  procSelfCgroup = readOrNull("/proc/self/cgroup"),
  statfsType = (p) => { try { return statfsSync(p).type; } catch { return null; } },
  read = readOrNull,
  exists = existsSync,
} = {}) {
  const root = statfsType("/sys/fs/cgroup");
  const unified = root === CGROUP2_SUPER_MAGIC ? "/sys/fs/cgroup" : exists("/sys/fs/cgroup/unified") && statfsType("/sys/fs/cgroup/unified") === CGROUP2_SUPER_MAGIC ? "/sys/fs/cgroup/unified" : null;
  const type = root === CGROUP2_SUPER_MAGIC ? "v2-only" : root === TMPFS_MAGIC ? (unified ? "hybrid" : "v1-only") : root === null ? "none" : `unknown (0x${root.toString(16)})`;
  const lines = String(procSelfCgroup ?? "").split("\n").filter(Boolean);
  const v2Path = lines.find((l) => l.startsWith("0::"))?.slice(3) ?? null;
  const v1Mem = lines.map((l) => l.split(":")).find((f) => f.length >= 3 && f[1].split(",").includes("memory"))?.slice(2).join(":") ?? null;
  const trim = (t) => (t === null ? null : t.trim());
  const memoryMax = unified && v2Path !== null ? trim(read(join(unified, v2Path, "memory.max").replace(/\\/g, "/"))) : null;
  const v1MemoryLimit = type !== "v2-only" && v1Mem !== null ? trim(read(join("/sys/fs/cgroup/memory", v1Mem, "memory.limit_in_bytes").replace(/\\/g, "/"))) : null;
  return { type, v2Path, memoryMax, ...(v1MemoryLimit !== null ? { v1MemoryLimit } : {}) };
}

function readOrNull(p) {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}

const BUN_ENV_SCRIPT = `const os = require("node:os");
const call = (f) => { try { return typeof f === "function" ? f() : null; } catch (e) { return "error: " + e.message; } };
console.log(JSON.stringify({
  version: Bun.version, revision: Bun.revision,
  constrainedMemory: call(process.constrainedMemory), availableMemory: call(process.availableMemory),
  hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? null,
  availableParallelism: call(os.availableParallelism), cpuModel: os.cpus()[0]?.model ?? null, cpuCount: os.cpus().length,
  totalmem: os.totalmem(), freemem: os.freemem(),
}));`;

/** The runtime environment as the given Bun sees it, plus host facts. Never throws. */
export function runtimeEnv({ bun, env = process.env, platform = process.platform } = {}) {
  const out = { capRequested: env.ZCODE_MEMLOOP_CAP ?? null };
  try {
    const r = spawnSync(bun, ["-e", BUN_ENV_SCRIPT], { env: unmarkedEnv(env), encoding: "utf8", timeout: 30_000, windowsHide: true });
    out.bun = r.status === 0 ? JSON.parse(r.stdout.trim().split("\n").pop()) : { error: (r.stderr || r.stdout || String(r.error ?? `exit ${r.status}`)).slice(0, 300) };
  } catch (err) { out.bun = { error: String(err?.message ?? err) }; }
  if (platform === "linux") {
    const n = spawnSync("nproc", [], { encoding: "utf8" });
    out.nproc = n.status === 0 ? Number(n.stdout.trim()) : null;
    out.cpuModel = (readOrNull("/proc/cpuinfo")?.match(/^model name\s*:\s*(.+)$/m) ?? [])[1] ?? cpus()[0]?.model ?? null;
    out.cgroup = cgroupInfo();
  } else {
    out.nproc = Number(env.NUMBER_OF_PROCESSORS) || null;
    out.cpuModel = cpus()[0]?.model ?? null;
    out.cgroup = { type: "none (Windows)", memoryMax: null };
    // The Windows cap is the run's Job Object (lib/caps.mjs), read back by the job.
    out.jobObjectLimit = env.ZCODE_MEMLOOP_CAP ? `Job Object ${env.ZCODE_MEMLOOP_CAP}` : null;
  }
  return out;
}

/**
 * Records the executable of every proxy process while it lives; resolve()
 * later asks each executable for its --revision. probe(snaps) plugs into
 * the sampler's probe hook and returns no heap values.
 */
export function proxyBunTracker({ env = process.env, platform = process.platform } = {}) {
  const seen = new Map(); // pid → exe | null
  return {
    probe(snaps) {
      for (const s of snaps ?? []) {
        if (s.role !== "proxy" || seen.has(s.pid)) continue;
        let exe = null;
        if (platform === "linux") { try { exe = readlinkSync(`/proc/${s.pid}/exe`).replace(/ \(deleted\)$/, ""); } catch {} }
        else exe = s.exe ?? null;
        seen.set(s.pid, exe);
      }
      return {};
    },
    resolve() {
      const byExe = new Map();
      const proxies = [];
      for (const [pid, exe] of seen) {
        if (exe && !byExe.has(exe)) {
          const r = spawnSync(exe, ["--revision"], { env: unmarkedEnv(env), encoding: "utf8", timeout: 30_000, windowsHide: true });
          byExe.set(exe, r.status === 0 ? r.stdout.trim() : null);
        }
        proxies.push({ pid, exe, revision: exe ? byExe.get(exe) : null });
      }
      return { proxies };
    },
  };
}
