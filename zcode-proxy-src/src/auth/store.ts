/**
 * Encrypted file-based credential store.
 * @see .omo/plans/zcode-proxy.md Task 14
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, realpathSync } from "node:fs";
import { join, dirname, win32 } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import type { Credential } from "./types.js";

const STORE_FILE = join(homedir(), ".zcode-proxy", "credentials.json");
const ENV_SECRET = "ZCODE_PROXY_CREDENTIAL_SECRET";
/** Optional high-entropy key material supplied by a secret manager. */
const ENV_MASTER_KEY = "ZCODE_PROXY_CREDENTIAL_MASTER_KEY";
export const CREDENTIAL_STORE_FORMAT_VERSION = 2;
export const CREDENTIAL_MASTER_KEY_ENV = ENV_MASTER_KEY;

/** Generate printable high-entropy key material for headless setup. */
export function generateCredentialMasterKey(): string {
  return randomBytes(32).toString("base64url");
}

export type CredentialKeySource = "master-key" | "explicit-secret" | "machine-compat";

/** Redacted diagnostic describing where encryption material comes from. */
export function credentialKeySource(): CredentialKeySource {
  if (process.env[ENV_MASTER_KEY] !== undefined) return "master-key";
  if (process.env[ENV_SECRET] !== undefined) return "explicit-secret";
  return "machine-compat";
}
// Audit H6: test suites must never run against the real login store. The
// store file path is injectable via env; when unset the historical location
// is used and behavior is unchanged.
const ENV_STORE_PATH = "ZCODE_PROXY_CREDENTIALS_PATH";

/** Effective store file path: env override (tests/sandboxes) or the default. */
function storeFile(): string {
  return process.env[ENV_STORE_PATH] || STORE_FILE;
}

/**
 * Derive the AES-GCM key as SHA-256(seed) (audit R2-13). The previous XOR-fold
 * construction was a pseudo-KDF: a seed shorter than 32 bytes left zero blocks
 * in the key. Scope note: on default machine-derived seeds the security gain
 * is ~0 (any same-user process can re-derive the seed either way, 0o600 only
 * stops other users) — the motivation is structural: env-secret deployments
 * (`ZCODE_PROXY_CREDENTIAL_SECRET`) get real 32-byte diffusion, and the
 * misleading "KDF" is gone.
 */
/**
 * Canonical home for the machine seed. The kit's importer and the manager can
 * present the same directory with different separators or letter case on
 * Windows; the seed must not change with that spelling.
 */
function canonicalHome(): string {
  const home = homedir();
  if (process.platform !== "win32") return home;
  let canonical = win32.resolve(home);
  try { canonical = realpathSync.native(canonical); } catch {}
  return canonical.replace(/[\\/]+$/, "").toLowerCase();
}

function machineSeed(home: string): string {
  return `${home}-${process.platform}-${process.arch}`;
}

function sha256Key(seed: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(seed, "utf-8").digest());
}

function validateSecret(name: string, value: string, minimumLength = 1): string {
  // Do not trim valid secrets: spaces can be intentional key material. Only
  // reject an explicitly configured value that is empty/whitespace-only.
  if (value.trim().length < minimumLength) {
    throw new Error(`${name} must contain at least ${minimumLength} non-whitespace characters`);
  }
  return value;
}

function xorFoldKey(seed: string): Uint8Array {
  const hash = new Uint8Array(new ArrayBuffer(32));
  const seedBytes = new TextEncoder().encode(seed);
  for (let i = 0; i < seedBytes.length; i++) {
    hash[i % 32] ^= seedBytes[i];
  }
  return hash;
}

function getEncryptionKey(): Uint8Array {
  const master = process.env[ENV_MASTER_KEY];
  const configured = process.env[ENV_SECRET];
  // A configured master key takes precedence and is required to be strong
  // enough for headless deployments. The historical secret remains accepted
  // for compatibility, but empty values fail closed.
  const seed = master !== undefined
    ? validateSecret(ENV_MASTER_KEY, master, 32)
    : configured !== undefined
      ? validateSecret(ENV_SECRET, configured, 16)
      : machineSeed(canonicalHome());
  return sha256Key(seed);
}

/**
 * Keys that earlier proxy versions may have used for an existing store:
 * the previous XOR-fold derivation and the machine seed built from the raw
 * home spelling variants. Used only to migrate a store that the current key
 * cannot open; never for new writes.
 */
