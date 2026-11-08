// Seam 3/6 (ticket 29, ADR-0009 correction 2, spec §7 "CDN cache, disk"):
// the CDN disk directory stays at or below 256 MiB (oldest first), the age
// prune removes only entries already expired at max(14 days, configured TTL),
// pruning runs when a cache starts and after each write, and it skips temp
// files and files being written and tolerates files that vanish, because the
// directory can be shared by several installations and solver processes.
// Everything runs in temp directories on an injected clock.
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CaptchaCdnCache } from "./captcha-cdn-cache.js";

const MiB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = 1_800_000_000_000;

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-cdn-prune-")); dirs.push(dir); return dir; }
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const nameOf = (url: string) => sha(url);
const urlOf = (i: number) => `https://g.alicdn.com/captcha-frontend/dynamicJS/1.0.${i}/pe.${i}.js`;
const bodyOf = (i: number, size = 64) => { const b = Buffer.alloc(size, (i % 250) + 1); b.write(`/*${i}*/`); return b; };

/** An envelope as any installation of the kit writes it (header line + body). */
function envelope(dir: string, url: string, fetchedAt: number, body: Buffer) {
  const header = Buffer.from(JSON.stringify({ version: 1, fetchedAt, length: body.length, sha256: sha(body) }) + "\n");
  fs.writeFileSync(path.join(dir, nameOf(url)), Buffer.concat([header, body]));
}

/** A large envelope without writing its bytes (sparse where the filesystem allows): only its size matters here. */
function largeEnvelope(dir: string, url: string, fetchedAt: number, length: number) {
  const header = Buffer.from(JSON.stringify({ version: 1, fetchedAt, length, sha256: "0".repeat(64) }) + "\n");
  const file = path.join(dir, nameOf(url));
  fs.writeFileSync(file, header);
  fs.truncateSync(file, header.length + length);
}

/** A raw body under an entry name, as kits up to v0.2.31 wrote it in place, last modified at `mtime`. */
function legacy(dir: string, name: string, size: number, mtime: number) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "");
  fs.truncateSync(file, size);
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
}

const listing = (dir: string) => fs.readdirSync(dir).sort();
const totalBytes = (dir: string) => listing(dir).reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);

describe("CDN disk size bound (256 MiB, oldest first)", () => {
  it("prunes the oldest entries at start until the directory is at or below 256 MiB", () => {
    const dir = directory();
    // 5 × 60 MiB, all fresh under the default 24 h TTL, fetched 5, 4, 3, 2 and 1 hours ago.
    for (let i = 0; i < 5; i++) largeEnvelope(dir, urlOf(i), T0 - (5 - i) * HOUR, 60 * MiB);
    expect(totalBytes(dir)).toBeGreaterThan(256 * MiB);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    expect(listing(dir)).toEqual([1, 2, 3, 4].map((i) => nameOf(urlOf(i))).sort());
    expect(totalBytes(dir)).toBeLessThanOrEqual(256 * MiB);
  });

  it("prunes after a write that takes the directory above 256 MiB, keeping the entry just written", () => {
    const dir = directory();
    for (let i = 0; i < 4; i++) largeEnvelope(dir, urlOf(i), T0 - (4 - i) * HOUR, 60 * MiB);
    let t = T0;
    const cache = new CaptchaCdnCache({ directory: dir, now: () => t });
    expect(listing(dir).length).toBe(4); // 240 MiB: nothing to prune at start
    t += 1_000;
    const body = bodyOf(9, 17 * MiB);
    cache.put(urlOf(9), body);
    expect(listing(dir)).toEqual([1, 2, 3, 9].map((i) => nameOf(urlOf(i))).sort());
    expect(totalBytes(dir)).toBeLessThanOrEqual(256 * MiB);
    // The entry just written is still served from disk with its bytes and retrieval time.
    const fromDisk = new CaptchaCdnCache({ directory: dir, now: () => t }).get(urlOf(9));
    expect(fromDisk?.source).toBe("disk");
    expect(fromDisk?.fetchedAt).toBe(T0 + 1_000);
    expect(fromDisk?.body.equals(body)).toBe(true);
  });
});

