import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createManager } from '../proxy/zcode-proxy-manager.mjs';

const KEY = 'synthetic-manager-key';
function fixture(t, port) {
  const root = mkdtempSync(join(tmpdir(), 'kit-manager-'));
  mkdirSync(join(root, 'proxy')); mkdirSync(join(root, 'logs'));
  mkdirSync(join(root, 'zcode-proxy-src', 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'proxy', 'config.yaml'), `server:\n  host: 127.0.0.1\n  port: ${port}\n`);
  writeFileSync(join(root, '.proxykey'), KEY + '\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function dummy(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e6)'], { stdio: 'ignore' });
  t.after(() => { try { child.kill(); } catch {} });
  return child;
}
function quiet(fn) {
  const original = console.log; const lines = [];
  console.log = value => lines.push(String(value));
  return fn().finally(() => { console.log = original; }).then(code => ({ code, lines }));
}

const BUN_PROXY = { commandLine: '"C:\\tools\\bun.exe" run src/index.ts serve', executablePath: 'C:\\tools\\bun.exe' };
const FAST = { hungProbeCount: 3, hungProbeIntervalMs: 50, hungProbeTimeoutMs: 300, respawnWaitMs: 500 };
const OLD = () => Date.now() - 10 * 60_000;

// Each case fails exactly one hung-own condition; the others are satisfied.
for (const [name, override, startedMs] of [
  ['its command line is not the kit proxy', { processCommandLineImpl: () => ({ commandLine: 'node -e setInterval', executablePath: process.execPath }) }, OLD],
  ['its command line is unreadable', { processCommandLineImpl: () => null }, OLD],
  ['it is still inside the startup grace', {}, () => Date.now()],
  ['its start time does not match the record', { processStartMsImpl: () => Date.now() - 365 * 86400_000 }, OLD],
]) {
  test(`start refuses to overwrite a live PID record while the listener is down when ${name}`, async t => {
    const root = fixture(t, 18795);
    const live = dummy(t);
    const recorded = startedMs();
    const record = JSON.stringify({ pid: live.pid, startedMs: recorded }) + '\n';
    writeFileSync(join(root, 'logs', 'proxy.pid'), record);
    const impl = { processStartMsImpl: () => recorded, processCommandLineImpl: () => ({...BUN_PROXY, cwd: join(root, 'zcode-proxy-src')}), ...override };
    const { code, lines } = await quiet(() => createManager({ root, home: root, ...FAST, ...impl, bunResolver: () => { throw new Error('must not spawn'); } }).start({ waitMs: 1000 }));
    assert.equal(code, 4);
    assert.equal(readFileSync(join(root, 'logs', 'proxy.pid'), 'utf8'), record);
    assert.equal(live.exitCode, null, 'an unproven process must stay alive');
    assert.match(lines.join('\n'), /not proven to be a hung kit proxy: .+Next: zcode-kit proxy restart/);
    assert.doesNotMatch(lines.join('\n'), /must not spawn/);
  });
}

