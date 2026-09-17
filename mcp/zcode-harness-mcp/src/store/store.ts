/**
 * JSON file store with atomic writes. Tasks, sessions and interactions are
 * persisted so results survive bridge restarts.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "../util/log.js";

const log = createLogger("store");

export class JsonStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
  }

  get root(): string {
    return this.baseDir;
  }

  /**
   * Resolve a store-relative path, refusing escapes from the store root
   * (boundary check per the audited pattern: resolved target must equal the
   * root or live under root + separator).
   */
  private resolveSafe(relPath: string): string {
    if (path.isAbsolute(relPath)) {
      throw new Error(`store paths must be relative: ${relPath}`);
    }
    const target = path.resolve(this.baseDir, relPath);
    const rootPrefix = this.baseDir.endsWith(path.sep) ? this.baseDir : this.baseDir + path.sep;
    if (target !== this.baseDir && !target.startsWith(rootPrefix)) {
      throw new Error(`store path escapes data dir: ${relPath}`);
    }
    return target;
  }

  ensureDir(rel: string): string {
    const abs = this.resolveSafe(rel);
    fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
    return abs;
  }

  /** Atomic write: temp file in the same directory, then rename. */
  writeJson(relPath: string, value: unknown): void {
    const abs = this.resolveSafe(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    const tmp = abs + ".tmp-" + randomUUID().slice(0, 8);
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      fs.renameSync(tmp, abs);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      log.error("atomic write failed", { path: relPath, error: String(err) });
      throw err;
    }
  }

  readJson<T>(relPath: string): T | null {
    const abs = this.resolveSafe(relPath);
    try {
      return JSON.parse(fs.readFileSync(abs, "utf8")) as T;
    } catch {
      return null;
    }
  }

  appendLine(relPath: string, value: unknown): void {
    const abs = this.resolveSafe(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    let line = JSON.stringify(value) + "\n";
    const maxBytes = 4 * 1024 * 1024;
    if (Buffer.byteLength(line) > maxBytes) {
      const rawSeq = (value as { seq?: unknown })?.seq;
      const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? rawSeq : undefined;
      line = JSON.stringify({ seq, type: "bridge.record_truncated", payload: { reason: "record exceeded 4 MiB" } }) + "\n";
    }
    if (fs.existsSync(abs) && fs.statSync(abs).size + Buffer.byteLength(line) > maxBytes) {
      fs.renameSync(abs, abs + ".previous");
    }
    fs.appendFileSync(abs, line, { encoding: "utf8", mode: 0o600 });
  }

  readLines(relPath: string): unknown[] {
    const abs = this.resolveSafe(relPath);
    let text: string;
    try {
      const maxBytes = 4 * 1024 * 1024;
      const readBounded = (file: string) => {
        if (!fs.existsSync(file)) return "";
        const fd = fs.openSync(file, "r");
        try {
          const size = fs.fstatSync(fd).size;
          const start = Math.max(0, size - maxBytes);
          const buf = Buffer.alloc(Math.min(size, maxBytes));
          const length = fs.readSync(fd, buf, 0, buf.length, start);
          const raw = buf.subarray(0, length).toString("utf8");
          return start > 0 ? raw.slice(raw.indexOf("\n") + 1) : raw;
        } finally { fs.closeSync(fd); }
      };
      text = readBounded(abs + ".previous") + readBounded(abs);
    } catch {
      return [];
    }
    const out: unknown[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        out.push({ unparseable: line.slice(0, 200) });
      }
    }
    return out;
  }

  readLinesAfter(relPath: string, afterSeq: number, limit: number): { items: unknown[]; nextSeq: number; hasMore: boolean } {
    const all = this.readLines(relPath);
    const items: unknown[] = [];
    let nextSeq = afterSeq;
    for (const item of all) {
      const rec = item as { seq?: number };
      if (typeof rec?.seq === "number" && rec.seq > afterSeq) {
        if (items.length < limit) {
          items.push(item);
          nextSeq = rec.seq;
        } else {
          return { items, nextSeq, hasMore: true };
        }
      }
    }
    return { items, nextSeq, hasMore: false };
  }

  listFiles(relDir: string): string[] {
    const abs = this.resolveSafe(relDir);
    try {
      return fs.readdirSync(abs).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
  }

  deleteFile(relPath: string): void {
    try {
      fs.rmSync(this.resolveSafe(relPath), { force: true });
    } catch {
      /* ignore */
    }
  }
}
