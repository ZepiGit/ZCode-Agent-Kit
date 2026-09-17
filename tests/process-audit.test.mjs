import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const helper = new URL('../lib/process.mjs', import.meta.url);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kit-process-'));
  const bin = join(root, 'sp ace (test) %literal% 日本');
  mkdirSync(bin);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, bin };
}

test('safe process runner preserves prompts without shell interpretation', { skip: process.platform !== 'win32' }, async t => {
  assert.ok(existsSync(helper), 'the safe command runner must exist');
  const { runCommandSync } = await import(helper);
  const { root, bin } = fixture(t);
  writeFileSync(join(bin, 'echo.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  writeFileSync(join(bin, 'codex.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\n"' + process.execPath + '" "%dp0%\\echo.cjs" %*\r\n');
  const sentinel = join(root, 'must-not-exist');
  const args = ['exec', 'Reply with 52', `x & type nul > "${sentinel}"`, '%USERPROFILE%', '!HOME!', 'a|b', '>', '^', 'a"b', 'end\\', '', 'line\nbreak', '日本'];
  const result = runCommandSync('codex', args, { env: { ...process.env, PATH: bin }, encoding: 'utf8' });
  assert.equal(result.status, 0, String(result.error ?? result.stderr));
  assert.deepEqual(JSON.parse(result.stdout), args);
  assert.equal(existsSync(sentinel), false);
});

test('standard npm endlocal shim runs through native Node without cmd evaluation', { skip: process.platform !== 'win32' }, async t => {
  const { runCommandSync } = await import(helper);
  const { bin } = fixture(t);
  copyFileSync(process.execPath, join(bin, 'node.exe'));
  writeFileSync(join(bin, 'main.js'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  writeFileSync(join(bin, 'cli.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\nSET "_prog=node"\r\nendlocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\main.js" %*\r\n');
  const result = runCommandSync('cli', ['a&b', '%HOME%', 'x y'], { env: { ...process.env, PATH: bin }, encoding: 'utf8' });
  assert.equal(result.status, 0, String(result.error ?? result.stderr));
  assert.deepEqual(JSON.parse(result.stdout), ['a&b', '%HOME%', 'x y']);
});

test('unknown batch commands fail closed instead of evaluating prompt metacharacters', { skip: process.platform !== 'win32' }, async t => {
  assert.ok(existsSync(helper));
  const { runCommandSync } = await import(helper);
  const { bin } = fixture(t);
  writeFileSync(join(bin, 'unsafe.cmd'), '@echo custom behavior %*\r\n');
  const result = runCommandSync('unsafe', ['x & echo injected'], { env: { ...process.env, PATH: bin }, encoding: 'utf8' });
  assert.equal(result.status, null);
  assert.match(result.error.message, /batch|shim/i);
});

test('missing commands return an actionable error without searching current directory', async t => {
  assert.ok(existsSync(helper));
  const { runCommandSync } = await import(helper);
  const { root, bin } = fixture(t);
  writeFileSync(join(root, 'unknown.cmd'), '@echo should not execute\r\n');
  const result = runCommandSync('unknown', [], { cwd: root, env: { ...process.env, PATH: bin }, encoding: 'utf8' });
  assert.equal(result.status, null);
  assert.match(result.error.message, /not found|ENOENT/);
});

test('Bun resolution uses the installer-recorded native executable when absent from PATH', async t => {
  assert.ok(existsSync(helper));
  const { resolveBun } = await import(helper);
  const { root, bin } = fixture(t);
  const native = join(bin, process.platform === 'win32' ? 'bun.exe' : 'bun');
  copyFileSync(process.execPath, native);
  writeFileSync(join(root, '.bun-path'), native + '\n');
  assert.equal(resolveBun(root, { PATH: '', USERPROFILE: root, HOME: root }), native);
});
