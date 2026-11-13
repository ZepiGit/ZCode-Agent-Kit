/**
 * The solver's memory cap against an injected operating system: what is asked
 * of systemd and of the Job Object calls, that a mode is reported only after
 * the kernel showed the limit, and what releasing the cap gives back. The
 * same paths against the real operating system run in solver-process.test.ts.
 */
import { describe, expect, it } from "bun:test";
import { JOB_LIMIT_INFO, applySolverCap, type JobObjectApi, type SolverCapOs } from "./solver-cap.js";

const CAP = 300 * 1024 * 1024;
const PID = 4242;

interface FakeLinux {
  os: SolverCapOs;
  commands: string[][];
  files: Map<string, string>;
}

/** A Linux whose systemd puts the process into the requested scope; `files` are the scope's cgroup files. */
function linux(opts: { busctl?: number | null | (() => number | null); enters?: boolean; scopeFiles?: Record<string, string>; result?: string } = {}): FakeLinux {
  const commands: string[][] = [];
  const files = new Map<string, string>();
  const os: SolverCapOs = {
    platform: "linux",
    async run(command, args) {
      commands.push([command, ...args]);
      if (command === "busctl") {
        const code = opts.busctl === undefined ? 0 : typeof opts.busctl === "function" ? opts.busctl() : opts.busctl;
        if (code === 0 && opts.enters !== false) {
          const unit = args[args.indexOf("StartTransientUnit") + 2]!;
          const scope = `/user.slice/user-1000.slice/user@1000.service/app.slice/${unit}`;
          files.set(`/proc/${PID}/cgroup`, `0::${scope}\n`);
          for (const [name, text] of Object.entries(opts.scopeFiles ?? { "memory.max": `${CAP}\n`, "memory.swap.max": "0\n", "memory.events": "max 0\noom 0\noom_kill 0\n" })) {
            files.set(`/sys/fs/cgroup${scope}/${name}`, text);
          }
        }
        return { code, stdout: "" };
      }
      if (command === "systemctl" && args.includes("show")) return { code: 0, stdout: `${opts.result ?? "success"}\n` };
      return { code: 0, stdout: "" };
    },
    read: (path) => files.get(path) ?? null,
    sleep: async () => {},
    jobObjects: async () => null,
  };
  files.set(`/proc/${PID}/cgroup`, "0::/user.slice/user-1000.slice/session-3.scope\n");
  return { os, commands, files };
}

