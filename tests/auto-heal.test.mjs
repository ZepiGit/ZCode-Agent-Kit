// All profiles, credentials, providers and listeners in this suite are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import omp from '../cli/adapters/omp.mjs';
import { resolveBun } from '../lib/process.mjs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createCtx, bootstrap } from '../cli/context.mjs';
import { createManager } from '../proxy/zcode-proxy-manager.mjs';
import { acquireLock, releaseLock, listTransactions } from '../lib/transaction.mjs';

const ROOT = join(import.meta.dirname, '..');
const KEY = 'synthetic-local-key-never-a-real-credential';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'zcode-heal-'));
  const home = join(root, 'fake-home');
  mkdirSync(home); mkdirSync(join(root, 'proxy')); mkdirSync(join(root, 'logs'));
  cpSync(join(ROOT, 'proxy', 'config.example.yaml'), join(root, 'proxy', 'config.example.yaml'));
  writeFileSync(join(root, '.proxykey'), KEY + '\n');
  const ctx = createCtx(root, home);
  writeConfig(ctx, 1);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return ctx;
}
function writeConfig(ctx, port, key = KEY) {
  const template = readFileSync(ctx.configExample, 'utf8');
  writeFileSync(ctx.config, template.replace('port: 8457', `port: ${port}`).replace('"GENERATE_ME"', JSON.stringify(key)));
}
async function api() {
  assert.ok(existsSync(join(ROOT, 'cli', 'heal.mjs')), 'shared auto-heal preflight must exist');
  return import('../cli/heal.mjs');
}
function snapshot(errors = []) {
  return { provider: 'zai', serverTime: 1700000000, jwt: { ageHours: 1, issuedAt: 1699996400 }, balances: [], claimablePlans: [], errors, asOf: '2023-11-14T22:13:20.000Z', cached: false };
}
async function mock(t, ctx, { code, foreign = false, hang = false, smokeCode, quotaBody, smokeReply, smokeStatus, healthDetails } = {}) {
  const hits = [];
  let smokes = 0;
  const server = http.createServer(async (req, res) => {
    hits.push(req.url);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let input = {}; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    if (foreign || req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end('{}');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', provider: 'zai', ...(healthDetails ? { details: healthDetails() } : {}) }));
    if (hang) return;
    const status = req.url === '/v1/chat/completions' ? smokeStatus?.(++smokes) : undefined;
    if (status) return res.writeHead(status).end(JSON.stringify({ error: { type: 'upstream_error', message: 'SECRET-should-not-be-logged' } }));
    const body = req.url === '/quota'
      ? quotaBody ?? snapshot(code ? [`balance: ${code} SECRET-should-not-be-logged`] : [])
      : smokeCode ? { error: { type: 'upstream_error', message: `[${smokeCode}] SECRET-should-not-be-logged` } }
      : smokeReply ?? { model: input.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: String(input.messages?.[0]?.content ?? '').match(/ZCODE_SMOKE_[A-F0-9]+/)?.[0] ?? 'ok' } }] };
    res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  writeConfig(ctx, server.address().port);
  t.after(() => { server.closeAllConnections(); server.close(); });
  return hits;
}

