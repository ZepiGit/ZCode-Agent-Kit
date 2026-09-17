import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createCtx, bootstrap } from '../cli/context.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'kit-state-'));
  const root = join(base, 'node_modules', 'zcode-agent-kit');
  const home = join(base, 'home');
  mkdirSync(join(root, 'proxy'), { recursive: true }); mkdirSync(home);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'zcode-agent-kit' }));
  cpSync(new URL('../proxy/config.example.yaml', import.meta.url), join(root, 'proxy', 'config.example.yaml'));
  const old = { ...process.env };
  process.env.HOME = process.env.USERPROFILE = home;
  process.env.LOCALAPPDATA = join(home, 'local');
  process.env.XDG_STATE_HOME = join(home, 'state');
  process.env.ZCODE_KIT_SKIP_DEPS = '1';
  delete process.env.ZCODE_KIT_STATE_DIR;
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); rmSync(base, { recursive: true, force: true }); });
  return { base, root, home };
}

test('npm package replacement preserves key, rollback evidence and Codex user data', t => {
  const { root, home } = fixture(t);
  const ctx = createCtx(root, home);
  assert.notEqual(ctx.stateDir, root, 'mutable state must not live in npm package');
  assert.ok(ctx.stateDir && !ctx.stateDir.startsWith(root));
  bootstrap(ctx);
  const key = ctx.key();
  mkdirSync(join(ctx.generated, 'codex-home'), { recursive: true });
  writeFileSync(join(ctx.generated, 'codex-home', 'history.jsonl'), 'keep-history');
  mkdirSync(ctx.backupDir, { recursive: true });
  writeFileSync(join(ctx.backupDir, 'evidence'), 'keep-backup');
  rmSync(root, { recursive: true }); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'zcode-agent-kit' }));
  const next = createCtx(root, home);
  assert.equal(next.key(), key);
  assert.equal(readFileSync(join(next.generated, 'codex-home', 'history.jsonl'), 'utf8'), 'keep-history');
  assert.equal(readFileSync(join(next.backupDir, 'evidence'), 'utf8'), 'keep-backup');
});

test('legacy npm state migration preserves originals and rewrites only kit state targets', t => {
  const { root, home } = fixture(t);
  writeFileSync(join(root, '.proxykey'), 'synthetic-key');
  writeFileSync(join(root, 'proxy', 'config.yaml'), 'server:\n  port: 18757\n  proxyApiKey: "synthetic-key"\n');
  mkdirSync(join(root, 'backups'));
  const target = join(root, 'generated', 'codex-home', 'config.toml');
  writeFileSync(join(root, 'backups', 'tx-old.manifest.json'), JSON.stringify({ id: 'old', ops: [{ kind: 'create', target }, { kind: 'modify', target: join(home, 'config.json') }] }));
  const ctx = createCtx(root, home);
  bootstrap(ctx);
  assert.equal(ctx.key(), 'synthetic-key');
  assert.equal(readFileSync(join(root, '.proxykey'), 'utf8'), 'synthetic-key');
  const migrated = JSON.parse(readFileSync(join(ctx.backupDir, 'tx-old.manifest.json')));
  assert.equal(resolve(migrated.ops[0].target), resolve(join(ctx.generated, 'codex-home', 'config.toml')));
  assert.equal(migrated.ops[1].target, join(home, 'config.json'));
});

test('read-only context creation does not mutate missing state or rotate a key', t => {
  const { root, home } = fixture(t);
  const ctx = createCtx(root, home);
  assert.equal(existsSync(ctx.stateDir), false);
  assert.equal(existsSync(join(root, '.proxykey')), false);
});

