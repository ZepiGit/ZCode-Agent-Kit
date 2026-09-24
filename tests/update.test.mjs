import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  detectInstallType,
  downloadRelease,
  extractTarball,
  installedVersion,
  isNpmInstallRoot,
  mirrorTree,
  parseChecksums,
  repoFromPackage,
  resolveLatestTag,
  stripV,
} from '../lib/self-update.mjs';

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFileTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const file = join(root, ...rel.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
}

function stubFetch(responses) {
  return async (url) => {
    const hit = responses[url];
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    if (hit.error) throw hit.error;
    return hit;
  };
}

// Array buffers from pooled Buffers must be sliced: .buffer alone can be
// larger than the content and would corrupt the download.
function body(b) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

test('parseChecksums keeps only well-formed entries', (t) => {
  const text = [
    'abc123  v1.0.0.tar.gz',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA *v1.0.0.tar.gz',
    'not-a-hash v1.0.0.tar.gz',
    '',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  other.txt',
  ].join('\n');
  const map = parseChecksums(text);
  assert.equal(map.get('v1.0.0.tar.gz'), 'a'.repeat(64));
  assert.equal(map.get('other.txt'), '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  assert.equal(map.size, 2);
});

test('detectInstallType separates checkout, npm and release layouts', (t) => {
  const root = tempDir(t, 'kit-detect-');
  assert.equal(detectInstallType(root), 'release');
  mkdirSync(join(root, '.git'));
  assert.equal(detectInstallType(root), 'checkout');
  rmSync(join(root, '.git'), { recursive: true });

  const npmRoot = join(tempDir(t, 'kit-detect-npm-'), 'node_modules', 'zcode-agent-kit');
  mkdirSync(npmRoot, { recursive: true });
  writeFileSync(join(npmRoot, 'package.json'), JSON.stringify({ name: 'zcode-agent-kit', version: '1.0.0' }));
  assert.equal(isNpmInstallRoot(npmRoot), true);
  assert.equal(detectInstallType(npmRoot), 'npm');

  const foreign = join(tempDir(t, 'kit-detect-foreign-'), 'node_modules', 'other-pkg');
  mkdirSync(foreign, { recursive: true });
  assert.equal(isNpmInstallRoot(foreign), false);
  assert.equal(detectInstallType(foreign), 'release');
});

test('installedVersion and repoFromPackage read package.json defensively', (t) => {
  const root = tempDir(t, 'kit-meta-');
  assert.equal(installedVersion(root), null);
  assert.equal(repoFromPackage(root), 'ZepiGit/ZCode-Agent-Kit');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    version: '9.9.9',
    repository: { type: 'git', url: 'git+https://github.com/Example/Kit.git' },
  }));
  assert.equal(installedVersion(root), '9.9.9');
  assert.equal(repoFromPackage(root), 'Example/Kit');
  assert.equal(stripV('v0.2.33'), '0.2.33');
});

test('resolveLatestTag validates the tag and reports HTTP failures', async () => {
  const ok = await resolveLatestTag('Example/Kit', {
    fetchImpl: stubFetch({
      'https://api.github.com/repos/Example/Kit/releases/latest': {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: 'v1.2.3' }),
      },
    }),
  });
  assert.equal(ok, 'v1.2.3');
  await assert.rejects(
    resolveLatestTag('Example/Kit', {
      fetchImpl: stubFetch({
        'https://api.github.com/repos/Example/Kit/releases/latest': {
          ok: false,
          status: 403,
          json: async () => ({}),
        },
      }),
    }),
    /HTTP 403/,
  );
  await assert.rejects(
    resolveLatestTag('Example/Kit', {
      fetchImpl: stubFetch({
        'https://api.github.com/repos/Example/Kit/releases/latest': {
          ok: true,
          status: 200,
          json: async () => ({ tag_name: 'refs/thing' }),
        },
      }),
    }),
    /unexpected tag/,
  );
});

