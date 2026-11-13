// All profiles, credentials, providers and listeners in this suite are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import omp from '../cli/adapters/omp.mjs';
import { resolveBun } from '../lib/process.mjs';
import { spawn, spawnSync } from 'node:child_process';
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
// A dead holder's lock is taken over on proof; a lock the
// kit cannot judge (here an unknown higher protocol version) is never stolen.
test('stale pid is removed safely but a manager lock the kit cannot judge is not stolen', async t => {
  const ctx = fixture(t); const { startupPreflight } = await api();
  const pid = join(ctx.root, 'logs', 'proxy.pid'); writeFileSync(pid, '{"pid":2147483647,"startedMs":1}');
  assert.equal((await startupPreflight(ctx)).code, 4); // no dependencies: never spawn a proxy
  assert.equal(existsSync(pid), false);
  const lock = join(ctx.root, 'logs', 'manager.lock'); writeFileSync(lock, '{"pid":2147483647,"nonce":"stale","v":99}');
  assert.notEqual((await startupPreflight(ctx)).code, 0);
  assert.equal(readFileSync(lock, 'utf8'), '{"pid":2147483647,"nonce":"stale","v":99}');
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
  // longer reported as a working credential store.
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
function generateExtension(ctx, port = ctx.port()) {
  mkdirSync(join(ctx.root, 'proxy'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-autostart.ts'), join(ctx.root, 'proxy', 'zcode-proxy-autostart.ts'));
  const agent = join(ctx.home, '.omp', 'agent'); mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, 'models.yml'), 'providers:\n  unrelated:\n    apiKey: keep\n');
  writeFileSync(join(agent, 'config.yml'), 'theme: dark\n');
  omp.apply({ ...ctx, proxySrc: join(ROOT, 'zcode-proxy-src'), port: () => port }, { touch() {} }, () => {});
  return join(agent, 'extensions', 'zcode-proxy-autostart.ts');
}
async function runExtension(ctx, { timeoutMs, runtime, env = runtimeEnv(ctx, '') } = {}) {
  const extension = generateExtension(ctx);
  let source = readFileSync(extension, 'utf8');
  // Exercise production launch/error handling with bounded fixture limits.
  if (timeoutMs) source = source.replace('const START_TIMEOUT_MS = 120_000;', `const START_TIMEOUT_MS = ${timeoutMs};`);
  if (runtime) source = source.replace(/^const RUNTIME = .*;$/m, () => `const RUNTIME = ${JSON.stringify(runtime)};`);
  writeFileSync(extension, source);
  const runner = join(ctx.root, 'extension-runner.mjs');
  writeFileSync(runner, `
    import extension from ${JSON.stringify(pathToFileURL(extension).href)};
    let hook;
    extension({ on(_event, handler) { hook = handler; } });
    await hook({}, { model: { provider: 'zcode' } });
  `);
  const result = await runNode(runner, [], env, resolveBun(ROOT));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '', 'child stdout must not reach model output');
  assert.doesNotMatch(result.stderr, /SECRET|Bearer|synthetic-local-key/);
  return result.stderr;
}

// ── One preflight for the OMP hosts that start together ──────────────────────
// The hosts share an autostart token in the logs directory: its holder runs
// the preflight, the others wait in their own process for its result record.
const WIN = process.platform === 'win32';
const POSIX_ONLY = WIN && 'ends real processes at exact steps and names dead pids; Windows hands a freed pid to a new process at once';
const ADMISSION = pathToFileURL(join(ROOT, 'lib', 'autostart-admission.mjs')).href;
const autostartFiles = ctx => existsSync(ctx.logDir) ? readdirSync(ctx.logDir).filter(name => name.startsWith('omp-autostart.')).sort() : [];
const tokenOf = ctx => JSON.parse(readFileSync(join(ctx.logDir, 'omp-autostart.token'), 'utf8'));
const resultOf = ctx => JSON.parse(readFileSync(join(ctx.logDir, 'omp-autostart.result'), 'utf8'));
const fileText = (ctx, name) => existsSync(join(ctx.root, name)) ? readFileSync(join(ctx.root, name), 'utf8') : '';
async function until(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await new Promise(r => setTimeout(r, 10)); }
  return check();
}
// A fixture preflight that behaves like the real one where it matters here: it
// works only once its host's token names it, appends one `x` to `attempts`
// per run that worked, one to `overlap` when two worked at once and one to
// `refused` when it was not admitted.
function sharedPreflight(t, { holdMs = 300, cause = 'hung', exitCode = 0 } = {}) {
  return childPreflight(t, `
    import { appendFileSync, openSync, unlinkSync } from 'node:fs';
    import { autostartAdmitted } from ${JSON.stringify(ADMISSION)};
    if (!autostartAdmitted(process.argv.slice(2))) { appendFileSync('refused', 'x'); process.exit(4); }
    let fd;
    try { fd = openSync('working', 'wx'); } catch { appendFileSync('overlap', 'x'); }
    appendFileSync('attempts', 'x');
    await new Promise(r => setTimeout(r, ${holdMs}));
    if (fd !== undefined) unlinkSync('working');
    console.error('[zcode-preflight] cause=${cause}');
    process.exitCode = ${exitCode};
  `);
}
// The generated extension with fixture limits: `edits` maps a line of the template to its replacement.
function editedExtension(ctx, edits = {}) {
  const extension = generateExtension(ctx);
  let source = readFileSync(extension, 'utf8');
  for (const [line, replacement] of Object.entries(edits)) {
    assert.ok(source.includes(line), `the generated extension has the line ${line}`);
    source = source.replace(line, () => replacement);
  }
  writeFileSync(extension, source);
  return extension;
}
const TIMEOUT_LINE = 'const START_TIMEOUT_MS = 120_000;';
const PLATFORM_LINE = 'const PLATFORM: string = process.platform;';
const STEP_LINE = 'const step = (_name: string): void => {};';
// Ends the host with SIGKILL at the protocol step named in ZCODE_TEST_KILL_AT.
const KILL_AT_STEP = `const step = (name: string): void => { if (name === process.env.ZCODE_TEST_KILL_AT) process.kill(process.pid, 'SIGKILL'); };`;
// Source for a runner: the identity a token records for a live process.
const IDENTITY_OF = `
  const identityOf = pid => {
    const id = { pid, startMs: Date.now() };
    try {
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
      id.startId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    } catch {}
    return id;
  };
  const newNonce = () => crypto.randomUUID().replaceAll('-', '');
  const newToken = (host, more = {}) => ({ v: 1, nonce: newNonce(), at: Date.now(), host, child: null, ...more });
`;
// One stub host process: it loads the generated extension in Bun, as OMP does,
// and fires its hook once. Resolves with what the extension printed.
// With ZCODE_TEST_BARRIER=<path> the host loads the extension, writes
// <path>.<pid> and makes its first request only once <path>.go exists, so that
// hosts started together also ask together however slowly each one starts.
function runHost(ctx, extension, env = {}) {
  const script = join(ctx.root, 'omp-host.mjs');
  writeFileSync(script, `
    import { existsSync, writeFileSync } from 'node:fs';
    import extension from ${JSON.stringify(pathToFileURL(extension).href)};
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', provider: 'zai' }) });
    let hook; extension({ on(_event, handler) { hook = handler; } });
    const barrier = process.env.ZCODE_TEST_BARRIER;
    if (barrier) {
      writeFileSync(barrier + '.' + process.pid, '');
      while (!existsSync(barrier + '.go')) await new Promise(r => setTimeout(r, 5));
    }
    await hook({}, { model: { provider: 'zcode' } });
    // A host process that ends right after printing can lose what is still
    // buffered for a pipe; OMP keeps running, this stand-in does not.
    await new Promise(r => process.stderr.write('', () => r()));
  `);
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBun(ROOT), [script], { env: { ...runtimeEnv(ctx, ''), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, pid: child.pid }));
  });
}
// Runs `body` (module source) in one Bun process that has the extension loaded.
async function runInHost(ctx, extension, body, env = runtimeEnv(ctx, '')) {
  const runner = join(ctx.root, 'in-host-runner.mjs');
  writeFileSync(runner, `
    import assert from 'node:assert/strict';
    import { spawn, spawnSync } from 'node:child_process';
    import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
    import extension from ${JSON.stringify(pathToFileURL(extension).href)};
    const root = ${JSON.stringify(ctx.root)}, logs = ${JSON.stringify(ctx.logDir)};
    const token = logs + '/omp-autostart.token', result = logs + '/omp-autostart.result';
    mkdirSync(logs, { recursive: true });
    const text = name => existsSync(root + '/' + name) ? readFileSync(root + '/' + name, 'utf8') : '';
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (check, ms = 5000) => { for (const end = performance.now() + ms; performance.now() < end;) { if (check()) return true; await sleep(10); } return check(); };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', provider: 'zai' }) });
    const printed = []; console.error = line => printed.push(String(line));
    // Every call is one more host of this installation (its own extension instance).
    const request = () => { let hook; extension({ on(_event, handler) { hook = handler; } }); return hook({}, { model: { provider: 'zcode' } }); };
    ${IDENTITY_OF}
    ${body}
  `);
  const run = await runNode(runner, [], env, resolveBun(ROOT));
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, '', 'nothing reaches the model output');
}

