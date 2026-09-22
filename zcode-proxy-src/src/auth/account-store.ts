/**
 * Encrypted multi-account credential store.
 *
 * The legacy `credentials.json` store remains the compatibility primary. This
 * module stores an array of explicitly configured account profiles in a
 * separate `accounts.json` file using the exact same AES-GCM key derivation,
 * migration keys, and atomic 0600 write path as the legacy store.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  atomicWriteStore,
  decryptStorePayload,
  encryptStorePayload,
} from "./store.js";
import type { Credential } from "./types.js";

export const ACCOUNT_STORE_ENV = "ZCODE_PROXY_ACCOUNTS_PATH";
export const ACCOUNT_STORE_DEFAULT_FILE = "accounts.json";
const ACCOUNT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A credential plus stable local identity and scheduling metadata. */
export interface AccountProfile {
  id: string;
  credential: Credential;
  /** Optional human-readable label. Never used as a credential. */
  label?: string;
  /** Optional plan affinity. Profiles without one work with either plan. */
  plan?: "coding-plan" | "start-plan" | string;
  createdAt?: number;
  lastUsedAt?: number;
  lastFailureAt?: number;
  exhaustedUntil?: number;
  lastFailureReason?: string;
}

export type AccountStore = AccountProfile[];

export type AccountStoreOptions = {
  /** Explicit path, primarily useful to tests and isolated runtimes. */
  path?: string;
  /** Disable one-shot legacy-key migration (read only). */
  migrate?: boolean;
};

/** Failure labels accepted in redacted account overviews. */
const SAFE_FAILURE_REASON = /^(?:1005|1113|3001|quota(?:[ _-]exhausted)?|insufficient(?:[ _-]balance)?|account(?:[ _-]rejected)?)$/i;

export class AccountStoreError extends Error {
  readonly code: "invalid" | "locked" | "corrupt" | "conflict";

  constructor(code: AccountStoreError["code"], message: string) {
    super(message);
    this.name = "AccountStoreError";
    this.code = code;
  }
}

function accountStorePath(path?: string): string {
  const configured = path || process.env[ACCOUNT_STORE_ENV];
  if (!configured) return join(homedir(), ".zcode-proxy", ACCOUNT_STORE_DEFAULT_FILE);
  // `~` denotes the home directory in config shorthand. Treat it as the
  // default pool location instead of trying to atomically rename a file over
  // the directory itself (which would fail with EISDIR).
  if (configured === "~") return join(homedir(), ".zcode-proxy", ACCOUNT_STORE_DEFAULT_FILE);
  if (configured.startsWith("~/") || configured.startsWith("~\\")) return join(homedir(), configured.slice(2));
  return configured;
}

export function getAccountStorePath(path?: string): string {
  return accountStorePath(path);
}

function finiteTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AccountStoreError("invalid", `invalid account ${field}`);
  }
  return value;
}

function validCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (typeof c.apiKey !== "string" || c.apiKey.trim().length === 0) return false;
  if (c.provider !== "zai" && c.provider !== "bigmodel") return false;
  if (c.secret !== undefined && typeof c.secret !== "string") return false;
  if (c.jwt !== undefined && typeof c.jwt !== "string") return false;
  if (c.userId !== undefined && typeof c.userId !== "string") return false;
  if (c.expiresAt !== undefined && (typeof c.expiresAt !== "number" || !Number.isFinite(c.expiresAt))) return false;
  return true;
}

