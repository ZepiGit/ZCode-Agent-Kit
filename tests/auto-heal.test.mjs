// All profiles, credentials, providers and listeners in this suite are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
async function mock(t, ctx, { code, foreign = false, hang = false, smokeCode, quotaBody } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (foreign || req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end('{}');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', provider: 'zai' }));
    if (hang) return;
    const body = req.url === '/quota'
      ? quotaBody ?? snapshot(code ? [`balance: ${code} SECRET-should-not-be-logged`] : [])
      : smokeCode ? { error: { type: 'upstream_error', message: `[${smokeCode}] SECRET-should-not-be-logged` } } : { choices: [{ message: { content: 'ok' } }] };
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
  const ctx = fixture(t); writeConfig(ctx, 1, 'old-synthetic-key');
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
test('manager doctor honors isolated ZCODE_PROXY_CREDENTIALS_PATH', async t => {
  const ctx = fixture(t); const store = join(ctx.home, 'custom-credentials.json'); writeFileSync(store, '{}');
  const previous = process.env.ZCODE_PROXY_CREDENTIALS_PATH; process.env.ZCODE_PROXY_CREDENTIALS_PATH = store;
  const messages = []; const original = console.log; console.log = m => messages.push(String(m));
  try { await createManager({ root: ctx.root, home: ctx.home }).doctor(); }
  finally { console.log = original; if (previous === undefined) delete process.env.ZCODE_PROXY_CREDENTIALS_PATH; else process.env.ZCODE_PROXY_CREDENTIALS_PATH = previous; }
  assert.ok(messages.some(m => /^PASS\s+credentials store/.test(m)), messages.join('\n'));
});
test('bootstrap honors isolated credential store without importing desktop credentials', t => {
  const ctx = fixture(t); const store = join(ctx.home, 'custom-credentials.json'); writeFileSync(store, '{}');
  const previous = { ...process.env }; const messages = []; const original = console.log;
  process.env.ZCODE_PROXY_CREDENTIALS_PATH = store; process.env.ZCODE_KIT_SKIP_DEPS = '1'; console.log = m => messages.push(String(m));
  try { bootstrap(ctx); } finally { console.log = original; for (const key of ['ZCODE_PROXY_CREDENTIALS_PATH', 'ZCODE_KIT_SKIP_DEPS']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  assert.ok(messages.includes('  proxy credentials present'), messages.join('\n'));
});
function runNode(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
test('OMP extension diagnostics use stderr without contaminating print-mode stdout', () => {
  const source = readFileSync(join(ROOT, 'proxy', 'zcode-proxy-autostart.ts'), 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|info)\s*\(|process\.stdout\s*\./);
  assert.match(source, /if \(stderr\.trim\(\)\) console\.error\(/, 'preflight warnings belong on stderr');
  assert.match(source, /console\.error\("\[zcode-autostart\] preflight failed/, 'startup failure belongs on stderr');
});
test('all shipped launchers and OMP share preflight rather than hidden or repeated starts', () => {
  for (const id of ['aider', 'claude', 'codex']) for (const ext of ['cmd', 'sh']) {
    const src = readFileSync(join(ROOT, 'bin', `zcode-${id}.${ext}`), 'utf8');
    assert.match(src, /heal\.mjs/); assert.doesNotMatch(src, /manager\.mjs.*start/);
    assert.match(src, ext === 'sh' ? /\|\| exit \$\?/ : /exit \/b %errorlevel%/i);
  }
  const omp = readFileSync(join(ROOT, 'proxy', 'zcode-proxy-autostart.ts'), 'utf8');
  assert.match(omp, /heal\.mjs/);
});