describe("CDN disk age prune (only entries expired at max(14 days, configured TTL))", () => {
  it("keeps an entry 15 days old under a 20-day TTL and prunes one 21 days old (Round 2 Q3 condition 2)", () => {
    const dir = directory();
    envelope(dir, urlOf(15), T0 - 15 * DAY, bodyOf(15));
    envelope(dir, urlOf(21), T0 - 21 * DAY, bodyOf(21));
    const cache = new CaptchaCdnCache({ directory: dir, ttlMs: 20 * DAY, now: () => T0 });
    expect(listing(dir)).toEqual([nameOf(urlOf(15))]);
    const kept = cache.get(urlOf(15));
    expect(kept?.source).toBe("disk");
    expect(kept?.fetchedAt).toBe(T0 - 15 * DAY);
    expect(kept?.body.equals(bodyOf(15))).toBe(true);
  });

  it("keeps entries expired under a short TTL until they are 14 days old", () => {
    const dir = directory();
    envelope(dir, urlOf(1), T0 - 2 * DAY, bodyOf(1)); // expired under the default 24 h TTL
    envelope(dir, urlOf(2), T0 - 14 * DAY + 1, bodyOf(2));
    envelope(dir, urlOf(3), T0 - 14 * DAY, bodyOf(3));
    envelope(dir, urlOf(4), T0 - 30 * DAY, bodyOf(4));
    envelope(dir, urlOf(5), T0 - 5 * 60 * 1000, bodyOf(5));
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    expect(listing(dir)).toEqual([1, 2, 5].map((i) => nameOf(urlOf(i))).sort());
  });

  it("prunes an entry that expires while the cache runs at the next write", () => {
    const dir = directory();
    let t = T0;
    const cache = new CaptchaCdnCache({ directory: dir, ttlMs: 20 * DAY, now: () => t });
    cache.put(urlOf(1), bodyOf(1));
    t += 20 * DAY - 1;
    cache.put(urlOf(2), bodyOf(2));
    expect(listing(dir)).toEqual([1, 2].map((i) => nameOf(urlOf(i))).sort());
    t += 1;
    cache.put(urlOf(3), bodyOf(3));
    expect(listing(dir)).toEqual([2, 3].map((i) => nameOf(urlOf(i))).sort());
  });

  it("sees entries other installations wrote at a write a minute after its last scan", () => {
    const dir = directory();
    let t = T0;
    const cache = new CaptchaCdnCache({ directory: dir, now: () => t });
    for (let i = 0; i < 5; i++) largeEnvelope(dir, urlOf(i), T0 - (5 - i) * HOUR, 60 * MiB);
    t += 60_000;
    cache.put(urlOf(9), bodyOf(9));
    expect(totalBytes(dir)).toBeLessThanOrEqual(256 * MiB);
    expect(listing(dir)).not.toContain(nameOf(urlOf(0)));
    expect(listing(dir)).toContain(nameOf(urlOf(9)));
  });

  it("leaves the directory alone when the TTL is 0 (both tiers disabled)", () => {
    const dir = directory();
    envelope(dir, urlOf(4), T0 - 30 * DAY, bodyOf(4));
    for (let i = 0; i < 5; i++) largeEnvelope(dir, urlOf(10 + i), T0 - HOUR, 60 * MiB);
    const before = listing(dir);
    new CaptchaCdnCache({ directory: dir, ttlMs: 0, now: () => T0 }).put(urlOf(9), bodyOf(9));
    expect(listing(dir)).toEqual(before);
  });
});

describe("CDN disk prune skips temp files and files being written", () => {
  it("never touches temp files, foreign names, directories or links, however old and however full the directory", () => {
    const dir = directory();
    for (let i = 0; i < 5; i++) largeEnvelope(dir, urlOf(i), T0 - 30 * DAY + i, 60 * MiB);
    const hash = nameOf(urlOf(7));
    const skipped = [
      `${hash}.4242.${crypto.randomUUID()}.tmp`, // another process's publication in progress
      `${hash}.crashed.tmp`,
      "README",
      `${hash.slice(0, 63)}`,
      `${hash}x`,
      hash.toUpperCase(),
    ];
    for (const name of skipped) legacy(dir, name, 70 * MiB, T0 - 40 * DAY);
    fs.mkdirSync(path.join(dir, nameOf(urlOf(8))));
    let link: string | undefined;
    try {
      fs.symlinkSync(path.join(dir, "README"), path.join(dir, nameOf(urlOf(6))));
      link = nameOf(urlOf(6));
    } catch {} // Windows runners without the symlink privilege
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    const expected = [...skipped, nameOf(urlOf(8)), ...(link ? [link] : [])];
    expect(listing(dir)).toEqual(expected.sort());
    for (const name of skipped) expect(fs.statSync(path.join(dir, name)).size).toBe(70 * MiB);
  });

  it("does not delete a legacy raw file modified within the last minute (a kit up to v0.2.31 may be writing it in place), but counts its bytes", () => {
    const dir = directory();
    for (let i = 0; i < 3; i++) largeEnvelope(dir, urlOf(i), T0 - (3 - i) * HOUR, 60 * MiB);
    const writing = nameOf(urlOf(9));
    legacy(dir, writing, 100 * MiB, T0 - 59_000);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    // 280 MiB: the oldest envelope goes, the file being written stays.
    expect(listing(dir)).toEqual([nameOf(urlOf(1)), nameOf(urlOf(2)), writing].sort());
    expect(totalBytes(dir)).toBeLessThanOrEqual(256 * MiB);
  });

  it("does not delete a legacy file with a modification time ahead of the clock", () => {
    const dir = directory();
    const ahead = nameOf(urlOf(9));
    legacy(dir, ahead, 300 * MiB, T0 + DAY);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    expect(listing(dir)).toEqual([ahead]);
  });

  it("prunes legacy raw files (sha256 and the older sha1 names) by their modification time, and evicts them first by age", () => {
    const dir = directory();
    const sha1 = crypto.createHash("sha1").update(urlOf(1)).digest("hex");
    legacy(dir, sha1, 1_000, T0 - 15 * DAY);
    legacy(dir, nameOf(urlOf(2)), 1_000, T0 - 14 * DAY);
    legacy(dir, nameOf(urlOf(3)), 1_000, T0 - 13 * DAY); // kept: not expired at 14 days
    legacy(dir, crypto.createHash("sha1").update(urlOf(4)).digest("hex"), 1_000, T0 - 10 * DAY);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    expect(listing(dir)).toEqual([nameOf(urlOf(3)), crypto.createHash("sha1").update(urlOf(4)).digest("hex")].sort());
    // By age in the size prune: a 10-day-old legacy file goes before an envelope fetched an hour ago.
    for (let i = 10; i < 15; i++) largeEnvelope(dir, urlOf(i), T0 - HOUR, 52 * MiB);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    expect(listing(dir)).toEqual([11, 12, 13, 14].map((i) => nameOf(urlOf(i))).sort());
  });
});

