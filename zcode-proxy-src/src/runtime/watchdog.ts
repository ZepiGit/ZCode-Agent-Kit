/**
 * watchdog.ts — kills the proxy when its main thread stops running.
 *
 * On 2026-09-24 the proxy stayed alive and bound to its port while its main
 * thread was parked (sync XHR `Atomics.wait` inside the captcha solver, 11 GB
 * RSS): /health timed out, the kit manager refused to touch a live pid, and
 * only a manual kill recovered it. A hung proxy is unrecoverable for every
 * harness; a dead one is not. So a second thread watches a heartbeat the main
 * thread ticks, and when the heartbeat freezes past the threshold it asks the
 * kit manager to respawn (hook env present) and hard-kills the process: with
 * the manager's logs dir after the respawn acknowledgement or a refusal, at
 * most 10 s later, logging the outcome it saw.
 *
 * The respawn acknowledgement lives here too, self-contained so the
 * watcher can embed it: the hook is spawned with unchanged arguments, and the
 * manager's answer is a `respawn.json` event with this pid and an `at` later
 * than the request time (written at budget reservation by old and new
 * managers alike), or the hook's exit 4 (a refusal).
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
 * The respawn hook's environment: `env` without the stop token
 * (`ZCODE_KIT_STOP_TOKEN`, any casing). The token belongs to this
 * spawn only, and the hook is the next manager, which spawns the next proxy.
 * `env` itself is left unchanged. Self-contained (embedded in the worker).
 */
export function hookEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const hookEnv: Record<string, string | undefined> = {};
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() !== "ZCODE_KIT_STOP_TOKEN") hookEnv[name] = env[name];
  }
  return hookEnv;
}

/**
 * Launch the hook detached and report whether the OS actually started it.
 * spawn() failures such as ENOENT/EACCES arrive as an async `error` event,
 * not a throw — without a listener they would crash the host, and a
 * fire-and-forget launch cannot tell a started manager from a missing one.
 * Resolves `{ ok: true }` on the child's `spawn` event; `{ ok: false }` on
 * `error`, a synchronous throw, or no answer within `ackMs`.
 *
 * Today's handoff, kept for a proxy whose manager set no logs dir (an old
 * manager): without `ZCODE_KIT_LOG_DIR` there is no acknowledgement to read.
 * The hook gets `hookEnvironment(env)`.
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
  const hookEnv = hookEnvironment(env);
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; error?: string }>();
  const timer = setTimeout(() => resolve({ ok: false, error: `no spawn acknowledgment within ${ackMs}ms` }), ackMs);
  const settle = (result: { ok: boolean; error?: string }) => {
    clearTimeout(timer);
    resolve(result);
  };
  try {
    const child = spawnFn(hook.command, hook.args, { detached: true, stdio: "ignore", windowsHide: true, env: hookEnv });
    child.once("spawn", () => settle({ ok: true }));
    child.once("error", (err: Error) => settle({ ok: false, error: err.message }));
    child.unref();
  } catch (err) {
    settle({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return promise;
}

/** How long the proxy waits for the respawn acknowledgement or a refusal, on both paths. */
export const RESPAWN_ACK_WAIT_MS = 10_000;
/** How often the wait reads `respawn.json`. */
export const RESPAWN_ACK_POLL_MS = 100;

/**
 * How a respawn request ended:
 * - `acknowledged`: the manager reserved the budget for this proxy (a
 *   `respawn.json` event with its pid, written after the request);
 * - `refused`: the hook exited 4 without that event (budget used up, pid not
 *   the recorded one, unreadable history);
 * - `no-acknowledgement`: no event within the wait, or the hook ended
 *   otherwise without one;
 * - `hook-failed`: the hook did not start;
 * - `started`: no logs dir to read an acknowledgement from (a manager older
 *   than 0.3.0): the hook's start is the confirmation.
 */
export type RespawnOutcome = "acknowledged" | "refused" | "no-acknowledgement" | "hook-failed" | "started";

