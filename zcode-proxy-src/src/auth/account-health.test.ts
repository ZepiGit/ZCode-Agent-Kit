import { describe, expect, it } from "bun:test";
import { accountVerdict, buildHealthReport, parseLiveQuota, parseLiveStatus, renderHealthText, UNREACHABLE_MESSAGE, type OfflineAccount, type VerdictInput } from "./account-health.js";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const bucket = (remaining: number | null, total: number | null, showName = "GLM") =>
  ({ showName, remainingUnits: remaining, totalUnits: total, usedUnits: remaining === null || total === null ? null : total - remaining, unitType: "token" });
const input = (overrides: Partial<VerdictInput> = {}): VerdictInput => ({
  state: "ready", paused: false, exhaustedUntil: null, quotaSource: "live", balances: [bucket(900, 1000)], errors: [], ...overrides,
});
const offline = (id: string, overrides: Partial<OfflineAccount> = {}): OfflineAccount => ({
  id, provider: "zai", plan: "start-plan", paused: false, state: "ready", lastUsedAt: null, exhaustedUntil: null, ...overrides,
});

describe("accountVerdict", () => {
  it("applies precedence paused > blocked > expired/invalid > auth_error > exhausted > quota", () => {
    const everything = input({ paused: true, state: "blocked", errors: ["balance: provider_401"], exhaustedUntil: NOW + 1, balances: [] });
    expect(accountVerdict(everything, NOW)).toBe("paused");
    expect(accountVerdict({ ...everything, paused: false }, NOW)).toBe("blocked");
    expect(accountVerdict({ ...everything, paused: false, state: "expired" }, NOW)).toBe("expired");
    expect(accountVerdict({ ...everything, paused: false, state: "invalid" }, NOW)).toBe("invalid");
    expect(accountVerdict({ ...everything, paused: false, state: "exhausted" }, NOW)).toBe("auth_error");
    expect(accountVerdict(input({ state: "exhausted", exhaustedUntil: NOW + 1, errors: ["preview: provider_3012"] }), NOW)).toBe("auth_error");
    expect(accountVerdict(input({ state: "exhausted", exhaustedUntil: NOW + 1, balances: [] }), NOW)).toBe("exhausted");
  });

  it("treats a past cooldown as over", () => {
    expect(accountVerdict(input({ exhaustedUntil: NOW - 1 }), NOW)).toBe("ok");
  });

  it("separates no quota packages, empty, low and ok", () => {
    expect(accountVerdict(input({ balances: [] }), NOW)).toBe("no_quota_data");
    expect(accountVerdict(input({ balances: [bucket(0, 1000), bucket(0, 50, "Flash")] }), NOW)).toBe("empty");
    expect(accountVerdict(input({ balances: [bucket(99, 1000), bucket(5000, 5000, "Flash")] }), NOW)).toBe("low");
    expect(accountVerdict(input({ balances: [bucket(100, 1000)] }), NOW)).toBe("ok");
    expect(accountVerdict(input({ balances: [bucket(0, 1000), bucket(500, 1000, "Flash")] }), NOW)).toBe("low");
  });

  it("does not guess when quota is missing, failed or has only unknown numbers", () => {
    expect(accountVerdict(input({ quotaSource: null, balances: [] }), NOW)).toBe("unknown");
    expect(accountVerdict(input({ quotaSource: "error", balances: [], errors: ["timeout"] }), NOW)).toBe("unknown");
    expect(accountVerdict(input({ balances: [], errors: ["balance: provider_500"] }), NOW)).toBe("unknown");
    expect(accountVerdict(input({ balances: [bucket(null, 1000)] }), NOW)).toBe("unknown");
  });

  it("never calls partial evidence usable or empty", () => {
    expect(accountVerdict(input({ errors: ["preview: provider_500"] }), NOW)).toBe("unknown");
    expect(accountVerdict(input({ balances: [bucket(0, 1000), bucket(null, null, "Flash")] }), NOW)).toBe("unknown");
    expect(accountVerdict(input({ balances: [bucket(900, 1000), bucket(null, 1000, "Flash")] }), NOW)).toBe("unknown");
  });

  it("flags duplicate logins", () => {
    expect(accountVerdict(input({ quotaSource: "duplicate", balances: [] }), NOW)).toBe("duplicate");
    expect(accountVerdict(input({ duplicateOf: "zai-1" }), NOW)).toBe("duplicate");
  });
});

