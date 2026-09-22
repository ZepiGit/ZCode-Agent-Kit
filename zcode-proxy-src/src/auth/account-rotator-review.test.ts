import { describe, expect, it } from "bun:test";
import { hostname } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureSecret } from "../test-fixtures.js";
import {
  AccountStoreError,
  addAccount,
  clearAccountStore,
  listAccountProfiles,
  removeAccount,
  recoverAccountStoreLock,
  saveAccountStore,
  loadAccountStoreSnapshot,
  loadAccountStore,
  migrateAccountStore,
} from "./account-store.js";
import { createAccountRotator, NoUsableAccountError } from "./account-rotator.js";
import { encryptStorePayload } from "./store.js";
import { createStoredAuthManagerWithAccounts } from "./runtime.js";
import type { AccountProfile } from "./account-store.js";

const synthetic = (id: string, key = `review-key-${id}`): AccountProfile => ({
  id,
  credential: { provider: "zai", apiKey: key, jwt: `review-jwt-${id}` },
});

async function legacyEncrypt(plaintext: string, seed: string): Promise<string> {
  const keyBytes = new Uint8Array(new ArrayBuffer(32));
  const seedBytes = new TextEncoder().encode(seed);
  for (let i = 0; i < seedBytes.length; i++) keyBytes[i % 32] ^= seedBytes[i];
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(combined).toString("base64");
}

