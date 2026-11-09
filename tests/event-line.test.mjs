// Event lines and redaction on the manager's side (ADR-0010 rule 4).
//  - the shared event-line module gives the same lines under Node as under Bun
//    (zcode-proxy-src/src/log/event-line.test.ts holds the full vectors)
//  - the manager writes new events as event lines to the proxy log
//  - the manager's existing `[manager <ISO>] …` lines keep their text but carry
//    no secret, and `proxy logs` shows no secret from any line
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManager } from '../proxy/zcode-proxy-manager.mjs';
import { createEventLogger, formatEventLine, redactLine } from '../lib/event-line.mjs';
import { freePort } from './free-port.mjs';

const KIT = join(import.meta.dirname, '..');

// Fixture shapes only (B2). The proxy key and the stop token are 32 random
// bytes as base64url (43 chars); the stop-token-shaped value is not a known
// secret of the manager, so only its shape can mask it.
const KEY = 'Kf3n8QzV1cR7tYp0LmW4sXa9bE2dH6uJgO5iTzNqPvA';
const STOP_TOKEN_SHAPED = 'q3Vx8mZ0bK2fT9wLr7YpN4sJd1HcE6uGaO5iWzXlQvA';
const AT = new Date('2026-11-06T12:34:56.789Z');
const EVENT_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (DEBUG|INFO|WARN|ERROR) [A-Za-z0-9_.-]+ \S/;

function fixture(t, port) {
  const root = mkdtempSync(join(tmpdir(), 'kit-event-line-'));
  mkdirSync(join(root, 'proxy')); mkdirSync(join(root, 'logs'));
  mkdirSync(join(root, 'zcode-proxy-src', 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'proxy', 'config.yaml'), `server:\n  host: 127.0.0.1\n  port: ${port}\n`);
  writeFileSync(join(root, '.proxykey'), KEY + '\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
async function quiet(fn) {
  const original = console.log; const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { return { value: await fn(), lines }; } finally { console.log = original; }
}

test('the manager and the proxy use one event-line implementation (byte-identical copies)', () => {
  assert.ok(
    readFileSync(join(KIT, 'lib', 'event-line.mjs')).equals(readFileSync(join(KIT, 'zcode-proxy-src', 'src', 'log', 'event-line.mjs'))),
    'lib/event-line.mjs and zcode-proxy-src/src/log/event-line.mjs differ: edit one and copy it over the other',
  );
});

test('the shared module renders the same event lines under Node as under Bun', () => {
  assert.equal(
    formatEventLine({ time: AT, level: 'WARN', component: 'supervisor', message: 'footprint above soft limit', fields: { rssMB: 530, reason: 'soft limit', 'a=b': 1 } }),
    '2026-11-06T12:34:56.789Z WARN supervisor footprint above soft limit rssMB=530 reason="soft limit" a_b=1',
  );
  assert.equal(redactLine(`stop with ${STOP_TOKEN_SHAPED}`), 'stop with <redacted>');
  const lines = [];
  createEventLogger({ component: 'lock', write: l => lines.push(l), now: () => AT }).info('takeover', { stopToken: 'x' });
  assert.deepEqual(lines, ['2026-11-06T12:34:56.789Z INFO lock takeover stopToken=<redacted>']);
});

test('the manager writes new events as event lines to the proxy log, with no secret', async t => {
  const root = fixture(t, await freePort());
  const m = createManager({ root, home: root });
  const { lines } = await quiet(async () => {
    m.logEvent('WARN', 'lock takeover', { holderPid: 4242, reason: 'holder dead', note: `key ${KEY}` });
  });
  const logged = readFileSync(m.LOG_FILE, 'utf8').split('\n').filter(Boolean);
  assert.equal(logged.length, 1);
  assert.match(logged[0], EVENT_LINE);
  assert.match(logged[0], / WARN manager lock takeover holderPid=4242 reason="holder dead" note="key <redacted>"$/);
  assert.deepEqual(lines, logged, 'the console sees the same line');
  assert.ok(!logged[0].includes(KEY));
});

test('existing manager lines keep their text but mask the proxy key and stop-token-shaped values', async t => {
  const root = fixture(t, await freePort());
  const m = createManager({
    root, home: root,
    bunResolver: () => { throw new Error(`bun rejected Authorization: Bearer ${KEY} with token ${STOP_TOKEN_SHAPED}`); },
  });
  const { value: code, lines } = await quiet(() => m.start({ waitMs: 500 }));
  assert.equal(code, 4);
  const logged = readFileSync(m.LOG_FILE, 'utf8');
  assert.match(logged, /^\[manager \d{4}-\d{2}-\d{2}T[\d:.]+Z\] ERROR: cannot start the proxy — bun rejected Authorization: Bearer <redacted> with token <redacted>$/m);
  for (const secret of [KEY, STOP_TOKEN_SHAPED]) {
    assert.ok(!logged.includes(secret), 'proxy log carries no secret');
    assert.ok(!lines.join('\n').includes(secret), 'console carries no secret');
  }
});

test('proxy logs shows every line, masking secrets the proxy wrote and leaving the rest byte-identical', async t => {
  const port = await freePort();
  const root = fixture(t, port);
  const m = createManager({ root, home: root });
  const clean = [
    '[manager 2026-11-06T00:31:32.688Z] starting zcode-proxy ...',
    `zcode-proxy listening on http://127.0.0.1:${port}`,
    '#001 ANT glm-5.3-flash 200 batch 948ms',
  ];
  writeFileSync(m.LOG_FILE, [...clean, `[zcode-proxy] upstream echoed x-api-key: ${KEY}`, `stop token ${STOP_TOKEN_SHAPED}`].join('\n') + '\n');
  const { value: code, lines } = await quiet(async () => m.logs(10));
  assert.equal(code, 0);
  assert.deepEqual(lines.join('\n').split('\n'), [...clean, '[zcode-proxy] upstream echoed x-api-key: <redacted>', 'stop token <redacted>']);
});
