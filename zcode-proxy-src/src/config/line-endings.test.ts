// The line-ending helper the proxy shares with the CLI (lib/line-endings.mjs,
// byte-identical copy). The same vectors run under Node in tests/crlf-writers.test.mjs.
import { describe, expect, test } from "bun:test";
import { lineEndingOf, withLineEndingsOf } from "./line-endings.mjs";

describe("line-endings", () => {
  test("a file is CRLF when its CRLF breaks outnumber its bare LF breaks, else LF", () => {
    expect(lineEndingOf("")).toBe("\n");
    expect(lineEndingOf("a\nb\n")).toBe("\n");
    expect(lineEndingOf("a\r\nb\r\n")).toBe("\r\n");
    expect(lineEndingOf("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(lineEndingOf("a\r\nb\nc\n")).toBe("\n");
    expect(lineEndingOf("a\r\nb\n")).toBe("\n");
    expect(lineEndingOf("a\r\nb\r\nc\r\n\n\n\n\n")).toBe("\n");
    expect(lineEndingOf("a\rb\r")).toBe("\n");
  });

  test("text is written with the line endings of the file it goes into", () => {
    expect(withLineEndingsOf("x\r\ny\r\n", "a\nb\r\nc\n")).toBe("a\r\nb\r\nc\r\n");
    expect(withLineEndingsOf("x\ny\n", "a\nb\r\nc\n")).toBe("a\nb\nc\n");
    expect(withLineEndingsOf("", "a\r\n")).toBe("a\n");
    expect(withLineEndingsOf("x\r\n", "no break")).toBe("no break");
  });
});
