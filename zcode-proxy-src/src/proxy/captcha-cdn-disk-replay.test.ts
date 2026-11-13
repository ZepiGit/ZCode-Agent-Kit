// Seam 3 (B1): pruning the CDN disk
// directory changes disk use only. For a workload that fits within 256 MiB and
// whose entries are pruned only once expired, every call returns the same
// bytes, sha256 and fetchedAt as today and the network fetches are the same
// (URL, kind, order, count). The memory tier holds ≤ 32 MiB of bodies, so an
// entry evicted from memory is read back from its disk envelope: the disk
// prune decides when such an entry becomes a network fetch, and this replay
// covers that case (evicted from memory, then pruned from disk).
//
// The recording of one solver generation's cache calls from ticket 25
// (__fixtures__/cdn-sequence.json: 373 URLs, 106 MiB of bodies, repeat reads
// of evicted URLs, stall invalidations, concurrent pairs, one long clock gap)
// is replayed with a temp disk tier and a fake clock against
//   (a) today: captcha-cdn-cache.ts at the integration tip 7555b87, verbatim
//       (src/__fixtures__/captcha-cdn-cache.7555b87.ts; 32 MiB memory tier,
//       no disk prune),
//   (b) head: the same cache with the disk prune (start and after each write).
// The workloads keep the recorded calls and change only the TTL and the long
// gap, so the disk prune has something to decide: entries 15 days old under a
// 20-day TTL (kept: still fresh), 21 days old under a 20-day TTL and 15 days
// old under the default 24 h TTL (pruned: already expired). The network is a
// local fixture whose n-th fetch of a URL returns version n of its body, so a
// spurious refetch changes the bytes. Nothing leaves the process.
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CaptchaCdnCache as TodayCdnCache } from "../__fixtures__/captcha-cdn-cache.7555b87.js";
import recording from "./__fixtures__/cdn-sequence.json";
import { CaptchaCdnCache, DEFAULT_CDN_TTL_MS } from "./captcha-cdn-cache.js";

const MiB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
// git blob id of zcode-proxy-src/src/proxy/captcha-cdn-cache.ts at 7555b87.
const TODAY_BLOB = "a9297440bf768fb7a26e3ece75dab9778ed67735";

type Op = [string, number];
type Served = { body: Buffer; sha256: string; fetchedAt: number; source: string };
interface Cache {
  get(url: string): Served | null;
  put(url: string, body: Buffer): Served;
  load(url: string, fetchBody: () => Promise<Buffer>): Promise<Served>;
  invalidate(url: string): void;
}
type Make = (directory: string, now: () => number, ttlMs: number) => Cache;
/** `restart`: a new solver generation (a new cache, empty memory tier, start prune) begins after the gap. */
interface Workload { ttlMs: number; gapMs: number; restart?: boolean }

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

function body(index: number, version: number): Buffer {
  const b = Buffer.alloc(recording.sizes[index], ((index * 7 + version) % 251) + 1);
  b.write(`/*${index}:${version}*/`);
  return b;
}

// As in ticket 25's replay, fsync is a no-op during a replay: it decides
// durability across a crash, never what this process reads back, and the
// same stub applies to both caches.
async function replay(make: Make, workload: Workload) {
  const fsync = spyOn(fs, "fsyncSync").mockImplementation(() => {});
  const unlink = fs.unlinkSync.bind(fs);
  // Deletions outside an invalidation are the disk prune's (it deletes an
  // entry through a tombstone `<name>.<time>.<uuid>.prune`).
  let invalidating = false;
  const pruned = { names: new Set<string>(), count: 0 };
  const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation(((file: fs.PathLike) => {
    const name = /^([0-9a-f]{64})(?:\.\d+\.[0-9a-f-]{36}\.prune)?$/.exec(path.basename(String(file)))?.[1];
    const result = unlink(file); // a failed unlink throws here and is not counted
    if (!invalidating && name) { pruned.names.add(name); pruned.count++; }
    return result;
  }) as typeof fs.unlinkSync);
  try { return await replayWith(make, workload, pruned, (on) => { invalidating = on; }); }
  finally { fsync.mockRestore(); unlinkSpy.mockRestore(); }
}

async function replayWith(make: Make, { ttlMs, gapMs, restart = false }: Workload, pruned: { names: Set<string>; count: number }, invalidating: (on: boolean) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-cdn-disk-replay-"));
  dirs.push(root);
  const directory = path.join(root, "cache");
  let t = recording.startMs;
  let cache = make(directory, () => t, ttlMs);
  const versions = new Map<number, number>();
  const fetches: string[] = [];
  const results: unknown[] = [];
  const sources: Record<string, number> = {};
  // A network fetch for a URL whose envelope the prune removed earlier (and
  // that was not written again since): evicted from memory, pruned from disk.
  let fetchedAfterPrune = 0;
  const network = (kind: string, index: number) => {
    const v = (versions.get(index) ?? 0) + 1;
    versions.set(index, v);
    fetches.push(`${kind} ${index}`);
    const name = sha(recording.urls[index]);
    if (pruned.names.delete(name)) fetchedAfterPrune++;
    return body(index, v);
  };
  const record = (entry: Served | null) => {
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
    if (kind === "tick" && arg >= recording.ttlMs) {
      t += gapMs;
      if (restart) cache = make(directory, () => t, ttlMs);
    } else if (kind === "tick") t += arg;
    else if (kind === "async") record(await viaAsync(url, arg));
    else if (kind === "pair") for (const e of await Promise.all([viaAsync(url, arg), viaAsync(url, arg)])) record(e);
    else if (kind === "sync") record(cache.get(url) ?? cache.put(url, network("sync", arg)));
    else if (kind === "get") record(cache.get(url));
    else if (kind === "invalidate") { invalidating(true); try { cache.invalidate(url); } finally { invalidating(false); } }
    else throw new Error(`unknown op ${kind}`);
  }
  const prunedTotal = pruned.count;
  fs.rmSync(root, { recursive: true, force: true });
  return { fetches, results, sources, fetchedAfterPrune, prunedTotal };
}

