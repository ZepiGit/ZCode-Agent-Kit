import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function envValue(env, name) {
  // Windows env blocks commonly carry `Path` while callers override `PATH`;
  // the exact-case assignment the caller made must win over an inherited
  // differently-cased duplicate (e.g. the runner's original Path).
  if (Object.hasOwn(env, name)) return env[name];
  const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}
function executable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch { return false; }
}

export function resolveCommand(command, env = process.env) {
  const explicit = isAbsolute(command) || /[\\/]/.test(command);
  const names = process.platform === 'win32' && !extname(command)
    ? ['.exe', '.com', '.cmd', '.bat'].map(ext => command + ext) : [command];
  const dirs = explicit ? [''] : (envValue(env, 'PATH') ?? '').split(delimiter).filter(dir => dir && isAbsolute(dir));
  for (const dir of dirs) {
    for (const name of names) {
      const file = explicit ? resolve(name) : join(dir, name);
      if (executable(file)) return file;
    }
  }
  const err = new Error(`command not found on PATH: ${command} (ENOENT)`);
  err.code = 'ENOENT';
  throw err;
}

function unwrapShim(file, env) {
  const text = readFileSync(file, 'utf8');
  if (text.length > 64 * 1024) throw new Error(`unsupported batch shim: ${file}`);
  const invocationText = text.replace(/^endlocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & /gim, '');
  const calls = [...invocationText.matchAll(/^\s*"([^"\r\n]+)"\s+"((?:%dp0%|%~dp0)[^"\r\n]+)"\s+%\*\s*$/gim)];
  const nativeCalls = [...invocationText.matchAll(/^\s*"((?:%dp0%|%~dp0)[^"\r\n]+\.(?:exe|com))"\s+%\*\s*$/gim)];
  if (nativeCalls.length) {
    if (nativeCalls.length !== 1 || calls.length) throw new Error(`ambiguous native batch shim: ${file}`);
    const target = resolve(nativeCalls[0][1].replace(/^%(?:dp0%|~dp0)/i, () => dirname(file) + '\\'));
    if (!executable(target)) throw new Error(`batch shim target missing: ${target}`);
    return { command: target, args: [] };
  }
  const targets = [...new Set(calls.map(match => match[2].replace(/^%(?:dp0%|~dp0)/i, () => dirname(file) + '\\')))];
  if (targets.length !== 1) throw new Error(`unsupported batch shim: ${file}; install a native executable or a standard npm command shim`);
  const target = resolve(targets[0]);
  if (!existsSync(target)) throw new Error(`batch shim target missing: ${target}`);
  if (/\.(exe|com)$/i.test(target)) return { command: target, args: [] };
  if (!/\.(?:c?js|mjs)$/i.test(target)) throw new Error(`unsupported batch shim target: ${target}`);
  const runner = calls[0][1];
  if (!/(?:node(?:\.exe)?|%_prog%)$/i.test(runner) || (runner === '%_prog%' && !/set\s+"?_prog=node(?:\.exe)?"?\s*$/im.test(text))) {
    throw new Error(`unsupported batch shim interpreter: ${file}`);
  }
  const siblingNode = join(dirname(file), 'node.exe');
  const node = isAbsolute(runner) && executable(runner) ? runner : executable(siblingNode) ? siblingNode : resolveCommand('node', env);
  if (/\.(?:cmd|bat)$/i.test(node)) throw new Error(`native Node executable required for shim: ${file}`);
  return { command: node, args: [target] };
}

export function commandInvocation(command, args = [], env = process.env) {
  const file = resolveCommand(command, env);
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)) {
    const target = unwrapShim(file, env);
    return { command: target.command, args: [...target.args, ...args] };
  }
  return { command: file, args };
}

export function runCommandSync(command, args = [], options = {}) {
  try {
    const invocation = commandInvocation(command, args, options.env ?? process.env);
    return spawnSync(invocation.command, invocation.args, { ...options, shell: false, windowsVerbatimArguments: false });
  } catch (error) {
    return { status: null, signal: null, error, stdout: '', stderr: '' };
  }
}

export function resolveBun(root, env = process.env) {
  const explicit = env.ZCODE_KIT_BUN;
  if (explicit) {
    const invocation = commandInvocation(explicit, [], env);
    if (invocation.args.length) throw new Error('ZCODE_KIT_BUN must resolve to a native Bun executable');
    return invocation.command;
  }
  const candidates = [];
  try { candidates.push(readFileSync(join(root, '.bun-path'), 'utf8').trim()); } catch {}
  try {
    const invocation = commandInvocation('bun', [], env);
    if (invocation.args.length === 0) candidates.push(invocation.command);
  } catch {}
  const home = env.USERPROFILE ?? env.HOME;
  if (home) candidates.push(join(home, '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'));
  for (const file of candidates) {
    if (file && isAbsolute(file) && executable(file) && (process.platform !== 'win32' || /\.exe$/i.test(file))) return file;
  }
  throw new Error('Bun native executable not found; install Bun or set ZCODE_KIT_BUN to its executable path');
}