test('generated OMP hosts that start together share one preflight, and every waiter prints the starter\'s cause lines', async t => {
  const ctx = sharedPreflight(t);
  await runInHost(ctx, generateExtension(ctx), `
    const hosts = Array.from({ length: 5 }, request);
    assert.ok(await until(() => existsSync(token) && JSON.parse(readFileSync(token, 'utf8')).child));
    const held = JSON.parse(readFileSync(token, 'utf8'));
    assert.equal(held.host.pid, process.pid);
    assert.notEqual(held.child.pid, process.pid, 'the token names the preflight process');
    if (process.platform !== 'win32') assert.equal(statSync(token).mode & 0o777, 0o600);
    await Promise.all(hosts);
    assert.equal(text('attempts'), 'x', 'only the starter spawned a preflight');
    assert.equal(text('overlap') + text('refused'), '');
    assert.equal(printed.length, 5, printed.join('\\n'));
    assert.ok(printed.every(line => line === printed[0] && line.startsWith('[zcode-autostart] hung: ')), printed.join('\\n'));
    const record = JSON.parse(readFileSync(result, 'utf8'));
    assert.deepEqual({ v: record.v, nonce: record.nonce, host: record.host, exitCode: record.exitCode, lines: record.lines },
      { v: 1, nonce: held.nonce, host: held.host, exitCode: 0, lines: ['cause=hung'] });
    if (process.platform !== 'win32') assert.equal(statSync(result).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(logs).filter(name => name.startsWith('omp-autostart.')), ['omp-autostart.result'], 'the token is released, nothing else is left');
  `);
});

test('generated OMP host processes that start together run one preflight between them', async t => {
  const ctx = sharedPreflight(t, { holdMs: 500 });
  const extension = generateExtension(ctx);
  const barrier = join(ctx.root, 'barrier');
  const running = Array.from({ length: 5 }, () => runHost(ctx, extension, { ZCODE_TEST_BARRIER: barrier }));
  const ready = () => readdirSync(ctx.root).filter(name => /^barrier\.\d+$/.test(name)).length;
  for (const end = Date.now() + 60_000; ready() < 5 && Date.now() < end;) await new Promise(r => setTimeout(r, 10));
  assert.equal(ready(), 5, 'every host loaded the extension');
  writeFileSync(`${barrier}.go`, '');
  const hosts = await Promise.all(running);
  assert.equal(fileText(ctx, 'attempts'), 'x');
  assert.equal(fileText(ctx, 'overlap') + fileText(ctx, 'refused'), '');
  for (const host of hosts) {
    assert.equal(host.code, 0, host.stderr);
    assert.match(host.stderr, /^\[zcode-autostart\] hung: .+\n$/);
    assert.equal(host.stdout, '');
  }
  assert.deepEqual(autostartFiles(ctx), ['omp-autostart.result']);
});

