// Seam 3 (B1, Owner Proxy round 20 Q1): bounding the CDN memory tier changes
// memory only, never which bytes are served or which network fetches happen.
// A recorded sequence of one solver generation's cache calls
// (__fixtures__/cdn-sequence.json: 373 URLs, 106 MiB of bodies, repeat reads
// of evicted URLs, stall invalidations, a TTL expiry on a fake clock) is
// replayed with a temp disk tier against
//   (a) the pre-change cache, captcha-cdn-cache.ts @ 8e11d15 verbatim
//       (__fixtures__/captcha-cdn-cache.8e11d15.ts, unbounded memory tier),
//   (b) the head cache at its production budget (32 MiB),
//   (c) the head cache with a 64 MiB budget.
// All three must make the same fetches (URL, kind, order, count) and return
// the same bytes, sha256 and fetchedAt for every call; only `source` may
// differ. The network is a local fixture: nothing leaves the process.
import { afterEach, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import recording from "./__fixtures__/cdn-sequence.json";
import { CaptchaCdnCache as PreChangeCdnCache } from "./__fixtures__/captcha-cdn-cache.8e11d15.js";
import { CaptchaCdnCache, CDN_MEMORY_MAX_BYTES } from "./captcha-cdn-cache.js";

const MiB = 1024 * 1024;
// git blob id of zcode-proxy-src/src/proxy/captcha-cdn-cache.ts at 8e11d15.
const PRE_CHANGE_BLOB = "1b047f1ca6e8d51deaef67d62cc3740559243798";

type Op = [string, number];
interface Cache {
  get(url: string): { body: Buffer; sha256: string; fetchedAt: number; source: string } | null;
  put(url: string, body: Buffer): { body: Buffer; sha256: string; fetchedAt: number; source: string };
  load(url: string, fetchBody: () => Promise<Buffer>): Promise<{ body: Buffer; sha256: string; fetchedAt: number; source: string }>;
  invalidate(url: string): void;
}
type Make = (directory: string, now: () => number) => Cache;

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

/** The fixture network: a URL's n-th fetch returns version n of its body, so a spurious refetch changes the bytes. */
function body(index: number, version: number): Buffer {
  const b = Buffer.alloc(recording.sizes[index], ((index * 7 + version) % 251) + 1);
  b.write(`/*${index}:${version}*/`);
  return b;
}

async function replay(make: Make, { diskAvailable = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-cdn-replay-"));
  dirs.push(root);
  let directory = path.join(root, "cache");
  if (!diskAvailable) { directory = path.join(root, "not-a-directory"); fs.writeFileSync(directory, "file"); }
  let t = recording.startMs;
  const cache = make(directory, () => t);
  const versions = new Map<number, number>();
  const fetches: string[] = [];
  const results: unknown[] = [];
  const sources: Record<string, number> = {};
  let fetchesAtExpiry = -1;
  const network = (kind: string, index: number) => {
    const v = (versions.get(index) ?? 0) + 1;
    versions.set(index, v);
    fetches.push(`${kind} ${index}`);
    return body(index, v);
  };
  const record = (entry: ReturnType<Cache["get"]>) => {
    if (!entry) { results.push(null); return; }
    sources[entry.source] = (sources[entry.source] ?? 0) + 1;
    results.push({ length: entry.body.length, bytes: sha(entry.body), sha256: entry.sha256, fetchedAt: entry.fetchedAt });
  };
  const viaAsync = (url: string, index: number) => {
    const hit = cache.get(url);
    return hit ? Promise.resolve(hit) : cache.load(url, async () => network("async", index));
  };
  for (const [kind, arg] of recording.ops as Op[]) {
    const url = recording.urls[arg];
    if (kind === "tick") {
      if (arg >= recording.ttlMs) fetchesAtExpiry = fetches.length;
      t += arg;
    } else if (kind === "async") record(await viaAsync(url, arg));
    else if (kind === "pair") for (const e of await Promise.all([viaAsync(url, arg), viaAsync(url, arg)])) record(e);
    else if (kind === "sync") record(cache.get(url) ?? cache.put(url, network("sync", arg)));
    else if (kind === "get") record(cache.get(url));
    else if (kind === "invalidate") cache.invalidate(url);
    else throw new Error(`unknown op ${kind}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { fetches, results, sources, fetchesAfterExpiry: fetches.length - fetchesAtExpiry };
}

const ttlMs = recording.ttlMs;
const preChange: Make = (directory, now) => new PreChangeCdnCache({ directory, ttlMs, now });
const head32: Make = (directory, now) => new CaptchaCdnCache({ directory, ttlMs, now });
const head64: Make = (directory, now) => new CaptchaCdnCache({ directory, ttlMs, now, memoryMaxBytes: 64 * MiB });

describe("CDN memory bound replay (B1, Round 20 Q1)", () => {
  it("replays against the verbatim pre-change cache", () => {
    const text = fs.readFileSync(new URL("./__fixtures__/captcha-cdn-cache.8e11d15.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const blob = crypto.createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
    expect(blob).toBe(PRE_CHANGE_BLOB);
    expect(CDN_MEMORY_MAX_BYTES).toBe(32 * MiB);
    expect(recording.totalBytes).toBeGreaterThan(64 * MiB);
  });

  it("makes the pre-change fetches and returns the pre-change bytes, sha256 and fetchedAt at 32 and at 64 MiB", async () => {
    const a = await replay(preChange);
    const b = await replay(head32);
    const c = await replay(head64);
    // The recording exercises what it must: the TTL expiry refetches, and
    // both budgets evict (an unbounded tier never reads back from disk).
    expect(a.fetchesAfterExpiry).toBeGreaterThan(0);
    expect(a.sources.disk ?? 0).toBe(0);
    expect(c.sources.disk).toBeGreaterThan(0);
    expect(b.sources.disk).toBeGreaterThan(c.sources.disk);
    console.log(`replay (disk available): fetches a=${a.fetches.length} b=${b.fetches.length} c=${c.fetches.length}; ` +
      `served calls ${a.results.length}; sources a=${JSON.stringify(a.sources)} b=${JSON.stringify(b.sources)} c=${JSON.stringify(c.sources)}; ` +
      `fetches after the TTL expiry ${a.fetchesAfterExpiry}`);
    expect(b.fetches).toEqual(a.fetches);
    expect(c.fetches).toEqual(a.fetches);
    expect(b.results).toEqual(a.results);
    expect(c.results).toEqual(a.results);
  }, 120_000);

  it("records the fetch counts with the disk tier unavailable (a recorded number, not a gate)", async () => {
    const a = await replay(preChange, { diskAvailable: false });
    const b = await replay(head32, { diskAvailable: false });
    const c = await replay(head64, { diskAvailable: false });
    console.log(`replay (disk unavailable): fetches a=${a.fetches.length} b=${b.fetches.length} c=${c.fetches.length}`);
    for (const r of [a, b, c]) expect(r.fetches.length).toBeGreaterThan(0);
  }, 120_000);
});
