import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import {
  AccountStoreError,
  addAccount,
  clearAccountStore,
  listAccountProfiles,
  loadAccountStore,
  removeAccount,
  saveAccountStore,
  loadAccountStoreSnapshot,
  recoverAccountStoreLock,
  duplicateCredentialGroups,
} from "./account-store.js";

const root = mkdtempSync(join(tmpdir(), "zcode-account-pool-"));
const path = join(root, "nested", "accounts.json");
const secret = "synthetic-account-store-secret";
const profile = (id: string, key = `synthetic-${id}`) => ({
  id,
  credential: { provider: "zai" as const, apiKey: key, secret: `secret-${id}`, jwt: `jwt-${id}` },
});

describe("account store", () => {
  beforeEach(() => {
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = secret;
    process.env.ZCODE_PROXY_ACCOUNTS_PATH = path;
    clearAccountStore();
  });
  afterEach(() => {
    clearAccountStore();
    delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    delete process.env.ZCODE_PROXY_ACCOUNTS_PATH;
  });

  it("roundtrips encrypted profiles and uses restrictive permissions", async () => {
    await saveAccountStore([profile("one")]);
    expect(await loadAccountStore()).toEqual([profile("one")]);
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("encrypted");
    expect(raw).not.toContain("synthetic-one");
    // POSIX exposes the restrictive mode bits that the store requests. On
    // Windows, Bun reports the compatibility mode (0666) even though the
    // effective ACL is inherited from the private store directory; asserting
    // the numeric POSIX bits there makes the cross-platform suite fail without
    // testing a meaningful Windows security property.
    if (process.platform === "win32") expect(statSync(path).isFile()).toBe(true);
    else expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("rejects duplicate ids unless replace is explicit", async () => {
    await addAccount(profile("one"));
    await expect(addAccount(profile("one", "new-key"))).rejects.toMatchObject({ code: "conflict" });
    await addAccount(profile("one", "new-key"), { replace: true });
    expect((await loadAccountStore())[0].credential.apiKey).toBe("new-key");
  });

  it("validates id traversal and targeted removal", async () => {
    await expect(addAccount(profile("../escape"))).rejects.toBeInstanceOf(AccountStoreError);
    await addAccount(profile("one"));
    await addAccount(profile("two"));
    expect(await removeAccount("one")).toBe(true);
    expect(await removeAccount("one")).toBe(false);
    expect((await loadAccountStore()).map((a) => a.id)).toEqual(["two"]);
  });

  it("redacts keys and JWTs in the list", async () => {
    await addAccount(profile("one", "synthetic-super-secret-key"));
    const list = await listAccountProfiles();
    expect(list[0].credentialPreview).toBe("redacted");
    expect(JSON.stringify(list)).not.toContain("synthetic-super-secret-key");
    expect(JSON.stringify(list)).not.toContain("jwt-one");
  });

  it("fails closed on malformed or locked stores", async () => {
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(path, "{broken", { encoding: "utf8", flag: "w" });
    await expect(loadAccountStore()).rejects.toMatchObject({ code: "corrupt" });
    clearAccountStore();
    writeFileSync(`${path}.lock`, "{pid: 1}", { encoding: "utf8", flag: "w" });
    await expect(saveAccountStore([])).rejects.toMatchObject({ code: "locked" });
  });

  it("uses an authoritative revision and rejects stale compare-and-swap writes", async () => {
    await saveAccountStore([profile("one")]);
    const first = await loadAccountStoreSnapshot();
    expect(first.revision).toBe(1);
    await addAccount(profile("two"));
    const second = await loadAccountStoreSnapshot();
    expect(second.revision).toBe(2);
    await expect(saveAccountStore([profile("stale")], { expectedRevision: first.revision }))
      .rejects.toMatchObject({ code: "conflict" });
    expect((await loadAccountStore()).map(account => account.id)).toEqual(["one", "two"]);
  });

  it("recovers only a lock whose recorded process is definitely gone", async () => {
    mkdirSync(join(root, "nested"), { recursive: true });
    const lock = `${path}.lock`;
    writeFileSync(lock, JSON.stringify({ pid: 999999, host: hostname(), nonce: "dead-owner-nonce-123456", createdAt: Date.now() }));
    expect(recoverAccountStoreLock(path, "dead-owner-nonce-123456")).toBe(true);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), nonce: "live-owner-nonce-123456", createdAt: Date.now() }));
    expect(recoverAccountStoreLock(path, "live-owner-nonce-123456")).toBe(false);
  });

  it("groups duplicate effective credentials without persisting a fingerprint", () => {
    const first = profile("one", "same-key");
    const groups = duplicateCredentialGroups([
      first,
      { ...first, id: "alias", credential: { ...first.credential } },
      profile("other", "different-key"),
    ]);
    expect(groups).toEqual([["one", "alias"]]);
    expect(JSON.stringify(groups)).not.toContain("same-key");
  });

  it("rejects an explicitly blank encryption secret", async () => {
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = "  \t ";
    await expect(saveAccountStore([profile("one")])).rejects.toMatchObject({ code: "invalid" });
  });
});
