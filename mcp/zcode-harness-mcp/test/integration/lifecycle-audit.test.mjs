import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startBridge, isolatedTestEnv } from './client.mjs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const discoveryUrl = new URL('../../dist/discovery.js', import.meta.url).href;
const managerUrl = new URL('../../dist/runtime/manager.js', import.meta.url).href;
const builtinKey = 'ZCODE_BUILTIN_PROVIDER_CONFIG_FILE';
const bundledKey = 'ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE';
const personalKey = 'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE';

// This fixture reads real selected files and answers one stdio request. It does
// not import the vendor, use credentials, or make native/model requests.
const providerHarness = `
const fs = require('node:fs');
const readline = require('node:readline');
if (process.argv.includes('--version')) {
  process.stdout.write('zcode 0.16.9\\n');
  process.exit(0);
}
const builtin = process.env.${builtinKey}?.trim();
if (!builtin) {
  process.stderr.write('unstructured-private-value 无法定位 CLI ZCode Built-in Provider Config: private-path\\n', () => process.exit(1));
} else {
  const config = JSON.parse(fs.readFileSync(builtin, 'utf8'));
  const personal = process.env.${personalKey}?.trim();
  const personalMarker = personal ? JSON.parse(fs.readFileSync(personal, 'utf8')).marker : null;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', line => {
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ id: request.id, result: { marker: config.marker, personalMarker } }) + '\\n');
  });
}
`;

function providerLayout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode provider repair '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harness = path.join(root, 'installation', 'Program Files', 'ZCode', 'resources', 'glm', 'zcode.cjs');
  const cwd = path.join(root, 'unrelated working directory');
  fs.mkdirSync(path.dirname(harness), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(harness, providerHarness);
  return { root, harness, cwd };
}

function providerFile(file, marker) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ marker }));
  return file;
}

