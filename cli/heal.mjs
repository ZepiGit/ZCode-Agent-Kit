#!/usr/bin/env node
// One-shot shared startup preflight. Never guess ownership, print provider
// bodies, or schedule recurring provider checks. The only process it can end
// is a proven hung own proxy, via the manager's hung-own proof in start().
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { resolveCommand, resolveBun } from '../lib/process.mjs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createCtx } from './context.mjs';
import { diagnoseQuota } from './quota-diagnostics.mjs';
export { diagnoseQuota, isQuotaSnapshot } from './quota-diagnostics.mjs';
import { acquireLock, releaseLock, beginTransaction, rollbackTransaction } from '../lib/transaction.mjs';

const CAUSES = new Set(['healthy', 'auth3012', 'balance1113', 'balance3001', 'auth', 'balance', 'foreign', 'startup', 'quota-unavailable', 'smoke', 'skipped', 'repair', 'hung', 'respawn', 'unknown']);
const ACTIONS = new Set(['safe-start', 'quota-check', 'smoke-check', 'reapply', 'recover', 'respawn', 'none']);
const RESULTS = new Set(['ok', 'failed', 'refused', 'skipped', 'warning', 'unknown']);
const LOG_LIMIT = 64 * 1024;
export function logHeal(ctx, { cause, action, result }) {
  // Allow-list, not redaction: provider text, paths and credentials can never
  // become log fields. A bounded second file is the only retained rotation.
  try {
    const dir = ctx.logDir ?? join(ctx.root, 'logs'); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'heal.log');
    const line = `${new Date().toISOString()} cause=${CAUSES.has(cause) ? cause : 'unknown'} action=${ACTIONS.has(action) ? action : 'none'} result=${RESULTS.has(result) ? result : 'unknown'}\n`;
    if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > LOG_LIMIT) {
      rmSync(file + '.1', { force: true });
      if (statSync(file).size <= LOG_LIMIT) renameSync(file, file + '.1');
      else { writeFileSync(file + '.1', 'previous oversized heal log discarded\n'); rmSync(file); }
    }
    appendFileSync(file, line, { mode: 0o600 });
  } catch { /* logging must not break a launch */ }
}

function outcome(ctx, code, cause, detail, action = 'quota-check') {
  logHeal(ctx, { cause, action, result: code ? 'failed' : cause === 'quota-unavailable' ? 'warning' : 'ok' });
  return { code, cause, detail };
}

// OMP's session gate: one full preflight initially, then cached local-only
// health checks. Failed starts have the same cooldown, never a per-turn loop.
export function createSessionPreflight({ health, run, now = Date.now, ttlMs = 60000 }) {
  let nextCheck = 0, attempted = false, pending = null;
  return function ensure() {
    if (pending) return pending;
    if (now() < nextCheck) return Promise.resolve();
    pending = (async () => {
      const first = !attempted; attempted = true;
      if (first || !await health()) await run();
    })().finally(() => { nextCheck = now() + ttlMs; pending = null; });
    return pending;
  };
}

// The adapter embeds this fixed vocabulary in the standalone OMP extension;
// the host never needs to import this installation's modules.
export const PREFLIGHT_DETAILS = {
  installation: 'Preflight files are missing or unreadable; repair this kit installation and rerun zcode-kit setup for OMP.',
  'runtime-unavailable': 'Native Node/Bun unavailable; restore the runtime or rerun zcode-kit setup for OMP to pin its current path, then reload the extension.',
  'runtime-denied': 'Native runtime launch denied; check executable permissions and OS application controls.',
  timeout: 'Safe start timed out; inspect zcode-kit doctor and manager ownership before retrying. No takeover attempted.',
  'output-limit': 'Preflight output exceeded its bound; inspect zcode-kit doctor and local manager logs.',
  foreign: 'Port occupied or key mismatched; listener left untouched. Run zcode-kit doctor and inspect ownership manually.',
  key: 'Local proxy key unavailable; run zcode-kit doctor and repair this installation with zcode-kit setup.',
  startup: 'Safe start failed; run zcode-kit proxy restart, then zcode-kit doctor (inspect logs/proxy.log and manager lock ownership).',
};
export const PREFLIGHT_WARNINGS = {
  auth3012: 'Account authentication warning; run zcode-kit auth status.',
  auth: 'Account authentication warning; run zcode-kit auth status.',
  balance1113: 'Account balance warning; check the account plan/quota.',
  balance3001: 'Account balance warning; check the account plan/quota.',
  balance: 'Account balance warning; check the account plan/quota.',
  'quota-unavailable': 'Quota check unavailable; continuing with the healthy local proxy. No retry scheduled.',
  hung: 'Recovered an unresponsive ZCode proxy (restarted automatically).',
};
const DIAGNOSTIC_LINE = /^\[zcode-preflight\] cause=([a-z0-9-]+)$/;
export function preflightFailureDetail(code) {
  const category = typeof code === 'string' && Object.hasOwn(PREFLIGHT_DETAILS, code) ? code : 'startup';
  return `${category}: ${PREFLIGHT_DETAILS[category]}`;
}
function preflightError(code) {
  return Object.assign(new Error(preflightFailureDetail(code)), { code });
}

