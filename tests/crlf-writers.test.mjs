// Ticket 68: every writer of a user-owned text file keeps the file's line
// endings. A Windows user's files are CRLF (installers, editors, git
// autocrlf); a writer that splices or re-renders LF text into them leaves
// mixed line endings. For each writer: a CRLF input comes back as the LF
// result with CRLF line breaks (no bare LF), keys are not duplicated, and a
// replay leaves the file byte-identical. Every fixture is a temp HOME plus an
// isolated kit state directory (B3); nothing listens on the fixture port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lineEndingOf, withLineEndingsOf } from '../lib/line-endings.mjs';
import continueAdapter from '../cli/adapters/continue.mjs';
import { bootstrap, createCtx } from '../cli/context.mjs';
import { repairManaged } from '../cli/heal.mjs';
import { mirrorTree } from '../lib/self-update.mjs';
import { freePort } from './free-port.mjs';

const KIT = path.join(import.meta.dirname, '..');
const { parse: parseYaml } = createRequire(path.join(KIT, 'zcode-proxy-src', 'package.json'))('yaml');
// Free ports of this run (ticket 75). PORT is written into fixture configs only
// and nothing listens there, but setup probes it; HEAL_PORT is the heal
// fixtures' config port, which `doctor --fix` binds exclusively while it aligns
// the key, so a parallel run must never hold it.
const PORT = await freePort();
const HEAL_PORT = await freePort();
const KEY = 'fixture-key-' + 'c'.repeat(32);

const crlf = (text) => text.replace(/\n/g, '\r\n');
const bareLf = (text) => (text.match(/(?<!\r)\n/g) ?? []).length;

/**
 * Seam 8: a temp HOME plus an isolated kit state directory owned by this
 * checkout (created first, with its .owner.json, so nothing from the checkout
 * leaks in), driven through the real `zcode-kit` CLI.
 */
function install(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-crlf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(state, 'proxy'), { recursive: true });
  fs.mkdirSync(path.join(state, 'generated'));
  let identity = fs.realpathSync(KIT);
  if (process.platform === 'win32') identity = identity.toLowerCase();
  fs.writeFileSync(path.join(state, '.owner.json'), JSON.stringify({ root: identity }) + '\n');
  fs.writeFileSync(path.join(state, '.proxykey'), KEY + '\n');
  fs.writeFileSync(path.join(state, 'proxy', 'config.yaml'), `server:\n  port: ${PORT}\n`);
  const env = {
    ...process.env, HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), ZCODE_KIT_STATE_DIR: state,
    ZCODE_KIT_SKIP_DEPS: '1', ZCODE_KIT_ALLOW_CHECKOUT: '1',
    ZCODE_PROXY_CREDENTIALS_PATH: path.join(home, 'credentials.json'),
    PATH: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin',
  };
  delete env.OPENCODE_CONFIG; delete env.OPENCODE_CONFIG_DIR; delete env.ZCODE_KIT_HARNESSES;
  const kit = (...args) => execFileSync(process.execPath, [path.join(KIT, 'cli', 'zcode-kit.mjs'), ...args], { env, encoding: 'utf8', timeout: 60000 });
  const put = (rel, text) => {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  // The fixture root as it appears in written files (native, forward slashes, JSON-escaped).
  const spellings = [...new Set([root, root.replace(/\\/g, '/'), root.replace(/\\/g, '\\\\')])].sort((a, b) => b.length - a.length);
  const anonymous = (text) => spellings.reduce((acc, s) => acc.replaceAll(s, '<ROOT>'), text);
  // Ticket 43: on the compact screen the verbatim transaction line lives in
  // install.log; --verbose keeps it on stdout. Reads both.
  const txOf = (out) => out.match(/transaction (\S+) recorded/)?.[1]
    ?? (() => { try { return fs.readFileSync(path.join(state, 'logs', 'install.log'), 'utf8').match(/transaction (\S+) recorded/)?.[1]; } catch { return undefined; } })();
  return { home, state, kit, put, anonymous, txOf };
}

