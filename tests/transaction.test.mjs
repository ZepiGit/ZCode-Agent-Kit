// Transaction module proofs (audit §7: backup/rollback) and the scoped
// disabledProviders edit (audit §7 regression: global regex removed `- zcode`
// from ANY list).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { beginTransaction, rollbackTransaction, listTransactions, acquireLock, releaseLock } from "../lib/transaction.mjs";
import { removeFromDisabledProviders } from "../lib/config-edit.mjs";

const TMP = join(import.meta.dirname, "fakehome", "tx");

function freshDir(name) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("rollback restores a modified file byte-identically", () => {
  const backupDir = freshDir("restore");
  const file = join(backupDir, "target.yml");
  writeFileSync(file, "original: true\n");
  const tx = beginTransaction(backupDir, "test");
  tx.touch(file);
  writeFileSync(file, "modified: by-kit\nmore: lines\n");
  const id = tx.finish();
  assert.ok(id, "transaction recorded");
  const r = rollbackTransaction(backupDir, id);
  assert.deepEqual(r.conflicts, []);
  assert.equal(readFileSync(file, "utf8"), "original: true\n");
});

test("rollback refuses to clobber later user changes (three-way conflict)", () => {
  const backupDir = freshDir("conflict");
  const file = join(backupDir, "target.yml");
  writeFileSync(file, "original: true\n");
  const tx = beginTransaction(backupDir, "test");
  tx.touch(file);
  writeFileSync(file, "modified: by-kit\n");
  const id = tx.finish();
  writeFileSync(file, "user-changed: after-the-kit\n"); // later user edit
  const r = rollbackTransaction(backupDir, id);
  assert.equal(r.conflicts.length, 1, "conflict reported");
  assert.equal(readFileSync(file, "utf8"), "user-changed: after-the-kit\n", "user change preserved");
});

test("kit-created files are deleted on rollback, but only when unmodified", () => {
  const backupDir = freshDir("create");
  const file = join(backupDir, "new-file.json");
  const tx = beginTransaction(backupDir, "test");
  tx.touch(file);
  writeFileSync(file, "{}\n");
  const id = tx.finish();
  const r = rollbackTransaction(backupDir, id);
  assert.deepEqual(r.removed, [file]);
  assert.equal(existsSync(file), false);
});

test("modified kit-created file is a rollback conflict, not deleted", () => {
  const backupDir = freshDir("create-mod");
  const file = join(backupDir, "new-file.json");
  const tx = beginTransaction(backupDir, "test");
  tx.touch(file);
  writeFileSync(file, "{}\n");
  const id = tx.finish();
  writeFileSync(file, "{ edited: true }\n");
  const r = rollbackTransaction(backupDir, id);
  assert.equal(r.conflicts.length, 1);
  assert.equal(existsSync(file), true, "user-edited file kept");
});

test("backup names never collide across transactions with the same basename", () => {
  const backupDir = freshDir("collide");
  const dirA = freshDir("collide-a");
  const dirB = freshDir("collide-b");
  const a = join(dirA, "config.yml");
  const b = join(dirB, "config.yml");
  writeFileSync(a, "a\n");
  writeFileSync(b, "b\n");
  const tx1 = beginTransaction(backupDir, "one");
  tx1.touch(a);
  writeFileSync(a, "a2\n");
  tx1.finish();
  const tx2 = beginTransaction(backupDir, "two");
  tx2.touch(b);
  writeFileSync(b, "b2\n");
  tx2.finish();
  assert.equal(listTransactions(backupDir).length, 2);
  assert.equal(rollbackTransaction(backupDir).restored.length >= 1, true);
});

test("a deleted-after-transaction target is restored from backup", () => {
  const backupDir = freshDir("deleted");
  const file = join(backupDir, "target.yml");
  writeFileSync(file, "keep: me\n");
  const tx = beginTransaction(backupDir, "test");
  tx.touch(file);
  writeFileSync(file, "changed\n");
  const id = tx.finish();
  rmSync(file);
  const r = rollbackTransaction(backupDir, id);
  assert.equal(readFileSync(file, "utf8"), "keep: me\n");
});

// AUD-004: the write-ahead journal makes a crash between rename and finish()
// discoverable — the in-progress transaction restores the recorded pre-state.
test("crash after rename is recoverable from the in-progress journal", () => {
  const backupDir = freshDir("journal");
  const tx = beginTransaction(backupDir, "journal test");
  const target = join(backupDir, "target.yml");
  writeFileSync(target, "original\n");
  tx.touch(target);
  // simulate the crash: target mutated mid-flight, finish() never ran
  writeFileSync(target, "mutated mid-flight\n");
  const r = rollbackTransaction(backupDir, tx.id);
  assert.equal(r.restored.length, 1, "mutation recovered");
  assert.equal(readFileSync(target, "utf8"), "original\n", "original restored");
  assert.equal(existsSync(join(backupDir, `tx-${tx.id}.manifest.in-progress.json`)), false, "journal consumed after recovery");
});

test("untouched in-progress op is a no-op rollback", () => {
  const backupDir = freshDir("journal2");
  const tx = beginTransaction(backupDir, "j2");
  const target = join(backupDir, "t2.yml");
  writeFileSync(target, "stable\n");
  tx.touch(target);
  // crash BEFORE the rename — the file still matches preHash
  const r = rollbackTransaction(backupDir, tx.id);
  assert.equal(r.restored.length, 0, "nothing to recover");
  assert.equal(readFileSync(target, "utf8"), "stable\n");
  assert.equal(existsSync(join(backupDir, `tx-${tx.id}.manifest.in-progress.json`)), false);
});

