/**
 * Tests for credential types and auth manager.
 * @see .omo/plans/zcode-proxy.md Task 4
 */
import { describe, it, expect } from "bun:test";
import { credentialString, isExpired } from "./types.js";
import { AuthManager } from "./manager.js";
import type { Credential } from "./types.js";

describe("credentialString", () => {
  it("returns apiKey.secret when secret present", () => {
    expect(credentialString({ apiKey: "a", secret: "b", provider: "zai" })).toBe("a.b");
  });

  it("returns apiKey only when secret absent", () => {
    expect(credentialString({ apiKey: "abc", provider: "bigmodel" })).toBe("abc");
  });

  it("handles complex key values", () => {
    expect(credentialString({ apiKey: "key123", secret: "secret456", provider: "zai" })).toBe(
      "key123.secret456",
    );
  });
});

describe("isExpired", () => {
  it("returns false when expiresAt is undefined", () => {
    expect(isExpired({ apiKey: "x", provider: "zai" })).toBe(false);
  });

  it("returns true when past expiry", () => {
    const cred = { apiKey: "x", provider: "zai" as const, expiresAt: 1000 };
    expect(isExpired(cred, 2000)).toBe(true);
  });

  it("returns false when before expiry", () => {
    const cred = { apiKey: "x", provider: "zai" as const, expiresAt: 3000 };
    expect(isExpired(cred, 2000)).toBe(false);
  });
});