async function launchProviderFixture(layout, overrides = {}, { defaultDiscovery = false, removeAfterDiscovery = false } = {}) {
  const env = isolatedTestEnv(layout.root, {
    [builtinKey]: undefined,
    [bundledKey]: undefined,
    [personalKey]: undefined,
    ZCODE_HARNESS_RUNTIME_PATH: undefined,
    ...overrides,
  });
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { discoverRuntime } from ${JSON.stringify(discoveryUrl)};
    import { RuntimeManager } from ${JSON.stringify(managerUrl)};
    const before = { ...process.env };
    let runtime;
    try {
      const info = await discoverRuntime(${defaultDiscovery ? '{}' : JSON.stringify({ runtimePathOverride: layout.harness })});
      if (${removeAfterDiscovery}) fs.unlinkSync(info.bundledProviderConfigPath);
      runtime = new RuntimeManager({ dataDir: ${JSON.stringify(path.join(layout.cwd, 'bridge-data'))}, defaultRequestTimeoutMs: 3000 }, info, {});
      const result = await runtime.call('fixture/provider');
      process.stdout.write(JSON.stringify({ result, harnessPath: info.harnessPath }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.message, code: error.code }));
    } finally {
      runtime?.stop();
    }
    assert.deepEqual({ ...process.env }, before, 'launch must not mutate the bridge environment');
  `;
  const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: layout.cwd, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  assert.doesNotMatch(stdout + stderr, /unstructured-private-value|private-path/);
  const result = JSON.parse(stdout);
  if (result.error) result.diagnostic = stderr;
  return result;
}

test('provider bootstrap: installed sibling config works with spaces and unrelated cwd without changing parent env', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  providerFile(path.join(layout.cwd, 'config/provider/zcode-builtin.json'), 'wrong-cwd');
  const result = await launchProviderFixture(layout);
  assert.deepEqual(result.result, { marker: 'installed', personalMarker: null });
});

test('provider bootstrap: older adjacent layout takes precedence over sibling config', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'sibling');
  providerFile(path.join(path.dirname(layout.harness), 'provider/zcode-builtin.json'), 'adjacent');
  assert.deepEqual((await launchProviderFixture(layout)).result, { marker: 'adjacent', personalMarker: null });
});

test('provider bootstrap: legacy source layout is resolved relative to the verified entrypoint', async (t) => {
  const layout = providerLayout(t);
  layout.harness = path.join(layout.root, 'a/b/c/d/e/zcode.cjs');
  fs.mkdirSync(path.dirname(layout.harness), { recursive: true });
  fs.writeFileSync(layout.harness, providerHarness);
  providerFile(path.join(layout.root, 'config/provider/zcode-builtin.json'), 'legacy');
  assert.deepEqual((await launchProviderFixture(layout)).result, { marker: 'legacy', personalMarker: null });
});

test('provider bootstrap: builtin and personal operator overrides win over bundled and installed configs', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const builtin = providerFile(path.join(layout.cwd, 'operator builtin.json'), 'operator');
  const personal = providerFile(path.join(layout.cwd, 'operator personal.json'), 'personal');
  const result = await launchProviderFixture(layout, {
    [builtinKey]: path.basename(builtin),
    [personalKey]: path.basename(personal),
    [bundledKey]: path.join(layout.root, 'unused missing bundled.json'),
  });
  assert.deepEqual(result.result, { marker: 'operator', personalMarker: 'personal' }, JSON.stringify(result));
});

test('provider bootstrap: bundled-only override seeds CLI builtin without inventing a personal override', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const bundled = providerFile(path.join(layout.root, 'operator bundled.json'), 'bundled');
  assert.deepEqual((await launchProviderFixture(layout, { [bundledKey]: bundled })).result, { marker: 'bundled', personalMarker: null });
});

test('provider bootstrap: builtin-only override is preserved without supplying a personal path', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const builtin = providerFile(path.join(layout.root, 'operator.json'), 'operator');
  assert.deepEqual((await launchProviderFixture(layout, { [builtinKey]: builtin })).result, { marker: 'operator', personalMarker: null });
});

test('provider bootstrap: missing bundled override fails rather than using installed providers', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const result = await launchProviderFixture(layout, { [bundledKey]: path.join(layout.root, 'missing.json') });
  assert.match(result.error, /ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE.*not a readable file/);
});

test('provider bootstrap: blank overrides do not disable distribution resolution', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  assert.deepEqual((await launchProviderFixture(layout, {
    [builtinKey]: '  ', [bundledKey]: '', [personalKey]: '  ',
  })).result, { marker: 'installed', personalMarker: null });
});

test('provider bootstrap: explicit personal override is retained with discovered builtin', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const personal = providerFile(path.join(layout.root, 'personal.json'), 'personal');
  assert.deepEqual((await launchProviderFixture(layout, { [personalKey]: personal })).result, { marker: 'installed', personalMarker: 'personal' });
});

test('provider bootstrap: missing explicit builtin is not replaced by a working installed config', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const result = await launchProviderFixture(layout, { [builtinKey]: path.join(layout.root, 'missing.json') });
  assert.equal(result.result, undefined);
  assert.match(result.error, /ZCODE_BUILTIN_PROVIDER_CONFIG_FILE.*not a readable file/);
});

test('provider bootstrap: a directory is not a bundled config and missing config errors never leak stderr', async (t) => {
  const layout = providerLayout(t);
  fs.mkdirSync(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), { recursive: true });
  const result = await launchProviderFixture(layout, { ZCODE_HARNESS_LOG_LEVEL: 'debug' });
  assert.equal(result.code, 'HARNESS_EXITED');
  assert.match(result.error, /PROVIDER_CONFIG_MISSING/);
});

test('provider bootstrap: config removed after discovery fails before launching the harness', async (t) => {
  const layout = providerLayout(t);
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'installed');
  const result = await launchProviderFixture(layout, {}, { removeAfterDiscovery: true });
  assert.match(result.error, /installed bundled provider config.*not a readable file/);
});

test('runtime discovery: nonzero version probe cannot select an explicit runtime', async (t) => {
  const layout = providerLayout(t);
  fs.writeFileSync(layout.harness, "process.stdout.write('zcode 0.16.9\\n'); process.exitCode = 7;");
  const result = await launchProviderFixture(layout);
  assert.match(result.error, /failed.*--version probe/);
});

test('runtime discovery: failed default candidate is skipped for a verified installed distribution', async (t) => {
  const layout = providerLayout(t);
  const failed = path.join(layout.root, 'local/Programs/ZCode/resources/glm/zcode.cjs');
  fs.mkdirSync(path.dirname(failed), { recursive: true });
  fs.writeFileSync(failed, "process.stdout.write('zcode 0.16.9\\n'); process.exitCode = 7;");
  providerFile(path.resolve(path.dirname(layout.harness), '../config/provider/zcode-builtin.json'), 'verified');
  const result = await launchProviderFixture(layout, {
    LOCALAPPDATA: path.join(layout.root, 'local'),
    ProgramFiles: path.join(layout.root, 'installation', 'Program Files'),
    // Windows initializes ProgramFiles from the native ProgramW6432 alias.
    ProgramW6432: path.join(layout.root, 'installation', 'Program Files'),
  }, { defaultDiscovery: true });
  assert.equal(result.harnessPath, layout.harness, JSON.stringify(result));
  assert.deepEqual(result.result, { marker: 'verified', personalMarker: null });
});

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
    const err = await c.expectToolError('zcode_operation_invoke', { method: 'workspace/readPresentation', params: { workspace: { workspacePath: 12 } } });
    assert.match(err, /workspacePath.*string/);
    assert.match(await c.expectToolError('zcode_operation_invoke', { method: 'workspace/readPresentation' }), /workspace.*required/);
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