describe("CDN disk prune with several installations sharing the directory", () => {
  it("does not delete an entry another installation published after the scan saw the old one", () => {
    const dir = directory();
    let t = T0;
    for (let i = 0; i < 5; i++) largeEnvelope(dir, urlOf(i), T0 - (5 - i) * HOUR, 60 * MiB);
    const victim = path.join(dir, nameOf(urlOf(0)));
    const fresh = bodyOf(0);
    const open = fs.openSync.bind(fs);
    let examined = false;
    let replaced = false;
    // Another installation renames a fresh envelope over the oldest entry
    // while this one is still examining the directory.
    const hook = spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file) === victim) examined = true;
      else if (examined && !replaced && path.dirname(String(file)) === dir) {
        replaced = true;
        const header = Buffer.from(JSON.stringify({ version: 1, fetchedAt: T0, length: fresh.length, sha256: sha(fresh) }) + "\n");
        fs.writeFileSync(victim + ".other.tmp", Buffer.concat([header, fresh]));
        fs.renameSync(victim + ".other.tmp", victim);
      }
      return (open as (...args: unknown[]) => number)(file, ...rest);
    }) as typeof fs.openSync);
    try { new CaptchaCdnCache({ directory: dir, now: () => t }); } finally { hook.mockRestore(); }
    expect(replaced).toBe(true);
    const served = new CaptchaCdnCache({ directory: dir, now: () => t }).get(urlOf(0));
    expect(served?.source).toBe("disk");
    expect(served?.body.equals(fresh)).toBe(true);
    // Counted at its new size, so no other entry is removed in its place.
    expect(listing(dir)).toEqual([0, 1, 2, 3, 4].map((i) => nameOf(urlOf(i))).sort());
    expect(totalBytes(dir)).toBeLessThanOrEqual(256 * MiB);
  });

  it("never throws when entries vanish at any step of a prune", () => {
    const fns = ["readdirSync", "lstatSync", "statSync", "openSync", "readSync", "fstatSync", "unlinkSync", "readFileSync"] as const;
    // Count the filesystem calls one prune makes, then rerun it once per call
    // with every entry deleted just before that call (another pruner won the race).
    const run = (vanishAt: number) => {
      const dir = directory();
      for (let i = 0; i < 4; i++) largeEnvelope(dir, urlOf(i), T0 - (40 - i) * DAY, 100 * MiB);
      legacy(dir, nameOf(urlOf(9)), 100 * MiB, T0 - 40 * DAY);
      let calls = 0;
      const spies = fns.map((fn) => {
        const real = (fs[fn] as (...args: unknown[]) => unknown).bind(fs);
        return spyOn(fs, fn).mockImplementation(((...args: unknown[]) => {
          if (calls++ === vanishAt) for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
          return real(...args);
        }) as never);
      });
      let cache: CaptchaCdnCache | undefined;
      try {
        cache = new CaptchaCdnCache({ directory: dir, now: () => T0 });
        cache.put(urlOf(20), bodyOf(20));
      } finally { for (const spy of spies) spy.mockRestore(); }
      expect(cache.get(urlOf(20))?.body.equals(bodyOf(20))).toBe(true);
      for (const name of listing(dir)) expect(name).toMatch(/^[0-9a-f]{64}$/);
      return calls;
    };
    const total = run(-1);
    expect(total).toBeGreaterThan(5);
    for (let k = 0; k < total; k++) run(k);
  });

  it("concurrent caches, pruners, deleters and slow writers in separate processes never throw, lose a file being written or serve corrupt bytes", async () => {
    const dir = directory();
    const sharer = path.join(import.meta.dir, "__fixtures__", "cdn-disk-sharer.ts");
    const roles = ["cache", "cache", "cache", "pruner", "deleter", "temp", "legacy"];
    const children = roles.map((role, id) => Bun.spawn([process.execPath, sharer, role, dir, String(id), "1500"], { stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(children.map(async (child) => ({
      code: await child.exited,
      out: await new Response(child.stdout).text(),
      err: await new Response(child.stderr).text(),
    })));
    for (const r of results) expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: "" });
    const reports = results.map((r) => JSON.parse(r.out));
    console.log(`sharers: ${reports.map((r) => `${r.role}#${r.id} ${JSON.stringify(r.counts)}`).join("; ")}`);
    // The workload exercised what it must: writes, disk reads, publications through temp files, in-place writes.
    const sum = (key: string) => reports.reduce((n, r) => n + (r.counts[key] ?? 0), 0);
    expect(sum("put")).toBeGreaterThan(10);
    expect(sum("hit:disk")).toBeGreaterThan(0);
    expect(sum("published")).toBeGreaterThan(0);
    expect(sum("written")).toBeGreaterThan(0);
    // What is left is intact: complete envelopes whose bytes match their URL, and the legacy files.
    const byName = new Map(Array.from({ length: 24 }, (_, i) => [nameOf(urlOf(i)), i]));
    for (const name of listing(dir)) {
      expect(name).toMatch(/^[0-9a-f]{64}$/);
      const bytes = fs.readFileSync(path.join(dir, name));
      const i = byName.get(name);
      if (i === undefined) { expect(bytes.every((b) => b === 120)).toBe(true); continue; }
      const end = bytes.indexOf(10);
      const header = JSON.parse(bytes.subarray(0, end).toString("utf8"));
      const body = bytes.subarray(end + 1);
      expect(header.length).toBe(body.length);
      expect(header.sha256).toBe(sha(body));
      expect(body.subarray(0, 64).toString("latin1").startsWith(`/*url ${i} `)).toBe(true);
    }
  }, 30_000);
});

