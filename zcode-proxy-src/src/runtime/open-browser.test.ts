import { describe, expect, it, mock, afterEach } from "bun:test";

// The authorize URL comes back from the provider, so the launcher must never
// splice it into a command line or hand a non-web scheme to the shell.
const spawned: Array<{ cmd: string; args: string[] }> = [];

mock.module("node:child_process", () => ({
  spawn(cmd: string, args: string[]) {
    spawned.push({ cmd, args });
    return { on() {}, unref() {} };
  },
}));

const { openBrowser } = await import("./open-browser.js");

afterEach(() => { spawned.length = 0; });

describe("openBrowser", () => {
  it("passes the URL as its own argument, never inside a command string", () => {
    openBrowser("https://zcode.z.ai/oauth?code=abc");
    expect(spawned).toHaveLength(1);
    const { cmd, args } = spawned[0];
    expect(cmd).not.toBe("cmd.exe");
    // The URL must appear verbatim as a single argv entry.
    expect(args).toContain("https://zcode.z.ai/oauth?code=abc");
    // No argument may embed the URL inside a larger shell command.
    expect(args.some((a) => a.includes("start ") || a.includes('""'))).toBe(false);
  });

  it("refuses schemes that are not http or https", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/html,<script>1</script>",
      "javascript:alert(1)",
    ]) {
      openBrowser(url);
    }
    expect(spawned).toHaveLength(0);
  });

  it("refuses malformed input instead of throwing", () => {
    expect(() => openBrowser("not a url")).not.toThrow();
    expect(spawned).toHaveLength(0);
  });

  it("does not let quotes in the URL escape into a second argument", () => {
    openBrowser('https://example.test/?x="&calc');
    expect(spawned).toHaveLength(1);
    // Percent-encoded by URL parsing, so no raw quote survives.
    expect(spawned[0].args.join(" ")).not.toContain('"');
  });
});