describe("buildHealthReport", () => {
  it("merges live state and quota, computes percentages and counts usable accounts", () => {
    const report = buildHealthReport(
      [offline("zai-1"), offline("zai-2"), offline("zai-3", { paused: true })],
      {
        activeAccountId: "zai-2",
        accounts: [
          { id: "zai-1", state: "ready", lastUsedAt: null, exhaustedUntil: null },
          { id: "zai-2", state: "active", lastUsedAt: NOW - 90_000, exhaustedUntil: null },
          { id: "zai-3", state: "paused", lastUsedAt: null, exhaustedUntil: null },
        ],
      },
      {
        accounts: [
          { accountId: "zai-1", source: "live", balances: [], errors: [] },
          { accountId: "zai-2", source: "live", balances: [bucket(398_611, 3_000_000)], errors: [] },
        ],
        totals: [],
      },
      NOW,
    );
    expect(report.accounts.map((account) => [account.id, account.verdict])).toEqual([["zai-1", "no_quota_data"], ["zai-2", "ok"], ["zai-3", "paused"]]);
    expect(report.accounts[1].balances[0].percentRemaining).toBe(13.3);
    expect(report.summary).toMatchObject({ usable: 1, total: 3 });
    expect(report.proxy).toEqual({ reachable: true, quotaAvailable: true });
    const text = renderHealthText(report);
    expect(text).toContain("usable: 1 of 3");
    expect(text).toContain("398,611/3,000,000 (13%)");
    expect(text).toMatch(/\* zai-2 /);
    expect(text).toContain("no quota packages");
  });

  it("passes only machine error codes through and collapses free-form error text", () => {
    const report = buildHealthReport([offline("zai-1")], { activeAccountId: null, accounts: [{ id: "zai-1", state: "ready", lastUsedAt: null, exhaustedUntil: null }] },
      { accounts: [{ accountId: "zai-1", source: "error", balances: [], errors: ["fetch failed: Bearer eyJ-secret-token", "balance: provider_1113", "timeout at https://x/y"] }], totals: [] }, NOW);
    expect(report.accounts[0].errors).toEqual(["quota_query_failed", "balance: provider_1113"]);
    expect(JSON.stringify(report) + renderHealthText(report)).not.toContain("secret");
  });

  it("treats malformed live bodies as missing data", () => {
    expect(parseLiveStatus({ error: { code: "unauthorized" } })).toBeNull();
    expect(parseLiveStatus({ accounts: [{ id: 1, state: "ready" }] })).toBeNull();
    expect(parseLiveStatus({ activeAccountId: "a", accounts: [{ id: "a", state: "active", lastUsedAt: "soon" }] }))
      .toEqual({ activeAccountId: "a", accounts: [{ id: "a", state: "active", plan: null, lastUsedAt: null, exhaustedUntil: null }] });
    expect(parseLiveQuota({ accounts: [{ accountId: "a", source: "live", balances: "none", errors: [] }], totals: [] })).toBeNull();
    const quota = parseLiveQuota({ accounts: [{ accountId: "a", source: "live", balances: [{ showName: "GLM", remainingUnits: "5", totalUnits: 10 }], errors: [] }], totals: [] });
    expect(quota?.accounts[0].balances[0]).toMatchObject({ remainingUnits: null, totalUnits: 10 });
  });

  it("reports every account as unknown when the proxy is unreachable", () => {
    const report = buildHealthReport([offline("zai-1", { exhaustedUntil: NOW + 60_000 }), offline("zai-2")], null, null, NOW);
    expect(report.proxy.reachable).toBe(false);
    expect(report.accounts.every((account) => account.verdict === "unknown")).toBe(true);
    expect(report.summary.usable).toBe(0);
    expect(renderHealthText(report)).toContain(UNREACHABLE_MESSAGE);
  });
});
