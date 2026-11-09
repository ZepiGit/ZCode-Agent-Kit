/**
 * ResponseText — a task's response text, bounded while it is collected
 * (ADR-0009, spec §7). Up to 4 MiB of UTF-8 the text is kept whole. Past that,
 * the first 1 MiB is frozen, the rest is a rolling window of the last bytes (up
 * to 4 MiB in total) and the dropped bytes are counted; the text then reads as
 * head + one `[… N bytes truncated …]` marker line + tail. Cuts fall on
 * code-point boundaries and N counts UTF-8 bytes.
 *
 * Every kept piece is a fresh copy: a slice of a larger string keeps the whole
 * parent alive, which would beat a bound that counts only the slice's bytes.
 */

export const RESPONSE_TEXT_CAP = Object.freeze({ maxBytes: 4 * 1024 * 1024, headBytes: 1024 * 1024 });

/** Pieces are sealed at about this size, so the rolling window drops whole pieces. */
const PIECE_BYTES = 64 * 1024;

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** UTF-8 bytes of the code point starting at `i` and its length in code units (a lone surrogate counts as U+FFFD). */
function codePointAt(s: string, i: number): [bytes: number, units: number] {
  const unit = s.charCodeAt(i);
  if (unit < 0x80) return [1, 1];
  if (unit < 0x800) return [2, 1];
  if (isHigh(unit) && i + 1 < s.length && isLow(s.charCodeAt(i + 1))) return [4, 2];
  return [3, 1];
}

/** Index after the longest prefix of `s` from `from` that fits in `maxBytes`, and its bytes. */
function prefixWithin(s: string, from: number, maxBytes: number): [end: number, bytes: number] {
  let i = from;
  let bytes = 0;
  while (i < s.length) {
    const [b, u] = codePointAt(s, i);
    if (bytes + b > maxBytes) break;
    bytes += b;
    i += u;
  }
  return [i, bytes];
}

/** Index after the shortest prefix of `s` that holds at least `minBytes`, and its bytes. */
function prefixAtLeast(s: string, minBytes: number): [end: number, bytes: number] {
  let i = 0;
  let bytes = 0;
  while (i < s.length && bytes < minBytes) {
    const [b, u] = codePointAt(s, i);
    bytes += b;
    i += u;
  }
  return [i, bytes];
}

/** A copy of `s` that shares no storage with it (UTF-16 round trip keeps lone surrogates as they are). */
function fresh(s: string): string {
  const wellFormed = (s as unknown as { isWellFormed(): boolean }).isWellFormed();
  const encoding = wellFormed ? "utf8" : "utf16le";
  return Buffer.from(s, encoding).toString(encoding);
}

export class ResponseText {
  /** Frozen head, once the text went past the cap. */
  private head: string[] | null = null;
  private headBytes = 0;
  /** Sealed pieces (from index `first`) and their UTF-8 bytes; each starts and ends on a code-point boundary. */
  private pieces: string[] | null = null;
  private sizes: number[] | null = null;
  private first = 0;
  private sealedBytes = 0;
  /** Unsealed text, below PIECE_BYTES. */
  private open = "";
  private openBytes = 0;
  /** Bytes dropped as whole pieces from the front of the rolling window. */
  private droppedPieces = 0;

  append(delta: string): void {
    if (delta.length === 0) return;
    let bytes = Buffer.byteLength(delta, "utf8");
    // A surrogate pair split across two deltas is 4 bytes, not 3 + 3.
    if (this.open.length > 0 && isHigh(this.open.charCodeAt(this.open.length - 1)) && isLow(delta.charCodeAt(0))) bytes -= 2;
    this.open += delta;
    this.openBytes += bytes;
    if (this.openBytes >= PIECE_BYTES) this.seal();
    if (this.headBytes + this.sealedBytes + this.openBytes > RESPONSE_TEXT_CAP.maxBytes) this.bound();
  }

