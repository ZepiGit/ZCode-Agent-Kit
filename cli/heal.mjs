#!/usr/bin/env node
// One-shot shared startup preflight. Never guess ownership, print provider
// bodies, or schedule recurring provider checks. The only process it can end
// is a proven hung own proxy, via the lifecycle's hung-own proof (ensure running).
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createCtx } from './context.mjs';
import { diagnoseQuota } from './quota-diagnostics.mjs';
export { diagnoseQuota, isQuotaSnapshot } from './quota-diagnostics.mjs';
import { acquireLock, releaseLock, beginTransaction, rollbackTransaction } from '../lib/transaction.mjs';
import { formatEventLine } from '../lib/event-line.mjs';
import { NODE_FLOOR, nodeMajor } from '../lib/node-floor.mjs';
import { CAUSES, appendHealLine, logHeal } from '../lib/heal-log.mjs';
export { logHeal } from '../lib/heal-log.mjs';

function outcome(ctx, code, cause, detail, action = 'quota-check') {
  logHeal(ctx, { cause, action, result: code ? 'failed' : cause === 'quota-unavailable' ? 'warning' : 'ok' });
  return { code, cause, detail };
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
  'runtime-floor': `The autostart's pinned Node.js is below the support floor (Node.js ${NODE_FLOOR}); run zcode-kit setup with Node.js ${NODE_FLOOR} or newer, then restart OMP.`,
  'runtime-missing': `The autostart's pinned Node.js path no longer exists; run zcode-kit setup with Node.js ${NODE_FLOOR} or newer, then restart OMP.`,
};

// The OMP autostart runs this preflight with the
// absolute interpreter path setup pinned. A version manager can remove that
// Node or leave it below the floor after an upgrade; report both. Only this
// installation's autostart is checked, a pinned Bun is out of scope (the floor
// is a Node floor), and nothing is changed: setup re-pins.
const AUTOSTART_MAX_BYTES = 256 * 1024;
const RUNTIME_NEXT = 'zcode-kit setup, then restart OMP';
function templateLiteral(source, name) {
  const raw = source.match(new RegExp(`^const ${name} = "((?:[^"\\\\\\r\\n]|\\\\.)*)";\\r?$`, 'm'))?.[1];
  if (raw === undefined || raw.startsWith('__ZCODE_OM_')) return null;
  try { return JSON.parse(`"${raw}"`); } catch { return null; }
}
const samePath = (a, b) => {
  const canonical = (p) => { let r = resolve(p); try { r = realpathSync(r); } catch {} return process.platform === 'win32' ? r.toLowerCase() : r; };
  return canonical(a) === canonical(b);
};
export function autostartRuntimeCheck(ctx) {
  let source;
  try {
    const file = join(ctx.home, '.omp', 'agent', 'extensions', 'zcode-proxy-autostart.ts');
    if (!existsSync(file) || statSync(file).size > AUTOSTART_MAX_BYTES) return null;
    source = readFileSync(file, 'utf8');
  } catch { return null; }
  const root = templateLiteral(source, 'ROOT');
  const runtime = templateLiteral(source, 'RUNTIME');
  if (!root || !runtime || !samePath(root, ctx.root)) return null;
  if (/^bun(?:\.exe)?$/i.test(basename(runtime))) return null;
  if (!existsSync(runtime)) return { cause: 'runtime-missing', detail: 'the pinned Node.js path no longer exists', next: RUNTIME_NEXT };
  let version = null;
  if (samePath(runtime, process.execPath)) version = process.version;
  else {
    const probe = spawnSync(runtime, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    if (probe.error?.code === 'ENOENT') return { cause: 'runtime-missing', detail: 'the pinned Node.js path no longer exists', next: RUNTIME_NEXT };
    if (!probe.error && probe.status === 0) version = String(probe.stdout ?? '').trim().split(/\r?\n/)[0];
  }
  const major = nodeMajor(version);
  if (major === null || major >= NODE_FLOOR) return null; // unreadable is not a claim the preflight makes
  return { cause: 'runtime-floor', detail: `the pinned Node.js ${version} is below the support floor (Node.js ${NODE_FLOOR})`, next: RUNTIME_NEXT };
}
/** The off-TTY check rows for a runtime warning. */
export function runtimeWarningLines(runtime) {
  return runtime ? [`WARN  OMP autostart runtime \u2014 ${runtime.detail}`, `  next: ${runtime.next}`] : [];
}
function logRuntimeWarning(ctx, runtime) {
  appendHealLine(ctx, formatEventLine({ level: 'WARN', component: 'preflight', message: 'OMP autostart runtime check',
    fields: { cause: runtime.cause, action: 'runtime-check', result: 'warning' } }));
}

const inFlight = new Map();
export function startupPreflight(ctx, options = {}) {
  const id = `${ctx.root}\n${ctx.home}`;
  if (inFlight.has(id)) return inFlight.get(id);
  const work = preflight(ctx, options).then((result) => {
    let runtime = null;
    try { runtime = autostartRuntimeCheck(ctx); } catch { /* the check must never break a launch */ }
    if (!runtime) return result;
    logRuntimeWarning(ctx, runtime);
    return { ...result, runtime };
  }).finally(() => inFlight.delete(id));
  inFlight.set(id, work);
  return work;
}
async function preflight(ctx, { timeoutMs = 8000 } = {}) {
  let code, recovered = false;
  try {
    // The lifecycle intent, not the manager CLI: the preflight imports no
    // presentation code. Its narration lines stream to stdout as
    // the manager printed them.
    const { createLifecycle } = await import('../lib/proxy-lifecycle.mjs');
    const started = await createLifecycle({ root: ctx.root, home: ctx.home }).ensureRunning({ waitMs: 20000, observe: line => console.log(line) });
    if (started.outcome === 'start-lock-unavailable') throw new Error(started.error);
    code = started.code;
    // The lifecycle already logged cause=hung action=recover to heal.log.
    recovered = started.recovered !== null;
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
  // The match ends before the line break, so the replacement below keeps the
  // file's own line ending (a CRLF config stays CRLF).
  const keys = [...text.matchAll(/^  proxyApiKey: "([A-Za-z0-9_-]+)"(?=\r?$)/gm)];
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
    // Unique staging name — a fixed name left by a crash would
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
    // A failure here must not mask the original error or skip logging.
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
      if (result.runtime) console.error(`[zcode-preflight] cause=${result.runtime.cause}`);
      console.error(`[zcode-preflight] cause=${CAUSES.has(result.cause) ? result.cause : 'unknown'}`);
    } else {
      if (result.recovered) console.error(PREFLIGHT_WARNINGS.hung);
      for (const line of runtimeWarningLines(result.runtime)) console.error(line);
      console.error(result.detail);
    }
    process.exitCode = result.code;
  }).catch(() => { console.error('ZCode preflight failed; run zcode-kit doctor.'); process.exitCode = 2; });
}
