import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccountStoreError,
  addAccount,
  clearAccountStore,
  listAccountProfiles,
  loadAccountStore,
  removeAccount,
  saveAccountStore,
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
    expect(statSync(path).mode & 0o777).toBe(0o600);
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
    expect(list[0].credentialPreview).toBe("synt…-key");
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
});
