import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';

const source = join(import.meta.dirname, '..');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kit-cli-'));
  for (const member of ['cli', 'lib']) cpSync(join(source, member), join(root, member), { recursive: true });
  mkdirSync(join(root, 'proxy')); mkdirSync(join(root, 'logs')); mkdirSync(join(root, 'generated'));
  cpSync(join(source, 'proxy', 'config.example.yaml'), join(root, 'proxy', 'config.example.yaml'));
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
  assert.match(res.stdout + res.stderr, /configur.*(?:saved|complete)|integrations.*saved/i);
  assert.match(res.stdout + res.stderr, /1113|smoke|model access/i);
});

test('uninstall preserves unrecorded Codex sessions and history', async t => {
  const f = fixture(t);
  const data = join(f.root, 'generated', 'codex-home', 'sessions'); mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'session.json'), 'user-session');
  const res = await run(f, ['uninstall']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(readFileSync(join(data, 'session.json'), 'utf8'), 'user-session');
});
