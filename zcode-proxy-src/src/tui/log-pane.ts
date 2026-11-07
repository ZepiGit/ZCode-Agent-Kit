/**
 * The log pane: a bounded ring of leveled log lines with tail-following and
 * scrollback, mirroring the Android app's Logs card (LazyColumn that sticks
 * to the newest line). Pure state — the frame renderer and terminal glue
 * read it, tests drive it directly.
 */
import { stripAnsi } from "./width.js";

export type LogLevel = "info" | "warn" | "error";

export interface LogLine {
  readonly seq: number;
  readonly level: LogLevel;
  readonly text: string;
}

export interface LogView {
  /** The lines to draw, oldest first, at most `height` of them. */
  readonly lines: readonly LogLine[];
  /** Total lines retained (for the "Logs (N)" header). */
  readonly total: number;
  /** Lines hidden BELOW the viewport toward the tail (0 while following). */
  readonly fromBottom: number;
}

/** The pane's bounds (§9 BOUNDS, ADR-0009): 2,000 lines and 8 MB. */
export const LOG_PANE_MAX_LINES = 2000;
export const LOG_PANE_MAX_BYTES = 8 * 1024 * 1024;

const BEYOND_LATIN1 = /[^\x00-\xff]/;

/**
 * A line's byte cost: its UTF-8 size, or its in-memory size when that is
 * larger. Text holding a character beyond Latin-1 is held at two bytes per
 * UTF-16 unit, so 64 KB of ASCII with one emoji costs 128 KB of heap. Taking
 * the larger of the two keeps the cap a bound on the text and on its heap.
 */
function lineCost(text: string, utf8Bytes: number): number {
  return Math.max(utf8Bytes, BEYOND_LATIN1.test(text) ? text.length * 2 : text.length);
}

/**
 * The UTF-8 prefix of `buf` of at most `max` bytes (all of it when it fits),
 * cut on a code-point boundary, decoded into a new string.
 */
function decodeHead(buf: Buffer, max: number): { text: string; utf8: number } {
  let n = Math.min(max, buf.length);
  while (n > 0 && n < buf.length && (buf[n]! & 0xc0) === 0x80) n--;
  return { text: buf.toString("utf8", 0, n), utf8: n };
}

/**
 * One line as the pane stores it, with its byte cost.
 *
 * The stored text is always a fresh copy. A substring (a row split from a
 * multi-line record, or a caller's slice of a larger chunk) keeps its whole
 * parent alive in Bun, so storing it as is would let 2,000 short rows hold a
 * 20 MB record the pane never counted. The copy goes through UTF-8, which
 * also turns a lone surrogate into U+FFFD.
 *
 * A line larger than the byte cap is truncated: its head is kept, cut on a
 * code-point boundary at the cap, or at half the cap when the head is held
 * two bytes per unit. A row shows only its first screen width anyway; the
 * untruncated record goes to the `ZCODE_TUI_LOGFILE` tee when that is set.
 */
function fitLine(text: string, cap: number): { text: string; bytes: number } {
  const buf = Buffer.from(text, "utf8");
  let line = decodeHead(buf, cap);
  let bytes = lineCost(line.text, line.utf8);
  if (bytes > cap) {
    line = decodeHead(buf, Math.floor(cap / 2));
    bytes = lineCost(line.text, line.utf8);
  }
  return { text: line.text, bytes };
}

export class LogPane {
  private lines: LogLine[] = [];
  /** Byte cost of each retained line, parallel to `lines`. */
  private sizes: number[] = [];
  private totalBytes = 0;
  private nextSeq = 0;
  /** Lines hidden below the viewport. 0 = follow the tail. */
  private offset = 0;

  constructor(
    private readonly capacity = LOG_PANE_MAX_LINES,
    private readonly byteCapacity = LOG_PANE_MAX_BYTES,
  ) {}

  /**
   * Append a log record. ANSI escape sequences are stripped (proxy logs carry
   * color codes; the pane applies its own) and embedded newlines split into
   * separate rows so multi-line records scroll naturally.
   */
  push(text: string, level: LogLevel = "info"): void {
    const clean = stripAnsi(String(text)).replace(/\r/g, "");
    const parts = clean.split("\n");
    if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    for (const raw of parts) {
      const { text: part, bytes } = fitLine(raw, this.byteCapacity);
      this.lines.push({ seq: this.nextSeq++, level, text: part });
      this.sizes.push(bytes);
      this.totalBytes += bytes;
      while (this.lines.length > this.capacity || this.totalBytes > this.byteCapacity) {
        this.lines.shift();
        this.totalBytes -= this.sizes.shift()!;
      }
    }
    // Eviction can shrink the pane below the scrollback offset (a long-line
    // flood while scrolled); keep the offset within the retained lines.
    if (this.offset > this.lines.length) this.offset = this.lines.length;
  }

  get count(): number {
    return this.lines.length;
  }

  /** Bytes retained, at most the byte cap (8 MB by default). */
  get bytes(): number {
    return this.totalBytes;
  }

  /** True when the viewport is pinned to the newest lines. */
  get following(): boolean {
    return this.offset === 0;
  }

  scrollUp(n: number): void {
    this.offset = Math.min(this.lines.length, this.offset + Math.max(0, n));
  }

  scrollDown(n: number): void {
    this.offset = Math.max(0, this.offset - Math.max(0, n));
  }

  /** Jump back to the tail (re-enable following). */
  followBottom(): void {
    this.offset = 0;
  }

  clear(): void {
    this.lines = [];
    this.sizes = [];
    this.totalBytes = 0;
    this.offset = 0;
  }

  /** Slice of lines currently visible in a viewport `height` rows tall. */
  view(height: number): LogView {
    const rows = Math.max(1, height);
    // At max scrollback (offset === length) the viewport pins to the oldest
    // rows instead of going empty.
    const end = Math.max(Math.min(rows, this.lines.length), this.lines.length - this.offset);
    const start = Math.max(0, end - rows);
    return {
      lines: this.lines.slice(start, end),
      total: this.lines.length,
      fromBottom: this.lines.length - end,
    };
  }
}
