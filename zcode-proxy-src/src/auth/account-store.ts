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
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  atomicWriteStore,
  decryptStorePayload,
  encryptStorePayload,
} from "./store.js";
import { credentialString, type Credential } from "./types.js";
import { accountIdentity } from "./account-identity.js";

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
  /** Administrative pause. Paused accounts never receive new requests. */
  paused?: boolean;
  /** Incremented whenever credentials are replaced for this account. */
  credentialRevision?: number;
  /** Monotonic generation for quota/failure state. */
  quotaGeneration?: number;
  /** Monotonic generation for request failures/credential state. */
  failureGeneration?: number;
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
  /** Explicitly opt in to a legacy-key migration. Reads are read-only by default. */
  migrate?: boolean;
  /** Expected authoritative revision for a compare-and-swap replacement. */
  expectedRevision?: number;
};

/** Metadata attached to an encrypted pool payload. */
export interface AccountStoreSnapshot {
  accounts: AccountStore;
  /** Monotonically increasing revision; legacy array payloads start at zero. */
  revision: number;
  /** True when the file was decrypted with a legacy key. */
  migrated: boolean;
}

export interface AccountStoreMigrationResult extends AccountStoreSnapshot {
  /** True only when this call rewrote the store using the current key. */
  migrationPerformed: boolean;
}

/** Failure labels accepted in redacted account overviews. */
const SAFE_FAILURE_REASON = /^(?:1005|1113|3001|quota(?:[ _-]exhausted)?|insufficient(?:[ _-]balance)?|account(?:[ _-]rejected)?)$/i;

export class AccountStoreError extends Error {
  readonly code: "invalid" | "locked" | "corrupt" | "conflict" | "persistence";

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
  if (raw.paused !== undefined) {
    if (typeof raw.paused !== "boolean") throw new AccountStoreError("invalid", `invalid paused flag for account ${raw.id}`);
    profile.paused = raw.paused;
  }
  for (const field of ["credentialRevision", "quotaGeneration", "failureGeneration"] as const) {
    if (raw[field] !== undefined && (!Number.isSafeInteger(raw[field]) || (raw[field] as number) < 0)) {
      throw new AccountStoreError("invalid", `invalid account ${field}`);
    }
    if (raw[field] !== undefined) profile[field] = raw[field] as number;
  }
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

/** Compare effective credentials in-memory without persisting a fingerprint. */
export function equivalentCredential(a: AccountProfile, b: AccountProfile): boolean {
  const left = a.credential;
  const right = b.credential;
  return a.plan === b.plan
    && left.provider === right.provider
    && left.apiKey === right.apiKey
    && left.secret === right.secret
    && left.jwt === right.jwt
    && left.userId === right.userId;
}

/** Return duplicate account IDs grouped by effective provider/plan identity. */
export function duplicateCredentialGroups(accounts: readonly AccountProfile[]): string[][] {
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < accounts.length; i++) {
    if (seen.has(accounts[i].id)) continue;
    const group = accounts.filter((candidate, j) => j !== i && equivalentCredential(accounts[i], candidate)).map(candidate => candidate.id);
    if (group.length > 0) {
      group.unshift(accounts[i].id);
      groups.push(group);
      for (const id of group) seen.add(id);
    }
  }
  return groups;
}

/**
 * Account IDs that name one upstream user (same OAuth userId or login JWT
 * subject) under different credentials within one provider and plan, e.g. an
 * explicit `--account` alias of an already stored login. Byte-identical groups
 * are left to duplicateCredentialGroups so one alias is not reported twice.
 * The rotator and the pool quota route still treat these as separate entries
 * (they compare token bytes); only doctor/health/login surface them.
 */
export function sameIdentityGroups(accounts: readonly AccountProfile[]): string[][] {
  const byIdentity = new Map<string, AccountProfile[]>();
  for (const account of accounts) {
    const identity = accountIdentity(account.credential);
    if (!identity) continue;
    const key = JSON.stringify([account.credential.provider, account.plan ?? "", identity]);
    const members = byIdentity.get(key);
    if (members) members.push(account);
    else byIdentity.set(key, [account]);
  }
  return [...byIdentity.values()]
    .filter(members => members.length > 1 && !members.every(member => equivalentCredential(members[0], member)))
    .map(members => members.map(member => member.id));
}

function lockPath(path: string): string {
  return `${path}.lock`;
}

type LockRecord = {
  pid: number;
  host: string;
  nonce: string;
  createdAt: number;
  processStartToken?: string;
};

