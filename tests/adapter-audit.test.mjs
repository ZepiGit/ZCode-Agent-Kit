import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseJsonc, setTopLevelKey } from '../lib/jsonc.mjs';
import goose, { providerDir } from '../cli/adapters/goose.mjs';
import pi from '../cli/adapters/pi.mjs';
import { configPath } from '../cli/adapters/opencode.mjs';

const KIT = path.join(import.meta.dirname, '..');
const { parse: parseYaml } = createRequire(path.join(KIT, 'zcode-proxy-src', 'package.json'))('yaml');
const PORT = 19500; // written into the fixture config only; nothing listens

/**
 * Seam 8: an existing user's temp HOME plus an isolated kit state directory
 * owned by this checkout, driven through the real `zcode-kit` CLI. The state
 * already holds a proxy key and config, the way an earlier setup left them.
 */
function existingInstall(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-adapter-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(state, 'proxy'), { recursive: true });
  fs.mkdirSync(path.join(state, 'generated'));
  let identity = fs.realpathSync(KIT);
  if (process.platform === 'win32') identity = identity.toLowerCase();
  fs.writeFileSync(path.join(state, '.owner.json'), JSON.stringify({ root: identity }) + '\n');
  const key = 'fixture-key-' + 'a'.repeat(32);
  fs.writeFileSync(path.join(state, '.proxykey'), key + '\n');
  fs.writeFileSync(path.join(state, 'proxy', 'config.yaml'), `server:\n  port: ${PORT}\n`);
  const env = {
    ...process.env, HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), ZCODE_KIT_STATE_DIR: state,
    ZCODE_KIT_SKIP_DEPS: '1', ZCODE_KIT_ALLOW_CHECKOUT: '1',
    ZCODE_PROXY_CREDENTIALS_PATH: path.join(home, 'credentials.json'),
    PATH: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin',
  };
  const kit = (...args) => execFileSync(process.execPath, [path.join(KIT, 'cli', 'zcode-kit.mjs'), ...args], { env, encoding: 'utf8', timeout: 60000 });
  return { home, state, key, kit, txOf: (out) => out.match(/transaction (\S+) recorded/)?.[1] };
}

// What the kit wrote into ~/.continue/config.yaml before the HIGH fix: the
// capabilities map Continue's schema rejects. User content around it is kept.
const CONTINUE_USER_MODEL = '  - name: User\n    provider: openai\n    model: user-model\n    roles: [chat]\n    capabilities: { toolUse: true }\n';
function continueBeforeFix(key) {
  const model = (name, model, caps) => `  - name: ${name}\n    provider: openai\n    model: ${model}\n    apiBase: http://127.0.0.1:${PORT}/v1\n    apiKey: ${JSON.stringify(key)}\n    roles: [chat, edit, apply]\n    capabilities: { ${caps} }\n`;
  return 'name: Personal\nschema: v1\nmodels:\n' + CONTINUE_USER_MODEL +
    '# >>> zcode-kit managed models — do not edit inside\n' +
    model('ZCode GLM-5.3', 'glm-5.3', 'toolUse: true') +
    model('ZCode GLM-5.3-Flash', 'glm-5.3-flash', 'toolUse: true, imageInput: true') +
    '# <<< zcode-kit\ncontext: []\n';
}

test('integrate refreshes an existing Continue block to string-array capabilities, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const file = path.join(f.home, '.continue', 'config.yaml');
  fs.mkdirSync(path.dirname(file));
  const before = continueBeforeFix(f.key);
  fs.writeFileSync(file, before);

  const first = f.kit('integrate', 'continue');
  const migrated = fs.readFileSync(file, 'utf8');
  const doc = parseYaml(migrated);
  assert.deepEqual(doc.models.map(m => [m.name, m.capabilities]), [
    ['User', { toolUse: true }],
    ['ZCode GLM-5.3', ['tool_use']],
    ['ZCode GLM-5.3-Flash', ['tool_use', 'image_input']],
  ], 'kit models carry the schema string array; the user model is not the kit\'s to change');
  assert.ok(migrated.startsWith('name: Personal\nschema: v1\nmodels:\n' + CONTINUE_USER_MODEL), 'user model bytes untouched');
  assert.ok(migrated.endsWith('# <<< zcode-kit\ncontext: []\n'));
  assert.doesNotMatch(migrated.slice(migrated.indexOf('# >>> zcode-kit')), /toolUse|imageInput/, 'no map form left in the managed block');
  const txId = f.txOf(first);
  assert.ok(txId, 'the refresh is recorded as a transaction');

  // Replayed: a second integrate is byte-idempotent.
  const second = f.kit('integrate', 'continue');
  assert.match(second, /continue: already up to date/);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated);

  // Rollback restores the pre-fix file byte for byte...
  assert.match(f.kit('rollback', txId), /restored: .*config\.yaml/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // ...and replaying the migration from there yields the same bytes again.
  f.kit('integrate', 'continue');
  assert.equal(fs.readFileSync(file, 'utf8'), migrated);
});

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