export interface RespawnAnswer {
  outcome: RespawnOutcome;
  /** Only a confirmed request may drain the proxy: `acknowledged` (or `started` with an old manager). */
  confirmed: boolean;
  waitedMs: number;
  /** The hook's exit code when it ended during the wait. */
  exitCode?: number | null;
  error?: string;
}

/**
 * Whether `text` (the contents of `respawn.json`) holds the acknowledgement:
 * an event whose `pid` is `pid` and whose `at` is later than `requestTime`.
 * An earlier event for the same pid never matches, so a wall clock that jumped
 * back fails safe (no acknowledgement: keep serving). Self-contained.
 */
export function isRespawnAcknowledgement(text: string, pid: number, requestTime: number): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return false; }
  const events = (parsed as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return false;
  return events.some((e) => e !== null && typeof e === "object"
    && (e as { pid?: unknown }).pid === pid
    && typeof (e as { at?: unknown }).at === "number" && Number.isFinite((e as { at: number }).at)
    && (e as { at: number }).at > requestTime);
}

/**
 * Spawn the respawn hook (unchanged arguments, `hookEnvironment(env)`) and
 * wait at most `ackWaitMs` for the manager's answer:
 * - the acknowledgement in `ackFile` (read every `pollMs`) → `acknowledged`;
 * - the hook's exit 4 → `refused` at once; another exit without the event →
 *   `no-acknowledgement` at once (the file is read once more first, so an
 *   event written just before the exit still counts);
 * - the wait running out → `no-acknowledgement`;
 * - a spawn failure → `hook-failed`.
 * The request time is `io.now()` right before the spawn. The hook handle stays
 * referenced during the wait (its `exit` is watched) and is unref'd once the
 * wait ends: the detached hook outlives this process. Never rejects.
 *
 * Self-contained (its I/O is passed in) because its source is also embedded
 * in the watcher worker, next to `hookEnvironment` and `isRespawnAcknowledgement`.
 */
export function awaitRespawnAcknowledgement(
  io: { spawn: typeof spawn; readFile: (path: string) => string; now: () => number },
  hook: { command: string; args: string[] },
  env: Record<string, string | undefined>,
  opts: { pid: number; ackFile: string; ackWaitMs: number; pollMs: number },
): Promise<RespawnAnswer> {
  const requestTime = io.now();
  const { promise, resolve } = Promise.withResolvers<RespawnAnswer>();
  let child: ReturnType<typeof spawn> | null = null;
  let done = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const acknowledged = (): boolean => {
    try { return isRespawnAcknowledgement(io.readFile(opts.ackFile), opts.pid, requestTime); } catch { return false; }
  };
  const finish = (outcome: RespawnOutcome, extra: { exitCode?: number | null; error?: string } = {}): void => {
    if (done) return;
    done = true;
    clearInterval(poll);
    clearTimeout(timer);
    try { child?.unref(); } catch { /* already gone */ }
    resolve({ outcome, confirmed: outcome === "acknowledged", waitedMs: Math.max(0, io.now() - requestTime), ...extra });
  };
  try {
    child = io.spawn(hook.command, hook.args, { detached: true, stdio: "ignore", windowsHide: true, env: hookEnvironment(env) });
  } catch (err) {
    finish("hook-failed", { error: err instanceof Error ? err.message : String(err) });
    return promise;
  }
  // `on`, not `once`: an `error` after the wait must not crash the host.
  child.on("error", (err: Error) => finish(acknowledged() ? "acknowledged" : "hook-failed", { error: err.message }));
  child.once("exit", (code: number | null) => {
    if (acknowledged()) return finish("acknowledged");
    finish(code === 4 ? "refused" : "no-acknowledgement", { exitCode: code });
  });
  poll = setInterval(() => { if (acknowledged()) finish("acknowledged"); }, opts.pollMs);
  timer = setTimeout(() => finish(acknowledged() ? "acknowledged" : "no-acknowledgement"), opts.ackWaitMs);
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
  /** Without the manager's logs dir: longest wait for the respawn hook to start before the kill (default 2 s). */
  hookAckMs?: number;
  /** With the manager's logs dir: longest wait for the respawn acknowledgement or a refusal before the kill (default 10 s). */
  ackWaitMs?: number;
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
const { appendFileSync, readFileSync, writeSync } = require("node:fs");
const { join } = require("node:path");
const watchdogStep = (${watchdogStep.toString()});
const respawnHookCommand = (${respawnHookCommand.toString()});
const hookEnvironment = (${hookEnvironment.toString()});
const launchRespawnHook = (${launchRespawnHook.toString()});
const isRespawnAcknowledgement = (${isRespawnAcknowledgement.toString()});
const awaitRespawnAcknowledgement = (${awaitRespawnAcknowledgement.toString()});
const beat = new Int32Array(workerData.sab);
const cfg = { checkIntervalMs: workerData.checkIntervalMs, stallMs: workerData.stallMs };
const start = Date.now();
let state = { beat: Atomics.load(beat, 0), changedAt: start, checkedAt: start };
let firing = false;
const kill = () => process.kill(process.pid, "SIGKILL");
// This thread cannot use the main thread's log writer, and the inherited fd 2
// stays on the old file once proxy.log has been rotated. With the manager's
// logs dir, lines are appended to proxy.log by path, so they are in the file
// a person reads after a hang; without it they go to fd 2 as before.
const emit = (text) => {
  const dir = process.env.ZCODE_KIT_LOG_DIR;
  if (dir) {
    try { appendFileSync(join(dir, "proxy.log"), text, { mode: 0o600 }); return; } catch {}
  }
  writeSync(2, text);
};
// An event line (log/event-line.mjs format); every value here is a plain token.
const event = (level, message, fields) => emit(new Date().toISOString() + " " + level + " watchdog " + message
  + Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => " " + k + "=" + v).join("") + "\\n");
