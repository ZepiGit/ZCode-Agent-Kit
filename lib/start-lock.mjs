// Start lock protocol v1 (spec §4; ADR-0003, ADR-0012). The start lock is the
// on-disk record that a start of the proxy is in progress for this
// installation (`logs/manager.lock`). At most one holder exists at a time.
//
// Record, written atomically (temp file + hard link, so the lock path never
// shows a partial record; "unreadable" can only mean foreign corruption):
//   { pid, startedAt, nonce, v: 1, holderStartMs, holderStartId? }
//   pid, startedAt, nonce  as in protocol v0 (old kits read only pid/startedAt)
//   v                      the protocol version
//   holderStartMs          the holder's process start time, as an upper bound:
//                          the process was created no later than this (its
//                          runtime's time origin)
//   holderStartId          Linux only: `<boot id>:<start ticks>`, exact and
//                          immune to wall-clock steps
// Today's version-less record { pid, startedAt, nonce } is protocol v0.
//
// Takeover (replacing a stale lock) needs proof that the lock is stale:
//   - the holder pid is dead, or
//   - the pid was reused: v1 — the live process's start id differs (Linux), or
//     it started after holderStartMs; v0 — it started after startedAt.
// A live holder's lock, or one whose holder cannot be checked, is never
// touched (AUD-001 stays). An unparsable lock or one of an unknown higher
// version is never deleted; the error gives what/why/next with the exact path.
//
// The judge-then-delete race (ADR-0003 condition 1) is closed by an exclusive
// claim per judged record: `<lock>.claim-<hash of the judged bytes>`, created
// the same atomic way and carrying the claimant's own pid + start time. Only
// the claimant of a record may delete it, and only after re-reading the lock
// and finding the judged bytes unchanged. A record's bytes can leave the lock
// path only through its holder's release (the holder is dead) or through its
// claimant, so between that re-read and the delete nothing else can replace
// it. A claim whose claimant died is itself taken over the same way (a claim
// of the claim), at most MAX_CLAIM_DEPTH deep.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const START_LOCK_VERSION = 1;
const MAX_CLAIM_DEPTH = 4;
const MAX_ROUNDS = 8;
// v1: a live holder started at or before holderStartMs (its time origin); a
// process created later than this cannot be the holder.
const V1_LATER_MS = 100;
// v0: startedAt is the holder's wall clock at write time; the live start time
// on Linux is derived from btime (whole seconds), so allow for its rounding.
const V0_LATER_MS = 2000;
// hard links are unavailable on some filesystems (FAT, some network shares)
const NO_LINK = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL", "EXDEV"]);

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Linux: `<boot id>:<start ticks>` of a process, or null. */
let bootId;
export function linuxStartId(pid) {
  if (process.platform !== "linux" || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (bootId === undefined) bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
    if (!bootId) return null;
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
    return /^\d+$/.test(ticks) ? `${bootId}:${ticks}` : null;
  } catch {
    return null;
  }
}

/**
 * Parse a lock (or claim) file's bytes.
 * { kind: "v0" | "v1", record } | { kind: "unparsable" } | { kind: "unknown-version", version, record }
 */
export function parseStartLock(raw) {
  let record;
  try { record = JSON.parse(raw); } catch { return { kind: "unparsable" }; }
  if (!record || typeof record !== "object" || Array.isArray(record) || !Number.isInteger(record.pid) || record.pid <= 0) return { kind: "unparsable" };
  if (record.v === undefined) return { kind: "v0", record };
  if (!Number.isInteger(record.v) || record.v < 1) return { kind: "unparsable" };
  if (record.v > START_LOCK_VERSION) return { kind: "unknown-version", version: record.v, record };
  if (!Number.isFinite(record.holderStartMs)) return { kind: "unparsable" };
  return { kind: "v1", record };
}

/**
 * The start lock of one installation.
 *   file          the lock path
 *   pidAlive      (pid) → boolean; fails closed (unknown = alive)
 *   processStart  (pid) → { ms: number|null, id: string|null } of the live process
 *   self          { pid, startMs, startId } of this process
 *   step          (name) → void, called at every protocol step (kill injection in tests)
 *   onTakeover    ({ holderPid, reason, version, path }) → void, once per takeover
 * acquire() → { status: "acquired", record, release() }
 *           | { status: "contended", holder, message }
 *           | { status: "unavailable", reason, message }
 */