describe("solver cap: Linux (systemd user scope)", () => {
  it("asks systemd for a scope that adopts the process with MemoryMax and MemorySwapMax=0, and reports cgroup once memory.max shows the limit", async () => {
    const { os, commands } = linux();
    const cap = await applySolverCap(PID, CAP, os);
    expect(cap.enforcement).toBe("cgroup");
    expect(commands).toHaveLength(1);
    const [command, ...args] = commands[0]!;
    expect(command).toBe("busctl");
    expect(args.slice(0, 8)).toEqual(["--user", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
      "org.freedesktop.systemd1.Manager", "StartTransientUnit", "ssa(sv)a(sa(sv))", args[7]!]);
    expect(args[7]).toMatch(new RegExp(`^zcode-captcha-solver-${process.pid}-${PID}-[0-9a-f]{8}\\.scope$`));
    expect(args.slice(8).join(" ")).toBe(`fail 4 Description s ZCode captcha solver PIDs au 1 ${PID} MemoryMax t ${CAP} MemorySwapMax t 0 0`);
  });

  for (const [name, scopeFiles] of [
    ["is missing", { "memory.swap.max": "0\n" }],
    ["shows no limit", { "memory.max": "max\n", "memory.swap.max": "0\n" }],
    ["shows another limit", { "memory.max": `${CAP * 2}\n`, "memory.swap.max": "0\n" }],
  ] as const) {
    it(`reports sampling, never cgroup, when the scope's memory.max ${name}`, async () => {
      const cap = await applySolverCap(PID, CAP, linux({ scopeFiles }).os);
      expect(cap.enforcement).toBe("sampling");
      expect(cap.reason).toBe("the memory controller is not delegated to the user's systemd");
      expect(cap.designed).toBeUndefined();
    });
  }

  it("reports sampling when swap is not limited to 0 in the scope", async () => {
    const cap = await applySolverCap(PID, CAP, linux({ scopeFiles: { "memory.max": `${CAP}\n`, "memory.swap.max": "max\n" } }).os);
    expect(cap.enforcement).toBe("sampling");
  });

  it("reports sampling when no user systemd answers or the process never enters the scope", async () => {
    for (const failure of [{ busctl: 1 }, { busctl: null }, { enters: false }]) {
      const cap = await applySolverCap(PID, CAP, linux(failure).os);
      expect(cap.enforcement).toBe("sampling");
      expect(await cap.endedAtCap()).toBe(false);
    }
  });

  it("does not ask systemd again once a scope request has failed or timed out: later solver processes go straight to sampling", async () => {
    for (const busctl of [1, null]) {
      const { os, commands } = linux({ busctl });
      const first = await applySolverCap(PID, CAP, os);
      const second = await applySolverCap(PID + 1, CAP, os);
      const third = await applySolverCap(PID + 2, CAP, os);
      expect([first, second, third].map((cap) => [cap.enforcement, cap.reason])).toEqual(Array(3).fill(["sampling", "no systemd user scope could be started"]));
      expect(commands).toHaveLength(1);
    }
  });

  it("does not remember a success: systemd is asked for every solver process until a request fails", async () => {
    let fail = false;
    const { os, commands } = linux({ busctl: () => (fail ? 1 : 0) });
    expect((await applySolverCap(PID, CAP, os)).enforcement).toBe("cgroup");
    expect((await applySolverCap(PID, CAP, os)).enforcement).toBe("cgroup");
    fail = true;
    expect((await applySolverCap(PID, CAP, os)).enforcement).toBe("sampling");
    fail = false;
    expect((await applySolverCap(PID, CAP, os)).enforcement).toBe("sampling");
    expect(commands.filter(([command]) => command === "busctl")).toHaveLength(3);
  });

  it("asks again after a scope that carried no limit or was never entered: only a failed request is remembered", async () => {
    for (const failure of [{ enters: false }, { scopeFiles: { "memory.max": "max\n" } }]) {
      const { os, commands } = linux(failure);
      await applySolverCap(PID, CAP, os);
      await applySolverCap(PID, CAP, os);
      expect(commands.filter(([command]) => command === "busctl")).toHaveLength(2);
    }
  });

  it("recognises a kill at the limit from the scope's memory.events, or from systemd once the scope's cgroup is gone", async () => {
    const live = linux({ scopeFiles: { "memory.max": `${CAP}\n`, "memory.events": "max 37\noom 1\noom_kill 1\n" } });
    expect(await (await applySolverCap(PID, CAP, live.os)).endedAtCap()).toBe(true);

    const gone = linux({ result: "oom-kill" });
    const cap = await applySolverCap(PID, CAP, gone.os);
    for (const path of [...gone.files.keys()]) if (path.endsWith("memory.events")) gone.files.delete(path);
    expect(await cap.endedAtCap()).toBe(true);
    const unit = gone.commands[0]![8]!;
    expect(gone.commands[1]).toEqual(["systemctl", "--user", "show", unit, "--property=Result", "--value"]);
    // The failed scope is given back, once.
    cap.release();
    cap.release();
    expect(gone.commands.slice(2)).toEqual([["systemctl", "--user", "reset-failed", unit]]);
  });

  it("sees no kill at the limit after a clean end, and leaves nothing to reset", async () => {
    const { os, commands } = linux();
    const cap = await applySolverCap(PID, CAP, os);
    expect(await cap.endedAtCap()).toBe(false);
    cap.release();
    expect(commands).toHaveLength(1);
  });
});