test('generated OMP waiter runs its own preflight when the shared one failed, one host at a time', async t => {
  const ctx = sharedPreflight(t, { holdMs: 100, exitCode: 3 });
  await runInHost(ctx, generateExtension(ctx), `
    await Promise.all(Array.from({ length: 3 }, request));
    assert.equal(text('attempts'), 'xxx', 'every host ran its own');
    assert.equal(text('overlap') + text('refused'), '', 'never two at once');
    assert.equal(printed.length, 3);
    assert.ok(printed.every(line => /^\\[zcode-autostart\\] foreign: .+ Next zcode request after 60s may retry\\.$/.test(line)), printed.join('\\n'));
    assert.equal(JSON.parse(readFileSync(result, 'utf8')).exitCode, 3);
  `);
});

test('generated OMP waiter prints a result only when it is its starter\'s own, fresh and well-formed; otherwise it runs its own preflight', async t => {
  const ctx = sharedPreflight(t, { holdMs: 30 });
  await runInHost(ctx, generateExtension(ctx), `
    // A starter that is alive and holds the token: this process. The "starter" then leaves a record and releases.
    const attempt = async leave => {
      const held = newToken(identityOf(process.pid));
      writeFileSync(token, JSON.stringify(held), { mode: 0o600 });
      const before = text('attempts'), lines = printed.length;
      const waiter = request();
      await sleep(120);
      assert.equal(readFileSync(token, 'utf8'), JSON.stringify(held), 'a live starter\\'s token is never touched');
      assert.equal(text('attempts'), before, 'and no preflight runs beside it');
      const raw = leave({ v: 1, nonce: held.nonce, host: held.host, at: Date.now(), exitCode: 0, lines: ['cause=auth3012'] });
      if (raw === null) { try { unlinkSync(result); } catch {} } else writeFileSync(result, raw);
      unlinkSync(token);
      await waiter;
      return { ran: text('attempts').length - before.length, printed: printed.slice(lines), held };
    };
    const good = await attempt(r => JSON.stringify(r));
    assert.equal(good.ran, 0, 'a matching record replaces the waiter\\'s preflight');
    assert.equal(good.printed.length, 1);
    assert.match(good.printed[0], /^\\[zcode-autostart\\] auth3012: /);
    const rejected = {
      'no record': () => null,
      'not JSON': () => '{partial',
      'oversized': r => JSON.stringify(r) + ' '.repeat(4096),
      'older than the wait': r => JSON.stringify({ ...r, at: r.at - 60000 }),
      'another attempt': r => JSON.stringify({ ...r, nonce: newNonce() }),
      'another host pid': r => JSON.stringify({ ...r, host: { ...r.host, pid: r.host.pid + 1 } }),
      'another host start': r => JSON.stringify({ ...r, host: { ...r.host, startMs: r.host.startMs + 1 } }),
      'another version': r => JSON.stringify({ ...r, v: 2 }),
      'free text beside a cause': r => JSON.stringify({ ...r, lines: ['cause=hung', 'Bearer SECRET'] }),
      'a cause outside the vocabulary': r => JSON.stringify({ ...r, lines: ['cause=not-a-cause'] }),
      'a cause with a line break': r => JSON.stringify({ ...r, lines: ['cause=hung\\n'] }),
      'too many lines': r => JSON.stringify({ ...r, lines: Array(17).fill('cause=hung') }),
      'a failed attempt': r => JSON.stringify({ ...r, exitCode: 4, lines: [] }),
      'an exit code that is no number': r => JSON.stringify({ ...r, exitCode: '0' }),
    };
    for (const [name, leave] of Object.entries(rejected)) {
      const bad = await attempt(leave);
      assert.equal(bad.ran, 1, name + ': the waiter ran its own preflight');
      assert.deepEqual(bad.printed.map(line => line.split(':')[0]), ['[zcode-autostart] hung'], name + ': nothing of the record was printed');
      const own = JSON.parse(readFileSync(result, 'utf8'));
      assert.notEqual(own.nonce, bad.held.nonce, name + ': the record now is the waiter\\'s own attempt');
      assert.deepEqual(own.lines, ['cause=hung']);
    }
    assert.equal(text('overlap') + text('refused'), '');
    assert.doesNotMatch(printed.join('\\n'), /SECRET|Bearer/);
  `);
});

test('generated OMP never runs a second preflight beside a live one, however old the token is', async t => {
  const ctx = sharedPreflight(t, { holdMs: 600 });
  await runInHost(ctx, generateExtension(ctx), `
    let clock = Date.now(); Date.now = () => clock;
    const first = request();
    assert.ok(await until(() => existsSync(root + '/working')));
    clock += 120001; // the token is now older than the start timeout, its preflight still runs
    const second = request();
    await Promise.all([first, second]);
    assert.equal(text('overlap'), '', 'age is no proof that the preflight is gone');
    assert.equal(text('attempts'), 'x');
    assert.deepEqual(printed.map(line => line.split(':')[0]), ['[zcode-autostart] hung', '[zcode-autostart] hung']);
  `);
});

