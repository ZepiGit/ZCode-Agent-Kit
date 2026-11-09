import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseJsonc, setTopLevelKey } from '../lib/jsonc.mjs';
import goose, { providerDir } from '../cli/adapters/goose.mjs';
import pi from '../cli/adapters/pi.mjs';
import { configPath } from '../cli/adapters/opencode.mjs';
import { freePort } from './free-port.mjs';

const KIT = path.join(import.meta.dirname, '..');
const { parse: parseYaml } = createRequire(path.join(KIT, 'zcode-proxy-src', 'package.json'))('yaml');
// Written into the fixture config only; nothing listens. Setup probes it, so it
// is a free port of this run (ticket 75), never one a parallel run may hold.
const PORT = await freePort();

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
  return { home, state, key, kit, env, txOf: (out) => out.match(/transaction (\S+) recorded/)?.[1] };
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

// --- Ticket 51: confirmed MEDIUM fixes (seam 8) ------------------------------
// Each "before" fixture is the byte-exact file the integration tip wrote before
// the fix (captured from `zcode-kit integrate <id>` on 3773b47), so the refresh
// is proven on the file an existing user actually has.

/** Drive one integrate run, its replay, a rollback and a replay after rollback. */
function refreshCycle(f, id, file, before) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, before);
  const first = f.kit('integrate', id);
  const migrated = fs.readFileSync(file, 'utf8');
  const txId = f.txOf(first);
  assert.ok(txId, `the ${id} refresh is recorded as a transaction`);
  f.kit('integrate', id);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated, `a second integrate ${id} is byte-idempotent`);
  f.kit('rollback', txId);
  assert.equal(fs.readFileSync(file, 'utf8'), before, `rollback restores the pre-fix ${id} file byte for byte`);
  f.kit('integrate', id);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated, `replaying the ${id} migration after rollback gives the same bytes`);
  return migrated;
}

function openCodeBeforeFix() {
  return `{

  "provider": {
  "zcode": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "ZCode (local proxy)",
    "options": {
      "baseURL": "http://127.0.0.1:${PORT}/v1",
      "apiKey": "{env:ZCODE_PROXY_KEY}"
    },
    "models": {
      "glm-5.3": {
        "name": "GLM-5.3",
        "limit": {
          "context": 1000000,
          "output": 128000
        }
      },
      "glm-5.3-flash": {
        "name": "GLM-5.3-Flash",
        "limit": {
          "context": 1000000,
          "output": 128000
        },
        "options": {
          "reasoningEffort": "low"
        },
        "variants": {
          "low": {
            "reasoningEffort": "low"
          },
          "high": {
            "reasoningEffort": "high"
          },
          "max": {
            "reasoningEffort": "max"
          }
        }
      }
    }
  }
}
}
`;
}

test('integrate declares image input for OpenCode Flash (V1 modalities), idempotently and reversibly', t => {
  const f = existingInstall(t);
  const file = path.join(f.home, '.config', 'opencode', 'opencode.json');
  const migrated = refreshCycle(f, 'opencode', file, openCodeBeforeFix());
  const doc = parseJsonc(migrated);
  const models = doc.provider.zcode.models;
  assert.deepEqual(models['glm-5.3-flash'].modalities, { input: ['text', 'image'], output: ['text'] });
  assert.equal(models['glm-5.3'].modalities, undefined, 'GLM-5.3 stays text-only (no verified image input)');
  assert.deepEqual(models['glm-5.3-flash'].variants, { low: { reasoningEffort: 'low' }, high: { reasoningEffort: 'high' }, max: { reasoningEffort: 'max' } });
  assert.equal(doc.providers, undefined, 'the V1 provider shape stays; no V2 providers block is written');
});

function gooseBeforeFix() {
  const resolver = path.join(KIT, 'proxy', 'resolve-zcode-proxy-key.mjs').replace(/\\/g, '/');
  return `{
  "name": "zcode",
  "engine": "openai",
  "display_name": "ZCode (local proxy)",
  "description": "GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy (own ZCode Desktop account)",
  "base_url": "http://127.0.0.1:${PORT}/v1/chat/completions",
  "models": [
    {
      "name": "glm-5.3",
      "context_limit": 1000000
    },
    {
      "name": "glm-5.3-flash",
      "context_limit": 1000000
    }
  ],
  "supports_streaming": true,
  "requires_auth": true,
  "auth": {
    "command": "node",
    "args": [
      ${JSON.stringify(resolver)}
    ],
    "refresh_interval": 0,
    "timeout_seconds": 10
  }
}
`;
}

test('integrate declares supports_vision for Goose Flash, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const dir = process.platform === 'win32'
    ? path.join(f.home, 'AppData', 'Roaming', 'Block', 'goose', 'config', 'custom_providers')
    : path.join(f.home, '.config', 'goose', 'custom_providers');
  const migrated = refreshCycle(f, 'goose', path.join(dir, 'zcode.json'), gooseBeforeFix());
  assert.deepEqual(JSON.parse(migrated).models, [
    { name: 'glm-5.3', context_limit: 1000000 },
    { name: 'glm-5.3-flash', context_limit: 1000000, supports_vision: true },
  ], 'only Flash claims image input; GLM-5.3 keeps catalog detection');
});

