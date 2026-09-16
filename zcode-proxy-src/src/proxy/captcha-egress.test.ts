import { describe, expect, it } from "bun:test";
import { isAllowedRequestUrl } from "./captcha-happy.js";

// Guest code from the captcha CDN chooses the request URLs that reach the
// interceptors, so the allowlist is a trust boundary rather than a hint.
describe("captcha egress allowlist", () => {
  it("allows the captcha CDN and provider hosts over https", () => {
    for (const url of [
      "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
      "https://zcode.z.ai/api/v1/client/configs",
      "https://captcha.aliyuncs.com/verify",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(true);
    }
  });

  it("refuses loopback, metadata and private targets", () => {
    for (const url of [
      "https://127.0.0.1:8457/v1/models",
      "https://localhost/v1/models",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/internal",
      "https://192.168.1.10/admin",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });

  it("refuses non-https schemes, including local file reads", () => {
    for (const url of [
      "file:///etc/passwd",
      "http://o.alicdn.com/x.js",
      "data:text/html,<script>1</script>",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });

  it("matches the hostname, not a substring anywhere in the URL", () => {
    for (const url of [
      "https://attacker.test/x?ref=alicdn.com",
      "https://alicdn.com.attacker.test/x.js",
      "https://notalicdn.com/x.js",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });

  it("rejects malformed input instead of throwing", () => {
    for (const url of ["", "not a url", "https://"]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });
});