test('manifest rewrite covers exact member dirs, backups children, and ignores relative targets', t => {
  const { root, home } = fixture(t);
  writeFileSync(join(root, '.proxykey'), 'synthetic-key');
  writeFileSync(join(root, 'proxy', 'config.yaml'), 'server:\n  port: 18757\n  proxyApiKey: "synthetic-key"\n');
  mkdirSync(join(root, 'backups'));
  mkdirSync(join(root, 'generated'));
  mkdirSync(join(root, 'logs'));
  const ops = [
    { kind: 'modify', target: join(root, '.proxykey') },
    { kind: 'modify', target: join(root, 'proxy', 'config.yaml') },
    { kind: 'modify', target: join(root, 'generated') },
    { kind: 'modify', target: join(root, 'logs') },
    { kind: 'modify', target: join(root, 'backups') },
    { kind: 'modify', target: join(root, 'backups', 'evidence.bin') },
    { kind: 'modify', target: join(root, 'logs', 'proxy.log') },
    { kind: 'create', target: 'generated/relative.toml' },
    { kind: 'modify', target: join(home, 'config.json') },
    { kind: 'modify', target: join(root, 'generated-extra', 'x') },
  ];
  if (process.platform === 'win32') ops.push({ kind: 'modify', target: join(root, 'GeNeRaTeD', 'nested.toml') });
  writeFileSync(join(root, 'backups', 'tx-old.manifest.json'), JSON.stringify({ id: 'old', ops }));
  writeFileSync(join(root, 'backups', 'tx-old.manifest.in-progress.json'), JSON.stringify({ id: 'ip', ops: [{ kind: 'modify', target: join(root, 'generated', 'a') }] }));
  const ctx = createCtx(root, home);
  bootstrap(ctx);
  const migrated = JSON.parse(readFileSync(join(ctx.backupDir, 'tx-old.manifest.json')));
  assert.equal(resolve(migrated.ops[0].target), resolve(ctx.keyFile));
  assert.equal(resolve(migrated.ops[1].target), resolve(ctx.config));
  assert.equal(resolve(migrated.ops[2].target), resolve(ctx.generated));
  assert.equal(resolve(migrated.ops[3].target), resolve(ctx.logDir));
  assert.equal(resolve(migrated.ops[4].target), resolve(ctx.backupDir));
  assert.equal(resolve(migrated.ops[5].target), resolve(join(ctx.backupDir, 'evidence.bin')));
  assert.equal(resolve(migrated.ops[6].target), resolve(join(ctx.logDir, 'proxy.log')));
  assert.equal(migrated.ops[7].target, 'generated/relative.toml');
  assert.equal(migrated.ops[8].target, join(home, 'config.json'));
  assert.equal(migrated.ops[9].target, join(root, 'generated-extra', 'x'));
  if (process.platform === 'win32') assert.equal(resolve(migrated.ops[10].target), resolve(join(ctx.generated, 'nested.toml')));
  const ip = JSON.parse(readFileSync(join(ctx.backupDir, 'tx-old.manifest.in-progress.json')));
  assert.equal(resolve(ip.ops[0].target), resolve(join(ctx.generated, 'a')));
});

test('legacy migration refuses a leftover setup lock instead of copying it', t => {
  const { root, home } = fixture(t);
  writeFileSync(join(root, '.proxykey'), 'synthetic-key');
  mkdirSync(join(root, 'backups'));
  writeFileSync(join(root, 'backups', '.setup-lock'), 'held');
  const ctx = createCtx(root, home);
  assert.throws(() => bootstrap(ctx), /setup lock/);
  assert.equal(existsSync(ctx.stateDir), false);
  assert.equal(readFileSync(join(root, 'backups', '.setup-lock'), 'utf8'), 'held');
});

test('legacy migration refuses a leftover manager lock instead of copying it', t => {
  const { root, home } = fixture(t);
  writeFileSync(join(root, '.proxykey'), 'synthetic-key');
  mkdirSync(join(root, 'logs'));
  writeFileSync(join(root, 'logs', 'manager.lock'), 'held');
  const ctx = createCtx(root, home);
  assert.throws(() => bootstrap(ctx), /manager lock/);
  assert.equal(existsSync(ctx.stateDir), false);
  assert.equal(readFileSync(join(root, 'logs', 'manager.lock'), 'utf8'), 'held');
});

test('existing external state without owner is fail-closed and left untouched', t => {
  const { root, home } = fixture(t);
  const ctx = createCtx(root, home);
  mkdirSync(ctx.stateDir, { recursive: true });
  writeFileSync(join(ctx.stateDir, 'keep-me'), 'secret');
  assert.throws(() => bootstrap(ctx), /\.owner\.json/);
  assert.equal(readFileSync(join(ctx.stateDir, 'keep-me'), 'utf8'), 'secret');
  assert.equal(existsSync(join(ctx.stateDir, '.owner.json')), false);
  assert.deepEqual(readdirSync(ctx.stateDir), ['keep-me']);
});

test('migrated copies are POSIX 0600 files and 0700 directories', { skip: process.platform === 'win32' }, t => {
  const { root, home } = fixture(t);
  writeFileSync(join(root, '.proxykey'), 'synthetic-key');
  mkdirSync(join(root, 'generated', 'codex-home'), { recursive: true });
  writeFileSync(join(root, 'generated', 'codex-home', 'history.jsonl'), 'keep-history');
  const ctx = createCtx(root, home);
  bootstrap(ctx);
  assert.equal(statSync(ctx.stateDir).mode & 0o777, 0o700);
  assert.equal(statSync(ctx.keyFile).mode & 0o777, 0o600);
  assert.equal(statSync(ctx.generated).mode & 0o777, 0o700);
  assert.equal(statSync(join(ctx.generated, 'codex-home')).mode & 0o777, 0o700);
  assert.equal(statSync(join(ctx.generated, 'codex-home', 'history.jsonl')).mode & 0o777, 0o600);
});
