import { describe, expect, test } from "bun:test";
import { LogPane } from "./log-pane.js";

describe("LogPane", () => {
  test("push appends and tracks count", () => {
    const pane = new LogPane();
    pane.push("one");
    pane.push("two");
    expect(pane.count).toBe(2);
    expect(pane.view(10).lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  test("strips ANSI codes", () => {
    const pane = new LogPane();
    pane.push("\x1b[31merror\x1b[0m part");
    expect(pane.view(10).lines[0]!.text).toBe("error part");
  });

  test("splits embedded newlines into rows", () => {
    const pane = new LogPane();
    pane.push("a\nb\nc");
    expect(pane.count).toBe(3);
    expect(pane.view(10).lines.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  test("trailing newline does not create an empty row", () => {
    const pane = new LogPane();
    pane.push("a\n");
    expect(pane.count).toBe(1);
  });

  test("evicts oldest beyond capacity", () => {
    const pane = new LogPane(5);
    for (let i = 0; i < 8; i++) pane.push(`line-${i}`);
    expect(pane.count).toBe(5);
    expect(pane.view(10).lines.map((l) => l.text)).toEqual([
      "line-3", "line-4", "line-5", "line-6", "line-7",
    ]);
  });

  test("follows the tail by default", () => {
    const pane = new LogPane();
    for (let i = 0; i < 20; i++) pane.push(`l${i}`);
    expect(pane.following).toBe(true);
    expect(pane.view(5).lines.map((l) => l.text)).toEqual(["l15", "l16", "l17", "l18", "l19"]);
    expect(pane.view(5).fromBottom).toBe(0);
  });

  test("scrollUp freezes the viewport, scrollDown to 0 resumes following", () => {
    const pane = new LogPane();
    for (let i = 0; i < 20; i++) pane.push(`l${i}`);
    pane.scrollUp(3);
    expect(pane.following).toBe(false);
    expect(pane.view(5).lines.map((l) => l.text)).toEqual(["l12", "l13", "l14", "l15", "l16"]);
    expect(pane.view(5).fromBottom).toBe(3);
    pane.scrollDown(2);
    expect(pane.view(5).fromBottom).toBe(1);
    pane.scrollDown(10);
    expect(pane.following).toBe(true);
    expect(pane.view(5).lines.at(-1)!.text).toBe("l19");
  });

  test("scrollUp is clamped to the buffer length", () => {
    const pane = new LogPane();
    for (let i = 0; i < 10; i++) pane.push(`l${i}`);
    pane.scrollUp(1000);
    expect(pane.view(3).lines.map((l) => l.text)).toEqual(["l0", "l1", "l2"]);
    expect(pane.view(3).fromBottom).toBe(7);
  });

  test("clear empties and resumes following", () => {
    const pane = new LogPane();
    for (let i = 0; i < 10; i++) pane.push(`l${i}`);
    pane.scrollUp(5);
    pane.clear();
    expect(pane.count).toBe(0);
    expect(pane.following).toBe(true);
    expect(pane.view(5).lines).toEqual([]);
  });

  test("keeps levels and monotonic sequence", () => {
    const pane = new LogPane();
    pane.push("info line", "info");
    pane.push("warn line", "warn");
    pane.push("error line", "error");
    const view = pane.view(10).lines;
    expect(view.map((l) => l.level)).toEqual(["info", "warn", "error"]);
    expect(view[0]!.seq < view[1]!.seq && view[1]!.seq < view[2]!.seq).toBe(true);
  });

  test("viewport height is clamped to at least 1", () => {
    const pane = new LogPane();
    pane.push("a");
    pane.push("b");
    expect(pane.view(0).lines).toHaveLength(1);
  });
});

// The pane's two bounds (§9 BOUNDS): 2,000 lines and 8 MB.
const KB64 = 64 * 1024;
const MB8 = 8 * 1024 * 1024;

describe("LogPane caps: 2,000 lines and 8 MB", () => {
  test("many small lines are capped at 2,000 lines, newest kept", () => {
    const pane = new LogPane();
    for (let i = 0; i < 100_000; i++) pane.push(`[req ${i}] POST /v1/messages 200`);
    expect(pane.count).toBe(2000);
    expect(pane.view(1).lines[0]!.text).toBe("[req 99999] POST /v1/messages 200");
    expect(pane.view(2000).lines[0]!.text).toBe("[req 98000] POST /v1/messages 200");
  });

  test("64 KB lines are capped by bytes: 8 MB holds 128 of them, newest kept", () => {
    const pane = new LogPane();
    for (let i = 0; i < 2000; i++) pane.push(String(i % 10).repeat(KB64));
    expect(pane.count).toBe(128);
    expect(pane.bytes).toBe(MB8);
    const kept = pane.view(128).lines;
    expect(kept[0]!.text).toBe("2".repeat(KB64)); // line 1872
    expect(kept.at(-1)!.text).toBe("9".repeat(KB64)); // line 1999
  });

  test("one line larger than 8 MB is truncated to 8 MB, its head kept", () => {
    const pane = new LogPane();
    pane.push("before");
    pane.push("H" + "x".repeat(MB8 + 1024 * 1024));
    expect(pane.count).toBe(1);
    expect(pane.bytes).toBe(MB8);
    const text = pane.view(1).lines[0]!.text;
    expect(text.length).toBe(MB8);
    expect(text.startsWith("Hxxx")).toBe(true);
    // The next line evicts the giant one: the pane never holds more than 8 MB.
    pane.push("after");
    expect(pane.view(10).lines.map((l) => l.text)).toEqual(["after"]);
    expect(pane.bytes).toBe(5);
  });

  test("CJK lines count their UTF-8 bytes: 127 lines of 21,846 × 中 (65,538 bytes) fit", () => {
    const pane = new LogPane();
    for (let i = 0; i < 2000; i++) pane.push("中".repeat(21_846));
    expect(pane.count).toBe(127);
    expect(pane.bytes).toBe(8_323_326);
  });

  test("an oversized CJK line is cut on a code-point boundary", () => {
    const pane = new LogPane();
    pane.push("中".repeat(3_000_000)); // 9,000,000 bytes
    const text = pane.view(1).lines[0]!.text;
    expect(text).toBe("中".repeat(2_796_202)); // 8,388,606 bytes, the last whole 中 under 8 MB
    expect(pane.bytes).toBe(8_388_606);
  });

  test("an oversized emoji line keeps whole surrogate pairs", () => {
    const pane = new LogPane();
    pane.push("x" + "😀".repeat(2_500_000)); // 10,000,001 bytes
    const text = pane.view(1).lines[0]!.text;
    // 1 + 4 × 2,097,151 = 8,388,605 UTF-8 bytes; one more emoji would pass
    // 8 MB. In memory: 4,194,303 UTF-16 units × 2 = 8,388,606 bytes, the cost.
    expect(text).toBe("x" + "😀".repeat(2_097_151));
    expect(pane.bytes).toBe(8_388_606);
  });

  test("ASCII mixed with one emoji is held two bytes per UTF-16 unit, and counted so", () => {
    // 65,534 × x + 😀 = 65,536 UTF-16 units (131,072 bytes in memory) and
    // 65,538 UTF-8 bytes: the larger cost counts, so 64 lines fit, not 127.
    const pane = new LogPane();
    for (let i = 0; i < 2000; i++) pane.push("x".repeat(KB64 - 2) + "😀");
    expect(pane.count).toBe(64);
    expect(pane.bytes).toBe(MB8);
  });

  test("an oversized mixed line stays within 8 MB in memory", () => {
    const pane = new LogPane();
    pane.push("😀" + "x".repeat(MB8 + 1024 * 1024));
    const text = pane.view(1).lines[0]!.text;
    // Cut at 4 MB of UTF-8: 😀 + 4,194,300 × x = 4,194,302 UTF-16 units.
    expect(text).toBe("😀" + "x".repeat(4_194_300));
    expect(pane.bytes).toBe(8_388_604);
  });

  test("a long-line flood while scrolled keeps scrollback within the shrunk pane", () => {
    const pane = new LogPane();
    for (let i = 0; i < 2000; i++) pane.push(`l${i}`);
    pane.scrollUp(1500);
    for (let i = 0; i < 300; i++) pane.push(`d${i} ` + "x".repeat(KB64));
    expect(pane.count).toBe(127);
    expect(pane.following).toBe(false);
    const view = pane.view(10);
    expect(view.total).toBe(127);
    expect(view.lines).toHaveLength(10);
    expect(view.fromBottom).toBe(117); // pinned to the oldest rows
    // One screen down per 10 lines: 127 lines of scrollback, not 1,500.
    pane.scrollDown(127);
    expect(pane.following).toBe(true);
    expect(pane.view(1).lines[0]!.text.startsWith("d299 ")).toBe(true);
  });
});