// AUD-001: no automatic stale takeover — the unconditional unlink after a
// stale observation lets two contenders delete each other's fresh locks
// (lost mutual exclusion). Live holders block; stale locks must be removed
// manually.
test("parallel setups are locked out; stale locks are refused fail-closed", () => {
  const backupDir = freshDir("lock");
  const lock = acquireLock(backupDir);
  assert.throws(() => acquireLock(backupDir), /another setup is running/);
  releaseLock(lock);
  acquireLock(backupDir); // free again
  releaseLock(lock);
  // stale lock with a dead holder pid — no auto-takeover, clear refusal
  writeFileSync(join(backupDir, ".setup-lock"), JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));
  assert.throws(() => acquireLock(backupDir), /stale.* refusing automatic takeover/s, "dead holder is not taken over");
  // unreadable lock — same fail-closed path
  writeFileSync(join(backupDir, ".setup-lock"), "not-json");
  assert.throws(() => acquireLock(backupDir), /stale or unreadable/);
  // manual removal re-enables acquisition
  unlinkSync(join(backupDir, ".setup-lock"));
  const lock2 = acquireLock(backupDir);
  releaseLock(lock2);
});

// Audit backlog: EPERM from process.kill(pid, 0) means "exists, not ours to
// signal" — the holder must count as ALIVE (fail-closed), not dead.
test("pidAlive treats EPERM as alive (fail-closed lock decision)", () => {
  const backupDir = freshDir("lock-eperm");
  const origKill = process.kill;
  process.kill = ((pid, signal) => {
    const err = new Error("access denied");
    err.code = "EPERM";
    throw err;
  });
  try {
    writeFileSync(join(backupDir, ".setup-lock"), JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));
    // EPERM holder is treated as live → "another setup is running", NOT the
    // stale-refusal path (which would imply a dead holder). The regex match
    // itself proves the fail-closed branch was taken.
    assert.throws(() => acquireLock(backupDir), (err) => {
      assert.match(err.message, /another setup is running/);
      assert.doesNotMatch(err.message, /stale/);
      return true;
    });
  } finally {
    process.kill = origKill;
  }
});

// ZAK-007: a live holder must never be displaced by lock age, and a released
// lock must never delete a successor's lock.
test("lock is nonce-owned: live holders keep it, release never deletes a successor's lock", () => {
  const backupDir = freshDir("lock-nonce");
  const lock = acquireLock(backupDir);

  // artificially age the lock far beyond the old TTL — the holder pid is THIS
  // live process, so takeover must still be refused
  const old = new Date(Date.now() - 60 * 60_000);
  const holder = JSON.parse(readFileSync(lock, "utf8"));
  assert.ok(holder.nonce, "lock record carries a nonce");
  utimesSync(lock, old, old);
  assert.throws(() => acquireLock(backupDir), /another setup is running/, "aged lock of a live holder is not stolen");

  // simulate a successor stealing the file (crash-recovery by hand), then let
  // the ORIGINAL holder release: the successor's lock must survive untouched
  const successorNonce = "successor-nonce-42";
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce: successorNonce }));
  releaseLock(lock);
  const after = JSON.parse(readFileSync(lock, "utf8"));
  assert.equal(after.nonce, successorNonce, "successor lock not deleted by former holder");

  // a lock we never acquired in this process is not touched by releaseLock
  releaseLock(join(backupDir, ".setup-lock"));
  assert.equal(existsSync(join(backupDir, ".setup-lock")), true, "unknown lock left alone");
  // cleanup for the successor lock
  unlinkSync(join(backupDir, ".setup-lock"));
});

// ------------------------------------------------------------ config-edit
test("removeFromDisabledProviders only touches disabledProviders (regression)", () => {
  const yaml = [
    "disabledProviders:",
    "  - zcode",
    "  - zai",
    "allowTools:",
    "  - zcode",
    "  - bash",
    "# comment between keys",
    "trustedTools:",
    "  - zcode",
    "",
  ].join("\n");
  const { text, removed } = removeFromDisabledProviders(yaml, "zcode");
  assert.equal(removed, 1);
  assert.match(text, /allowTools:\n  - zcode\n  - bash/);
  assert.match(text, /trustedTools:\n  - zcode/);
  assert.match(text, /disabledProviders:\n  - zai/);
  assert.doesNotMatch(text, /disabledProviders:\n  - zcode/);
});

test("removeFromDisabledProviders handles comments, whitespace and nested maps", () => {
  const yaml = [
    "disabledProviders:",
    "  # stale builtin entry",
    "  - zcode   # hidden the custom provider",
    "nested:",
    "  inner:",
    "    - zcode",
    "",
  ].join("\n");
  const { text, removed } = removeFromDisabledProviders(yaml, "zcode");
  assert.equal(removed, 1);
  assert.match(text, /nested:\n  inner:\n    - zcode/, "nested list entry must survive");
  assert.match(text, /# stale builtin entry/, "comments inside the list survive");
});

test("removeFromDisabledProviders is a no-op when the entry is absent", () => {
  const yaml = "providers:\n  - zai\n";
  const { text, removed } = removeFromDisabledProviders(yaml, "zcode");
  assert.equal(removed, 0);
  assert.equal(text, yaml);
});