function legacyEncryptionKeys(): Uint8Array[] {
  if (process.env[ENV_MASTER_KEY] !== undefined) return [];
  const secret = process.env[ENV_SECRET];
  if (secret !== undefined) return [xorFoldKey(validateSecret(ENV_SECRET, secret, 16))];
  const raw = homedir();
  const variants = new Set<string>([raw, raw.replace(/\\/g, "/"), raw.replace(/\//g, "\\")]);
  if (process.platform === "win32") {
    for (const variant of [...variants]) {
      variants.add(variant.replace(/[\\/]+$/, ""));
      variants.add(variant.toLowerCase());
      variants.add(variant.replace(/^([a-z]):/i, (_, d) => `${d.toUpperCase()}:`));
    }
  }
  const keys: Uint8Array[] = [];
  for (const variant of variants) {
    keys.push(sha256Key(machineSeed(variant)));
    keys.push(xorFoldKey(machineSeed(variant)));
  }
  return keys;
}

/** Atomic store write: exclusive temp file (0o600) + rename over the target. */
export function atomicWriteStore(contents: string, target: string = storeFile()): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, contents, { mode: 0o600, flag: "wx" });
  try {
    renameSync(tmp, target);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  // Copy into a plain ArrayBuffer: bun-types types Uint8Array as
  // ArrayBufferLike, which is not assignable to BufferSource.
  const ab = new ArrayBuffer(raw.byteLength);
  new Uint8Array(ab).set(raw);
  return crypto.subtle.importKey(
    "raw",
    ab,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptWith(key: Uint8Array, plaintext: string): Promise<string> {
  const aesKey = await importAesKey(key);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(plaintext),
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(combined).toString("base64");
}

async function decryptWith(key: Uint8Array, ciphertext: string): Promise<string> {
  const aesKey = await importAesKey(key);

  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    data,
  );

  return new TextDecoder().decode(decrypted);
}

async function encrypt(plaintext: string): Promise<string> {
  return encryptWith(getEncryptionKey(), plaintext);
}

/**
 * Encrypt an arbitrary JSON payload with the same key and AES-GCM format used
 * by the legacy single-credential store. The account pool uses this helper so
 * both stores have identical key derivation and migration behaviour.
 */
export async function encryptStorePayload(plaintext: string): Promise<string> {
  return encrypt(plaintext);
}

/**
 * Decrypt a payload written by this store. `migrated` is true when one of the
 * pre-SHA-256 keys was needed; callers may atomically re-encrypt the payload
 * under the current key after checking that the file has not changed.
 */
export async function decryptStorePayload(ciphertext: string): Promise<{ plaintext: string; migrated: boolean }> {
  // Validate before entering the legacy fallback loop; an empty configured
  // secret must never silently turn into a machine-derived/legacy key.
  const currentKey = getEncryptionKey();
  try {
    return { plaintext: await decryptWith(currentKey, ciphertext), migrated: false };
  } catch {
    for (const key of legacyEncryptionKeys()) {
      try { return { plaintext: await decryptWith(key, ciphertext), migrated: true }; } catch {}
    }
    throw new Error("encrypted payload is not decryptable on this machine");
  }
}

export async function saveCredential(cred: Credential): Promise<void> {
  mkdirSync(dirname(storeFile()), { recursive: true, mode: 0o700 });
  const json = JSON.stringify(cred);
  const encrypted = await encrypt(json);
  atomicWriteStore(JSON.stringify({ version: CREDENTIAL_STORE_FORMAT_VERSION, encrypted }));
}

/** Compare again after async encryption; no await between comparison and atomic rename. */
export async function saveCredentialIfUnchanged(cred: Credential, snapshot: string): Promise<boolean> {
  const encrypted = await encrypt(JSON.stringify(cred));
  try {
    if (readFileSync(storeFile(), "utf8") !== snapshot) return false;
    atomicWriteStore(JSON.stringify({ version: CREDENTIAL_STORE_FORMAT_VERSION, encrypted }));
    return true;
  } catch { return false; }
}

export async function loadCredential({ migrate = true }: { migrate?: boolean } = {}): Promise<Credential | null> {
  // Fail closed for explicitly configured empty secrets instead of treating
  // the value as if it had not been configured.
  getEncryptionKey();
  if (!existsSync(storeFile())) return null;
  let raw: string;
  let parsed: { encrypted?: unknown };
  try {
    raw = readFileSync(storeFile(), "utf-8");
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`Ignoring unreadable credential store at ${storeFile()}: ${(e as Error).message}`);
    return null;
  }
  if (!parsed || typeof parsed.encrypted !== "string") return null;

  let json: string;
  try {
    json = await decryptWith(getEncryptionKey(), parsed.encrypted);
  } catch {
    // Not decryptable under the current key — try the keys earlier versions
    // may have used (one-shot migration), then re-store under the current key.
    json = "";
    let migrated = false;
    for (const key of legacyEncryptionKeys()) {
      try {
        json = await decryptWith(key, parsed.encrypted);
        migrated = true;
        break;
      } catch {}
    }
    if (!migrated) {
      // Stale/corrupt credential file — key derivation is machine-specific
      // ({homedir}-{platform}-{arch}), so cross-machine copies or OS reinstalls
      // produce undecryptable ciphertext. Treat as "not logged in".
      console.warn(`Ignoring corrupted or stale credentials at ${storeFile()}: not decryptable on this machine`);
      return null;
    }
    // Re-store under the current key, but only while the file is still the
    // one we read: a concurrent newer login must never be overwritten. A
    // failed re-write (read-only dir, AV lock, ...) must NOT fail this load.
    try {
      JSON.parse(json);
      const encrypted = migrate ? await encrypt(json) : null;
      if (encrypted && readFileSync(storeFile(), "utf-8") === raw) atomicWriteStore(JSON.stringify({ encrypted }));
    } catch (e) {
      console.warn(`Credential re-encryption under the current key derivation failed (will retry on next load): ${(e as Error).message}`);
    }
  }

  try {
    return JSON.parse(json) as Credential;
  } catch (e) {
    console.warn(`Ignoring corrupted credentials at ${storeFile()}: ${(e as Error).message}`);
    return null;
  }
}

export function clearCredential(): void {
  const target = storeFile();
  if (existsSync(target)) {
    unlinkSync(target);
  }
}

export function getStorePath(): string {
  return storeFile();
}
