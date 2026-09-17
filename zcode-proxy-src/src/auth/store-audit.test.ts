import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(join(import.meta.dirname, 'store.ts')).href;
test('Windows credential seed survives slash and case variants without a secret override', () => {
  if (process.platform !== 'win32') return;
  const base = mkdtempSync(join(tmpdir(), 'credential-audit-'));
  const home = join(base, 'Home'); mkdirSync(home);
  const store = join(base, 'credential.json');
  function run(homePath: string, code: string) {
    const env = { ...process.env, HOME: homePath, USERPROFILE: homePath, ZCODE_PROXY_CREDENTIALS_PATH: store };
    delete env.ZCODE_PROXY_CREDENTIAL_SECRET;
    return spawnSync(process.execPath, ['-e', `const s = await import(${JSON.stringify(moduleUrl)}); ${code}`], { env, encoding: 'utf8' });
  }
  try {
    const saved = run(home.replaceAll('\\', '/'), 'await s.saveCredential({apiKey:"synthetic-only",provider:"zai"})');
    expect(saved.status).toBe(0);
    const loaded = run(home.toLowerCase(), 'console.log((await s.loadCredential())?.apiKey)');
    expect(loaded.status).toBe(0);
    expect(loaded.stdout.trim()).toBe('synthetic-only');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('malformed credential JSON is diagnosed without throwing or overwriting it', async () => {
  const base = mkdtempSync(join(tmpdir(), 'credential-corrupt-'));
  const file = join(base, 'credential.json');
  const old = process.env.ZCODE_PROXY_CREDENTIALS_PATH;
  process.env.ZCODE_PROXY_CREDENTIALS_PATH = file;
  try {
    writeFileSync(file, '{incomplete');
    const { loadCredential } = await import('./store');
    expect(await loadCredential()).toBeNull();
    expect(readFileSync(file, 'utf8')).toBe('{incomplete');
  } finally {
    if (old === undefined) delete process.env.ZCODE_PROXY_CREDENTIALS_PATH; else process.env.ZCODE_PROXY_CREDENTIALS_PATH = old;
    rmSync(base, { recursive: true, force: true });
  }
});