describe("account rotator review regressions", () => {
  it("does not let a stale request handle clear a newer quota generation", () => {
    let now = 10_000;
    const rotator = createAccountRotator([synthetic("a"), synthetic("b")], { now: () => now, cooldownMs: 60_000 });
    const first = rotator.getCredentialHandle();

    rotator.markExhausted(first, "1005", now + 120_000);
    expect(rotator.list().find((account) => account.id === "a")?.state).toBe("exhausted");
    expect(rotator.clearFailure(first)).toBe(false);
    expect(rotator.list().find((account) => account.id === "a")?.state).toBe("exhausted");

    const current = rotator.handleForId("a");
    expect(current).toBeDefined();
    expect(rotator.clearFailure(current!)).toBe(true);
    expect(rotator.list().find((account) => account.id === "a")?.state).toBe("active");
  });

  it("excludes aliases of one effective credential from failover", () => {
    const rotator = createAccountRotator([
      synthetic("a", "same-effective-key"),
      synthetic("b", "same-effective-key"),
    ]);
    const first = rotator.getCredentialHandle();
    expect(() => rotator.getCredentialHandle({
      excludedIds: new Set([first.id]),
      excludedIdentities: new Set([first.effectiveIdentity]),
    })).toThrow(NoUsableAccountError);
  });

  it("does not shorten a known reset when a later signal omits resetAt", () => {
    let now = 1_000;
    const rotator = createAccountRotator([synthetic("a")], { now: () => now, cooldownMs: 60_000 });
    rotator.markExhausted("a", "1005", now + 86_400_000);
    now += 1;
    rotator.markExhausted("a", "1005");
    expect(rotator.list().find((account) => account.id === "a")?.exhaustedUntil).toBe(now - 1 + 86_400_000);
  });

  it("rejects explicitly configured empty encryption secrets", async () => {
    const previous = process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = "   ";
    try {
      await expect(encryptStorePayload("synthetic-payload")).rejects.toThrow(/must contain at least/);
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
      else process.env.ZCODE_PROXY_CREDENTIAL_SECRET = previous;
    }
  });

  it("uses compare-and-swap revisions instead of overwriting newer administration", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-account-review-"));
    const path = join(root, "accounts.json");
    try {
      await saveAccountStore([synthetic("a")], { path });
      const initial = await loadAccountStoreSnapshot({ path });
      await addAccount(synthetic("b"), { path });
      await expect(saveAccountStore([synthetic("a")], { path, expectedRevision: initial.revision }))
        .rejects.toMatchObject({ code: "conflict" } satisfies Partial<AccountStoreError>);
      expect((await loadAccountStoreSnapshot({ path })).accounts.map((account) => account.id)).toEqual(["a", "b"]);
    } finally {
      clearAccountStore({ path });
    }
  });

  it("keeps concurrent account add/remove changes when runtime metadata is persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-account-runtime-review-"));
    const path = join(root, "accounts.json");
    try {
      await saveAccountStore([synthetic("a"), synthetic("b")], { path });
      const auth = await createStoredAuthManagerWithAccounts("coding-plan", { enabled: true, path, provider: "zai" });
      const failed = await auth.getCredentialHandle();
      await removeAccount("b", { path });
      await addAccount(synthetic("c"), { path });

      await auth.recoverCredentialHandle(failed, "coding-plan", "1005");
      expect((await loadAccountStoreSnapshot({ path })).accounts.map((account) => account.id)).toEqual(["a", "c"]);
    } finally {
      clearAccountStore({ path });
    }
  });

  it("serializes mutations from separate processes without losing either account", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-account-multiprocess-review-"));
    const path = join(root, "accounts.json");
    const previous = process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    const secret = fixtureSecret("account-multiprocess-review");
    const moduleUrl = new URL("./account-store.ts", import.meta.url).href;
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = secret;
    try {
      await saveAccountStore([], { path });
      const addInChild = (id: string): Promise<boolean> => {
        const child = Bun.spawn([process.execPath, "-e", `const s = await import(${JSON.stringify(moduleUrl)}); await s.addAccount({id:${JSON.stringify(id)},credential:{provider:"zai",apiKey:${JSON.stringify(`child-key-${id}`)}}},{path:${JSON.stringify(path)}});`], {
          env: { ...process.env, ZCODE_PROXY_CREDENTIAL_SECRET: secret },
          stdout: "ignore",
          stderr: "ignore",
        });
        return child.exited.then((code) => code === 0);
      };
      const outcomes = await Promise.all([addInChild("child-a"), addInChild("child-b")]);
      expect(outcomes.filter(Boolean).length).toBe(1);
      if (!outcomes[0]) await addAccount({ id: "child-a", credential: { provider: "zai", apiKey: "child-key-child-a" } }, { path });
      if (!outcomes[1]) await addAccount({ id: "child-b", credential: { provider: "zai", apiKey: "child-key-child-b" } }, { path });
      expect((await loadAccountStoreSnapshot({ path })).accounts.map((account) => account.id).sort()).toEqual(["child-a", "child-b"]);
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
      else process.env.ZCODE_PROXY_CREDENTIAL_SECRET = previous;
      clearAccountStore({ path });
    }
  });

  it("keeps ordinary legacy reads side-effect free and migrates only explicitly", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-account-migration-review-"));
    const path = join(root, "accounts.json");
    const previous = process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    const secret = fixtureSecret("account-migration-review");
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = secret;
    try {
      const payload = JSON.stringify([synthetic("legacy")]);
      const encrypted = await legacyEncrypt(payload, secret);
      writeFileSync(path, JSON.stringify({ encrypted }), { mode: 0o600 });
      const before = readFileSync(path, "utf8");
      expect((await loadAccountStore({ path })).map((account) => account.id)).toEqual(["legacy"]);
      expect(readFileSync(path, "utf8")).toBe(before);

      await migrateAccountStore({ path });
      expect(readFileSync(path, "utf8")).not.toBe(before);
      expect((await loadAccountStore({ path })).map((account) => account.id)).toEqual(["legacy"]);
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
      else process.env.ZCODE_PROXY_CREDENTIAL_SECRET = previous;
      clearAccountStore({ path });
    }
  });

  it("recovers only a lock whose recorded owner is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-account-lock-review-"));
    const path = join(root, "accounts.json");
    const lockPath = `${path}.lock`;
    try {
      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        host: hostname(),
        nonce: "review-live-lock-nonce-1234",
        createdAt: Date.now() - 86_400_000,
      }), { mode: 0o600 });
      expect(recoverAccountStoreLock(path)).toBe(false);

      writeFileSync(lockPath, JSON.stringify({
        pid: 2_147_483_000,
        host: hostname(),
        nonce: "review-dead-lock-nonce-1234",
        createdAt: Date.now(),
      }), { mode: 0o600 });
      expect(recoverAccountStoreLock(path)).toBe(true);
      expect(() => readFileSync(lockPath)).toThrow();
    } finally {
      clearAccountStore({ path });
    }
  });

  it("redacts credentials and untrusted failure text from status records", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-account-redaction-review-"));
    const path = join(root, "accounts.json");
    const apiKey = "review-secret-api-key";
    const jwt = "review-secret-jwt";
    try {
      await saveAccountStore([{ ...synthetic("a", apiKey), credential: { provider: "zai", apiKey, jwt }, lastFailureReason: "provider leaked review-secret" }], { path });
      const json = JSON.stringify(await listAccountProfiles({ path }));
      expect(json).not.toContain(apiKey);
      expect(json).not.toContain(jwt);
      expect(json).not.toContain("provider leaked");
    } finally {
      clearAccountStore({ path });
    }
  });
});