// Reuse the kit's native resolver (including .bun-path), never an OMP execPath
// or a shell shim. All output is captured: -p stdout belongs to the model.
export async function runSessionPreflight({ root, env = process.env, timeoutMs = 120000, warn = console.error }) {
  const file = join(root, 'cli', 'heal.mjs');
  try {
    if (!statSync(root).isDirectory() || !statSync(file).isFile()) throw new Error();
  } catch { throw preflightError('installation'); }
  const childEnv = { ...env };
  if (process.platform === 'win32') {
    const pathKey = Object.hasOwn(env, 'PATH') ? 'PATH' : Object.keys(env).find(key => key.toLowerCase() === 'path');
    for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'path') delete childEnv[key];
    if (pathKey) childEnv.PATH = env[pathKey];
  }
  const launch = runtime => new Promise((resolve, reject) => {
    execFile(runtime, [file, '--diagnostic-code'], {
      cwd: root, env: childEnv, timeout: timeoutMs, windowsHide: true,
      shell: false, windowsVerbatimArguments: false, maxBuffer: 64 * 1024,
    }, (err, _stdout, stderr) => {
      if (err) { reject(err); return; }
      // Do not forward runtime/provider stderr: it can contain credentials.
      // Only exact fixed-vocabulary lines become warnings (hung recovery and
      // the quota cause can both be reported by one preflight).
      for (const line of stderr.split(/\r?\n/)) {
        const cause = line.trim().match(DIAGNOSTIC_LINE)?.[1];
        if (cause && Object.hasOwn(PREFLIGHT_WARNINGS, cause)) warn(`[zcode-autostart] ${cause}: ${PREFLIGHT_WARNINGS[cause]}`);
      }
      resolve();
    });
  });
  let runtime;
  try { runtime = resolveCommand(process.platform === 'win32' ? 'node.exe' : 'node', childEnv); }
  catch (err) { if (err.code !== 'ENOENT') throw preflightError('runtime-denied'); }
  try {
    if (runtime) {
      try { await launch(runtime); return; }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    try { runtime = resolveBun(root, childEnv); }
    catch { throw preflightError('runtime-unavailable'); }
    await launch(runtime);
  } catch (err) {
    if (err.code === 'runtime-unavailable') throw err;
    const code = err.code === 'ENOENT' ? 'runtime-unavailable'
      : err.code === 'EACCES' || err.code === 'EPERM' ? 'runtime-denied'
      : err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output-limit'
      : err.killed || err.code === 'ETIMEDOUT' ? 'timeout'
      : err.code === 3 ? 'foreign' : err.code === 5 ? 'key' : 'startup';
    throw preflightError(code);
  }
}