test('preflight makes one quota check and concurrent callers share it', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx);
  const { startupPreflight } = await api();
  const results = await Promise.all([startupPreflight(ctx), startupPreflight(ctx)]);
  assert.ok(results.every(r => r.code === 0));
  assert.equal(hits.filter(p => p === '/quota').length, 1);
});
for (const [code, cause, status] of [[3012, 'auth3012', 5], [1113, 'balance1113', 1], [3001, 'balance3001', 1]]) {
  test(`preflight diagnoses ${code} even in an HTTP 200 envelope without retries`, async t => {
    const ctx = fixture(t); const hits = await mock(t, ctx, { code });
    const { startupPreflight } = await api();
    const result = await startupPreflight(ctx);
    assert.equal(result.code, 0, 'quota warning must allow the model handler to recover credentials');
    assert.equal(result.diagnosticCode, status); assert.equal(result.cause, cause);
    assert.match(result.detail, new RegExp(String(code)));
    assert.equal(hits.filter(p => p === '/quota').length, 1);
    const log = readFileSync(join(ctx.root, 'logs', 'heal.log'), 'utf8');
    assert.ok(!log.includes(KEY) && !log.includes('SECRET'));
    assert.match(log, /cause=.* action=.* result=/);
  });
}
test('quota diagnostics recognize only anchored known billing and proxy error codes', async () => {
  const { diagnoseQuota } = await api();
  for (const [code, cause] of [[3012, 'auth3012'], [1113, 'balance1113'], [3001, 'balance3001']]) {
    for (const body of [snapshot([`preview:${code} SECRET`]), { error: { message: `[${code}] SECRET` } }]) {
      const result = diagnoseQuota(200, body);
      assert.equal(result.cause, cause); assert.ok(!result.detail.includes('SECRET'));
    }
  }
  for (const message of ['note balance: 3012 SECRET', 'balance: 30120 SECRET', 'preview: 11130 SECRET', 'balance: -1 request 3012', 'SECRET [3012]']) {
    assert.equal(diagnoseQuota(200, snapshot([message])).cause, 'quota-unavailable');
    assert.equal(diagnoseQuota(200, { error: { message } }).cause, 'quota-unavailable');
  }
  assert.equal(diagnoseQuota(200, {}).cause, 'quota-unavailable');
  assert.equal(diagnoseQuota(200, snapshot(['preview: 1113 SECRET', 'balance: 3012 SECRET'])).cause, 'auth3012');
});
test('auth status uses real quota snapshots without leaking provider error text', async t => {
  const ctx = fixture(t);
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  const quotaBody = snapshot(); await mock(t, ctx, { quotaBody });
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, ZCODE_PROXY_CREDENTIALS_PATH: join(ctx.home, 'synthetic.json') };
  for (const [errors, loggedIn] of [[['balance: 3012 SECRET'], false], [['preview:1113 SECRET'], true], [['balance: 3001 SECRET'], true], [['balance: -1 SECRET'], false], [[], true]]) {
    quotaBody.errors = errors;
    const result = await runNode(join(ctx.root, 'cli', 'zcode-kit.mjs'), ['auth', 'status'], env);
    assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).logged_in, loggedIn);
    assert.ok(!result.stdout.includes('SECRET'));
  }
  for (const key of Object.keys(quotaBody)) delete quotaBody[key];
  const empty = await runNode(join(ctx.root, 'cli', 'zcode-kit.mjs'), ['auth', 'status'], env);
  assert.equal(JSON.parse(empty.stdout).logged_in, false, 'empty object proves no account authentication');
});
test('manager doctor shares authentic quota auth diagnostics without treating balance as logout', async t => {
  const ctx = fixture(t); const quotaBody = snapshot(); await mock(t, ctx, { quotaBody });
  for (const [errors, expectedTag] of [[['balance: 3012 SECRET'], 'FAIL'], [['preview:1113 SECRET'], 'PASS'], [['balance: 3001 SECRET'], 'PASS'], [['balance: -1 SECRET'], 'FAIL'], [[], 'PASS']]) {
    quotaBody.errors = errors;
    const messages = []; const original = console.log; console.log = value => messages.push(String(value));
    try {
      const code = await createManager({ root: ctx.root, home: ctx.home }).doctor();
      assert.equal(code, 1, 'synthetic dependencies remain intentionally missing');
    } finally { console.log = original; }
    const auth = messages.find(line => /account auth valid/.test(line));
    assert.match(auth, new RegExp(`^${expectedTag}\\s+account auth valid`));
    assert.ok(!auth.includes('SECRET'));
    if (errors[0]?.includes('3012')) assert.match(auth, /auth3012/);
  }
});
test('auth logout deletes only the effective isolated credential path after confirmation', async t => {
  const ctx = fixture(t);
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  const defaultStore = join(ctx.home, '.zcode-proxy', 'credentials.json'); mkdirSync(join(ctx.home, '.zcode-proxy'));
  const override = join(ctx.home, 'override.json');
  writeFileSync(defaultStore, 'synthetic-default'); writeFileSync(override, 'synthetic-override');
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, ZCODE_PROXY_CREDENTIALS_PATH: override };
  const cli = join(ctx.root, 'cli', 'zcode-kit.mjs');
  const refused = await runNode(cli, ['auth', 'logout'], env);
  assert.equal(refused.code, 2); assert.ok(existsSync(defaultStore) && existsSync(override));
  assert.ok(refused.stdout.includes(override), 'confirmation must name effective store');
  const result = await runNode(cli, ['auth', 'logout', '--yes'], env);
  assert.equal(result.code, 0); assert.equal(existsSync(override), false);
  assert.equal(readFileSync(defaultStore, 'utf8'), 'synthetic-default');
  assert.ok(result.stdout.includes(override)); assert.ok(!result.stdout.includes('synthetic-override'));
});
test('foreign service plus stale pid remains untouched and receives no quota call', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx, { foreign: true });
  const pid = join(ctx.root, 'logs', 'proxy.pid');
  writeFileSync(pid, JSON.stringify({ pid: process.pid, startedMs: 1 }));
  const before = readFileSync(pid, 'utf8');
  const { startupPreflight } = await api();
  assert.equal((await startupPreflight(ctx)).code, 3);
  assert.equal(readFileSync(pid, 'utf8'), before);
  assert.equal(hits.filter(p => p === '/quota').length, 0);
});
test('hung quota request is bounded without retry', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx, { hang: true });
  const { startupPreflight } = await api(); const started = Date.now();
  const result = await startupPreflight(ctx, { timeoutMs: 60 });
  assert.equal(result.code, 0); assert.equal(result.cause, 'quota-unavailable'); assert.ok(Date.now() - started < 3000);
  assert.equal(hits.filter(p => p === '/quota').length, 1);
});
test('repair aligns only an offline template-owned config and journals adapter changes', async t => {
  const ctx = fixture(t);
  // A real unprivileged free port: Linux (unlike Windows) refuses unprivileged
  // binds to privileged ports, and key alignment must be able to reserve it.
  const freePort = await new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  writeConfig(ctx, freePort, 'old-synthetic-key');
  const { repairManaged } = await api();
  const target = join(ctx.root, 'generated', 'managed.json');
  const adapter = { apply(c, tx) { mkdirSync(c.generated, { recursive: true }); tx.touch(target); writeFileSync(target, c.key()); } };
  await repairManaged(ctx, [adapter]);
  assert.match(readFileSync(ctx.config, 'utf8'), new RegExp(KEY));
  assert.equal(readFileSync(target, 'utf8'), KEY);
  assert.equal(listTransactions(ctx.backupDir).length, 1);
});
test('matching key allows adapter repair with a customized config without rewriting it', async t => {
  const ctx = fixture(t); const { repairManaged } = await api();
  const config = readFileSync(ctx.config, 'utf8').replace('deviceMid: ""', 'deviceMid: "synthetic-device"');
  writeFileSync(ctx.config, config);
  let applied = false;
  await repairManaged(ctx, [{ apply() { applied = true; } }]);
  assert.equal(applied, true); assert.equal(readFileSync(ctx.config, 'utf8'), config);
});
test('repair rolls back earlier writes when a later adapter fails', async t => {
  const ctx = fixture(t); const target = join(ctx.home, 'owned.json'); writeFileSync(target, 'original');
  const { repairManaged } = await api();
  await assert.rejects(repairManaged(ctx, [{ apply(c, tx) { tx.touch(target); writeFileSync(target, 'changed'); } }, { apply() { throw new Error('synthetic failure'); } }]));
  assert.equal(readFileSync(target, 'utf8'), 'original');
  assert.equal(existsSync(join(ctx.backupDir, '.setup-lock')), false);
});
test('repair refuses corrupt, ambiguous, custom and live-listener key drift', async t => {
  const ctx = fixture(t); const { repairManaged } = await api();
  for (const config of ['broken: [', 'auth:\n  proxyApiKey: "a"\n  proxyApiKey: "b"\n', readFileSync(ctx.config, 'utf8').replace('provider: zai', 'provider: other').replace(KEY, 'old')]) {
    writeFileSync(ctx.config, config);
    await assert.rejects(repairManaged(ctx, []));
    assert.equal(readFileSync(ctx.config, 'utf8'), config);
  }
  await mock(t, ctx, { foreign: true }); writeConfig(ctx, ctx.port(), 'old');
  const before = readFileSync(ctx.config, 'utf8');
  await assert.rejects(repairManaged(ctx, []), /listener|occupied/i);
  assert.equal(readFileSync(ctx.config, 'utf8'), before);
});
test('repair refuses checkout writes and preserves a competing transaction lock', async t => {
  const ctx = fixture(t); const { repairManaged } = await api();
  mkdirSync(join(ctx.root, '.git'));
  const prior = process.env.ZCODE_KIT_ALLOW_CHECKOUT; delete process.env.ZCODE_KIT_ALLOW_CHECKOUT;
  try { await assert.rejects(repairManaged(ctx, []), /checkout/); }
  finally { if (prior !== undefined) process.env.ZCODE_KIT_ALLOW_CHECKOUT = prior; }
  rmSync(join(ctx.root, '.git'), { recursive: true });
  const lock = acquireLock(ctx.backupDir); const before = readFileSync(lock, 'utf8');
  try { await assert.rejects(repairManaged(ctx, []), /another setup/); assert.equal(readFileSync(lock, 'utf8'), before); }
  finally { releaseLock(lock); }
});
test('stale pid is removed safely but stale manager lock is not stolen', async t => {
  const ctx = fixture(t); const { startupPreflight } = await api();
  const pid = join(ctx.root, 'logs', 'proxy.pid'); writeFileSync(pid, '{"pid":2147483647,"startedMs":1}');
  assert.equal((await startupPreflight(ctx)).code, 4); // no dependencies: never spawn a proxy
  assert.equal(existsSync(pid), false);
  const lock = join(ctx.root, 'logs', 'manager.lock'); writeFileSync(lock, '{"pid":2147483647,"nonce":"stale"}');
  assert.notEqual((await startupPreflight(ctx)).code, 0);
  assert.equal(readFileSync(lock, 'utf8'), '{"pid":2147483647,"nonce":"stale"}');
});
test('heal log is bounded and only accepts fixed secret-free vocabulary', async t => {
  const ctx = fixture(t); const { logHeal } = await api();
  const path = join(ctx.root, 'logs', 'heal.log'); writeFileSync(path, 'x'.repeat(65536));
  for (let i = 0; i < 20; i++) logHeal(ctx, { cause: KEY, action: 'Bearer SECRET', result: 'SECRET' });
  assert.ok(statSync(path).size < 65536); assert.ok(statSync(path + '.1').size <= 65536);
  assert.ok(!readFileSync(path, 'utf8').includes('SECRET')); assert.ok(!readFileSync(path, 'utf8').includes(KEY));
});
test('setup smoke is one bounded minimal request and explicit opt-out skips all network', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx);
  const { setupSmoke } = await api();
  assert.equal((await setupSmoke(ctx, { env: { ZCODE_KIT_SKIP_SMOKE: '1' } })).cause, 'skipped');
  assert.equal(hits.length, 0);
  assert.equal((await setupSmoke(ctx, { env: {} })).code, 0);
  assert.equal(hits.filter(p => p === '/v1/chat/completions').length, 1);
});
test('setup smoke retries exactly once, and only after a non-quota failure', async t => {
  const { setupSmoke } = await api();
  const smokes = hits => hits.filter(p => p === '/v1/chat/completions').length;
  for (const [status, expectedCode, expectedRequests] of [[502, 0, 2], [400, 0, 2]]) {
    const ctx = fixture(t); const hits = await mock(t, ctx, { smokeStatus: n => n === 1 ? status : 0 });
    assert.equal((await setupSmoke(ctx, { env: {} })).code, expectedCode, `transient HTTP ${status} recovers on the retry`);
    assert.equal(smokes(hits), expectedRequests);
  }
  const failing = fixture(t); const failHits = await mock(t, failing, { smokeStatus: () => 503 });
  assert.equal((await setupSmoke(failing, { env: {} })).code, 1);
  assert.equal(smokes(failHits), 2, 'never more than one retry');
  const quota = fixture(t); const quotaHits = await mock(t, quota, { smokeCode: 1113 });
  assert.equal((await setupSmoke(quota, { env: {} })).cause, 'balance1113');
  assert.equal(smokes(quotaHits), 1, 'a quota verdict is final: no retry');
});
test('setup smoke waits for a captcha token before its single request and tolerates old proxies', async t => {
  const { setupSmoke } = await api();
  const ctx = fixture(t); let polls = 0;
  const hits = await mock(t, ctx, { healthDetails: () => ({ rssMB: 100, captcha: { ready: ++polls >= 3 ? 1 : 0, target: 1 } }) });
  assert.equal((await setupSmoke(ctx, { env: {}, pollMs: 10 })).code, 0);
  assert.ok(polls >= 3, 'readiness is polled until a token is ready');
  assert.ok(hits.lastIndexOf('/health') < hits.indexOf('/v1/chat/completions'), 'the request follows readiness');
  assert.equal(hits.filter(p => p === '/v1/chat/completions').length, 1);
  const unloaded = fixture(t); const unloadedHits = await mock(t, unloaded, { healthDetails: () => ({ captcha: null }) });
  assert.equal((await setupSmoke(unloaded, { env: {}, pollMs: 10 })).code, 0);
  assert.equal(unloadedHits.filter(p => p === '/v1/chat/completions').length, 1);
});
test('setup smoke rejects empty or unfinished choices instead of declaring connectivity', async t => {
  const ctx = fixture(t);
  await mock(t, ctx, { smokeReply: { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: null }] } });
  const { setupSmoke } = await api();
  assert.notEqual((await setupSmoke(ctx, { env: {} })).code, 0);
});

