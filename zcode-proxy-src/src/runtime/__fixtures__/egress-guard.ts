/**
 * Test preload (`bun --preload`): a spawned proxy under test may only fetch
 * loopback hosts. Any other host is refused and reported on stderr as
 * `EGRESS-BLOCKED <host>`, so a test can assert that nothing tried to leave
 * the machine. Never loaded by the product.
 */
const realFetch = globalThis.fetch;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostOf(input: Request | string | URL): string {
  try {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    return url.hostname;
  } catch {
    return "";
  }
}

globalThis.fetch = Object.assign(
  async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const host = hostOf(input);
    if (!LOOPBACK.has(host)) {
      process.stderr.write(`EGRESS-BLOCKED ${host || "?"}\n`);
      throw new TypeError(`egress to ${host || "?"} blocked by the test guard`);
    }
    return realFetch(input, init);
  },
  realFetch,
) as typeof fetch;
