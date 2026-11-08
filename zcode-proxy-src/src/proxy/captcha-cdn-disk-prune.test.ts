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
