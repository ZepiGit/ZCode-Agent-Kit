/**
 * watchdog.ts — kills the proxy when its main thread stops running.
 *
 * On 2026-09-24 the proxy stayed alive and bound to its port while its main
 * thread was parked (sync XHR `Atomics.wait` inside the captcha solver, 11 GB
 * RSS): /health timed out, the kit manager refused to touch a live pid, and
 * only a manual kill recovered it. A hung proxy is unrecoverable for every
 * harness; a dead one is not. So a second thread watches a heartbeat the main
 * thread ticks, and when the heartbeat freezes past the threshold it asks the
 * kit manager to respawn (hook env present) and hard-kills the process.
 *
 * Implementation constraints (spikes on Bun 1.4.2, see fix context):
 * - The watcher is an eval'd `node:worker_threads` worker: no extra
 *   `bun build --compile` entrypoint is needed, and it keeps running while the
 *   main thread is blocked.
 * - `process.exit()` from a worker does not end the process;
 *   `process.kill(process.pid, "SIGKILL")` does.
 * - Never respawn ourselves (`process.execPath -e ...`): a compiled binary
 *   ignores `-e` and re-runs itself → runaway loop. Restarts go only through
 *   the kit manager's `respawn` command.
 */
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";

export interface WatchdogState {
  /** Heartbeat counter value seen at the last check. */
  beat: number;
  /** When the heartbeat was last seen to change (or the watch was reset). */
  changedAt: number;
  /** When the watcher itself last ran a check. */
  checkedAt: number;
}

export interface WatchdogStepConfig {
  checkIntervalMs: number;
  stallMs: number;
}

/**
 * One watcher check. Pure and self-contained: its source text is embedded in
 * the eval'd worker, so it must not reference anything outside its body.
 *
 * Suspend immunity: if the watcher's own checks were apart by more than 20×
 * the check interval, the whole process (or machine) was paused — laptop
 * sleep, debugger — and the frozen heartbeat says nothing about the main
 * thread. The watch restarts instead of reporting a stall.
 */
export function watchdogStep(
  state: WatchdogState,
  beat: number,
  now: number,
  cfg: WatchdogStepConfig,
): { state: WatchdogState; stalledMs: number | null } {
  if (now - state.checkedAt > cfg.checkIntervalMs * 20) {
    return { state: { beat, changedAt: now, checkedAt: now }, stalledMs: null };
  }
  if (beat !== state.beat) {
    return { state: { beat, changedAt: now, checkedAt: now }, stalledMs: null };
  }
  const stalledMs = now - state.changedAt;
  return {
    state: { beat, changedAt: state.changedAt, checkedAt: now },
    stalledMs: stalledMs > cfg.stallMs ? stalledMs : null,
  };
}

/**
 * The kit manager's respawn command for this process, or null when the proxy
 * was not started by the kit manager (standalone, tests, TUI). Pure and
 * self-contained for the same reason as `watchdogStep`.
 */
export function respawnHookCommand(
  env: Record<string, string | undefined>,
  pid: number,
  reason: string,
): { command: string; args: string[] } | null {
  const node = env.ZCODE_KIT_RESPAWN_NODE;
  const manager = env.ZCODE_KIT_RESPAWN_MANAGER;
  if (!node || !manager) return null;
  return { command: node, args: [manager, "respawn", String(pid), "--reason", reason] };
}

/**
 * Launch the hook detached and report whether the OS actually started it.
 * spawn() failures such as ENOENT/EACCES arrive as an async `error` event,
 * not a throw — without a listener they would crash the host, and a
 * fire-and-forget launch cannot tell a started manager from a missing one.
 * Resolves `{ ok: true }` on the child's `spawn` event; `{ ok: false }` on
 * `error`, a synchronous throw, or no answer within `ackMs`.
 *
 * Self-contained (spawn is passed in) because its source is also embedded
 * in the watcher worker.
 */
