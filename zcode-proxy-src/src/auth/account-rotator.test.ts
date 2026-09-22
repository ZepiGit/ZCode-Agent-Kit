import { describe, expect, it } from "bun:test";
import { createAccountRotator } from "./account-rotator.js";
import type { AccountProfile } from "./account-store.js";

const accounts: AccountProfile[] = [
  { id: "a", credential: { provider: "zai", apiKey: "key-a", jwt: "jwt-a" } },
  { id: "b", credential: { provider: "zai", apiKey: "key-b", jwt: "jwt-b" } },
];

describe("account rotator", () => {
  it("keeps one account active until an explicit quota signal rotates it", () => {
    let now = 1000;
    const rotator = createAccountRotator(accounts, { now: () => now, cooldownMs: 10 });
    expect(rotator.getCredentialHandle().id).toBe("a");
    expect(rotator.getCredentialHandle().id).toBe("a");
    rotator.markExhausted("a", "1005");
    expect(rotator.getCredentialHandle().id).toBe("b");
    expect(rotator.getCredentialHandle().id).toBe("b");
    rotator.markExhausted("b", "1005");
    now = 1011;
    expect(rotator.getCredentialHandle().id).toBe("a");
  });

  it("skips exhausted profiles and honors reset time", () => {
    let now = 1000;
    const rotator = createAccountRotator(accounts, { now: () => now, cooldownMs: 10 });
    rotator.markExhausted("a", "1005", now + 100);
    expect(rotator.getCredentialHandle().id).toBe("b");
    expect(rotator.list().find((a) => a.id === "a")?.state).toBe("exhausted");
    now = 1101;
    // Reset makes A eligible again, but the currently active B remains
    // sticky until B itself reports exhaustion.
    expect(rotator.getCredentialHandle().id).toBe("b");
    rotator.markExhausted("b", "1005", now + 100);
    expect(rotator.getCredentialHandle().id).toBe("a");
    expect(rotator.list().find((a) => a.id === "a")?.state).toBe("active");
  });

  it("requires a JWT for start-plan and never exposes secrets in list", () => {
    const rotator = createAccountRotator([
      { id: "api", credential: { provider: "zai", apiKey: "key-api" } },
      accounts[1],
    ], { plan: "start-plan" });
    expect(rotator.getCredential().jwt).toBe("jwt-b");
    const json = JSON.stringify(rotator.list());
    expect(json).not.toContain("jwt-b");
    expect(json).not.toContain("key-b");
  });

  it("clears transient failure and maps arbitrary reasons to safe labels", () => {
    const rotator = createAccountRotator(accounts);
    rotator.markExhausted("a", "upstream leaked secret-value");
    expect(rotator.list().find((a) => a.id === "a")?.lastFailureReason).toBe("quota_exhausted");
    rotator.clearFailure("a");
    expect(rotator.list().find((a) => a.id === "a")?.state).toBe("ready");
  });

  it("binds health changes to the immutable request generation", () => {
    let now = 1000;
    const rotator = createAccountRotator(accounts, { now: () => now, cooldownMs: 100 });
    const first = rotator.getCredentialHandle();
    rotator.markExhausted(first, "1005", now + 1000);
    // A late success from the request that caused the quarantine is stale and
    // must not clear the newer quota generation.
    expect(rotator.clearFailure(first)).toBe(false);
    expect(rotator.list().find((a) => a.id === "a")?.state).toBe("exhausted");
    const second = rotator.getCredentialHandle();
    expect(second.id).toBe("b");
    expect(second.failureGeneration).toBe(0);
  });

  it("does not treat duplicate effective credentials as independent quota", () => {
    const rotator = createAccountRotator([
      { id: "alias-a", credential: { provider: "zai", apiKey: "same" } },
      { id: "alias-b", credential: { provider: "zai", apiKey: "same" } },
      { id: "independent", credential: { provider: "zai", apiKey: "other" } },
    ]);
    expect(rotator.getCredentialHandle().id).toBe("alias-a");
    rotator.markExhausted("alias-a", "1005");
    expect(rotator.getCredentialHandle().id).toBe("independent");
    // A bare duplicated credential cannot be mapped to an account.
    expect(rotator.idForCredential({ provider: "zai", apiKey: "same" })).toBeUndefined();
  });

  it("applies allow and pause policy before selecting an account", () => {
    const rotator = createAccountRotator(accounts, {
      allowedAccountIds: ["b"],
      pausedAccountIds: ["b"],
    });
    expect(() => rotator.getCredentialHandle()).toThrow(/No usable account/);
    expect(rotator.list().find((a) => a.id === "a")?.state).toBe("paused");
    expect(rotator.list().find((a) => a.id === "b")?.state).toBe("paused");
  });
});