/**
 * The writer contract on one file: the same user file once LF and once CRLF,
 * the same command on both. The CRLF result is the LF result with CRLF line
 * breaks (no bare LF), and a replay of the command leaves it byte-identical
 * without a new transaction. Returns both results for writer-specific checks.
 */
function crlfContract(t, rel, userLf, args) {
  const { lf, win, results } = crlfContractFiles(t, { [rel]: userLf }, args);
  return { lf, win, ...results[rel] };
}

/** crlfContract over several user files one command writes (`files`: rel → LF content). */
function crlfContractFiles(t, files, args) {
  const lf = install(t);
  const win = install(t);
  for (const [rel, userLf] of Object.entries(files)) { lf.put(rel, userLf); win.put(rel, crlf(userLf)); }
  lf.kit(...args);
  const first = win.kit(...args);
  assert.ok(win.txOf(first), 'the CRLF write is recorded as a transaction');
  const results = {};
  for (const [rel, userLf] of Object.entries(files)) {
    const lfResult = fs.readFileSync(path.join(lf.home, rel), 'utf8');
    const winFile = path.join(win.home, rel);
    const winResult = fs.readFileSync(winFile, 'utf8');
    assert.notEqual(lfResult, userLf, `${rel}: the command changes the LF file (the fixture exercises a write)`);
    assert.equal(bareLf(winResult), 0, `${rel}: no bare LF in the rewritten CRLF file`);
    assert.equal(win.anonymous(winResult), crlf(lf.anonymous(lfResult)), `${rel}: the CRLF result is the LF result with CRLF line endings`);
    results[rel] = { lfResult, winResult, winFile };
  }
  const replay = win.kit(...args);
  for (const [rel, { winFile, winResult }] of Object.entries(results)) {
    assert.equal(fs.readFileSync(winFile, 'utf8'), winResult, `${rel}: a replay leaves the CRLF file byte-identical`);
  }
  assert.equal(win.txOf(replay), undefined, 'a no-op replay records no transaction');
  return { lf, win, results };
}

test('the CLI and the proxy use one line-ending helper (byte-identical copies)', () => {
  assert.ok(
    fs.readFileSync(path.join(KIT, 'lib', 'line-endings.mjs')).equals(fs.readFileSync(path.join(KIT, 'zcode-proxy-src', 'src', 'config', 'line-endings.mjs'))),
    'lib/line-endings.mjs and zcode-proxy-src/src/config/line-endings.mjs differ: edit one and copy it over the other',
  );
});

test('a file is CRLF when its CRLF breaks outnumber its bare LF breaks, else LF', () => {
  assert.equal(lineEndingOf(''), '\n', 'a new or empty file is LF');
  assert.equal(lineEndingOf('a\nb\n'), '\n');
  assert.equal(lineEndingOf('a\r\nb\r\n'), '\r\n');
  assert.equal(lineEndingOf('a\r\nb\r\nc\n'), '\r\n', 'majority CRLF');
  assert.equal(lineEndingOf('a\r\nb\nc\n'), '\n', 'majority LF');
  assert.equal(lineEndingOf('a\r\nb\n'), '\n', 'a tie is LF');
  // Every bare LF of a blank-line run counts: 3 CRLF against 4 bare LF is LF.
  assert.equal(lineEndingOf('a\r\nb\r\nc\r\n\n\n\n\n'), '\n');
  assert.equal(lineEndingOf('a\rb\r'), '\n', 'a lone CR is not a line break');
});

test('text is written with the line endings of the file it goes into', () => {
  assert.equal(withLineEndingsOf('x\r\ny\r\n', 'a\nb\r\nc\n'), 'a\r\nb\r\nc\r\n');
  assert.equal(withLineEndingsOf('x\ny\n', 'a\nb\r\nc\n'), 'a\nb\nc\n');
  assert.equal(withLineEndingsOf('', 'a\r\n'), 'a\n');
  assert.equal(withLineEndingsOf('x\r\n', 'no break'), 'no break');
});

