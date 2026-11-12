/**
 * solver-cap.ts — the solver process's memory cap, as the operating system
 * enforces it. The proxy applies the cap to a freshly started solver process
 * before that process loads anything heavy (captcha-solver.ts runs the
 * handshake) and reports how the cap is enforced:
 *
 *   job-object  Windows: a Job Object with a per-process memory limit (commit
 *               charge) and kill-on-close, through bun:ffi. The limit is read
 *               back before the mode is reported.
 *   cgroup      Linux: a systemd user scope (cgroup v2) with MemoryMax and
 *               MemorySwapMax=0 that adopts the solver process. Reported only
 *               when the scope's own memory.max shows the requested value.
 *   sampling    The OS enforces nothing here (macOS, a Linux without a
 *               delegated memory controller, a Job Object that could not be
 *               set up). The solver process then measures its own memory
 *               footprint and ends itself at the cap (captcha-solver-process.ts).
 *   none        No cap at all (the thread transport).
 *
 * A mode is never reported on the strength of a call that merely succeeded:
 * each kernel mode is read back from the kernel first.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export type SolverEnforcement = "job-object" | "cgroup" | "sampling" | "none";

/** The config.yaml key that sets the cap; the log line of a cap kill names it. */
export const SOLVER_CAP_KEY = "solver.memoryCapMB";
export const DEFAULT_SOLVER_CAP_MB = 300;
/** Below this the solver cannot load its DOM runtime and solve at all (about 50 MB before the first solve). */
export const MIN_SOLVER_CAP_MB = 128;
export const MAX_SOLVER_CAP_MB = 65536;

/** The cap as applied to one solver process. */
export interface SolverCap {
  readonly enforcement: SolverEnforcement;
  /** Sampling only: why the operating system does not enforce the cap here. */
  readonly reason?: string;
  /** Sampling only: this platform has no kernel limit to use, so sampling is the mode it is meant to run in. */
  readonly designed?: boolean;
  /** Once the process is gone: did the operating system end it at the cap? */
  endedAtCap(): Promise<boolean>;
  /** Give the cap's container back (close the Job Object, forget the scope). Idempotent. */
  release(): void;
}

/** The kernel32 calls a Job Object needs. Handles are opaque; 0 or null means failure. */
export interface JobObjectApi {
  createJobObject(): unknown;
  setLimits(job: unknown, info: Uint8Array): boolean;
  queryLimits(job: unknown, info: Uint8Array): boolean;
  openProcess(access: number, pid: number): unknown;
  assignProcess(job: unknown, process: unknown): boolean;
  closeHandle(handle: unknown): void;
}

/** What applying a cap needs from the operating system. Tests inject it. */
export interface SolverCapOs {
  platform: NodeJS.Platform;
  /** Runs a command to its end; never rejects. `code` is null when it could not run or timed out. */
  run(command: string, args: readonly string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }>;
  /** A file's text, or null when it cannot be read. */
  read(path: string): string | null;
  sleep(ms: number): Promise<void>;
  /** Windows: the Job Object calls, or null when they cannot be loaded. */
  jobObjects(): Promise<JobObjectApi | null>;
}

const noRelease = (): void => {};
const never = (): Promise<boolean> => Promise.resolve(false);

/** No cap is applied (the thread transport, or a caller that asks for none). */
export const NO_SOLVER_CAP: SolverCap = Object.freeze({ enforcement: "none", endedAtCap: never, release: noRelease });

function sampling(reason: string, designed = false): SolverCap {
  return { enforcement: "sampling", reason, ...(designed ? { designed } : {}), endedAtCap: never, release: noRelease };
}

let configuredCapMB: number = DEFAULT_SOLVER_CAP_MB;

/** Sets the cap of the proxy's own solver from config.yaml (`solver.memoryCapMB`); absent keeps the default. */
export function configureSolverCap(capMB: number | undefined): void {
  configuredCapMB = capMB ?? DEFAULT_SOLVER_CAP_MB;
}

/** The cap the proxy's own solver process gets, in MB. */
export function configuredSolverCapMB(): number {
  return configuredCapMB;
}

// ---------------------------------------------------------------- Linux

const SYSTEMD_TIMEOUT_MS = 5_000;
/** How long the solver process may take to show up in its scope after systemd accepted the request. */
const SCOPE_ENTER_MS = 2_000;
const CGROUP_ROOT = "/sys/fs/cgroup";

