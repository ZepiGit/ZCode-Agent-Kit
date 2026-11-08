// Seam 3 (B1, ADR-0009 correction 1): the solver's per-pe-URL stall counters
// are bounded by count only (1,024 entries, oldest first, no TTL), and below
// that bound they make exactly the CDN invalidation decisions the pre-change
// code made. The expected decisions are a recording of the pre-change code
// (captcha-happy.ts @ 8e11d15), never recomputed from the code under test.
import { describe, expect, it } from "bun:test";
import recording from "./__fixtures__/stall-recording.json";
import { MAX_STALL_COUNTS, StallCounts } from "./captcha-stall-counts.js";

const pe = (i: number) => `https://g.alicdn.com/captcha-frontend/dynamicJS/9.${i}.0/pe.js`;

function tracker() {
  const evictions: Array<[string, number]> = [];
  const counts = new StallCounts((url, stalls) => { evictions.push([url, stalls]); });
  return { counts, evictions };
}

describe("stall counters: invalidation decisions unchanged (B1)", () => {
  it("replays the recorded stalls and solves with the pre-change evictions, at the same events", () => {
    const urlOf = (u: number) => (u === -1 ? null : u === -2 ? "" : recording.urls[u]);
    const invalidations: number[][] = [];
    const evictionLogs: number[][] = [];
    const bypassAt: number[] = [];
    let at = -1;
    const counts = new StallCounts((url, stalls) => {
      invalidations.push([at, recording.urls.indexOf(url)]);
      evictionLogs.push([at, stalls]);
    });
    for (const [i, [op, u]] of recording.events.entries()) {
      at = i;
      if (op === 0) { if (counts.stalled(urlOf(u))) bypassAt.push(i); }
      else counts.solved(urlOf(u));
    }
    expect(recording.invalidations.length).toBe(392);
    expect(invalidations).toEqual(recording.invalidations);
    expect(evictionLogs).toEqual(recording.evictionLogs);
    expect(bypassAt).toEqual(recording.bypassAt);
  });
});

describe("stall counters: count bound", () => {
  it("holds at most 1,024 URLs and forgets the oldest first", () => {
    const { counts, evictions } = tracker();
    for (let i = 0; i <= 1024; i++) counts.stalled(pe(i));
    expect(MAX_STALL_COUNTS).toBe(1024);
    expect(counts.size).toBe(1024);
    // The oldest URL's first stall was forgotten: its next stall counts as the first.
    counts.stalled(pe(0));
    expect(evictions).toEqual([]);
    // The newest URL kept its count: its second stall evicts.
    counts.stalled(pe(1024));
    expect(evictions).toEqual([[pe(1024), 2]]);
  });

  it("stays bounded under an unbounded stream of distinct URLs", () => {
    const { counts } = tracker();
    let max = 0;
    for (let i = 0; i < 10_000; i++) { counts.stalled(pe(i)); max = Math.max(max, counts.size); }
    expect(max).toBe(1024);
  });

  it("keeps a count while the cap is reached but not exceeded", () => {
    const { counts, evictions } = tracker();
    counts.stalled(pe(1));
    for (let i = 0; i < 1023; i++) counts.stalled(pe(1000 + i));
    counts.stalled(pe(1));
    expect(evictions).toEqual([[pe(1), 2]]);
  });

  it("counts only pe bundle URLs", () => {
    const { counts } = tracker();
    for (const url of [null, undefined, "", "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js", "https://g.alicdn.com/dynamicjs/pe.js"]) {
      expect(counts.stalled(url)).toBe(false);
    }
    expect(counts.size).toBe(0);
  });
});
