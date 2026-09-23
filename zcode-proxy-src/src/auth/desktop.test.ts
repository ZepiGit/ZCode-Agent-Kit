import { afterEach, beforeEach, expect, test } from "bun:test";
import { createCipheriv, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { platform, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { desktopCredentialRevision, importFromZCodeConfig, parseDesktopCredential } from "./desktop.js";
import { fixtureSecret } from "../test-fixtures.js";
import { loadAccountStore, loadAccountStoreSnapshot, rememberAccount, updateAccountStore } from "./account-store.js";

const ZAI_KEY = fixtureSecret("desktop-zai-key");
const ZAI_JWT = fixtureSecret("desktop-zai-jwt");
/** A different provider's entry, which selecting "zai" must ignore. */
const BIGMODEL_KEY = fixtureSecret("desktop-bigmodel-key");

test("existing desktop import selects only the requested builtin provider", () => {
  expect(parseDesktopCredential(JSON.stringify({ provider: {
    // Surrounding whitespace is intentional: the parser must trim it.
    "builtin:zai-coding-plan": { options: { apiKey: ` ${ZAI_KEY} ` } },
    "builtin:zai-start-plan": { options: { apiKey: ` ${ZAI_JWT} ` } },
    "builtin:bigmodel-coding-plan": { options: { apiKey: BIGMODEL_KEY } },
  } }), "zai")).toEqual({ apiKey: ZAI_KEY, jwt: ZAI_JWT, provider: "zai" });
});
test("partial, empty, invalid and expired desktop credentials are rejected safely", () => {
  for (const raw of ["{", "{}", '{"provider":{"builtin:zai-coding-plan":{"options":{"apiKey":42}}}}']) {
    expect(() => parseDesktopCredential(raw, "zai")).toThrow();
  }
  const jwt = `fixture.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.fixture`;
  expect(() => parseDesktopCredential(JSON.stringify({ provider: { "builtin:zai-coding-plan": { options: { apiKey: "fixture" } }, "builtin:zai-start-plan": { options: { apiKey: jwt } } } }), "zai", "start-plan")).toThrow(/expired/);
});

let home: string, modernPath: string, legacyPath: string;
const SECRET = fixtureSecret("desktop-encryption-secret");
const OAUTH = fixtureSecret("desktop-current-oauth");
const FUTURE_JWT = jwt({ exp: 4102444800, sub: "synthetic-current-user" });
function jwt(payload: Record<string, unknown>): string {
  return `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c3ludGhldGlj`;
}
function current(): Record<string, unknown> {
  return { "oauth:active_provider": "zai", "oauth:zai:access_token": OAUTH, zcodejwttoken: FUTURE_JWT };
}
function encrypt(value: string, material = SECRET): string {
  // Synthetic fixture IV; no production encryption is exercised here.
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(material).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function saveModern(record: Record<string, unknown> = current()): void {
  writeFileSync(modernPath, JSON.stringify(record));
}
function load(provider: "zai" | "bigmodel" = "zai", plan: string | undefined = "start-plan", credentialSecret = SECRET) {
  return importFromZCodeConfig(provider, plan, { home, credentialSecret });
}
function failure(action: () => unknown): Error {
  try { action(); } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return err as Error;
  }
  throw new Error("Expected credential import to fail");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zcode-desktop-import-"));
  const directory = join(home, ".zcode", "v2");
  mkdirSync(directory, { recursive: true });
  modernPath = join(directory, "credentials.json");
  legacyPath = join(directory, "config.json");
  writeFileSync(legacyPath, JSON.stringify({ provider: {
    "builtin:zai-coding-plan": { options: { apiKey: ZAI_KEY } },
    "builtin:zai-start-plan": { options: { apiKey: ZAI_JWT } },
    "builtin:bigmodel-coding-plan": { options: { apiKey: BIGMODEL_KEY } },
  } }));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

test("plaintext current login wins over stale config without writing either source", () => {
  saveModern({ ...current(), "oauth:bigmodel:access_token": "enc:unsupported:ignored", unrelated: { ignored: true } });
  const before = [readFileSync(modernPath, "utf8"), readFileSync(legacyPath, "utf8")];
  expect(load()).toEqual({ provider: "zai", apiKey: OAUTH, jwt: FUTURE_JWT });
  expect([readFileSync(modernPath, "utf8"), readFileSync(legacyPath, "utf8")]).toEqual(before);
});

test("encrypted values use the trimmed explicit Desktop secret and redact wrong-secret failures", () => {
  saveModern(Object.fromEntries(Object.entries(current()).map(([name, value]) => [name, encrypt(String(value))])));
  expect(load("zai", "start-plan", `  ${SECRET}  `)).toEqual({ provider: "zai", apiKey: OAUTH, jwt: FUTURE_JWT });
  const error = failure(() => load("zai", "start-plan", "incorrect-explicit-secret"));
  expect(error.message).toMatch(/decryption/);
  for (const secret of [SECRET, OAUTH, FUTURE_JWT, "incorrect-explicit-secret"]) expect(error.stack).not.toContain(secret);
});

test("default accessor reads the fake OS home and Desktop secret rather than the proxy secret", () => {
  saveModern(Object.fromEntries(Object.entries(current()).map(([name, value]) => [name, encrypt(String(value))])));
  const result = spawnSync(process.execPath, ["--eval", `
    import { importFromZCodeConfig } from "./desktop.ts";
    const credential = importFromZCodeConfig("zai", "start-plan");
    if (credential.jwt !== process.env.SYNTHETIC_EXPECTED_JWT || credential.apiKey !== process.env.SYNTHETIC_EXPECTED_OAUTH) process.exit(2);
  `], {
    cwd: import.meta.dir, encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: home, USERPROFILE: home,
      ZCODE_CREDENTIAL_SECRET: ` ${SECRET} `, ZCODE_PROXY_CREDENTIAL_SECRET: "different-proxy-secret",
      SYNTHETIC_EXPECTED_JWT: FUTURE_JWT, SYNTHETIC_EXPECTED_OAUTH: OAUTH },
  });
  expect(result.status).toBe(0);
  for (const value of [SECRET, OAUTH, FUTURE_JWT]) expect(result.stdout + result.stderr).not.toContain(value);
});

test("blank secret uses the vendor OS/home/username key, but a wrong explicit secret never falls back", () => {
  const material = `zcode-credential-fallback:${platform()}:${home}:${userInfo().username}`;
  saveModern(Object.fromEntries(Object.entries(current()).map(([name, value]) => [name, encrypt(String(value), material)])));
  expect(load("zai", "start-plan", " \t ").jwt).toBe(FUTURE_JWT);
  expect(() => load("zai", "start-plan", SECRET)).toThrow(/decryption/);
});

test("only absent modern store permits legacy provider import", () => {
  expect(load()).toEqual({ provider: "zai", apiKey: ZAI_KEY, jwt: ZAI_JWT });
  expect(load("bigmodel", "coding-plan")).toEqual({ provider: "bigmodel", apiKey: BIGMODEL_KEY, jwt: undefined });
  saveModern({});
  expect(() => load()).toThrow(/active login/);
  rmSync(modernPath);
  expect(load().apiKey).toBe(ZAI_KEY);
});

test("active provider mismatch cannot import another stored account or bind the shared JWT to Bigmodel", () => {
  saveModern({ ...current(), "oauth:active_provider": "bigmodel", "oauth:bigmodel:access_token": BIGMODEL_KEY });
  expect(() => load()).toThrow(/provider/);
  expect(() => load("bigmodel")).toThrow(/Z.AI start-plan/);
  saveModern({ ...current(), "oauth:active_provider": "unrecognized-provider" });
  expect(() => load()).toThrow(/provider/);
});

test("current import requires both active OAuth credential and current JWT, without stale completion", () => {
  for (const field of ["oauth:active_provider", "oauth:zai:access_token", "zcodejwttoken"]) {
    const record = current();
    delete record[field];
    saveModern(record);
    failure(() => load());
  }
  saveModern({ ...current(), "oauth:zai:access_token": 42 });
  expect(() => load()).toThrow(/invalid/);
});

test("current OAuth tokens cannot silently become coding keys or an unspecified-plan credential", () => {
  saveModern();
  expect(() => load("zai", "coding-plan")).toThrow(/read-only import/);
  expect(() => importFromZCodeConfig("zai", undefined, { home, credentialSecret: SECRET })).toThrow(/read-only import/);
});

test("current JWT expiry and syntax are checked locally without inferring account identity", () => {
  saveModern();
  expect(load()).toEqual({ apiKey: OAUTH, provider: "zai", jwt: FUTURE_JWT });
  saveModern({ ...current(), zcodejwttoken: jwt({ exp: 1 }) });
  expect(() => load()).toThrow(/expired/);
  saveModern({ ...current(), zcodejwttoken: jwt({ exp: "4102444800" }) });
  expect(() => load()).toThrow(/valid JWT/);
  saveModern({ ...current(), zcodejwttoken: "not-a-jwt" });
  expect(() => load()).toThrow(/valid JWT/);
});

test("malformed JSON and non-record current stores fail closed without parser excerpts", () => {
  for (const raw of [`{\"secret\":\"${SECRET}\"`, "null", "[]"]) {
    writeFileSync(modernPath, raw);
    const error = failure(() => load());
    expect(error.message).toMatch(/configuration is invalid/);
    expect(error.stack).not.toContain(SECRET);
  }
});

test("corrupt, unsupported, and unauthenticated ciphertext cannot fall back to legacy", () => {
  const encrypted = encrypt(FUTURE_JWT);
  const tampered = encrypted.split(".");
  const ciphertext = Buffer.from(tampered[2], "base64url");
  ciphertext[0] ^= 1;
  tampered[2] = ciphertext.toString("base64url");
  for (const value of ["enc:v2:unsupported", "enc:v1:AA.AA.AA", `${encrypted}!`, tampered.join(".")]) {
    saveModern({ ...current(), zcodejwttoken: value });
    const error = failure(() => load());
    expect(error.message).toMatch(/encryption|decryption/);
    for (const secret of [value, SECRET, OAUTH, FUTURE_JWT]) expect(error.stack).not.toContain(secret);
  }
});

test("unreadable modern source is authoritative and diagnostics do not expose paths", () => {
  mkdirSync(modernPath);
  const error = failure(() => load());
  expect(error.message).toMatch(/unavailable/);
  expect(error.stack).not.toContain(home);
});

test("reimporting the same current login preserves account identity, pauses and exhaustion", async () => {
  const options = { path: join(home, "synthetic-accounts.json"), plan: "start-plan" };
  saveModern();
  const first = await rememberAccount(load(), options);
  const exhaustedUntil = 4102444800000;
  await updateAccountStore(accounts => accounts.map(account => ({
    ...account, label: "Synthetic work", paused: true, exhaustedUntil, quotaGeneration: 3,
  })), options);
  const revision = (await loadAccountStoreSnapshot(options)).revision;
  expect((await rememberAccount(load(), options)).id).toBe(first.id);
  expect((await loadAccountStoreSnapshot(options)).revision).toBe(revision);
  saveModern({ ...current(), zcodejwttoken: jwt({ exp: 4102444800, sub: "synthetic-current-user", refreshed: true }) });
  expect((await rememberAccount(load(), options)).id).toBe(first.id);
  expect(await loadAccountStore(options)).toEqual([expect.objectContaining({
    id: first.id, label: "Synthetic work", paused: true, exhaustedUntil, quotaGeneration: 3,
    credentialRevision: 2,
  })]);
});

test("revision follows the effective store across login update, replacement, and removal", () => {
  const legacy = desktopCredentialRevision({ home });
  saveModern();
  const modern = desktopCredentialRevision({ home });
  expect(modern).not.toBe(legacy);
  writeFileSync(legacyPath, "stale config changed but is not authoritative");
  expect(desktopCredentialRevision({ home })).toBe(modern);
  saveModern({ ...current(), zcodejwttoken: jwt({ exp: 4102444800, sub: "changed-current-user" }) });
  utimesSync(modernPath, new Date("2031-01-01"), new Date("2031-01-01"));
  const updated = desktopCredentialRevision({ home });
  expect(updated).not.toBe(modern);
  expect(load().jwt).toBe(jwt({ exp: 4102444800, sub: "changed-current-user" }));
  rmSync(modernPath);
  expect(desktopCredentialRevision({ home })).not.toBe(updated);
});
