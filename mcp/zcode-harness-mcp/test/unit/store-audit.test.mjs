import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../../dist/store/store.js';

test('event retention rotates at four MiB and preserves pagination across the boundary', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-store-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new JsonStore(dir);
  for (let seq = 1; seq <= 10; seq++) store.appendLine('events/log.jsonl', { seq, payload: 'x'.repeat(600000) });
  assert.ok(fs.statSync(path.join(dir, 'events/log.jsonl')).size <= 4 * 1024 * 1024);
  assert.ok(fs.statSync(path.join(dir, 'events/log.jsonl.previous')).size <= 4 * 1024 * 1024);
  const result = store.readLinesAfter('events/log.jsonl', 7, 2);
  assert.deepEqual(result.items.map(i => i.seq), [8, 9]);
  assert.equal(result.hasMore, true);
});

test('oversized records are marked rather than allocated indefinitely', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-store-large-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new JsonStore(dir);
  store.appendLine('log.jsonl', { seq: 12, payload: 'x'.repeat(5 * 1024 * 1024) });
  assert.equal(store.readLines('log.jsonl')[0].type, 'bridge.record_truncated');
  assert.equal(store.readLines('log.jsonl')[0].seq, 12);
  store.appendLine('huge-seq.jsonl', { seq: 'x'.repeat(5 * 1024 * 1024) });
  assert.ok(fs.statSync(path.join(dir, 'huge-seq.jsonl')).size < 1024);
  assert.equal(store.readLines('huge-seq.jsonl')[0].seq, undefined);
});