export function launchRespawnHook(
  spawnFn: typeof spawn,
  hook: { command: string; args: string[] },
  env: Record<string, string | undefined>,
  ackMs: number,
): Promise<{ ok: boolean; error?: string }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; error?: string }>();
  const timer = setTimeout(() => resolve({ ok: false, error: `no spawn acknowledgment within ${ackMs}ms` }), ackMs);
  const settle = (result: { ok: boolean; error?: string }) => {
    clearTimeout(timer);
    resolve(result);
  };
  try {
    const child = spawnFn(hook.command, hook.args, { detached: true, stdio: "ignore", windowsHide: true, env });
    child.once("spawn", () => settle({ ok: true }));
    child.once("error", (err: Error) => settle({ ok: false, error: err.message }));
    child.unref();
  } catch (err) {
    settle({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return promise;
}

/**
 * Ask the kit manager to restart this proxy. Resolves true only once the
 * manager process has actually started; false when the hook env is absent
 * or the launch failed — the caller must then keep serving, not exit.
 */
export async function spawnRespawnHook(
  reason: "watchdog" | "memory",
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const hook = respawnHookCommand(env, process.pid, reason);
  if (!hook) return false;
  const result = await launchRespawnHook(spawn, hook, env, 5_000);
  if (!result.ok) console.error(`[respawn] could not start the kit manager hook: ${result.error}`);
  return result.ok;
}

export interface WatchdogOptions {
  /** Heartbeat freeze that counts as a stall (default 45 s). */
  stallMs?: number;
  /** Watcher check cadence (default 1 s). */
  checkIntervalMs?: number;
  /** Main-thread heartbeat cadence (default 250 ms). */
  heartbeatMs?: number;
  /** Longest wait for the respawn hook to start before the kill (default 2 s). */
  hookAckMs?: number;
}

export interface WatchdogHandle {
  stop(): void;
}

// The watcher runs as eval'd CommonJS inside a worker thread. The two pure
// helpers are spliced in from their compiled source so the worker and the
// unit tests exercise the exact same decision code.
function watcherSource(): string {
  return `
const { workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { writeSync } = require("node:fs");
const watchdogStep = (${watchdogStep.toString()});
const respawnHookCommand = (${respawnHookCommand.toString()});
const launchRespawnHook = (${launchRespawnHook.toString()});
const beat = new Int32Array(workerData.sab);
const cfg = { checkIntervalMs: workerData.checkIntervalMs, stallMs: workerData.stallMs };
const start = Date.now();
let state = { beat: Atomics.load(beat, 0), changedAt: start, checkedAt: start };
let firing = false;
const kill = () => process.kill(process.pid, "SIGKILL");
setInterval(() => {
  if (firing) return;
  const step = watchdogStep(state, Atomics.load(beat, 0), Date.now(), cfg);
  state = step.state;
  if (step.stalledMs === null) return;
  firing = true;
  writeSync(2, "[watchdog] main thread unresponsive for " + step.stalledMs + "ms — requesting restart\\n");
  const hook = respawnHookCommand(process.env, process.pid, "watchdog");
  if (!hook) return kill();
  // Kill regardless of the outcome — a hung proxy is never recoverable in
  // place — but only after the manager launch is acknowledged or has failed,
  // bounded so a wedged spawn cannot keep the hung process alive.
  launchRespawnHook(spawn, hook, process.env, workerData.hookAckMs).then((result) => {
    if (!result.ok) writeSync(2, "[watchdog] respawn hook failed: " + result.error + "\\n");
    kill();
  }, kill);
}, workerData.checkIntervalMs);
`;
}

let installed: WatchdogHandle | null = null;

/**
 * Start the heartbeat + watcher (idempotent). Returns null when disabled with
 * ZCODE_KIT_WATCHDOG=0 (the only opt-out; the name avoids the prefixes the kit
 * strips from the proxy environment).
 */
export function installWatchdog(opts: WatchdogOptions = {}): WatchdogHandle | null {
  if (process.env.ZCODE_KIT_WATCHDOG === "0") return null;
  if (installed) return installed;
  const stallMs = opts.stallMs ?? 45_000;
  const checkIntervalMs = opts.checkIntervalMs ?? 1_000;
  const heartbeatMs = opts.heartbeatMs ?? 250;
  const hookAckMs = opts.hookAckMs ?? 2_000;

  const sab = new SharedArrayBuffer(4);
  const beat = new Int32Array(sab);
  const heartbeat = setInterval(() => Atomics.add(beat, 0, 1), heartbeatMs);
  heartbeat.unref();
  const worker = new Worker(watcherSource(), {
    eval: true,
    workerData: { sab, stallMs, checkIntervalMs, hookAckMs },
  });
  // Neither thread may keep a finished process alive.
  worker.unref();
  worker.on("error", (err: Error) => console.error(`[watchdog] watcher failed: ${err.message}`));

  const handle: WatchdogHandle = {
    stop() {
      clearInterval(heartbeat);
      void worker.terminate();
      if (installed === handle) installed = null;
    },
  };
  installed = handle;
  return handle;
}
