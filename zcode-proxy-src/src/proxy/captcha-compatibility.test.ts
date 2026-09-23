import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { inspectCaptchaScript } from "../../captcha-compatibility.mjs";

describe("offline static CAPTCHA compatibility inspection", () => {
  it("reports current bytes and supplied retrieval time without interpreting marker presence as success", () => {
    const bytes = Buffer.from("// initAliyunCaptcha startTracelessVerification show\nthrow new Error('must never execute');");
    const report = inspectCaptchaScript(bytes, 1_234);
    expect(report).toEqual({
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"), fetchedAt: 1_234,
      markers: { initAliyunCaptcha: true, startTracelessVerification: true, show: true },
    });
  });
  it("leaves retrieval provenance unknown and does not match method substrings", () => {
    expect(inspectCaptchaScript(Buffer.from("showcase startTracelessVerificationOld"))).toEqual({
      sha256: crypto.createHash("sha256").update("showcase startTracelessVerificationOld").digest("hex"),
      fetchedAt: null,
      markers: { initAliyunCaptcha: false, startTracelessVerification: false, show: false },
    });
    expect(() => inspectCaptchaScript(Buffer.from(""), -1)).toThrow(RangeError);
  });
});