test('generated OMP waiter gives up at the start timeout without a preflight of its own while the token\'s processes live', async t => {
  const ctx = sharedPreflight(t);
  await runInHost(ctx, generateExtension(ctx), `
    let clock = Date.now(); Date.now = () => clock;
    const held = JSON.stringify(newToken(identityOf(process.pid)));
    writeFileSync(token, held, { mode: 0o600 });
    const waiter = request();
    await sleep(150);
    assert.equal(printed.length, 0, 'still waiting');
    clock += 119999; await sleep(150);
    assert.equal(printed.length, 0, 'the wait lasts the whole start timeout');
    clock += 1; await waiter;
    assert.equal(printed.length, 1);
    assert.match(printed[0], /^\\[zcode-autostart\\] timeout: /);
    assert.equal(text('attempts'), '', 'no preflight was started');
    assert.equal(readFileSync(token, 'utf8'), held, 'the live token is untouched');
  `);
});

test('generated OMP takes over a token only on proof that its host and its preflight are gone', { skip: POSIX_ONLY }, async t => {
  const ctx = sharedPreflight(t, { holdMs: 50 });
  await runInHost(ctx, generateExtension(ctx), `
    const exited = spawnSync(process.execPath, ['-e', '']);
    assert.equal(exited.status, 0);
    const dead = { pid: exited.pid, startMs: Date.now() };
    // The host is gone and it never started a preflight: five hosts, one takeover, one preflight.
    writeFileSync(token, JSON.stringify(newToken(dead)));
    await Promise.all(Array.from({ length: 5 }, request));
    assert.equal(text('attempts'), 'x');
    assert.equal(printed.length, 5);
    // The host is gone, the preflight it started still runs: nobody starts another until that one ends.
    const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    assert.ok(await until(() => existsSync('/proc') ? existsSync('/proc/' + orphan.pid + '/stat') : true));
    const held = JSON.stringify(newToken(dead, { at: Date.now() - 10 * 60000, child: identityOf(orphan.pid) }));
    writeFileSync(token, held);
    const waiters = Array.from({ length: 3 }, request);
    await sleep(400);
    assert.equal(text('attempts'), 'x', 'no preflight beside the live one, although the token is ten minutes old');
    assert.equal(readFileSync(token, 'utf8'), held);
    const gone = new Promise(r => orphan.once('exit', r));
    orphan.kill('SIGKILL'); await gone;
    await Promise.all(waiters);
    assert.equal(text('attempts'), 'xx', 'one of them took over once the preflight was gone');
    assert.equal(printed.length, 8);
    // A reused pid: the pid is alive, but it is not the process the token names.
    if (process.platform === 'linux') {
      const reused = identityOf(process.pid);
      reused.startId = reused.startId.replace(/\\d+$/, ticks => String(Number(ticks) + 1));
      writeFileSync(token, JSON.stringify(newToken(reused)));
      await request();
      assert.equal(text('attempts'), 'xxx');
    }
    assert.equal(text('overlap') + text('refused'), '');
    assert.ok(printed.every(line => line.startsWith('[zcode-autostart] hung: ')), printed.join('\\n'));
    assert.deepEqual(readdirSync(logs).filter(name => name.startsWith('omp-autostart.')), ['omp-autostart.result']);
  `);
});

test('generated OMP where a start time costs a process asks for it only for an overdue token, and takes over only a reused pid', { skip: POSIX_ONLY }, async t => {
  for (const [platform, tool, answer] of [
    ['darwin', 'ps', ms => new Date(ms).toString().replace(/ GMT.*$/, '').replace(/^(\w+ \w+ \d+) (\d+) (.+)$/, '$1 $3 $2')],
    ['win32', 'powershell', ms => String(BigInt(ms) * 10000n + 621355968000000000n)],
  ]) {
    const ctx = sharedPreflight(t, { holdMs: 30 });
    const bin = join(ctx.root, 'fake-tools'); mkdirSync(bin);
    const extension = editedExtension(ctx, { [PLATFORM_LINE]: `const PLATFORM: string = ${JSON.stringify(platform)};`, [TIMEOUT_LINE]: 'const START_TIMEOUT_MS = 600;' });
    // The fake tool answers with the start time in `started` and counts its calls.
    writeFileSync(join(bin, tool), `#!/bin/sh\nprintf x >> "${bin}/asked"\ncat "${bin}/started"\n`, { mode: 0o755 });
    const started = Date.now() - 5000;
    writeFileSync(join(bin, 'started'), answer(started) + '\n');
    await runInHost(ctx, extension, `
      const asked = () => existsSync(${JSON.stringify(join(bin, 'asked'))}) ? readFileSync(${JSON.stringify(join(bin, 'asked'))}, 'utf8') : '';
      const live = { pid: process.pid, startMs: ${started} + 1000 }; // this process, created no later than a second after the answer
      // A young token of a live pid: nobody asks, the waiter waits out its bound.
      const young = JSON.stringify(newToken(live));
      writeFileSync(token, young);
      const waiting = request();
      await sleep(300);
      assert.equal(asked(), '', 'no process is started for a token that may still be in use');
      await waiting;
      assert.match(printed.pop(), /^\\[zcode-autostart\\] timeout: /);
      assert.equal(readFileSync(token, 'utf8'), young);
      // An overdue token whose pid still names the recorded process: asked once, left alone.
      const calls = asked().length;
      const overdue = JSON.stringify(newToken(live, { at: Date.now() - 60000 }));
      writeFileSync(token, overdue);
      await request();
      assert.match(printed.pop(), /^\\[zcode-autostart\\] timeout: /);
      assert.equal(asked().length, calls + 1, 'one question per process and wait');
      assert.equal(readFileSync(token, 'utf8'), overdue);
      assert.equal(text('attempts'), '');
      // An overdue token whose pid now names a process created later: proof of reuse, taken over.
      writeFileSync(token, JSON.stringify(newToken({ pid: process.pid, startMs: ${started} - 60000 }, { at: Date.now() - 60000 })));
      await request();
      assert.match(printed.pop(), /^\\[zcode-autostart\\] hung: /);
      assert.equal(text('attempts'), 'x');
      assert.equal(printed.length, 0);
    `, runtimeEnv(ctx, `${bin}:/usr/bin:/bin`));
  }
});