test('downloadRelease verifies the archive hash against checksums.txt', async (t) => {
  const dir = tempDir(t, 'kit-dl-');
  const archive = Buffer.from('archive-bytes');
  const good = createHash('sha256').update(archive).digest('hex');
  const base = 'https://github.com/Example/Kit/releases/download/v1.0.0';
  const fetchImpl = stubFetch({
    [`${base}/v1.0.0.tar.gz`]: { ok: true, status: 200, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) },
    [`${base}/checksums.txt`]: { ok: true, status: 200, arrayBuffer: async () => body(Buffer.from(`${good}  v1.0.0.tar.gz\n`)) },
  });
  const file = await downloadRelease('Example/Kit', 'v1.0.0', dir, { fetchImpl });
  assert.equal(readFileSync(file).toString(), 'archive-bytes');

  const bad = stubFetch({
    [`${base}/v1.0.0.tar.gz`]: { ok: true, status: 200, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) },
    [`${base}/checksums.txt`]: { ok: true, status: 200, arrayBuffer: async () => body(Buffer.from(`${'c'.repeat(64)}  v1.0.0.tar.gz\n`)) },
  });
  await assert.rejects(downloadRelease('Example/Kit', 'v1.0.0', dir, { fetchImpl: bad }), /hash mismatch/);

  const missing = stubFetch({
    [`${base}/v1.0.0.tar.gz`]: { ok: true, status: 200, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) },
    [`${base}/checksums.txt`]: { ok: true, status: 200, arrayBuffer: async () => body(Buffer.from('garbage\n')) },
  });
  await assert.rejects(downloadRelease('Example/Kit', 'v1.0.0', dir, { fetchImpl: missing }), /exactly one valid entry/);

  const httpFail = stubFetch({ [`${base}/v1.0.0.tar.gz`]: { ok: false, status: 404 } });
  await assert.rejects(downloadRelease('Example/Kit', 'v1.0.0', dir, { fetchImpl: httpFail }), /HTTP 404/);
});

test('extractTarball requires exactly one top-level directory', (t) => {
  const dir = tempDir(t, 'kit-extract-');
  const src = tempDir(t, 'kit-extract-src-');
  writeFileTree(src, { 'kit-1.0.0/package.json': '{"name":"zcode-agent-kit"}', 'kit-1.0.0/cli/x.js': 'ok' });
  const archive = join(dir, 'kit.tar.gz');
  const tar = spawnSync(tarExe(), ['-czf', archive, '-C', src, '.']);
  assert.equal(tar.status, 0, tar.stderr?.toString());

  const out = join(dir, 'out');
  const extracted = extractTarball(archive, out);
  assert.equal(readdirSync(extracted).includes('package.json'), true);

  const garbage = join(dir, 'garbage.tar.gz');
  writeFileSync(garbage, Buffer.from('definitely not a tar archive'));
  assert.throws(() => extractTarball(garbage, join(dir, 'out2')), /extraction failed|archive layout/);
});

function tarExe() {
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return process.platform === 'win32' && existsSync(systemTar) ? systemTar : 'tar';
}

