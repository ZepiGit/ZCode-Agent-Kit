import { accessSync, constants, existsSync, readFileSync, readlinkSync, statSync } from 'node:fs';
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

/**
 * Command line and executable of a live process: { commandLine, executablePath }
 * or null when either cannot be read. Callers use it as ownership evidence, so
 * every failure (unknown pid, access denied, timeout, platform) is null —
 * never a guess. Windows asks CIM (Get-Process has no command line); Linux
 * reads /proc; macOS asks ps.
 */
export function processCommandLine(pid, { timeoutMs = 15000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object CommandLine,ExecutablePath | ConvertTo-Json -Compress`;
    // Two attempts: PowerShell cold start on busy machines can exceed one timeout.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
          stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, encoding: 'utf8', windowsHide: true,
        });
        if (r.status !== 0) continue;
        const text = (r.stdout ?? '').trim();
        if (!text) return null; // no such process
        const j = JSON.parse(text);
        if (typeof j?.CommandLine !== 'string' || typeof j?.ExecutablePath !== 'string') return null;
        return { commandLine: j.CommandLine, executablePath: j.ExecutablePath };
      } catch {}
    }
    return null;
  }
  if (process.platform === 'darwin') {
    try {
      const opts = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, LC_ALL: 'C' } };
      const command = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], opts);
      const comm = spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], opts);
      const commandLine = (command.stdout ?? '').trim(), executablePath = (comm.stdout ?? '').trim();
      if (command.status === 0 && comm.status === 0 && commandLine && executablePath) return { commandLine, executablePath };
    } catch {}
    return null;
  }
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    if (!argv.length) return null; // zombie or kernel thread
    let executablePath = argv[0];
    try { executablePath = readlinkSync(`/proc/${pid}/exe`); } catch {}
    let cwd;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch {}
    return { commandLine: argv.map(arg => JSON.stringify(arg)).join(' '), executablePath, cwd };
  } catch {
    return null;
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
