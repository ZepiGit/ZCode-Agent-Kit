import { describe, expect, test } from "bun:test";
import { filterAcceptEncoding } from "./upstream.js";

describe("filterAcceptEncoding", () => {
  test("drops zstd advertised by bun-based clients", () => {
    expect(filterAcceptEncoding("gzip, deflate, br, zstd")).toBe("gzip, deflate, br");
  });

  test("keeps identity-only headers untouched", () => {
    expect(filterAcceptEncoding("identity")).toBe("identity");
  });

  test("keeps q-value tokens for safe encodings", () => {
    expect(filterAcceptEncoding("br;q=1.0, zstd;q=0.9, gzip;q=0.8")).toBe("br;q=1.0, gzip;q=0.8");
  });

  test("falls back to gzip when nothing safe remains", () => {
    expect(filterAcceptEncoding("zstd, zstd;q=1")).toBe("gzip");
  });

  test("handles empty header", () => {
    expect(filterAcceptEncoding("")).toBe("gzip");
  });
});
