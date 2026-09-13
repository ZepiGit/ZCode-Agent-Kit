import { describe, it, expect } from "bun:test";
import { ResponseStore } from "./store.js";
import type { StoredResponse } from "./store.js";

function entry(id: string): StoredResponse {
  return {
    id,
    model: "glm-5.2",
    status: "completed",
    input: [],
    output: [],
    createdAt: 0,
    lastAccessedAt: 0,
  };
}

describe("ResponseStore", () => {
  it("round-trips set → get", () => {
    const s = new ResponseStore();
    s.set(entry("resp_1"));
    expect(s.get("resp_1")?.id).toBe("resp_1");
    expect(s.get("missing")).toBeUndefined();
  });

  it("evicts oldest on LRU overflow", () => {
    const s = new ResponseStore({ maxEntries: 2 });
    s.set(entry("a"));
    s.set(entry("b"));
    s.set(entry("c"));
    expect(s.get("a")).toBeUndefined();
    expect(s.get("b")?.id).toBe("b");
    expect(s.get("c")?.id).toBe("c");
  });

  it("refreshes LRU position on get", () => {
    const s = new ResponseStore({ maxEntries: 2 });
    s.set(entry("a"));
    s.set(entry("b"));
    s.get("a");
    s.set(entry("c"));
    expect(s.get("a")?.id).toBe("a");
    expect(s.get("b")).toBeUndefined();
  });

  it("expires entries past TTL", () => {
    const s = new ResponseStore({ ttlMs: 50 });
    s.set(entry("a"));
    expect(s.get("a")?.id).toBe("a");
    // Wait past TTL
    const start = Date.now();
    while (Date.now() - start < 60) {
      // busy-wait 60ms
    }
    expect(s.get("a")).toBeUndefined();
  });

  it("supports delete and clear", () => {
    const s = new ResponseStore();
    s.set(entry("a"));
    s.set(entry("b"));
    expect(s.delete("a")).toBe(true);
    expect(s.get("a")).toBeUndefined();
    expect(s.size()).toBe(1);
    s.clear();
    expect(s.size()).toBe(0);
  });

  it("evicts oldest entries when the byte budget is exceeded (count AND bytes bounded)", () => {
    const s = new ResponseStore({ maxEntries: 100, ttlMs: 60_000, maxTotalBytes: 1024 });
    const big = entry("big-1");
    big.output = [{ type: "message", id: "m", role: "assistant", content: "x".repeat(600) }] as never;
    s.set(big);
    const baseline = s.totalBytesUsed();
    expect(baseline).toBeGreaterThan(600);
    for (let i = 0; i < 5; i++) {
      const e = entry(`fill-${i}`);
      e.output = [{ type: "message", id: "m", role: "assistant", content: "y".repeat(200) }] as never;
      s.set(e);
    }
    // Budget forced eviction: total must stay under the limit + one entry slack
    expect(s.totalBytesUsed()).toBeLessThanOrEqual(1024 + 300);
    expect(s.get("big-1")).toBeUndefined();
    // Recent entries survive
    expect(s.get("fill-4")).toBeDefined();
  });

  it("refuses a single entry larger than the whole byte budget", () => {
    const s = new ResponseStore({ maxEntries: 10, ttlMs: 60_000, maxTotalBytes: 512 });
    const huge = entry("huge");
    huge.output = [{ type: "message", id: "m", role: "assistant", content: "z".repeat(4096) }] as never;
    s.set(huge);
    expect(s.size()).toBe(0);
    expect(s.totalBytesUsed()).toBe(0);
  });

  it("delete and TTL expiry release byte accounting", () => {
    const s = new ResponseStore({ ttlMs: 40 });
    const e = entry("tmp");
    e.output = [{ type: "message", id: "m", role: "assistant", content: "x".repeat(300) }] as never;
    s.set(e);
    expect(s.totalBytesUsed()).toBeGreaterThan(300);
    s.delete("tmp");
    expect(s.totalBytesUsed()).toBe(0);
  });
});
