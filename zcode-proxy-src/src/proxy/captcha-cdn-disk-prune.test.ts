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
