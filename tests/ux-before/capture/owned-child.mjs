// Capture-only process ownership. The keeper stays alive until release, so
// Windows tree termination never names a PID whose exit we already observed.
// POSIX uses the keeper's private process group. No production process probes.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
if (process.argv[2] === "--keeper") {
  const [command, args, cwd, input] = JSON.parse(process.argv[3]);
  const child = spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const send = (event) => process.send?.(event);
  child.once("spawn", () => send({ type: "spawn", pid: child.pid }));
  child.once("error", (error) => send({ type: "error", code: error.code, message: error.message }));
  child.stdin.on("error", () => {});
  if (input !== null) child.stdin.end(input);
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.once("exit", (status, signal) => send({ type: "exit", status, signal }));
  child.once("close", (status, signal) => {
    // A close is not yet a forwarding-drain acknowledgement.
    process.stdout.write("", () => process.stderr.write("", () => send({ type: "drained", status, signal })));
  });
  process.on("message", (message) => {
    if (message === "release") process.disconnect();
    if (message === "eof") child.stdin.end();
    if (message === "terminate" && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  });
  // Keep the ownership root alive even if the command exits before its pipes.
  // Parent disconnect without release is not success; terminate our own child.
  process.on("disconnect", () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
}

const tail = (text, chunk) => (text + chunk).slice(-16384);
export function startOwned(command, args, { cwd, env, input = "", phase, timeoutMs = 5000, drainMs = 1000, cleanupMs = 2000, onEvent = () => {} } = {}) {
  const keeper = spawn(process.execPath, [SELF, "--keeper", JSON.stringify([command, args, cwd, input])], {
    cwd, env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const result = { phase, pid: null, ownerPid: keeper.pid ?? null, pgid: process.platform === "win32" ? null : keeper.pid ?? null,
    status: null, signal: null, error: null, exited: false, drained: false, ownerClosed: false, stdout: "", stderr: "" };
  let deadline, drain, finish, stopping;
  const done = new Promise((resolve) => { finish = resolve; });
  const event = (type) => onEvent({ type, phase, pid: result.pid, ownerPid: result.ownerPid, pgid: result.pgid });
  const fail = (code, message) => { result.error ??= { code, message }; };
  const stop = () => (stopping ??= (async () => {
    clearTimeout(deadline); clearTimeout(drain);
    event("cleanup-start");
    // Allow a capture controller to close its separately-owned fixture groups
    // before the final tree kill. This is a finite exit acknowledgement wait.
    if (phase === "raw-health-capture" && keeper.connected) {
      keeper.send("terminate");
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, cleanupMs))]);
    }
    // This exact live keeper is our spawn handle, and cannot release itself.
    if (keeper.exitCode === null && keeper.signalCode === null) {
      if (process.platform === "win32") {
        await new Promise((resolve) => {
          const killer = spawn("taskkill", ["/PID", String(keeper.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          const timer = setTimeout(() => { killer.kill(); resolve(); }, cleanupMs / 2);
          killer.once("error", () => { clearTimeout(timer); resolve(); });
          killer.once("close", () => { clearTimeout(timer); resolve(); });
        });
      } else {
        try { process.kill(-keeper.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") result.cleanupError = error.code; }
      }
    }
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, cleanupMs).unref())]);
    if (!result.ownerClosed) {
      result.cleanupError ??= "OWNER_CLOSE_TIMEOUT";
      keeper.stdout.destroy(); keeper.stderr.destroy();
      if (keeper.connected) keeper.disconnect();
      keeper.unref();
      finish(result);
    }
    event("cleanup-done");
    return result;
  })());
  keeper.stdout.setEncoding("utf8").on("data", (chunk) => { result.stdout = tail(result.stdout, chunk); });
  keeper.stderr.setEncoding("utf8").on("data", (chunk) => { result.stderr = tail(result.stderr, chunk); });
  keeper.on("message", (message) => {
    if (message.type === "spawn") { result.pid = message.pid; event("spawn"); }
    if (message.type === "error") { fail(message.code, message.message); void stop(); }
    if (message.type === "exit") {
      result.exited = true; result.status = message.status; result.signal = message.signal; event("exit");
      if (message.status !== 0) fail("CAPTURE_EXIT", "command exited unsuccessfully");
      clearTimeout(deadline);
      drain = setTimeout(() => { fail("CAPTURE_DRAIN_TIMEOUT", "command exited but output pipes did not drain"); void stop(); }, drainMs);
    }
    if (message.type === "drained") {
      result.drained = true; result.status = message.status; result.signal = message.signal; event("drained");
      clearTimeout(deadline); clearTimeout(drain);
      if (message.status !== 0) fail("CAPTURE_EXIT", "command exited unsuccessfully");
      // On failure kill descendants before releasing the still-live owner.
      if (result.error) void stop();
      else { keeper.send("release"); deadline = setTimeout(() => { fail("CAPTURE_RELEASE_TIMEOUT", "owner did not close after drain"); void stop(); }, drainMs); }
    }
  });
  keeper.once("error", (error) => { fail(error.code, error.message); void stop(); });
  keeper.once("close", (status, signal) => {
    clearTimeout(deadline); clearTimeout(drain);
    result.ownerClosed = true; result.ownerStatus = status; result.ownerSignal = signal;
    if (!result.drained && !result.error) fail("CAPTURE_OWNER_EXIT", "owner exited without a drain acknowledgement");
    event("owner-close"); finish(result);
  });
  deadline = setTimeout(() => { fail("CAPTURE_TIMEOUT", "command did not exit before its deadline"); void stop(); }, timeoutMs);
  return { result, done, stop, eof() { if (keeper.connected) keeper.send("eof"); } };
}

export async function runOwned(command, args, options) {
  const owned = startOwned(command, args, options);
  return owned.done;
}
export function requireSuccess(result) {
  if (result.error || result.status !== 0 || !result.drained || !result.ownerClosed) {
    const error = new Error(`capture child failure: ${JSON.stringify(result)}`);
    error.diagnostic = result;
    throw error;
  }
  return result;
}
