import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

function identity(root) {
  let path = resolve(root);
  try { path = realpathSync(path); } catch {}
  return process.platform === 'win32' ? path.toLowerCase() : path;
}
export function stateDirectory(root, home, env = process.env) {
  if (env.ZCODE_KIT_STATE_DIR) {
    if (!isAbsolute(env.ZCODE_KIT_STATE_DIR)) throw new Error('ZCODE_KIT_STATE_DIR must be absolute');
    return resolve(env.ZCODE_KIT_STATE_DIR);
  }
  let npmInstall = false;
  try { npmInstall = /(?:^|[\\/])node_modules[\\/]zcode-agent-kit$/i.test(root) && JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'zcode-agent-kit'; } catch {}
  if (!npmInstall) return root;
  const base = process.platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local') : env.XDG_STATE_HOME || join(home, '.local', 'state');
  const id = createHash('sha256').update(identity(root)).digest('hex').slice(0, 24);
  return join(base, 'zcode-agent-kit', 'installs', id);
}
function assertTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`state migration refuses a symbolic link: ${path}`);
  if (stat.isDirectory()) for (const item of readdirSync(path)) assertTree(join(path, item));
}
function liveLegacyPid(root) {
  const file = join(root, 'logs', 'proxy.pid');
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8').trim();
  let pid;
  try { pid = JSON.parse(text).pid; } catch { pid = Number(text.split(/\r?\n/)[0]); }
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('legacy proxy PID is invalid; inspect it before migrating state');
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}
const MEMBERS = ['.proxykey', 'proxy/config.yaml', 'backups', 'generated', 'logs'];
const FILE_MEMBERS = new Set(['.proxykey', 'proxy/config.yaml']);

function mappedStateTarget(root, target, stateDir) {
  const rootId = identity(root);
  const targetId = identity(target);
  for (const member of MEMBERS) {
    const memberId = identity(join(rootId, member));
    if (targetId === memberId) return join(stateDir, ...member.split('/'));
    if (FILE_MEMBERS.has(member)) continue;
    const prefix = memberId.endsWith(sep) ? memberId : memberId + sep;
    if (targetId.startsWith(prefix)) return join(stateDir, ...member.split('/'), targetId.slice(prefix.length));
  }
}

function migrateManifestTargets(dir, root, stateDir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!/^tx-.+\.manifest(?:\.in-progress)?\.json$/.test(name)) continue;
    const file = join(dir, name);
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    for (const op of manifest.ops ?? []) {
      if (typeof op.target !== 'string' || !isAbsolute(op.target)) continue;
      const mapped = mappedStateTarget(root, op.target, stateDir);
      if (mapped) op.target = mapped;
    }
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  }
}

function chmodCopied(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`state migration refuses a symbolic link: ${path}`);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const item of readdirSync(path)) chmodCopied(join(path, item));
    return;
  }
  chmodSync(path, 0o600);
}

function assertNoLegacyLocks(root) {
  const setupLock = join(root, 'backups', '.setup-lock');
  const managerLock = join(root, 'logs', 'manager.lock');
  if (existsSync(setupLock)) {
    throw new Error(`legacy setup lock is present at ${setupLock}; stop the running setup or remove the lock before migrating state`);
  }
  if (existsSync(managerLock)) {
    throw new Error(`legacy manager lock is present at ${managerLock}; stop the running manager or remove the lock before migrating state`);
  }
}

export function ensureState(ctx) {
  if (ctx.stateDir === ctx.root) return;
  if (/[\\/]_npx[\\/]/i.test(ctx.root)) throw new Error('setup from an ephemeral npx cache is not durable; install zcode-agent-kit globally first');
  const ownerFile = join(ctx.stateDir, '.owner.json');
  if (existsSync(ctx.stateDir)) {
    if (!existsSync(ownerFile)) {
      throw new Error(`state directory ${ctx.stateDir} exists without .owner.json; refusing to take it over or delete it. Inspect the directory, then either restore a matching .owner.json or move it aside before retrying`);
    }
    const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
    if (owner.root !== identity(ctx.root)) throw new Error('state directory belongs to a different kit installation');
    return;
  }
  const parent = dirname(ctx.stateDir);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lock = ctx.stateDir + '.migration-lock';
  const nonce = randomBytes(16).toString('hex');
  writeFileSync(lock, nonce, { flag: 'wx', mode: 0o600 });
  const staging = ctx.stateDir + '.staging-' + nonce;
  try {
    if (existsSync(ctx.stateDir)) return ensureState(ctx);
    if (liveLegacyPid(ctx.root)) throw new Error('legacy proxy is still running; stop it using the old installation before migrating state');
    assertNoLegacyLocks(ctx.root);
    mkdirSync(staging, { mode: 0o700 });
    for (const member of MEMBERS) {
      const src = join(ctx.root, member);
      if (!existsSync(src)) continue;
      assertTree(src);
      mkdirSync(dirname(join(staging, member)), { recursive: true, mode: 0o700 });
      const dest = join(staging, member);
      cpSync(src, dest, { recursive: true, errorOnExist: true, force: false });
      chmodCopied(dest);
    }
    migrateManifestTargets(join(staging, 'backups'), ctx.root, ctx.stateDir);
    writeFileSync(join(staging, '.owner.json'), JSON.stringify({ root: identity(ctx.root), migratedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    renameSync(staging, ctx.stateDir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    if (readFileSync(lock, 'utf8') === nonce) rmSync(lock);
  }
}
