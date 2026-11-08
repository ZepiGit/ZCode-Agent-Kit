// Seam 7: task retention (ADR-0009 correction 3, spec §7). Terminal tasks are
// evicted at more than 500 or older than 7 days, whichever comes first;
// non-terminal tasks never. An evicted task's files go with it, its lookups give
// the existing not-found error and its idempotency key starts a new task.
// Driven through the real MCP client against the fixture harness; the clock is
// moved with the clock-offset preload (test/fixture/clock-offset.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startBridge } from './client.mjs';

const DAY = 24 * 60 * 60 * 1000;
const clockPreload = pathToFileURL(path.join(import.meta.dirname, '..', 'fixture', 'clock-offset.mjs')).href;

function freshDataDir(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-retention-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'ws'), { recursive: true });
  return dataDir;
}

/** Task state as an older bridge left it on disk: record, cached result and events. */
function seedTask(dataDir, { id, state = 'completed', finishedAt, key = null }) {
  const workspacePath = path.join(dataDir, 'ws');
  const createdAt = new Date(Date.parse(finishedAt) - 5000).toISOString();
  const rec = {
    schemaVersion: 1, taskId: id, idempotencyKey: key, workspacePath, workspaceKey: workspacePath,
    sessionId: `sess_${id}`, sessionOwnedByTask: true, prompt: `seeded ${id}`, state, readOnly: true, mode: null,
    requestedModel: null, effectiveModel: { providerId: 'fake', modelId: 'FAKE-Main' }, thoughtLevel: null, selectionVerified: true,
    createdAt, startedAt: createdAt, finishedAt, lastSeq: 3, followUpCount: 0, error: null, usage: null,
    fileChanges: { added: [], modified: [], deleted: [], source: 'none', preExistingUncommitted: [] }, interruptionReason: null,
  };
  const dir = path.join(dataDir, 'tasks');
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
  fs.writeFileSync(path.join(dir, `${id}.result.json`), JSON.stringify({ schemaVersion: 1, taskId: id, status: state, finishedAt, responseText: `stored ${id}` }, null, 2));
  fs.writeFileSync(path.join(dir, `${id}.events.jsonl`), JSON.stringify({ seq: 1, ts: createdAt, type: 'turn.started', payload: {}, origin: 'harness' }) + '\n');
}

const seedId = (i) => `task-seed-${String(i).padStart(4, '0')}`;
/** n completed tasks, seed-0000 the oldest, finished one minute apart, the newest `newestAgoMs` ago. */
function seedCompleted(dataDir, n, { newestAgoMs = 60 * 60 * 1000, keyPrefix = 'key' } = {}) {
  const newest = Date.now() - newestAgoMs;
  for (let i = 0; i < n; i++) seedTask(dataDir, { id: seedId(i), finishedAt: new Date(newest - (n - 1 - i) * 60_000).toISOString(), key: `${keyPrefix}-${i}` });
}

const taskFiles = (dataDir, id) => fs.readdirSync(path.join(dataDir, 'tasks')).filter((f) => f.startsWith(`${id}.`));
function storeDigest(dataDir) {
  const dir = path.join(dataDir, 'tasks');
  return fs.readdirSync(dir).sort().map((f) => `${f} ${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}`);
}