// The Kilo sheet the tip wrote after the HIGH fix (ticket 50), before ticket 51.
function kiloSheetAfterHighFix() {
  return kiloSheetBeforeFix()
    .replace(`| Base URL       | http://127.0.0.1:${PORT} |`, `| Base URL       | http://127.0.0.1:${PORT}/v1 |`)
    .replace('- Anthropic Messages uses the proxy root URL (no /v1 suffix), matching the\n  /v1/messages endpoint contract.',
      '- Anthropic Messages takes the base URL including /v1: Kilo appends\n  /messages to it, matching the proxy\'s /v1/messages endpoint.');
}

test('integrate adds Kilo Code per-model Reasoning and Image toggles to the values sheet, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const sheet = path.join(f.state, 'generated', 'kilo-zcode-values.md');
  const before = kiloSheetAfterHighFix();
  assert.match(before, new RegExp(`Base URL +\\| http://127\\.0\\.0\\.1:${PORT}/v1 \\|`), 'fixture is the post-HIGH-fix sheet');
  const migrated = refreshCycle(f, 'kilo-code', sheet, before);
  const rows = [...migrated.matchAll(/^\| (glm-[^ |]+) +\| ([^|]+?) +\| (on|off) +\| (on|off) +\|$/gm)]
    .map(m => [m[1], m[2], m[3], m[4]]);
  assert.deepEqual(rows, [
    ['glm-5.3', 'GLM-5.3', 'on', 'off'],
    ['glm-5.3-flash', 'GLM-5.3-Flash', 'on', 'on'],
  ], 'one row per model with Kilo\'s Reasoning and Image toggles');
  assert.match(migrated, /^\| Model ID +\| Name +\| Reasoning +\| Image +\|$/m);
  assert.ok(!migrated.includes(f.key), 'the sheet never embeds the proxy key');
});

// --- Ticket 59: the false Kilo `/v1/models` auto-fetch note (seam 8) ---------
// Kilo's Custom provider dialog gates both its debounced model fetch and the
// "Fetch models" button on `canFetch`, which is false for `@ai-sdk/anthropic`
// (Kilo-Org/kilocode@v7.8.27 CustomProviderDialog.tsx:232-233, 253, 708).
const KILO_FALSE_NOTE = '- Models can also be auto-fetched from the /v1/models endpoint.\n';
const KILO_TRUE_NOTE = '- Kilo does not fetch the model list for Anthropic Messages ("Fetch\n  models" stays disabled): enter both models above by hand.\n';

// The Kilo sheet the tip wrote after ticket 51 (byte-exact with
// `zcode-kit integrate kilo-code` on 74899d2), before ticket 59.
function kiloSheetAfterMediumFix() {
  return kiloSheetAfterHighFix().replace('\nNotes:\n', `
Models — one row each, with the per-model toggles:

| Model ID       | Name           | Reasoning | Image |
|----------------|----------------|-----------|-------|
| glm-5.3        | GLM-5.3        | on        | off   |
| glm-5.3-flash  | GLM-5.3-Flash  | on        | on    |

Notes:
`);
}

test('integrate replaces the false Kilo /v1/models auto-fetch note in every earlier sheet, idempotently and reversibly', t => {
  for (const [generation, before] of [['before ticket 50', kiloSheetBeforeFix()], ['after ticket 50', kiloSheetAfterHighFix()], ['after ticket 51', kiloSheetAfterMediumFix()]]) {
    const f = existingInstall(t);
    const sheet = path.join(f.state, 'generated', 'kilo-zcode-values.md');
    assert.ok(before.includes(KILO_FALSE_NOTE), `fixture ${generation} carries the false note`);
    const migrated = refreshCycle(f, 'kilo-code', sheet, before);
    assert.doesNotMatch(migrated, /auto-fetch|\/v1\/models/, `no auto-fetch claim left (${generation})`);
    assert.equal(migrated, kiloSheetAfterMediumFix().replace(KILO_FALSE_NOTE, KILO_TRUE_NOTE),
      `the sheet is the current one with only the note replaced (${generation})`);
  }
});

