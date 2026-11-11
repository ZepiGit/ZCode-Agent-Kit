// Capture-only ownership, never a production process probe or kill target.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, fstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
function ownGroup() {
  if (process.platform === "win32") return null;
  if (process.platform === "linux") return Number(readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ")[2]);
  const probe = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8", timeout: 1000 });
  return probe.status === 0 ? Number(probe.stdout.trim()) : null;
}
// Fixture-only repositioning: keeper -> holder -> unchanged Node CLI -> Bun.
// This tests a held CLI output pipe, NOT Bun -> Node handle inheritance. The
// historical nested injector is retained in Git (a4d87f6), not claimed working
// on Windows. No exit/drain event is invented: exit comes from the actual CLI
// handle, and drain only from the actual holder output's close event.
if (process.argv[2] === "--pipe-holder") {
  const [command, args, cwd, input, fault, startId] = JSON.parse(process.argv[3]);
  const send = (event) => { if (process.connected) process.send({ ...event, startId }, () => {}); };
  let cli;
  const release = () => {
    // Keep the ownership chain intact for group/taskkill fallback if the
    // actual CLI has not exited. Never detach its still-running Bun subtree.
    if (!cli || cli.exitCode !== null || cli.signalCode !== null) process.disconnect();
  };
  process.on("disconnect", () => { if (cli && cli.exitCode === null && cli.signalCode === null) cli.kill("SIGKILL"); });
  process.on("message", (message) => {
    if (message === "release") release();
    if (message === "probe") {
      send({ type: "holder-live" });
      if (fault === "drain-release") release();
    }
    if (message !== "start" || cli) return;
    const env = { ...process.env, UX_CAPTURE_PIPE_BOUNDARY: "owned-holder" };
    cli = spawn(command, args, { cwd, env, stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
    cli.stdin.on("error", () => {});
    if (input !== null) cli.stdin.end(input);
    cli.once("spawn", () => send({ type: "spawn", pid: cli.pid }));
    cli.once("error", (error) => send({ type: "error", code: "CAPTURE_FAULT_SETUP", message: `CLI spawn: ${error.code}` }));
    cli.once("exit", (status, signal) => send({ type: "exit", status, signal }));
    cli.once("close", (status, signal) => send({ type: "cli-close", status, signal }));
  });
  // Both real handles must be open and both writes completed before readiness.
  fstatSync(1); fstatSync(2);
  process.stdout.on("error", () => {}); process.stderr.on("error", () => {});
  process.stdout.write(`UX_CAPTURE_HOLDER_STDOUT ${startId}\n`, (error) => {
    if (error) { send({ type: "error", code: "CAPTURE_FAULT_SETUP", message: "holder stdout write failed" }); return; }
    process.stderr.write(`UX_CAPTURE_PIPE_HOLDER pid=${process.pid} start=${startId}\n`, (error) => {
      if (error) { send({ type: "error", code: "CAPTURE_FAULT_SETUP", message: "holder stderr write failed" }); return; }
      if (fault !== "drain-ack-missing") send({ type: "holder-ready", pid: process.pid, stdoutWritten: true, stderrWritten: true });
    });
  });
}
if (process.argv[2] === "--keeper") {
  const [command, args, cwd, input, fault] = JSON.parse(process.argv[3]);
  const send = (event) => process.send?.(event);
  send({ type: "identity", pid: process.pid, pgid: ownGroup() });
  const held = Boolean(fault), startId = randomUUID();
  const child = held
    ? spawn(process.execPath, [fault === "drain-startup-failed" ? `${SELF}.missing` : SELF, "--pipe-holder",
      JSON.stringify([command, args, cwd, input, fault, startId])], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe", "ipc"], windowsHide: true })
    : spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let setup, ready = false, cliStatus = null, cliSignal = null, cliExited = false;
  const tell = (message) => { if (child.connected) child.send(message, () => {}); };
  const setupFailure = (message) => send({ type: "error", code: "CAPTURE_FAULT_SETUP", message });
  if (held) {
    child.once("spawn", () => send({ type: "holder-start", pid: child.pid, startId }));
    setup = setTimeout(() => { setupFailure("holder readiness ACK missing"); tell("release"); }, 1000);
    child.on("message", (message) => {
      if (message.startId !== startId) return;
      if (message.type === "holder-ready") {
        if (message.pid !== child.pid || message.stdoutWritten !== true || message.stderrWritten !== true) {
          setupFailure("incomplete holder readiness ACK"); return;
        }
        ready = true; clearTimeout(setup); send(message); tell("start");
      } else if (message.type === "exit") {
        cliStatus = message.status; cliSignal = message.signal; cliExited = true;
        send(message); tell("probe");
      } else send(message);
    });
    child.once("exit", (status, signal) => {
      clearTimeout(setup);
      send({ type: "holder-exit", status, signal, startId });
      if (!ready || !cliExited) setupFailure("holder exited before acknowledged CLI exit");
    });
  } else {
    child.once("spawn", () => send({ type: "spawn", pid: child.pid }));
    child.once("exit", (status, signal) => send({ type: "exit", status, signal }));
  }
  child.once("error", (error) => send({ type: "error", code: held ? "CAPTURE_FAULT_SETUP" : error.code, message: error.message }));
  child.stdin.on("error", () => {});
  if (!held && input !== null) child.stdin.end(input);
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.once("close", (status, signal) => {
    if (held) send({ type: "holder-close", status, signal, startId });
    process.stdout.write("", () => process.stderr.write("", () => send({ type: "drained", status: held ? cliStatus : status, signal: held ? cliSignal : signal })));
  });
  process.on("message", (message) => {
    if (message === "release") process.disconnect();
    if (message === "release-holder") tell("release");
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
  const fault = phase === "health-cli" && /^(drain|early-exit-drain)/.test(env?.UX_CAPTURE_FAULT ?? "") ? env.UX_CAPTURE_FAULT : null;
  const keeper = spawn(process.execPath, [SELF, "--keeper", JSON.stringify([command, args, cwd, input, fault])], {
    cwd, env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const result = { phase, pid: null, ownerPid: keeper.pid ?? null, pgid: null, groupVerified: false,
    status: null, signal: null, error: null, exited: false, drained: false, ownerClosed: false, stdout: "", stderr: "" };
  if (fault) result.holder = { pid: null, startId: null, ready: false, liveAfterCliExit: false, exited: false, closed: false, status: null, signal: null };
  let deadline, drain, finish, stopping, closed, holderClosed;
  const holderClose = new Promise((resolve) => { holderClosed = resolve; });
  const done = new Promise((resolve) => { finish = resolve; });
  const ownerClose = new Promise((resolve) => { closed = resolve; });
  const event = (type) => {
    if (fault) result.events = `${result.events ?? ""}${type},`.slice(-2000);
    onEvent({ type, phase, pid: result.pid, ownerPid: result.ownerPid, pgid: result.pgid, groupVerified: result.groupVerified });
  };
  const fail = (code, message) => { result.error ??= { code, message }; };
  const remaining = (limit) => Math.max(1, Math.min(limit, hardDeadline - cleanupMs - performance.now()));
  const send = (message) => { if (keeper.connected) keeper.send(message, () => {}); };
  const stop = () => (stopping ??= (async () => {
    clearTimeout(deadline); clearTimeout(drain);
    const until = Math.min(hardDeadline, performance.now() + cleanupMs);
    const left = (limit) => Math.max(1, Math.min(limit, until - performance.now()));
    event("cleanup-start");
    if (fault && keeper.connected) {
      send("release-holder");
      await Promise.race([holderClose, sleep(left(cleanupMs / 2))]);
      if (!result.holder.closed) result.cleanupError = "HOLDER_CLOSE_TIMEOUT";
      if (result.holder.closed) {
        send("release");
        await Promise.race([ownerClose, sleep(left(cleanupMs / 2))]);
      }
    }
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
    if (fault && message.type.startsWith("holder-")) {
      const holder = result.holder;
      if (message.type === "holder-start") { holder.pid = message.pid; holder.startId = message.startId; }
      if (message.startId !== holder.startId) return;
      if (message.type === "holder-ready") {
        holder.ready = message.pid === holder.pid && message.stdoutWritten === true && message.stderrWritten === true;
      }
      if (message.type === "holder-live") {
        holder.liveAfterCliExit = result.exited && !holder.exited;
        holder.pipeOpenAfterCliExit = holder.liveAfterCliExit && !result.drained;
      }
      if (message.type === "holder-exit") { holder.exited = true; holder.status = message.status; holder.signal = message.signal; }
      if (message.type === "holder-close") { holder.closed = true; holderClosed(); }
      event(message.type);
    }
    if (message.type === "identity") {
      result.pgid = message.pgid;
      result.groupVerified = process.platform !== "win32" && message.pid === keeper.pid && message.pgid === keeper.pid && message.pgid !== ownGroup();
      event("identity");
    }
    if (message.type === "spawn") { result.pid = message.pid; event("spawn"); }
    if (message.type === "cli-close") { result.cliClosed = true; event("cli-close"); }
    if (message.type === "error") { fail(message.code, message.message); void stop(); }
    if (message.type === "exit") {
      result.exited = true; result.status = message.status; result.signal = message.signal; event("exit");
      if (message.status !== 0) fail("CAPTURE_EXIT", "command exited unsuccessfully");
      clearTimeout(deadline);
      drain = setTimeout(() => {
        if (fault) result.drainObservation = { exited: result.exited, drained: result.drained,
          holderLive: result.holder.liveAfterCliExit && !result.holder.exited, status: result.status, signal: result.signal };
        fail("CAPTURE_DRAIN_TIMEOUT", "command exited but output pipes did not drain"); void stop();
      }, remaining(drainMs));
    }
    if (message.type === "drained") {
      result.drained = true;
      if (!fault || result.exited) { result.status = message.status; result.signal = message.signal; }
      event("drained");
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
