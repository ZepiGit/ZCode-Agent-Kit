/**
 * Several bridge processes on one data directory (the default: every
 * assistant session starts its own bridge on ~/.zcode-harness-mcp).
 *
 *  - A bridge stamps the records it writes with its process. A starting
 *    bridge leaves a running task of another live bridge alone: it neither
 *    marks it interrupted nor loads it. When that bridge is gone, the next
 *    start interrupts the leftover record as before.
 *  - Retention never deletes the files of a task whose stamp names another
 *    live process, at a start or at run time.
 *  - A task whose stored files were removed is answered as expired, not as a
 *    completed task with an empty result, and a result file left without its
 *    record is swept at a later start.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBridge } from "./client.mjs";

const HOUR = 60 * 60 * 1000;

function freshDataDir(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-shared-store-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "ws"), { recursive: true });
  return dataDir;
}

const taskPath = (dataDir, id, suffix = ".json") => path.join(dataDir, "tasks", `${id}${suffix}`);
const taskFiles = (dataDir, id) => fs.readdirSync(path.join(dataDir, "tasks")).filter((f) => f.startsWith(`${id}.`)).sort();
const seedId = (i) => `task-seed-${String(i).padStart(4, "0")}`;

/** A task as a bridge left it on disk: record, cached result and events. */
function seedTask(dataDir, { id, state = "completed", finishedAt, owner }) {
  const workspacePath = path.join(dataDir, "ws");
  const createdAt = new Date(Date.parse(finishedAt) - 5000).toISOString();
  const terminal = state !== "running";
  const rec = {
    schemaVersion: 1, taskId: id, idempotencyKey: null, workspacePath, workspaceKey: workspacePath,
    sessionId: `sess_${id}`, sessionOwnedByTask: true, prompt: `seeded ${id}`, state, readOnly: true, mode: null,
    requestedModel: null, effectiveModel: { providerId: "fake", modelId: "FAKE-Main" }, thoughtLevel: null, selectionVerified: true,
    createdAt, startedAt: createdAt, finishedAt: terminal ? finishedAt : null, lastSeq: 3, followUpCount: 0, error: null, usage: null,
    fileChanges: { added: [], modified: [], deleted: [], source: "none", preExistingUncommitted: [] }, interruptionReason: null,
    ...(owner ? { owner } : {}),
  };
  fs.writeFileSync(taskPath(dataDir, id), JSON.stringify(rec, null, 2));
  if (terminal) fs.writeFileSync(taskPath(dataDir, id, ".result.json"), JSON.stringify({ schemaVersion: 1, taskId: id, status: state, finishedAt, responseText: `stored ${id}` }, null, 2));
  fs.writeFileSync(taskPath(dataDir, id, ".events.jsonl"), JSON.stringify({ seq: 1, ts: createdAt, type: "turn.started", payload: {}, origin: "harness" }) + "\n");
}

/** This test process: alive for the whole test, and not a bridge. */
const LIVE_OWNER = { pid: process.pid, startedAt: new Date(Date.now() - 60_000).toISOString() };
/** A process that has exited. */
function deadOwner() {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0);
  return { pid: child.pid, startedAt: new Date(Date.now() - 60_000).toISOString() };
}

const bridgeOn = (dataDir, extra = {}) => startBridge({ reuseDataDir: dataDir, workspaceDirOverride: path.join(dataDir, "ws"), ...extra });

async function runTask(c, prompt) {
  const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt, readOnly: true });
  const done = await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 30_000 });
  assert.equal(done.state, "completed");
  return task.taskId;
}