test('generated OMP runs its preflight without the token when the token cannot be used, and leaves a foreign file alone', async t => {
  for (const foreign of ['not a token', JSON.stringify({ v: 2, nonce: '0'.repeat(32), at: 1, host: { pid: 1, startMs: 1 } }), 'x'.repeat(5000)]) {
    const ctx = sharedPreflight(t, { holdMs: 30 });
    await runInHost(ctx, generateExtension(ctx), `
      writeFileSync(token, ${JSON.stringify(foreign)});
      await Promise.all([request(), request()]);
      assert.equal(text('attempts'), 'xx', 'each host ran its own, as before the token existed');
      assert.equal(printed.length, 2);
      assert.ok(printed.every(line => line.startsWith('[zcode-autostart] hung: ')), printed.join('\\n'));
      assert.equal(readFileSync(token, 'utf8'), ${JSON.stringify(foreign)}, 'never deleted, never overwritten');
      assert.equal(existsSync(result), false, 'only a token holder writes the result');
    `);
  }
  // A logs directory that cannot be created.
  const blocked = sharedPreflight(t, { holdMs: 30 });
  rmSync(blocked.logDir, { recursive: true, force: true });
  writeFileSync(blocked.logDir, 'a file where the logs directory belongs');
  assert.match(await runExtension(blocked), /^\[zcode-autostart\] hung: /);
  assert.equal(fileText(blocked, 'attempts'), 'x');
});

// Every step of the token protocol, as the template names them.
const STARTER_STEPS = ['token:temp-written', 'token:linked', 'token:temp-removed', 'token:acquired', 'child:spawned', 'child:temp-written', 'child:published', 'child:exited', 'result:temp-written', 'result:published', 'token:released'];
const TAKEOVER_STEPS = ['claim:temp-written', 'claim:linked', 'claim:temp-removed', 'takeover:rechecked', 'takeover:removed', 'takeover:claim-released'];

