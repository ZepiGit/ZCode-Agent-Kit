/**
 * Tests for encrypted credential store.
 * @see .omo/plans/zcode-proxy.md Task 14
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { saveCredential, saveCredentialIfUnchanged, loadCredential, clearCredential, getStorePath } from "./store.js";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "./types.js";
import { fixtureSecret, wrongSecret } from "../test-fixtures.js";

const TEST_SECRET = fixtureSecret("store-encryption-secret");
const OLD_KEY = fixtureSecret("store-old");
const NEW_KEY = fixtureSecret("store-new");
const ROUNDTRIP_KEY = fixtureSecret("store-roundtrip-key");
const ROUNDTRIP_SECRET = fixtureSecret("store-roundtrip-secret");
const BIGMODEL_KEY = fixtureSecret("store-bigmodel");
const LEGACY_KEY = fixtureSecret("store-legacy");
/** Encryption secret that must NOT decrypt anything written under TEST_SECRET. */
const FOREIGN_SECRET = wrongSecret("store-encryption-secret");
// Audit H6 regression guard: this suite runs against an injected temp store
// (ZCODE_PROXY_CREDENTIALS_PATH) so it can never wipe a real login at
// ~/.zcode-proxy/credentials.json.
const TEST_STORE_DIR = join(tmpdir(), `zcode-proxy-store-test-${Date.now()}-${process.pid}`);
const TEST_STORE = join(TEST_STORE_DIR, "credentials.json");