async function assertNotFound(c, taskId) {
  for (const tool of ['zcode_task_get', 'zcode_task_result', 'zcode_task_events', 'zcode_task_wait']) {
    const text = await c.expectToolError(tool, { taskId, ...(tool === 'zcode_task_wait' ? { timeoutMs: 0 } : {}) });
    assert.equal(text, `unknown task: ${taskId}`, `${tool} on an evicted task`);
  }
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const v = await predicate();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('restore loads only the newest 500 terminal tasks within 7 days and prunes the rest from disk; replayed twice it is a no-op', async (t) => {
  const dataDir = freshDataDir(t);
  seedCompleted(dataDir, 505);
  // Three finished more than 7 days ago, newer by count than nothing: age alone evicts them.
  for (let i = 0; i < 3; i++) seedTask(dataDir, { id: `task-aged-${i}`, finishedAt: new Date(Date.now() - 7 * DAY - (i + 1) * 60_000).toISOString(), key: `aged-${i}` });

  const stderr = [];
  let c = await startBridge({ reuseDataDir: dataDir, collectStderr: stderr, env: { ZCODE_HARNESS_LOG_LEVEL: 'info' } });
  let first;
  try {
    const restoreLines = await waitFor(() => {
      const lines = stderr.join('').split('\n').filter((l) => l.includes('"restored tasks from store"'));
      return lines.length > 0 && lines.map((l) => JSON.parse(l).data);
    });
    assert.deepEqual(restoreLines, [{ count: 500, evicted: 8 }], 'the start loads only the retained tasks');
    const { tasks } = await c.tool('zcode_tasks_list', {});
    assert.equal(tasks.length, 500);
    assert.deepEqual(tasks.map((r) => r.taskId), Array.from({ length: 500 }, (_, i) => seedId(i + 5)));
    for (const id of [seedId(0), seedId(4), 'task-aged-0', 'task-aged-2']) {
      await assertNotFound(c, id);
      assert.deepEqual(taskFiles(dataDir, id), [], `files of evicted ${id}`);
    }
    assert.deepEqual(taskFiles(dataDir, seedId(5)).sort(), [`${seedId(5)}.events.jsonl`, `${seedId(5)}.json`, `${seedId(5)}.result.json`]);
    const kept = await c.tool('zcode_task_result', { taskId: seedId(5) });
    assert.equal(kept.responseText, `stored ${seedId(5)}`, 'a retained result is served as stored');
    first = storeDigest(dataDir);
    assert.equal(first.length, 500 * 3);
  } finally { await c.stop(); }

  c = await startBridge({ reuseDataDir: dataDir });
  try {
    const { tasks } = await c.tool('zcode_tasks_list', {});
    assert.equal(tasks.length, 500);
    assert.deepEqual(storeDigest(dataDir), first, 'the second start changes no task file');
  } finally { await c.stop(); }
});

test('a task finishing as the 501st terminal task evicts the oldest; a running task is never counted or evicted; the evicted key starts a new task', async (t) => {
  const dataDir = freshDataDir(t);
  seedCompleted(dataDir, 499);
  const c = await startBridge({ reuseDataDir: dataDir, env: { FAKE_HANG_PROMPT: 'HANG' } });
  try {
    const running = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'HANG here', readOnly: true });
    await waitFor(async () => (await c.tool('zcode_task_get', { taskId: running.taskId })).state === 'running');
    const fresh = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'the 500th', readOnly: true });
    assert.equal((await c.tool('zcode_task_wait', { taskId: fresh.taskId, timeoutMs: 15_000 })).state, 'completed');
    // 500 terminal: nothing is evicted yet.
    assert.equal((await c.tool('zcode_task_get', { taskId: seedId(0) })).taskId, seedId(0));

    const next = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'the 501st', readOnly: true });
    assert.equal((await c.tool('zcode_task_wait', { taskId: next.taskId, timeoutMs: 15_000 })).state, 'completed');
    await assertNotFound(c, seedId(0));
    await waitFor(() => taskFiles(dataDir, seedId(0)).length === 0);
    assert.equal((await c.tool('zcode_task_get', { taskId: seedId(1) })).taskId, seedId(1));
    assert.equal((await c.tool('zcode_task_get', { taskId: running.taskId })).state, 'running');
    const { tasks } = await c.tool('zcode_tasks_list', {});
    assert.equal(tasks.length, 501, '500 terminal tasks plus the running one');

    const reusedEvicted = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'again', readOnly: true, idempotencyKey: 'key-0' });
    assert.notEqual(reusedEvicted.taskId, seedId(0));
    assert.match(reusedEvicted.taskId, /^task-/);
    const reusedRetained = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'again', readOnly: true, idempotencyKey: 'key-2' });
    assert.equal(reusedRetained.taskId, seedId(2), 'a retained task keeps its idempotency key');
  } finally { await c.stop(); }
});