/** A kernel32 that keeps one job's limit information and records every call. */
function windows(opts: { fail?: string; readBack?: (info: Uint8Array) => void; peak?: number } = {}) {
  const calls: string[] = [];
  let stored = new Uint8Array(JOB_LIMIT_INFO.size);
  const api: JobObjectApi = {
    createJobObject() { calls.push("create"); return opts.fail === "create" ? 0 : 0x10; },
    setLimits(job, info) { calls.push(`set ${String(job)}`); stored = Uint8Array.from(info); return opts.fail !== "set"; },
    queryLimits(job, info) {
      calls.push(`query ${String(job)}`);
      if (opts.fail === "query") return false;
      info.set(stored);
      new DataView(info.buffer).setBigUint64(JOB_LIMIT_INFO.peakProcessMemoryUsed, BigInt(opts.peak ?? 0), true);
      opts.readBack?.(info);
      return true;
    },
    openProcess(access, pid) { calls.push(`open 0x${access.toString(16)} ${pid}`); return opts.fail === "open" ? null : 0x20; },
    assignProcess(job, proc) { calls.push(`assign ${String(job)} ${String(proc)}`); return opts.fail !== "assign"; },
    closeHandle(handle) { calls.push(`close ${String(handle)}`); },
  };
  const os: SolverCapOs = {
    platform: "win32",
    run: async () => ({ code: null, stdout: "" }),
    read: () => null,
    sleep: async () => {},
    jobObjects: async () => (opts.fail === "load" ? null : api),
  };
  return { os, calls, limits: () => new DataView(stored.buffer) };
}

describe("solver cap: Windows (Job Object)", () => {
  it("limits the process's memory with kill-on-close, assigns the process, reads the limit back and reports job-object", async () => {
    const { os, calls, limits } = windows();
    const cap = await applySolverCap(PID, CAP, os);
    expect(cap.enforcement).toBe("job-object");
    // PROCESS_SET_QUOTA | PROCESS_TERMINATE; the process handle is closed, the job handle is kept.
    expect(calls).toEqual(["create", "set 16", `open 0x101 ${PID}`, "assign 16 32", "close 32", "query 16"]);
    // JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, and the limit in bytes.
    expect(limits().getUint32(JOB_LIMIT_INFO.limitFlags, true)).toBe(0x2100);
    expect(limits().getBigUint64(JOB_LIMIT_INFO.processMemoryLimit, true)).toBe(BigInt(CAP));
    expect(limits().byteLength).toBe(144);
  });

  it("closes the Job Object handle when the cap is released, once", async () => {
    const { os, calls } = windows();
    const cap = await applySolverCap(PID, CAP, os);
    calls.length = 0;
    cap.release();
    cap.release();
    expect(calls).toEqual(["close 16"]);
  });

  for (const fail of ["load", "create", "set", "open", "assign", "query"]) {
    it(`reports sampling, never job-object, when the ${fail} step fails, and keeps no job handle`, async () => {
      const { os, calls } = windows({ fail });
      const cap = await applySolverCap(PID, CAP, os);
      expect(cap.enforcement).toBe("sampling");
      if (fail !== "load" && fail !== "create") expect(calls.at(-1)).toBe("close 16");
      expect(calls.filter((call) => call === "close 16")).toHaveLength(fail === "load" || fail === "create" ? 0 : 1);
    });
  }

  it("reports sampling when the limit does not read back as set", async () => {
    for (const readBack of [
      (info: Uint8Array) => new DataView(info.buffer).setBigUint64(JOB_LIMIT_INFO.processMemoryLimit, 0n, true),
      (info: Uint8Array) => new DataView(info.buffer).setUint32(JOB_LIMIT_INFO.limitFlags, 0x2000, true),
    ]) {
      const cap = await applySolverCap(PID, CAP, windows({ readBack }).os);
      expect(cap.enforcement).toBe("sampling");
    }
  });

  it("takes a peak at the limit as an end at the cap, and a lower peak as something else", async () => {
    expect(await (await applySolverCap(PID, CAP, windows({ peak: CAP - 4096 }).os)).endedAtCap()).toBe(true);
    expect(await (await applySolverCap(PID, CAP, windows({ peak: CAP / 2 }).os)).endedAtCap()).toBe(false);
  });
});

describe("solver cap: other systems", () => {
  it("reports sampling as the designed mode on macOS, which has no per-process limit", async () => {
    const cap = await applySolverCap(PID, CAP, { platform: "darwin", run: async () => ({ code: 0, stdout: "" }), read: () => null, sleep: async () => {}, jobObjects: async () => null });
    expect(cap).toMatchObject({ enforcement: "sampling", designed: true, reason: "darwin has no per-process memory limit" });
  });

  it("never rejects: an operating system call that throws leaves sampling", async () => {
    const cap = await applySolverCap(PID, CAP, { platform: "linux", run: async () => { throw new Error("boom"); }, read: () => null, sleep: async () => {}, jobObjects: async () => null });
    expect(cap.enforcement).toBe("sampling");
  });
});
