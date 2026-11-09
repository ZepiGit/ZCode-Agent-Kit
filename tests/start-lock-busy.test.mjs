// Seam 2, the start lock protocol v1 under Windows' transient fs errors
// (ticket 16 round 4; pre-merge CI run 42535365053, windows-latest Node 26:
// "racer 3: EPERM: operation not permitted, open '…\logs\manager.lock'").
// On Windows, opening, linking or deleting a name that another process is
// deleting (pending delete) or holds open fails with EPERM, EBUSY or EACCES
// instead of ENOENT/EEXIST. The protocol must treat those codes as
// contention: bounded retry, never success, never a reason to delete a lock,
// and never a fall back to a non-atomic write while hard links work.
//
// The fs shim: every path-based fs call of the protocol (open, link, read,
// unlink, write) on the fixture's files goes through a hook, made visible to
// lib/start-lock.mjs's named imports by syncBuiltinESMExports. A clean run
// records the call sequence; then each call is failed with each code, once
// (a transient), as a burst of 3, and (for a live holder's lock) for good.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createStartLock } from "../lib/start-lock.mjs";

const CODES = ["EPERM", "EBUSY", "EACCES"];
const DEAD = 2147483646;
const DEAD_CLAIMANT = 2147483645;
const LIVE = process.ppid;
const SELF = { pid: process.pid, startMs: Math.ceil(performance.timeOrigin), startId: "boot:self" };

// ---------------------------------------------------------------- fs shim
const SHIMMED = ["openSync", "linkSync", "readFileSync", "unlinkSync", "writeFileSync"];
const ORIG = Object.fromEntries(SHIMMED.map((name) => [name, fs[name]]));
let scope = null; // the fixture directory whose files the hook sees
let hook = null;  // (name, paths) → void; may throw
for (const name of SHIMMED) {
  fs[name] = function shimmed(...args) {
    const paths = (name === "linkSync" ? args.slice(0, 2) : args.slice(0, 1)).filter((p) => typeof p === "string");
    if (hook && scope && paths.some((p) => p.startsWith(scope))) hook(name, paths);
    return ORIG[name].apply(this, args);
  };
}
syncBuiltinESMExports();
after(() => { Object.assign(fs, ORIG); syncBuiltinESMExports(); });

const SYSCALL = { openSync: "open", linkSync: "link", readFileSync: "open", unlinkSync: "unlink", writeFileSync: "open" };
function fsError(code, name, paths) {
  const err = new Error(`${code}: injected, ${SYSCALL[name]} '${paths.join("' -> '")}'`);
  return Object.assign(err, { code, syscall: SYSCALL[name], path: paths[0] });
}

// ---------------------------------------------------------------- fixtures
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const record = (pid, extra = {}) => JSON.stringify({ pid, startedAt: "2026-11-09T00:00:00.000Z", nonce: String(pid % 10).repeat(32), v: 1, holderStartMs: 1, ...extra });
const STALE = record(DEAD);
const LIVE_LOCK = record(LIVE, { holderStartId: "boot:live" });

// Each scenario: what is on disk before the acquisition, and what it must end in.
const SCENARIOS = {
  fresh: { takeovers: 0, prep() {} },
  "stale lock": { takeovers: 1, prep(file) { ORIG.writeFileSync(file, STALE); } },
  "stale lock claimed by a dead claimant, a dead contender's temp file": {
    takeovers: 1,
    prep(file) {
      ORIG.writeFileSync(file, STALE);
      ORIG.writeFileSync(`${file}.claim-${digest(STALE)}`, record(DEAD_CLAIMANT));
      ORIG.writeFileSync(`${file}.${DEAD}.abcdef012345.tmp`, "{");
    },
  },
};

function fixture() {
  const dir = fs.mkdtempSync(join(tmpdir(), "kit-start-lock-busy-"));
  fs.mkdirSync(join(dir, "logs"));
  return { dir, file: join(dir, "logs", "manager.lock") };
}
const lockFiles = (dir) => fs.readdirSync(join(dir, "logs")).filter((f) => f.startsWith("manager.lock")).sort();

