/**
 * Harness restart budget (ticket 57, Owner Proxy round 12 Q1 stage 2), at the
 * bridge's MCP seam against the fake harness. The runtime respawns the
 * harness lazily on the next call; a budget (3 restarts per 15 min by
 * default, the proxy manager's shape) with backoff bounds those respawns, so
 * a harness that keeps exiting can no longer be restarted at the client's
 * call rate. The fixture's spawn log (FAKE_SPAWN_LOG) counts the children.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBridge } from "./client.mjs";
import { parseConfig } from "../../dist/config.js";

const EVENT_LINE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (DEBUG|INFO|WARN|ERROR) [A-Za-z0-9_.-]+ /;

function spawnLogFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zh-spawns-")), "spawns.jsonl");
}

function spawnsIn(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.event === "start").length;
}

/** One task whose prompt makes the harness exit; resolves with its terminal record. */
async function crashingTask(c, i) {
  const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: `exit ${i}`, readOnly: true });
  return c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 30_000 });
}

test("a harness that exits on every prompt is restarted at most 3 times; later calls fail with what, why and the next step", async () => {
  const spawnLog = spawnLogFile();
  const stderr = [];
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog }, collectStderr: stderr });
  try {
    const states = [];
    for (let i = 0; i < 6; i++) states.push(await crashingTask(c, i));
    // The first start plus 3 restarts; the 5th and 6th task never reach a harness.
    assert.equal(spawnsIn(spawnLog), 4, JSON.stringify(states.map((s) => [s.state, s.error])));
    assert.deepEqual(states.map((s) => s.state), ["interrupted", "interrupted", "interrupted", "interrupted", "failed", "failed"]);
    for (const s of states.slice(4)) assert.match(s.error, /^HARNESS_RESTART_BUDGET_EXHAUSTED: /);

    // A direct harness-bound tool call fails in the existing tool-error shape.
    const text = await c.expectToolError("zcode_models_list", { workspacePath: c.workspaceDir });
    assert.match(text, /^HARNESS_RESTART_BUDGET_EXHAUSTED: /);
    assert.match(text, /restarted 3 times in the last 15 min/, "what happened");
    assert.match(text, /exited again \(code=7, signal=null\)/, "why: the harness keeps exiting");
    assert.match(text, /restart budget 3 per 15 min, ZCODE_HARNESS_RESTART_BUDGET/, "why: the budget that refused it");
    assert.match(text, /Next: /, "the exact next step");
    assert.match(text, /zcode_health and check runtime\.restartBudget\.lastExit/);
    assert.equal(spawnsIn(spawnLog), 4, "a refused call spawns nothing");

    // The recorded state is visible in zcode_health (additive field).
    const health = await c.tool("zcode_health", {});
    const budget = health.runtime.restartBudget;
    assert.equal(budget.limit, 3);
    assert.equal(budget.windowSec, 900);
    assert.equal(budget.used, 3);
    assert.equal(budget.exhausted, true);
    assert.ok(Date.parse(budget.retryAt) > Date.now() + 14 * 60_000, budget.retryAt);
    assert.equal(health.runtime.running, false);
    assert.equal(budget.lastExit.code, 7);
    assert.equal(budget.lastExit.signal, null);
    assert.ok(Date.parse(budget.lastExit.at) <= Date.now());
  } finally {
    await c.stop();
  }
  // New log events are event lines: one WARN per restart, one ERROR when the budget runs out.
  const lines = stderr.join("").split("\n").filter((l) => / runtime harness /.test(l));
  for (const line of lines) assert.match(line, EVENT_LINE, line);
  assert.equal(lines.filter((l) => / WARN runtime harness restart /.test(l)).length, 3, lines.join("\n"));
  const exhausted = lines.filter((l) => / ERROR runtime harness restart budget exhausted /.test(l));
  assert.equal(exhausted.length, 1, "logged once, not on every refused call");
  assert.match(exhausted[0], / restarts=3 windowSec=900 retryAt=\S+Z lastExitCode=7/);
});

test("restarts back off: the 1st, 2nd and 3rd restart wait ≥ 1, 2 and 4 s after the exit", async () => {
  const spawnLog = spawnLogFile();
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog } });
  try {
    for (let i = 0; i < 4; i++) await crashingTask(c, i);
  } finally {
    await c.stop();
  }
  const records = fs.readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const starts = records.filter((r) => r.event === "start");
  const exits = records.filter((r) => r.event === "exit");
  assert.equal(starts.length, 4);
  // Each restart starts no earlier than its backoff after the previous child's exit
  // (a 50 ms tolerance for the exit line, written just before the process ends).
  const waits = starts.slice(1).map((s, i) => s.t - exits[i].t);
  for (const [i, min] of [1000, 2000, 4000].entries()) assert.ok(waits[i] >= min - 50, `restart ${i + 1} waited ${waits[i]} ms`);
});