test('manager doctor honors isolated ZCODE_PROXY_CREDENTIALS_PATH', async t => {
  const ctx = fixture(t); const store = join(ctx.home, 'custom-credentials.json'); writeFileSync(store, '{}');
  const previous = process.env.ZCODE_PROXY_CREDENTIALS_PATH; process.env.ZCODE_PROXY_CREDENTIALS_PATH = store;
  const messages = []; const original = console.log; console.log = m => messages.push(String(m));
  try { await createManager({ root: ctx.root, home: ctx.home }).doctor(); }
  finally { console.log = original; if (previous === undefined) delete process.env.ZCODE_PROXY_CREDENTIALS_PATH; else process.env.ZCODE_PROXY_CREDENTIALS_PATH = previous; }
  // The explicit store path is honored, and a file that merely exists is no
  // longer reported as a working credential store (audit F-05).
  const line = messages.find(m => /^\w+\s+credentials store/.test(m));
  assert.ok(line, messages.join('\n'));
  assert.match(line, /ZCODE_PROXY_CREDENTIALS_PATH \(explicit store\)/);
  assert.doesNotMatch(line, /^PASS/);
});
test('bootstrap honors isolated credential store without importing desktop credentials', t => {
  const ctx = fixture(t); const store = join(ctx.home, 'custom-credentials.json'); writeFileSync(store, '{}');
  const previous = { ...process.env }; const messages = []; const original = console.log;
  process.env.ZCODE_PROXY_CREDENTIALS_PATH = store; process.env.ZCODE_KIT_SKIP_DEPS = '1'; console.log = m => messages.push(String(m));
  try { bootstrap(ctx); } finally { console.log = original; for (const key of ['ZCODE_PROXY_CREDENTIALS_PATH', 'ZCODE_KIT_SKIP_DEPS']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  assert.ok(messages.includes('  proxy credentials present'), messages.join('\n'));
});
function runNode(file, args, env, runtime = process.execPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, [file, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
test('doctor --fix --harness uses a guarded transaction and keeps JSON parseable', async t => {
  const ctx = fixture(t);
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, ZCODE_KIT_SKIP_DEPS: '1', ZCODE_PROXY_CREDENTIALS_PATH: join(ctx.home, 'synthetic-credentials.json') };
  delete env.ZCODE_KIT_ALLOW_CHECKOUT;
  const cli = join(ctx.root, 'cli', 'zcode-kit.mjs');
  const result = await runNode(cli, ['doctor', '--fix', '--harness', 'claude-code', '--json'], env);
  assert.equal(result.code, 1, 'missing synthetic dependencies remain diagnosed');
  assert.equal(JSON.parse(result.stdout).checks.find(c => c.name === 'claude-code: claude adapter artifact').ok, true);
  assert.equal(listTransactions(ctx.backupDir).length, 1);
  mkdirSync(join(ctx.root, '.git'));
  const refused = await runNode(cli, ['doctor', '--fix', '--harness', 'claude-code'], env);
  assert.equal(refused.code, 2); assert.match(refused.stderr, /checkout/);
  assert.equal(listTransactions(ctx.backupDir).length, 1);
});
test('OMP session rechecks local health and recovers after failure without per-turn quota calls', async () => {
  const { createSessionPreflight } = await api();
  assert.equal(typeof createSessionPreflight, 'function');
  let time = 1000, runs = 0, healthy = false, fail = true;
  const ensure = createSessionPreflight({ now: () => time, ttlMs: 100, health: async () => healthy, run: async () => { runs++; if (fail) throw new Error('synthetic startup failure'); healthy = true; } });
  await assert.rejects(ensure());
  await ensure(); assert.equal(runs, 1, 'failure cooldown suppresses repeated attempts');
  time += 101; fail = false;
  await Promise.all([ensure(), ensure()]); assert.equal(runs, 2);
  time += 101; await ensure(); assert.equal(runs, 2, 'healthy TTL only calls local health');
  time += 101; healthy = false; await ensure(); assert.equal(runs, 3, 'later proxy crash can restart safely');
});
test('OMP preflight captures child stdout and forwards only secret-free warning categories', async t => {
  const ctx = fixture(t); const quotaBody = snapshot(['balance: 3012 SECRET']); await mock(t, ctx, { quotaBody });
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  const runner = join(ctx.root, 'runner.mjs');
  writeFileSync(runner, `import { runSessionPreflight } from './cli/heal.mjs'; await runSessionPreflight({ root: ${JSON.stringify(ctx.root)} });`);
  const result = await runNode(runner, [], runtimeEnv(ctx));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /auth3012/);
  assert.doesNotMatch(result.stderr, /SECRET|Bearer|synthetic-local-key/);
});
function runtimeEnv(ctx, path = dirname(process.execPath)) {
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path' || key === 'ZCODE_KIT_BUN') delete env[key];
  env.PATH = path;
  return env;
}
function childPreflight(t, source) {
  const ctx = fixture(t);
  const root = join(ctx.root, "kit space $& $' #");
  mkdirSync(join(root, 'cli'), { recursive: true });
  writeFileSync(join(root, 'cli', 'heal.mjs'), source);
  return { ...ctx, root };
}

test('OMP launches native Node with literal spaced paths, kit cwd and deterministic child PATH', async t => {
  const ctx = childPreflight(t, `
    import { writeFileSync } from 'node:fs';
    writeFileSync('launch.json', JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), path: process.env.PATH }));
    console.log('SECRET child stdout');
    console.error('SECRET child stderr');
  `);
  const { runSessionPreflight } = await api();
  const nativeDir = join(ctx.root, 'native runtime'); mkdirSync(nativeDir);
  cpSync(process.execPath, join(nativeDir, process.platform === 'win32' ? 'node.exe' : 'node'));
  const env = runtimeEnv(ctx, nativeDir);
  if (process.platform === 'win32') env.Path = join(ctx.root, 'nonexistent inherited path');
  const warnings = [];
  await runSessionPreflight({ root: ctx.root, env, warn: message => warnings.push(message) });
  const launch = JSON.parse(readFileSync(join(ctx.root, 'launch.json'), 'utf8'));
  assert.equal(launch.cwd, ctx.root);
  assert.deepEqual(launch.args, ['--diagnostic-code']);
  assert.equal(launch.path, nativeDir);
  assert.deepEqual(warnings, [], 'arbitrary child output must not become diagnostics');
});

test('OMP surfaces a hung-proxy recovery alongside the quota warning, and nothing else', async t => {
  const ctx = childPreflight(t, `
    console.error('[zcode-preflight] cause=hung');
    console.error('[zcode-preflight] cause=auth3012');
    console.error('Bearer SECRET [zcode-preflight] cause=hung');
  `);
  const { runSessionPreflight, PREFLIGHT_WARNINGS } = await api();
  const warnings = [];
  await runSessionPreflight({ root: ctx.root, env: runtimeEnv(ctx), warn: message => warnings.push(message) });
  assert.deepEqual(warnings, [
    `[zcode-autostart] hung: ${PREFLIGHT_WARNINGS.hung}`,
    `[zcode-autostart] auth3012: ${PREFLIGHT_WARNINGS.auth3012}`,
  ]);
});

test('OMP ignores Windows shell shims during native runtime discovery', { skip: process.platform !== 'win32' }, async t => {
  const ctx = childPreflight(t, 'process.exitCode = 0;');
  const shimDir = join(ctx.root, 'shim bin'); mkdirSync(shimDir);
  writeFileSync(join(shimDir, 'node.cmd'), '@echo off\r\necho invoked>shim-ran\r\n');
  const { runSessionPreflight } = await api();
  await assert.rejects(runSessionPreflight({ root: ctx.root, env: runtimeEnv(ctx, shimDir) }), { code: 'runtime-unavailable' });
  assert.equal(existsSync(join(ctx.root, 'shim-ran')), false);
});

test('OMP uses the kit native Bun path when Node is absent from the child PATH', async t => {
  const ctx = childPreflight(t, `
    import { writeFileSync } from 'node:fs';
    writeFileSync('runtime.json', JSON.stringify({ bun: Boolean(process.versions.bun), cwd: process.cwd() }));
  `);
  writeFileSync(join(ctx.root, '.bun-path'), resolveBun(ROOT));
  const { runSessionPreflight } = await api();
  await runSessionPreflight({ root: ctx.root, env: runtimeEnv(ctx, '') });
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.root, 'runtime.json'), 'utf8')), { bun: true, cwd: ctx.root });
});

