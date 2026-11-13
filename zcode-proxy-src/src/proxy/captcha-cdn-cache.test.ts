import { afterEach, describe, expect, it, spyOn } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CaptchaCdnCache, DEFAULT_CDN_TTL_MS, MAX_CDN_TTL_MS, parseCdnTtl } from "./captcha-cdn-cache.js";

const URL = "https://g.alicdn.com/AliyunCaptcha.js";
const BODY = Buffer.from("var cached = 1;");
const dirs: string[] = [];
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-cache-test-")); dirs.push(dir); return dir; }
function target(dir: string) { return path.join(dir, crypto.createHash("sha256").update(URL).digest("hex")); }
function deferred() {
  let resolve!: (body: Buffer) => void;
  const promise = new Promise<Buffer>((r) => { resolve = r; });
  return { promise, resolve };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("CDN TTL and isolated disk envelopes", () => {
  it("validates explicit bounds without coercing invalid configuration", () => {
    expect(parseCdnTtl("0")).toBe(0);
    expect(parseCdnTtl(MAX_CDN_TTL_MS)).toBe(MAX_CDN_TTL_MS);
    for (const bad of [-1, 0.5, NaN, Infinity, MAX_CDN_TTL_MS + 1, "", " ", "-1", "1.5", "1e3", "0x10", " 1", "1ms", null, true]) {
      expect(() => parseCdnTtl(bad)).toThrow(RangeError);
    }
    const before = process.env.CAPTCHA_CDN_CACHE_TTL_MS;
    try {
      delete process.env.CAPTCHA_CDN_CACHE_TTL_MS;
      expect(parseCdnTtl()).toBe(DEFAULT_CDN_TTL_MS);
      process.env.CAPTCHA_CDN_CACHE_TTL_MS = "17";
      expect(new CaptchaCdnCache({ directory: directory() }).ttlMs).toBe(17);
      process.env.CAPTCHA_CDN_CACHE_TTL_MS = "invalid";
      expect(() => new CaptchaCdnCache({ directory: directory() })).toThrow(RangeError);
      expect(new CaptchaCdnCache({ directory: directory(), ttlMs: 0 }).ttlMs).toBe(0);
    } finally { if (before === undefined) delete process.env.CAPTCHA_CDN_CACHE_TTL_MS; else process.env.CAPTCHA_CDN_CACHE_TTL_MS = before; }
  });

  it("expires memory and promoted disk bytes at the original retrieval boundary", () => {
    let now = 1_000;
    const dir = directory();
    const first = new CaptchaCdnCache({ directory: dir, ttlMs: 100, now: () => now });
    first.put(URL, BODY);
    now = 1_099;
    const promoted = new CaptchaCdnCache({ directory: dir, ttlMs: 100, now: () => now });
    expect(promoted.get(URL)).toMatchObject({ body: BODY, fetchedAt: 1_000, source: "disk" });
    expect(promoted.get(URL)?.source).toBe("memory");
    now = 1_100;
    expect(first.get(URL)).toBeNull();
    expect(promoted.get(URL)).toBeNull();
    expect(new CaptchaCdnCache({ directory: dir, ttlMs: 100, now: () => now }).get(URL)).toBeNull();
  });

  it("zero bypasses both tiers and does not write fetched bytes", async () => {
    const dir = directory();
    new CaptchaCdnCache({ directory: dir, ttlMs: 100, now: () => 1_000 }).put(URL, BODY);
    const diskBefore = fs.readFileSync(target(dir));
    const cache = new CaptchaCdnCache({ directory: dir, ttlMs: 0, now: () => 1_001 });
    let calls = 0;
    const fetchBody = async () => { calls++; return Buffer.from("var fresh = 2;"); };
    expect(cache.get(URL)).toBeNull();
    await cache.load(URL, fetchBody);
    await cache.load(URL, fetchBody);
    expect(calls).toBe(2);
    expect(cache.get(URL)).toBeNull();
    expect(fs.readFileSync(target(dir))).toEqual(diskBefore);
  });

  it("keeps injected directories isolated and rejects clock rollback", () => {
    const a = new CaptchaCdnCache({ directory: directory(), ttlMs: 100, now: () => 1_000 });
    const b = new CaptchaCdnCache({ directory: directory(), ttlMs: 100, now: () => 1_000 });
    a.put(URL, BODY);
    expect(b.get(URL)).toBeNull();
    expect(new CaptchaCdnCache({ directory: a.directory, ttlMs: 100, now: () => 999 }).get(URL)).toBeNull();
  });

  it("ignores partial, tampered, legacy, and orphan temporary files", () => {
    const dir = directory();
    const options = { directory: dir, ttlMs: 100, now: () => 1_000 };
    new CaptchaCdnCache(options).put(URL, BODY);
    const complete = fs.readFileSync(target(dir));
    for (const broken of [BODY, complete.subarray(0, 10), complete.subarray(0, complete.length - 1), Buffer.concat([complete.subarray(0, complete.length - 1), Buffer.from("!")])]) {
      fs.writeFileSync(target(dir), broken);
      expect(new CaptchaCdnCache(options).get(URL)).toBeNull();
    }
    fs.unlinkSync(target(dir));
    fs.writeFileSync(target(dir) + ".crashed.tmp", complete);
    expect(new CaptchaCdnCache(options).get(URL)).toBeNull();
  });

  it("keeps the old complete entry until atomic publication and cleans failed writes", () => {
    const dir = directory();
    const options = { directory: dir, ttlMs: 100, now: () => 1_000 };
    const cache = new CaptchaCdnCache(options);
    cache.put(URL, BODY);
    const rename = fs.renameSync.bind(fs);
    const replacement = Buffer.from("var cached = 2;");
    let observed: Buffer | undefined;
    const hook = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === target(dir)) observed = new CaptchaCdnCache(options).get(URL)?.body;
      return rename(from, to);
    });
    try { cache.put(URL, replacement); } finally { hook.mockRestore(); }
    expect(observed).toEqual(BODY);
    expect(new CaptchaCdnCache(options).get(URL)?.body).toEqual(replacement);
    const failure = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === target(dir)) throw new Error("simulated publication interruption");
      return rename(from, to);
    });
    try { cache.put(URL, BODY); } finally { failure.mockRestore(); }
    expect(new CaptchaCdnCache(options).get(URL)?.body).toEqual(replacement);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("CDN singleflight publication", () => {
  it("shares misses and clears a rejected flight so another fetch can recover", async () => {
    const cache = new CaptchaCdnCache({ directory: directory(), ttlMs: 100, now: () => 1_000 });
    const gate = deferred();
    let calls = 0;
    const fetchBody = () => { calls++; return gate.promise; };
    const a = cache.load(URL, fetchBody);
    const b = cache.load(URL, fetchBody);
    gate.resolve(BODY);
    expect((await a).body).toEqual(BODY);
    expect((await b).body).toEqual(BODY);
    expect(calls).toBe(1);
    cache.invalidate(URL);
    await expect(cache.load(URL, () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect((await cache.load(URL, async () => BODY)).body).toEqual(BODY);
  });

  it("does not resurrect invalidated bytes when a superseded flight finishes last", async () => {
    const options = { directory: directory(), ttlMs: 100, now: () => 1_000 };
    const cache = new CaptchaCdnCache(options);
    const old = deferred();
    const stale = cache.load(URL, () => old.promise);
    cache.invalidate(URL);
    const fresh = Buffer.from("var fresh = true;");
    await cache.load(URL, async () => fresh);
    old.resolve(BODY);
    expect((await stale).body).toEqual(BODY); // Existing waiters retain their response.
    expect(cache.get(URL)?.body).toEqual(fresh);
    expect(new CaptchaCdnCache(options).get(URL)?.body).toEqual(fresh);
    cache.invalidate(URL);
    expect(new CaptchaCdnCache(options).get(URL)).toBeNull();
  });

  it("does not reread an invalidated disk entry when deletion temporarily fails", () => {
    const options = { directory: directory(), ttlMs: 100, now: () => 1_000 };
    const cache = new CaptchaCdnCache(options);
    cache.put(URL, BODY);
    const unlink = fs.unlinkSync.bind(fs);
    const blocked = spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (String(file) === target(options.directory)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return unlink(file);
    });
    try { cache.invalidate(URL); } finally { blocked.mockRestore(); }
    expect(cache.get(URL)).toBeNull();
    const fresh = Buffer.from("var replacement = true;");
    cache.put(URL, fresh);
    expect(new CaptchaCdnCache(options).get(URL)?.body).toEqual(fresh);
  });

  it("a synchronous completed fetch supersedes an older async flight", async () => {
    const options = { directory: directory(), ttlMs: 100, now: () => 1_000 };
    const cache = new CaptchaCdnCache(options);
    const old = deferred();
    const stale = cache.load(URL, () => old.promise);
    const fresh = Buffer.from("var sync = true;");
    cache.put(URL, fresh);
    old.resolve(BODY);
    await stale;
    expect(new CaptchaCdnCache(options).get(URL)?.body).toEqual(fresh);
  });
});

// The memory tier holds at most
// 256 entries and 32 MiB of bodies, so its memory stays within 64 MB (the
// runtime keeps the memory of evicted bodies for a while on top). Eviction
// changes memory use only: an evicted entry is read back from its disk
// envelope (same bytes, same retrieval time) or, without one, fetched again.
// The disk tier is not bounded here.
// The bound tests run without a disk tier: the bound is a memory property,
// and hundreds of fsync'd envelope writes made them take seconds on Windows
// runners. The read-back tests use a real disk tier with a few entries.
const MiB = 1024 * 1024;
const pe = (i: number) => `https://o.alicdn.com/captcha-frontend/dynamicJS/${i}/pe.js`;
function noDisk() {
  const blocker = path.join(directory(), "not-a-directory");
  fs.writeFileSync(blocker, "file");
  return blocker;
}

describe("CDN memory tier bound", () => {
  it("holds at most 256 entries, the oldest evicted first", () => {
    const cache = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 300; i++) cache.put(pe(i), Buffer.from(`var pe = ${i};`));
    expect(cache.memoryUsage().entries).toBe(256);
    for (let i = 0; i < 44; i++) expect(cache.get(pe(i))).toBeNull();
    for (let i = 44; i < 300; i++) expect(cache.get(pe(i))?.source).toBe("memory");
    expect(cache.memoryUsage().entries).toBe(256);
  });

  it("serves an evicted entry from its disk envelope with the same bytes, sha256 and retrieval time", () => {
    let now = 1_000;
    const cache = new CaptchaCdnCache({ directory: directory(), ttlMs: 100_000, now: () => now, memoryMaxBytes: 24 });
    for (let i = 0; i < 3; i++) cache.put(pe(i), Buffer.from(`var pe = ${i};`)); // 11 bytes each: pe(0) is evicted
    expect(cache.memoryUsage().entries).toBe(2);
    now = 1_050;
    const evicted = cache.get(pe(0));
    expect(evicted).toMatchObject({ body: Buffer.from("var pe = 0;"), fetchedAt: 1_000, source: "disk" });
    expect(evicted?.sha256).toBe(crypto.createHash("sha256").update("var pe = 0;").digest("hex"));
    // The read-back is promoted under the same bound.
    expect(cache.memoryUsage().entries).toBe(2);
    expect(cache.get(pe(0))?.source).toBe("memory");
  });

  it("holds at most 32 MiB of bodies", () => {
    const cache = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 40; i++) cache.put(pe(i), Buffer.alloc(MiB, i));
    const { entries, bytes } = cache.memoryUsage();
    expect(bytes).toBe(32 * MiB);
    expect(entries).toBe(32);
    expect(cache.get(pe(7))).toBeNull();
    // Buffer.equals, not toMatchObject: bun's matcher compares a 1 MiB Buffer element by element (~0.9 s).
    const kept = cache.get(pe(8));
    expect(kept?.source).toBe("memory");
    expect(kept?.body.equals(Buffer.alloc(MiB, 8))).toBe(true);
    expect(cache.get(pe(39))?.source).toBe("memory");
  });

  it("keeps a recently read entry in memory while older ones are evicted", () => {
    const cache = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 256; i++) cache.put(pe(i), Buffer.from(`var pe = ${i};`));
    expect(cache.get(pe(0))?.source).toBe("memory");
    cache.put(pe(256), Buffer.from("var pe = 256;"));
    expect(cache.get(pe(0))?.source).toBe("memory");
    expect(cache.get(pe(1))).toBeNull();
  });

  it("bounds promotion from disk and network loads as well as puts", async () => {
    // Promotion from disk: 8 envelopes of 1 KiB read into a 4 KiB tier.
    const dir = directory();
    const writer = new CaptchaCdnCache({ directory: dir, ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 8; i++) writer.put(pe(i), Buffer.alloc(1024, i));
    const reader = new CaptchaCdnCache({ directory: dir, ttlMs: 100_000, now: () => 1_000, memoryMaxBytes: 4096 });
    for (let i = 0; i < 8; i++) expect(reader.get(pe(i))).toMatchObject({ body: Buffer.alloc(1024, i), source: "disk" });
    expect(reader.memoryUsage()).toEqual({ entries: 4, bytes: 4096 });
    // Network loads at the production bounds: count, then bytes.
    const loader = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 300; i++) await loader.load(pe(i), async () => Buffer.from(`var pe = ${i};`));
    expect(loader.memoryUsage().entries).toBe(256);
    const bulk = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 40; i++) await bulk.load(pe(i), async () => Buffer.alloc(MiB, i));
    expect(bulk.memoryUsage()).toEqual({ entries: 32, bytes: 32 * MiB });
  });

  it("serves a body larger than the whole budget without holding it in memory", async () => {
    const cache = new CaptchaCdnCache({ directory: directory(), ttlMs: 100_000, now: () => 1_000, memoryMaxBytes: 1024 });
    cache.put(pe(1), Buffer.from("var small = 1;"));
    const huge = Buffer.alloc(1024 + 1, 7);
    const loaded = await cache.load(pe(0), async () => huge);
    expect(loaded.body.length).toBe(1024 + 1);
    expect(cache.memoryUsage()).toEqual({ entries: 1, bytes: Buffer.byteLength("var small = 1;") });
    // Its disk envelope still serves the same bytes; promotion is refused again.
    const again = cache.get(pe(0));
    expect(again?.source).toBe("disk");
    expect(again?.sha256).toBe(loaded.sha256);
    expect(cache.memoryUsage().entries).toBe(1);
    expect(cache.get(pe(1))?.source).toBe("memory");
  });

  it("refuses a body above the production budget of 32 MiB", async () => {
    const cache = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    cache.put(pe(1), Buffer.from("var small = 1;"));
    const loaded = await cache.load(pe(0), async () => Buffer.alloc(32 * MiB + 1, 7));
    expect(loaded.body.length).toBe(32 * MiB + 1);
    expect(cache.memoryUsage()).toEqual({ entries: 1, bytes: Buffer.byteLength("var small = 1;") });
  });

  it("stays bounded when the disk tier is unavailable, so an evicted entry is fetched again", async () => {
    const cache = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    for (let i = 0; i < 257; i++) cache.put(pe(i), Buffer.from(`var pe = ${i};`));
    expect(cache.memoryUsage().entries).toBe(256);
    expect(cache.get(pe(0))).toBeNull();
    let fetches = 0;
    const refetched = await cache.load(pe(0), async () => { fetches++; return Buffer.from("var pe = 0;"); });
    expect({ fetches, body: refetched.body.toString(), source: refetched.source }).toEqual({ fetches: 1, body: "var pe = 0;", source: "network" });
  });

  it("invalidation releases the memory an entry held", () => {
    const cache = new CaptchaCdnCache({ directory: noDisk(), ttlMs: 100_000, now: () => 1_000 });
    cache.put(pe(0), Buffer.alloc(1024));
    cache.put(pe(1), Buffer.alloc(2048));
    cache.invalidate(pe(0));
    expect(cache.memoryUsage()).toEqual({ entries: 1, bytes: 2048 });
  });
});