test("concurrent calls after an exit share one restart: one child, one budget slot", async () => {
  const spawnLog = spawnLogFile();
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog } });
  try {
    await crashingTask(c, 0);
    assert.equal(spawnsIn(spawnLog), 1);
    const results = await Promise.all(Array.from({ length: 6 }, () => c.tool("zcode_models_list", { workspacePath: c.workspaceDir })));
    for (const r of results) assert.ok(r.modelCatalog.available.length >= 2);
    assert.equal(spawnsIn(spawnLog), 2, "six concurrent calls, one restart");
    const health = await c.tool("zcode_health", {});
    assert.equal(health.runtime.restartBudget.used, 1);
    assert.equal(health.runtime.running, true);
  } finally {
    await c.stop();
  }
});

test("with the budget exhausted, a burst of concurrent calls spawns nothing and every call gets the budget error", async () => {
  const spawnLog = spawnLogFile();
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog, ZCODE_HARNESS_RESTART_BUDGET: "1/900" } });
  try {
    await crashingTask(c, 0);
    await crashingTask(c, 1);
    assert.equal(spawnsIn(spawnLog), 2);
    const texts = await Promise.all(Array.from({ length: 8 }, () => c.expectToolError("zcode_models_list", { workspacePath: c.workspaceDir })));
    for (const t of texts) assert.match(t, /^HARNESS_RESTART_BUDGET_EXHAUSTED: .*restarted 1 time in the last 15 min/);
    assert.equal(spawnsIn(spawnLog), 2);
  } finally {
    await c.stop();
  }
});

test("a bridge stopped while a restart waits out its backoff exits without starting a harness", async () => {
  const spawnLog = spawnLogFile();
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog } });
  await crashingTask(c, 0);
  assert.equal(spawnsIn(spawnLog), 1);
  // This call reserves the first restart and waits its 1 s backoff; the client leaves meanwhile.
  const pending = c.call("tools/call", { name: "zcode_models_list", arguments: { workspacePath: c.workspaceDir } }).catch(() => null);
  await new Promise((r) => setTimeout(r, 200));
  const stoppedAt = Date.now();
  await c.stop();
  await pending;
  assert.ok(c.child.exitCode !== null || c.child.signalCode !== null, "the bridge exited");
  assert.ok(Date.now() - stoppedAt < 4000, "the backoff did not hold the bridge open");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(spawnsIn(spawnLog), 1, "no harness started after the stop");
});

test("a restart slot comes back when its window has passed", async () => {
  const spawnLog = spawnLogFile();
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog, ZCODE_HARNESS_RESTART_BUDGET: "1/3" } });
  try {
    await crashingTask(c, 0);
    await crashingTask(c, 1); // the one restart (after a 1 s backoff)
    const refused = await c.expectToolError("zcode_models_list", { workspacePath: c.workspaceDir });
    assert.match(refused, /restarted 1 time in the last 3 s/);
    const { restartBudget } = (await c.tool("zcode_health", {})).runtime;
    const wait = Date.parse(restartBudget.retryAt) - Date.now();
    assert.ok(wait > 0 && wait <= 3000, `retryAt ${restartBudget.retryAt}`);
    await new Promise((r) => setTimeout(r, wait + 100));
    const models = await c.tool("zcode_models_list", { workspacePath: c.workspaceDir });
    assert.ok(models.modelCatalog.available.length >= 2);
    assert.equal(spawnsIn(spawnLog), 3);
  } finally {
    await c.stop();
  }
});

test("ZCODE_HARNESS_RESTART_BUDGET is optional, <restarts>/<window seconds>, and an invalid value refuses to start", () => {
  const saved = process.env.ZCODE_HARNESS_RESTART_BUDGET;
  try {
    delete process.env.ZCODE_HARNESS_RESTART_BUDGET;
    assert.deepEqual(parseConfig([]).restartBudget, { limit: 3, windowSec: 900 });
    process.env.ZCODE_HARNESS_RESTART_BUDGET = "5/60";
    assert.deepEqual(parseConfig([]).restartBudget, { limit: 5, windowSec: 60 });
    process.env.ZCODE_HARNESS_RESTART_BUDGET = " 2 / 30 ";
    assert.deepEqual(parseConfig([]).restartBudget, { limit: 2, windowSec: 30 });
    // 0 restarts is a valid budget: the harness is never restarted.
    process.env.ZCODE_HARNESS_RESTART_BUDGET = "0/900";
    assert.deepEqual(parseConfig([]).restartBudget, { limit: 0, windowSec: 900 });
    for (const bad of ["", "3", "3/0", "-1/900", "a/b", "3/15m", "1.5/900", "3/900/1", "99999999999999999999/1"]) {
      process.env.ZCODE_HARNESS_RESTART_BUDGET = bad;
      assert.throws(() => parseConfig([]), /invalid ZCODE_HARNESS_RESTART_BUDGET/, JSON.stringify(bad));
    }
  } finally {
    if (saved === undefined) delete process.env.ZCODE_HARNESS_RESTART_BUDGET;
    else process.env.ZCODE_HARNESS_RESTART_BUDGET = saved;
  }
});