// The Kilo values sheet the kit generated before the HIGH fix: an Anthropic
// Messages base URL without /v1, which @ai-sdk/anthropic turns into /messages.
function kiloSheetBeforeFix() {
  return `# Kilo Code × ZCode — prepared values (manual confirmation required)

Kilo Code → Settings ⚙ → Providers → Custom provider:

| Setting        | Value |
|----------------|-------|
| Provider ID    | zcode |
| Display name   | ZCode (local proxy) |
| Provider API   | Anthropic Messages |
| Base URL       | http://127.0.0.1:${PORT} |
| API key        | (local proxy key — run \`node cli/zcode-kit.mjs models --show-key\`) |
| Models         | glm-5.3, glm-5.3-flash |

Notes:
- Anthropic Messages uses the proxy root URL (no /v1 suffix), matching the
  /v1/messages endpoint contract.
- Models can also be auto-fetched from the /v1/models endpoint.
- kilo.jsonc: the upstream docs describe model-level tuning only in the
  "Custom Models" guide; the kit deliberately does not write kilo.jsonc.

Start the proxy first: \`node proxy/zcode-proxy-manager.mjs start\`
`;
}

test('integrate refreshes the Kilo Code values sheet to a /v1 Anthropic base URL, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const sheet = path.join(f.state, 'generated', 'kilo-zcode-values.md');
  const before = kiloSheetBeforeFix();
  fs.writeFileSync(sheet, before);

  const first = f.kit('integrate', 'kilo-code');
  const migrated = fs.readFileSync(sheet, 'utf8');
  const rows = Object.fromEntries([...migrated.matchAll(/^\| ([^|]+?) +\| (.+?) \|$/gm)].map(m => [m[1], m[2]]));
  assert.equal(rows['Provider API'], 'Anthropic Messages');
  assert.equal(rows['Base URL'], `http://127.0.0.1:${PORT}/v1`, 'the SDK appends /messages to this prefix; the proxy serves /v1/messages');
  assert.doesNotMatch(migrated, /no \/v1 suffix/, 'the sheet no longer tells the user to drop /v1');
  assert.ok(!migrated.includes(f.key), 'the sheet never embeds the proxy key');
  const txId = f.txOf(first);
  assert.ok(txId, 'the refresh is recorded as a transaction');

  // Replayed: a second integrate is byte-idempotent.
  f.kit('integrate', 'kilo-code');
  assert.equal(fs.readFileSync(sheet, 'utf8'), migrated);

  // Rollback restores the pre-fix sheet byte for byte, and replaying the
  // migration from there yields the same bytes again.
  assert.match(f.kit('rollback', txId), /restored: .*kilo-zcode-values\.md/);
  assert.equal(fs.readFileSync(sheet, 'utf8'), before);
  f.kit('integrate', 'kilo-code');
  assert.equal(fs.readFileSync(sheet, 'utf8'), migrated);
});

test('the next plain setup refreshes both HIGH fixes for an existing user with stored decisions, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const continueFile = path.join(f.home, '.continue', 'config.yaml');
  const kiloSheet = path.join(f.state, 'generated', 'kilo-zcode-values.md');
  fs.mkdirSync(path.dirname(continueFile));
  fs.mkdirSync(path.join(f.home, '.vscode', 'extensions', 'kilocode.kilo-code-7.8.27'), { recursive: true });
  const continueBefore = continueBeforeFix(f.key);
  const kiloBefore = kiloSheetBeforeFix();
  fs.writeFileSync(continueFile, continueBefore);
  fs.writeFileSync(kiloSheet, kiloBefore);
  // Decisions an earlier setup stored: configured harnesses are refreshed
  // without asking again.
  const choices = path.join(f.state, 'generated', 'harness-choices');
  fs.mkdirSync(choices);
  for (const id of ['continue', 'kilo-code']) {
    fs.writeFileSync(path.join(choices, `${id}.json`), JSON.stringify({ schema: 1, harness: id, decision: 'configured', source: 'prompt', decidedAt: '2026-09-13T00:00:00.000Z' }, null, 2) + '\n');
  }
  const setup = () => f.kit('setup');

  const first = setup();
  const continueAfter = fs.readFileSync(continueFile, 'utf8');
  const kiloAfter = fs.readFileSync(kiloSheet, 'utf8');
  assert.deepEqual(parseYaml(continueAfter).models.slice(1).map(m => m.capabilities), [['tool_use'], ['tool_use', 'image_input']]);
  assert.match(kiloAfter, new RegExp(`^\\| Base URL +\\| http://127\\.0\\.0\\.1:${PORT}/v1 \\|$`, 'm'));
  const txId = f.txOf(first);
  assert.ok(txId, 'the refresh is recorded as one transaction');

  setup();
  assert.equal(fs.readFileSync(continueFile, 'utf8'), continueAfter, 'second setup is byte-idempotent (Continue)');
  assert.equal(fs.readFileSync(kiloSheet, 'utf8'), kiloAfter, 'second setup is byte-idempotent (Kilo Code)');

  f.kit('rollback', txId);
  assert.equal(fs.readFileSync(continueFile, 'utf8'), continueBefore, 'rollback restores the pre-fix Continue config');
  assert.equal(fs.readFileSync(kiloSheet, 'utf8'), kiloBefore, 'rollback restores the pre-fix Kilo sheet');
  assert.equal(fs.existsSync(path.join(f.home, '.vscode', 'extensions', 'kilocode.kilo-code-7.8.27')), true);
  assert.deepEqual(fs.readdirSync(path.join(f.home, '.vscode', 'extensions')), ['kilocode.kilo-code-7.8.27'], 'VS Code state is only read');
});
