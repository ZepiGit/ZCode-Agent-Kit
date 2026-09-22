import { describe, expect, it } from "bun:test";
import { createAccountRotator } from "./account-rotator.js";
import type { AccountProfile } from "./account-store.js";

const accounts: AccountProfile[] = [
  { id: "a", credential: { provider: "zai", apiKey: "key-a", jwt: "jwt-a" } },
  { id: "b", credential: { provider: "zai", apiKey: "key-b", jwt: "jwt-b" } },
];

describe("account rotator", () => {
  it("selects deterministic least-recently-used credentials", () => {
    let now = 1000;
    const rotator = createAccountRotator(accounts, { now: () => now });
    expect(rotator.getCredentialHandle().id).toBe("a");
    expect(rotator.getCredentialHandle().id).toBe("b");
    expect(rotator.getCredentialHandle().id).toBe("a");
  });

  it("skips exhausted profiles and honors reset time", () => {
    let now = 1000;
    const rotator = createAccountRotator(accounts, { now: () => now, cooldownMs: 10 });
    rotator.markExhausted("a", "1005", now + 100);
    expect(rotator.getCredentialHandle().id).toBe("b");
    expect(rotator.list().find((a) => a.id === "a")?.state).toBe("exhausted");
    now = 1101;
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
});