test('the next plain setup replaces the false Kilo auto-fetch note for a user with a stored decision, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const sheet = path.join(f.state, 'generated', 'kilo-zcode-values.md');
  const before = kiloSheetAfterMediumFix();
  fs.writeFileSync(sheet, before);
  // Plain setup refreshes detected harnesses only; the decision skips the prompt.
  fs.mkdirSync(path.join(f.home, '.vscode', 'extensions', 'kilocode.kilo-code-7.8.27'), { recursive: true });
  const choices = path.join(f.state, 'generated', 'harness-choices');
  fs.mkdirSync(choices);
  fs.writeFileSync(path.join(choices, 'kilo-code.json'), JSON.stringify({ schema: 1, harness: 'kilo-code', decision: 'configured', source: 'prompt', decidedAt: '2026-11-06T00:00:00.000Z' }, null, 2) + '\n');

  const txId = f.txOf(f.kit('setup'));
  assert.ok(txId, 'the refresh is recorded as a transaction');
  const after = fs.readFileSync(sheet, 'utf8');
  assert.ok(after.includes(KILO_TRUE_NOTE), 'the sheet says the models are entered by hand');
  assert.doesNotMatch(after, /auto-fetch|\/v1\/models/);
  f.kit('setup');
  assert.equal(fs.readFileSync(sheet, 'utf8'), after, 'second setup is byte-idempotent');
  f.kit('rollback', txId);
  assert.equal(fs.readFileSync(sheet, 'utf8'), before, 'rollback restores the earlier sheet byte for byte');
});

function clineSheetBeforeFix() {
  return `# Cline × ZCode — prepared values (manual confirmation required)

Cline stores provider settings inside VS Code's internal state. The kit does
not touch that database. Enter these values once in Cline → Settings ⚙ →
API Provider:

| Setting            | Value |
|--------------------|-------|
| API Provider       | OpenAI Compatible |
| Base URL           | http://127.0.0.1:${PORT}/v1 |
| API Key            | (local proxy key — run \`node cli/zcode-kit.mjs models --show-key\`) |
| Model ID           | glm-5.3  (or glm-5.3-flash) |
| Image Support      | on for glm-5.3-flash |

Start the proxy first: \`node proxy/zcode-proxy-manager.mjs start\`
`;
}

test('integrate adds the documented Cline CLI setup command to the values sheet, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const sheet = path.join(f.state, 'generated', 'cline-zcode-values.md');
  const before = clineSheetBeforeFix();
  const migrated = refreshCycle(f, 'cline', sheet, before);
  assert.match(migrated, new RegExp(`^ {4}cline auth -p openai -k <local proxy key> -b http://127\\.0\\.0\\.1:${PORT}/v1 -m glm-5\\.3$`, 'm'),
    'the CLI path uses the OpenAI Compatible provider id with the proxy /v1 base URL');
  assert.match(migrated, /~\/\.cline\/data\/settings\/providers\.json/);
  assert.ok(migrated.includes(before.slice(0, before.indexOf('Start the proxy first'))), 'the extension values are kept unchanged');
  assert.ok(!migrated.includes(f.key), 'the sheet never embeds the proxy key');
});

function ompModelsBeforeFix(key) {
  const override = (id) => `      ${id}:
        thinking:
          mode: anthropic-budget-effort
          efforts:
            - low
            - high
            - max
          defaultLevel: max
          requiresEffort: true
        compat:
          supportsOutputEffort: true
          supportsContextManagement: false
          replayUnsignedThinking: true
          injectClaudeCodeInstruction: false
`;
  const model = (id, name, input) => `      - id: ${id}
        name: ${name}
        reasoning: true
        input:
${input.map(i => `          - ${i}\n`).join('')}        contextWindow: 1000000
        maxTokens: 128000
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
`;
  return `providers:
# >>> zcode-kit (managed block) — do not edit inside
# Provider ZCode — GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy
# (start-plan access). Efforts low/high/max; default max. See EFFORT_MAPPING.md.
  zcode:
    name: ZCode
    baseUrl: http://127.0.0.1:${PORT}
    api: anthropic-messages
    apiKey: ${JSON.stringify(key)}
    modelOverrides:
${override('glm-5.3')}${override('glm-5.3-flash')}    models:
${model('glm-5.3', 'GLM-5.3', ['text'])}${model('glm-5.3-flash', 'GLM-5.3-Flash', ['text', 'image'])}# <<< zcode-kit
`;
}

test('integrate gives the OMP provider plain API-key shaping and drops compat keys models.yml ignores, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const file = path.join(f.home, '.omp', 'agent', 'models.yml');
  const before = ompModelsBeforeFix(f.key);
  assert.deepEqual(Object.keys(parseYaml(before).providers.zcode.modelOverrides), ['glm-5.3', 'glm-5.3-flash'], 'fixture parses');
  const migrated = refreshCycle(f, 'omp', file, before);
  const zcode = parseYaml(migrated).providers.zcode;
  assert.equal(zcode.auth, 'apiKey', 'custom anthropic-messages providers get OAuth-style shaping unless auth: apiKey');
  assert.equal(zcode.apiKey, f.key, 'the literal key stays');
  for (const id of ['glm-5.3', 'glm-5.3-flash']) {
    assert.deepEqual(zcode.modelOverrides[id].compat, { supportsContextManagement: false, replayUnsignedThinking: true },
      `${id}: only AnthropicCompat keys the models.yml schema honors`);
    assert.deepEqual(zcode.modelOverrides[id].thinking, { mode: 'anthropic-budget-effort', efforts: ['low', 'high', 'max'], defaultLevel: 'max', requiresEffort: true });
  }
  assert.deepEqual(zcode.models.map(m => [m.id, m.input]), [['glm-5.3', ['text']], ['glm-5.3-flash', ['text', 'image']]]);
});