test('the kill tests below cover every step the generated OMP token protocol names', () => {
  const template = readFileSync(join(ROOT, 'proxy', 'zcode-proxy-autostart.ts'), 'utf8');
  const named = new Set();
  for (const match of template.matchAll(/\bstep\((?:"([^"]+)"|`\$\{kind\}:([^`]+)`)\)/g)) {
    if (match[1]) named.add(match[1]);
    else for (const kind of ['token', 'claim']) named.add(`${kind}:${match[2]}`);
  }
  assert.deepEqual([...named].sort(), [...STARTER_STEPS, ...TAKEOVER_STEPS].sort());
});

for (const step of STARTER_STEPS) {
  test(`generated OMP starter killed at ${step}: the next host runs exactly one preflight of its own, never beside another`, { skip: POSIX_ONLY }, async t => {
    const ctx = sharedPreflight(t, { holdMs: 300 });
    const extension = editedExtension(ctx, { [STEP_LINE]: KILL_AT_STEP });
    const starter = await runHost(ctx, extension, { ZCODE_TEST_KILL_AT: step });
    assert.equal(starter.signal, 'SIGKILL', starter.stderr);
    assert.equal(starter.stderr, '', 'the starter printed nothing before it died');
    // What the starter left behind at this step.
    const spawned = STARTER_STEPS.indexOf(step) >= STARTER_STEPS.indexOf('child:spawned');
    const published = STARTER_STEPS.indexOf(step) >= STARTER_STEPS.indexOf('child:published');
    const files = autostartFiles(ctx);
    let left = null;
    if (step === 'token:temp-written') assert.equal(files.includes('omp-autostart.token'), false);
    else if (step === 'token:released') {
      assert.deepEqual(files, ['omp-autostart.result']);
      assert.equal(resultOf(ctx).exitCode, 0);
    } else {
      left = tokenOf(ctx);
      assert.equal(left.host.pid, starter.pid);
      assert.equal(Boolean(left.child), published, 'the token names the preflight from child:published on');
      // The result is written before the token is released.
      assert.equal(files.includes('omp-autostart.result') && resultOf(ctx).nonce === left.nonce, step === 'result:published');
    }
    const next = await runHost(ctx, extension);
    assert.equal(next.code, 0, next.stderr);
    assert.match(next.stderr, /^\[zcode-autostart\] hung: .+\n$/, 'the next host finished with its own preflight\'s cause line');
    // A preflight the starter spawned but never named in its token must not work.
    if (spawned && !published) assert.ok(await until(() => fileText(ctx, 'refused') === 'x'), 'the unnamed preflight left without working');
    assert.equal(fileText(ctx, 'refused'), spawned && !published ? 'x' : '');
    assert.equal(fileText(ctx, 'attempts'), published ? 'xx' : 'x');
    assert.equal(fileText(ctx, 'overlap'), '', 'no two preflights worked at once');
    assert.deepEqual(autostartFiles(ctx), ['omp-autostart.result'], 'nothing of the dead starter is left');
    const record = resultOf(ctx);
    assert.equal(record.host.pid, next.pid);
    assert.notEqual(record.nonce, left?.nonce);
    assert.deepEqual({ exitCode: record.exitCode, lines: record.lines }, { exitCode: 0, lines: ['cause=hung'] });
  });
}

for (const step of TAKEOVER_STEPS) {
  test(`generated OMP host killed at ${step} while taking over a dead starter's token: the next host still takes over and runs one preflight`, { skip: POSIX_ONLY }, async t => {
    const ctx = sharedPreflight(t, { holdMs: 50 });
    const extension = editedExtension(ctx, { [STEP_LINE]: KILL_AT_STEP });
    const starter = await runHost(ctx, extension, { ZCODE_TEST_KILL_AT: 'child:exited' });
    assert.equal(starter.signal, 'SIGKILL', starter.stderr);
    const stale = readFileSync(join(ctx.logDir, 'omp-autostart.token'), 'utf8');
    const taker = await runHost(ctx, extension, { ZCODE_TEST_KILL_AT: step });
    assert.equal(taker.signal, 'SIGKILL', taker.stderr);
    assert.equal(fileText(ctx, 'attempts'), 'x', 'the host that died taking over started nothing');
    // The stale token leaves only through the claimant, after its re-read.
    const removed = TAKEOVER_STEPS.indexOf(step) >= TAKEOVER_STEPS.indexOf('takeover:removed');
    assert.equal(existsSync(join(ctx.logDir, 'omp-autostart.token')), !removed);
    if (!removed) assert.equal(readFileSync(join(ctx.logDir, 'omp-autostart.token'), 'utf8'), stale);
    const next = await runHost(ctx, extension);
    assert.equal(next.code, 0, next.stderr);
    assert.match(next.stderr, /^\[zcode-autostart\] hung: .+\n$/);
    assert.equal(fileText(ctx, 'attempts'), 'xx');
    assert.equal(fileText(ctx, 'overlap') + fileText(ctx, 'refused'), '');
    assert.deepEqual(autostartFiles(ctx), ['omp-autostart.result'], 'no claim or temp file is left');
    assert.equal(resultOf(ctx).host.pid, next.pid);
  });
}

test('generated OMP waiter whose own deadline passes while a dead starter\'s preflight still runs starts no second preflight', { skip: POSIX_ONLY }, async t => {
  const ctx = sharedPreflight(t, { holdMs: 1500 });
  const extension = editedExtension(ctx, { [STEP_LINE]: KILL_AT_STEP, [TIMEOUT_LINE]: 'const START_TIMEOUT_MS = 400;' });
  const starter = await runHost(ctx, extension, { ZCODE_TEST_KILL_AT: 'child:published' });
  assert.equal(starter.signal, 'SIGKILL', starter.stderr);
  // The starter is gone; the preflight it started and named in its token works on for 1.5 s.
  const waiter = await runHost(ctx, extension);
  assert.equal(waiter.code, 0, waiter.stderr);
  assert.match(waiter.stderr, /^\[zcode-autostart\] timeout: .+ Next zcode request after 60s may retry\.\n$/);
  assert.equal(existsSync(join(ctx.root, 'working')), true, 'the dead starter\'s preflight is still running');
  assert.equal(fileText(ctx, 'attempts'), 'x', 'and the waiter started none');
  assert.equal(tokenOf(ctx).host.pid, starter.pid, 'the token is still the dead starter\'s');
  // Once that preflight is gone, the next host takes over and runs its own.
  assert.ok(await until(() => !existsSync(join(ctx.root, 'working'))));
  const next = await runHost(ctx, generateExtension(ctx));
  assert.match(next.stderr, /^\[zcode-autostart\] hung: /);
  assert.equal(fileText(ctx, 'attempts'), 'xx');
  assert.equal(fileText(ctx, 'overlap') + fileText(ctx, 'refused'), '');
});

test('a preflight started for an autostart token runs only while that token names it', async () => {
  const { autostartAdmitted } = await import('../lib/autostart-admission.mjs');
  const nonce = 'a'.repeat(36), args = ['--diagnostic-code', '--autostart-token=/logs/token', `--autostart-nonce=${nonce}`];
  const reads = (...answers) => { const sleeps = []; let i = 0; return { sleeps, read: path => { assert.equal(path, '/logs/token'); const a = answers[Math.min(i++, answers.length - 1)]; if (a instanceof Error) throw a; return JSON.stringify(a); }, sleep: ms => sleeps.push(ms), pid: 42, waitMs: 100, pollMs: 20 }; };
  const error = code => Object.assign(new Error(code), { code });
  assert.equal(autostartAdmitted(['--diagnostic-code'], reads(error('ENOENT'))), true, 'not started for a token: nothing is asked');
  assert.equal(autostartAdmitted(args, reads({ nonce, child: { pid: 42 } })), true);
  const late = reads({ nonce, child: null }, { nonce, child: null }, { nonce, child: { pid: 42 } });
  assert.equal(autostartAdmitted(args, late), true, 'waits for its host to name it');
  assert.deepEqual(late.sleeps, [20, 20]);
  const gone = reads(error('ENOENT'));
  assert.equal(autostartAdmitted(args, gone), false, 'the token is gone');
  assert.deepEqual(gone.sleeps, [], 'and that needs no wait');
  assert.equal(autostartAdmitted(args, reads({ nonce: 'b'.repeat(36), child: { pid: 42 } })), false, 'another attempt\'s token');
  assert.equal(autostartAdmitted(args, reads({ nonce, child: { pid: 43 } })), false, 'the token names another process, and stays that way');
  const never = reads({ nonce, child: null });
  assert.equal(autostartAdmitted(args, never), false, 'never named: gives up after the wait');
  assert.equal(never.sleeps.length, 5);
  assert.equal(autostartAdmitted(args, reads(error('EBUSY'), { nonce, child: { pid: 42 } })), true, 'a busy file is read again');
});

test('the preflight started for an autostart token that is gone leaves at once: no start, no quota call, no log line', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx);
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  const args = ['--diagnostic-code', `--autostart-token=${join(ctx.logDir, 'omp-autostart.token')}`, `--autostart-nonce=${'a'.repeat(32)}`];
  const left = await runNode(join(ctx.root, 'cli', 'heal.mjs'), args, runtimeEnv(ctx));
  assert.deepEqual(left, { code: 4, stdout: '', stderr: '' });
  assert.deepEqual(hits, [], 'the proxy was never asked');
  assert.equal(existsSync(join(ctx.logDir, 'heal.log')), false);
  // The same preflight runs once its host's token names it, as the host writes it: the token, the spawn, then the child's pid.
  const held = { v: 1, nonce: 'a'.repeat(32), at: Date.now(), host: { pid: process.pid, startMs: 1 }, child: null };
  writeFileSync(join(ctx.logDir, 'omp-autostart.token'), JSON.stringify(held));
  const child = spawn(process.execPath, [join(ctx.root, 'cli', 'heal.mjs'), ...args], { env: runtimeEnv(ctx), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => stderr += b);
  writeFileSync(join(ctx.logDir, 'omp-autostart.token'), JSON.stringify({ ...held, child: { pid: child.pid, startMs: Date.now() } }));
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0, stderr);
  assert.match(stderr, /^\[zcode-preflight\] cause=healthy$/m);
  assert.ok(hits.includes('/quota'), hits.join());
});