test('a task of unconfirmed outcome and a task cut off by a restart are never evicted, at any age or count', async (t) => {
  const dataDir = freshDataDir(t);
  seedCompleted(dataDir, 501, { newestAgoMs: 8 * DAY });
  seedTask(dataDir, { id: 'task-unknown', state: 'unknown', finishedAt: new Date(Date.now() - 9 * DAY).toISOString(), key: 'unknown-key' });
  seedTask(dataDir, { id: 'task-was-running', state: 'running', finishedAt: new Date(Date.now() - 9 * DAY).toISOString(), key: 'running-key' });
  const rec = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks', 'task-was-running.json'), 'utf8'));
  fs.writeFileSync(path.join(dataDir, 'tasks', 'task-was-running.json'), JSON.stringify({ ...rec, finishedAt: null }));
  let c = await startBridge({ reuseDataDir: dataDir });
  try {
    const { tasks } = await c.tool('zcode_tasks_list', {});
    assert.deepEqual(tasks.map((r) => [r.taskId, r.state]).sort(), [['task-unknown', 'unknown'], ['task-was-running', 'interrupted']]);
    const again = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'again', readOnly: true, idempotencyKey: 'unknown-key' });
    assert.equal(again.taskId, 'task-unknown');
  } finally { await c.stop(); }
  assert.equal(fs.readdirSync(path.join(dataDir, 'tasks')).filter((f) => f.startsWith('task-seed-')).length, 0);
  // Shutdown turns the unknown task into an interrupted one (unchanged behaviour)
  // that keeps its 9-day-old finish time: from then on it is terminal and aged out.
  // The task cut off by the first restart finished at that restart and stays.
  c = await startBridge({ reuseDataDir: dataDir });
  try {
    const { tasks } = await c.tool('zcode_tasks_list', {});
    assert.deepEqual(tasks.map((r) => [r.taskId, r.state]), [['task-was-running', 'interrupted']]);
  } finally { await c.stop(); }
});

test('the task start tool states the idempotency window', async () => {
  const c = await startBridge();
  try {
    const { tools } = await c.result('tools/list', {});
    const start = tools.find((tool) => tool.name === 'zcode_task_start');
    assert.ok(start.description.includes('Idempotency keys are remembered for as long as the task is retained (at most 500 terminal tasks or 7 days, whichever comes first); after that the same key starts a new task.'));
  } finally { await c.stop(); }
});

test('terminal tasks older than 7 days are evicted with the injected clock while running tasks stay', async (t) => {
  const dataDir = freshDataDir(t);
  const clockFile = path.join(dataDir, 'clock-offset');
  fs.writeFileSync(clockFile, '0');
  seedCompleted(dataDir, 3, { newestAgoMs: 0 });
  const c = await startBridge({ reuseDataDir: dataDir, env: { FAKE_HANG_PROMPT: 'HANG', NODE_OPTIONS: `--import=${clockPreload}`, FAKE_CLOCK_FILE: clockFile } });
  const setOffset = async (ms) => { fs.writeFileSync(clockFile, String(ms)); await new Promise((r) => setTimeout(r, 200)); };
  try {
    const running = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'HANG', readOnly: true, idempotencyKey: 'running-key' });
    await waitFor(async () => (await c.tool('zcode_task_get', { taskId: running.taskId })).state === 'running');

    // seed-0000 finished two minutes before seeding, seed-0001 one minute, seed-0002 at seeding.
    await setOffset(7 * DAY - 3 * 60_000);
    assert.equal((await c.tool('zcode_tasks_list', {})).tasks.length, 4, 'nothing is older than 7 days yet');

    await setOffset(7 * DAY - 90_000);
    await assertNotFound(c, seedId(0));
    assert.deepEqual(taskFiles(dataDir, seedId(0)), []);
    assert.equal((await c.tool('zcode_task_get', { taskId: seedId(1) })).taskId, seedId(1), 'seed-0001 is 30 s short of 7 days');
    assert.equal((await c.tool('zcode_task_get', { taskId: seedId(2) })).taskId, seedId(2));

    const reused = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'again', readOnly: true, idempotencyKey: 'key-0' });
    assert.notEqual(reused.taskId, seedId(0));

    await setOffset(30 * DAY);
    const { tasks } = await c.tool('zcode_tasks_list', {});
    assert.ok(tasks.some((r) => r.taskId === running.taskId && r.state === 'running'), 'the running task stays');
    assert.ok(!tasks.some((r) => r.taskId.startsWith('task-seed-')));
    const again = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'HANG', readOnly: true, idempotencyKey: 'running-key' });
    assert.equal(again.taskId, running.taskId, 'a running task keeps its idempotency key at any age');
  } finally { await c.stop(); }
});