// Items the research marked UNVERIFIED, plus the MEDIUM candidates ticket 51
// left (Claude Code effort capabilities, pi thinkingLevelMap): their output
// must stay exactly what the integration tip wrote (3773b47).
test('integrate leaves UNVERIFIED and not-applied adapter output byte-identical to the tip', t => {
  const f = existingInstall(t);
  fs.mkdirSync(path.join(f.home, '.pi', 'agent'), { recursive: true });
  const kitPath = KIT.replace(/\\/g, '/');

  // Claude Code: no CLAUDE_CODE_ALWAYS_ENABLE_EFFORT / _SUPPORTED_CAPABILITIES.
  f.kit('integrate', 'claude-code');
  assert.equal(fs.readFileSync(path.join(f.state, 'generated', 'claude-zcode-settings.json'), 'utf8'), `{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:${PORT}",
    "ANTHROPIC_AUTH_TOKEN": "${f.key}",
    "ANTHROPIC_MODEL": "glm-5.3",
    "ANTHROPIC_SMALL_FAST_MODEL": "glm-5.3-flash",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.3-flash",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.3",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.3",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000"
  }
}
`);

  // pi: no thinkingLevelMap.
  f.kit('integrate', 'pi');
  const piModel = (id, name, input) => `        {
          "id": "${id}",
          "name": "${name}",
          "reasoning": true,
          "input": [
${input.map(i => `            "${i}"`).join(',\n')}
          ],
          "contextWindow": 1000000,
          "maxTokens": 128000,
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }`;
  assert.equal(fs.readFileSync(path.join(f.home, '.pi', 'agent', 'models.json'), 'utf8'), `// zcode provider block managed by zcode-kit — GLM via local proxy
{
  "providers": {
    "zcode": {
      "x-zcode-agent-kit": {
        "managed": true,
        "schema": 1
      },
      "baseUrl": "http://127.0.0.1:${PORT}",
      "api": "anthropic-messages",
      "apiKey": ${JSON.stringify(`!node "${kitPath}/proxy/resolve-zcode-proxy-key.mjs"`)},
      "models": [
${piModel('glm-5.3', 'GLM-5.3', ['text'])},
${piModel('glm-5.3-flash', 'GLM-5.3-Flash', ['text', 'image'])}
      ]
    }
  }
}
`);

  // Codex: no model_context_window / model_reasoning_effort fallback metadata.
  // The MCP args line carries the bridge flag since ticket 36 (seam 8).
  // Ticket 43 (A-07): the comment names the launcher of the user's OS —
  // the old pin asserted the Windows path on POSIX, the defect itself.
  f.kit('integrate', 'codex');
  const windows = process.platform === 'win32' ? '\n# Native restricted-token sandbox; no admin setup or full-access bypass.\n[windows]\nsandbox = "unelevated"\n' : '';
  const launcher = process.platform === 'win32' ? 'bin\\\\zcode-codex.cmd' : 'bin/zcode-codex.sh';
  assert.equal(fs.readFileSync(path.join(f.state, 'generated', 'codex-home', 'config.toml'), 'utf8'), `# Generated by zcode-kit — isolated CODEX_HOME for the ZCode kit.
# Your normal ~/.codex is untouched; use ${launcher} to enter this setup.
model = "glm-5.3"
model_provider = "zcode"
${windows}
[model_providers.zcode]
name = "ZCode (local proxy)"
base_url = "http://127.0.0.1:${PORT}/v1"
env_key = "ZCODE_PROXY_KEY"
wire_api = "responses"

[mcp_servers.zcode-harness]
command = "node"
args = ["--max-semi-space-size=1", "${kitPath}/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
`);

  // OpenCode mixed V1/V2: a user's V2 `providers` block is left as is and the
  // kit still writes only its V1 `provider` entry next to it.
  const ocFile = path.join(f.home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(ocFile), { recursive: true });
  const userV2 = '{\n  "providers": {\n    "mine": { "package": "aisdk:@ai-sdk/openai", "settings": { "baseURL": "https://example.invalid/v1" } }\n  }\n}\n';
  fs.writeFileSync(ocFile, userV2);
  f.kit('integrate', 'opencode');
  const oc = fs.readFileSync(ocFile, 'utf8');
  assert.ok(oc.startsWith('{\n  "providers": {\n    "mine": { "package": "aisdk:@ai-sdk/openai", "settings": { "baseURL": "https://example.invalid/v1" } }\n  }'), 'the V2 block keeps its bytes');
  assert.deepEqual(Object.keys(parseJsonc(oc)), ['providers', 'provider']);
  assert.deepEqual(Object.keys(parseJsonc(oc).providers), ['mine'], 'nothing is merged into the V2 block');

  // Continue: no defaultCompletionOptions on the kit models.
  const contFile = path.join(f.home, '.continue', 'config.yaml');
  fs.mkdirSync(path.dirname(contFile), { recursive: true });
  fs.writeFileSync(contFile, 'name: Personal\nschema: v1\nmodels: []\n');
  f.kit('integrate', 'continue');
  for (const m of parseYaml(fs.readFileSync(contFile, 'utf8')).models) {
    assert.deepEqual(Object.keys(m), ['name', 'provider', 'model', 'apiBase', 'apiKey', 'roles', 'capabilities'], `${m.name}: no unverified completion options`);
  }

  // Cline: no reasoning-effort value in the sheet (CLI --thinking has no max).
  f.kit('integrate', 'cline');
  assert.doesNotMatch(fs.readFileSync(path.join(f.state, 'generated', 'cline-zcode-values.md'), 'utf8'), /--thinking|reasoning|effort/i);
});