/** Legacy XOR-fold key + AES-GCM encrypt (pre-SHA-256 store format). */
async function legacyEncrypt(plaintext: string): Promise<string> {
  const seed = process.env.ZCODE_PROXY_CREDENTIAL_SECRET ?? `${homedir()}-${process.platform}-${process.arch}`;
  const keyBytes = new Uint8Array(new ArrayBuffer(32));
  const seedBytes = new TextEncoder().encode(seed);
  for (let i = 0; i < seedBytes.length; i++) {
    keyBytes[i % 32] ^= seedBytes[i];
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(combined).toString("base64");
}

describe("credential store", () => {
  beforeEach(() => {
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = TEST_SECRET;
    process.env.ZCODE_PROXY_CREDENTIALS_PATH = TEST_STORE;
    // The injected store dir is recreated each case: tests write the store
    // file directly (no saveCredential), and a prior afterEach may have
    // removed the dir — the real ~/.zcode-proxy always existed, temp does not.
    mkdirSync(TEST_STORE_DIR, { recursive: true });
    clearCredential();
  });

  afterEach(() => {
    clearCredential();
    delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    delete process.env.ZCODE_PROXY_CREDENTIALS_PATH;
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  });

  it("conditionally persists recovered credentials without overwriting another login or logout", async () => {
    const old: Credential = { apiKey: OLD_KEY, provider: "zai" };
    const fresh: Credential = { apiKey: NEW_KEY, provider: "zai" };
    await saveCredential(old);
    const snapshot = readFileSync(TEST_STORE, "utf8");
    await saveCredential(fresh);
    expect(await saveCredentialIfUnchanged(old, snapshot)).toBe(false);
    expect(await loadCredential()).toEqual(fresh);
    const current = readFileSync(TEST_STORE, "utf8");
    expect(await saveCredentialIfUnchanged(old, current)).toBe(true);
    clearCredential();
    expect(await saveCredentialIfUnchanged(fresh, current)).toBe(false);
  });

  it("returns null when no credential stored", async () => {
    const loaded = await loadCredential();
    expect(loaded).toBeNull();
  });

  it("isolates the store via ZCODE_PROXY_CREDENTIALS_PATH (H6: suites never touch the real login)", () => {
    expect(getStorePath()).toBe(TEST_STORE);
    delete process.env.ZCODE_PROXY_CREDENTIALS_PATH;
    expect(getStorePath()).toBe(join(homedir(), ".zcode-proxy", "credentials.json"));
    process.env.ZCODE_PROXY_CREDENTIALS_PATH = TEST_STORE;
  });

  it("roundtrips: save → load → matches original", async () => {
    const cred: Credential = {
      apiKey: ROUNDTRIP_KEY,
      secret: ROUNDTRIP_SECRET,
      provider: "zai",
    };
    await saveCredential(cred);
    const loaded = await loadCredential();
    expect(loaded).not.toBeNull();
    expect(loaded!.apiKey).toBe(ROUNDTRIP_KEY);
    expect(loaded!.secret).toBe(ROUNDTRIP_SECRET);
    expect(loaded!.provider).toBe("zai");
  });

  it("roundtrips bigmodel credential (no secret)", async () => {
    const cred: Credential = {
      apiKey: BIGMODEL_KEY,
      provider: "bigmodel",
    };
    await saveCredential(cred);
    const loaded = await loadCredential();
    expect(loaded).not.toBeNull();
    expect(loaded!.apiKey).toBe(BIGMODEL_KEY);
    expect(loaded!.secret).toBeUndefined();
    expect(loaded!.provider).toBe("bigmodel");
  });

  it("clearCredential removes stored credential", async () => {
    const cred: Credential = { apiKey: "x", provider: "zai" };
    await saveCredential(cred);
    clearCredential();
    const loaded = await loadCredential();
    expect(loaded).toBeNull();
  });

  it("preserves expiresAt field", async () => {
    const cred: Credential = {
      apiKey: "x",
      provider: "zai",
      expiresAt: 9999999999999,
    };
    await saveCredential(cred);
    const loaded = await loadCredential();
    expect(loaded!.expiresAt).toBe(9999999999999);
  });

  it("rejects explicitly configured blank secrets and preserves valid whitespace", async () => {
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = " \t ";
    await expect(saveCredential({ apiKey: "x", provider: "zai" })).rejects.toThrow(/must contain/);
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = `  ${TEST_SECRET}  `;
    await saveCredential({ apiKey: "x", provider: "zai" });
    expect((await loadCredential())?.apiKey).toBe("x");
  });
});

describe("credential store — SHA-256 KDF migration (R2-13)", () => {
  beforeEach(() => {
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = TEST_SECRET;
    process.env.ZCODE_PROXY_CREDENTIALS_PATH = TEST_STORE;
    // The injected store dir is recreated each case: tests write the store
    // file directly (no saveCredential), and a prior afterEach may have
    // removed the dir — the real ~/.zcode-proxy always existed, temp does not.
    mkdirSync(TEST_STORE_DIR, { recursive: true });
    clearCredential();
  });

  afterEach(() => {
    clearCredential();
    delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    delete process.env.ZCODE_PROXY_CREDENTIALS_PATH;
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  });

  it("migrates a legacy XOR-fold-encrypted file: loads AND re-stores under the new KDF", async () => {
    const cred: Credential = { apiKey: LEGACY_KEY, provider: "zai" };
    const legacyPayload = await legacyEncrypt(JSON.stringify(cred));
    writeFileSync(getStorePath(), JSON.stringify({ encrypted: legacyPayload }), "utf-8");

    const loaded = await loadCredential();
    expect(loaded).not.toBeNull();
    expect(loaded!.apiKey).toBe(LEGACY_KEY);

    // The file must now be re-encrypted under the NEW key: the legacy key can
    // no longer decrypt it.
    const restored = JSON.parse(readFileSync(getStorePath(), "utf-8"));
    expect(restored.encrypted).not.toBe(legacyPayload);
    const reLoaded = await loadCredential(); // second load goes through the new KDF directly
    expect(reLoaded!.apiKey).toBe(LEGACY_KEY);
  });

  it("returns null for a file decryptable under NEITHER key (corrupt/foreign)", async () => {
    writeFileSync(getStorePath(), JSON.stringify({ encrypted: Buffer.from("garbage-not-base64-encrypted").toString("base64") }), "utf-8");
    const loaded = await loadCredential();
    expect(loaded).toBeNull();
  });

  it("returns null for valid-base64 but undecryptable ciphertext", async () => {
    // Encrypt under a DIFFERENT secret → both the new and legacy keys fail.
    const saved = process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = FOREIGN_SECRET;
    const foreign = await legacyEncrypt(JSON.stringify({ apiKey: "x", provider: "zai" }));
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = saved;

    writeFileSync(getStorePath(), JSON.stringify({ encrypted: foreign }), "utf-8");
    const loaded = await loadCredential();
    expect(loaded).toBeNull();
  });
});