/** The cgroup v2 path of a process ("0::/path" in /proc/<pid>/cgroup), or null. */
function cgroupOf(pid: number, os: SolverCapOs): string | null {
  const line = os.read(`/proc/${pid}/cgroup`)?.split("\n").find((entry) => entry.startsWith("0::"));
  return line ? line.slice(3).trim() : null;
}

async function applyCgroup(pid: number, capBytes: number, os: SolverCapOs): Promise<SolverCap> {
  // Unique per solver process: a failed scope of an earlier process with a
  // reused pid must not collide with this one.
  const unit = `zcode-captcha-solver-${process.pid}-${pid}-${randomBytes(4).toString("hex")}.scope`;
  const started = await os.run("busctl", [
    "--user", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager",
    "StartTransientUnit", "ssa(sv)a(sa(sv))", unit, "fail", "4",
    "Description", "s", "ZCode captcha solver",
    "PIDs", "au", "1", String(pid),
    "MemoryMax", "t", String(capBytes),
    "MemorySwapMax", "t", "0",
    "0",
  ], SYSTEMD_TIMEOUT_MS);
  if (started.code !== 0) return sampling("no systemd user scope could be started");

  // systemd moves the process asynchronously.
  let directory: string | null = null;
  for (let waited = 0; waited <= SCOPE_ENTER_MS; waited += 10) {
    const cgroup = cgroupOf(pid, os);
    if (cgroup?.endsWith(`/${unit}`)) { directory = `${CGROUP_ROOT}${cgroup}`; break; }
    await os.sleep(10);
  }
  if (!directory) return sampling("the solver process did not enter its systemd scope");

  // Never claim a cap that is not there: without a delegated memory
  // controller the scope exists but carries no limit.
  const max = os.read(`${directory}/memory.max`)?.trim();
  const swap = os.read(`${directory}/memory.swap.max`)?.trim();
  if (max !== String(capBytes) || (swap !== undefined && swap !== "0")) {
    return sampling("the memory controller is not delegated to the user's systemd");
  }

  let oomKilled = false;
  let released = false;
  return {
    enforcement: "cgroup",
    async endedAtCap() {
      if (oomKilled) return true;
      // The scope's cgroup is removed moments after its last process ended;
      // systemd then still holds the scope as failed with the reason.
      const events = os.read(`${directory}/memory.events`);
      if (events !== null) oomKilled = /^oom_kill\s+[1-9]/m.test(events);
      else {
        const shown = await os.run("systemctl", ["--user", "show", unit, "--property=Result", "--value"], SYSTEMD_TIMEOUT_MS);
        oomKilled = shown.code === 0 && shown.stdout.trim() === "oom-kill";
      }
      return oomKilled;
    },
    release() {
      if (released) return;
      released = true;
      // A scope ends with its last process. One that was killed at its limit
      // stays behind as a failed unit until it is reset.
      if (oomKilled) void os.run("systemctl", ["--user", "reset-failed", unit], SYSTEMD_TIMEOUT_MS);
    },
  };
}

// -------------------------------------------------------------- Windows

const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x0100;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_LIMIT_FLAGS = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
/** JOBOBJECT_EXTENDED_LIMIT_INFORMATION on 64-bit Windows. */
export const JOB_LIMIT_INFO = Object.freeze({ size: 144, limitFlags: 16, processMemoryLimit: 112, peakProcessMemoryUsed: 128 });
/**
 * A process at its Job Object limit is not killed: its next allocation fails
 * and the runtime aborts. Its peak then sits just under the limit, short by
 * at most the allocation that failed.
 */
const JOB_PEAK_AT_CAP = 0.9;

const isHandle = (handle: unknown): boolean => handle !== null && handle !== undefined && handle !== 0 && handle !== 0n;

