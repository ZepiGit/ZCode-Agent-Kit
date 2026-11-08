// heal.log: the bounded, fixed-vocabulary record of preflight and lifecycle
// outcomes (cause=… action=… result=…). Shared by the preflight
// (cli/heal.mjs) and the proxy lifecycle module (lib/proxy-lifecycle.mjs), so
// the lifecycle path needs no CLI module to write it.
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CAUSES = new Set(['healthy', 'auth3012', 'balance1113', 'balance3001', 'auth', 'balance', 'foreign', 'startup', 'quota-unavailable', 'smoke', 'skipped', 'repair', 'hung', 'respawn', 'unknown']);
const ACTIONS = new Set(['safe-start', 'quota-check', 'smoke-check', 'reapply', 'recover', 'respawn', 'none']);
const RESULTS = new Set(['ok', 'failed', 'refused', 'skipped', 'warning', 'unknown']);
const LOG_LIMIT = 64 * 1024;
export function logHeal(ctx, { cause, action, result }) {
  // Allow-list, not redaction: provider text, paths and credentials can never
  // become log fields. A bounded second file is the only retained rotation.
  appendHealLine(ctx, `${new Date().toISOString()} cause=${CAUSES.has(cause) ? cause : 'unknown'} action=${ACTIONS.has(action) ? action : 'none'} result=${RESULTS.has(result) ? result : 'unknown'}`);
}
export function appendHealLine(ctx, text) {
  try {
    const dir = ctx.logDir ?? join(ctx.root, 'logs'); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'heal.log');
    const line = `${text}\n`;
    if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > LOG_LIMIT) {
      rmSync(file + '.1', { force: true });
      if (statSync(file).size <= LOG_LIMIT) renameSync(file, file + '.1');
      else { writeFileSync(file + '.1', 'previous oversized heal log discarded\n'); rmSync(file); }
    }
    appendFileSync(file, line, { mode: 0o600 });
  } catch { /* logging must not break a launch */ }
}