setInterval(() => {
  if (firing) return;
  const step = watchdogStep(state, Atomics.load(beat, 0), Date.now(), cfg);
  state = step.state;
  if (step.stalledMs === null) return;
  firing = true;
  emit("[watchdog] main thread unresponsive for " + step.stalledMs + "ms — requesting restart\\n");
  const hook = respawnHookCommand(process.env, process.pid, "watchdog");
  if (!hook) return kill();
  // Kill regardless of the outcome — a hung proxy is never recoverable in
  // place — but only after the manager has answered or the wait is over.
  const logDir = process.env.ZCODE_KIT_LOG_DIR;
  if (!logDir) {
    // A manager older than 0.3.0 (no logs dir): wait for the hook's start
    // only, bounded so a wedged spawn cannot keep the hung process alive.
    launchRespawnHook(spawn, hook, process.env, workerData.hookAckMs).then((result) => {
      if (!result.ok) emit("[watchdog] respawn hook failed: " + result.error + "\\n");
      kill();
    }, kill);
    return;
  }
  // Wait at most ackWaitMs for the acknowledgement or a
  // refusal, then terminate regardless and log the outcome. A refusal here
  // can end with no proxy; the next launch's preflight starts a fresh one.
  setTimeout(kill, workerData.ackWaitMs + 2000).unref?.();
  awaitRespawnAcknowledgement(
    { spawn, readFile: (path) => readFileSync(path, "utf8"), now: Date.now },
    hook, process.env,
    { pid: process.pid, ackFile: join(logDir, "respawn.json"), ackWaitMs: workerData.ackWaitMs, pollMs: 100 },
  ).then((answer) => {
    try {
      event(answer.outcome === "acknowledged" ? "INFO" : "ERROR", "respawn handoff ended; terminating", {
        outcome: answer.outcome, waitedMs: answer.waitedMs,
        hookExit: answer.exitCode === undefined ? undefined : String(answer.exitCode),
      });
    } finally { kill(); }
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
  const ackWaitMs = opts.ackWaitMs ?? RESPAWN_ACK_WAIT_MS;

  const sab = new SharedArrayBuffer(4);
  const beat = new Int32Array(sab);
  const heartbeat = setInterval(() => Atomics.add(beat, 0, 1), heartbeatMs);
  heartbeat.unref();
  const worker = new Worker(watcherSource(), {
    eval: true,
    workerData: { sab, stallMs, checkIntervalMs, hookAckMs, ackWaitMs },
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