const inFlight = new Map();
export function startupPreflight(ctx, options = {}) {
  const id = `${ctx.root}\n${ctx.home}`;
  if (inFlight.has(id)) return inFlight.get(id);
  const work = preflight(ctx, options).finally(() => inFlight.delete(id));
  inFlight.set(id, work);
  return work;
}
async function preflight(ctx, { timeoutMs = 8000 } = {}) {
  let code, recovered = false;
  try {
    const { createManager } = await import('../proxy/zcode-proxy-manager.mjs');
    const manager = createManager({ root: ctx.root, home: ctx.home });
    code = await manager.start({ waitMs: 20000 });
    // The manager already logged cause=hung action=recover to heal.log.
    recovered = manager.lastRecovery() !== null;
  }
  catch { return outcome(ctx, 4, 'startup', 'ZCode safe start refused; inspect manager ownership lock/config with zcode-kit doctor. No takeover attempted.', 'safe-start'); }
  if (code !== 0) return outcome(ctx, code, code === 3 ? 'foreign' : 'startup', code === 3 ? 'ZCode port occupied or key mismatched. Listener left untouched; run zcode-kit doctor --fix or inspect ownership manually.' : 'ZCode safe start failed. Run zcode-kit proxy restart, then zcode-kit doctor; inspect logs/proxy.log and manager lock ownership.', 'safe-start');
  return { ...await quotaCheck(ctx, timeoutMs), recovered };
}
async function quotaCheck(ctx, timeoutMs) {
  try {
    const res = await fetch(`http://127.0.0.1:${ctx.port()}/quota`, {
      headers: { authorization: `Bearer ${ctx.key()}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    const result = diagnoseQuota(res.status, await res.json().catch(() => null));
    // Quota is read-only; model handling owns the one bounded credential
    // recovery attempt. A quota warning must not prevent that first model turn.
    logHeal(ctx, { cause: result.cause, action: 'quota-check', result: result.code || result.cause === 'quota-unavailable' ? 'warning' : 'ok' });
    return { ...result, diagnosticCode: result.code, code: 0 };
  } catch {
    return outcome(ctx, 0, 'quota-unavailable', 'ZCode quota check timed out/unavailable; continuing with healthy local proxy. No retry scheduled.');
  }
}

export async function setupSmoke(ctx, { env = process.env, timeoutMs = 90000, readyMs = 30000, pollMs = 1000 } = {}) {
  if ((env.CI && env.CI !== '0' && env.CI !== 'false') || env.NODE_ENV === 'test' || env.ZCODE_KIT_SKIP_SMOKE === '1' || env.ZCODE_KIT_SKIP_DEPS === '1') {
    logHeal(ctx, { cause: 'skipped', action: 'smoke-check', result: 'skipped' });
    return { code: 0, cause: 'skipped', detail: 'Setup live smoke skipped (CI/test or explicit ZCODE_KIT_SKIP_SMOKE=1).' };
  }
  const ready = await startupPreflight(ctx);
  if (ready.code) return ready;
  // A freshly (re)started proxy may still be minting its first captcha token;
  // a request before that fails for reasons the user cannot act on.
  // Local safe-start has its own ownership/recovery budget. All provider-facing
  // readiness waits and requests share ONE smoke deadline, including the retry.
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  await waitForCaptchaReady(ctx, { maxMs: Math.min(readyMs, remaining()), pollMs });
  let result = await smokeRequest(ctx, remaining());
  if (result.transient && remaining() > 0) {
    await waitForCaptchaReady(ctx, { maxMs: Math.min(readyMs, remaining()), pollMs });
    result = await smokeRequest(ctx, remaining());
  }
  return outcome(ctx, result.code, result.cause, result.detail, 'smoke-check');
}

/** Poll /health until the captcha pool has a token (or is not loaded). Old proxies report no details: no wait. */
async function waitForCaptchaReady(ctx, { maxMs, pollMs }) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    let details;
    try {
      const res = await fetch(`http://127.0.0.1:${ctx.port()}/health`, {
        headers: { authorization: `Bearer ${ctx.key()}` }, signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
      });
      details = (await res.json())?.details;
    } catch { return; } // unreachable: the smoke request itself reports that
    if (!details || typeof details !== 'object') return;
    const captcha = details.captcha;
    if (captcha === null || captcha === undefined || !(captcha.ready < 1)) return;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(pollMs, deadline - Date.now()))));
  }
}

