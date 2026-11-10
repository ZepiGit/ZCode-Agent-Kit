import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { freePort } from './free-port.mjs';

const source = join(import.meta.dirname, '..');
const FIXTURE_PORT = await freePort();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kit-cli-'));
  for (const member of ['cli', 'lib']) cpSync(join(source, member), join(root, member), { recursive: true });
  // Ticket 43: the output module's token set and width core re-export the
  // shared files under zcode-proxy-src/src/tui — part of every real kit
  // layout, so the fixture kit carries them too.
  mkdirSync(join(root, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(source, "zcode-proxy-src", "src", "tui", f), join(root, "zcode-proxy-src", "src", "tui", f));
  mkdirSync(join(root, 'proxy')); mkdirSync(join(root, 'logs')); mkdirSync(join(root, 'generated'));
  // A free port of this run as the template's port (ticket 75): setup probes it,
  // and the production port 8457 may be the owner's own proxy.
  writeFileSync(join(root, 'proxy', 'config.example.yaml'), readFileSync(join(source, 'proxy', 'config.example.yaml'), 'utf8').replace(/^  port: \d+/m, `  port: ${FIXTURE_PORT}`));
  cpSync(join(source, 'proxy', 'zcode-proxy-manager.mjs'), join(root, 'proxy', 'zcode-proxy-manager.mjs'));
  const home = join(root, 'home'); mkdirSync(home);
  const bin = join(root, 'sp ace (bin)'); mkdirSync(bin);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: root, TMP: root, ZCODE_PROXY_CREDENTIALS_PATH: join(home, 'credentials.json'), ZCODE_KIT_SKIP_DEPS: '1', PATH: bin };
  delete env.ZCODE_KIT_STATE_DIR;
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, bin, env };
}
async function run(f, args) {
  const child = spawn(process.execPath, [join(f.root, 'cli', 'zcode-kit.mjs'), ...args], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
  const timer = setTimeout(() => child.kill(), 20000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); clearTimeout(timer);
  return { code, stdout, stderr };
}
async function proxy(t, f) {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer synthetic-key') return res.writeHead(401).end('{}');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', provider: 'zai' }));
    if (req.url === '/quota') return res.end(JSON.stringify({ provider: 'zai', serverTime: 1, jwt: null, balances: [], claimablePlans: [], errors: [], asOf: 'now', cached: false }));
    res.writeHead(429).end(JSON.stringify({ error: { message: '[1113] balance unavailable' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  writeFileSync(join(f.root, '.proxykey'), 'synthetic-key');
  writeFileSync(join(f.root, 'proxy', 'config.yaml'), `server:\n  port: ${server.address().port}\n  proxyApiKey: "synthetic-key"\n`);
}

test('CLI run preserves exact Windows prompt arguments with npm shim and spaces', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t); await proxy(t, f);
  writeFileSync(join(f.root, 'generated', 'claude-zcode-settings.json'), '{}');
  writeFileSync(join(f.bin, 'entry.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  writeFileSync(join(f.bin, 'claude.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\n"' + process.execPath + '" "%dp0%\\entry.cjs" %*\r\n');
  const args = ['-p', 'two words & echo NOT-A-COMMAND', '%USERPROFILE%'];
  const res = await run(f, ['run', 'claude-code', '--', ...args]);
  assert.equal(res.code, 0, res.stderr);
  const received = JSON.parse(res.stdout.trim().split('\n').at(-1));
  assert.deepEqual(received, ['--settings', join(f.root, 'generated', 'claude-zcode-settings.json'), ...args]);
});

test('setup smoke failure reports configured state without failing successful setup', async t => {
  const f = fixture(t); await proxy(t, f);
  delete f.env.ZCODE_KIT_SKIP_DEPS; delete f.env.CI; delete f.env.NODE_ENV; delete f.env.ZCODE_KIT_SKIP_SMOKE;
  for (const dir of ['zcode-proxy-src', 'mcp/zcode-harness-mcp']) {
    mkdirSync(join(f.root, dir, 'node_modules'), { recursive: true });
    writeFileSync(join(f.root, dir, 'node_modules', '.zcode-kit-installed'), JSON.stringify({ tool: 'bun', lockHash: null }));
  }
  const res = await run(f, ['setup', '--harness', 'pi', '--no-mcp']);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  // Ticket 43: the compact report's summary block (Assistants n configured …)
  assert.match(res.stdout + res.stderr, /Assistants\s+\d+ configured/i);
  assert.match(res.stdout + res.stderr, /1113|smoke|model access/i);
});

// Ticket 36 round 2: since the bridge flag, an equivalent registration is left
// alone only when it already carries the flag; a flagless one of this
// installation is migrated exactly once (remove + add with the flag), and the
// next setup is a no-op. Ownership never changes. Windows checks its own path
// equivalence (separators, case); other hosts a `/./` spelling.
test('Claude MCP registration recognizes equivalent Windows paths without changing ownership', async t => {
  const SEMI = '--max-semi-space-size=1';
  const f = fixture(t);
  mkdirSync(join(f.home, '.claude'));
  const server = join(f.root, 'mcp', 'zcode-harness-mcp', 'dist', 'index.js');
  mkdirSync(dirname(server), { recursive: true }); writeFileSync(server, '');
  const configured = process.platform === 'win32' ? server.replaceAll('\\', '/').toUpperCase() : server.replace('/mcp/', '/mcp/./');
  const state = join(f.root, 'claude-registration');
  const attempts = join(f.root, 'mcp-add.json');
  // A stateful `claude`: `get` shows the stored Args line; every other call is
  // logged as an attempt; `remove` drops the registration, `add` stores its args.
  writeFileSync(join(f.bin, 'entry.cjs'), `const fs=require('node:fs'); const [,, , verb, ...rest]=process.argv;
if(verb==='get'){ if(!fs.existsSync(${JSON.stringify(state)})){process.exitCode=1;} else console.log('Command: node\\nArgs: '+fs.readFileSync(${JSON.stringify(state)},'utf8')); }
else { fs.appendFileSync(${JSON.stringify(attempts)}, JSON.stringify(process.argv.slice(2))+'\\n');
  if(verb==='remove') fs.rmSync(${JSON.stringify(state)},{force:true});
  else if(verb==='add') fs.writeFileSync(${JSON.stringify(state)}, rest.slice(rest.indexOf('node')+1).join(' ')); }`);
  if (process.platform === 'win32') writeFileSync(join(f.bin, 'claude.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\n"' + process.execPath + '" "%dp0%\\entry.cjs" %*\r\n');
  else writeFileSync(join(f.bin, 'claude'), '#!/bin/sh\nexec "' + process.execPath + '" "' + join(f.bin, 'entry.cjs') + '" "$@"\n', { mode: 0o755 });
  const calls = () => existsSync(attempts) ? readFileSync(attempts, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];

  // An equivalent spelling that already carries the flag: recognised, left alone.
  writeFileSync(state, `${SEMI} ${configured} --stdio`);
  // Ticket 43: the compact report shows the report rows; the bridge step's
  // diagnostics live in install.log.
  const logText = () => readFileSync(join(f.root, 'logs', 'install.log'), 'utf8');
  let result = await run(f, ['setup', '--harness', 'claude-code']);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(logText(), /registered by another kit copy/);
  assert.match(logText(), /claude: "zcode-harness" already registered/);
  assert.equal(existsSync(attempts), false, 'equivalent registration is not replaced');

  // The same equivalent spelling without the flag: this installation's own
  // registration, migrated exactly once to the flagged form.
  writeFileSync(state, `${configured} --stdio`);
  result = await run(f, ['setup', '--harness', 'claude-code']);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(logText(), /registered by another kit copy/);
  assert.match(logText(), /claude: re-registered "zcode-harness" with --max-semi-space-size=1/);
  assert.deepEqual(calls(), [
    ['mcp', 'remove', 'zcode-harness', '--scope', 'user'],
    ['mcp', 'add', 'zcode-harness', '--scope', 'user', '--', 'node', SEMI, server, '--stdio'],
  ], 'a flagless equivalent registration is migrated once: remove, then add with the flag');
  assert.equal(readFileSync(state, 'utf8'), `${SEMI} ${server} --stdio`);

  // Replayed: no further attempt.
  for (let i = 0; i < 2; i++) {
    result = await run(f, ['setup', '--harness', 'claude-code']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(logText(), /claude: "zcode-harness" already registered/);
    assert.equal(calls().length, 2, 'the migrated registration is not replaced again');
  }
});

test('Claude MCP registration refuses a foreign path containing the managed path as a prefix', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.claude'));
  const server = join(f.root, 'mcp', 'zcode-harness-mcp', 'dist', 'index.js');
  mkdirSync(dirname(server), { recursive: true }); writeFileSync(server, '');
  writeFileSync(join(f.bin, 'entry.cjs'), `console.log('Command: node\\nArgs: '+${JSON.stringify(server + '.foreign')}+' --stdio');`);
  writeFileSync(join(f.bin, 'claude.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\n"' + process.execPath + '" "%dp0%\\entry.cjs" %*\r\n');
  const result = await run(f, ['setup', '--harness', 'claude-code']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /registered by another kit copy/);
});

test('uninstall preserves unrecorded Codex sessions and history', async t => {
  const f = fixture(t);
  const data = join(f.root, 'generated', 'codex-home', 'sessions'); mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'session.json'), 'user-session');
  const res = await run(f, ['uninstall']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(readFileSync(join(data, 'session.json'), 'utf8'), 'user-session');
});