test('OMP runtime discovery failure cools down and recovers after PATH repair', async t => {
  const ctx = childPreflight(t, `import { writeFileSync } from 'node:fs'; writeFileSync('started', 'yes');`);
  const { createSessionPreflight, runSessionPreflight } = await api();
  let time = 1000, attempts = 0;
  const env = runtimeEnv(ctx, '');
  const ensure = createSessionPreflight({ now: () => time, ttlMs: 100, health: async () => false, run: () => {
    attempts++;
    return runSessionPreflight({ root: ctx.root, env });
  } });
  await assert.rejects(ensure(), { code: 'runtime-unavailable' });
  env.PATH = dirname(process.execPath);
  await ensure();
  assert.equal(attempts, 1);
  assert.equal(existsSync(join(ctx.root, 'started')), false);
  time += 101;
  await Promise.all([ensure(), ensure()]);
  assert.equal(attempts, 2);
  assert.equal(readFileSync(join(ctx.root, 'started'), 'utf8'), 'yes');
});

for (const [exitCode, category] of [[3, 'foreign'], [5, 'key'], [4, 'startup']]) {
  test(`OMP reports secret-free ${category} failure without launching another runtime`, async t => {
    const ctx = childPreflight(t, `
      import { appendFileSync } from 'node:fs';
      appendFileSync('attempts', 'x');
      console.log('SECRET stdout'); console.error('Bearer SECRET stderr'); process.exitCode = ${exitCode};
    `);
    // A configured fallback must not rerun a child that actually launched.
    writeFileSync(join(ctx.root, '.bun-path'), process.execPath);
    const { runSessionPreflight } = await api();
    await assert.rejects(runSessionPreflight({ root: ctx.root, env: runtimeEnv(ctx) }), err => {
      assert.equal(err.code, category);
      assert.doesNotMatch(err.message, /SECRET|Bearer/);
      return true;
    });
    assert.equal(readFileSync(join(ctx.root, 'attempts'), 'utf8'), 'x');
  });
}

