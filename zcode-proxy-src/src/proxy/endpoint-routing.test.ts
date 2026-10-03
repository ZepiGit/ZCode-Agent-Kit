import { describe, expect, it } from "bun:test";
import { EndpointRoutingService } from "./endpoint-routing.js";
import type { ProxyIdentity } from "../config/types.js";

const identity: ProxyIdentity = { appVersion: "3.8.1", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai" };

const ZAI_ANTHROPIC = "https://api.z.ai/api/anthropic/v1/messages";
const ZAI_ULTRA = "https://zcode.z.ai/api/v1/ultra-zai/anthropic/v1/messages";
const UNKNOWN_ROUTE = "https://api.z.ai/api/anthropic/v1/unknown";

function okConfigFetch(...bodies: string[]): typeof fetch {
  let call = 0;
  return (async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("EndpointRoutingService", () => {
  it("requires an HTTPS origin except for loopback test servers", () => {
    expect(() => new EndpointRoutingService({ identity, origin: "http://evil.example" })).toThrow();
    expect(() => new EndpointRoutingService({ identity, origin: "https://zcode.z.ai/path" })).toThrow();
    expect(() => new EndpointRoutingService({ identity, origin: "http://127.0.0.1:8787" })).not.toThrow();
  });

  it("uses the client-configs route with app_version/platform and rejects redirects", async () => {
    let seenUrl = "";
    let seenRedirect: RequestRedirect | undefined;
    const svc = new EndpointRoutingService({
      identity,
      platform: "linux-x64",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        seenUrl = String(url);
        seenRedirect = init?.redirect;
        return new Response('{"code":0,"data":{}}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await svc.resolve(UNKNOWN_ROUTE);
    expect(seenUrl).toBe("https://zcode.z.ai/api/v1/client/configs?app_version=3.8.1&platform=linux-x64");
    expect(seenRedirect).toBe("error");
  });

  it("keeps the official gateway routes available when the control plane is unavailable", async () => {
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: (async () => { throw new Error("network down"); }) as unknown as typeof fetch,
    });
    expect(await svc.resolve(ZAI_ANTHROPIC)).toEqual({
      routed: true,
      url: ZAI_ULTRA,
    });
  });

  it("config fetch carries the control-plane identity set with a BARE User-Agent (no SDK suffix)", async () => {
    // CL-26/CL-27: only the LLM request path carries the
    // `ai-sdk/anthropic/...` UA suffix and the csn header set — control-plane
    // fetches (endpoint routing) keep the HRt identity shape and bare UA.
    let seenUserAgent = "";
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seenUserAgent = headers.get("User-Agent") ?? "";
        return new Response(JSON.stringify({
          code: 0,
          data: { proxyEndpoint: { mapping: [{ from: UNKNOWN_ROUTE, to: ZAI_ULTRA }] } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    await svc.resolve(UNKNOWN_ROUTE);
    expect(seenUserAgent).toBe("ZCode/3.8.1");
  });

  it("rewrites a mapped URL and preserves the query string", async () => {
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: okConfigFetch(JSON.stringify({
        code: 0,
        data: { proxyEndpoint: { mapping: [{ from: UNKNOWN_ROUTE, to: ZAI_ULTRA }] } },
      })),
    });
    const resolved = await svc.resolve(`${UNKNOWN_ROUTE}?beta=true`);
    expect(resolved.routed).toBeTrue();
    expect(resolved.url).toBe(`${ZAI_ULTRA}?beta=true`);
  });

  it("returns the original URL for unmatched hosts and paths", async () => {
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: okConfigFetch(JSON.stringify({
        code: 0,
        data: { proxyEndpoint: { mapping: [{ from: UNKNOWN_ROUTE, to: ZAI_ULTRA }] } },
      })),
    });
    for (const url of [
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
      "https://open.bigmodel.cn/api/anthropic/v1/unknown",
      "https://zcode.z.ai/api/v1/zcode-plan/chat/completions",
    ]) {
      const resolved = await svc.resolve(url);
      expect(resolved.routed).toBeFalse();
      expect(resolved.url).toBe(url);
    }
  });

  it("matches a from-URL with a trailing slash against a request without one", async () => {
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: okConfigFetch(JSON.stringify({
        code: 0,
        data: { proxyEndpoint: { mapping: [{ from: `${UNKNOWN_ROUTE}/`, to: ZAI_ULTRA }] } },
      })),
    });
    const resolved = await svc.resolve(UNKNOWN_ROUTE);
    expect(resolved.routed).toBeTrue();
    expect(resolved.url).toBe(ZAI_ULTRA);
  });

  it("fails open (original URL) and retries only after the failure cooldown", async () => {
    let clock = 0;
    let calls = 0;
    const unknownUrl = "https://api.z.ai/api/coding/paas/v4/chat/completions";
    const svc = new EndpointRoutingService({
      identity,
      now: () => clock,
      fetchImpl: (async () => {
        calls++;
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    const resolved = await svc.resolve(unknownUrl);
    expect(resolved.routed).toBeFalse();
    expect(resolved.url).toBe(unknownUrl);
    await svc.resolve(unknownUrl);
    expect(calls).toBe(1); // within the 30s cooldown: no refetch
    clock = 31_000;
    await svc.resolve(unknownUrl);
    expect(calls).toBe(2); // cooldown expired: retried
  });

  it("fails open when the envelope is malformed or code != 0", async () => {
    for (const bad of ['{"code":5,"data":{}}', '{"code":0}', "not-json-at-all"]) {
      const svc = new EndpointRoutingService({ identity, fetchImpl: okConfigFetch(bad) });
      const resolved = await svc.resolve(UNKNOWN_ROUTE);
      expect(resolved.routed).toBeFalse();
    }
  });

  it("caches a successful snapshot for the success TTL and refreshes after expiry", async () => {
    let clock = 0;
    let calls = 0;
    const svc = new EndpointRoutingService({
      identity,
      now: () => clock,
      fetchImpl: (async () => {
        calls++;
        return new Response(JSON.stringify({
          code: 0,
          data: { proxyEndpoint: { mapping: calls === 1 ? [{ from: UNKNOWN_ROUTE, to: ZAI_ULTRA }] : [] } },
        }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect((await svc.resolve(UNKNOWN_ROUTE)).routed).toBeTrue();
    clock = 200_000;
    expect((await svc.resolve(UNKNOWN_ROUTE)).routed).toBeTrue(); // still cached (TTL 300s)
    clock = 301_000;
    expect((await svc.resolve(UNKNOWN_ROUTE)).routed).toBeFalse(); // refreshed to empty mapping
    expect(calls).toBe(2);
  });

  it("deduplicates concurrent refreshes into a single fetch", async () => {
    let calls = 0;
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: (async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return new Response(JSON.stringify({
          code: 0,
          data: { proxyEndpoint: { mapping: [{ from: UNKNOWN_ROUTE, to: ZAI_ULTRA }] } },
        }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const [a, b, c] = await Promise.all([
      svc.resolve(UNKNOWN_ROUTE),
      svc.resolve(UNKNOWN_ROUTE),
      svc.resolve(UNKNOWN_ROUTE),
    ]);
    expect(calls).toBe(1);
    expect(a.routed && b.routed && c.routed).toBeTrue();
  });

  it("attaches the QSt header set (identity minus X-ZCode-Agent) + Accept on the public config fetch", async () => {
    let seen: Headers | undefined;
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        seen = new Headers(init?.headers);
        return new Response('{"code":0,"data":{}}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await svc.resolve(UNKNOWN_ROUTE, "keyid.keysecret");
    expect(seen!.get("x-api-key")).toBeNull();
    expect(seen!.get("user-agent")).toBe("ZCode/3.8.1");
    expect(seen!.get("x-zcode-app-version")).toBe("3.8.1");
    expect(seen!.get("x-zcode-agent")).toBeNull();
    expect(seen!.get("accept")).toBe("application/json");
  });

  it("refuses HTTPS redirects to an untrusted origin", async () => {
    const svc = new EndpointRoutingService({ identity, fetchImpl: okConfigFetch(JSON.stringify({ code: 0, data: { proxyEndpoint: { mapping: [{ from: UNKNOWN_ROUTE, to: 'https://attacker.invalid/collect' }] } } })) });
    expect(await svc.resolve(UNKNOWN_ROUTE)).toEqual({ routed: false, url: UNKNOWN_ROUTE });
  });

  it("rejects non-https mapping entries and keeps routing off for that snapshot", async () => {
    const svc = new EndpointRoutingService({
      identity,
      fetchImpl: okConfigFetch(JSON.stringify({
        code: 0,
        data: { proxyEndpoint: { mapping: [{ from: UNKNOWN_ROUTE, to: "http://evil.example/v1" }] } },
      })),
    });
    const resolved = await svc.resolve(UNKNOWN_ROUTE);
    expect(resolved.routed).toBeFalse();
  });
});
