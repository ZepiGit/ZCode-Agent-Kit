#!/usr/bin/env node
// One-shot shared startup preflight. Never stop/restart a service, guess ownership,
// print provider bodies, or schedule recurring provider checks.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createCtx } from './context.mjs';
import { diagnoseQuota } from './quota-diagnostics.mjs';
export { diagnoseQuota, isQuotaSnapshot } from './quota-diagnostics.mjs';
import { acquireLock, releaseLock, beginTransaction, rollbackTransaction } from '../lib/transaction.mjs';

const CAUSES = new Set(['healthy', 'auth3012', 'balance1113', 'balance3001', 'auth', 'balance', 'foreign', 'startup', 'quota-unavailable', 'smoke', 'skipped', 'repair', 'unknown']);
const ACTIONS = new Set(['safe-start', 'quota-check', 'smoke-check', 'reapply', 'none']);
const RESULTS = new Set(['ok', 'failed', 'refused', 'skipped', 'warning', 'unknown']);
const LOG_LIMIT = 64 * 1024;
export function logHeal(ctx, { cause, action, result }) {
  // Allow-list, not redaction: provider text, paths and credentials can never
  // become log fields. A bounded second file is the only retained rotation.
  try {
    const dir = join(ctx.root, 'logs'); mkdirSync(dir, { recursive: true });
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

const inFlight = new Map();
export function startupPreflight(ctx, options = {}) {
  const id = `${ctx.root}\n${ctx.home}`;
  if (inFlight.has(id)) return inFlight.get(id);
  const work = preflight(ctx, options).finally(() => inFlight.delete(id));
  inFlight.set(id, work);
  return work;
}
async function preflight(ctx, { timeoutMs = 8000 } = {}) {
  let code;
  try {
    const { createManager } = await import('../proxy/zcode-proxy-manager.mjs');
    code = await createManager({ root: ctx.root, home: ctx.home }).start({ waitMs: 20000 });
  }
  catch { return outcome(ctx, 4, 'startup', 'ZCode safe start refused; inspect manager ownership lock/config with zcode-kit doctor. No takeover attempted.', 'safe-start'); }
  if (code !== 0) return outcome(ctx, code, code === 3 ? 'foreign' : 'startup', code === 3 ? 'ZCode port occupied or key mismatched. Listener left untouched; run zcode-kit doctor --fix or inspect ownership manually.' : 'ZCode safe start failed. Run zcode-kit doctor; inspect logs/proxy.log and manager lock ownership.', 'safe-start');
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

export async function setupSmoke(ctx, { env = process.env, timeoutMs = 90000 } = {}) {
  if ((env.CI && env.CI !== '0' && env.CI !== 'false') || env.NODE_ENV === 'test' || env.ZCODE_KIT_SKIP_SMOKE === '1' || env.ZCODE_KIT_SKIP_DEPS === '1') {
    logHeal(ctx, { cause: 'skipped', action: 'smoke-check', result: 'skipped' });
    return { code: 0, cause: 'skipped', detail: 'Setup live smoke skipped (CI/test or explicit ZCODE_KIT_SKIP_SMOKE=1).' };
  }
  const ready = await startupPreflight(ctx);
  if (ready.code) return ready;
  try {
    const response = await fetch(`http://127.0.0.1:${ctx.port()}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${ctx.key()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, stream: false, thinking: { type: 'disabled' } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null);
    const diagnostic = diagnoseQuota(response.status, body);
    if (diagnostic.code) return outcome(ctx, diagnostic.code, diagnostic.cause, diagnostic.detail, 'smoke-check');
    const ok = response.ok && Array.isArray(body?.choices) && body.choices.length > 0;
    return outcome(ctx, ok ? 0 : 1, 'smoke', ok ? 'Setup live smoke passed (one minimal model request).' : 'Setup live smoke failed; integrations were saved. Run zcode-kit doctor before retrying.', 'smoke-check');
  } catch {
    return outcome(ctx, 1, 'smoke', 'Setup live smoke timed out/unavailable; integrations were saved. No retry scheduled.', 'smoke-check');
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
    tx.touch(ctx.config);
    const temp = ctx.config + '.zcode-staging';
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
    const id = tx.finish();
    if (id) rollbackTransaction(ctx.backupDir, id);
    logHeal(ctx, { cause: 'repair', action: 'reapply', result: 'refused' });
    throw err;
  } finally { ctx.tx = prior; releaseLock(lock); }
}

let entry = '';
try { entry = realpathSync(process.argv[1] ?? ''); } catch {}
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startupPreflight(createCtx()).then(result => {
    console.error(result.detail); process.exitCode = result.code;
  }).catch(() => { console.error('ZCode preflight failed; run zcode-kit doctor.'); process.exitCode = 2; });
}
