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
