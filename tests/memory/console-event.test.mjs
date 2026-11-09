// Unit tests for the windows S4 console-event trial helpers (ticket 81, Owner
// Proxy round 33). The delivery itself is Windows-only and proven per run on
// the windows-latest leg (trial 0 self-test); these tests pin everything that
// is checkable everywhere: the scripts' in-box-tooling and safety contract
// (kernel32 only, CTRL_BREAK to the child's own group, never group 0, never
// CTRL_C_EVENT, no network), the output parsers, the proof search, the
// delivery judgement (including the trial-0 self-test and the mutant path),
// the labels of round 33 condition 4d, and the pid-tracked reaping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELIVERY_LABELS, EVENT_EXIT_CODE, findReleaseLine, judgeWindowsTrial, parseSenderOut, parseSpawnerOut, reapAll, senderScript, spawnerScript, waitForPidLine } from "./lib/win-console-event.mjs";

const CHILD_PID = 4242;

test("sender script: CTRL_BREAK_EVENT to the child's own group, never group 0, never CTRL_C_EVENT", () => {
  const s = senderScript(CHILD_PID);
  // CTRL_BREAK_EVENT = 1 aimed at the child's pid (the CREATE_NEW_PROCESS_GROUP group id).
  assert.match(s, /GenerateConsoleCtrlEvent\(\[uint32\]1, \[uint32\]4242\)/);
  // A zero group id signals every process on the console (B4): forbidden.
  assert.doesNotMatch(s, /GenerateConsoleCtrlEvent\(\[uint32\]0/);
  // CTRL_C_EVENT = 0 cannot be aimed at a group: forbidden as the event argument.
  assert.match(s, /FreeConsole\(\)/, "the sender must detach from its own console first");
  assert.match(s, /AttachConsole\(\[uint32\]4242\)/, "the sender shares the child's console");
});

test("sender script: refuses a non-positive pid (a zero group id can never be minted)", () => {
  assert.throws(() => senderScript(0), /bad child pid/);
  assert.throws(() => senderScript(-1), /bad child pid/);
});

test("spawner script: creates the child with CREATE_NEW_PROCESS_GROUP (0x200) and quotes the command line", () => {
  const s = spawnerScript("C:\\Program Files\\nodejs\\node.exe", ["C:\\kit dir\\proxy\\zcode-proxy-manager.mjs", "start"]);
  assert.match(s, /\[uint32\]0x200/, "CREATE_NEW_PROCESS_GROUP");
  assert.match(s, /@"C:\\Program Files\\nodejs\\node\.exe" "C:\\kit dir\\proxy\\zcode-proxy-manager\.mjs" "start"/);
  assert.match(s, /__K81__PID/, "prints the child pid before waiting");
  assert.match(s, /__K81__EXIT/, "prints the child's unsigned exit code");
  assert.match(s, /WaitForSingleObject/, "waits for the child so the pid cannot be judged a stranger");
  assert.doesNotMatch(s, /DETACHED/, "a detached child has no console to share");
});

test("spawner script: refuses arguments the command line could not carry safely", () => {
  assert.throws(() => spawnerScript("node.exe", ['a"b']), /needs quoting/);
  assert.throws(() => spawnerScript("node.exe", ["a\nb"]), /bad child args/);
});

test("helper scripts use in-box tooling only: kernel32, no network, no external binaries", () => {
  for (const [name, s] of [["spawner", spawnerScript("node.exe", ["start"])], ["sender", senderScript(CHILD_PID)]]) {
    assert.match(s, /kernel32\.dll/, `${name}: P/Invoke target`);
    for (const forbidden of [/Invoke-WebRequest/i, /Invoke-RestMethod/i, /Net\.WebClient/i, /Start-BitsTransfer/i, /wininet/i, /winhttp/i, /ws2_32/i, /\bcurl\b/i, /\bnpx\b/i, /\bnpm\b/i]) {
      assert.doesNotMatch(s, forbidden, `${name}: no network or package tooling`);
    }
    assert.match(s, /Add-Type -TypeDefinition/, `${name}: in-box Add-Type`);
  }
});

test("spawner output parser: pid, exit code and create failure", () => {
  assert.deepEqual(parseSpawnerOut("__K81__PID 4242__K81__EXIT 3221225786"), { childPid: 4242, childExitCode: 3221225786, createError: null });
  assert.deepEqual(parseSpawnerOut("__K81__CREATEFAIL 87"), { childPid: null, childExitCode: null, createError: 87 });
  assert.deepEqual(parseSpawnerOut(""), { childPid: null, childExitCode: null, createError: null });
});

test("sender output parser: sent, attach/send failures and silence", () => {
  assert.deepEqual(parseSenderOut("__K81__SENT"), { sent: true, error: null });
  assert.equal(parseSenderOut("__K81__ATTACHFAIL 87").sent, false);
  assert.match(parseSenderOut("__K81__ATTACHFAIL 87").error, /AttachConsole win32 error 87/);
  assert.match(parseSenderOut("__K81__SENDFAIL 5").error, /GenerateConsoleCtrlEvent win32 error 5/);
  assert.match(parseSenderOut("").error, /no output/);
});

test("judge: a release line proves delivery (round 33 condition 4c)", () => {
  for (const sender of [{ sent: true, timedOut: false }, { sent: false, timedOut: false, error: "x" }]) {
    const j = judgeWindowsTrial({ first: true, sender, childExitCode: 0, releaseLine: { file: "proxy.log", line: "x" } });
    assert.equal(j.delivered, true);
    assert.equal(j.proofVia, "release-line");
    assert.equal(j.failure, undefined);
  }
});

test("judge: the event exit code (0xC000013A) proves delivery without a line — the round-33 mutant shows stale locks instead of a harness failure", () => {
  const j = judgeWindowsTrial({ first: true, sender: { sent: true, timedOut: false, error: null }, childExitCode: EVENT_EXIT_CODE, releaseLine: null });
  assert.equal(j.delivered, true);
  assert.equal(j.proofVia, "event-exit");
  assert.equal(j.failure, undefined);
});

test("judge: event generated but the child exited 0 — trial 0 is a harness failure, later trials record the completed start", () => {
  const first = judgeWindowsTrial({ first: true, sender: { sent: true, timedOut: false, error: null }, childExitCode: 0, releaseLine: null });
  assert.match(first.failure, /self-test/);
  assert.match(first.failure, /never reached the child's handler/);
  const later = judgeWindowsTrial({ first: false, sender: { sent: true, timedOut: false, error: null }, childExitCode: 0, releaseLine: null });
  assert.equal(later.delivered, false);
  assert.match(later.reason, /start completed/);
});

test("judge: an unexplained exit after a generated event is a harness failure on every trial", () => {
  for (const first of [true, false]) {
    const j = judgeWindowsTrial({ first, sender: { sent: true, timedOut: false, error: null }, childExitCode: 1, releaseLine: null });
    assert.match(j.failure, /exited 0x1 with no release line/);
  }
});

test("judge: a sender that never delivered — self-test fails, later trials record why", () => {
  const sender = { sent: false, timedOut: false, error: "AttachConsole win32 error 87" };
  assert.match(judgeWindowsTrial({ first: true, sender, childExitCode: 0, releaseLine: null }).failure, /self-test/);
  const completed = judgeWindowsTrial({ first: false, sender, childExitCode: 0, releaseLine: null });
  assert.equal(completed.delivered, false);
  assert.match(completed.reason, /did not deliver.*AttachConsole/);
  const exited = judgeWindowsTrial({ first: false, sender, childExitCode: 3221225786, releaseLine: null });
  assert.match(exited.reason, /exited 0xc000013a/);
});

test("judge: a timed-out sender is a harness failure", () => {
  const j = judgeWindowsTrial({ first: false, sender: { sent: false, timedOut: true, error: null }, childExitCode: 0, releaseLine: null });
  assert.match(j.failure, /timed out/);
});

test("labels of round 33 condition 4d, verbatim", () => {
  assert.equal(DELIVERY_LABELS.linux, "SIGINT (kill)");
  assert.equal(DELIVERY_LABELS.windows, "CTRL_BREAK_EVENT (console event, own process group)");
});

test("findReleaseLine: the child's own line, its rotation, pid mismatches and stale timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "k81-release-"));
  try {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(join(dir, "proxy.log.1"), `${old} INFO manager start lock released on signal signal=SIGBREAK pid=99 path=C:\\x\\manager.lock\n`);
    writeFileSync(join(dir, "proxy.log"), [
      `${old} INFO manager start lock released on signal signal=SIGBREAK pid=${CHILD_PID} path=C:\\x\\manager.lock`,
      `${now} INFO manager start lock released on signal signal=SIGBREAK pid=${CHILD_PID} path=C:\\x\\manager.lock`,
      `${now} INFO manager start lock released on signal signal=SIGINT pid=${CHILD_PID} path=C:\\x\\manager.lock`,
      `${now} INFO manager other event pid=${CHILD_PID}`,
    ].join("\n") + "\n");
    const found = findReleaseLine(dir, CHILD_PID, { notBeforeMs: Date.now() });
    assert.match(found.line, new RegExp(`^\\S+ INFO manager start lock released on signal signal=SIGBREAK pid=${CHILD_PID} path=.*manager\\.lock$`));
    assert.equal(found.file, "proxy.log");
    // A pid the kit never recorded is not a proof.
    assert.equal(findReleaseLine(dir, 7654321, { notBeforeMs: Date.now() }), null);
    // Only SIGBREAK proves this trial's delivery, and a line older than the trial does not.
    assert.equal(findReleaseLine(dir, 99, { notBeforeMs: Date.now() }), null, "the rotated line is too old for this trial");
    // The rotated file is searched too.
    assert.equal(findReleaseLine(dir, 99, { notBeforeMs: 0 }).file, "proxy.log.1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("waitForPidLine reads the live spawner output and falls back to its exit", async () => {
  const live = { state: { out: () => "noise__K81__PID 4242" }, done: new Promise(() => {}) };
  assert.equal((await waitForPidLine(live)).childPid, 4242);
  const exited = { state: { out: () => "" }, done: Promise.resolve({ code: 1, out: "__K81__CREATEFAIL 87", timedOut: false }) };
  assert.equal((await waitForPidLine(exited, { timeoutMs: 50 })).createError, 87);
  const never = { state: { out: () => "" }, done: new Promise(() => {}) };
  assert.equal((await waitForPidLine(never, { timeoutMs: 30 })).childPid, null);
});

test("reapAll: ends a process this test started and ignores pids it cannot act on", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 150));
  const reaped = reapAll([child.pid, 0, -1, 999999999]);
  assert.deepEqual(reaped.pids, [child.pid]);
  const exited = await new Promise((r) => { const t = setTimeout(r, 3000); child.once("exit", () => { clearTimeout(t); r(true); }); });
  assert.equal(exited, true, "the reaped process ended");
});
