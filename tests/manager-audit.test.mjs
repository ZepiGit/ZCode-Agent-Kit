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

test('start refuses to overwrite a live PID record while the listener is down', async t => {
  const root = fixture(t, 18795);
  const live = dummy(t);
  const record = JSON.stringify({ pid: live.pid, startedMs: Date.now() }) + '\n';
  writeFileSync(join(root, 'logs', 'proxy.pid'), record);
  const { code } = await quiet(() => createManager({ root, home: root, bunResolver: () => { throw new Error('must not spawn'); } }).start({ waitMs: 1000 }));
  assert.notEqual(code, 0);
  assert.equal(readFileSync(join(root, 'logs', 'proxy.pid'), 'utf8'), record);
});

test('legacy PID records without a timestamp are not treated as verified ownership', async t => {
  const root = fixture(t, 18796);
  const manager = createManager({ root, home: root });
  assert.notEqual(manager.verifyOwnProcess({ pid: process.pid, startedMs: null, startedIso: null }), 'match');
});

test('stop with a down listener and live PID reports unverifiable state instead of not running', async t => {
  const root = fixture(t, 18797);
  const live = dummy(t);
  writeFileSync(join(root, 'logs', 'proxy.pid'), JSON.stringify({ pid: live.pid, startedMs: Date.now() }) + '\n');
  const { code, lines } = await quiet(() => createManager({ root, home: root }).stop());
  assert.equal(code, 4);
  assert.match(lines.join('\n'), /live|verify|inspect/i);
  assert.equal(existsSync(join(root, 'logs', 'proxy.pid')), true);
});

test('failed spawn leaves no PID record and reports an actionable Bun error', async t => {
  const root = fixture(t, 18798);
  const { code, lines } = await quiet(() => createManager({ root, home: root, bunResolver: () => { throw new Error('Bun native executable not found'); } }).start({ waitMs: 1000 }));
  assert.equal(code, 4);
  assert.equal(existsSync(join(root, 'logs', 'proxy.pid')), false);
  assert.match(lines.join('\n'), /Bun native executable not found/);
});