function lockFor(file, takeovers) {
  return createStartLock({
    file,
    pidAlive: (pid) => pid !== DEAD && pid !== DEAD_CLAIMANT,
    processStart: (pid) => (pid === LIVE ? { ms: 0, id: "boot:live" } : pid === SELF.pid ? { ms: SELF.startMs, id: SELF.startId } : { ms: null, id: null }),
    self: SELF,
    onTakeover: (event) => takeovers.push(event),
    busyMs: 120, // the busy budget (default 2 s), short so the persistent cases stay quick
  });
}

/**
 * One acquisition and release in a fresh fixture with `inject(index, name, paths)`
 * deciding per hooked call whether it fails (a code) or not (null).
 */
function run(prep, inject = () => null) {
  const { dir, file } = fixture();
  try {
    prep(file);
    const calls = [];
    const takeovers = [];
    const lock = lockFor(file, takeovers);
    scope = dir;
    hook = (name, paths) => {
      const index = calls.length;
      calls.push({ name, paths });
      const code = inject(index, name, paths);
      if (code) { calls[index].failed = code; throw fsError(code, name, paths); }
    };
    let result, onDisk = null;
    try {
      result = lock.acquire();
      try { onDisk = ORIG.readFileSync(file, "utf8"); } catch {}
      if (result.status === "acquired") result.release();
    } finally {
      hook = null; scope = null;
    }
    return { result, calls, takeovers, onDisk, left: lockFiles(dir) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Temp names carry a random part; a call is the same call when it matches with that part masked.
// (Each run has its own fixture directory, so only the file names are compared.)
const OWN_TEMP = new RegExp(`\\.${process.pid}\\.[0-9a-f]+\\.tmp$`);
const masked = (call) => call.paths.map((p) => basename(p).replace(OWN_TEMP, ".<self>.<random>.tmp")).join("\0");
const same = (a, b) => a.name === b.name && masked(a) === masked(b);
const show = (call) => `${call.name}(${call.paths.map((p) => p.replace(/^.*[\\/]logs[\\/]/, "")).join(", ")})`;

for (const [scenario, { takeovers, prep }] of Object.entries(SCENARIOS)) {
  test(`start lock, ${scenario}: EPERM/EBUSY/EACCES at any protocol fs call, once or as a burst of 3, is contention: retried, acquired once, no takeover twice, no non-atomic write, nothing left behind`, () => {
    const clean = run(prep);
    assert.equal(clean.result.status, "acquired", `${scenario}: clean run`);
    assert.equal(clean.takeovers.length, takeovers);
    assert.ok(clean.calls.length >= 4, `${scenario}: the shim sees the protocol's calls (${clean.calls.length})`);
    const failures = [];
    for (const [k, target] of clean.calls.entries()) {
      for (const code of CODES) {
        for (const burst of [1, 3]) {
          let left = 0;
          const r = run(prep, (index, name, paths) => {
            const call = { name, paths };
            if (index === k && same(call, target)) { left = burst - 1; return code; }
            if (left > 0 && index > k && same(call, target)) { left -= 1; return code; }
            return null;
          });
          const label = `${code} x${burst} at call ${k} ${show(target)}`;
          const hit = r.calls.some((c) => c.failed);
          if (!hit) { failures.push(`${label}: the injected call was never made`); continue; }
          if (r.result.status !== "acquired") { failures.push(`${label}: ${r.result.status} (${r.result.message})`); continue; }
          let parsed = null;
          try { parsed = JSON.parse(r.onDisk); } catch {}
          if (parsed?.nonce !== r.result.record.nonce) failures.push(`${label}: the lock does not hold this acquisition's record (${JSON.stringify(r.onDisk)})`);
          const direct = r.calls.filter((c) => c.name === "writeFileSync");
          if (direct.length) failures.push(`${label}: non-atomic write while hard links work: ${direct.map(show).join(", ")}`);
          if (r.takeovers.length !== takeovers) failures.push(`${label}: ${r.takeovers.length} takeovers, expected ${takeovers}`);
          if (r.left.length) failures.push(`${label}: left behind ${r.left.join(", ")}`);
        }
      }
    }
    assert.deepEqual(failures, [], `${scenario}: ${failures.length} of ${clean.calls.length * CODES.length * 2} injections broke the protocol`);
  });
}

test("start lock, a live holder's lock: EPERM/EBUSY/EACCES at any protocol fs call, once or for good, is never an acquisition and never deletes the lock", () => {
  const prep = (file) => ORIG.writeFileSync(file, LIVE_LOCK);
  const clean = run(prep);
  assert.equal(clean.result.status, "contended");
  assert.equal(clean.onDisk, LIVE_LOCK);
  const failures = [];
  for (const [k, target] of clean.calls.entries()) {
    for (const code of CODES) {
      for (const persistent of [false, true]) {
        const r = run(prep, (index, name, paths) => ((index === k || (persistent && index > k)) && same({ name, paths }, target) ? code : null));
        const label = `${code} ${persistent ? "for good" : "once"} at call ${k} ${show(target)}`;
        if (r.result.status === "acquired") failures.push(`${label}: acquired over a live holder`);
        if (!["contended", "unavailable"].includes(r.result.status)) failures.push(`${label}: status ${r.result.status}`);
        if (r.onDisk !== LIVE_LOCK) failures.push(`${label}: the live holder's lock was changed or deleted (${JSON.stringify(r.onDisk)})`);
        if (!persistent && r.result.status !== "contended") failures.push(`${label}: a transient gave ${r.result.status} (${r.result.message}), not contention`);
        // A temp file this live process could not remove for good is swept by a later holder once it is dead.
        const left = persistent ? r.left.filter((f) => !/\.\d+\.[0-9a-f]+\.tmp$/.test(f)) : r.left;
        if (left.join() !== "manager.lock") failures.push(`${label}: left behind ${r.left.join(", ")}`);
      }
    }
  }
  assert.deepEqual(failures, [], `${failures.length} injections broke the protocol`);
});

test("start lock, a stale lock: EPERM/EBUSY/EACCES for good at any protocol fs call is never two records, never a partial lock, and is reported, not taken as success", () => {
  const prep = SCENARIOS["stale lock"].prep;
  const clean = run(prep);
  const failures = [];
  for (const [k, target] of clean.calls.entries()) {
    for (const code of CODES) {
      const r = run(prep, (index, name, paths) => (index >= k && same({ name, paths }, target) ? code : null));
      const label = `${code} for good at call ${k} ${show(target)}`;
      let parsed = null;
      try { parsed = r.onDisk === null ? null : JSON.parse(r.onDisk); } catch {}
      if (r.onDisk !== null && !(parsed && Number.isInteger(parsed.pid))) failures.push(`${label}: partial lock ${JSON.stringify(r.onDisk)}`);
      if (r.result.status === "acquired" && parsed?.nonce !== r.result.record.nonce) failures.push(`${label}: acquired, but the lock holds ${JSON.stringify(r.onDisk)}`);
      if (r.result.status !== "acquired" && r.onDisk !== null && r.onDisk !== STALE) failures.push(`${label}: not acquired, yet the lock holds a new record ${JSON.stringify(r.onDisk)}`);
      if (r.result.status === "unavailable" && !r.result.message.includes(code)) failures.push(`${label}: the error does not name ${code}: ${r.result.message}`);
      if (r.takeovers.length > 1) failures.push(`${label}: ${r.takeovers.length} takeovers`);
    }
  }
  assert.deepEqual(failures, [], `${failures.length} injections broke the protocol`);
});
