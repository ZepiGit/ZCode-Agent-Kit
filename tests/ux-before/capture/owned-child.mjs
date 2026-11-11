// Capture-only ownership, never a production process probe or kill target.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
function ownGroup() {
  if (process.platform === "win32") return null;
  if (process.platform === "linux") return Number(readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ")[2]);
  const probe = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8", timeout: 1000 });
  return probe.status === 0 ? Number(probe.stdout.trim()) : null;
}
if (process.argv[2] === "--keeper") {
  const [command, args, cwd, input] = JSON.parse(process.argv[3]);
  const send = (event) => process.send?.(event);
  send({ type: "identity", pid: process.pid, pgid: ownGroup() });
  // Faults must not recursively infect a pipe-holder grandchild.
  const child = spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.once("spawn", () => send({ type: "spawn", pid: child.pid }));
  child.once("error", (error) => send({ type: "error", code: error.code, message: error.message }));
  child.stdin.on("error", () => {});
  if (input !== null) child.stdin.end(input);
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.once("exit", (status, signal) => send({ type: "exit", status, signal }));
  child.once("close", (status, signal) => {
    process.stdout.write("", () => process.stderr.write("", () => send({ type: "drained", status, signal })));
  });
  process.on("message", (message) => {
    if (message === "release") process.disconnect();
    if (message === "eof") child.stdin.end();
    if (message === "terminate" && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  });
  process.on("disconnect", () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
const tail = (text, chunk) => (text + chunk).slice(-16384);
// Inject only process creation and owner-close observation. Linux executions of
// this adapter's Windows controls are synthetic, not native tree-kill evidence.
export async function terminateWindowsOwner({ ownerPid, ownerClosed, timeoutMs, spawnImpl = spawn }) {
  const until = performance.now() + timeoutMs;
  const result = { treeDead: false };
  await new Promise((resolve) => {
    let killer, timer, settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) result.cleanupError = error;
      resolve();
    };
    try {
      killer = spawnImpl("taskkill", ["/PID", String(ownerPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      timer = setTimeout(() => { killer.kill(); killer.unref(); finish("TASKKILL_TIMEOUT"); }, Math.max(1, timeoutMs / 2));
      killer.once("error", (error) => finish(`TASKKILL_${error.code ?? "ERROR"}`));
      killer.once("close", (status, signal) => finish(status === 0 ? undefined : `TASKKILL_EXIT_${status ?? signal}`));
    } catch (error) { finish(`TASKKILL_${error.code ?? "ERROR"}`); }
  });
  while (!ownerClosed() && performance.now() < until) await sleep(Math.min(10, until - performance.now()));
  if (!ownerClosed()) result.cleanupError ??= "OWNER_CLOSE_TIMEOUT";
  // Even exit 0 + owner close does not prove every descendant is dead.
  return result;
}

// Raw controller cancellation reserves 3s for its real fixture finally, then
// 3s for owner tree/close: 110s + 2*1s drain + 6s cleanup < 120s test guard.
// Ordinary children retain 2s cleanup; no work/startup deadline is increased.
export function startOwned(command, args, { cwd, env, input = "", phase, timeoutMs = 5000, drainMs = 1000, cleanupMs = phase === "raw-health-capture" ? 6000 : 2000,
  hardDeadline = performance.now() + timeoutMs + 2 * drainMs + cleanupMs, onEvent = () => {} } = {}) {
  const keeper = spawn(process.execPath, [SELF, "--keeper", JSON.stringify([command, args, cwd, input])], {
    cwd, env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const result = { phase, pid: null, ownerPid: keeper.pid ?? null, pgid: null, groupVerified: false,
    status: null, signal: null, error: null, exited: false, drained: false, ownerClosed: false, stdout: "", stderr: "" };
  let deadline, drain, finish, stopping, closed;
  const done = new Promise((resolve) => { finish = resolve; });
  const ownerClose = new Promise((resolve) => { closed = resolve; });
  const event = (type) => onEvent({ type, phase, pid: result.pid, ownerPid: result.ownerPid, pgid: result.pgid, groupVerified: result.groupVerified });
  const fail = (code, message) => { result.error ??= { code, message }; };
  const remaining = (limit) => Math.max(1, Math.min(limit, hardDeadline - cleanupMs - performance.now()));
  const send = (message) => { if (keeper.connected) keeper.send(message, () => {}); };
  const stop = () => (stopping ??= (async () => {
    clearTimeout(deadline); clearTimeout(drain);
    const until = Math.min(hardDeadline, performance.now() + cleanupMs);
    const left = (limit) => Math.max(1, Math.min(limit, until - performance.now()));
    event("cleanup-start");
    if (phase === "raw-health-capture" && keeper.connected) {
      send("terminate");
      await Promise.race([ownerClose, sleep(left(cleanupMs / 2))]);
    }
    if (keeper.exitCode === null && keeper.signalCode === null) {
      if (process.platform === "win32") {
        Object.assign(result, await terminateWindowsOwner({ ownerPid: keeper.pid, ownerClosed: () => result.ownerClosed, timeoutMs: left(cleanupMs) }));
      } else if (result.groupVerified) {
        try { process.kill(-result.pgid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") result.cleanupError = error.code; }
      } else {
        result.cleanupError = "UNVERIFIED_PRIVATE_GROUP";
        keeper.kill("SIGKILL"); // own spawn handle only; never an assumed group
      }
    }
    if (!result.ownerClosed) await Promise.race([ownerClose, sleep(left(cleanupMs))]);
    if (!result.ownerClosed) {
      result.cleanupError ??= "OWNER_CLOSE_TIMEOUT";
      keeper.stdout.destroy(); keeper.stderr.destroy();
      if (keeper.connected) keeper.disconnect();
      keeper.unref();
    }
    event("cleanup-done");
    finish(result);
    return result;
  })());
  keeper.stdout.setEncoding("utf8").on("data", (chunk) => { result.stdout = tail(result.stdout, chunk); });
  keeper.stderr.setEncoding("utf8").on("data", (chunk) => { result.stderr = tail(result.stderr, chunk); });
  keeper.on("message", (message) => {
    if (message.type === "identity") {
      result.pgid = message.pgid;
      result.groupVerified = process.platform !== "win32" && message.pid === keeper.pid && message.pgid === keeper.pid && message.pgid !== ownGroup();
      event("identity");
    }
    if (message.type === "spawn") { result.pid = message.pid; event("spawn"); }
    if (message.type === "error") { fail(message.code, message.message); void stop(); }
    if (message.type === "exit") {
      result.exited = true; result.status = message.status; result.signal = message.signal; event("exit");
      if (message.status !== 0) fail("CAPTURE_EXIT", "command exited unsuccessfully");
      clearTimeout(deadline);
      drain = setTimeout(() => { fail("CAPTURE_DRAIN_TIMEOUT", "command exited but output pipes did not drain"); void stop(); }, remaining(drainMs));
    }
    if (message.type === "drained") {
      result.drained = true; result.status = message.status; result.signal = message.signal; event("drained");
      clearTimeout(deadline); clearTimeout(drain);
      if (message.status !== 0) fail("CAPTURE_EXIT", "command exited unsuccessfully");
      if (result.error) void stop();
      else { send("release"); deadline = setTimeout(() => { fail("CAPTURE_RELEASE_TIMEOUT", "owner did not close after drain"); void stop(); }, remaining(drainMs)); }
    }
  });
  keeper.once("error", (error) => { fail(error.code, error.message); void stop(); });
  keeper.once("close", (status, signal) => {
    clearTimeout(deadline); clearTimeout(drain);
    result.ownerClosed = true; result.ownerStatus = status; result.ownerSignal = signal;
    if (!result.drained && !result.error) fail("CAPTURE_OWNER_EXIT", "owner exited without a drain acknowledgement");
    event("owner-close"); closed();
    if (!stopping) finish(result);
  });
  deadline = setTimeout(() => { fail("CAPTURE_TIMEOUT", "command did not exit before its deadline"); void stop(); }, remaining(timeoutMs));
  return { result, done, stop, eof() { send("eof"); } };
}

export async function runOwned(command, args, options) { return startOwned(command, args, options).done; }
export function requireSuccess(result) {
  if (result.error || result.cleanupError || result.status !== 0 || !result.drained || !result.ownerClosed) {
    const error = new Error(`capture child failure: ${JSON.stringify(result)}`);
    error.diagnostic = result;
    throw error;
  }
  return result;
}
