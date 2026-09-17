#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCtx } from './context.mjs';
import { startupPreflight } from './heal.mjs';
import { runCommandSync } from '../lib/process.mjs';

export async function launchHarness(ctx, id, args = []) {
  const env = { ...process.env, ZCODE_PROXY_KEY: ctx.key() };
  let command, argv = args;
  if (id === 'claude-code') {
    const settings = join(ctx.generated, 'claude-zcode-settings.json');
    if (!existsSync(settings)) throw new Error('Claude settings missing; run zcode-kit integrate claude-code');
    command = 'claude'; argv = ['--settings', settings, ...args];
  } else if (id === 'codex') {
    env.CODEX_HOME = join(ctx.generated, 'codex-home');
    if (!existsSync(join(env.CODEX_HOME, 'config.toml'))) throw new Error('Codex config missing; run zcode-kit integrate codex');
    command = 'codex';
  } else if (id === 'aider') {
    if (!existsSync(join(ctx.generated, 'aider-zcode.env'))) throw new Error('Aider config missing; run zcode-kit integrate aider');
    env.OPENAI_API_BASE = `http://127.0.0.1:${ctx.port()}/v1`;
    env.OPENAI_API_KEY = ctx.key();
    command = 'aider'; argv = args.length ? args : ['--model', 'openai/glm-5.3'];
  } else if (id === 'opencode') command = 'opencode';
  else throw new Error(`run: no launcher for "${id}" (use setup/integrate instead)`);
  const ready = await startupPreflight(ctx);
  console.error(ready.detail);
  if (ready.code) return ready.code;
  const result = runCommandSync(command, argv, { stdio: 'inherit', env });
  if (result.error) { console.error(`run: ${result.error.message}`); return 2; }
  return result.status ?? 1;
}
let entry = '';
try { entry = realpathSync(process.argv[1] ?? ''); } catch {}
if (entry && import.meta.url === pathToFileURL(entry).href) {
  launchHarness(createCtx(), process.argv[2], process.argv.slice(3)).then(code => { process.exitCode = code; }).catch(err => { console.error(err.message); process.exitCode = 2; });
}
