import { describe, expect, test } from "bun:test";
import { describeGuestError, isGuestOriginError } from "./guest-error.js";

/** The exact stack from the field crash report (v4.5.5, TUI mode). */
function fieldCrash(): Error {
  const err = new ReferenceError("moveBy is not defined");
  err.stack =
    "ReferenceError: moveBy is not defined\n" +
    "    at tE (https://g.alicdn.com/captcha-frontend/FeiLin/1.5.1/" +
    "feilin008.489f1fe42772a97d510f162902b33c35c004ce7746ca3f4696c42f8d1f677670.js:1:169658)";
  return err;
}

function withStack(message: string, stack: string): Error {
  const err = new Error(message);
  err.stack = stack;
  return err;
}

describe("guest metadata counterexamples (issue 32)", () => {
  const source = "https://g.alicdn.com/captcha/feilin071.js:1:1";
  for (const [id, name, callback, url, marker] of [
    ["function", "TypeError", "SyntheticFunctionCredential", source, "SyntheticFunctionCredential"],
    ["class identifier", "SyntheticClassCredential", "callback", source, "SyntheticClassCredential"],
    ["fragment", "TypeError", "callback", "https://g.alicdn.com/captcha/feilin071.js#SyntheticFragmentCredential:1:1", "SyntheticFragmentCredential"],
    ["filename", "TypeError", "callback", "https://g.alicdn.com/captcha/SyntheticFilenameCredential.js:1:1", "SyntheticFilenameCredential"],
    ["path", "TypeError", "callback", "https://g.alicdn.com/SyntheticPathCredential/feilin071.js:1:1", "SyntheticPathCredential"],
    ["query", "TypeError", "callback", "https://g.alicdn.com/captcha/feilin071.js?token=SyntheticQueryCredential:1:1", "SyntheticQueryCredential"],
    ["controls", "TypeError", "SyntheticControlCredential\u001b[31m", source, "SyntheticControlCredential"],
    ["long selected frame", "TypeError", "SyntheticCallback".repeat(200), source, "SyntheticCallback"],
  ]) {
    test(`never echoes guest ${id}`, () => {
      const err = withStack("synthetic diagnostic message", `Error: synthetic diagnostic message\n    at ${callback} (${url})`);
      err.name = name!;
      const rendered = describeGuestError(err);
      expect(rendered).not.toContain(marker!);
      expect(rendered).not.toMatch(/[\r\n\u001b]/);
      expect(rendered.length).toBeLessThan(300);
      expect(rendered).toMatch(/len=28 sha256=[0-9a-f]{64}/);
    });
  }
  test("the message line is never rendered as a source frame", () => {
    const message = "prefix https://g.alicdn.com/x.js suffix SyntheticHostFrameCredential";
    const err = withStack(message, `Error: ${message}\n    at host (/app/host.ts:1:1)`);
    expect(isGuestOriginError(err)).toBe(false);
    expect(describeGuestError(err)).not.toContain("SyntheticHostFrameCredential");
    expect(describeGuestError(err)).not.toContain("resource-");
  });
});

describe("guest-origin classification", () => {
  test("the captcha SDK crash that killed the TUI is attributed to the guest", () => {
    expect(isGuestOriginError(fieldCrash())).toBe(true);
  });

  test("host faults stay fatal", () => {
    // The v4.5.2 crash shape: a Bun-internal timer stripped of `.unref()`.
    // It is a real proxy defect and must never be swallowed as guest noise.
    const unref = withStack(
      "setTimeout(() => {}, 0).unref is not a function",
      "TypeError: …unref is not a function\n    at node:_http_server:512:9",
    );
    expect(isGuestOriginError(unref)).toBe(false);
    expect(
      isGuestOriginError(withStack("boom", "Error: boom\n    at buildFrame (/app/src/tui/frame.ts:88:3)")),
    ).toBe(false);
  });

  test("an unattributable error is treated as a host fault", () => {
    // No evidence must never mean "assume guest": that would silently mask
    // genuine crashes behind a log line.
    expect(isGuestOriginError(new Error("no stack recorded"))).toBe(false);
    expect(isGuestOriginError({ message: "not even an Error" })).toBe(false);
    expect(isGuestOriginError(undefined)).toBe(false);
  });

  test("lookalike hosts are not guest evidence", () => {
    expect(
      isGuestOriginError(withStack("x", "at f (https://evil-alicdn.com.attacker.net/x.js:1:1)")),
    ).toBe(false);
    expect(
      isGuestOriginError(withStack("x", "at f (https://cdn.example.com/p?ref=alicdn.com)")),
    ).toBe(false);
  });

  test("every host serving the SDK counts, including subdomains and cause chains", () => {
    expect(isGuestOriginError(withStack("x", "at https://o.alicdn.com/captcha-frontend/a.js:1:1"))).toBe(true);
    expect(isGuestOriginError(withStack("x", "at https://captcha.ap-southeast-1.aliyuncs.com/x.js:1:1"))).toBe(true);
    const wrapped = withStack("wrapper", "Error: wrapper\n    at host (/app/x.ts:1:1)");
    (wrapped as { cause?: unknown }).cause = fieldCrash();
    expect(isGuestOriginError(wrapped)).toBe(true);
  });

  test("a self-referential cause chain terminates", () => {
    const a = withStack("a", "at /app/a.ts:1:1");
    const b = withStack("b", "at /app/b.ts:1:1");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(isGuestOriginError(a)).toBe(false);
  });

  test("the guest log line is metadata-only: class, message length+hash, bundle filename", () => {
    const line = describeGuestError(fieldCrash());
    expect(line).toContain("ReferenceError");
    expect(line).toContain("len=21"); // "moveBy is not defined".length
    expect(line).toMatch(/sha256=[0-9a-f]{64}/);
    expect(line).toContain("feilin008");
    // The message TEXT is guest-controlled and can carry page/token data.
    expect(line).not.toContain("moveBy is not defined");
    expect(line).not.toContain("https://");
  });

  test("a synthetic secret in the guest message or stack URL never reaches the diagnostics", () => {
    const SECRET = "SYNTHETIC-SECRET-MARKER-9f2c41ab";
    const err = withStack(
      `solver callback failed jwt=${SECRET}`,
      `Error: solver callback failed jwt=${SECRET}\n    at f (https://g.alicdn.com/captcha-frontend/FeiLin/feilin008.js:1:1?access_token=${SECRET})`,
    );
    const line = describeGuestError(err);
    expect(line).toContain("feilin008");
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("access_token");
  });

  test("a guest-controlled error class name is not echoed verbatim", () => {
    const err = withStack("x", "at f (https://g.alicdn.com/captcha/a.js:1:1)");
    (err as { name?: unknown }).name = `Bearer ${"y".repeat(40)}`;
    const line = describeGuestError(err);
    expect(line).not.toContain("Bearer");
    expect(line.startsWith("Error ")).toBe(true);
  });

  test("guest diagnostics stay bounded even for huge messages and stacks", () => {
    const huge = withStack(
      "m".repeat(100_000),
      `at f (https://g.alicdn.com/captcha/a.js:1:1)\n${"s".repeat(100_000)}`,
    );
    expect(describeGuestError(huge).length).toBeLessThan(300);
  });
});