// ------------------------------------------------ bridge flag (ticket 36)
// Seam 8: every generated harness MCP entry starts the bridge as
// `node --max-semi-space-size=1 <kit>/mcp/zcode-harness-mcp/dist/index.js --stdio`
// (spec §6 b), never through NODE_OPTIONS, and an existing entry is migrated
// on the next setup through the transaction.
const SEMI = '--max-semi-space-size=1';
const SERVER_JS = path.join(path.resolve(KIT), 'mcp', 'zcode-harness-mcp', 'dist', 'index.js');
const POSIX_FAKE = { skip: process.platform === 'win32' && 'POSIX fake executable' };

/** OMP is configured only when ~/.omp/agent/models.yml exists; returns its mcp.json path. */
function ompHome(f) {
  const dir = path.join(f.home, '.omp', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'models.yml'), '# user models\nproviders:\n  openai:\n    name: OpenAI\n    models:\n      - id: gpt-test\n');
  return path.join(dir, 'mcp.json');
}

/**
 * A fake `claude` that keeps one user-scope "zcode-harness" registration in a
 * state file (its Args line) and logs every call. `failFlaggedAdd` makes an
 * add that carries the flag fail, the way an old or broken CLI would.
 */
function fakeClaude(f, { registeredArgs = null, failFlaggedAdd = false } = {}) {
  const bin = path.join(f.home, 'fake-bin');
  const calls = path.join(f.home, 'claude-calls.log');
  const state = path.join(f.home, 'claude-registration');
  fs.mkdirSync(bin, { recursive: true });
  if (registeredArgs !== null) fs.writeFileSync(state, registeredArgs);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
printf '%s\\n' "$@" >> '${calls}'; echo --- >> '${calls}'
case "$1 $2" in
  "mcp get") [ -f '${state}' ] || { echo 'No MCP server found with name: zcode-harness' >&2; exit 1; }
    printf 'zcode-harness:\\n  Scope: User config (available in all your projects)\\n  Type: stdio\\n  Command: node\\n  Args: %s\\n' "$(cat '${state}')"; exit 0 ;;
  "mcp remove") rm -f '${state}'; exit 0 ;;
  "mcp add") shift 7; ${failFlaggedAdd ? `case "$*" in *${SEMI}*) echo 'unknown option' >&2; exit 1 ;; esac; ` : ''}[ -f '${state}' ] && exit 1; printf '%s' "$*" > '${state}'; exit 0 ;;
