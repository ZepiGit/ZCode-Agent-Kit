import { describe, expect, it, spyOn } from "bun:test";
import { solveTraceless } from "./captcha-happy.js";
import * as diagnostics from "./captcha-diagnostics.js";
import { CaptchaSdkError, CaptchaSdkIncompatibleError, classifyCaptchaError } from "./captcha-token.js";

// Offline DOM injection uses the same SDK callback and failure path as a solve.
// Keep opt-in disabled even in an old-source scratch copy; it must never fetch.
async function solveFixture(instance: string, init = `options.getInstance(${instance});`) {
  const optIn = process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA;
  delete process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA;
  const verifyParam = Buffer.from(JSON.stringify({ certifyId: "fixture", sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40) })).toString("base64");
  try {
    const result = await solveTraceless({ timeoutMs: 1_000, stallMs: 5_000, reuseWindow: false }, {
      primeCookies: async () => [],
      documentHtml: `<!doctype html><html><body><div id="cap"></div><button id="btn"></button><script>window.initAliyunCaptcha = function(options) { var param = ${JSON.stringify(verifyParam)}; ${init} };</script></body></html>`,
    });
    return { result, verifyParam };
  } finally {
    if (optIn === undefined) delete process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA;
    else process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA = optIn;
  }
}

describe("solver SDK callback contract", () => {
  it("retains a functional traceless start through the actual solve path", async () => {
    const { result, verifyParam } = await solveFixture("{ startTracelessVerification: function() { options.success({verifyParam:param}); }, show: function() { throw new Error('wrong fallback'); } }");
    expect(result).toBe(verifyParam);
  });

  it("uses callable show when a truthy primary property is not callable", async () => {
    const { result, verifyParam } = await solveFixture("{ startTracelessVerification: true, show: function() { options.success({verifyParam:param}); } }");
    expect(result).toBe(verifyParam);
  });

  it("rejects incompatible SDK instances with a trusted local category", async () => {
    const error = await fixtureFailure("options.getInstance({ startTracelessVerification: true });");
    expect(error).toBeInstanceOf(CaptchaSdkIncompatibleError);
    expect(classifyCaptchaError(error)).toBe("incompatible");
  });

  it("preserves a real onError provider limit after redaction and diagnostic attachment", async () => {
    const error = await fixtureFailure('options.onError({Message:"too many captcha requests PRIVATE_SDK_MARKER", securityToken:"PRIVATE_SDK_MARKER"});');
    expect(error).toBeInstanceOf(CaptchaSdkError);
    expect(classifyCaptchaError(error)).toBe("rate-limit");
    expect(error.message).toContain("captchaMetadata=");
    expect(error.message).not.toContain("PRIVATE_SDK_MARKER");
  });

  it("normalizes fail callback HTTP status without retaining its payload", async () => {
    const error = await fixtureFailure('options.fail({status:429, body:"PRIVATE_SDK_MARKER"});');
    expect(classifyCaptchaError(error)).toBe("rate-limit");
    expect(error.message).not.toContain("PRIVATE_SDK_MARKER");
  });

  it("keeps rejected F008 verification distinct from rate limits", async () => {
    const error = await fixtureFailure('options.success({verifyResult:false, verifyCode:"F008", Message:"too many requests PRIVATE_SDK_MARKER"});');
    expect(error).toBeInstanceOf(CaptchaSdkError);
    expect(classifyCaptchaError(error)).toBe("duplicate");
    expect(error.message).not.toContain("PRIVATE_SDK_MARKER");
  });

  it("classifies rejected verification rate limits before discarding result fields", async () => {
    const error = await fixtureFailure('options.success({verifyResult:false, verifyCode:"F005", Message:"rate limit PRIVATE_SDK_MARKER"});');
    expect(classifyCaptchaError(error)).toBe("rate-limit");
    expect(error.message).not.toContain("PRIVATE_SDK_MARKER");
  });

  it("never treats attached metadata hashes as provider status", async () => {
    const metadata = spyOn(diagnostics, "captchaFailureSummary").mockReturnValue('{"sha256":"a429bf008","fetchedAt":429}');
    try {
      const error = await fixtureFailure('options.onError({message:"ordinary failure PRIVATE_SDK_MARKER"});');
      expect(error.message).toContain("a429bf008");
      expect(classifyCaptchaError(error)).toBe("other");
      expect(classifyCaptchaError(error.message)).toBe("other");
      expect(error.message).not.toContain("PRIVATE_SDK_MARKER");
    } finally { metadata.mockRestore(); }
  });

  it("redacts thrown start, show and init errors, including forged trusted error codes", async () => {
    const output: string[] = [];
    const stderr = spyOn(process.stderr, "write").mockImplementation((chunk: any) => { output.push(String(chunk)); return true; });
    try {
      for (const init of [
        'options.getInstance({startTracelessVerification:function(){throw new Error("PRIVATE_SDK_MARKER");}});',
        'options.getInstance({show:function(){throw new Error("PRIVATE_SDK_MARKER");}});',
        'throw new Error("PRIVATE_SDK_MARKER");',
        'options.success({get verifyParam(){throw new Error("PRIVATE_SDK_MARKER");}});',
        'throw {code:"CAPTCHA_SDK_INCOMPATIBLE", category:"incompatible", message:"PRIVATE_SDK_MARKER"};',
      ]) {
        const error = await fixtureFailure(init);
        expect(error).toBeInstanceOf(CaptchaSdkError);
        expect(classifyCaptchaError(error)).toBe("other");
        expect(error.message).not.toContain("PRIVATE_SDK_MARKER");
        expect(error.stack).not.toContain("PRIVATE_SDK_MARKER");
        expect(JSON.stringify(error)).not.toContain("PRIVATE_SDK_MARKER");
      }
      expect(output.join("")).not.toContain("PRIVATE_SDK_MARKER");
    } finally { stderr.mockRestore(); }
  });
});

async function fixtureFailure(init: string): Promise<Error> {
  try { await solveFixture("{}", init); }
  catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("SDK failure fixture unexpectedly succeeded");
}