const today: Make = (directory, now, ttlMs) => new TodayCdnCache({ directory, ttlMs, now });
const head: Make = (directory, now, ttlMs) => new CaptchaCdnCache({ directory, ttlMs, now });

// Measured locally: ~1.1 s per replay with the disk tier (ticket 25: 3.4–3.6 s
// for three); windows-latest ran ticket 25's three in 17.6–18.1 s before fsync
// was stubbed. The work is fixed by the recording.
const REPLAY_TIMEOUT_MS = 60_000;

async function compare(name: string, workload: Workload) {
  const a = await replay(today, workload);
  const b = await replay(head, workload);
  console.log(`disk replay ${name}: fetches today=${a.fetches.length} head=${b.fetches.length}; served calls ${a.results.length}; ` +
    `sources today=${JSON.stringify(a.sources)} head=${JSON.stringify(b.sources)}; pruned by head ${b.prunedTotal}, ` +
    `of them fetched again later (evicted from memory, pruned from disk) ${b.fetchedAfterPrune}`);
  return { a, b };
}

describe("CDN disk prune replay (B1, ticket 29)", () => {
  it("replays against the verbatim cache of the integration tip", () => {
    const text = fs.readFileSync(new URL("../__fixtures__/captcha-cdn-cache.7555b87.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const blob = crypto.createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
    expect(blob).toBe(TODAY_BLOB);
    expect(recording.totalBytes).toBeLessThan(256 * MiB);
  });

  it("as recorded (10-minute TTL): the same fetches, bytes, sha256, fetchedAt and disk read-backs", async () => {
    const { a, b } = await compare("as recorded", { ttlMs: recording.ttlMs, gapMs: recording.ttlMs });
    expect(a.sources.disk).toBeGreaterThan(0); // memory evictions are read back from disk
    expect(b.fetches).toEqual(a.fetches);
    expect(b.results).toEqual(a.results);
    expect(b.sources).toEqual(a.sources);
  }, REPLAY_TIMEOUT_MS);

  it("15 days old under a 20-day TTL, then a new generation: nothing pruned, every entry read back from disk as today", async () => {
    const { a, b } = await compare("15 d gap, 20 d TTL, new generation", { ttlMs: 20 * DAY, gapMs: 15 * DAY, restart: true });
    expect(a.sources.disk).toBeGreaterThan(0);
    expect(b.prunedTotal).toBe(0);
    expect(b.fetches).toEqual(a.fetches);
    expect(b.results).toEqual(a.results);
    expect(b.sources).toEqual(a.sources);
  }, REPLAY_TIMEOUT_MS);

  it("21 days old under a 20-day TTL, same generation: expired entries pruned after a write, fetched exactly as today", async () => {
    const { a, b } = await compare("21 d gap, 20 d TTL, same generation", { ttlMs: 20 * DAY, gapMs: 21 * DAY });
    expect(b.prunedTotal).toBeGreaterThan(0);
    expect(b.fetchedAfterPrune).toBeGreaterThan(0);
    expect(b.fetches).toEqual(a.fetches);
    expect(b.results).toEqual(a.results);
    expect(b.sources).toEqual(a.sources);
  }, REPLAY_TIMEOUT_MS);

  it("15 days old under the default 24 h TTL, then a new generation: pruned at start at the 14-day floor, fetched exactly as today", async () => {
    const { a, b } = await compare("15 d gap, 24 h TTL, new generation", { ttlMs: DEFAULT_CDN_TTL_MS, gapMs: 15 * DAY, restart: true });
    expect(b.prunedTotal).toBeGreaterThan(0);
    expect(b.fetchedAfterPrune).toBeGreaterThan(0);
    expect(b.fetches).toEqual(a.fetches);
    expect(b.results).toEqual(a.results);
    expect(b.sources).toEqual(a.sources);
  }, REPLAY_TIMEOUT_MS);

  it("records a workload above the cap (48 MiB test cap, a recorded number, not a gate): fresh entries pruned become fetches", async () => {
    const workload = { ttlMs: recording.ttlMs, gapMs: recording.ttlMs };
    const a = await replay(today, workload);
    const b = await replay((directory, now, ttlMs) => new CaptchaCdnCache({ directory, ttlMs, now, diskMaxBytes: 48 * MiB }), workload);
    console.log(`disk replay above the cap: fetches today=${a.fetches.length} head(48 MiB)=${b.fetches.length}; ` +
      `sources today=${JSON.stringify(a.sources)} head=${JSON.stringify(b.sources)}; pruned ${b.prunedTotal}, fetched again ${b.fetchedAfterPrune}`);
    expect(b.fetchedAfterPrune).toBeGreaterThan(0);
    expect(b.fetches.length).toBeGreaterThan(a.fetches.length);
    // Whatever is served is still self-consistent: its sha256 is that of its bytes.
    for (const r of b.results as ({ bytes: string; sha256: string } | null)[]) if (r) expect(r.bytes).toBe(r.sha256);
  }, REPLAY_TIMEOUT_MS);
});