esac
exit 0
`, { mode: 0o755 });
  const env = { ...f.env, PATH: `${bin}:${f.env.PATH}` };
  return {
    env,
    run: (...args) => spawnSync(process.execPath, [path.join(KIT, 'cli', 'zcode-kit.mjs'), ...args], { env, encoding: 'utf8', timeout: 60000 }),
    calls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '').split('---\n').map(c => c.split('\n').filter(Boolean)).filter(c => c.length),
    resetCalls: () => fs.rmSync(calls, { force: true }),
    registered: () => (fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : null),
  };
}

// Cross-platform unit test of the Claude Code ownership + flag decision
// (round 2: the windows-only cli-audit test met the migration). Every
// spelling of this installation's script is "ours"; with the kit's flags it
// is current (left alone), without them outdated (migrated once); any other
// script is foreign (never touched).
test('Claude Code registration: equivalent path spellings with and without the bridge flag, per platform', async () => {
  const { claudeRegistrationState, sameInstallationPath } = await import('../lib/mcp-bridge.mjs');
  const shown = (args) => `zcode-harness:\n  Scope: User config (available in all your projects)\n  Type: stdio\n  Command: node\n  Args: ${args}\n`;
  const cases = {
    win32: {
      server: 'C:\\Users\\Runner Admin\\kit\\mcp\\zcode-harness-mcp\\dist\\index.js',
      same: (s) => [s, s.toUpperCase(), s.toLowerCase(), s.replaceAll('\\', '/'), s.replaceAll('\\', '/').toUpperCase(),
        s.replace('\\mcp\\', '\\mcp\\.\\'), s.replace('\\dist\\', '\\dist\\..\\dist\\'), s.replace('\\kit\\', '\\kit\\\\'), `"${s}"`, `"${s.replaceAll('\\', '/').toUpperCase()}"`],
      foreign: (s) => [`${s}.foreign`, s.replace('\\kit\\', '\\kit2\\'), s.replace('C:', 'D:'), 'mcp\\zcode-harness-mcp\\dist\\index.js', 'mcp/zcode-harness-mcp/dist/index.js'],
    },
    linux: {
      server: '/home/runner admin/kit/mcp/zcode-harness-mcp/dist/index.js',
      same: (s) => [s, s.replace('/mcp/', '/mcp/./'), s.replace('/kit/', '/kit//'), s.replace('/dist/', '/dist/../dist/'), `"${s}"`],
      foreign: (s) => [s.toUpperCase(), `${s}.foreign`, s.replace('/kit/', '/kit2/'), s.replaceAll('/', '\\'), 'mcp/zcode-harness-mcp/dist/index.js'],
    },
  };
  for (const [platform, { server, same, foreign }] of Object.entries(cases)) {
    for (const spelling of same(server)) {
      assert.equal(sameInstallationPath(spelling.replace(/^"|"$/g, ''), server, { platform }), true, `${platform}: ${spelling} is this installation`);
      assert.equal(claudeRegistrationState(shown(`${SEMI} ${spelling} --stdio`), server, { platform }).state, 'current', `${platform}, flagged: ${spelling}`);
      assert.equal(claudeRegistrationState(`\x1b[1m${shown(`${SEMI} ${spelling} --stdio`)}\x1b[0m`, server, { platform }).state, 'current', `${platform}, coloured: ${spelling}`);
      assert.equal(claudeRegistrationState(shown(`${spelling} --stdio`), server, { platform }).state, 'outdated', `${platform}, no flag: ${spelling}`);
      assert.equal(claudeRegistrationState(shown(`--max-semi-space-size=2 ${spelling} --stdio`), server, { platform }).state, 'outdated', `${platform}, another flag value: ${spelling}`);
    }
    for (const spelling of foreign(server)) {
      for (const args of [`${spelling} --stdio`, `${SEMI} ${spelling} --stdio`]) {
        assert.equal(claudeRegistrationState(shown(args), server, { platform }).state, 'foreign', `${platform}: ${args}`);
      }
    }
    for (const output of ['', 'zcode-harness:\n  Command: node\n', shown(`${SEMI} ${server}`)]) {
      assert.equal(claudeRegistrationState(output, server, { platform }).state, 'foreign', `${platform}: an unreadable display is never adopted`);
    }
  }
});

test('the kit and the bridge test client agree on the bridge Node flags', async () => {
  const { BRIDGE_NODE_FLAGS, bridgeArgs } = await import('../lib/mcp-bridge.mjs');
  const client = await import(pathToFileURL(path.join(KIT, 'mcp', 'zcode-harness-mcp', 'test', 'integration', 'client.mjs')).href);
  assert.deepEqual([...BRIDGE_NODE_FLAGS], [SEMI]);
  assert.deepEqual([...client.BRIDGE_NODE_FLAGS], [...BRIDGE_NODE_FLAGS], 'test:mcp runs the bridge as the generated entries start it');
  assert.deepEqual(bridgeArgs(SERVER_JS), [SEMI, SERVER_JS, '--stdio']);
});

test('every generated MCP entry puts --max-semi-space-size=1 on the bridge command line, never in NODE_OPTIONS', POSIX_FAKE, t => {
  const f = existingInstall(t);
  ompHome(f);
  const claude = fakeClaude(f);
  const res = claude.run('setup', '--harness', 'omp,claude-code,codex');
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(path.join(f.home, '.omp', 'agent', 'mcp.json')), `setup wrote OMP mcp.json:\n${res.stdout}`);

  const omp = JSON.parse(fs.readFileSync(path.join(f.home, '.omp', 'agent', 'mcp.json'), 'utf8')).mcpServers['zcode-harness'];
  assert.deepEqual(omp, { type: 'stdio', command: 'node', args: [SEMI, SERVER_JS, '--stdio'] }, 'OMP mcp.json: no env block, the flag before the script');

  const toml = fs.readFileSync(path.join(f.state, 'generated', 'codex-home', 'config.toml'), 'utf8');
  const kitPath = KIT.replace(/\\/g, '/');
  assert.match(toml, new RegExp(`^\\[mcp_servers\\.zcode-harness\\]\\ncommand = "node"\\nargs = \\["${SEMI}", "${kitPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/mcp/zcode-harness-mcp/dist/index\\.js", "--stdio"\\]\\n`, 'm'));

  const add = claude.calls().find(c => c[0] === 'mcp' && c[1] === 'add');
  assert.deepEqual(add, ['mcp', 'add', 'zcode-harness', '--scope', 'user', '--', 'node', SEMI, SERVER_JS, '--stdio']);
  for (const [name, text] of [['omp', JSON.stringify(omp)], ['codex', toml], ['claude', add.join(' ')]]) {
    assert.doesNotMatch(text, /NODE_OPTIONS/, `${name}: the flag never travels in NODE_OPTIONS`);
  }
});

test('the bridge-flag migration refreshes an existing OMP and Codex entry once, replays as a no-op and rolls back to the old entry', t => {
  const f = existingInstall(t);
  const ompFile = ompHome(f);
  const ompBefore = JSON.stringify({ mcpServers: { other: { command: 'other-server', args: ['--stdio'] }, 'zcode-harness': { type: 'stdio', command: 'node', args: [SERVER_JS, '--stdio'] } } }, null, 2) + '\n';
  fs.writeFileSync(ompFile, ompBefore);
  const codexFile = path.join(f.state, 'generated', 'codex-home', 'config.toml');
  fs.mkdirSync(path.dirname(codexFile), { recursive: true });
  f.kit('integrate', 'codex');
  const codexBefore = fs.readFileSync(codexFile, 'utf8').replace(`args = ["${SEMI}", `, 'args = [');
  fs.writeFileSync(codexFile, codexBefore);

  const setup = () => f.kit('setup', '--harness', 'omp,codex');
  const first = setup();
  const txId = f.txOf(first);
  assert.ok(txId, 'the migration is recorded as a transaction');
  assert.match(first, /omp: mcp\.json updated/);
  const ompAfter = fs.readFileSync(ompFile, 'utf8');
  const codexAfter = fs.readFileSync(codexFile, 'utf8');
  const servers = JSON.parse(ompAfter).mcpServers;
  assert.deepEqual(servers.other, { command: 'other-server', args: ['--stdio'] }, 'a user server is left as it was');
  assert.deepEqual(servers['zcode-harness'].args, [SEMI, SERVER_JS, '--stdio']);
  assert.match(codexAfter, new RegExp(`^args = \\["${SEMI}", `, 'm'));

  // Replayed twice: no-ops, and the new entry is recognised as this kit's.
  for (const replay of [setup(), setup()]) {
    assert.match(replay, /omp: "zcode-harness" already registered/);
    assert.doesNotMatch(replay, /another kit copy/);
    assert.equal(fs.readFileSync(ompFile, 'utf8'), ompAfter);
    assert.equal(fs.readFileSync(codexFile, 'utf8'), codexAfter);
  }

  // Rollback restores the old entries byte for byte; replaying from there
  // migrates again to the same bytes.
  const rolledBack = f.kit('rollback', txId);
  assert.match(rolledBack, /restored: .*mcp\.json/);
  assert.equal(fs.readFileSync(ompFile, 'utf8'), ompBefore);
  assert.equal(fs.readFileSync(codexFile, 'utf8'), codexBefore);
  setup();
  assert.equal(fs.readFileSync(ompFile, 'utf8'), ompAfter);
  assert.equal(fs.readFileSync(codexFile, 'utf8'), codexAfter);
});

test('an OMP entry of another kit copy stays untouched in its flagged form too', t => {
  const f = existingInstall(t);
  const ompFile = ompHome(f);
  for (const other of [path.join(f.home, 'other-kit', 'mcp', 'zcode-harness-mcp', 'dist', 'index.js'), `${SERVER_JS}.foreign`]) {
    const before = JSON.stringify({ mcpServers: { 'zcode-harness': { type: 'stdio', command: 'node', args: [SEMI, other, '--stdio'] } } }, null, 2) + '\n';
    fs.writeFileSync(ompFile, before);
    const out = f.kit('setup', '--harness', 'omp');
    assert.equal(fs.readFileSync(ompFile, 'utf8'), before);
    assert.ok(out.includes(`points at another kit copy (${other})`), `the warning names the other copy's script, not the flag:\n${out}`);
  }
});

test('the bridge-flag migration re-registers this kit\'s Claude Code entry once and replays as a no-op', POSIX_FAKE, t => {
  const f = existingInstall(t);
  const claude = fakeClaude(f, { registeredArgs: `${SERVER_JS} --stdio` });
  const first = claude.run('setup', '--harness', 'claude-code');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(claude.calls().map(c => c.slice(0, 2).join(' ')), ['mcp get', 'mcp remove', 'mcp add']);
  assert.equal(claude.registered(), `${SEMI} ${SERVER_JS} --stdio`);
  assert.match(first.stdout, /claude: re-registered "zcode-harness" with --max-semi-space-size=1/);
  const txId = f.txOf(first.stdout);
  assert.ok(txId, 'the re-registration is recorded');
  const manifest = JSON.parse(fs.readFileSync(path.join(f.state, 'backups', `tx-${txId}.manifest.json`), 'utf8'));
  assert.ok(manifest.ops.some(op => op.kind === 'external' && op.undoHint === 'claude mcp remove zcode-harness --scope user'),
    'recorded with the undo hint uninstall executes');

  for (let i = 0; i < 2; i++) {
    claude.resetCalls();
    const replay = claude.run('setup', '--harness', 'claude-code');
    assert.equal(replay.status, 0, replay.stdout + replay.stderr);
    assert.deepEqual(claude.calls().map(c => c.slice(0, 2).join(' ')), ['mcp get'], 'a replay only looks');
    assert.match(replay.stdout, /claude: "zcode-harness" already registered/);
  }
  const rollback = claude.run('rollback', txId);
  assert.equal(rollback.status, 1, 'a Claude Code registration lives in Claude Code\'s own config: its undo stays a manual step');
  assert.match(rollback.stdout, /manual undo required: .*-> claude mcp remove zcode-harness --scope user/s);
});

test('a failed flagged re-registration puts the old Claude Code entry back', POSIX_FAKE, t => {
  const f = existingInstall(t);
  const claude = fakeClaude(f, { registeredArgs: `${SERVER_JS} --stdio`, failFlaggedAdd: true });
  const res = claude.run('setup', '--harness', 'claude-code');
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(claude.registered(), `${SERVER_JS} --stdio`, 'the registration is never lost');
  assert.match(res.stdout, /WARN: claude mcp add failed: .*previous registration restored/);
});

test('a Claude Code entry of another kit copy stays untouched in its flagged form too', POSIX_FAKE, t => {
  const f = existingInstall(t);
  for (const other of [path.join(f.home, 'other-kit', 'dist', 'index.js'), `${SERVER_JS}.foreign`]) {
    const claude = fakeClaude(f, { registeredArgs: `${SEMI} ${other} --stdio` });
    claude.resetCalls();
    const res = claude.run('setup', '--harness', 'claude-code');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /claude "zcode-harness" is registered by another kit copy/);
    assert.deepEqual(claude.calls().map(c => c.slice(0, 2).join(' ')), ['mcp get']);
    assert.equal(claude.registered(), `${SEMI} ${other} --stdio`);
  }
});

