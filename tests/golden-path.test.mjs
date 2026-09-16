import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, PROMPT, isolatedEnv, ompArgs, classify, createMock, fillProxyTemplate, runMockGolden, runLiveGolden } from '../scripts/verify-golden-path.mjs';

for (const model of MODELS) test(`golden CLI ritual preserves exact provider/model and prompt: ${model}`, () => {
  const args = ompArgs(model);
  assert.deepEqual(args.slice(0, 3), ['-p', '--model', `zcode/${model}`]);
  assert.equal(args.at(-1), 'Antworte mit 52');
  for (const flag of ['--no-session', '--no-tools', '--no-extensions']) assert.ok(args.includes(flag));
});
test('unknown models fail closed', () => assert.throws(() => ompArgs('other'), /unsupported/));
test('isolated home redirects all runtime paths and strips inherited credentials/profiles', () => {
  const env = isolatedEnv('/disposable/home', { PATH: '/bin', USERPROFILE: '/real', HOME: '/real', OPENAI_API_KEY: 'must-not-leak', ZCODE_PROXY_CREDENTIALS_PATH: '/real/credentials', PI_PROFILE: 'real', PI_CODING_AGENT_DIR: '/real/agent' });
  assert.equal(env.HOME, '/disposable/home'); assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.PATH, '/bin');
  for (const name of ['OPENAI_API_KEY', 'ZCODE_PROXY_CREDENTIALS_PATH', 'PI_PROFILE']) assert.equal(env[name], undefined);
  for (const name of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) assert.ok(env[name].replaceAll('\\', '/').startsWith(env.HOME));
});
test('golden success requires zero exit and exact52, never substring or stderr', () => {
  assert.equal(classify({ code: 0, stdout: '52\n' }).status, 'PASS');
  assert.equal(classify({ code: 1, stdout: '52' }).status, 'FAIL');
  assert.equal(classify({ code: 0, stdout: 'Result: 52' }).status, 'FAIL');
  assert.equal(classify({ code: 0, stderr: '52' }).status, 'FAIL');
  assert.equal(classify({ code: null, timedOut: true }).status, 'BLOCKED');
});
test('summaries do not serialize stdout/stderr credentials', () => {
  const s = JSON.stringify(classify({ code: 1, stdout: 'secret-sentinel', stderr: 'secret-sentinel' }));
  assert.ok(!s.includes('secret-sentinel')); assert.ok(s.includes('rawOutputPersisted'));
});
test('CI golden fallback performs both authenticated local HTTP rituals', async () => {
  const result = await runMockGolden();
  assert.equal(result.mode, 'mock');
  assert.deepEqual(result.results.map(r => r.model), MODELS);
  assert.ok(result.results.every(r => r.status === 'PASS' && r.level === 'MOCK_HTTP_NOT_OMP'));
});
test('mock rejects stale client key without leaking credential', async () => {
  const mock = await createMock({ key: 'new-key' });
  try {
    const res = await fetch(`${mock.url}/v1/messages`, { method: 'POST', headers: { 'x-api-key': 'old-key', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELS[0], messages: [{ role: 'user', content: PROMPT }] }) });
    assert.equal(res.status, 401); assert.equal(mock.calls[0].authorized, false);
    assert.ok(!JSON.stringify(mock.calls).includes('old-key'));
  } finally { await mock.close(); }
});
test('mock stream preserves Anthropic message start/delta/stop contract', async () => {
  const mock = await createMock();
  try {
    const res = await fetch(`${mock.url}/v1/messages`, { method: 'POST', headers: { 'x-api-key': 'golden-mock-key', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELS[0], stream: true, messages: [{ role: 'user', content: PROMPT }] }) });
    const events = await res.text();
    for (const event of ['message_start', 'content_block_delta', 'message_delta', 'message_stop']) assert.ok(events.includes(`event: ${event}`));
    assert.ok(events.includes('"text":"52"'));
  } finally { await mock.close(); }
});
test('runtime template fills the actual key, not an earlier GENERATE_ME comment', () => {
  const template = '# replace GENERATE_ME later\nserver:\n  port: 8457\nauth:\n  proxyApiKey: "GENERATE_ME"\n';
  const output = fillProxyTemplate(template, 18457, 'random-test-key');
  assert.ok(output.includes('  proxyApiKey: "random-test-key"'));
  assert.ok(output.includes('# replace GENERATE_ME later'));
  assert.throws(() => fillProxyTemplate(template, 8457, 'key'), /unsafe/);
});
test('real OMP golden path is opt-in and isolated', { skip: process.env.GOLDEN !== '1', timeout: 480000 }, async () => {
  const report = await runLiveGolden();
  // Assert only the safe summary; never let assertion output print raw config.
  assert.equal(report.status, 'PASS', JSON.stringify(report));
  assert.equal(report.credentialCopyRemoved, true);
  assert.equal(report.tempHomeRemoved, true);
  assert.ok(report.results.every(r => r.exact52 && r.exitCode === 0));
});