function processStartToken(pid: number): string | undefined {
  // Linux exposes a kernel start-time counter in /proc/<pid>/stat. Including
  // it prevents PID reuse from making a live process look like the lock owner.
  if (process.platform !== "linux") return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return undefined;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    return fields[19]; // field 22 overall, after pid/comm
  } catch { return undefined; }
}

function parseLockRecord(raw: string): LockRecord | undefined {
  try {
    const value = JSON.parse(raw) as Partial<LockRecord>;
    if (!Number.isInteger(value.pid) || (value.pid as number) <= 0) return undefined;
    if (typeof value.host !== "string" || typeof value.nonce !== "string" || value.nonce.length < 16) return undefined;
    if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return undefined;
    if (value.processStartToken !== undefined && typeof value.processStartToken !== "string") return undefined;
    return value as LockRecord;
  } catch { return undefined; }
}

function ownerIsAlive(record: LockRecord): boolean {
  if (record.host !== hostname()) return true;
  if (record.processStartToken !== undefined) {
    const current = processStartToken(record.pid);
    if (current !== undefined && current !== record.processStartToken) return false;
    // Without a comparable start token, fail closed. PID alone is not enough
    // to prove ownership after process reuse, including for our own PID.
    if (current === undefined) return true;
  }
  if (record.pid === process.pid) return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Recover a lock only after proving its recorded owner is gone. Age alone is
 * deliberately never sufficient. The expected nonce is optional for legacy
 * callers but strongly recommended by diagnostics/tools.
 */
export function recoverAccountStoreLock(pathOrOptions: string | AccountStoreOptions, expectedNonce?: string): boolean {
  const path = typeof pathOrOptions === "string" ? pathOrOptions : accountStorePath(pathOrOptions.path);
  const lock = lockPath(path);
  let raw: string;
  try { raw = readFileSync(lock, "utf8"); } catch { return false; }
  const record = parseLockRecord(raw);
  if (!record || (expectedNonce !== undefined && record.nonce !== expectedNonce) || ownerIsAlive(record)) return false;
  try {
    // Re-read immediately before the atomic rename so a lock replacement or
    // owner restart cannot be mistaken for the record inspected above.
    const latest = parseLockRecord(readFileSync(lock, "utf8"));
    if (!latest || latest.nonce !== record.nonce || ownerIsAlive(latest)) return false;
    // Rename gives the recovery operation an atomic name transition. A new
    // owner cannot replace an existing lock, so this cannot steal a live lock.
    const quarantine = `${lock}.recovered-${process.pid}-${Math.random().toString(16).slice(2)}`;
    renameSync(lock, quarantine);
    try { unlinkSync(quarantine); } catch {}
    return true;
  } catch { return false; }
}

function acquireLock(path: string): () => void {
  const lock = lockPath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const record: LockRecord = {
    pid: process.pid,
    host: hostname(),
    nonce: randomUUID(),
    createdAt: Date.now(),
    ...(processStartToken(process.pid) === undefined ? {} : { processStartToken: processStartToken(process.pid) }),
  };
  try {
    writeFileSync(lock, JSON.stringify(record), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      let detail = "account store is locked by another process";
      try {
        const owner = parseLockRecord(readFileSync(lock, "utf8"));
        if (owner && !ownerIsAlive(owner)) detail = "account store lock owner is gone; run explicit lock recovery";
      } catch {}
      throw new AccountStoreError("locked", detail);
    }
    throw new AccountStoreError("persistence", `cannot create account store lock: ${(error as Error).message}`);
  }
  return () => {
    try {
      // Never remove a lock that has been replaced by another owner after a
      // successful write. Compare the nonce before unlinking.
      const current = parseLockRecord(readFileSync(lock, "utf8"));
      if (!current || current.nonce !== record.nonce || current.pid !== record.pid) return;
      unlinkSync(lock);
    } catch (error) {
      // An unexpected lock disappearance must not hide a successful mutation.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}

async function readStoreSnapshot(path: string): Promise<AccountStoreSnapshot> {
  if (!existsSync(path)) return { accounts: [], revision: 0, migrated: false };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new AccountStoreError("persistence", `cannot read account store: ${(error as Error).message}`);
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
  } catch (error) {
    if (error instanceof Error && /must contain at least/.test(error.message)) {
      throw new AccountStoreError("invalid", error.message);
    }
    throw new AccountStoreError("corrupt", "account store is not decryptable on this machine");
  }
  let payload: unknown;
  try { payload = JSON.parse(plaintext); } catch {
    throw new AccountStoreError("corrupt", "decrypted account store is not valid JSON");
  }
  let revision = 0;
  let accountPayload: unknown = payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (record.accounts !== undefined) {
      accountPayload = record.accounts;
      if (record.revision !== undefined && (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0)) {
        throw new AccountStoreError("corrupt", "account store has an invalid revision");
      }
      revision = typeof record.revision === "number" ? record.revision : 0;
    }
  }
  return { accounts: validateAccounts(accountPayload as readonly unknown[]), revision, migrated };
}

async function readStore(path: string): Promise<AccountStore> {
  return (await readStoreSnapshot(path)).accounts;
}

async function writeStore(path: string, accounts: readonly AccountProfile[], revision = 1): Promise<AccountStore> {
  const normalized = validateAccounts(accounts);
  // Keep account payload versioned while preserving the outer envelope shape
  // understood by old clients. The revision is authoritative for CAS writes.
  const versioned = JSON.stringify({ version: 2, revision, accounts: normalized });
  let versionedEncrypted: string;
  try {
    versionedEncrypted = await encryptStorePayload(versioned);
  } catch (error) {
    if (error instanceof Error && /must contain at least/.test(error.message)) {
      throw new AccountStoreError("invalid", error.message);
    }
    throw new AccountStoreError("persistence", `cannot encrypt account store: ${(error as Error).message}`);
  }
  atomicWriteStore(JSON.stringify({ version: 2, encrypted: versionedEncrypted }), path);
  return normalized;
}

/** Load the encrypted pool. Missing means an empty, unconfigured pool. */
export async function loadAccountStore(options: AccountStoreOptions = {}): Promise<AccountStore> {
  // Reads are intentionally side-effect free. Legacy-key migration is an
  // explicit administrative operation via migrateAccountStore(). Preserve the
  // historical `{ migrate: true }` opt-in for callers that explicitly request
  // the write, while the default remains read-only.
  if (options.migrate === true) return (await migrateAccountStore(options)).accounts;
  return readStore(accountStorePath(options.path));
}

/** Read current state and revision without any migration or write. */
export async function loadAccountStoreSnapshot(options: AccountStoreOptions = {}): Promise<AccountStoreSnapshot> {
  return readStoreSnapshot(accountStorePath(options.path));
}

/** Explicitly migrate a legacy-key payload under the same mutation lock. */
export async function migrateAccountStore(options: AccountStoreOptions = {}): Promise<AccountStoreMigrationResult> {
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const current = await readStoreSnapshot(path);
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new AccountStoreError("conflict", `account store revision conflict (expected ${options.expectedRevision}, found ${current.revision})`);
    }
    if (!current.migrated) return { ...current, migrationPerformed: false };
    const nextRevision = current.revision + 1;
    await writeStore(path, current.accounts, nextRevision);
    return { accounts: current.accounts, revision: nextRevision, migrated: false, migrationPerformed: true };
  } finally { release(); }
}

