import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startBridge } from './client.mjs';

async function waitExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge did not exit after EOF')), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

test('completion before a delayed send acknowledgement is not lost', async () => {
  const c = await startBridge({ env: { FAKE_ACK_DELAY_MS: '2200' } });
  try {
    const t = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'fast turn slow acknowledgement' });
    assert.equal((await c.tool('zcode_task_wait', { taskId: t.taskId, timeoutMs: 10000 })).state, 'completed');
  } finally { await c.stop(); }
});

test('failed event subscription refuses to send a prompt', async () => {
  const c = await startBridge({ env: { FAKE_SUBSCRIBE_FAIL: '1' } });
  try {
    const t = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'must not be sent' });
    const done = await c.tool('zcode_task_wait', { taskId: t.taskId, timeoutMs: 10000 });
    assert.equal(done.state, 'failed');
    assert.match(done.error, /subscribe failure/);
    assert.ok(!(await c.tool('zcode_task_events', { taskId: t.taskId })).items.some(e => e.type === 'turn.started'));
  } finally { await c.stop(); }
});

test('D-03: artifact cap is enforced for tools and resources; bounded chunks have accurate metadata', async () => {
  const c = await startBridge({ env: { ZCODE_HARNESS_MAX_ARTIFACT_BYTES: '1024' } });
  try {
    fs.writeFileSync(path.join(c.workspaceDir, 'large.bin'), Buffer.alloc(1025));
    fs.writeFileSync(path.join(c.workspaceDir, 'small.txt'), 'abcdef');
    assert.match(await c.expectToolError('zcode_artifact_read', { workspacePath: c.workspaceDir, path: 'large.bin', length: 1 }), /ARTIFACT_TOO_LARGE/);
    const r = await c.tool('zcode_artifact_read', { workspacePath: c.workspaceDir, path: 'small.txt', offset: 2, length: 3 });
    assert.equal(Buffer.from(r.contentBase64, 'base64').toString(), 'cde');
    assert.equal(r.bytesReturned, 3);
    assert.equal(r.size, 6);
    assert.equal(r.truncated, true);
    assert.equal(r.sha256.length, 64);
    const error = await c.call('resources/read', { uri: 'zcode://artifacts/' + encodeURIComponent(path.join(c.workspaceDir, 'large.bin')) });
    assert.match(error.error.message, /ARTIFACT_TOO_LARGE/);
  } finally { await c.stop(); }
});

test('D-06: stdin EOF interrupts running work and exits without an external kill', async () => {
  const c = await startBridge({ env: { FAKE_TURN: 'hang' } });
  try {
    const t = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'wait' });
    await c.tool('zcode_task_wait', { taskId: t.taskId, timeoutMs: 800 });
    c.child.stdin.end();
    await waitExit(c.child);
    assert.equal(c.child.exitCode, 0);
    const saved = JSON.parse(fs.readFileSync(path.join(c.dataDir, 'tasks', t.taskId + '.json'), 'utf8'));
    assert.equal(saved.state, 'interrupted');
  } finally { await c.stop(); }
});

test('D-05: cancelling startup prevents sending and does not strand later queued tasks', async () => {
  const c = await startBridge({ maxConcurrentTasks: '1', env: { FAKE_SLOW_CREATE_MS: '600' } });
  try {
    const first = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'first', readOnly: true });
    const second = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'second', readOnly: true });
    const third = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'third', readOnly: true });
    assert.equal((await c.tool('zcode_task_cancel', { taskId: second.taskId })).state, 'cancelled');
    assert.equal((await c.tool('zcode_task_cancel', { taskId: first.taskId })).state, 'cancelled');
    assert.equal((await c.tool('zcode_task_wait', { taskId: third.taskId, timeoutMs: 15000 })).state, 'completed');
    for (const task of [first, second]) {
      const events = await c.tool('zcode_task_events', { taskId: task.taskId });
      assert.ok(!events.items.some(e => e.type === 'turn.started'));
    }
  } finally { await c.stop(); }
});

test('follow-up results replace the cached turn instead of accumulating old text', async () => {
  const c = await startBridge();
  try {
    const t = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'first', readOnly: true });
    await c.tool('zcode_task_wait', { taskId: t.taskId, timeoutMs: 15000 });
    const first = await c.tool('zcode_task_result', { taskId: t.taskId });
    assert.equal(first.responseText, 'FAKE-OK');
    await c.tool('zcode_task_input', { taskId: t.taskId, content: 'second' });
    await c.tool('zcode_task_wait', { taskId: t.taskId, timeoutMs: 15000 });
    const second = await c.tool('zcode_task_result', { taskId: t.taskId });
    assert.equal(second.responseText, 'FAKE-OK');
    assert.notEqual(first.finishedAt, second.finishedAt);
  } finally { await c.stop(); }
});

test('D-01: foreign session resources are denied before transcript or projection reads', async () => {
  const foreign = process.platform === 'win32' ? 'C:/audit-foreign' : '/audit-foreign';
  const c = await startBridge({ env: { FAKE_FOREIGN_WORKSPACE: foreign } });
  try {
    const r = await c.call('resources/read', { uri: 'zcode://sessions/sess_foreign-fixture' });
    assert.match(r.error.message, /allowlist/);
    assert.doesNotMatch(JSON.stringify(r), /FOREIGN-SECRET/);
    const err = await c.expectToolError('zcode_operation_invoke', { method: 'workspace/readState', params: { workspace: { workspacePath: 12 } } });
    assert.match(err, /workspacePath.*string/);
    assert.match(await c.expectToolError('zcode_operation_invoke', { method: 'workspace/readState' }), /workspace.*required/);
  } finally { await c.stop(); }
});

test('D-08: shell permissions are denied even under ask or explicit shell allowlist', async () => {
  for (const policy of ['ask', 'allowlist']) {
    const c = await startBridge({ interactionPolicy: policy, extraArgs: policy === 'allowlist' ? ['--interaction-allowlist', 'Bash'] : [], env: { FAKE_PERMISSION: '1', FAKE_PERMISSION_TOOL: 'Bash' } });
    try {
      const t = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt: 'permission' });
      await c.tool('zcode_task_wait', { taskId: t.taskId, timeoutMs: 15000 });
      const r = await c.tool('zcode_interactions_list', {});
      const shell = r.interactions.find(i => i.toolName === 'Bash');
      assert.ok(shell, 'fixture must actually emit a shell permission');
      assert.equal(shell.resolution.decision, 'deny');
    } finally { await c.stop(); }
  }
});
