import { describe, expect, it } from "bun:test";
import {
  CaptchaSdkError, CaptchaSdkIncompatibleError, classifyCaptchaError,
  isCaptchaDuplicateError, isCaptchaIpBlockError, normalizeCaptchaError,
} from "./captcha-token.js";

describe("isCaptchaIpBlockError", () => {
  it("detects the 'too many captcha requests' family", () => {
    expect(
      isCaptchaIpBlockError(
        'verify rejected: {"verifyCode":"F005","Message":"too many captcha requests"}',
      ),
    ).toBe(true);
    expect(
      isCaptchaIpBlockError('Request was denied due to risk control. retry later'),
    ).toBe(true);
    expect(isCaptchaIpBlockError("rate limit exceeded")).toBe(true);
    expect(isCaptchaIpBlockError("frequent requests detected")).toBe(true);
  });

  it("does not flag F008 duplicates (local retry, not an IP block)", () => {
    expect(
      isCaptchaIpBlockError('duplicate certifyId "F008"'),
    ).toBe(false);
    expect(
      isCaptchaIpBlockError('{"verifyCode":"F008"}'),
    ).toBe(false);
  });

  it("does not flag stalls/timeouts (retryable without an IP reset)", () => {
    expect(isCaptchaIpBlockError("captcha solve stall pe=pe.062.abc.js")).toBe(false);
    expect(isCaptchaIpBlockError("captcha solve timeout pe=pe.089")).toBe(false);
    expect(isCaptchaIpBlockError("solver returned empty")).toBe(false);
  });

  it("ignores happy-path / non-captcha messages", () => {
    expect(isCaptchaIpBlockError("")).toBe(false);
    expect(isCaptchaIpBlockError("captcha failed after 4 attempts: duplicate certifyId ?")).toBe(false);
  });
});

describe("safe CAPTCHA failure categories", () => {
  it("classifies raw SDK status and message fields before discarding sensitive text", () => {
    for (const raw of [{ status: 429 }, { statusCode: "429" }, { code: 429 }, { Message: "too many captcha requests PRIVATE_MARKER" }, new Error("HTTP 429 PRIVATE_MARKER")]) {
      const error = normalizeCaptchaError(raw);
      expect(error).toBeInstanceOf(CaptchaSdkError);
      expect(classifyCaptchaError(error)).toBe("rate-limit");
      expect(error.message).not.toContain("PRIVATE_MARKER");
      expect(error.stack).not.toContain("PRIVATE_MARKER");
      expect(error.cause).toBeUndefined();
    }
  });

  it("gives F008 precedence over generic rate-limit text without retaining the payload", () => {
    const error = normalizeCaptchaError({ verifyCode: "F008", Message: "too many requests PRIVATE_MARKER" });
    expect(classifyCaptchaError(error)).toBe("duplicate");
    expect(isCaptchaDuplicateError(error)).toBe(true);
    expect(isCaptchaIpBlockError(error)).toBe(false);
    expect(error.message).not.toContain("PRIVATE_MARKER");
  });

  it("ignores diagnostic hashes and metadata even when they contain complete status tokens", () => {
    for (const message of [
      'captcha solve stall | captchaMetadata={"sha256":"a429bf008","at":429}',
      'captcha solve timeout captchaMetadata={"status":429,"verifyCode":"F008","message":"rate limit"}',
      'onError: len=429 sha256=f008',
      'failure guestErrors(1): rate limit F008',
      'failure sha256=f008',
      'failure a429b af008b _F008_ F008suffix status429 429abc',
    ]) {
      expect(classifyCaptchaError(message)).toBe("other");
      expect(isCaptchaDuplicateError(message)).toBe(false);
      expect(isCaptchaIpBlockError(message)).toBe(false);
    }
    expect(classifyCaptchaError({ metadata: { status: 429 }, sha256: "f008", payload: "rate limit" })).toBe("other");
    expect(classifyCaptchaError('HTTP 429 | captchaMetadata={"verifyCode":"F008"}')).toBe("rate-limit");
    expect(classifyCaptchaError('duplicate (F008) | captchaMetadata={"status":429}')).toBe("duplicate");
  });

  it("keeps structured classification authoritative when diagnostics are appended", () => {
    const error = normalizeCaptchaError(new Error("ordinary failure"));
    error.message += ' | captchaMetadata={"sha256":"a429bf008","message":"rate limit"}';
    expect(classifyCaptchaError(error)).toBe("other");
    expect(normalizeCaptchaError(error)).toBe(error);
  });

  it("preserves only host-created incompatible diagnostics, never a guest code or category", () => {
    const trusted = new CaptchaSdkIncompatibleError(true, undefined);
    expect(normalizeCaptchaError(trusted)).toBe(trusted);
    expect(classifyCaptchaError(trusted)).toBe("incompatible");
    const forged = { code: "CAPTCHA_SDK_INCOMPATIBLE", category: "incompatible", message: "PRIVATE_MARKER" };
    const error = normalizeCaptchaError(forged);
    expect(classifyCaptchaError(error)).toBe("other");
    expect(error.message).not.toContain("PRIVATE_MARKER");
  });

  it("does not invoke guest serialization or leak a throwing field accessor", () => {
    const error = normalizeCaptchaError({
      get message() { throw new Error("PRIVATE_MARKER"); },
      status: 429,
      toJSON() { throw new Error("PRIVATE_MARKER"); },
      toString() { throw new Error("PRIVATE_MARKER"); },
    });
    expect(classifyCaptchaError(error)).toBe("rate-limit");
    expect(error.message).not.toContain("PRIVATE_MARKER");
  });
});