/** Validate and clone an account so callers cannot mutate the stored snapshot. */
export function normalizeAccountProfile(value: unknown): AccountProfile {
  if (!value || typeof value !== "object") throw new AccountStoreError("invalid", "account profile must be an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ACCOUNT_ID_RE.test(raw.id)) {
    throw new AccountStoreError("invalid", "account id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
  }
  if (!validCredential(raw.credential)) throw new AccountStoreError("invalid", `invalid credential for account ${raw.id}`);
  if (raw.label !== undefined && (typeof raw.label !== "string" || raw.label.length > 200)) {
    throw new AccountStoreError("invalid", `invalid label for account ${raw.id}`);
  }
  if (raw.plan !== undefined && (typeof raw.plan !== "string" || raw.plan.length > 64)) {
    throw new AccountStoreError("invalid", `invalid plan for account ${raw.id}`);
  }
  const profile: AccountProfile = {
    id: raw.id,
    credential: { ...(raw.credential as Credential) },
  };
  if (raw.label !== undefined) profile.label = raw.label as string;
  if (raw.plan !== undefined) profile.plan = raw.plan as string;
  for (const field of ["createdAt", "lastUsedAt", "lastFailureAt", "exhaustedUntil"] as const) {
    const timestamp = finiteTimestamp(raw[field], field);
    if (timestamp !== undefined) profile[field] = timestamp;
  }
  if (raw.lastFailureReason !== undefined) {
    if (typeof raw.lastFailureReason !== "string" || raw.lastFailureReason.length > 500) {
      throw new AccountStoreError("invalid", `invalid failure reason for account ${raw.id}`);
    }
    profile.lastFailureReason = raw.lastFailureReason;
  }
  return profile;
}

function validateAccounts(accounts: readonly unknown[]): AccountStore {
  if (!Array.isArray(accounts)) throw new AccountStoreError("invalid", "account store payload must be an array");
  const out: AccountStore = [];
  const ids = new Set<string>();
  for (const raw of accounts) {
    const account = normalizeAccountProfile(raw);
    if (ids.has(account.id)) throw new AccountStoreError("invalid", `duplicate account id: ${account.id}`);
    ids.add(account.id);
    out.push(account);
  }
  return out;
}

function lockPath(path: string): string {
  return `${path}.lock`;
}

function acquireLock(path: string): () => void {
  const lock = lockPath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AccountStoreError("locked", "account store is locked by another process");
    }
    throw error;
  }
  return () => {
    try { unlinkSync(lock); } catch (error) {
      // An unexpected lock disappearance must not hide a successful mutation.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}

async function readStore(path: string, migrate = true): Promise<AccountStore> {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new AccountStoreError("corrupt", `cannot read account store: ${(error as Error).message}`);
  }
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch {
    throw new AccountStoreError("corrupt", "account store is not valid JSON");
  }
  if (!envelope || typeof envelope !== "object" || typeof (envelope as Record<string, unknown>).encrypted !== "string") {
    throw new AccountStoreError("corrupt", "account store has an invalid encrypted envelope");
  }
  let plaintext: string;
  let migrated = false;
  try {
    const result = await decryptStorePayload((envelope as { encrypted: string }).encrypted);
    plaintext = result.plaintext;
    migrated = result.migrated;
  } catch {
    throw new AccountStoreError("corrupt", "account store is not decryptable on this machine");
  }
  let payload: unknown;
  try { payload = JSON.parse(plaintext); } catch {
    throw new AccountStoreError("corrupt", "decrypted account store is not valid JSON");
  }
  const accounts = validateAccounts(payload as readonly unknown[]);
  // Only migrate if the file remains exactly the one read. A concurrent add or
  // remove must never be overwritten by this read-only operation.
  if (migrated && migrate) {
    try {
      if (readFileSync(path, "utf8") === raw) {
        const encrypted = await encryptStorePayload(JSON.stringify(accounts));
        atomicWriteStore(JSON.stringify({ encrypted }), path);
      }
    } catch {
      // A read-only/mocked filesystem should still allow the caller to inspect
      // a valid legacy file. Migration is retried on the next successful load.
    }
  }
  return accounts;
}

async function writeStore(path: string, accounts: readonly AccountProfile[]): Promise<AccountStore> {
  const normalized = validateAccounts(accounts);
  const encrypted = await encryptStorePayload(JSON.stringify(normalized));
  atomicWriteStore(JSON.stringify({ encrypted }), path);
  return normalized;
}

/** Load the encrypted pool. Missing means an empty, unconfigured pool. */
export async function loadAccountStore(options: AccountStoreOptions = {}): Promise<AccountStore> {
  return readStore(accountStorePath(options.path), options.migrate !== false);
}

/** Atomically replace the encrypted pool after validating every profile. */
export async function saveAccountStore(accounts: readonly AccountProfile[], options: AccountStoreOptions = {}): Promise<AccountStore> {
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try { return await writeStore(path, accounts); } finally { release(); }
}

export interface AddAccountOptions extends AccountStoreOptions { replace?: boolean }

/** Add a profile, or replace an existing id only when `replace` is explicit. */
export async function addAccount(profile: AccountProfile, options: AddAccountOptions = {}): Promise<AccountProfile> {
  const account = normalizeAccountProfile(profile);
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const accounts = await readStore(path, options.migrate !== false);
    const index = accounts.findIndex((candidate) => candidate.id === account.id);
    if (index >= 0 && !options.replace) {
      throw new AccountStoreError("conflict", `account id already exists: ${account.id}`);
    }
    if (index >= 0) accounts[index] = account;
    else accounts.push(account);
    await writeStore(path, accounts);
    return { ...account, credential: { ...account.credential } };
  } finally { release(); }
}