// ---------------------------------------------------------------- Continue
const CONTINUE_SHAPES = {
  'a block list': 'name: Personal\nschema: v1\nmodels:\n  - name: User\n    provider: openai\n    model: user-model\n    roles: [chat]\ncontext: []\n',
  'an empty flow list': 'name: Personal\nschema: v1\nmodels: []\ncontext: []\n',
  'no models key': 'name: Personal\nschema: v1\ncontext: []\n',
};
for (const [shape, user] of Object.entries(CONTINUE_SHAPES)) {
  test(`integrate keeps a CRLF Continue config.yaml CRLF (${shape}), with one models key, idempotently`, t => {
    const { win, winResult } = crlfContract(t, '.continue/config.yaml', user, ['integrate', 'continue']);
    assert.equal(winResult.match(/^models:/gm).length, 1, 'one models key');
    const names = parseYaml(winResult).models.map((m) => m.name);
    assert.deepEqual(names.filter((n) => n.startsWith('ZCode')), ['ZCode GLM-5.3', 'ZCode GLM-5.3-Flash']);
    const verify = continueAdapter.verify({ home: win.home, port: () => PORT, key: () => KEY });
    assert.deepEqual(verify.map((c) => [c.name, c.ok]), [['continue models registered', true]], 'doctor reads the CRLF managed block as current');
  });
}

// --------------------------------------------------------------------- OMP
// setup writes three OMP files: the managed block spliced into models.yml,
// config.yml re-rendered by the yaml library, and mcp.json re-rendered as JSON.
test('setup keeps CRLF OMP models.yml, config.yml and mcp.json CRLF, with one managed block, idempotently', t => {
  const { results } = crlfContractFiles(t, {
    '.omp/agent/models.yml': '# user models\nproviders:\n  openai:\n    name: OpenAI\n    models:\n      - id: gpt-test\n',
    '.omp/agent/config.yml': '# user config\ndisabledProviders:\n  - zcode\n  - zai\nallowTools:\n  - bash\n',
    '.omp/agent/mcp.json': '{\n  "mcpServers": {\n    "other": {\n      "command": "other-server"\n    }\n  }\n}\n',
  }, ['setup', '--harness', 'omp']);
  const models = results['.omp/agent/models.yml'].winResult;
  assert.equal(models.match(/^ *# >>> zcode-kit \(managed block\)/gm).length, 1, 'one managed block');
  assert.deepEqual(Object.keys(parseYaml(models).providers), ['zcode', 'openai']);
  const config = parseYaml(results['.omp/agent/config.yml'].winResult);
  assert.deepEqual(config.disabledProviders, ['zai']);
  assert.equal(config.extensions.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(results['.omp/agent/mcp.json'].winResult).mcpServers), ['other', 'zcode-harness']);
});

// ---------------------------------------------------- pi, OpenCode (JSONC)
test('integrate keeps a CRLF pi models.json CRLF, with one zcode provider, idempotently', t => {
  const { winResult } = crlfContract(t, '.pi/agent/models.json',
    '// my providers\n{\n  "providers": {\n    "other": {\n      "baseUrl": "http://127.0.0.1:1"\n    }\n  }\n}\n',
    ['integrate', 'pi']);
  assert.ok(winResult.startsWith('// my providers\r\n{\r\n  "providers": '), 'the user comment and bytes before the edit stay');
  assert.equal(winResult.match(/"zcode":/g).length, 1);
});

const OPENCODE_SHAPES = {
  'a provider key': '{\n  // mine\n  "provider": {\n    "other": { "npm": "x" }\n  }\n}\n',
  'no provider key': '{\n  "$schema": "https://opencode.ai/config.json",\n  "theme": "dark"\n}\n',
  'no final newline': '{\n  "theme": "dark"\n}',
};
for (const [shape, user] of Object.entries(OPENCODE_SHAPES)) {
  test(`integrate keeps a CRLF OpenCode config CRLF (${shape}), with one zcode provider, idempotently`, t => {
    const { winResult } = crlfContract(t, '.config/opencode/opencode.json', user, ['integrate', 'opencode']);
    assert.equal(winResult.match(/"provider":/g).length, 1, 'one provider key');
    assert.equal(winResult.match(/"zcode":/g).length, 1);
  });
}

// ------------------------------------------------------------------- Goose
test('integrate keeps a CRLF Goose provider file CRLF when it refreshes the kit entry, idempotently', t => {
  // A kit-owned entry from an earlier setup on another port, plus a key the
  // user added (kept by the merge).
  const resolver = path.join(KIT, 'proxy', 'resolve-zcode-proxy-key.mjs').replace(/\\/g, '/');
  const earlier = {
    name: 'zcode', engine: 'openai', display_name: 'ZCode (local proxy)',
    base_url: 'http://127.0.0.1:19689/v1/chat/completions',
    models: [{ name: 'glm-5.3', context_limit: 1000000 }],
    user_note: 'kept',
    auth: { command: 'node', args: [resolver] },
  };
  // goose.providerDir under the fixture HOME (APPDATA is HOME/AppData/Roaming there).
  const rel = process.platform === 'win32' ? 'AppData/Roaming/Block/goose/config/custom_providers' : '.config/goose/custom_providers';
  const { winResult } = crlfContract(t, path.join(rel, 'zcode.json'), JSON.stringify(earlier, null, 2) + '\n', ['integrate', 'goose']);
  const doc = JSON.parse(winResult);
  assert.equal(doc.base_url, `http://127.0.0.1:${PORT}/v1/chat/completions`);
  assert.equal(doc.user_note, 'kept');
});

// ---------------------------------------- doctor --fix: offline key alignment
/** An in-tree kit whose proxy/config.yaml is the template with an older key. */
function healFixture(t, eol) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-crlf-heal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'proxy'));
  fs.mkdirSync(path.join(root, 'logs'));
  fs.mkdirSync(path.join(root, 'home'));
  const template = fs.readFileSync(path.join(KIT, 'proxy', 'config.example.yaml'), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(root, 'proxy', 'config.example.yaml'), template);
  fs.writeFileSync(path.join(root, '.proxykey'), KEY + '\n');
  const ctx = createCtx(root, path.join(root, 'home'));
  const config = template.replace(/^  port: \d+$/m, `  port: ${HEAL_PORT}`).replace('"GENERATE_ME"', '"older-key"');
  fs.writeFileSync(ctx.config, eol === 'crlf' ? crlf(config) : config);
  return ctx;
}

