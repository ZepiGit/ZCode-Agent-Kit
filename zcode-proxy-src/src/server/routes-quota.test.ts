/**
 * Regression tests for the GET /quota billing snapshot (routes-quota.ts).
 *
 * Covers the review round for PR #41 commit 66959ae:
 *  - the platform/arch fingerprint must be built from real values with env
 *    overrides (never `identity.platform/arch` → "undefined-undefined");
 *  - empty/whitespace env overrides fall back instead of producing `-x64`;
 *  - both billing calls share the same fingerprint;
 *  - upstream snake_case and live-observed camelCase balance fields both map;
 *  - non-numeric / NaN values never leak into the JSON snapshot.
 */
import { describe, it, expect } from "bun:test";
import os from "node:os";
import { collectQuotaSnapshot, handleQuota, clearQuotaCache } from "./routes-quota.js";
import { createFetchHandler } from "./server.js";
import { AuthManager } from "../auth/manager.js";
import { createAccountRotator } from "../auth/account-rotator.js";
import type { loadCredential } from "../auth/store.js";
import type { ProxyConfig } from "../config/types.js";
import type { Credential } from "../auth/types.js";
import { fixtureSecret } from "../test-fixtures.js";

const PLAN_KEY = `${fixtureSecret("quota-key")}.${fixtureSecret("quota-secret")}`;

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    server: { port: 0, host: "127.0.0.1" },
    auth: {},
    provider: "zai",
    plan: "coding-plan",
    providers: {
      zai: { anthropicBase: "https://api.z.ai/api/anthropic", openaiBase: "https://api.z.ai/api/coding/paas/v4" },
      bigmodel: { anthropicBase: "https://open.bigmodel.cn/api/anthropic", openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
    },
    defaultModel: "glm-4.6",
    models: ["glm-4.6"],
    identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai" },
    clientIdentity: { mode: "observe", ttlSeconds: 900, maxSessions: 1024 },
    responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
    endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
    clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
    mcp: { enabled: true, webSearch: true, webReader: false, zread: false },
    async: {
      enabled: false,
      origin: "https://zcode.z.ai",
      pollIntervalMs: 10,
      keepAliveIntervalMs: 5,
      maxWaitMs: 0,
      maxRetries: 3,
      settleTimeoutMs: 100,
      controlTimeoutMs: 1000,
      defaultModel: "",
    },
    claim: { enabled: false, auto: true, origin: "https://billing.example", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
    ...overrides,
  };
}

/** Minimal valid start-plan JWT payload (iat only, no exp). */
const IAT = Math.floor(Date.now() / 1000) - 8 * 24 * 3600; // 8 days old, still valid per jwt-age.ts docs
function makeJwt(): string {
  const payload = Buffer.from(JSON.stringify({ iat: IAT })).toString("base64url");
  return `h.${payload}.s`;
}

const fakeCred: Credential = { apiKey: PLAN_KEY, provider: "zai", jwt: makeJwt() };
const loadFake = async (): Promise<Credential> => fakeCred;
const loadNone = async (): Promise<Credential | null> => null;

interface BillingCall {
  url: string;
  headers: Record<string, string>;
}