/** Remove one profile and return whether an account was present. */
export async function removeAccount(id: string, options: AccountStoreOptions = {}): Promise<boolean> {
  if (typeof id !== "string" || !ACCOUNT_ID_RE.test(id)) throw new AccountStoreError("invalid", "invalid account id");
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const accounts = await readStore(path, options.migrate !== false);
    const next = accounts.filter((account) => account.id !== id);
    if (next.length === accounts.length) return false;
    await writeStore(path, next);
    return true;
  } finally { release(); }
}

// Short aliases are intentionally exported for CLI integrations that use the
// noun-less command names (`accounts add` / `accounts remove`).
export const add = addAccount;
export const remove = removeAccount;

/**
 * Bounded redacted view for offline account listings. No JWT, API key, secret,
 * or provider error text is returned.
 */
export interface AccountListView {
  id: string;
  label?: string;
  provider: Credential["provider"];
  plan?: string;
  credentialPreview: string;
  maskedCredential: string;
  state: "ready" | "active" | "exhausted" | "expired" | "invalid";
  createdAt?: number;
  lastUsedAt?: number;
  lastFailureAt?: number;
  exhaustedUntil?: number;
  lastFailureReason?: string;
}

/** Return redacted records without requiring a rotator instance. */
export async function listAccountProfiles(options: AccountStoreOptions = {}): Promise<AccountListView[]> {
  const accounts = await loadAccountStore(options);
  const now = Date.now();
  return accounts.map((account) => {
    const key = account.credential.apiKey;
    const preview = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••";
    const state = account.credential.expiresAt !== undefined && now >= account.credential.expiresAt
      ? "expired" as const
      : account.exhaustedUntil !== undefined && account.exhaustedUntil > now
        ? "exhausted" as const
        : "ready" as const;
    return {
      id: account.id,
      ...(account.label === undefined ? {} : { label: account.label }),
      provider: account.credential.provider,
      ...(account.plan === undefined ? {} : { plan: account.plan }),
      credentialPreview: preview,
      maskedCredential: preview,
      state,
      ...(account.createdAt === undefined ? {} : { createdAt: account.createdAt }),
      ...(account.lastUsedAt === undefined ? {} : { lastUsedAt: account.lastUsedAt }),
      ...(account.lastFailureAt === undefined ? {} : { lastFailureAt: account.lastFailureAt }),
      ...(account.exhaustedUntil === undefined ? {} : { exhaustedUntil: account.exhaustedUntil }),
      ...(account.lastFailureReason !== undefined && SAFE_FAILURE_REASON.test(account.lastFailureReason)
        ? { lastFailureReason: account.lastFailureReason } : {}),
    };
  });
}

/** Test helper; normal callers should remove the file through CLI logout. */
export function clearAccountStore(options: AccountStoreOptions = {}): void {
  const path = accountStorePath(options.path);
  try { rmSync(path, { force: true }); } catch {}
  try { rmSync(lockPath(path), { force: true }); } catch {}
}