test('doctor --fix aligns the key in a CRLF proxy config and keeps it CRLF, idempotently', async t => {
  const lf = healFixture(t, 'lf');
  const win = healFixture(t, 'crlf');
  await repairManaged(lf, []);
  await repairManaged(win, []);
  const lfResult = fs.readFileSync(lf.config, 'utf8');
  const winResult = fs.readFileSync(win.config, 'utf8');
  assert.equal(lfResult.match(/^  proxyApiKey: "(.*)"$/m)?.[1], KEY, 'the LF config carries the current key');
  assert.equal(bareLf(winResult), 0, 'no bare LF in the aligned CRLF config');
  assert.equal(winResult, crlf(lfResult), 'the CRLF result is the LF result with CRLF line endings');
  assert.equal(winResult.match(/proxyApiKey:/g).length, 1, 'one key');
  await repairManaged(win, []);
  assert.equal(fs.readFileSync(win.config, 'utf8'), winResult, 'a replay leaves the config byte-identical');
});

// ------------------------------------- bootstrap: the checkout's local excludes
function quietBootstrap(ctx) {
  const previous = { ...process.env };
  const original = console.log;
  process.env.ZCODE_KIT_SKIP_DEPS = '1';
  process.env.ZCODE_PROXY_CREDENTIALS_PATH = path.join(ctx.home, 'credentials.json');
  console.log = () => {};
  try { bootstrap(ctx, () => {}); } finally {
    console.log = original;
    for (const key of ['ZCODE_KIT_SKIP_DEPS', 'ZCODE_PROXY_CREDENTIALS_PATH']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
}

test('bootstrap appends the kit excludes to a CRLF .git/info/exclude with CRLF, once', t => {
  const user = "# git ls-files --others --exclude-from=.git/info/exclude\n# Lines that start with '#' are comments.\n*.local\n";
  const run = (eol) => {
    const ctx = healFixture(t, 'lf');
    fs.mkdirSync(path.join(ctx.root, '.git', 'info'), { recursive: true });
    const exclude = path.join(ctx.root, '.git', 'info', 'exclude');
    fs.writeFileSync(exclude, eol === 'crlf' ? crlf(user) : user);
    quietBootstrap(ctx);
    return { ctx, exclude, result: fs.readFileSync(exclude, 'utf8') };
  };
  const lf = run('lf');
  const win = run('crlf');
  assert.ok(lf.result.startsWith(user) && lf.result.includes('# >>> zcode-kit local excludes'), 'the LF file gets the kit block after the user lines');
  assert.equal(bareLf(win.result), 0, 'no bare LF in the CRLF exclude file');
  assert.equal(win.result, crlf(lf.result), 'the CRLF result is the LF result with CRLF line endings');
  quietBootstrap(win.ctx);
  assert.equal(fs.readFileSync(win.exclude, 'utf8'), win.result, 'a replay leaves the file byte-identical (the block is added once)');
});

// ------------------------------------------- writers that keep bytes already
// These hold on the integration tip; each test is proven live by a mutation
// (ticket 68 Comments).

test('rollback restores a CRLF user config byte for byte', t => {
  const { win, winFile } = crlfContract(t, '.continue/config.yaml', CONTINUE_SHAPES['a block list'], ['integrate', 'continue']);
  const ids = fs.readdirSync(path.join(win.state, 'backups')).map((f) => f.match(/^tx-(.+)\.manifest\.json$/)?.[1]).filter(Boolean);
  assert.equal(ids.length, 1, 'one recorded transaction');
  assert.match(win.kit('rollback', ids[0]), /restored: .*config\.yaml/);
  assert.equal(fs.readFileSync(winFile, 'utf8'), crlf(CONTINUE_SHAPES['a block list']), 'the pre-setup CRLF bytes are back');
});

test('update mirrors a release over the kit without touching a CRLF proxy config or key', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-crlf-update-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const src = path.join(base, 'release');
  const dest = path.join(base, 'kit');
  for (const dir of [path.join(src, 'proxy'), path.join(dest, 'proxy')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(src, 'proxy', 'config.example.yaml'), 'server:\n  port: 8457\n');
  fs.writeFileSync(path.join(src, 'proxy', 'config.yaml'), 'server:\n  port: 8457\n');
  const config = crlf('server:\n  port: 19682\nauth:\n  proxyApiKey: "kept"\n');
  fs.writeFileSync(path.join(dest, 'proxy', 'config.yaml'), config);
  fs.writeFileSync(path.join(dest, '.proxykey'), 'kept\r\n');
  mirrorTree(src, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'proxy', 'config.yaml'), 'utf8'), config);
  assert.equal(fs.readFileSync(path.join(dest, '.proxykey'), 'utf8'), 'kept\r\n');
});

test('bootstrap creates proxy/config.yaml with the example config\'s own CRLF line endings and leaves it alone afterwards', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-crlf-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'proxy'));
  fs.mkdirSync(path.join(root, 'home'));
  const example = crlf(fs.readFileSync(path.join(KIT, 'proxy', 'config.example.yaml'), 'utf8').replace(/\r\n/g, '\n'));
  fs.writeFileSync(path.join(root, 'proxy', 'config.example.yaml'), example);
  fs.writeFileSync(path.join(root, '.proxykey'), KEY + '\n');
  const ctx = createCtx(root, path.join(root, 'home'));
  quietBootstrap(ctx);
  const created = fs.readFileSync(ctx.config, 'utf8');
  assert.equal(created, example.replace('proxyApiKey: "GENERATE_ME"', `proxyApiKey: "${KEY}"`), 'the example\'s bytes with the key filled in');
  quietBootstrap(ctx);
  assert.equal(fs.readFileSync(ctx.config, 'utf8'), created, 'a replay leaves the config byte-identical');
});