test('OMP retries a failed native child only after cooldown and recovers in the same session', async t => {
  const ctx = childPreflight(t, `
    import { existsSync, writeFileSync } from 'node:fs';
    if (!existsSync('attempted')) { writeFileSync('attempted', 'yes'); process.exitCode = 4; }
    else writeFileSync('recovered', 'yes');
  `);
  const { createSessionPreflight, runSessionPreflight } = await api();
  let time = 1000;
  const ensure = createSessionPreflight({ now: () => time, ttlMs: 100, health: async () => existsSync(join(ctx.root, 'recovered')), run: () => runSessionPreflight({ root: ctx.root, env: runtimeEnv(ctx) }) });
  await assert.rejects(ensure(), { code: 'startup' });
  await ensure(); assert.equal(existsSync(join(ctx.root, 'recovered')), false);
  time += 100; await ensure();
  assert.equal(readFileSync(join(ctx.root, 'recovered'), 'utf8'), 'yes');
});

test('OMP bounds hung and noisy preflight children without exposing their output', async t => {
  const { runSessionPreflight } = await api();
  const hung = childPreflight(t, 'setInterval(() => {}, 1000);');
  await assert.rejects(runSessionPreflight({ root: hung.root, env: runtimeEnv(hung), timeoutMs: 150 }), { code: 'timeout' });
  const noisy = childPreflight(t, `process.stdout.write('SECRET'.repeat(20000));`);
  await assert.rejects(runSessionPreflight({ root: noisy.root, env: runtimeEnv(noisy) }), err => {
    assert.equal(err.code, 'output-limit');
    assert.doesNotMatch(err.message, /SECRET/);
    return true;
  });
  rmSync(join(noisy.root, 'cli', 'heal.mjs'));
  await assert.rejects(runSessionPreflight({ root: noisy.root, env: runtimeEnv(noisy) }), { code: 'installation' });
});

