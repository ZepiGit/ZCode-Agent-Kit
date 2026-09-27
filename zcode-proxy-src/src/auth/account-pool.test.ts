import { describe, expect, it } from "bun:test";
import { AuthManager } from "./manager.js";
import { createAccountRotator } from "./account-rotator.js";
import { AccountStoreError } from "./account-store.js";
import { resolveClaimJwt } from "../claim/runtime.js";

const first = { id: "one", credential: { apiKey: "pool-one", provider: "zai" as const } };
const second = { id: "two", credential: { apiKey: "pool-two", provider: "zai" as const } };

describe("AuthManager account pool", () => {
  it("uses the configured pool as authoritative and does not fall back to legacy credentials", async () => {
    const auth = new AuthManager({ accountRotator: createAccountRotator([]) });
    auth.setOAuthCredential({ apiKey: "legacy", provider: "zai" });
    await expect(auth.getCredential()).rejects.toThrow(/No usable account/);
  });

  it("marks an exhausted account and selects exactly one replacement", async () => {
    const rotator = createAccountRotator([first, second], { now: () => 1_000, cooldownMs: 60_000 });
    const auth = new AuthManager({ accountRotator: rotator });
    expect((await auth.getCredential()).apiKey).toBe("pool-one");
    const replacement = await auth.recoverCredential(first.credential, "coding-plan", "1005");
    expect(replacement?.apiKey).toBe("pool-two");
    expect(rotator.list().find(a => a.id === "one")?.state).toBe("exhausted");
    // AuthManager's pool recovery is singleflight for concurrent failures.
    const [a, b] = await Promise.all([
      auth.recoverCredential(first.credential, "coding-plan", "1005"),
      auth.recoverCredential(first.credential, "coding-plan", "1005"),
    ]);
    expect(a?.apiKey).toBe("pool-two");
    expect(b?.apiKey).toBe("pool-two");
  });

  it("does not rotate for authentication or model rejection signals", async () => {
    const rotator = createAccountRotator([first, second]);
    const auth = new AuthManager({ accountRotator: rotator });
    expect(await auth.recoverCredential(first.credential, "coding-plan", "401")).toBeNull();
    expect(await auth.recoverCredential(first.credential, "coding-plan", "3012")).toBeNull();
    expect(rotator.list().every(a => a.state !== "exhausted")).toBe(true);
  });

  it("serializes account metadata writes and persists a change that arrives mid-write", async () => {
    const rotator = createAccountRotator([first, second], { now: () => 1_000 });
    const snapshots: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let writes = 0;
    const auth = new AuthManager({
      accountRotator: rotator,
      persistAccounts: async (profiles) => {
        writes++;
        snapshots.push(profiles.map((p) => `${p.id}:${p.exhaustedUntil ?? 0}`).join(","));
        if (writes === 1) await blocked;
      },
    });
    const firstWrite = auth.recoverCredential(first.credential, "coding-plan", "1005");
    // Let the first writer enter its blocked I/O seam before racing a second
    // metadata event against it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second event arrives while the first persistence operation is live.
    auth.markCredentialExhausted(second.credential, "1113");
    release();
    await firstWrite;
    // Let the queued dirty pass complete before checking the final snapshot.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toBe(2);
    expect(snapshots[1]).toContain("two:61000");
  });

  it("keeps a failed metadata write unsaved and rewrites it in the background until it lands (lock contention)", async () => {
    const rotator = createAccountRotator([first, second], { now: () => 1_000 });
    let failuresLeft = 2;
    const written: string[] = [];
    const auth = new AuthManager({
      accountRotator: rotator,
      persistenceRetryDelaysMs: [1, 1, 1],
      persistAccounts: async (profiles) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new AccountStoreError("locked", "store locked by another process");
        }
        written.push(profiles.map((p) => `${p.id}:${p.exhaustedUntil ?? 0}`).join(","));
      },
    });
    auth.markCredentialExhausted(first.credential, "1005");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failed = auth.getPersistenceStatus();
    expect(failed.state).toBe("error");
    expect(failed.unsaved).toBe(true);
    expect(failed.nextRetryAt).toBeDefined();
    await auth.settlePersistence();
    expect(written.length).toBe(1);
    expect(written[0]).toContain("one:61000"); // the quarantine reached the store
    const clean = auth.getPersistenceStatus();
    expect(clean.state).toBe("clean");
    expect(clean.unsaved).toBe(false);
    expect(clean.attempts).toBe(0);
  });

  it("stops after the bounded schedule and never retries a corrupt store; the next change starts over", async () => {
    const rotator = createAccountRotator([first, second], { now: () => 1_000 });
    let calls = 0;
    const auth = new AuthManager({
      accountRotator: rotator,
      persistenceRetryDelaysMs: [1, 1],
      persistAccounts: async () => { calls += 1; throw new AccountStoreError("locked", "busy"); },
    });
    auth.markCredentialExhausted(first.credential, "1005");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await auth.settlePersistence();
    expect(calls).toBe(3); // inline write + 2 scheduled retries
    const spent = auth.getPersistenceStatus();
    expect(spent.unsaved).toBe(true);
    expect(spent.nextRetryAt).toBeUndefined();
    expect(spent.attempts).toBe(3);

    let corruptCalls = 0;
    const corrupt = new AuthManager({
      accountRotator: createAccountRotator([first, second], { now: () => 1_000 }),
      persistenceRetryDelaysMs: [1, 1],
      persistAccounts: async () => { corruptCalls += 1; throw new AccountStoreError("corrupt", "cannot decrypt"); },
    });
    corrupt.markCredentialExhausted(first.credential, "1005");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await corrupt.settlePersistence();
    expect(corruptCalls).toBe(1);
    expect(corrupt.getPersistenceStatus().unsaved).toBe(true);
    expect(corrupt.getPersistenceStatus().nextRetryAt).toBeUndefined();
  });

  it("a new change after a spent schedule starts the full schedule again; flushPersistence writes at once (shutdown)", async () => {
    const rotator = createAccountRotator([first, second], { now: () => 1_000 });
    let failing = true;
    let calls = 0;
    const written: string[] = [];
    const auth = new AuthManager({
      accountRotator: rotator,
      persistenceRetryDelaysMs: [1],
      persistAccounts: async (profiles) => {
        calls += 1;
        if (failing) throw new AccountStoreError("locked", "busy");
        written.push(profiles.map((p) => `${p.id}:${p.exhaustedUntil ?? 0}`).join(","));
      },
    });
    auth.markCredentialExhausted(first.credential, "1005");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await auth.settlePersistence();
    expect(calls).toBe(2); // inline + the single scheduled retry
    auth.markCredentialExhausted(second.credential, "1113"); // new change: fresh schedule
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auth.getPersistenceStatus().nextRetryAt).toBeDefined();
    failing = false;
    await auth.flushPersistence();
    expect(written.length).toBe(1);
    expect(written[0]).toContain("two:61000");
    expect(auth.getPersistenceStatus().unsaved).toBe(false);
    await auth.settlePersistence();
  });

  it("a new change supersedes a scheduled retry and writes the newest snapshot inline", async () => {
    const rotator = createAccountRotator([first, second], { now: () => 1_000 });
    let failFirst = true;
    const written: string[] = [];
    const auth = new AuthManager({
      accountRotator: rotator,
      persistenceRetryDelaysMs: [60_000],
      persistAccounts: async (profiles) => {
        if (failFirst) { failFirst = false; throw new Error("EBUSY"); }
        written.push(profiles.map((p) => `${p.id}:${p.exhaustedUntil ?? 0}`).join(","));
      },
    });
    auth.markCredentialExhausted(first.credential, "1005");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auth.getPersistenceStatus().nextRetryAt).toBeDefined();
    auth.markCredentialExhausted(second.credential, "1113");
    await auth.settlePersistence(); // returns without waiting 60 s: the retry was cancelled
    expect(written.length).toBe(1);
    expect(written[0]).toContain("one:61000");
    expect(written[0]).toContain("two:61000");
    expect(auth.getPersistenceStatus().unsaved).toBe(false);
  });

  it("does not fall back to the legacy credential store for pool claims", async () => {
    const pooled = new AuthManager({ accountRotator: createAccountRotator([
      { id: "no-jwt", credential: { provider: "zai", apiKey: "pool-key" } },
    ]) });
    const legacyLoader = async () => ({ apiKey: "legacy", provider: "zai" as const, jwt: "legacy-jwt" });
    expect(await resolveClaimJwt(pooled, legacyLoader)).toBeUndefined();
    const legacy = new AuthManager({ loadCredential: async () => null });
    expect(await resolveClaimJwt(legacy, legacyLoader)).toBe("legacy-jwt");
  });

  it("selects a JWT-capable pool account for claims when the active account only has an API key", async () => {
    const rotator = createAccountRotator([
      first,
      { ...second, credential: { ...second.credential, jwt: "pool-two-jwt" } },
    ], { plan: "coding-plan" });
    const auth = new AuthManager({ accountRotator: rotator });
    expect((await auth.getCredential()).apiKey).toBe("pool-one");
    const legacyLoader = async () => { throw new Error("Pool claims must not read legacy credentials"); };

    expect(await resolveClaimJwt(auth, legacyLoader)).toBe("pool-two-jwt");
    expect(await resolveClaimJwt(auth, legacyLoader)).toBe("pool-two-jwt");
    expect(rotator.getSelectedId()).toBe("two");
    expect(rotator.list().every(account => account.state !== "exhausted")).toBe(true);
  });

  it("keeps pool policies authoritative when selecting a JWT-capable claim account", async () => {
    const rotator = createAccountRotator([
      first,
      { ...second, credential: { ...second.credential, jwt: "pool-two-jwt" } },
      { id: "three", credential: { provider: "zai", apiKey: "pool-three", jwt: "pool-three-jwt" } },
    ], { plan: "coding-plan", pausedAccountIds: ["two"], allowedAccountIds: ["one", "two"] });
    const auth = new AuthManager({ accountRotator: rotator });
    let legacyReads = 0;
    const legacyLoader = async () => {
      legacyReads++;
      return { provider: "zai" as const, apiKey: "legacy", jwt: "legacy-jwt" };
    };

    expect(await resolveClaimJwt(auth, legacyLoader)).toBeUndefined();
    expect(legacyReads).toBe(0);
    expect((await auth.getCredential()).apiKey).toBe("pool-one");
  });
});