/** A real process that binds the proxy port and accepts connections but never answers. */
function hungListener(t, port) {
  const child = spawn(process.execPath, ['-e', `require('node:net').createServer(()=>{}).listen(${port},'127.0.0.1',()=>console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  return new Promise(resolve => child.stdout.once('data', () => resolve(child)));
}

test('start terminates a proven hung own proxy and starts a replacement', async t => {
  const root = fixture(t, 18799);
  const hung = await hungListener(t, 18799);
  const startedMs = OLD();
  writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: hung.pid, startedMs }) + '\n');
  let spawnAttempts = 0;
  const manager = createManager({
    root, home: root, ...FAST, startupGraceMs: 1000,
    processStartMsImpl: () => startedMs, processCommandLineImpl: () => ({...BUN_PROXY, cwd: join(root, 'zcode-proxy-src')}),
    bunResolver: () => { spawnAttempts++; throw new Error('replacement start attempted'); },
  });
  const { code, lines } = await quiet(() => manager.start({ waitMs: 1000 }));
  const output = lines.join('\n');
  assert.match(output, new RegExp(`hung proxy pid ${hung.pid} \\(no /health answer on 3 probes.*\\) — terminating and restarting`));
  assert.equal(spawnAttempts, 1, 'a new start must follow the kill');
  assert.equal(code, 4, 'the synthetic Bun resolver refuses the actual spawn');
  assert.equal(manager.pidAlive(hung.pid), false, 'the hung process is gone');
  assert.equal(existsSync(join(root, 'logs', 'proxy.pid')), false, 'its record is removed');
  assert.equal(manager.lastRecovery()?.pid, hung.pid);
  assert.match(readFileSync(join(root, 'logs', 'heal.log'), 'utf8'), /cause=hung action=recover result=ok/);
});

test('respawn is rate limited to 3 per 15 minutes and never starts over the limit', async t => {
  const root = fixture(t, 18800);
  const now = Date.now();
  writeFileSync(join(root, 'logs', 'respawn.json'), JSON.stringify({ events: [
    { at: now - 20 * 60_000, pid: 1, reason: 'memory' }, // outside the window: not counted
    { at: now - 60_000, pid: 2, reason: 'watchdog' },
    { at: now - 30_000, pid: 3, reason: 'watchdog' },
  ] }));
  // Third respawn in the window: the requesting proxy already exited → start.
  const gone = dummy(t); const gonePid = gone.pid;
  writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: gonePid, startedMs: OLD() }) + '\n');
  gone.kill('SIGKILL'); await new Promise(r => gone.once('exit', r));
  let spawnAttempts = 0;
  const bunResolver = () => { spawnAttempts++; throw new Error('start attempted'); };
  const third = await quiet(() => createManager({ root, home: root, ...FAST, bunResolver }).respawn(gonePid, 'watchdog'));
  assert.equal(spawnAttempts, 1, 'within the limit the manager starts a fresh proxy');
  assert.match(third.lines.join('\n'), /respawn: starting a fresh proxy/);
  // Fourth within 15 minutes: refused, nothing started, the live proxy untouched.
  const live = dummy(t);
  const record = JSON.stringify({ pid: live.pid, startedMs: OLD() }) + '\n';
  writeFileSync(join(root, 'logs', 'proxy.pid'), record);
  const fourth = await quiet(() => createManager({ root, home: root, ...FAST, bunResolver }).respawn(live.pid, 'memory'));
  assert.equal(fourth.code, 4);
  assert.match(fourth.lines.join('\n'), /respawn refused: 3 restarts in 15 min; inspect logs\/proxy\.log/);
  assert.equal(spawnAttempts, 1);
  assert.equal(live.exitCode, null);
  assert.equal(readFileSync(join(root, 'logs', 'proxy.pid'), 'utf8'), record);
  assert.equal(JSON.parse(readFileSync(join(root, 'logs', 'respawn.json'), 'utf8')).events.filter(e => now - e.at < 15 * 60_000).length, 3);
});

// The proof is ~probes old when the signal would be sent: ownership is
// re-validated immediately before it, and any change fails closed.
for (const [name, mutate] of [
  ['the pid record is replaced during the probes', (root, state) => writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: state.pid, startedMs: Date.now() }) + '\n')],
  ['the command line stops matching during the probes', (_root, state) => { state.command = null; }],
]) {
  test(`a proven hung proxy is not signalled when ${name}`, async t => {
    const root = fixture(t, 18802);
    const live = dummy(t);
    const startedMs = OLD();
    writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: live.pid, startedMs }) + '\n');
    const state = { pid: live.pid, command: {...BUN_PROXY, cwd: join(root, 'zcode-proxy-src')}, reads: 0 };
    // The proof's own command-line read passes; the change lands right after
    // it (before the probes), deterministically.
    const readCommand = () => {
      const current = state.command;
      if (++state.reads === 1) mutate(root, state);
      return current;
    };
    let spawnAttempts = 0;
    const manager = createManager({
      root, home: root, ...FAST, startupGraceMs: 1000,
      processStartMsImpl: () => startedMs, processCommandLineImpl: readCommand,
      bunResolver: () => { spawnAttempts++; throw new Error('must not spawn'); },
    });
    const { code, lines } = await quiet(() => manager.start({ waitMs: 1000 }));
    assert.equal(code, 4);
    assert.match(lines.join('\n'), new RegExp(`refusing to signal pid ${live.pid}`));
    assert.equal(live.exitCode, null, 'the process must not be signalled');
    assert.equal(spawnAttempts, 0);
    assert.match(readFileSync(join(root, 'logs', 'heal.log'), 'utf8'), /cause=hung action=recover result=failed/);
  });
}

test('concurrent respawn helpers cannot exceed the restart budget', async t => {
  const root = fixture(t, 18803);
  writeFileSync(join(root, 'logs', 'respawn.json'), JSON.stringify({ events: [{ at: Date.now() - 60_000, pid: 1, reason: 'watchdog' }, { at: Date.now() - 30_000, pid: 2, reason: 'watchdog' }] }));
  const gone = dummy(t); const gonePid = gone.pid;
  writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: gonePid, startedMs: OLD() }) + '\n');
  gone.kill('SIGKILL'); await new Promise(r => gone.once('exit', r));
  let spawnAttempts = 0;
  const bunResolver = () => { spawnAttempts++; throw new Error('start attempted'); };
  const { code: codes } = await quiet(() => Promise.all([1, 2, 3, 4].map(() => createManager({ root, home: root, ...FAST, bunResolver }).respawn(gonePid, 'watchdog'))));
  assert.deepEqual(codes, [4, 4, 4, 4], 'one reserves and fails to spawn synthetically; the others are refused');
  assert.equal(spawnAttempts, 1, 'only one helper gets the last slot');
  assert.equal(JSON.parse(readFileSync(join(root, 'logs', 'respawn.json'), 'utf8')).events.length, 3);
  assert.equal(existsSync(join(root, 'logs', 'respawn.lock')), false);
});

test('respawn fails closed on an unreadable restart history and never starts', async t => {
  const root = fixture(t, 18804);
  writeFileSync(join(root, 'logs', 'respawn.json'), '{ corrupt');
  const gone = dummy(t); const gonePid = gone.pid;
  writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: gonePid, startedMs: OLD() }) + '\n');
  gone.kill('SIGKILL'); await new Promise(r => gone.once('exit', r));
  const { code, lines } = await quiet(() => createManager({ root, home: root, ...FAST, bunResolver: () => { throw new Error('must not spawn'); } }).respawn(gonePid, 'memory'));
  assert.equal(code, 4);
  assert.match(lines.join('\n'), /respawn refused: .*restart budget unknown/);
  assert.equal(readFileSync(join(root, 'logs', 'respawn.json'), 'utf8'), '{ corrupt');
});

test('a stale respawn helper does not restart a proxy that was stopped or replaced while it waited', async t => {
  const root = fixture(t, 18805);
  const requester = dummy(t);
  writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: requester.pid, startedMs: OLD() }) + '\n');
  // While the helper waits, the user stops the requester (record removed).
  const stopped = new Promise(resolve => setTimeout(() => { requester.kill('SIGKILL'); rmSync(join(root, 'logs', 'proxy.pid')); resolve(); }, 100));
  const { code, lines } = await quiet(async () => {
    const pending = createManager({ root, home: root, ...FAST, respawnWaitMs: 5000, bunResolver: () => { throw new Error('must not spawn'); } }).respawn(requester.pid, 'watchdog');
    await stopped;
    return pending;
  });
  assert.equal(code, 4);
  assert.match(lines.join('\n'), /pid record changed while waiting.*nothing started/);
  assert.doesNotMatch(lines.join('\n'), /must not spawn/);
});

test('respawn refuses a pid that is not the recorded proxy', async t => {
  const root = fixture(t, 18801);
  const live = dummy(t);
  const record = JSON.stringify({ pid: live.pid, startedMs: OLD() }) + '\n';
  writeFileSync(join(root, 'logs', 'proxy.pid'), record);
  const { code, lines } = await quiet(() => createManager({ root, home: root, ...FAST, bunResolver: () => { throw new Error('must not spawn'); } }).respawn(process.pid, 'watchdog'));
  assert.equal(code, 4);
  assert.match(lines.join('\n'), /respawn: refused — pid \d+ is not the recorded proxy pid/);
  assert.equal(live.exitCode, null);
  assert.equal(readFileSync(join(root, 'logs', 'proxy.pid'), 'utf8'), record);
  assert.equal(existsSync(join(root, 'logs', 'respawn.json')), false, 'a refused request is not counted');
});

test('legacy PID records without a timestamp are not treated as verified ownership', async t => {
  const root = fixture(t, 18796);
  const manager = createManager({ root, home: root });
  assert.notEqual(manager.verifyOwnProcess({ pid: process.pid, startedMs: null, startedIso: null }), 'match');
});

for (const [name, override, startedMs] of [
  ['inside the startup grace', {}, () => Date.now()],
  ['with a non-proxy command line', { processCommandLineImpl: () => ({ commandLine: 'node -e setInterval', executablePath: process.execPath }) }, OLD],
]) {
  test(`stop with a down listener and live PID ${name} reports unverifiable state instead of not running`, async t => {
    const root = fixture(t, 18797);
    const live = dummy(t);
    const recorded = startedMs();
    writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: live.pid, startedMs: recorded }) + '\n');
    const { code, lines } = await quiet(() => createManager({ root, home: root, ...FAST, processStartMsImpl: () => recorded, processCommandLineImpl: () => ({...BUN_PROXY, cwd: join(root, 'zcode-proxy-src')}), ...override }).stop());
    assert.equal(code, 4);
    assert.match(lines.join('\n'), /cannot verify it is a hung kit proxy/);
    assert.equal(live.exitCode, null);
    assert.equal(existsSync(join(root, 'logs', 'proxy.pid')), true);
  });
}

test('failed spawn leaves no PID record and reports an actionable Bun error', async t => {
  const root = fixture(t, 18798);
  const { code, lines } = await quiet(() => createManager({ root, home: root, bunResolver: () => { throw new Error('Bun native executable not found'); } }).start({ waitMs: 1000 }));
  assert.equal(code, 4);
  assert.equal(existsSync(join(root, 'logs', 'proxy.pid')), false);
  assert.match(lines.join('\n'), /Bun native executable not found/);
});