async function applyJobObject(pid: number, capBytes: number, os: SolverCapOs): Promise<SolverCap> {
  const api = await os.jobObjects();
  if (!api) return sampling("the Job Object calls could not be loaded");
  const job = api.createJobObject();
  if (!isHandle(job)) return sampling("the Job Object could not be created");
  const fail = (reason: string): SolverCap => {
    // Closing the only handle ends the job; nothing was assigned to it yet,
    // or the assignment failed, so no process dies with it.
    api.closeHandle(job);
    return sampling(reason);
  };

  const info = new Uint8Array(JOB_LIMIT_INFO.size);
  const view = new DataView(info.buffer);
  view.setUint32(JOB_LIMIT_INFO.limitFlags, JOB_LIMIT_FLAGS, true);
  view.setBigUint64(JOB_LIMIT_INFO.processMemoryLimit, BigInt(capBytes), true);
  if (!api.setLimits(job, info)) return fail("the Job Object limit could not be set");

  const process_ = api.openProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, pid);
  if (!isHandle(process_)) return fail("the solver process could not be opened");
  const assigned = api.assignProcess(job, process_);
  api.closeHandle(process_);
  if (!assigned) return fail("the solver process could not be assigned to the Job Object");

  const readBack = (): DataView | null => {
    const out = new Uint8Array(JOB_LIMIT_INFO.size);
    return api.queryLimits(job, out) ? new DataView(out.buffer) : null;
  };
  const back = readBack();
  if (!back
    || (back.getUint32(JOB_LIMIT_INFO.limitFlags, true) & JOB_LIMIT_FLAGS) !== JOB_LIMIT_FLAGS
    || back.getBigUint64(JOB_LIMIT_INFO.processMemoryLimit, true) !== BigInt(capBytes)) {
    // The process is in a job whose limit cannot be confirmed. Closing the
    // job may end it (kill-on-close), which is the safe outcome: it never
    // solves under a limit nobody verified.
    return fail("the Job Object limit did not read back as set");
  }

  let released = false;
  let atCap: boolean | null = null;
  return {
    enforcement: "job-object",
    async endedAtCap() {
      if (atCap !== null) return atCap;
      const now = released ? null : readBack();
      atCap = !!now && Number(now.getBigUint64(JOB_LIMIT_INFO.peakProcessMemoryUsed, true)) >= capBytes * JOB_PEAK_AT_CAP;
      return atCap;
    },
    release() {
      if (released) return;
      released = true;
      api.closeHandle(job);
    },
  };
}

/** kernel32 through bun:ffi; null off Windows or when the library cannot be opened. */
async function loadJobObjects(): Promise<JobObjectApi | null> {
  if (process.platform !== "win32") return null;
  try {
    const { dlopen, FFIType } = await import("bun:ffi");
    const { symbols } = dlopen("kernel32.dll", {
      CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
      SetInformationJobObject: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      QueryInformationJobObject: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
      AssignProcessToJobObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    type Pointer = Parameters<typeof symbols.CloseHandle>[0];
    const EXTENDED_LIMIT_INFORMATION = 9;
    return {
      createJobObject: () => symbols.CreateJobObjectW(null, null),
      setLimits: (job, info) => symbols.SetInformationJobObject(job as Pointer, EXTENDED_LIMIT_INFORMATION, info, info.byteLength) !== 0,
      queryLimits: (job, info) => symbols.QueryInformationJobObject(job as Pointer, EXTENDED_LIMIT_INFORMATION, info, info.byteLength, null) !== 0,
      openProcess: (access, pid) => symbols.OpenProcess(access, 0, pid),
      assignProcess: (job, proc) => symbols.AssignProcessToJobObject(job as Pointer, proc as Pointer) !== 0,
      closeHandle: (handle) => { symbols.CloseHandle(handle as Pointer); },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- entry

const realOs: SolverCapOs = {
  platform: process.platform,
  run: (command, args, timeoutMs) => new Promise((resolve) => {
    try {
      execFile(command, [...args], { timeout: timeoutMs, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : null) : 0;
        resolve({ code, stdout: typeof stdout === "string" ? stdout : "" });
      });
    } catch {
      resolve({ code: null, stdout: "" });
    }
  }),
  read: (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  jobObjects: loadJobObjects,
};

/**
 * Applies a memory cap of `capBytes` to the running process `pid` and reports
 * how it is enforced. Never rejects: where the operating system cannot enforce
 * the cap the result is `sampling`, with the reason.
 */
export async function applySolverCap(pid: number, capBytes: number, os: SolverCapOs = realOs): Promise<SolverCap> {
  try {
    if (os.platform === "win32") return await applyJobObject(pid, capBytes, os);
    if (os.platform === "linux") return await applyCgroup(pid, capBytes, os);
    return sampling(`${os.platform} has no per-process memory limit`, true);
  } catch {
    return sampling("the memory cap could not be applied");
  }
}