describe("CDN disk retention-pruning migration (ADR-0012 condition 4)", () => {
  /** Names, sizes, modification times and content hashes: the whole directory. */
  const snapshot = (dir: string) => listing(dir).map((name) => {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return [name, "dir"];
    // Large entries are sparse here: their first bytes carry the header.
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    return [name, stat.size, stat.mtimeMs, sha(head)];
  });

  it("replayed twice on a directory left by older kits, the second run is a no-op", () => {
    const dir = directory();
    // What a directory shared with earlier kits can hold.
    envelope(dir, urlOf(1), T0 - 30 * DAY, bodyOf(1)); // expired at 14 days
    envelope(dir, urlOf(2), T0 - 13 * DAY, bodyOf(2)); // expired under 24 h, kept until 14 days
    envelope(dir, urlOf(3), T0 - HOUR, bodyOf(3)); // fresh
    for (let i = 10; i < 16; i++) largeEnvelope(dir, urlOf(i), T0 - (16 - i) * HOUR, 50 * MiB); // 300 MiB, fresh
    legacy(dir, nameOf(urlOf(4)), 5_000, T0 - 20 * DAY); // raw body, kits up to v0.2.31
    legacy(dir, nameOf(urlOf(5)), 5_000, T0 - 2 * DAY);
    legacy(dir, crypto.createHash("sha1").update(urlOf(6)).digest("hex"), 5_000, T0 - 90 * DAY);
    const temp = `${nameOf(urlOf(7))}.999.${crypto.randomUUID()}.tmp`;
    legacy(dir, temp, 5_000, T0 - 90 * DAY);
    legacy(dir, "notes.txt", 5_000, T0 - 90 * DAY);
    const initial = snapshot(dir);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    const once = snapshot(dir);
    expect(once.length).toBeLessThan(initial.length);
    expect(totalBytes(dir)).toBeLessThanOrEqual(256 * MiB + 2 * 5_000);
    new CaptchaCdnCache({ directory: dir, now: () => T0 });
    expect(snapshot(dir)).toEqual(once);
    // Kept: the newest entries up to 256 MiB (the 13-day envelope and the
    // 2-day legacy file are older than the large ones, so they go first),
    // temp and foreign files.
    expect(listing(dir)).toEqual([
      nameOf(urlOf(3)),
      ...[11, 12, 13, 14, 15].map((i) => nameOf(urlOf(i))),
      temp,
      "notes.txt",
    ].sort());
  });
});