test('generated OMP preflight captures output and forwards only secret-free quota warnings', async t => {
  const ctx = fixture(t); await mock(t, ctx, { quotaBody: snapshot(['balance: 3012 SECRET']) });
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  assert.match(await runExtension(ctx), /auth3012:/);
});

test('generated OMP launches pinned Node with literal paths and kit cwd even without PATH', async t => {
  const ctx = childPreflight(t, `
    import { writeFileSync } from 'node:fs';
    writeFileSync('launch.json', JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), path: process.env.PATH, bun: Boolean(process.versions.bun) }));
    console.log('SECRET child stdout'); console.error('SECRET child stderr');
  `);
  const env = runtimeEnv(ctx, '');
  if (process.platform === 'win32') env.Path = join(ctx.root, 'nonexistent inherited path');
  assert.equal(await runExtension(ctx, { env }), '');
  const launch = JSON.parse(readFileSync(join(ctx.root, 'launch.json'), 'utf8'));
  // The preflight is told which autostart attempt it belongs to: the token's path and that attempt's nonce.
  const [token, nonce] = launch.args.splice(1);
  assert.equal(token, `--autostart-token=${join(ctx.logDir, 'omp-autostart.token').replace(/\\/g, '/')}`);
  assert.match(nonce, /^--autostart-nonce=[0-9a-f]{32}$/);
  assert.deepEqual(launch, { cwd: ctx.root, args: ['--diagnostic-code'], path: '', bun: false });
});

test('generated OMP surfaces recovery and quota warnings and ignores arbitrary child text', async t => {
  const ctx = childPreflight(t, `
    console.error('[zcode-preflight] cause=hung');
    console.error('[zcode-preflight] cause=auth3012');
    console.error('Bearer SECRET [zcode-preflight] cause=hung');
  `);
  const { PREFLIGHT_WARNINGS } = await api();
  assert.equal(await runExtension(ctx),
    `[zcode-autostart] hung: ${PREFLIGHT_WARNINGS.hung}\n[zcode-autostart] auth3012: ${PREFLIGHT_WARNINGS.auth3012}\n`);
});

for (const [exitCode, category] of [[3, 'foreign'], [5, 'key'], [4, 'startup']]) {
  test(`generated OMP reports secret-free ${category} failure without a second launch`, async t => {
    const ctx = childPreflight(t, `
      import { appendFileSync } from 'node:fs';
      appendFileSync('attempts', 'x');
      console.log('SECRET stdout'); console.error('Bearer SECRET stderr'); process.exitCode = ${exitCode};
    `);
    assert.match(await runExtension(ctx), new RegExp(`${category}:`));
    assert.equal(readFileSync(join(ctx.root, 'attempts'), 'utf8'), 'x');
    // A failed attempt leaves its result (the exit code, no cause lines) and no token.
    const record = JSON.parse(readFileSync(join(ctx.logDir, 'omp-autostart.result'), 'utf8'));
    assert.equal(record.exitCode, exitCode);
    assert.deepEqual(record.lines, []);
    assert.deepEqual(autostartFiles(ctx), ['omp-autostart.result']);
  });
}

test('generated OMP bounds hung and noisy children and diagnoses missing files/runtimes', async t => {
  const hung = childPreflight(t, 'setInterval(() => {}, 1000);');
  assert.match(await runExtension(hung, { timeoutMs: 150 }), /timeout:/);
  assert.equal(JSON.parse(readFileSync(join(hung.logDir, 'omp-autostart.result'), 'utf8')).exitCode, 1);
  assert.deepEqual(autostartFiles(hung), ['omp-autostart.result']);
  const noisy = childPreflight(t, `process.stdout.write('SECRET'.repeat(20000));`);
  assert.match(await runExtension(noisy), /output-limit:/);
  rmSync(join(noisy.root, 'cli', 'heal.mjs'));
  assert.match(await runExtension(noisy), /installation:/);
  const missing = childPreflight(t, 'process.exitCode = 0;');
  assert.match(await runExtension(missing, { runtime: join(missing.root, 'missing-runtime') }), /runtime-unavailable:/);
});