test('mirrorTree copies, overwrites, deletes and preserves state', (t) => {
  const src = tempDir(t, 'kit-mirror-src-');
  const dest = tempDir(t, 'kit-mirror-dest-');

  writeFileTree(src, {
    'cli/new.mjs': 'new',
    'cli/same.mjs': 'same',
    'cli/changed.mjs': 'release version',
    'lib/deep/nested/file.mjs': 'deep',
    'docs/gone-later.md': 'x',
  });
  writeFileTree(dest, {
    '.proxykey': 'user-key\n',
    'proxy/config.yaml': 'user-config\n',
    '.bun-path': 'C:/bun.exe\n',
    'cli/same.mjs': 'same',
    'cli/changed.mjs': 'old version',
    'cli/stale-only.mjs': 'remove me',
    'lib/deep/nested/old.mjs': 'remove me',
    'lib/deep/stale-dir/inner.mjs': 'remove me',
    'node_modules/pkg/index.js': 'dependency\n',
    'logs/proxy.log': 'log line\n',
    'backups/tx-1/file': 'backup\n',
    'generated/claude-zcode-settings.json': '{}\n',
  });

  const { copied, deleted } = mirrorTree(src, dest);

  // Copies and overwrites landed.
  assert.equal(readFileSync(join(dest, 'cli', 'new.mjs'), 'utf8'), 'new');
  assert.equal(readFileSync(join(dest, 'cli', 'changed.mjs'), 'utf8'), 'release version');
  assert.equal(readFileSync(join(dest, 'lib', 'deep', 'nested', 'file.mjs'), 'utf8'), 'deep');
  assert.ok(copied >= 4);

  // Stale files and emptied directories are gone.
  assert.equal(existsSync(join(dest, 'cli', 'stale-only.mjs')), false);
  assert.equal(existsSync(join(dest, 'lib', 'deep', 'nested', 'old.mjs')), false);
  assert.equal(existsSync(join(dest, 'lib', 'deep', 'stale-dir')), false);
  assert.ok(deleted >= 4);

  // Machine-local state is untouched, even where the release has the same name.
  writeFileTree(src, { 'proxy/config.yaml': 'release default config' });
  mirrorTree(src, dest);
  assert.equal(readFileSync(join(dest, 'proxy', 'config.yaml'), 'utf8'), 'user-config\n');
  assert.equal(readFileSync(join(dest, '.proxykey'), 'utf8'), 'user-key\n');
  assert.equal(readFileSync(join(dest, '.bun-path'), 'utf8'), 'C:/bun.exe\n');
  assert.equal(readFileSync(join(dest, 'node_modules', 'pkg', 'index.js'), 'utf8'), 'dependency\n');
  assert.equal(readFileSync(join(dest, 'logs', 'proxy.log'), 'utf8'), 'log line\n');
  assert.equal(readFileSync(join(dest, 'backups', 'tx-1', 'file'), 'utf8'), 'backup\n');
  assert.equal(readFileSync(join(dest, 'generated', 'claude-zcode-settings.json'), 'utf8'), '{}\n');
});

test('mirrorTree never deletes content under a preserved directory', (t) => {
  const src = tempDir(t, 'kit-preserve-src-');
  const dest = tempDir(t, 'kit-preserve-dest-');
  writeFileTree(src, { 'README.md': 'release readme' });
  writeFileTree(dest, {
    'logs/nested/keep.log': 'precious\n',
    'node_modules/.bin/tool': 'tool\n',
    'backups/tx-9/deep/file': 'backup\n',
  });
  mirrorTree(src, dest);
  assert.equal(readFileSync(join(dest, 'logs', 'nested', 'keep.log'), 'utf8'), 'precious\n');
  assert.equal(readFileSync(join(dest, 'node_modules', '.bin', 'tool'), 'utf8'), 'tool\n');
  assert.equal(readFileSync(join(dest, 'backups', 'tx-9', 'deep', 'file'), 'utf8'), 'backup\n');
  assert.equal(readFileSync(join(dest, 'README.md'), 'utf8'), 'release readme');
});

test('mirrorTree is repairable: rerunning converges on the release', (t) => {
  const src = tempDir(t, 'kit-repair-src-');
  const dest = tempDir(t, 'kit-repair-dest-');
  writeFileTree(src, { 'a.mjs': 'one' });
  writeFileTree(dest, { 'stale/x.mjs': 'old' });
  mirrorTree(src, dest);
  assert.equal(existsSync(join(dest, 'a.mjs')), true);
  // Simulate a crash after the copy phase: stale files linger and rerun.
  writeFileTree(dest, { 'stale/y.mjs': 'old' });
  mirrorTree(src, dest);
  assert.equal(existsSync(join(dest, 'stale', 'y.mjs')), false);
  assert.equal(existsSync(join(dest, 'stale')), false);
  // cpSync on a directory would fail the second walk; ensure dir removal worked.
  assert.equal(existsSync(join(dest, 'stale')), false);
});

test('mirrorTree leaves no .git behind on a release mirror', (t) => {
  const src = tempDir(t, 'kit-git-src-');
  const dest = tempDir(t, 'kit-git-dest-');
  writeFileTree(src, { 'README.md': 'release' });
  writeFileTree(dest, { '.git/HEAD': 'ref: refs/heads/main' });
  mirrorTree(src, dest);
  assert.equal(existsSync(join(dest, '.git', 'HEAD')), true);
});
