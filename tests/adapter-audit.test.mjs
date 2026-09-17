import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonc, setTopLevelKey } from '../lib/jsonc.mjs';
import goose, { providerDir } from '../cli/adapters/goose.mjs';
import pi from '../cli/adapters/pi.mjs';
import { configPath } from '../cli/adapters/opencode.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-adapter-audit-'));
  const saved = { ...process.env };
  process.env.APPDATA = path.join(home, 'AppData');
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  delete process.env.OPENCODE_CONFIG;
  delete process.env.OPENCODE_CONFIG_DIR;
  t.after(() => { process.env = saved; fs.rmSync(home, { recursive: true, force: true }); });
  const ctx = { home, root: path.join(home, 'kit'), port: () => 18701 };
  return { home, ctx, tx: { touch() {} } };
}

test('JSONC preserves strings, BOM, braces in comments and string-valued edits', () => {
  const input = '\ufeff{\n  "literal": ",}", // keep me\n  "text": "a,b}c",\n}\n// trailing } comment\n';
  assert.equal(parseJsonc(input).literal, ',}');
  const out = setTopLevelKey(input, 'text', 'changed');
  assert.equal(parseJsonc(out).text, 'changed');
  assert.equal(parseJsonc(out).literal, ',}');
  assert.ok(out.startsWith('\ufeff'));
  assert.ok(out.endsWith('// trailing } comment\n'));
  const inserted = setTopLevelKey(out, 'other', { x: 1 });
  assert.deepEqual(parseJsonc(inserted).other, { x: 1 });
  assert.match(inserted, /keep me/);
  assert.throws(() => parseJsonc('{"x":1,"x":2}'), /duplicate/);
  assert.throws(() => parseJsonc('{"x":1} /* unfinished'), /JSONC/);
});

test('JSONC insertion puts commas before trailing inline comments', () => {
  const out = setTopLevelKey('{"x":1 // comment\n}', 'next', true);
  assert.deepEqual(parseJsonc(out), { x: 1, next: true });
  assert.match(out, /1, \/\/ comment/);
});

test('Goose refuses a foreign or malformed existing provider without changing bytes', t => {
  const { ctx, tx } = fixture(t);
  const file = path.join(providerDir(ctx.home), 'zcode.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const text of ['{"name":"zcode","engine":"openai","base_url":"https://foreign.invalid"}', '{broken']) {
    fs.writeFileSync(file, text);
    assert.throws(() => goose.apply(ctx, tx, () => {}), /not owned/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('pi refreshes a managed stale key resolver even with unchanged models and port', t => {
  const { ctx, tx } = fixture(t);
  const dir = path.join(ctx.home, '.pi', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  pi.apply(ctx, tx, () => {});
  const file = path.join(dir, 'models.json');
  const current = parseJsonc(fs.readFileSync(file, 'utf8'));
  current.providers.zcode.apiKey = '!node "C:/old-kit/proxy/resolve-zcode-proxy-key.mjs"';
  fs.writeFileSync(file, JSON.stringify(current));
  assert.equal(pi.apply(ctx, tx, () => {}).changed, true);
  assert.ok(parseJsonc(fs.readFileSync(file, 'utf8')).providers.zcode.apiKey.includes(ctx.root.replaceAll('\\', '/')));
  assert.equal(pi.apply(ctx, tx, () => {}).changed, false);
});

test('OpenCode paths honor XDG and explicit file/directory overrides on Windows too', t => {
  const { home } = fixture(t);
  assert.equal(configPath(home), path.join(home, '.config', 'opencode', 'opencode.json'));
  process.env.OPENCODE_CONFIG_DIR = path.join(home, 'custom');
  assert.equal(configPath(home), path.join(home, 'custom', 'opencode.json'));
  process.env.OPENCODE_CONFIG = path.join(home, 'exact.jsonc');
  assert.equal(configPath(home), path.join(home, 'exact.jsonc'));
});