async function smokeRequest(ctx, timeoutMs) {
  if (timeoutMs <= 0) return { code: 1, cause: 'smoke', detail: 'Setup live smoke deadline exhausted; integrations remain configured.' };
  const marker = `ZCODE_SMOKE_${randomBytes(6).toString('hex').toUpperCase()}`;
  try {
    const response = await fetch(`http://127.0.0.1:${ctx.port()}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${ctx.key()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: `Reply with exactly ${marker}.` }], max_tokens: 32, stream: false, reasoning_effort: 'low' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null);
    const diagnostic = diagnoseQuota(response.status, body);
    if (diagnostic.code) return { code: diagnostic.code, cause: diagnostic.cause, detail: diagnostic.detail };
    const choice = body?.choices?.[0];
    const ok = response.ok && body?.model === 'glm-5.3-flash'
      && choice?.message?.role === 'assistant' && choice.finish_reason === 'stop'
      && choice.message.content?.trim() === marker;
    if (ok) return { code: 0, cause: 'smoke', detail: 'Setup live smoke passed (one minimal model request).' };
    const rateLimited = body?.code === 1005 || body?.error?.code === 1005 || /^\[1005\]/.test(String(body?.error?.message ?? ''));
    return {
      code: 1, cause: 'smoke', transient: (response.status === 400 || response.status >= 500) && !rateLimited,
      detail: 'Setup live smoke failed; integrations were saved and remain configured. Run zcode-kit doctor before retrying.',
    };
  } catch {
    return { code: 1, cause: 'smoke', transient: true, detail: 'Setup live smoke timed out/unavailable; integrations were saved and remain configured. Run zcode-kit doctor before retrying.' };
  }
}

function assertRepairAllowed(ctx) {
  if (existsSync(join(ctx.root, '.git')) && process.env.ZCODE_KIT_ALLOW_CHECKOUT !== '1') {
    throw new Error('refusing doctor --fix writes from a source checkout; use the installed copy or explicitly set ZCODE_KIT_ALLOW_CHECKOUT=1');
  }
}
async function alignOfflineKey(ctx, tx) {
  const text = readFileSync(ctx.config, 'utf8');
  const keys = [...text.matchAll(/^  proxyApiKey: "([A-Za-z0-9_-]+)"\r?$/gm)];
  const ports = [...text.matchAll(/^  port: (\d+)\r?$/gm)];
  const key = ctx.key();
  if (keys.length !== 1 || ports.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(key) || Number(ports[0][1]) < 1 || Number(ports[0][1]) > 65535) {
    throw new Error('proxy config/key corrupt or ambiguous; automatic repair refused');
  }
  if (keys[0][1] === key) return; // no config mutation needed
  // Entire known template, not a substring marker, is the ownership boundary.
  const normalize = s => s.replace(/\r\n/g, '\n').replace(/^  port: \d+$/m, '  port: PORT').replace(/^  proxyApiKey: "[A-Za-z0-9_-]+"$/m, '  proxyApiKey: "KEY"');
  if (normalize(text) !== normalize(readFileSync(ctx.configExample, 'utf8'))) throw new Error('custom or corrupt proxy config; automatic repair requires an unambiguous kit template');
  // Holding an exclusive loopback bind while replacing the config proves no
  // listener was present and avoids racing a start on this same port.
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', () => reject(new Error('port occupied by a listener; key alignment refused, nothing stopped')));
    reservation.listen({ host: '127.0.0.1', port: Number(ports[0][1]), exclusive: true }, resolve);
  });
  try {
    if (readFileSync(ctx.config, 'utf8') !== text || ctx.key() !== key) throw new Error('runtime files changed concurrently; retry after inspecting ownership');
    // AUD-005/B-12: unique staging name — a fixed name left by a crash would
    // block every later repair with EEXIST.
    tx.touch(ctx.config);
    const temp = `${ctx.config}.zcode-staging-${process.pid}-${randomBytes(6).toString('hex')}`;
    writeFileSync(temp, text.replace(keys[0][0], `  proxyApiKey: "${key}"`), { flag: 'wx', mode: 0o600 });
    try { renameSync(temp, ctx.config); } finally { rmSync(temp, { force: true }); }
  } finally { await new Promise(resolve => reservation.close(resolve)); }
}

export async function repairManaged(ctx, adapters, log = () => {}) {
  assertRepairAllowed(ctx);
  const lock = acquireLock(ctx.backupDir);
  const tx = beginTransaction(ctx.backupDir, 'zcode-kit doctor --fix');
  const prior = ctx.tx; ctx.tx = tx;
  try {
    await alignOfflineKey(ctx, tx);
    for (const adapter of adapters) await adapter.apply(ctx, tx, log);
    const id = tx.finish();
    logHeal(ctx, { cause: 'repair', action: 'reapply', result: 'ok' });
    return { id };
  } catch (err) {
    // Commit post-hashes first so rollback remains conflict-aware, rather than
    // blindly restoring an in-progress journal over unrelated concurrent edits.
    // B-24: a failure here must not mask the original error or skip logging.
    try {
      const id = tx.finish();
      if (id) rollbackTransaction(ctx.backupDir, id);
    } catch (undoErr) {
      err.message += ` (automatic rollback also failed: ${undoErr.message} — run zcode-kit rollback)`;
    }
    logHeal(ctx, { cause: 'repair', action: 'reapply', result: 'refused' });
    throw err;
  } finally { ctx.tx = prior; releaseLock(lock); }
}

let entry = '';
try { entry = realpathSync(process.argv[1] ?? ''); } catch {}
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startupPreflight(createCtx()).then(result => {
    if (process.argv.includes('--diagnostic-code')) {
      if (result.recovered) console.error('[zcode-preflight] cause=hung');
      console.error(`[zcode-preflight] cause=${CAUSES.has(result.cause) ? result.cause : 'unknown'}`);
    } else {
      if (result.recovered) console.error(PREFLIGHT_WARNINGS.hung);
      console.error(result.detail);
    }
    process.exitCode = result.code;
  }).catch(() => { console.error('ZCode preflight failed; run zcode-kit doctor.'); process.exitCode = 2; });
}
