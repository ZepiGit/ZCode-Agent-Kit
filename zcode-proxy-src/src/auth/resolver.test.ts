/**
 * Tests for coding plan key resolver.
 * @see .omo/plans/zcode-proxy.md Task 10
 */
import { describe, it, expect } from "bun:test";
import { KeyResolver } from "./resolver.js";
import { fixtureSecret } from "../test-fixtures.js";

const BIZ_TOKEN = fixtureSecret("resolver-biz-token");
const CREATED_API_KEY = fixtureSecret("resolver-created-key");
const FRESH_API_KEY = fixtureSecret("resolver-fresh-key");
const COPY_SECRET_KEY = fixtureSecret("resolver-copy-secret");
const FLOW_API_KEY = fixtureSecret("resolver-flow-key");
const FLOW_SECRET = fixtureSecret("resolver-flow-secret");

function bizResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(responses: Record<string, (body?: string) => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body as string | undefined;
    for (const [pattern, handler] of Object.entries(responses)) {
      if (url.includes(pattern)) return handler(body);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("KeyResolver", () => {
  it("resolveZaiBizToken THROWS on shape drift (access_token missing) instead of returning undefined (CL-06)", async () => {
    const fetchImpl = mockFetch({
      "/auth/z/login": () => new Response(JSON.stringify({ renamed_token: "biz_token_123" }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    });
    const resolver = new KeyResolver(fetchImpl);
    await expect(resolver.resolveZaiBizToken("access_abc")).rejects.toThrow(/unexpected shape/);
  });

  it("resolveZaiBizToken exchanges access token for biz token", async () => {
    const fetchImpl = mockFetch({
      "/auth/z/login": () => new Response(JSON.stringify({
        access_token: BIZ_TOKEN,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const resolver = new KeyResolver(fetchImpl);
    const bizToken = await resolver.resolveZaiBizToken("access_abc");
    expect(bizToken).toBe(BIZ_TOKEN);
  });

  it("resolveCustomerInfo picks default org using bundle field names", async () => {
    const fetchImpl = mockFetch({
      "getCustomerInfo": () => bizResponse({
        organizations: [
          { organizationId: "org1", organizationName: "Some Org", projects: [] },
          { organizationId: "org2", organizationName: "默认机构", projects: [
            { projectId: "proj1", projectName: "默认项目" },
            { projectId: "proj2", projectName: "Other" },
          ]},
        ],
      }),
    });
    const resolver = new KeyResolver(fetchImpl);
    const { orgId, projectId } = await resolver.resolveCustomerInfo("https://api.z.ai", "Bearer tok");
    expect(orgId).toBe("org2");
    expect(projectId).toBe("proj1");
  });

  it("resolveCustomerInfo falls back to first org when no default", async () => {
    const fetchImpl = mockFetch({
      "getCustomerInfo": () => bizResponse({
        organizations: [
          { organizationId: "orgA", organizationName: "Org A", projects: [{ projectId: "projA", projectName: "Proj A" }] },
        ],
      }),
    });
    const resolver = new KeyResolver(fetchImpl);
    const { orgId, projectId } = await resolver.resolveCustomerInfo("https://api.z.ai", "Bearer tok");
    expect(orgId).toBe("orgA");
    expect(projectId).toBe("projA");
  });

  it("resolveCustomerInfo throws when no orgs", async () => {
    const fetchImpl = mockFetch({
      "getCustomerInfo": () => bizResponse({ organizations: [] }),
    });
    const resolver = new KeyResolver(fetchImpl);
    expect(resolver.resolveCustomerInfo("https://api.z.ai", "Bearer tok")).rejects.toThrow(/No organizations/);
  });

  it("findOrCreateApiKey finds existing key named zcode-api-key", async () => {
    const fetchImpl = mockFetch({
      "api_keys": () => bizResponse([
        { name: "other-key", apiKey: "xxx" },
        { name: "zcode-api-key", apiKey: "existingApiKey" },
      ]),
    });
    const resolver = new KeyResolver(fetchImpl);
    const result = await resolver.findOrCreateApiKey("https://api.z.ai", "Bearer tok", "org1", "proj1");
    expect(result.apiKey).toBe("existingApiKey");
  });

  it("findOrCreateApiKey creates new key when not found", async () => {
    let createdKey = false;
    const fetchImpl = mockFetch({
      "api_keys": (body) => {
        if (body) {
          createdKey = true;
          return bizResponse({ apiKey: CREATED_API_KEY });
        }
        return bizResponse([]);
      },
    });
    const resolver = new KeyResolver(fetchImpl);
    const result = await resolver.findOrCreateApiKey("https://api.z.ai", "Bearer tok", "org1", "proj1");
    expect(createdKey).toBe(true);
    expect(result.apiKey).toBe(CREATED_API_KEY);
  });

  it("findOrCreateApiKey THROWS when the create response loses apiKey (shape drift, CL-06)", async () => {
    const fetchImpl = mockFetch({
      "api_keys": (body) => {
        if (body) return bizResponse({ key: "renamed-field" }); // drift: apiKey → key
        return bizResponse([]);
      },
    });
    const resolver = new KeyResolver(fetchImpl);
    await expect(resolver.findOrCreateApiKey("https://api.z.ai", "Bearer tok", "org1", "proj1"))
      .rejects.toThrow(/unexpected shape/);
  });

  it("findOrCreateApiKey falls through to create when the listed key entry is malformed (CL-06)", async () => {
    let created = false;
    const fetchImpl = mockFetch({
      "api_keys": (body) => {
        if (body) {
          created = true;
          return bizResponse({ apiKey: FRESH_API_KEY });
        }
        return bizResponse([{ name: "zcode-api-key", apiKey: "" }]);
      },
    });
    const resolver = new KeyResolver(fetchImpl);
    const result = await resolver.findOrCreateApiKey("https://api.z.ai", "Bearer tok", "org1", "proj1");
    expect(created).toBe(true);
    expect(result.apiKey).toBe(FRESH_API_KEY);
  });

  it("getSecretKey retrieves secret via apiKey value", async () => {
    const fetchImpl = mockFetch({
      "copy/": () => bizResponse({ secretKey: COPY_SECRET_KEY }),
    });
    const resolver = new KeyResolver(fetchImpl);
    const secret = await resolver.getSecretKey("https://api.z.ai", "Bearer tok", "org1", "proj1", CREATED_API_KEY);
    expect(secret).toBe(COPY_SECRET_KEY);
  });

  it("resolveCodingPlanCredential returns Z.AI credential with secret", async () => {
    const fetchImpl = mockFetch({
      "/auth/z/login": () => new Response(JSON.stringify({ access_token: "bizTok" }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
      "getCustomerInfo": () => bizResponse({
        organizations: [{ organizationId: "o1", organizationName: "默认机构", projects: [{ projectId: "p1", projectName: "默认项目" }] }],
      }),
      "api_keys/copy": () => bizResponse({ secretKey: FLOW_SECRET }),
      "api_keys": (body) => {
        if (body) return bizResponse({ apiKey: FLOW_API_KEY });
        return bizResponse([]);
      },
    });
    const resolver = new KeyResolver(fetchImpl);
    const cred = await resolver.resolveCodingPlanCredential("accessTok", "zai");
    expect(cred.apiKey).toBe(FLOW_API_KEY);
    expect(cred.secret).toBe(FLOW_SECRET);
    expect(cred.provider).toBe("zai");
  });
});
