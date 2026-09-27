import { describe, it, expect } from "bun:test";
import { keepaliveFrame } from "./keepalive.js";

describe("keepaliveFrame", () => {
  it("produces a single frame with default text", () => {
    const frame = keepaliveFrame();
    expect(new TextDecoder().decode(frame)).toBe(": keepalive\n\n");
  });

  it("produces a frame with custom text", () => {
    const frame = keepaliveFrame("hello");
    expect(new TextDecoder().decode(frame)).toBe(": hello\n\n");
  });

  it("strips newlines from custom text", () => {
    const frame = keepaliveFrame("a\nb\rc");
    expect(new TextDecoder().decode(frame)).toBe(": a b c\n\n");
  });
});