export function createStartLock({ file, pidAlive, processStart, self, step = () => {}, onTakeover = () => {} }) {
  const dir = dirname(file);
  const base = basename(file);

  function ownRecord() {
    const record = { pid: self.pid, startedAt: new Date().toISOString(), nonce: randomBytes(16).toString("hex"), v: START_LOCK_VERSION, holderStartMs: self.startMs };
    if (self.startId) record.holderStartId = self.startId;
    return record;
  }

  /** Create `path` with `text` atomically and exclusively: "created" | "exists". */
  function createExclusive(path, text, kind) {
    const temp = `${path}.${self.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const fd = openSync(temp, "wx", 0o600);
    try {
      const half = Math.floor(text.length / 2);
      writeSync(fd, text.slice(0, half));
      step(`${kind}:temp-partial`);
      writeSync(fd, text.slice(half));
    } finally {
      closeSync(fd);
    }
    step(`${kind}:temp-written`);
    try {
      linkSync(temp, path);
    } catch (err) {
      try { unlinkSync(temp); } catch {}
      if (err?.code === "EEXIST") return "exists";
      if (!NO_LINK.has(err?.code)) throw err;
      // No hard links on this filesystem: exclusive create, written at once.
      try {
        writeFileSync(path, text, { flag: "wx", mode: 0o600 });
      } catch (fallback) {
        if (fallback?.code === "EEXIST") return "exists";
        throw fallback;
      }
      step(`${kind}:linked`);
      return "created";
    }
    step(`${kind}:linked`);
    try { unlinkSync(temp); } catch {}
    step(`${kind}:temp-removed`);
    return "created";
  }

  /** The file's bytes, re-read briefly while unparsable (an old kit writes in two steps). null = missing. */
  function readStable(path) {
    let raw = null;
    for (let i = 0; i < 3; i++) {
      try { raw = readFileSync(path, "utf8"); } catch (err) { if (err?.code === "ENOENT") return null; throw err; }
      const parsed = parseStartLock(raw);
      if (parsed.kind !== "unparsable") return { raw, ...parsed };
      sleepSync(50);
    }
    return { raw, kind: "unparsable" };
  }

  /** "live" | "dead" | "reused" | "unknown" for a parsed record. */
  function judge({ kind, record }) {
    if (!pidAlive(record.pid)) return "dead";
    const live = processStart(record.pid) ?? { ms: null, id: null };
    if (kind === "v1" && typeof record.holderStartId === "string" && record.holderStartId) {
      if (!live.id) return "unknown";
      return live.id === record.holderStartId ? "live" : "reused";
    }
    if (!Number.isFinite(live.ms)) return "unknown";
    const bound = kind === "v1" ? record.holderStartMs + V1_LATER_MS : Date.parse(record.startedAt ?? "") + V0_LATER_MS;
    if (!Number.isFinite(bound)) return "unknown";
    return live.ms > bound ? "reused" : "live";
  }

  const unreadable = (path) => ({
    status: "unavailable", reason: "unparsable",
    message: `start lock at ${path} is not a readable start lock record, so it was left untouched.\n` +
      `  why: it is not JSON with a holder pid. The kit writes its locks atomically, so this is a foreign or corrupted file, not a start in progress.\n` +
      `  next: if no zcode-kit start or stop is running, inspect ${path}, remove it, and retry.`,
  });
  const newerVersion = (path, version) => ({
    status: "unavailable", reason: "unknown-version",
    message: `start lock at ${path} has protocol version ${version}, newer than this kit understands (${START_LOCK_VERSION}), so it was left untouched.\n` +
      `  why: only a kit that knows a lock's version may judge whether its holder is gone.\n` +
      `  next: let the newer kit's start finish, or update this kit; if no start is running, remove ${path} and retry.`,
  });
  const contended = (record, what = "another manager start is in progress") => ({
    status: "contended", holder: record,
    message: `${what} (pid ${record.pid}, started ${record.startedAt}). If that is wrong (e.g. pid reuse), remove ${file}`,
  });

  /**
   * Delete the record at `target` whose bytes were judged stale, under an
   * exclusive claim. → { status: "removed" | "changed" } or a contended/unavailable result.
   */
  function takeOver(target, judgedRaw, depth) {
    if (depth > MAX_CLAIM_DEPTH) {
      return { status: "unavailable", reason: "claims", message: `start lock at ${file}: too many interrupted takeovers (claims under ${dir}); if no start is running, remove ${file}* and retry.` };
    }
    const claim = `${target}.claim-${digest(judgedRaw)}`;
    const mine = ownRecord();
    const mineText = JSON.stringify(mine);
    for (let attempt = 0; ; attempt++) {
      if (createExclusive(claim, mineText, "claim") === "created") break;
      if (attempt >= 3) return contended({ pid: 0, startedAt: "?" }, "another manager start is taking over the stale start lock");
      const other = readStable(claim);
      if (other === null) continue;
      if (other.kind === "unparsable") return unreadable(claim);
      if (other.kind === "unknown-version") return newerVersion(claim, other.version);
      const verdict = judge(other);
      if (verdict === "live" || verdict === "unknown") return contended(other.record, "another manager start is taking over the stale start lock");
      const sub = takeOver(claim, other.raw, depth + 1);
      if (sub.status !== "removed" && sub.status !== "changed") return sub;
    }
    let result = "changed";
    try {
      let now = null;
      try { now = readFileSync(target, "utf8"); } catch (err) { if (err?.code !== "ENOENT") throw err; }
      if (now === judgedRaw) {
        step("target-rechecked");
        try { unlinkSync(target); } catch (err) { if (err?.code !== "ENOENT") throw err; }
        step("target-removed");
        result = "removed";
      }
    } finally {
      releaseIfOwn(claim, mine.nonce);
      step("claim-released");
    }
    return { status: result };
  }

  function releaseIfOwn(path, nonce) {
    try {
      const holder = JSON.parse(readFileSync(path, "utf8"));
      if (holder?.nonce !== nonce) return; // belongs to a successor — leave it alone
    } catch {
      return;
    }
    step("release-checked");
    try { unlinkSync(path); } catch {}
  }

  /**
   * While holding the lock: remove what interrupted contenders left behind —
   * temp files of dead processes, and claims on records that are gone (a
   * claim only ever guards the bytes in its name, which no longer exist).
   */
  function sweep(ownRaw) {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    const keep = `${base}.claim-${digest(ownRaw)}`;
    for (const name of names) {
      if (!name.startsWith(`${base}.`)) continue;
      const temp = name.match(/\.(\d+)\.[0-9a-f]+\.tmp$/);
      if (temp) {
        if (!pidAlive(Number(temp[1]))) { try { unlinkSync(join(dir, name)); } catch {} }
        continue;
      }
      if (name.startsWith(`${base}.claim-`) && !name.startsWith(keep)) {
        try { unlinkSync(join(dir, name)); } catch {}
      }
    }
  }

  function acquire() {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const mine = ownRecord();
      const mineText = JSON.stringify(mine);
      let created;
      try {
        created = createExclusive(file, mineText, "lock");
      } catch (err) {
        return { status: "unavailable", reason: "io", message: err?.message ?? String(err) };
      }
      if (created === "created") {
        sweep(mineText);
        step("acquired");
        return { status: "acquired", record: mine, release: () => releaseIfOwn(file, mine.nonce) };
      }
      let current;
      try { current = readStable(file); } catch (err) { return { status: "unavailable", reason: "io", message: err?.message ?? String(err) }; }
      if (current === null) continue; // released meanwhile
      if (current.kind === "unparsable") return unreadable(file);
      if (current.kind === "unknown-version") return newerVersion(file, current.version);
      const verdict = judge(current);
      if (verdict === "live" || verdict === "unknown") return contended(current.record);
      step("judged-stale");
      let taken;
      try { taken = takeOver(file, current.raw, 0); } catch (err) { return { status: "unavailable", reason: "io", message: err?.message ?? String(err) }; }
      if (taken.status === "removed") {
        onTakeover({ holderPid: current.record.pid, reason: verdict === "dead" ? "holder dead" : "pid reused", version: current.kind === "v0" ? 0 : 1, path: file });
        continue;
      }
      if (taken.status !== "changed") return taken;
    }
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, "utf8")); } catch {}
    return contended(holder && Number.isInteger(holder.pid) ? holder : { pid: 0, startedAt: "?" });
  }

  return { acquire, file };
}
