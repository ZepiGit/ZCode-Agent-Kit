// Seam 6 (pure shared modules): the bounded collection lifted from the
// responses store. Every test drives eviction through the public
// interface with an injected clock; expected values are literals.
import { describe, expect, it } from "bun:test";
import { BoundedCollection } from "./bounded-collection.js";

const text = (value: string) => value.length;

function clock(start = 0) {
  let t = start;
  return { now: () => t, set(next: number) { t = next; } };
}

describe("bounded collection: count", () => {
  it("evicts the oldest entry when the entry count is exceeded", () => {
    const c = new BoundedCollection<string, string>({ maxEntries: 3 });
    for (const key of ["a", "b", "c", "d"]) c.set(key, key);
    expect(c.get("a")).toBeUndefined();
    expect([c.get("b"), c.get("c"), c.get("d")]).toEqual(["b", "c", "d"]);
    expect(c.size).toBe(3);
  });

  it("a read makes an entry the most recently used, so the next eviction skips it", () => {
    const c = new BoundedCollection<string, string>({ maxEntries: 2 });
    c.set("a", "a");
    c.set("b", "b");
    c.get("a");
    c.set("c", "c");
    expect(c.get("a")).toBe("a");
    expect(c.get("b")).toBeUndefined();
  });

  it("rewriting a key replaces it in place of adding a second entry", () => {
    const c = new BoundedCollection<string, string>({ maxEntries: 2, maxBytes: 100, sizeOf: text });
    c.set("a", "1234");
    c.set("a", "123456");
    expect(c.size).toBe(1);
    expect(c.bytes).toBe(6);
    expect(c.get("a")).toBe("123456");
  });

  it("a zero entry limit retains nothing", () => {
    const c = new BoundedCollection<string, string>({ maxEntries: 0 });
    expect(c.set("a", "a")).toBe(false);
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });
});

describe("bounded collection: bytes", () => {
  it("evicts the oldest entries until the byte budget holds", () => {
    const c = new BoundedCollection<string, string>({ maxBytes: 10, sizeOf: text });
    c.set("a", "aaaa");
    c.set("b", "bbbb");
    c.set("c", "cccc");
    expect(c.get("a")).toBeUndefined();
    expect(c.bytes).toBe(8);
    expect(c.size).toBe(2);
  });

  it("refuses a value larger than the whole budget and keeps what it already holds", () => {
    const c = new BoundedCollection<string, string>({ maxBytes: 10, sizeOf: text });
    c.set("a", "aaaa");
    expect(c.set("a", "x".repeat(11))).toBe(false);
    expect(c.set("b", "x".repeat(11))).toBe(false);
    expect(c.get("a")).toBe("aaaa");
    expect(c.get("b")).toBeUndefined();
    expect(c.bytes).toBe(4);
  });

  it("refuses a value whose size cannot be counted, so the budget cannot be bypassed", () => {
    for (const size of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const c = new BoundedCollection<string, string>({ maxBytes: 10, sizeOf: () => size });
      expect(c.set("a", "a")).toBe(false);
      expect(c.size).toBe(0);
      expect(c.bytes).toBe(0);
    }
  });

  it("delete and clear release the bytes they held", () => {
    const c = new BoundedCollection<string, string>({ maxBytes: 100, sizeOf: text });
    c.set("a", "aaaa");
    c.set("b", "bbbbbb");
    expect(c.delete("a")).toBe(true);
    expect(c.delete("a")).toBe(false);
    expect(c.bytes).toBe(6);
    c.clear();
    expect(c.bytes).toBe(0);
    expect(c.size).toBe(0);
  });

  it("holds both bounds after every operation of a long mixed sequence", () => {
    // Deterministic LCG: sizes 0..39 against a 100-byte, 7-entry budget.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const c = new BoundedCollection<number, string>({ maxEntries: 7, maxBytes: 100, sizeOf: text });
    let maxSize = 0;
    let maxBytes = 0;
    for (let i = 0; i < 5000; i++) {
      const key = next() % 20;
      const op = next() % 10;
      if (op < 6) c.set(key, "x".repeat(next() % 40));
      else if (op < 9) c.get(key);
      else c.delete(key);
      maxSize = Math.max(maxSize, c.size);
      maxBytes = Math.max(maxBytes, c.bytes);
    }
    expect(maxSize).toBeLessThanOrEqual(7);
    expect(maxBytes).toBeLessThanOrEqual(100);
  });
});

describe("bounded collection: TTL on an injected clock", () => {
  it("serves an entry up to its TTL and drops it after", () => {
    const t = clock(1_000);
    const c = new BoundedCollection<string, string>({ ttlMs: 100, maxBytes: 100, sizeOf: text, now: t.now });
    c.set("a", "aaaa");
    t.set(1_100);
    expect(c.get("a")).toBe("aaaa");
    t.set(1_101);
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
  });

  it("measures age from the caller's storage time when one is given", () => {
    const t = clock(5_000);
    const c = new BoundedCollection<string, string>({ ttlMs: 100, now: t.now });
    c.set("a", "a", 4_950);
    expect(c.get("a", 5_050)).toBe("a");
    expect(c.get("a", 5_051)).toBeUndefined();
  });

  it("a read does not extend the TTL", () => {
    const t = clock(0);
    const c = new BoundedCollection<string, string>({ ttlMs: 100, now: t.now });
    c.set("a", "a");
    t.set(90);
    expect(c.get("a")).toBe("a");
    t.set(101);
    expect(c.get("a")).toBeUndefined();
  });

  it("without a TTL entries never expire", () => {
    const t = clock(0);
    const c = new BoundedCollection<string, string>({ now: t.now });
    c.set("a", "a");
    t.set(Number.MAX_SAFE_INTEGER);
    expect(c.get("a")).toBe("a");
  });
});