test('OMP child preflight refuses a real foreign listener without quota calls or pid mutation', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx, { foreign: true });
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  const pid = join(ctx.root, 'logs', 'proxy.pid');
  const record = JSON.stringify({ pid: process.pid, startedMs: 1 }); writeFileSync(pid, record);
  const { runSessionPreflight } = await api();
  await assert.rejects(runSessionPreflight({ root: ctx.root, env: runtimeEnv(ctx) }), { code: 'foreign' });
  assert.equal(readFileSync(pid, 'utf8'), record);
  assert.deepEqual(hits, ['/health']);
  const response = await fetch(`http://127.0.0.1:${ctx.port()}/still-alive`);
  assert.equal(response.status, 401, 'the foreign listener still serves requests');
});

test('generated OMP extension recovers after disk module repair without restarting its Bun host', async t => {
  const brokenModule = `
    import { appendFileSync } from 'node:fs';
    appendFileSync('attempts', 'x');
    throw new Error('SECRET module evaluation failed');
  `;
  const repairedModule = `
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
    appendFileSync('attempts', 'x');
    if (!existsSync('start-failed')) {
      writeFileSync('start-failed', 'yes');
      console.error('Bearer SECRET failed start'); process.exitCode = 4;
    } else {
      writeFileSync('recovered', 'yes');
      console.log('SECRET child stdout');
      console.error('[zcode-preflight] cause=auth3012');
    }
  `;
  const ctx = childPreflight(t, brokenModule);
  mkdirSync(join(ctx.root, 'proxy'));
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-autostart.ts'), join(ctx.root, 'proxy', 'zcode-proxy-autostart.ts'));
  const agent = join(ctx.home, '.omp', 'agent'); mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, 'models.yml'), 'providers:\n  unrelated:\n    apiKey: keep\n');
  writeFileSync(join(agent, 'config.yml'), 'theme: dark\n');
  omp.apply({ ...ctx, proxySrc: join(ROOT, 'zcode-proxy-src'), port: () => 8457 }, { touch() {} }, () => {});
  const extension = join(agent, 'extensions', 'zcode-proxy-autostart.ts');
  const runner = join(ctx.root, 'extension-runner.mjs');
  writeFileSync(runner, `
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
    import { join } from 'node:path';
    import extension from ${JSON.stringify(pathToFileURL(extension).href)};
    const root = ${JSON.stringify(ctx.root)};
    const attempts = () => existsSync(join(root, 'attempts')) ? readFileSync(join(root, 'attempts'), 'utf8') : '';
    const recovered = () => existsSync(join(root, 'recovered'));
    let time = 1000, hook, healthCalls = 0;
    Date.now = () => time;
    const warnings = []; console.error = message => warnings.push(String(message));
    globalThis.fetch = async (url, options) => {
      healthCalls++;
      assert.equal(url, 'http://127.0.0.1:8457/health');
      assert.equal(options.headers.authorization, ${JSON.stringify(`Bearer ${KEY}`)});
      return { ok: true, json: async () => ({ status: 'ok', provider: recovered() ? 'zai' : 'foreign' }) };
    };
    extension({ on(event, handler) { assert.equal(event, 'before_provider_request'); hook = handler; } });
    const request = () => hook({}, { model: { provider: 'zcode' } });
    await hook({}, { model: { provider: 'other' } });
    await hook({}, {});
    assert.equal(attempts(), ''); assert.equal(healthCalls, 0);
    await Promise.all([request(), request()]);
    assert.equal(attempts(), 'x'); assert.equal(recovered(), false);
    assert.equal(warnings.length, 1); assert.match(warnings[0], /startup:/);
    // Repair the very same module path while the same OMP/Bun host stays alive.
    writeFileSync(join(root, 'cli', 'heal.mjs'), ${JSON.stringify(repairedModule)});
    time += 59999; await request(); assert.equal(attempts(), 'x');
    time += 1; await request();
    assert.equal(attempts(), 'xx'); assert.equal(recovered(), false);
    assert.equal(warnings.length, 2); assert.match(warnings[1], /startup:/);
    await request(); assert.equal(attempts(), 'xx');
    time += 60000; await Promise.all([request(), request()]);
    assert.equal(attempts(), 'xxx'); assert.equal(recovered(), true);
    assert.equal(healthCalls, 2); assert.match(warnings[2], /auth3012:/);
    time += 60000; await hook({}, { models: { current: () => ({ provider: 'zcode' }) } });
    assert.equal(attempts(), 'xxx'); assert.equal(healthCalls, 3);
    rmSync(join(root, 'recovered')); time += 60000; await request();
    assert.equal(attempts(), 'xxxx'); assert.equal(recovered(), true); assert.equal(healthCalls, 4);
    assert.doesNotMatch(warnings.join('\\n'), /SECRET|Bearer|synthetic-local-key/);
  `);
  // Execute the actual generated TypeScript in Bun, as OMP does; no source-text assertions.
  const result = await runNode(runner, [], runtimeEnv(ctx, ''), resolveBun(ROOT));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '', 'print-mode stdout remains reserved for model output');
});