async function until(what, predicate, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(what);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("a second bridge neither interrupts nor loads the first one's running task; once the first is gone, the next start interrupts it", async (t) => {
  const dataDir = freshDataDir(t);
  const a = await bridgeOn(dataDir, { env: { FAKE_HANG_PROMPT: "hang" } });
  let b = null, c = null;
  t.after(async () => { for (const x of [a, b, c]) if (x) await x.stop().catch(() => {}); });

  const finished = await runTask(a, "quick");
  const running = (await a.tool("zcode_task_start", { workspacePath: a.workspaceDir, prompt: "please hang", readOnly: true })).taskId;
  await until("the task runs in the first bridge", async () => (await a.tool("zcode_task_get", { taskId: running })).state === "running");
  const onDisk = () => fs.readFileSync(taskPath(dataDir, running), "utf8");
  const before = onDisk();
  assert.deepEqual(JSON.parse(before).owner.pid, a.child.pid, "the record names the bridge that runs the task");
  assert.equal(JSON.parse(fs.readFileSync(taskPath(dataDir, finished), "utf8")).owner.pid, a.child.pid, "a finished task keeps the stamp of the bridge that finished it");

  b = await bridgeOn(dataDir);
  assert.equal(onDisk(), before, "the second bridge left the running record untouched");
  assert.equal(await b.expectToolError("zcode_task_get", { taskId: running }), `unknown task: ${running}`, "it is not the second bridge's task");
  assert.equal((await b.tool("zcode_tasks_list", {})).tasks.some((x) => x.taskId === running), false);
  assert.equal((await b.tool("zcode_task_get", { taskId: finished })).state, "completed", "finished tasks are still visible to every bridge");
  assert.equal((await a.tool("zcode_task_get", { taskId: running })).state, "running", "the first bridge still runs it");
  await runTask(b, "second bridge works");
  assert.equal(onDisk(), before);

  // The first bridge dies without a chance to mark its task (a crash, not a shutdown).
  const gone = new Promise((r) => a.child.once("exit", r));
  a.child.kill("SIGKILL");
  await gone;
  assert.equal(JSON.parse(onDisk()).state, "running", "the leftover record still says running");

  c = await bridgeOn(dataDir);
  const leftover = await c.tool("zcode_task_get", { taskId: running });
  assert.equal(leftover.state, "interrupted");
  assert.match(leftover.interruptionReason, /bridge restart/);
  assert.equal(JSON.parse(onDisk()).state, "interrupted");
  assert.equal(JSON.parse(onDisk()).owner.pid, c.child.pid, "the record now names the bridge that interrupted it");
});

test("a running record whose owner is alive but which was not written for more than 25 hours is interrupted (a reused pid cannot keep it running)", async (t) => {
  const dataDir = freshDataDir(t);
  const now = Date.now();
  seedTask(dataDir, { id: "task-fresh-run", state: "running", finishedAt: new Date(now - 60_000).toISOString(), owner: LIVE_OWNER });
  seedTask(dataDir, { id: "task-stale-run", state: "running", finishedAt: new Date(now - 30 * HOUR).toISOString(), owner: LIVE_OWNER });
  seedTask(dataDir, { id: "task-dead-run", state: "running", finishedAt: new Date(now - 60_000).toISOString(), owner: deadOwner() });
  seedTask(dataDir, { id: "task-plain-run", state: "running", finishedAt: new Date(now - 60_000).toISOString() });
  const stale = new Date(now - 26 * HOUR);
  fs.utimesSync(taskPath(dataDir, "task-stale-run"), stale, stale);
  const fresh = fs.readFileSync(taskPath(dataDir, "task-fresh-run"), "utf8");
  const c = await bridgeOn(dataDir);
  try {
    assert.equal(await c.expectToolError("zcode_task_get", { taskId: "task-fresh-run" }), "unknown task: task-fresh-run");
    assert.equal(fs.readFileSync(taskPath(dataDir, "task-fresh-run"), "utf8"), fresh);
    for (const id of ["task-stale-run", "task-dead-run", "task-plain-run"]) {
      assert.equal((await c.tool("zcode_task_get", { taskId: id })).state, "interrupted", id);
    }
  } finally {
    await c.stop();
  }
});

test("retention never deletes the files of a task stamped by another live process, at a start or at run time; a dead owner's tasks go like any other", async (t) => {
  const dataDir = freshDataDir(t);
  const newest = Date.now() - HOUR;
  const dead = deadOwner();
  // seed-0000 the oldest. 0000–0009 belong to a live process, 0010–0012 to a dead one, the other 500 to nobody.
  for (let i = 0; i < 513; i++) {
    seedTask(dataDir, { id: seedId(i), finishedAt: new Date(newest - (512 - i) * 60_000).toISOString(), owner: i < 10 ? LIVE_OWNER : i < 13 ? dead : undefined });
  }
  const c = await bridgeOn(dataDir);
  try {
    await c.tool("zcode_tasks_list", {});
    // At the start: 503 tasks may be evicted by this bridge, so the 3 oldest of them go, and none of the live owner's.
    for (let i = 0; i < 10; i++) assert.equal(taskFiles(dataDir, seedId(i)).length, 3, `${seedId(i)} of the live owner is kept`);
    for (let i = 10; i < 13; i++) assert.deepEqual(taskFiles(dataDir, seedId(i)), [], `${seedId(i)} of the dead owner is evicted`);
    assert.equal(taskFiles(dataDir, seedId(13)).length, 3);
    assert.equal((await c.tool("zcode_task_result", { taskId: seedId(0) })).responseText, `stored ${seedId(0)}`, "the live owner's tasks are still readable here");

    // At run time: two more finished tasks evict the two oldest tasks of nobody, still none of the live owner's.
    await runTask(c, "one");
    await runTask(c, "two");
    await c.tool("zcode_tasks_list", {});
    for (let i = 0; i < 10; i++) assert.equal(taskFiles(dataDir, seedId(i)).length, 3, `${seedId(i)} of the live owner is kept at run time`);
    assert.deepEqual([taskFiles(dataDir, seedId(13)), taskFiles(dataDir, seedId(14))], [[], []]);
    assert.equal(taskFiles(dataDir, seedId(15)).length, 3);
  } finally {
    await c.stop();
  }
});

test("a task whose stored files were removed is answered as expired, dropped, and nothing is written for it", async (t) => {
  const dataDir = freshDataDir(t);
  const c = await bridgeOn(dataDir);
  try {
    const recordGone = await runTask(c, "record removed");
    const resultGone = await runTask(c, "result removed");
    const viaResource = await runTask(c, "read as a resource");
    for (const id of [recordGone, resultGone, viaResource]) {
      await until(`the result of ${id} is stored`, () => fs.existsSync(taskPath(dataDir, id, ".result.json")));
      assert.equal((await c.tool("zcode_task_result", { taskId: id })).responseText, "FAKE-OK");
    }

    // Another process evicted the task: all of its files are gone.
    for (const f of taskFiles(dataDir, recordGone)) fs.rmSync(path.join(dataDir, "tasks", f));
    assert.equal(await c.expectToolError("zcode_task_get", { taskId: recordGone }), `task expired: its stored result was removed (${recordGone})`);
    assert.equal(await c.expectToolError("zcode_task_get", { taskId: recordGone }), `unknown task: ${recordGone}`, "it was dropped from memory");
    assert.equal(await c.expectToolError("zcode_task_result", { taskId: recordGone }), `unknown task: ${recordGone}`);
    assert.deepEqual(taskFiles(dataDir, recordGone), [], "no file was written for it");

    // Only the stored result is gone: the result is not rebuilt as an empty one.
    fs.rmSync(taskPath(dataDir, resultGone, ".result.json"));
    assert.equal(await c.expectToolError("zcode_task_result", { taskId: resultGone }), `task expired: its stored result was removed (${resultGone})`);
    assert.equal(fs.existsSync(taskPath(dataDir, resultGone, ".result.json")), false, "no result file was written");
    assert.equal(await c.expectToolError("zcode_task_get", { taskId: resultGone }), `unknown task: ${resultGone}`);

    // The same answer through the resources.
    for (const f of taskFiles(dataDir, viaResource)) fs.rmSync(path.join(dataDir, "tasks", f));
    const status = await c.call("resources/read", { uri: `zcode://tasks/${viaResource}/status` });
    assert.deepEqual(status.error, { code: -32002, message: `task expired: its stored result was removed (${viaResource})` });
    assert.deepEqual(taskFiles(dataDir, viaResource), []);

    // A task with its files in place is answered as before.
    assert.equal((await c.tool("zcode_task_get", { taskId: await runTask(c, "still fine") })).state, "completed");
  } finally {
    await c.stop();
  }
});

test("a start sweeps result files without a record once they are older than an hour, and nothing else", async (t) => {
  const dataDir = freshDataDir(t);
  const now = Date.now();
  const orphan = (id, ageMs) => {
    fs.writeFileSync(taskPath(dataDir, id, ".result.json"), JSON.stringify({ schemaVersion: 1, taskId: id, status: "completed", responseText: "" }));
    const at = new Date(now - ageMs);
    fs.utimesSync(taskPath(dataDir, id, ".result.json"), at, at);
  };
  orphan("task-orphan-old", 2 * HOUR);
  orphan("task-orphan-new", 10 * 60_000);
  seedTask(dataDir, { id: "task-with-record", finishedAt: new Date(now - 3 * HOUR).toISOString() });
  const old = new Date(now - 3 * HOUR);
  fs.utimesSync(taskPath(dataDir, "task-with-record", ".result.json"), old, old);
  // A running task of another live bridge has a record, so its files are not orphans either.
  seedTask(dataDir, { id: "task-other-run", state: "running", finishedAt: new Date(now - 60_000).toISOString(), owner: LIVE_OWNER });
  const c = await bridgeOn(dataDir);
  try {
    await c.tool("zcode_tasks_list", {});
    assert.deepEqual(taskFiles(dataDir, "task-orphan-old"), [], "the old orphan is swept");
    assert.deepEqual(taskFiles(dataDir, "task-orphan-new"), ["task-orphan-new.result.json"], "a recent one is left: its record may be on its way");
    assert.equal(taskFiles(dataDir, "task-with-record").length, 3);
    assert.equal(taskFiles(dataDir, "task-other-run").length, 2);
  } finally {
    await c.stop();
  }
});