  /** The text as it is served, and the number of UTF-8 bytes dropped from it. */
  read(): { text: string; droppedBytes: number } {
    const tail = (this.pieces ? this.pieces.slice(this.first).join("") : "") + this.open;
    if (!this.head) return { text: tail, droppedBytes: 0 };
    const excess = this.sealedBytes + this.openBytes - (RESPONSE_TEXT_CAP.maxBytes - this.headBytes);
    const [cut, cutBytes] = excess > 0 ? prefixAtLeast(tail, excess) : [0, 0];
    const droppedBytes = this.droppedPieces + cutBytes;
    return { text: `${this.head.join("")}\n[… ${droppedBytes} bytes truncated …]\n${tail.slice(cut)}`, droppedBytes };
  }

  /** Move the open text into sealed pieces; a trailing high surrogate waits for its pair. */
  private seal(): void {
    let s = this.open;
    let keep = "";
    if (isHigh(s.charCodeAt(s.length - 1))) {
      keep = s.slice(-1);
      s = s.slice(0, -1);
    }
    const pieces = (this.pieces ??= []);
    const sizes = (this.sizes ??= []);
    if (this.openBytes - (keep ? 3 : 0) <= 2 * PIECE_BYTES) {
      if (s.length > 0) {
        pieces.push(fresh(s));
        sizes.push(this.openBytes - (keep ? 3 : 0));
        this.sealedBytes += sizes[sizes.length - 1]!;
      }
    } else {
      for (let i = 0; i < s.length; ) {
        const [end, bytes] = prefixWithin(s, i, PIECE_BYTES);
        const stop = end > i ? end : i + codePointAt(s, i)[1];
        const size = end > i ? bytes : codePointAt(s, i)[0];
        pieces.push(fresh(s.slice(i, stop)));
        sizes.push(size);
        this.sealedBytes += size;
        i = stop;
      }
    }
    this.open = keep;
    this.openBytes = keep ? 3 : 0;
  }

  /** Past the cap: freeze the head once, then drop whole pieces the rolling window no longer needs. */
  private bound(): void {
    if (!this.head) {
      if (this.open.length > 0) this.seal();
      const pieces = this.pieces!;
      const sizes = this.sizes!;
      const head: string[] = [];
      while (this.first < pieces.length && this.headBytes + sizes[this.first]! <= RESPONSE_TEXT_CAP.headBytes) {
        head.push(pieces[this.first]!);
        this.headBytes += sizes[this.first]!;
        this.sealedBytes -= sizes[this.first]!;
        pieces[this.first] = "";
        this.first += 1;
      }
      if (this.first < pieces.length && this.headBytes < RESPONSE_TEXT_CAP.headBytes) {
        const piece = pieces[this.first]!;
        const [end, bytes] = prefixWithin(piece, 0, RESPONSE_TEXT_CAP.headBytes - this.headBytes);
        if (end > 0) {
          head.push(fresh(piece.slice(0, end)));
          this.headBytes += bytes;
          this.sealedBytes -= bytes;
          pieces[this.first] = fresh(piece.slice(end));
          sizes[this.first]! -= bytes;
        }
      }
      this.head = head;
    }
    const pieces = this.pieces;
    const sizes = this.sizes;
    if (!pieces || !sizes) return;
    const tailBytes = RESPONSE_TEXT_CAP.maxBytes - this.headBytes;
    while (this.first < pieces.length && this.sealedBytes - sizes[this.first]! + this.openBytes >= tailBytes) {
      this.droppedPieces += sizes[this.first]!;
      this.sealedBytes -= sizes[this.first]!;
      pieces[this.first] = "";
      this.first += 1;
    }
    if (this.first > 64 && this.first * 2 > pieces.length) {
      this.pieces = pieces.slice(this.first);
      this.sizes = sizes.slice(this.first);
      this.first = 0;
    }
  }
}
