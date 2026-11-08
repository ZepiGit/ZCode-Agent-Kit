// One "installation" sharing a CDN cache directory with others (ticket 29,
// captcha-cdn-disk-prune.test.ts). Usage: bun cdn-disk-sharer.ts <role> <dir> <id> <durationMs>
// Prints one JSON line of counts; any failure is printed to stderr and exits 1.
//   cache   puts, reads, invalidates and restarts caches with a tiny disk cap,
//           so every write prunes; every served entry must be intact
//   pruner  starts caches with a tiny cap in a loop (start prunes)
//   deleter unlinks entry files at random (vanishing files)
//   temp    publishes envelopes slowly through its own temp files, like a
//           writer on a slow disk; a temp file must never disappear
//   legacy  writes raw bodies in place in chunks, like kits up to v0.2.31; the
//           file must never be deleted while it is being written
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CaptchaCdnCache } from "../captcha-cdn-cache.js";

const [role, dir, id, durationText] = process.argv.slice(2);
const until = Date.now() + Number(durationText);
const KiB = 1024;
const DISK_CAP = 96 * KiB;
const URLS = 24;
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const urlOf = (i: number) => `https://g.alicdn.com/captcha-frontend/dynamicJS/1.0.${i}/pe.${i}.js`;
const nameOf = (i: number) => sha(urlOf(i));
let seed = Number(id) * 7919 + 17;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (n: number) => Math.floor(random() * n);
const sleep = (ms: number) => Bun.sleepSync(ms);

/** A body that names its URL: a served entry with another URL's bytes is caught. */
function bodyOf(i: number, version: string) {
  const b = Buffer.alloc(2 * KiB + pick(8) * KiB, 97 + (i % 26));
  b.write(`/*url ${i} ${version}*/`);
  return b;
}
function intact(i: number, entry: { body: Buffer; sha256: string }) {
  return sha(entry.body) === entry.sha256 && entry.body.subarray(0, 64).toString("latin1").startsWith(`/*url ${i} `);
}

const counts: Record<string, number> = {};
const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
function fail(message: string): never {
  process.stderr.write(`${role} ${id}: ${message}\n`);
  process.exit(1);
}

try {
  if (role === "cache") {
    let cache = new CaptchaCdnCache({ directory: dir, diskMaxBytes: DISK_CAP });
    let n = 0;
    while (Date.now() < until) {
      const i = pick(URLS);
      const r = random();
      if (r < 0.45) { cache.put(urlOf(i), bodyOf(i, `${id}.${n++}`)); count("put"); }
      else if (r < 0.9) {
        const entry = cache.get(urlOf(i));
        if (entry && !intact(i, entry)) fail(`corrupt entry for url ${i} from ${entry.source}`);
        count(entry ? `hit:${entry.source}` : "miss");
      } else if (r < 0.95) { cache.invalidate(urlOf(i)); count("invalidate"); }
      else { cache = new CaptchaCdnCache({ directory: dir, diskMaxBytes: DISK_CAP }); count("start"); }
    }
  } else if (role === "pruner") {
    while (Date.now() < until) { new CaptchaCdnCache({ directory: dir, diskMaxBytes: DISK_CAP }); count("start"); }
  } else if (role === "deleter") {
    while (Date.now() < until) {
      try { fs.unlinkSync(path.join(dir, nameOf(pick(URLS)))); count("unlink"); } catch { count("absent"); }
      sleep(1);
    }
  } else if (role === "temp") {
    while (Date.now() < until) {
      const i = pick(URLS);
      const body = bodyOf(i, `${id}.temp`);
      const header = Buffer.from(JSON.stringify({ version: 1, fetchedAt: Date.now(), length: body.length, sha256: sha(body) }) + "\n");
      const target = path.join(dir, nameOf(i));
      const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeSync(fd, header);
      for (let at = 0; at < body.length; at += KiB) { fs.writeSync(fd, body.subarray(at, at + KiB)); sleep(2); }
      fs.closeSync(fd);
      if (!fs.existsSync(temporary)) fail(`temp file ${path.basename(temporary)} disappeared while it was being written`);
      try { fs.renameSync(temporary, target); count("published"); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") fail(`temp file ${path.basename(temporary)} disappeared before publication`);
        // Windows refuses to replace a file another process holds open; the
        // kit's writer drops the temp file then, and so does this one.
        fs.unlinkSync(temporary);
        count(`publish:${code}`);
      }
    }
  } else if (role === "legacy") {
    let n = 0;
    while (Date.now() < until) {
      // A few files only: each stays "being written" for a minute and counts
      // toward the cap, which would otherwise crowd every envelope out.
      if (n >= 3) { sleep(20); continue; }
      const name = crypto.createHash("sha256").update(`legacy ${id} ${n++}`).digest("hex");
      const file = path.join(dir, name);
      const fd = fs.openSync(file, "w");
      const identity = fs.fstatSync(fd).ino;
      // Slow enough that the caches write more than the cap between two
      // chunks, so the file becomes the oldest entry while it is being written.
      for (let k = 0; k < 8; k++) {
        fs.writeSync(fd, Buffer.alloc(KiB, 120));
        sleep(60);
        let seen: fs.Stats;
        try { seen = fs.statSync(file); } catch { fail(`${name} was deleted while it was being written`); }
        if (seen.ino !== identity) fail(`${name} was replaced while it was being written`);
      }
      fs.closeSync(fd);
      count("written");
    }
  } else fail(`unknown role ${role}`);
} catch (error) {
  fail(`threw ${(error as Error)?.stack ?? error}`);
}
process.stdout.write(JSON.stringify({ role, id, counts }) + "\n");