/** Atomically replace the encrypted pool after validating every profile. */
export async function saveAccountStore(accounts: readonly AccountProfile[], options: AccountStoreOptions = {}): Promise<AccountStore> {
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const current = await readStoreSnapshot(path);
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new AccountStoreError("conflict", `account store revision conflict (expected ${options.expectedRevision}, found ${current.revision})`);
    }
    return await writeStore(path, accounts, current.revision + 1);
  } finally { release(); }
}

/**
 * Apply a mutation to the current authoritative pool while holding the lock.
 * This is the safe primitive for live runtimes: callers never write a stale
 * in-memory snapshot back over a newer administrative change.
 */
export async function updateAccountStore(
  mutate: (accounts: AccountStore, revision: number) => AccountStore | Promise<AccountStore>,
  options: AccountStoreOptions = {},
): Promise<AccountStoreSnapshot> {
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const current = await readStoreSnapshot(path);
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new AccountStoreError("conflict", `account store revision conflict (expected ${options.expectedRevision}, found ${current.revision})`);
    }
    const next = validateAccounts(await mutate(current.accounts.map(a => ({ ...a, credential: { ...a.credential } })), current.revision));
    const revision = current.revision + 1;
    await writeStore(path, next, revision);
    return { accounts: next, revision, migrated: false };
  } finally { release(); }
}

export interface AddAccountOptions extends AccountStoreOptions { replace?: boolean }

