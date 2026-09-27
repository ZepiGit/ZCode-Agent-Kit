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

  it("keeps the inference account sticky when a billing/quota/async lookup needs a JWT it lacks", () => {
    const rotator = createAccountRotator([
      { id: "key-only", credential: { provider: "zai", apiKey: "key-a" } },
      { id: "with-jwt", credential: { provider: "zai", apiKey: "key-b", jwt: "jwt-b" } },
    ]);
    expect(rotator.getCredentialHandle().id).toBe("key-only");
    for (const operation of ["billing", "quota", "async"] as const) {
      // The lookup is served by the JWT-bearing profile ...
      expect(rotator.getCredentialHandle({ operation }).id).toBe("with-jwt");
      // ... but inference stays on the account it was using: a control-plane
      // lookup is not an allowed switch reason.
      expect(rotator.getCredentialHandle().id).toBe("key-only");
      expect(rotator.getCredentialHandle({ operation: "inference" }).id).toBe("key-only");
    }
    expect(rotator.getSelectedId()).toBe("key-only");
  });

  it("list() marks the inference account active even right after a lookup served by another profile", () => {
    const rotator = createAccountRotator([
      { id: "key-only", credential: { provider: "zai", apiKey: "key-a" } },
      { id: "with-jwt", credential: { provider: "zai", apiKey: "key-b", jwt: "jwt-b" } },
    ]);
    expect(rotator.getCredentialHandle().id).toBe("key-only");
    expect(rotator.getCredentialHandle({ operation: "quota" }).id).toBe("with-jwt");
    const states = Object.fromEntries(rotator.list().map((a) => [a.id, a.state]));
    expect(states).toEqual({ "key-only": "active", "with-jwt": "ready" });
    expect(rotator.getCredentialHandle({ operation: "inference" }).id).toBe("key-only");
  });

  it("treats the same wire token as one identity regardless of userId metadata", () => {
    const rotator = createAccountRotator([
      { id: "imported", credential: { provider: "zai", apiKey: "k", jwt: "jwt-same" } },
      { id: "oauth", credential: { provider: "zai", apiKey: "k", jwt: "jwt-same", userId: "user-1" } },
      { id: "other", credential: { provider: "zai", apiKey: "k2", jwt: "jwt-other", userId: "user-2" } },
    ], { plan: "start-plan" });
    const first = rotator.getCredentialHandle();
    expect(first.id).toBe("imported");
    expect(rotator.handleForId("oauth")?.effectiveIdentity).toBe(first.effectiveIdentity);
    rotator.markExhausted(first, "1005");
    // The quarantined token must not be resent through its metadata alias.
    expect(rotator.getCredentialHandle().id).toBe("other");
    expect(rotator.canResendHandle(rotator.handleForId("oauth")!)).toBe(false);
  });
});
