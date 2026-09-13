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
    fs.mkdirSync(this.baseDir, { recursive: true });
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
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }

  /** Atomic write: temp file in the same directory, then rename. */
  writeJson(relPath: string, value: unknown): void {
    const abs = this.resolveSafe(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = abs + ".tmp-" + randomUUID().slice(0, 8);
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    try {
      fs.renameSync(tmp, abs);
    } catch (err) {
      // Windows rename over an existing file can fail on some FS states; retry once.
      try {
        fs.rmSync(abs, { force: true });
        fs.renameSync(tmp, abs);
      } catch (err2) {
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* ignore */
        }
        log.error("atomic write failed", { path: relPath, error: String(err2) });
        throw err2;
      }
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
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, JSON.stringify(value) + "\n", "utf8");
  }

  readLines(relPath: string): unknown[] {
    const abs = this.resolveSafe(relPath);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
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