describe("AuthManager durable reload and recovery", () => {
  const first: Credential = { apiKey: "fixture-first", provider: "zai" };
  const second: Credential = { apiKey: "fixture-second", provider: "zai" };

  it("reloads a changed persisted credential and retains last good across partial writes", async () => {
    let stored: Credential | null = first;
    let partial = false;
    const mgr = new AuthManager({ loadCredential: async () => {
      if (partial) throw new SyntaxError("fixture partial write");
      return stored;
    } });
    expect(await mgr.getCredential()).toEqual(first);
    partial = true;
    expect(await mgr.getCredential()).toEqual(first);
    partial = false;
    stored = { apiKey: "", provider: "zai" };
    expect(await mgr.getCredential()).toEqual(first);
    stored = second;
    expect(await mgr.getCredential()).toEqual(second);
  });

  it("coalesces concurrent reloads and recovery; never imports repeatedly for unchanged failure", async () => {
    let loads = 0, imports = 0;
    const mgr = new AuthManager({
      loadCredential: async () => { loads++; await Promise.resolve(); return first; },
      importCredential: async () => { imports++; await Promise.resolve(); return second; },
    });
    await Promise.all(Array.from({ length: 20 }, () => mgr.getCredential()));
    expect(loads).toBe(1);
    const recovered = await Promise.all(Array.from({ length: 20 }, () => mgr.recoverCredential(first, "coding-plan")));
    expect(recovered.every(c => c?.apiKey === second.apiKey)).toBe(true);
    expect(imports).toBe(1);
    // A stale persisted snapshot must not overwrite the imported candidate.
    expect(await mgr.getCredential()).toEqual(second);
    const same = new AuthManager({ importCredential: async () => { imports++; return first; } });
    same.setOAuthCredential(first);
    expect(await same.recoverCredential(first, "coding-plan")).toBeNull();
    expect(await same.recoverCredential(first, "coding-plan")).toBeNull();
    expect(imports).toBe(2);
  });

  it("does not overwrite an explicit update while reload is in flight", async () => {
    let resolve!: (c: Credential) => void;
    const mgr = new AuthManager({ loadCredential: () => new Promise(r => { resolve = r; }) });
    const pending = mgr.getCredential();
    mgr.setOAuthCredential(second);
    resolve(first);
    expect(await pending).toEqual(second);
  });

  it("only recovers when the effective plan token changes, rejects expired/provider-mismatched imports", async () => {
    let candidate: Credential = { ...second, jwt: "fixture-jwt" };
    const failed = { ...first, jwt: "fixture-jwt" };
    const mgr = new AuthManager({ importCredential: async () => candidate });
    mgr.setOAuthCredential(failed);
    expect(await mgr.recoverCredential(failed, "start-plan")).toBeNull();
    for (const invalid of [{ ...second, expiresAt: 1 }, { ...second, provider: "bigmodel" as const }]) {
      candidate = invalid;
      const other = new AuthManager({ importCredential: async () => candidate });
      other.setOAuthCredential(first);
      expect(await other.recoverCredential(first, "coding-plan")).toBeNull();
    }
  });

  it("allows recovery after a later desktop change but not repeated unchanged imports", async () => {
    let source = "revision-1", imports = 0;
    let candidate = first;
    const mgr = new AuthManager({ importRevision: () => source, importCredential: async () => { imports++; return candidate; } });
    mgr.setOAuthCredential(first);
    expect(await mgr.recoverCredential(first, "coding-plan")).toBeNull();
    expect(await mgr.recoverCredential(first, "coding-plan")).toBeNull();
    source = "revision-2"; candidate = second;
    expect(await mgr.recoverCredential(first, "coding-plan")).toEqual(second);
    expect(imports).toBe(2);
  });

  it("clears a removed persisted credential rather than resurrecting logout", async () => {
    let stored: Credential | null = first;
    const mgr = new AuthManager({ loadCredential: async () => stored });
    await mgr.getCredential(); stored = null;
    await expect(mgr.getCredential()).rejects.toThrow(/not available/);
    expect(await mgr.recoverCredential(first, "coding-plan")).toBeNull();
  });

  it("recovers a known expired stored credential before dispatch when configured", async () => {
    const mgr = new AuthManager({ plan: "coding-plan", importCredential: async () => second });
    mgr.setOAuthCredential({ ...first, expiresAt: 1 });
    expect(await mgr.getCredential()).toEqual(second);
  });

  it("an expired persisted candidate can recover after a later desktop revision", async () => {
    const expired = { ...first, expiresAt: 1 };
    let revision = "old", candidate: Credential = expired;
    const mgr = new AuthManager({ plan: "coding-plan", loadCredential: async () => expired,
      importRevision: () => revision, importCredential: async () => candidate });
    await expect(mgr.getCredential()).rejects.toThrow(/expired/);
    revision = "new"; candidate = second;
    expect(await mgr.getCredential()).toEqual(second);
  });

  it("retries transient persistence only after cooldown, with bounded attempts", async () => {
    let now = 0, writes = 0, imports = 0;
    const mgr = new AuthManager({ now: () => now, loadCredential: async () => first,
      importCredential: async () => { imports++; return second; },
      persistCredential: async () => { writes++; return writes === 2; } });
    await mgr.getCredential();
    expect(await mgr.recoverCredential(first, "coding-plan")).toBeNull();
    expect(await mgr.recoverCredential(first, "coding-plan")).toBeNull();
    expect(writes).toBe(1); expect(imports).toBe(1);
    now = 30_001;
    expect(await mgr.recoverCredential(first, "coding-plan")).toEqual(second);
    expect(writes).toBe(2);
    const blocked = new AuthManager({ now: () => now, importCredential: async () => second,
      persistCredential: async () => { writes++; return false; } });
    blocked.setOAuthCredential(first);
    for (let n = 0; n < 8; n++) { now += 30_001; expect(await blocked.recoverCredential(first, "coding-plan")).toBeNull(); }
    expect(writes).toBe(5); // At most three persistence attempts for one unchanged source.
  });

  it("does not adopt imported credentials when logout wins during persistence", async () => {
    let stored: Credential | null = first;
    let finish!: (ok: boolean) => void;
    let entered!: () => void;
    const writing = new Promise<void>(r => { entered = r; });
    const mgr = new AuthManager({ loadCredential: async () => stored, importCredential: async () => second,
      persistCredential: () => { entered(); return new Promise(r => { finish = r; }); } });
    await mgr.getCredential();
    const recovery = mgr.recoverCredential(first, "coding-plan");
    await writing; stored = null;
    await expect(mgr.getCredential()).rejects.toThrow(/not available/);
    finish(false);
    expect(await recovery).toBeNull();
    await expect(mgr.getCredential()).rejects.toThrow(/not available/);
  });

  it("keeps explicit-only credentials pinned and never touches a provider by default", async () => {
    const mgr = new AuthManager();
    mgr.setOAuthCredential(first);
    expect(await mgr.recoverCredential(first, "coding-plan")).toBeNull();
    expect(await mgr.getCredential()).toEqual(first);
  });
});

describe("AuthManager", () => {
  it("throws without a credential", async () => {
    const mgr = new AuthManager();
    expect(mgr.getCredential()).rejects.toThrow(/not available/);
  });

  it("returns the credential set via setOAuthCredential", async () => {
    const mgr = new AuthManager();
    mgr.setOAuthCredential({ apiKey: "oa", secret: "sc", provider: "zai" });
    const cred = await mgr.getCredential();
    expect(cred.apiKey).toBe("oa");
    expect(cred.secret).toBe("sc");
  });

  it("returns the latest credential after re-set", async () => {
    const mgr = new AuthManager();
    mgr.setOAuthCredential({ apiKey: "old", provider: "zai" });
    mgr.setOAuthCredential({ apiKey: "new", provider: "zai" });
    const cred = await mgr.getCredential();
    expect(cred.apiKey).toBe("new");
  });

  it("throws on an expired credential and clears it", async () => {
    const mgr = new AuthManager();
    mgr.setOAuthCredential({ apiKey: "x", provider: "zai", expiresAt: 1000 });
    await expect(mgr.getCredential()).rejects.toThrow(/expired/);
    await expect(mgr.getCredential()).rejects.toThrow(/not available/);
  });
});
