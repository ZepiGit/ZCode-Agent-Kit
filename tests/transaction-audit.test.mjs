import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginTransaction, rollbackTransaction, listTransactions } from '../lib/transaction.mjs';
import { commitFile } from '../lib/edit.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-tx-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a second rollback of the same transaction reports no phantom conflicts', t => {
  const backupDir = fixture(t);
  const file = join(backupDir, 'target.yml');
  writeFileSync(file, 'original\n');
  const tx = beginTransaction(backupDir, 'twice');
  tx.touch(file); writeFileSync(file, 'kit\n');
  const id = tx.finish();
  const first = rollbackTransaction(backupDir, id);
  assert.deepEqual(first.conflicts, []); assert.equal(first.complete, true);
  writeFileSync(file, 'user edit after rollback\n');
  const second = rollbackTransaction(backupDir, id);
  assert.deepEqual(second.conflicts, [], 'already rolled back ops are not conflicts');
  assert.deepEqual(second.restored, []);
  assert.equal(readFileSync(file, 'utf8'), 'user edit after rollback\n');
  assert.ok(existsSync(join(backupDir, `tx-${id}.manifest.json`)), 'evidence retained');
  assert.deepEqual(listTransactions(backupDir), [], 'fully rolled back transaction is no longer active');
});

test('transactions created within the same millisecond keep creation order', t => {
  const backupDir = fixture(t);
  const a = beginTransaction(backupDir, 'a');
  const b = beginTransaction(backupDir, 'b');
  const file = join(backupDir, 'shared.yml');
  writeFileSync(file, 'A\n'); a.touch(file); writeFileSync(file, 'B\n'); a.finish();
  b.touch(file); writeFileSync(file, 'C\n'); b.finish();
  const ids = listTransactions(backupDir);
  assert.deepEqual(ids, [a.id, b.id]);
  // newest first: rolling back "the latest" must undo b, leaving A only after both
  rollbackTransaction(backupDir);
  assert.equal(readFileSync(file, 'utf8'), 'B\n');
  rollbackTransaction(backupDir);
  assert.equal(readFileSync(file, 'utf8'), 'A\n');
});

test('rollback recreates a missing parent directory instead of aborting half-way', t => {
  const backupDir = fixture(t);
  const dir = join(backupDir, 'nested', 'deep');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'config.json');
  writeFileSync(file, '{"user":true}\n');
  const tx = beginTransaction(backupDir, 'nested');
  tx.touch(file); writeFileSync(file, '{"kit":true}\n');
  const id = tx.finish();
  rmSync(join(backupDir, 'nested'), { recursive: true });
  const r = rollbackTransaction(backupDir, id);
  assert.equal(r.complete, true);
  assert.equal(readFileSync(file, 'utf8'), '{"user":true}\n');
});

test('transaction ids and manifest shapes are validated before any file operation', t => {
  const backupDir = fixture(t);
  assert.throws(() => rollbackTransaction(backupDir, '../../escape'), /invalid transaction id/);
  writeFileSync(join(backupDir, 'tx-bad1.manifest.json'), JSON.stringify({ id: 'bad1', startedAt: 'x', ops: [{ kind: 'modify', target: 'relative/path', backup: '../../../etc' }] }));
  assert.throws(() => rollbackTransaction(backupDir, 'bad1'), /corrupt manifest/);
  assert.deepEqual(listTransactions(backupDir), [], 'corrupt manifests are not offered for rollback');
});

test('external registrations are marked undone only when the callback confirms it', t => {
  const backupDir = fixture(t);
  const tx = beginTransaction(backupDir, 'ext');
  tx.external('registered X', 'undo X');
  const id = tx.finish();
  const kept = rollbackTransaction(backupDir, id, { undoExternal: () => false });
  assert.equal(kept.external.length, 1); assert.equal(kept.complete, false);
  const done = rollbackTransaction(backupDir, id, { undoExternal: () => true });
  assert.equal(done.external.length, 0); assert.equal(done.complete, true);
  assert.deepEqual(listTransactions(backupDir), []);
});

test('uncommitted create without proof never deletes a later user file', t => {
  const dir = fixture(t);
  const file = join(dir, 'created.txt');
  const tx = beginTransaction(dir, 'no-proof');
  tx.touch(file);
  writeFileSync(file, 'user content');
  const result = rollbackTransaction(dir, tx.id);
  assert.equal(result.complete, false);
  assert.equal(readFileSync(file, 'utf8'), 'user content');
});

test('journalled writes can be recovered after a crash without finish', t => {
  const dir = fixture(t);
  const created = join(dir, 'created.txt');
  const modified = join(dir, 'modified.txt');
  writeFileSync(modified, 'original');
  const tx = beginTransaction(dir, 'known-write');
  commitFile({}, tx, created, 'kit-created');
  commitFile({}, tx, modified, 'kit-modified');
  const result = rollbackTransaction(dir, tx.id);
  assert.equal(result.complete, true);
  assert.equal(existsSync(created), false);
  assert.equal(readFileSync(modified, 'utf8'), 'original');
});

test('finish is idempotent and backups are private', { skip: process.platform === 'win32' }, t => {
  const backupDir = fixture(t);
  const file = join(backupDir, 'f.txt'); writeFileSync(file, 'x\n', { mode: 0o644 });
  const tx = beginTransaction(backupDir, 'perm');
  tx.touch(file); writeFileSync(file, 'y\n');
  assert.equal(tx.finish(), tx.finish());
  assert.equal(statSync(join(backupDir, `tx-${tx.id}`, '000-f.txt')).mode & 0o077, 0);
  assert.equal(statSync(join(backupDir, `tx-${tx.id}.manifest.json`)).mode & 0o077, 0);
});
