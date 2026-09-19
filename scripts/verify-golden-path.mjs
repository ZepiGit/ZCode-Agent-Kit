#!/usr/bin/env node
/** Bounded golden ritual. Default: deterministic HTTP mock, no account or OMP.
 * GOLDEN=1 requires GOLDEN_KIT_ROOT, GOLDEN_OMP_BINARY and
 * GOLDEN_OMP_DIRS_SOURCE. All real credentials are copied only after path probes
 * and a real OMP -> local mock handshake succeed. No operation targets 8457.
 * Outputs are allowlisted summaries; raw stdout, stderr and provider bodies are
 * kept in memory only. Temporary credentials/configs are removed in finally.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, symlinkSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { proxyEnv as managedProxyEnv } from '../lib/proxy-env.mjs';

export const MODELS = Object.freeze(['glm-5.3-flash', 'glm-5.3']);
export const PROMPT = 'Antworte mit 52';
export function isolatedEnv(home, ambient = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(ambient)) if (/^(path|pathext|systemroot|windir|comspec|systemdrive|processor_architecture|number_of_processors)$/i.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'), TMPDIR: join(home, 'tmp'), PI_CONFIG_DIR: '.omp', PI_CODING_AGENT_DIR: join(home, '.omp/agent'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'), NO_COLOR: '1' });
  return env;
}
export function makeHome(root) {
  const home = join(root, 'home');
  const env = isolatedEnv(home);
  for (const k of ['HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) mkdirSync(env[k], { recursive: true });
  return { home, env };
}
export function ompArgs(model, { extensions = false } = {}) {
  if (!MODELS.includes(model)) throw new Error('unsupported golden model');
  return ['-p', '--model', `zcode/${model}`, '--no-session', '--no-tools', '--no-skills', '--no-rules', ...(extensions ? [] : ['--no-extensions']), PROMPT];
}
export function classify(result) {
  const stdout = String(result.stdout || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  return { status: result.timedOut ? 'BLOCKED' : result.code === 0 && stdout === '52' ? 'PASS' : 'FAIL', exitCode: result.code ?? null, exact52: stdout === '52', timedOut: Boolean(result.timedOut), stderrPresent: Boolean(result.stderr), rawOutputPersisted: false };
}
export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
  else child.kill('SIGKILL');
  await Promise.race([exited, new Promise(r => setTimeout(r, 3000).unref())]);
}
export function execute(binary, args, { env, cwd, timeoutMs = 180000 } = {}) {
  return new Promise(resolveResult => {
    const child = spawn(binary, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void stopChild(child); }, timeoutMs);
    child.stdout.on('data', b => { stdout = (stdout + b.toString()).slice(-2 * 1024 * 1024); });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-2 * 1024 * 1024); });
    child.on('error', () => { clearTimeout(timer); resolveResult({ code: null, stdout: '', stderr: 'spawn unavailable', timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolveResult({ code, stdout, stderr, timedOut }); });
  });
}
export async function createMock({ key = 'golden-mock-key', response = '52', status = 200 } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    const authorized = req.headers['x-api-key'] === key || req.headers.authorization === `Bearer ${key}`;
    calls.push({ model: MODELS.includes(body.model) ? body.model : 'other', promptPresent: JSON.stringify(body.messages || []).includes(PROMPT), authorized, stream: body.stream === true });
    if (!authorized || status !== 200) { res.writeHead(!authorized ? 401 : status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'fixture failure' } })); return; }
    const message = { id: 'msg_golden', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: response }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: response } });
    send('content_block_stop', { type: 'content_block_stop', index: 0 });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    send('message_stop', { type: 'message_stop' }); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}
export function writeOmpModels(home, url, key) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('golden endpoint must be loopback');
  const models = MODELS.map(id => ({ id, name: id, reasoning: true, input: ['text'], contextWindow: 1000000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }));
  const compat = { supportsOutputEffort: true, supportsContextManagement: false, replayUnsignedThinking: true, injectClaudeCodeInstruction: false };
  const modelOverrides = Object.fromEntries(MODELS.map(id => [id, { thinking: { mode: 'anthropic-budget-effort', efforts: ['low', 'high', 'max'], defaultLevel: 'low', requiresEffort: true }, compat }]));
  const agent = join(home, '.omp/agent'); mkdirSync(agent, { recursive: true });
  // JSON is valid YAML; no interpolation of untrusted YAML values.
  writeFileSync(join(agent, 'models.yml'), JSON.stringify({ providers: { zcode: { name: 'ZCode isolated verification', baseUrl: url, api: 'anthropic-messages', apiKey: key, modelOverrides, models } } }), { mode: 0o600 });
  writeFileSync(join(agent, 'config.yml'), 'extensions: []\n');
}
export function fillProxyTemplate(template, port, key) {
  if (!Number.isInteger(port) || port < 18457 || port > 65000 || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('unsafe test runtime configuration');
  const output = template.replace('port: 8457', `port: ${port}`).replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${key}"`);
  if (!output.includes(`  proxyApiKey: "${key}"`) || !output.includes(`  port: ${port}`)) throw new Error('template contract mismatch');
  return output;
}
export async function runMockGolden() {
  const fixture = await createMock();
  try {
    const results = [];
    for (const model of MODELS) {
      const response = await fetch(`${fixture.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'golden-mock-key' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 64 }), signal: AbortSignal.timeout(5000) });
      const j = await response.json();
      results.push({ model, level: 'MOCK_HTTP_NOT_OMP', ...classify({ code: response.ok ? 0 : 1, stdout: j.content?.[0]?.text }) });
    }
    return { mode: 'mock', results, credentialCopyRemoved: true };
  } finally { await fixture.close(); }
}
function probe(binary, code, env, cwd) {
  const r = spawnSync(binary, ['-e', code], { env, cwd, encoding: 'utf8', timeout: 15000, windowsHide: true });
  return r.status === 0 && r.stdout.trim() === 'true';
}
async function freePort(first) {
  if (!Number.isInteger(first) || first < 18457 || first > 65000) throw new Error('test port must be 18457..65000');
  for (let port = first; port < first + 10; port++) {
    const server = netServer();
    const free = await new Promise(r => { server.once('error', () => r(false)); server.listen(port, '127.0.0.1', () => server.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error('test ports unavailable');
}
export async function runLiveGolden(options = {}) {
  if (process.env.GOLDEN !== '1' && options.optIn !== true) return { mode: 'live', status: 'BLOCKED', reason: 'explicit GOLDEN=1 opt-in required' };
  const kit = options.kitRoot || process.env.GOLDEN_KIT_ROOT;
  const omp = options.ompBinary || process.env.GOLDEN_OMP_BINARY;
  const dirs = options.ompDirsSource || process.env.GOLDEN_OMP_DIRS_SOURCE;
  if (![kit, omp, dirs].every(p => p && existsSync(p))) return { mode: 'live', status: 'BLOCKED', reason: 'explicit existing kit root, OMP binary and dirs source required' };
  const root = mkdtempSync(join(tmpdir(), 'zcode-golden-'));
  const { home, env } = makeHome(root);
  const originalHome = homedir();
  const credentialSource = options.credentialsPath || process.env.GOLDEN_CREDENTIALS_PATH || join(originalHome, '.zcode-proxy/credentials.json');
  const credentials = join(home, '.zcode-proxy/credentials.json');
  const store = join(kit, 'zcode-proxy-src/src/auth/store.ts');
  const config = join(root, 'config.yaml');
  const bun = options.bunBinary || 'bun';
  const report = { mode: 'live', level: 'ISOLATED_REAL_OMP', status: 'BLOCKED', isolation: {}, results: [], credentialCopyCreated: false, credentialCopyRemoved: false, active8457StopOrRestart: false, tempHomeRemoved: false };
  let child;
  try {
    // Static contract check precedes any OMP execution. Never run with only
    // an assumed HOME override; verify the actual Bun path resolver too.
    const source = readFileSync(dirs, 'utf8'); const binary = readFileSync(omp);
    report.isolation.staticOverrideContract = ['PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR'].every(s => source.includes(s) && binary.includes(Buffer.from(s)));
    if (!report.isolation.staticOverrideContract) throw new Error('OMP override contract not established');
    report.isolation.bunHome = probe(bun, `import {homedir} from 'node:os'; console.log(homedir()===${JSON.stringify(home)})`, env, root);
    report.isolation.ompDirs = probe(bun, `import {getAgentDir,getConfigRootDir} from ${JSON.stringify(pathToFileURL(dirs).href)}; console.log(getAgentDir()===${JSON.stringify(env.PI_CODING_AGENT_DIR)} && getConfigRootDir()===${JSON.stringify(join(home, '.omp'))})`, env, root);
    const proxyEnv = managedProxyEnv({ config }, { ...env, ZCODE_PROXY_CREDENTIALS_PATH: credentials, ZCODE_PROXY_CREDENTIAL_SECRET: process.env.ZCODE_PROXY_CREDENTIAL_SECRET ?? `${originalHome}-${process.platform}-${process.arch}` });
    report.isolation.proxyStore = probe(bun, `import {getStorePath} from ${JSON.stringify(pathToFileURL(store).href)}; console.log(getStorePath()===${JSON.stringify(credentials)})`, proxyEnv, root);
    if (!report.isolation.bunHome || !report.isolation.ompDirs || !report.isolation.proxyStore) throw new Error('runtime path isolation probe failed');
    const mockKey = randomBytes(24).toString('hex');
    const mock = await createMock({ key: mockKey });
    try {
      writeOmpModels(home, mock.url, mockKey);
      const r = await execute(omp, ompArgs(MODELS[0]), { env, cwd: root, timeoutMs: 60000 });
      report.isolation.ompMock = { ...classify(r), matchingRequest: mock.calls.some(c => c.model === MODELS[0] && c.authorized && c.promptPresent), requestCount: mock.calls.length };
      if (report.isolation.ompMock.status !== 'PASS' || !report.isolation.ompMock.matchingRequest) throw new Error('real OMP isolated mock handshake failed');
    } finally { await mock.close(); }
    const port = await freePort(Number(options.port || process.env.GOLDEN_PORT || 18457));
    report.port = port;
    const key = randomBytes(32).toString('base64url');
    const req = createRequire(join(kit, 'zcode-proxy-src/package.json'));
    const yaml = req('yaml');
    const cfg = yaml.parse(readFileSync(join(kit, 'proxy/config.yaml'), 'utf8'));
    cfg.server = { ...cfg.server, host: '127.0.0.1', port };
    cfg.auth = { ...cfg.auth, proxyApiKey: key, oauthCredentialsPath: credentials };
    cfg.logging = { level: 'error' }; cfg.claim = { enabled: false, auto: false }; cfg.async = { enabled: false };
    writeFileSync(config, yaml.stringify(cfg), { mode: 0o600 });
    mkdirSync(dirname(credentials), { recursive: true }); copyFileSync(credentialSource, credentials); report.credentialCopyCreated = true;
    const readable = probe(bun, `import {loadCredential} from ${JSON.stringify(pathToFileURL(store).href)}; console.log(Boolean(await loadCredential()))`, proxyEnv, root);
    report.isolation.copiedCredentialReadable = readable;
    if (!readable) throw new Error('copied credential unavailable under isolated store');
    child = spawn(bun, [join(kit, 'zcode-proxy-src/src/index.ts'), 'serve'], { env: proxyEnv, cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    let spawnFailed = false; child.on('error', () => { spawnFailed = true; });
    const base = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let i = 0; i < 50 && !spawnFailed && child.exitCode === null; i++) {
      try { const r = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(1000) }); const j = await r.json(); if (r.ok && j.status === 'ok' && j.provider === 'zai') { healthy = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    report.isolation.proxyHealthy = healthy;
    if (!healthy) throw new Error('isolated proxy did not become healthy');
    if (options.lifecycle || process.env.GOLDEN_LIFECYCLE === '1') {
      await stopChild(child); child = null;
      const lifecycle = await runLifecycle({ root, home, env: proxyEnv, kit, omp, key, port, timeoutMs: options.timeoutMs || 180000 });
      report.lifecycle = lifecycle;
      report.results = lifecycle.results;
      report.status = lifecycle.status;
      return report;
    }
    writeOmpModels(home, base, key);
    for (const model of MODELS) {
      const r = await execute(omp, ompArgs(model), { env, cwd: root, timeoutMs: options.timeoutMs || 180000 });
      report.results.push({ model, ...classify(r) });
    }
    report.status = report.results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
  } catch (e) {
    const reasons = new Set(['OMP override contract not established', 'runtime path isolation probe failed', 'real OMP isolated mock handshake failed', 'test ports unavailable', 'test port must be 18457..65000', 'copied credential unavailable under isolated store', 'isolated proxy did not become healthy']);
    report.reason = reasons.has(e.message) ? e.message : 'isolated verification prerequisite unavailable; raw error suppressed';
  } finally {
    await stopChild(child);
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    report.credentialCopyRemoved = !existsSync(credentials);
    report.tempHomeRemoved = !existsSync(root);
  }
  return report;
}
async function runLifecycle({ root, home, env, kit, omp, key, port, timeoutMs }) {
  const isolatedKit = join(root, 'lifecycle-kit');
  mkdirSync(isolatedKit);
  for (const folder of ['cli', 'lib']) cpSync(join(kit, folder), join(isolatedKit, folder), { recursive: true });
  for (const folder of ['proxy', 'logs', 'zcode-proxy-src']) mkdirSync(join(isolatedKit, folder));
  for (const file of ['zcode-proxy-manager.mjs', 'zcode-proxy-autostart.ts', 'config.example.yaml']) copyFileSync(join(kit, 'proxy', file), join(isolatedKit, 'proxy', file));
  cpSync(join(kit, 'zcode-proxy-src/src'), join(isolatedKit, 'zcode-proxy-src/src'), { recursive: true });
  for (const p of ['package.json', 'zcode-proxy-src/package.json']) copyFileSync(join(kit, p), join(isolatedKit, p));
  symlinkSync(join(kit, 'zcode-proxy-src/node_modules'), join(isolatedKit, 'zcode-proxy-src/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const config = join(isolatedKit, 'proxy/config.yaml');
  const keyFile = join(isolatedKit, '.proxykey');
  const models = join(home, '.omp/agent/models.yml');
  const agentConfig = join(home, '.omp/agent/config.yml');
  writeFileSync(keyFile, key, { mode: 0o600 });
  writeFileSync(config, fillProxyTemplate(readFileSync(join(isolatedKit, 'proxy/config.example.yaml'), 'utf8'), port, key), { mode: 0o600 });
  const lifecycleEnv = { ...env, ZCODE_PROXY_CONFIG: config, ZCODE_KIT_SKIP_DEPS: '1', ZCODE_KIT_SKIP_SMOKE: '1' };
  writeFileSync(models, 'providers:\n');
  writeFileSync(agentConfig, 'retry:\n  enabled: false\n');
  const cli = join(isolatedKit, 'cli/zcode-kit.mjs');
  const manager = join(isolatedKit, 'proxy/zcode-proxy-manager.mjs');
  const result = { status: 'BLOCKED', results: [], setupCompleted: false, managerCleanup: false, originalPortNeverTargeted: port >= 18457 };
  const command = (file, args, limit = 60000) => execute(process.execPath, [file, ...args], { env: lifecycleEnv, cwd: isolatedKit, timeoutMs: limit });
  const prompt = async (scenario, model, limit = timeoutMs) => {
    const r = await execute(omp, ompArgs(model, { extensions: true }), { env: lifecycleEnv, cwd: root, timeoutMs: limit });
    const summary = { scenario, model, ...classify(r), diagnosticPresent: /doctor|key mismatched|preflight failed|authentication|401/i.test(`${r.stdout}\n${r.stderr}`) };
    result.results.push(summary); return summary;
  };
  try {
    const setup = await command(cli, ['integrate', 'omp']);
    result.setupCompleted = setup.code === 0;
    if (!result.setupCompleted) return result;
    // Preserve adapter shape while bounding reasoning for this tiny smoke.
    const lowerEffort = () => writeFileSync(models, readFileSync(models, 'utf8').replaceAll('defaultLevel: max', 'defaultLevel: low').replaceAll('maxTokens: 128000', 'maxTokens: 4096'), { mode: 0o600 });
    lowerEffort();
    const start = await command(manager, ['start']);
    result.initialStartExit = start.code;
    if (start.code !== 0) {
      const raw = existsSync(join(isolatedKit, 'logs/proxy.log')) ? readFileSync(join(isolatedKit, 'logs/proxy.log'), 'utf8') : '';
      result.staticErrorMatches = [];
      const sourceFiles = []; const walk = (p, prefix) => { for (const entry of readdirSync(p, { withFileTypes: true })) { const rel = `${prefix}/${entry.name}`; if (entry.isDirectory()) walk(join(p, entry.name), rel); else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) sourceFiles.push(rel); } }; walk(join(isolatedKit, 'zcode-proxy-src/src'), 'src');
      for (const relative of sourceFiles) {
        const p = join(isolatedKit, 'zcode-proxy-src', relative); if (!existsSync(p)) continue;
        for (const [index, line] of readFileSync(p, 'utf8').split('\n').entries()) for (const m of line.matchAll(/["'`]([^"'`\n]{16,})["'`]/g)) {
          const fragment = m[1].split('${')[0]; if (fragment.length >= 16 && raw.includes(fragment)) result.staticErrorMatches.push({ file: relative, line: index + 1 });
        }
      }
      result.startFailure = { missingModule: /Cannot find|ModuleNotFound|ENOENT/.test(raw), addressInUse: /EADDRINUSE|address.*in use/i.test(raw), configInvalid: /config|yaml/i.test(raw), credentials: /credential|decrypt/i.test(raw), scriptNotFound: /Script not found|src\/index.ts/i.test(raw), nativeDependency: /native|\.node|bun run/i.test(raw), notLoggedIn: /Not logged in/.test(raw), corruptCredential: /corrupt|stale credential|decrypt/i.test(raw), syntaxError: /SyntaxError|ParseError/.test(raw), referenceError: /ReferenceError/.test(raw), typeError: /TypeError/.test(raw), missingConfig: /config.*not found|ENOENT/i.test(raw), bindingError: /Failed to start server|listen|bind/i.test(raw), exitCode: Number(raw.match(/exited immediately \(code (\d+)/)?.[1] ?? -1), timedOut: start.timedOut };
      return result;
    }
    for (const model of MODELS) await prompt('normal', model);
    if (process.env.GOLDEN_NORMAL_ONLY === '1') {
      result.status = result.results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
      return result;
    }
    // Crash only the freshly isolated manager's authenticated + start-time
    // verified PID. No PID/port guessing and no operation on the real root.
    const crash = async () => {
      const code = `import {createManager} from ${JSON.stringify(pathToFileURL(manager).href)}; const m=createManager({root:${JSON.stringify(isolatedKit)},home:${JSON.stringify(home)}}); const p=m.readPidFile(); if(await m.healthIdentify()!=='ours'||!p||m.verifyOwnProcess(p)!=='match')process.exit(4); if(!await m.killOwned(p.pid))process.exit(5); console.log('owned-crash');`;
      const r = await execute(process.execPath, ['--input-type=module', '-e', code], { env: lifecycleEnv, cwd: isolatedKit, timeoutMs: 60000 });
      return r.code === 0 && r.stdout.trim() === 'owned-crash';
    };
    for (const model of MODELS) {
      if (!await crash()) { result.results.push({ scenario: 'crash-before-request', model, status: 'BLOCKED', reason: 'isolated PID identity verification failed' }); break; }
      await prompt('crash-before-request', model);
    }
    // Rotate the isolated file while the old-key listener is alive. Expected:
    // actionable refusal, no takeover. The old provider key may still answer.
    const rotated = randomBytes(32).toString('base64url');
    writeFileSync(keyFile, rotated, { mode: 0o600 });
    await prompt('live-key-drift-diagnostic', MODELS[0], Math.min(timeoutMs, 90000));
    const refused = await command(cli, ['doctor', '--fix', '--harness', 'omp', '--json']);
    result.liveRepairRefused = refused.code !== 0;
    // Restore known identity solely for safe shutdown; then rotate offline.
    writeFileSync(keyFile, key, { mode: 0o600 });
    const stopped = await command(manager, ['stop']);
    if (stopped.code !== 0) return result;
    writeFileSync(keyFile, rotated, { mode: 0o600 });
    await prompt('offline-key-drift-diagnostic', MODELS[0], Math.min(timeoutMs, 30000));
    const fixed = await command(cli, ['doctor', '--fix', '--harness', 'omp', '--json']);
    // Doctor may exit nonzero because the proxy is intentionally still down.
    // Verify actual managed repair instead of treating exit 0 as sufficient.
    result.offlineRepairExit = fixed.code;
    result.offlineKeyAligned = readFileSync(config, 'utf8').includes(`proxyApiKey: "${rotated}"`);
    result.offlineModelsAligned = readFileSync(models, 'utf8').includes(`apiKey: "${rotated}"`);
    if (!result.offlineKeyAligned || !result.offlineModelsAligned) return result;
    key = rotated; lowerEffort();
    for (const model of MODELS) await prompt('after-key-drift-repair', model);
    const acceptance = result.results.filter(r => ['normal', 'crash-before-request', 'after-key-drift-repair'].includes(r.scenario));
    const diagnostics = result.results.filter(r => r.scenario.endsWith('-diagnostic'));
    result.status = acceptance.length === 6 && acceptance.every(r => r.status === 'PASS') && diagnostics.every(r => r.diagnosticPresent) && result.liveRepairRefused ? 'PASS' : 'FAIL';
  } finally {
    // Align the local identity file to whichever key this test configured;
    // this permits safe own-PID cleanup even after a partially failed drift.
    const configured = readFileSync(config, 'utf8').match(/^  proxyApiKey: "([A-Za-z0-9_-]+)"/m)?.[1];
    if (configured) writeFileSync(keyFile, configured, { mode: 0o600 });
    const stopped = await command(manager, ['stop']);
    result.managerCleanup = stopped.code === 0;
    if (!result.managerCleanup) throw new Error('isolated manager cleanup refused');
  }
  return result;
}
export async function main() {
  const report = process.env.GOLDEN === '1' ? await runLiveGolden() : await runMockGolden();
  console.log(JSON.stringify(report, null, 2));
  if (report.status ? report.status !== 'PASS' : report.results?.some(r => r.status !== 'PASS')) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