test('setup registers the Claude Code MCP bridge with the unchanged `claude mcp add` syntax', { skip: process.platform === 'win32' && 'POSIX fake executable' }, t => {
  const f = existingInstall(t);
  const bin = path.join(f.home, 'fake-bin');
  const calls = path.join(f.home, 'claude-calls.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${calls}'\necho --- >> '${calls}'\n[ "$1 $2" = "mcp get" ] && exit 1\nexit 0\n`, { mode: 0o755 });
  execFileSync(process.execPath, [path.join(KIT, 'cli', 'zcode-kit.mjs'), 'setup', '--harness', 'claude-code'],
    { env: { ...f.env, PATH: `${bin}:${f.env.PATH}` }, encoding: 'utf8', timeout: 60000 });
  const add = fs.readFileSync(calls, 'utf8').split('---\n').map(c => c.split('\n').filter(Boolean)).find(c => c[0] === 'mcp' && c[1] === 'add');
  assert.ok(add, 'claude mcp add was called');
  assert.deepEqual(add.slice(0, 7), ['mcp', 'add', 'zcode-harness', '--scope', 'user', '--', 'node']);
  assert.equal(add.at(-1), '--stdio');
});

test('the next setup refreshes every applied MEDIUM fix in one transaction, idempotently and reversibly', t => {
  const f = existingInstall(t);
  const gooseDir = process.platform === 'win32'
    ? path.join(f.home, 'AppData', 'Roaming', 'Block', 'goose', 'config', 'custom_providers')
    : path.join(f.home, '.config', 'goose', 'custom_providers');
  const files = {
    opencode: [path.join(f.home, '.config', 'opencode', 'opencode.json'), openCodeBeforeFix()],
    goose: [path.join(gooseDir, 'zcode.json'), gooseBeforeFix()],
    'kilo-code': [path.join(f.state, 'generated', 'kilo-zcode-values.md'), kiloSheetAfterHighFix()],
    cline: [path.join(f.state, 'generated', 'cline-zcode-values.md'), clineSheetBeforeFix()],
    omp: [path.join(f.home, '.omp', 'agent', 'models.yml'), ompModelsBeforeFix(f.key)],
  };
  for (const [file, before] of Object.values(files)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, before);
  }
  const setup = () => f.kit('setup', '--harness', Object.keys(files).join(','));
  const txId = f.txOf(setup());
  assert.ok(txId, 'the refresh is recorded as one transaction');
  const after = Object.fromEntries(Object.entries(files).map(([id, [file]]) => [id, fs.readFileSync(file, 'utf8')]));
  assert.deepEqual(parseJsonc(after.opencode).provider.zcode.models['glm-5.3-flash'].modalities, { input: ['text', 'image'], output: ['text'] });
  assert.equal(JSON.parse(after.goose).models[1].supports_vision, true);
  assert.match(after['kilo-code'], /^\| glm-5\.3-flash +\| GLM-5\.3-Flash +\| on +\| on +\|$/m);
  assert.match(after.cline, /cline auth -p openai/);
  assert.equal(parseYaml(after.omp).providers.zcode.auth, 'apiKey');

  setup();
  for (const [id, [file]] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), after[id], `second setup is byte-idempotent (${id})`);
  f.kit('rollback', txId);
  for (const [id, [file, before]] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), before, `rollback restores the pre-fix ${id} file`);
});