/** A successful login adds a distinct account or refreshes its existing profile. */
export async function rememberAccount(credential: Credential, options: AccountStoreOptions & { plan?: string } = {}): Promise<AccountProfile> {
  if (!validCredential(credential)) throw new AccountStoreError("invalid", "invalid login credential");
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const current = await readStoreSnapshot(path);
    const incomingIdentity = accountIdentity(credential);
    const prior = current.accounts.find(account => {
      const old = account.credential;
      if (old.provider !== credential.provider || (account.plan && options.plan && account.plan !== options.plan)) return false;
      // Two OAuth-verified user ids decide alone: different users stay
      // separate even if a token happens to agree.
      if (old.userId?.trim() && credential.userId?.trim()) return old.userId === credential.userId;
      if (credentialString(old) === credentialString(credential) || (!!old.jwt && old.jwt === credential.jwt)) return true;
      return false;
    });
    if (!prior && incomingIdentity) {
      const candidates = current.accounts.filter(account =>
        account.credential.provider === credential.provider
        && !(account.plan && options.plan && account.plan !== options.plan)
        && !(account.credential.userId?.trim() && credential.userId?.trim())
        && accountIdentity(account.credential) === incomingIdentity);
      if (candidates.length) {
        // A decoded JWT claim can identify a possible duplicate, but it cannot
        // authorize replacing another stored credential. Refuse both overwrite
        // and duplicate insertion until the operator chooses the target.
        const ids = candidates.map(account => account.id).join(", ");
        throw new AccountStoreError("conflict", `possible existing login: ${ids}; identity not verified — use zcode-kit auth login ${credential.provider} --account ID --replace to select the account explicitly`);
      }
    }
    if (prior) {
      // Preserve labels, pauses and quota state: logging in does not reset a limit.
      const fresh = { ...credential, userId: credential.userId ?? prior.credential.userId };
      if (["apiKey", "secret", "jwt", "userId", "expiresAt", "provider"].every(key =>
        prior.credential[key as keyof Credential] === fresh[key as keyof Credential])) return prior;
      prior.credential = fresh;
      prior.credentialRevision = (prior.credentialRevision ?? 1) + 1;
    } else {
      let number = 1;
      while (current.accounts.some(account => account.id === `${credential.provider}-${number}`)) number++;
      current.accounts.push({ id: `${credential.provider}-${number}`, credential: { ...credential },
        plan: options.plan, createdAt: Date.now(), credentialRevision: 1 });
    }
    await writeStore(path, current.accounts, current.revision + 1);
    return prior ?? current.accounts[current.accounts.length - 1];
  } finally { release(); }
}

/** Add a profile, or replace an existing id only when `replace` is explicit. */
export async function addAccount(profile: AccountProfile, options: AddAccountOptions = {}): Promise<AccountProfile> {
  const account = normalizeAccountProfile(profile);
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const current = await readStoreSnapshot(path);
    const accounts = current.accounts;
    const index = accounts.findIndex((candidate) => candidate.id === account.id);
    if (index >= 0 && !options.replace) {
      throw new AccountStoreError("conflict", `account id already exists: ${account.id}`);
    }
    if (index >= 0) {
      const prior = accounts[index];
      accounts[index] = {
        ...prior,
        ...account,
        createdAt: prior.createdAt ?? account.createdAt,
        credentialRevision: Math.max(account.credentialRevision ?? 0, (prior.credentialRevision ?? 0) + 1),
      };
    }
    else accounts.push(account);
    await writeStore(path, accounts, current.revision + 1);
    const stored = accounts[index >= 0 ? index : accounts.length - 1];
    return { ...stored, credential: { ...stored.credential } };
  } finally { release(); }
}

/** Remove one profile and return whether an account was present. */
export async function removeAccount(id: string, options: AccountStoreOptions = {}): Promise<boolean> {
  if (typeof id !== "string" || !ACCOUNT_ID_RE.test(id)) throw new AccountStoreError("invalid", "invalid account id");
  const path = accountStorePath(options.path);
  const release = acquireLock(path);
  try {
    const current = await readStoreSnapshot(path);
    const accounts = current.accounts;
    const next = accounts.filter((account) => account.id !== id);
    if (next.length === accounts.length) return false;
    await writeStore(path, next, current.revision + 1);
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
  state: "ready" | "active" | "paused" | "exhausted" | "expired" | "invalid";
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
    const preview = "redacted";
    const state = account.paused
      ? "paused" as const
      : account.credential.expiresAt !== undefined && now >= account.credential.expiresAt
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