test('generated OMP refuses a real foreign listener without quota calls or pid mutation', async t => {
  const ctx = fixture(t); const hits = await mock(t, ctx, { foreign: true });
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  const pid = join(ctx.root, 'logs', 'proxy.pid');
  const record = JSON.stringify({ pid: process.pid, startedMs: 1 }); writeFileSync(pid, record);
  assert.match(await runExtension(ctx), /foreign:/);
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
  const extension = generateExtension(ctx, 8457);
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

// The preflight reports when
// the OMP autostart's pinned absolute Node path is below the support floor or
// missing, so a Node upgrade through a version manager cannot silently break
// or age the autostart. A fake old Node is a wrapper that answers --version
// with an old version and runs the real Node with a version-faking preload.
function fakeNode(dir, version) {
  const preload = join(dir, `fake-node-${version}.mjs`);
  writeFileSync(preload, `Object.defineProperty(process, 'version', { value: ${JSON.stringify(version)} });\n` +
    `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version.slice(1))} });\n`);
  const bin = join(dir, `node-${version}`);
  writeFileSync(bin, `#!/bin/sh\nif [ "\${1:-}" = --version ]; then printf '%s\\n' ${version}; exit 0; fi\n` +
    `exec ${JSON.stringify(process.execPath)} --import ${JSON.stringify(pathToFileURL(preload).href)} "$@"\n`, { mode: 0o755 });
  return bin;
}
function pinRuntime(extension, runtime) {
  writeFileSync(extension, readFileSync(extension, 'utf8').replace(/^const RUNTIME = .*;$/m, () => `const RUNTIME = ${JSON.stringify(runtime.replace(/\\/g, '/'))};`));
}
function preflightKit(t) {
  const ctx = fixture(t);
  cpSync(join(ROOT, 'cli'), join(ctx.root, 'cli'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(ctx.root, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'proxy', 'zcode-proxy-manager.mjs'), join(ctx.root, 'proxy', 'zcode-proxy-manager.mjs'));
  return ctx;
}

test('generated OMP autostart running a pinned Node below the floor warns with the next command', { skip: process.platform === 'win32' && 'a fake old Node is a POSIX wrapper script' }, async t => {
  const ctx = preflightKit(t); await mock(t, ctx);
  const { PREFLIGHT_WARNINGS } = await api();
  for (const version of ['v20.19.0', 'v22.23.4']) {
    const stderr = await runExtension(ctx, { runtime: fakeNode(ctx.root, version) });
    assert.equal(stderr, `[zcode-autostart] runtime-floor: ${PREFLIGHT_WARNINGS['runtime-floor']}\n`);
    assert.match(stderr, /Node\.js 24/);
    assert.match(stderr, /zcode-kit setup/);
  }
});

test('generated OMP autostart on a pinned Node 24 or 26 stays silent', { skip: process.platform === 'win32' && 'a fake Node is a POSIX wrapper script' }, async t => {
  const ctx = preflightKit(t); await mock(t, ctx);
  for (const version of ['v24.0.0', 'v26.13.0']) assert.equal(await runExtension(ctx, { runtime: fakeNode(ctx.root, version) }), '');
});

test('preflight reports a pinned autostart Node below the floor or missing as a WARN with the next command, and logs one event line', async t => {
  const ctx = preflightKit(t); await mock(t, ctx);
  const extension = generateExtension(ctx);
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home };
  const cases = [['missing', join(ctx.root, 'removed-by-a-version-manager', process.platform === 'win32' ? 'node.exe' : 'node'), 'runtime-missing', 'the pinned Node.js path no longer exists']];
  if (process.platform !== 'win32') cases.push(['v22', fakeNode(ctx.root, 'v22.23.4'), 'runtime-floor', 'the pinned Node.js v22.23.4 is below the support floor (Node.js 24)']);
  for (const [label, runtime, cause, detail] of cases) {
    pinRuntime(extension, runtime);
    rmSync(join(ctx.root, 'logs', 'heal.log'), { force: true });
    const result = await runNode(join(ctx.root, 'cli', 'heal.mjs'), [], env);
    assert.equal(result.code, 0, `${label}: the warning does not fail the preflight\n${result.stderr}`);
    // The off-TTY check grammar: WARN row, then next.
    const lines = result.stderr.split('\n');
    const at = lines.indexOf(`WARN  OMP autostart runtime \u2014 ${detail}`);
    assert.ok(at >= 0, `${label}:\n${result.stderr}`);
    assert.equal(lines[at + 1], '  next: zcode-kit setup, then restart OMP');
    const log = readFileSync(join(ctx.root, 'logs', 'heal.log'), 'utf8').trim().split('\n');
    const events = log.filter(line => / WARN preflight /.test(line));
    assert.equal(events.length, 1, log.join('\n'));
    assert.match(events[0], new RegExp(`^\\d{4}-\\d\\d-\\d\\dT[^ ]+Z WARN preflight OMP autostart runtime check cause=${cause} action=runtime-check result=warning$`));
    assert.ok(!events[0].includes(ctx.root) && !events[0].includes(ctx.home), 'no path becomes a log field');
    const diagnostic = await runNode(join(ctx.root, 'cli', 'heal.mjs'), ['--diagnostic-code'], env);
    assert.match(diagnostic.stderr, new RegExp(`^\\[zcode-preflight\\] cause=${cause}$`, 'm'));
  }
});

test('preflight stays silent for a supported pinned runtime, a pinned Bun, another kit copy and no autostart', async t => {
  const ctx = preflightKit(t); await mock(t, ctx);
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home };
  const quiet = async (label) => {
    rmSync(join(ctx.root, 'logs', 'heal.log'), { force: true });
    const result = await runNode(join(ctx.root, 'cli', 'heal.mjs'), [], env);
    assert.equal(result.code, 0, `${label}\n${result.stderr}`);
    assert.doesNotMatch(result.stderr, /WARN|autostart runtime/, label);
    assert.doesNotMatch(readFileSync(join(ctx.root, 'logs', 'heal.log'), 'utf8'), /runtime/, label);
  };
  await quiet('no OMP autostart installed');
  const extension = generateExtension(ctx);
  await quiet('pinned to the Node that ran setup (>= 24)');
  if (process.platform !== 'win32') for (const version of ['v24.0.0', 'v26.13.0']) { pinRuntime(extension, fakeNode(ctx.root, version)); await quiet(`pinned ${version}`); }
  pinRuntime(extension, resolveBun(ROOT));
  await quiet('pinned Bun (the floor is a Node floor)');
  pinRuntime(extension, join(ctx.root, 'missing', 'node'));
  writeFileSync(extension, readFileSync(extension, 'utf8').replace(/^const ROOT = .*;$/m, () => `const ROOT = ${JSON.stringify(join(ctx.root, 'another-kit-copy').replace(/\\/g, '/'))};`));
  await quiet('an autostart that belongs to another kit copy');
});