/** Mock fetch that records billing calls and answers both endpoints. */
function makeBillingFetch(opts: { code?: number; body?: unknown } = {}): { fetchImpl: typeof fetch; calls: BillingCall[] } {
  const calls: BillingCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/api/v1/zcode-plan/billing/")) {
      calls.push({ url: u, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      const code = opts.code ?? 0;
      return new Response(JSON.stringify({ code, msg: "ok", data: opts.body ?? { server_time: 1720000000, balances: [], plans: [] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { type: "not_found", message: u } }), { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Set/restore identity env overrides around a test body. */
async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["ZCODE_IDENTITY_PLATFORM", "ZCODE_IDENTITY_ARCH"]) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("collectQuotaSnapshot fingerprint", () => {
  it("no overrides → real platform/arch, never undefined-undefined", async () => {
    await withEnv({ ZCODE_IDENTITY_PLATFORM: undefined, ZCODE_IDENTITY_ARCH: undefined }, async () => {
      const { fetchImpl, calls } = makeBillingFetch();
      const snap = await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
      expect(calls.length).toBe(2);
      const expected = `${process.platform}-${os.arch()}`;
      expect(snap.errors).toEqual([]);
      for (const c of calls) {
        const url = new URL(c.url);
        expect(url.searchParams.get("platform")).toBe(expected);
        expect(url.searchParams.get("app_version")).toBe("test-1.0.0");
        expect(c.headers["X-Platform"]).toBe(expected);
      }
      expect(calls[0].url).toContain("/billing/balance?");
      expect(calls[1].url).toContain("/billing/preview?");
    });
  });

  it("valid overrides → both billing calls use the overridden fingerprint", async () => {
    await withEnv({ ZCODE_IDENTITY_PLATFORM: "linux", ZCODE_IDENTITY_ARCH: "x64" }, async () => {
      const { fetchImpl, calls } = makeBillingFetch();
      await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
      for (const c of calls) {
        const url = new URL(c.url);
        expect(url.searchParams.get("platform")).toBe("linux-x64");
        expect(c.headers["X-Platform"]).toBe("linux-x64");
      }
    });
  });

  it("empty/whitespace overrides fall back to real values (no `-x64` / `linux-`)", async () => {
    await withEnv({ ZCODE_IDENTITY_PLATFORM: "  ", ZCODE_IDENTITY_ARCH: "" }, async () => {
      const { fetchImpl, calls } = makeBillingFetch();
      await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
      const expected = `${process.platform}-${os.arch()}`;
      for (const c of calls) {
        expect(new URL(c.url).searchParams.get("platform")).toBe(expected);
      }
    });
  });

  it("no JWT credential → handleQuota returns 503 quota_unavailable envelope", async () => {
    clearQuotaCache();
    const { fetchImpl, calls } = makeBillingFetch();
    const resp = await handleQuota(makeConfig(), fetchImpl, loadNone);
    expect(resp.status).toBe(503);
    const body = (await resp.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("quota_unavailable");
    expect(calls.length).toBe(0);
  });

  it("upstream nonzero code surfaces in errors, snapshot still 200", async () => {
    clearQuotaCache();
    const { fetchImpl } = makeBillingFetch({ code: 3012 });
    const snap = await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
    expect(snap.errors.length).toBe(2);
    expect(snap.errors[0]).toContain("3012");
  });
});

describe("collectQuotaSnapshot response mapping", () => {
  it("snake_case balance fields map (live-observed shape)", async () => {
    const body = {
      server_time: 1720000100,
      balances: [{ show_name: "Free", total_units: 1000, used_units: 250, remaining_units: 750, unit_type: "token", expires_at: 1735689600 }],
    };
    const { fetchImpl } = makeBillingFetch({ body });
    const snap = await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
    expect(snap.balances).toEqual([{ showName: "Free", remainingUnits: 750, totalUnits: 1000, usedUnits: 250, unitType: "token", expiresAt: 1735689600 }]);
    expect(snap.serverTime).toBe(1720000100);
  });

  it("camelCase aliases (unitType/expiresAt) map — not silently dropped", async () => {
    const body = {
      server_time: 1720000100,
      balances: [{ show_name: "Free", total_units: 100, used_units: 10, remaining_units: 90, unitType: "token", expiresAt: 1735689600 }],
    };
    const { fetchImpl } = makeBillingFetch({ body });
    const snap = await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
    expect(snap.balances[0].unitType).toBe("token");
    expect(snap.balances[0].expiresAt).toBe(1735689600);
  });

  it("numeric-string timestamps/units coerce; NaN/garbage never reach the JSON", async () => {
    const body = {
      server_time: "1720000100",
      balances: [
        { show_name: "Free", total_units: "100", used_units: "x", remaining_units: "50", expires_at: "1735689600" },
        { show_name: "Bad", total_units: NaN, used_units: null, remaining_units: 7 },
      ],
    };
    const { fetchImpl } = makeBillingFetch({ body });
    const snap = await collectQuotaSnapshot(makeConfig(), fetchImpl, loadFake);
    expect(snap.serverTime).toBe(1720000100);
    expect(snap.balances[0].totalUnits).toBe(100);
    expect(snap.balances[0].expiresAt).toBe(1735689600);
    // Unknown/garbage values are null — an invented 0 would make a partially
    // known balance look exhausted (audit §10: no fabricated zeros).
    expect(snap.balances[0].usedUnits).toBeNull(); // "x" is garbage
    expect(snap.balances[1].totalUnits).toBeNull(); // NaN
    expect(snap.balances[1].usedUnits).toBeNull(); // null upstream
    expect(snap.balances[1].remainingUnits).toBe(7);
    expect(snap.balances[1].expiresAt).toBeUndefined();
    // freshness metadata is always present
    expect(typeof snap.asOf).toBe("string");
    expect(snap.cached).toBe(false);
  });
});

describe("handleQuota singleflight + cache", () => {
  it("partitions concurrent billing snapshots and singleflight by account", async () => {
    clearQuotaCache();
    const first = makeBillingFetch({ body: { balances: [{ show_name: "first", remaining_units: 10 }] } });
    const second = makeBillingFetch({ body: { balances: [{ show_name: "second", remaining_units: 20 }] } });
    const responses = await Promise.all([
      handleQuota(makeConfig(), first.fetchImpl, loadFake, "pool:first"),
      handleQuota(makeConfig(), second.fetchImpl, loadFake, "pool:second"),
      handleQuota(makeConfig(), first.fetchImpl, loadFake, "pool:first"),
    ]);
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(bodies.map(body => body.balances[0].remainingUnits)).toEqual([10, 20, 10]);
    expect(first.calls.length).toBe(2);
    expect(second.calls.length).toBe(2);
    const cached = await handleQuota(makeConfig(), second.fetchImpl, loadFake, "pool:second");
    expect((await cached.json()).cached).toBe(true);
    expect(second.calls.length).toBe(2);
    clearQuotaCache();
  });

  it("parallel /quota calls share one billing round-trip (singleflight)", async () => {
    clearQuotaCache();
    const { fetchImpl, calls } = makeBillingFetch();
    const [a, b, c] = await Promise.all([
      handleQuota(makeConfig(), fetchImpl, loadFake),
      handleQuota(makeConfig(), fetchImpl, loadFake),
      handleQuota(makeConfig(), fetchImpl, loadFake),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
    // exactly two billing calls (balance + preview), not six
    expect(calls.length).toBe(2);
    const first = (await a.json()) as { cached: boolean };
    expect(first.cached).toBe(false);
  });

  it("within the TTL, follow-up calls are served from cache with cached=true", async () => {
    clearQuotaCache();
    const { fetchImpl, calls } = makeBillingFetch();
    await handleQuota(makeConfig(), fetchImpl, loadFake);
    const second = await handleQuota(makeConfig(), fetchImpl, loadFake);
    expect(calls.length).toBe(2, "no additional billing calls within TTL");
    const body = (await second.json()) as { cached: boolean; asOf: string };
    expect(body.cached).toBe(true);
    expect(typeof body.asOf).toBe("string");
    clearQuotaCache();
  });

  it("a failed collection is not cached (next call retries)", async () => {
    clearQuotaCache();
    const { fetchImpl, calls } = makeBillingFetch();
    const none = await handleQuota(makeConfig(), fetchImpl, loadNone);
    expect(none.status).toBe(503);
    const ok = await handleQuota(makeConfig(), fetchImpl, loadFake);
    expect(ok.status).toBe(200);
    clearQuotaCache();
  });

  // ZAK-009: a caller joining an in-flight fetch must receive the COMPLETE
  // snapshot once it resolves — never the null placeholder spread as a
  // malformed-but-200 "cached" body.
  it("a caller joining an in-flight fetch awaits the real snapshot (no null placeholder body)", async () => {
    clearQuotaCache();
    const base = makeBillingFetch();
    let releaseUpstream: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { releaseUpstream = resolve; });
    const gated: typeof fetch = async (url, init) => {
      await gate;
      return base.fetchImpl(url, init);
    };
    const first = handleQuota(makeConfig(), gated, loadFake); // starts the fetch, not awaited
    const second = handleQuota(makeConfig(), gated, loadFake); // joins the in-flight entry
    releaseUpstream?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodyA = (await a.json()) as Record<string, unknown>;
    const bodyB = (await b.json()) as Record<string, unknown>;
    // both bodies carry real quota fields — the joined one is not a spread null
    expect(bodyA.asOf).toBeTruthy();
    expect(bodyB.asOf).toBeTruthy();
    expect(bodyB).toEqual(bodyA);
    expect(base.calls.length).toBe(2, "singleflight still coalesces billing calls");
    clearQuotaCache();
  });

  // Audit backlog: a failed collection propagates to every joiner, is not
  // cached, and the next call starts exactly one fresh collection.
  it("a failed collection fans out to joiners and is retried cleanly", async () => {
    clearQuotaCache();
    const failingLoad: typeof loadCredential = () => { throw new Error("credential store down"); };
    const first = handleQuota(makeConfig(), makeBillingFetch().fetchImpl, failingLoad);
    const second = handleQuota(makeConfig(), makeBillingFetch().fetchImpl, failingLoad); // joins the in-flight fetch
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    // next call: exactly one new collection attempt (two billing calls)
    const { fetchImpl, calls } = makeBillingFetch();
    const third = await handleQuota(makeConfig(), fetchImpl, loadFake);
    expect(third.status).toBe(200);
    expect(calls.length).toBe(2);
    clearQuotaCache();
  });

  // Audit backlog: the TTL is anchored at COMPLETION, not request start — a
  // slow collection must still be served fresh from cache immediately after.
  it("TTL starts at completion: slow collection stays cached right after finishing", async () => {
    clearQuotaCache();
    const base = makeBillingFetch();
    let releaseUpstream: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { releaseUpstream = resolve; });
    const gated: typeof fetch = async (url, init) => {
      await gate;
      return base.fetchImpl(url, init);
    };
    const realNow = Date.now;
    const skewMs = 20_000; // QUOTA_CACHE_TTL_MS is 15s — advance past it mid-flight
    let skew = 0;
    globalThis.Date.now = () => realNow() + skew;
    try {
      const first = handleQuota(makeConfig(), gated, loadFake); // starts, not awaited
      skew = skewMs; // clock advances while the collection is in flight
      releaseUpstream?.();
      await first;
      // if the TTL were anchored at request start, this call would refetch
      const second = await handleQuota(makeConfig(), base.fetchImpl, loadFake);
      const body = (await second.json()) as { cached: boolean };
      expect(body.cached).toBe(true, "completed snapshot is still fresh right after completion");
      expect(base.calls.length).toBe(2, "no refetch after completion despite in-flight clock skew");
    } finally {
      globalThis.Date.now = realNow;
      clearQuotaCache();
    }
  });
});

describe("GET /quota account pool", () => {
  it("uses the selected pooled JWT and keeps account snapshots separate", async () => {
    clearQuotaCache();
    const accounts = ["first", "second"].map(id => ({
      id,
      credential: { apiKey: fixtureSecret(`quota-${id}`), provider: "zai" as const, jwt: `${makeJwt()}.${id}` },
    }));
    const auth = new AuthManager({ accountRotator: createAccountRotator(accounts) });
    const authorizations: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).authorization;
      authorizations.push(authorization);
      const remaining = authorization.endsWith(".first") ? 10 : 20;
      return Response.json({ code: 0, data: { balances: [{ show_name: "Free", remaining_units: remaining }] } });
    }) as typeof fetch;
    const handler = createFetchHandler({ config: makeConfig(), auth, fetchImpl });
    const first = await (await handler(new Request("http://localhost/quota"))).json();
    const second = await (await handler(new Request("http://localhost/quota"))).json();
    const cachedFirst = await (await handler(new Request("http://localhost/quota"))).json();
    expect(first.balances[0].remainingUnits).toBe(10);
    expect(second.balances[0].remainingUnits).toBe(20);
    expect(cachedFirst.balances[0].remainingUnits).toBe(10);
    expect(cachedFirst.cached).toBe(true);
    expect(authorizations).toEqual(accounts.flatMap(account => [
      `Bearer ${account.credential.jwt}`, `Bearer ${account.credential.jwt}`,
    ]));
    clearQuotaCache();
  });

  it("returns quota_unavailable for an empty enabled pool without legacy fallback", async () => {
    clearQuotaCache();
    const auth = new AuthManager({ accountRotator: createAccountRotator([]) });
    auth.setOAuthCredential(fakeCred);
    const { fetchImpl, calls } = makeBillingFetch();
    const handler = createFetchHandler({ config: makeConfig(), auth, fetchImpl });
    const response = await handler(new Request("http://localhost/quota"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.type).toBe("quota_unavailable");
    expect(calls.length).toBe(0);
    clearQuotaCache();
  });
});
