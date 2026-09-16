import { describe, expect, it } from "bun:test";
import { isParsableJs } from "./captcha-happy.js";

// A cached CDN bundle that was truncated mid-write must be detected so the
// interceptors refetch it. The check parses without executing the source.
const VALID = 'var a=1;function f(b){return {x:b,y:[1,2,3]};}f(a);';

describe("cached bundle parse check", () => {
  it("accepts a complete bundle", () => {
    expect(isParsableJs(Buffer.from(VALID))).toBe(true);
  });

  it("rejects truncation at the byte level", () => {
    // Pin the exact partition. A weaker assertion (e.g. "some prefix was
    // rejected") still passes if the check blindly accepts long input, which is
    // the regression this test exists to catch.
    const accepted: number[] = [];
    const rejected: number[] = [];
    for (let i = 1; i < VALID.length; i++) {
      (isParsableJs(Buffer.from(VALID.slice(0, i))) ? accepted : rejected).push(i);
    }
    // The accepted prefixes are the ones that happen to be valid JavaScript on
    // their own, such as "v" being an expression or "var a=1;" a statement.
    expect(accepted).toEqual([1, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 46, 47, 50]);
    expect(rejected).toHaveLength(35);
  });

  it("rejects unbalanced and malformed input", () => {
    for (const src of [
      "function f(){",
      "var a = {x:1",
      'var s = "unterminated',
      "})]}",
      "var a = ;;;",
    ]) {
      expect(isParsableJs(Buffer.from(src))).toBe(false);
    }
  });

  it("accepts legacy HTML comment syntax found in older browser bundles", () => {
    // Rejecting these would make a valid entry look corrupt and refetch forever.
    expect(isParsableJs(Buffer.from("<!-- legacy\nvar a=1;"))).toBe(true);
    expect(isParsableJs(Buffer.from("var a=1;\n--> trailing"))).toBe(true);
  });

  it("never executes the bundle it is checking", () => {
    // The cached bytes are third-party CDN code. Parsing must stay compile-only:
    // this body would set the marker and throw if it were ever run.
    const marker = "__captchaParseProbe";
    (globalThis as Record<string, unknown>)[marker] = "untouched";
    try {
      const hostile = `globalThis.${marker} = "EXECUTED"; throw new Error("body ran");`;
      expect(isParsableJs(Buffer.from(hostile))).toBe(true);
      expect((globalThis as Record<string, unknown>)[marker]).toBe("untouched");
    } finally {
      delete (globalThis as Record<string, unknown>)[marker];
    }
  });

  it("reports unusable input instead of throwing at the caller", () => {
    // The interceptors rely on a boolean; a decode failure must not escape.
    const exploding = { toString() { throw new Error("ERR_STRING_TOO_LONG"); } };
    expect(isParsableJs(exploding as unknown as Buffer)).toBe(false);
  });

  it("stays correct when one parser instance is reused", () => {
    for (let i = 0; i < 200; i++) {
      expect(isParsableJs(Buffer.from(VALID))).toBe(true);
      expect(isParsableJs(Buffer.from("function f(){"))).toBe(false);
    }
  });
});
