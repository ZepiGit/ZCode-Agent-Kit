#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCtx } from './context.mjs';
import { runtimeWarningLines, startupPreflight } from './heal.mjs';
import { resolveCommand, runCommandSync } from '../lib/process.mjs';

// On POSIX the launcher ends by replacing itself with the harness
// (process.execve): the harness keeps the launcher's pid, terminal and
// environment, and no kit process stays beside it for the session. Windows
// has no such call, so there the launcher stays resident, runs the harness as
// a child and passes its exit code on.
//
// Nothing of the launcher runs after the handover (no exit handler, no code
// after the call), so it happens last: the preflight has returned (start lock
// released, heal.log written) and its lines are printed.
const HANDOVER_NODE = [26, 1];

/**
 * The executable `run` replaces itself with, or null to stay resident.
 * Resident when: ZCODE_KIT_RESIDENT_LAUNCHER is exactly "1" (the opt-out);
 * Windows; a Node without process.execve or older than 26.1; an exit handler
 * is registered (something still expects to clean up when this process
 * ends); or the command is not an executable on PATH (the resident path then
 * reports it as it always did).
 */
export function handoverTarget(command, env, {
  optOut = process.env.ZCODE_KIT_RESIDENT_LAUNCHER, platform = process.platform, execve = process.execve,
  nodeVersion = process.versions.node, exitHandlers = process.listenerCount('exit'),
} = {}) {
  if (optOut === '1' || platform === 'win32' || typeof execve !== 'function' || exitHandlers > 0) return null;
  const [major, minor] = String(nodeVersion).split('.').map(Number);
  if (!(major > HANDOVER_NODE[0] || (major === HANDOVER_NODE[0] && minor >= HANDOVER_NODE[1]))) return null;
  try { return resolveCommand(command, env); } catch { return null; }
}

/** Replace this process with `file`. Returns only when that failed, with the error. */
function handOver(file, argv, env) {
  // Node ignores SIGPIPE and SIGXFSZ, and an ignored signal stays ignored
  // across an exec. Adding and removing a listener leaves the default action,
  // which is what a harness started from a shell gets.
  for (const signal of ['SIGPIPE', 'SIGXFSZ']) {
    const listener = () => {};
    process.on(signal, listener);
    process.removeListener(signal, listener);
  }
  // process.execve is marked experimental; its warning must not reach the
  // harness session. Silenced for this call only.
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (String(warning?.message ?? warning).includes('process.execve')) return;
    emitWarning.call(process, warning, ...rest);
  };
  try {
    process.execve(file, [file, ...argv], env);
    return new Error('process.execve returned');
  } catch (err) {
    // Still this process: keep a closed pipe an error, not the end of the launcher.
    for (const signal of ['SIGPIPE', 'SIGXFSZ']) process.on(signal, () => {});
    return err;
  } finally {
    process.emitWarning = emitWarning;
  }
}

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
  for (const line of runtimeWarningLines(ready.runtime)) console.error(line);
  console.error(ready.detail);
  if (ready.code) return ready.code;
  const target = handoverTarget(command, env);
  if (target) {
    // What was printed is written out before the process is replaced
    // (terminals, pipes and files are written synchronously on POSIX; this
    // waits only where a stream still holds something).
    for (const name of ['stdout', 'stderr']) {
      try {
        const stream = process[name];
        if (stream.writableLength > 0) await new Promise(resolve => stream.write('', () => resolve()));
      } catch { /* a closed stream holds nothing */ }
    }
    handOver(target, argv, env);
    // The handover failed (a file the kernel does not run directly, for
    // example); the resident path runs it or reports it as before.
  }
  const result = runCommandSync(command, argv, { stdio: 'inherit', env });
  if (result.error) { console.error(`run: ${result.error.message}`); return 2; }
  return result.status ?? 1;
}
let entry = '';
try { entry = realpathSync(process.argv[1] ?? ''); } catch {}
if (entry && import.meta.url === pathToFileURL(entry).href) {
  launchHarness(createCtx(), process.argv[2], process.argv.slice(3)).then(code => { process.exitCode = code; }).catch(err => { console.error(err.message); process.exitCode = 2; });
}
