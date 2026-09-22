/**
 * Deterministic in-memory account scheduler.
 *
 * Persistence belongs to account-store.ts; this class deliberately owns only
 * a cloned snapshot and request-time failure state. A caller can persist the
 * updated profiles after an exhaustion event without exposing a secret to a
 * list or log. At most one profile is selected for each call to getCredential.
 */
import type { Credential } from "./types.js";
import { isExpired } from "./types.js";
import type { AccountListView, AccountProfile } from "./account-store.js";

export type AccountPlan = "coding-plan" | "start-plan" | string;

export interface AccountRotatorOptions {
  plan?: AccountPlan;
  /** Clock seam for deterministic tests and reset-time calculations. */
  now?: () => number;
  /** Fallback quarantine when upstream omits a reset timestamp. */
  cooldownMs?: number;
  /** Optional provider affinity (normally supplied by proxy config). */
  provider?: Credential["provider"];
}

export interface AccountHandle {
  id: string;
  credential: Credential;
}

export class NoUsableAccountError extends Error {
  readonly code = "NO_USABLE_ACCOUNT" as const;
  constructor(message = "No usable account is available") {
    super(message);
    this.name = "NoUsableAccountError";
  }
}

type RuntimeProfile = AccountProfile & {
  /** Original position is a stable tie-breaker for deterministic selection. */
  readonly order: number;
};

const DEFAULT_COOLDOWN_MS = 60_000;
const SAFE_FAILURE_REASON = /^(?:1005|1113|3001|quota(?:[ _-]exhausted)?|insufficient(?:[ _-]balance)?|account(?:[ _-]rejected)?)$/i;

function safeFailureReason(reason: unknown): string {
  const text = String(reason ?? "quota exhausted").replace(/[\r\n]+/g, " ").trim();
  if (SAFE_FAILURE_REASON.test(text)) return text.slice(0, 64);
  // Keep arbitrary upstream text out of the persisted/listed profile. The
  // caller can pass one of the explicit upstream codes for a useful label.
  return "quota_exhausted";
}

function cloneProfile(account: AccountProfile, order: number): RuntimeProfile {
  return {
    ...account,
    credential: { ...account.credential },
    order,
  };
}

function validProfile(account: AccountProfile): boolean {
  const c = account?.credential as unknown as Record<string, unknown> | undefined;
  return !!account && typeof account.id === "string" && account.id.length > 0
    && !!c && typeof c.apiKey === "string" && c.apiKey.trim().length > 0
    && (c.provider === "zai" || c.provider === "bigmodel")
    && (c.expiresAt === undefined || (typeof c.expiresAt === "number" && Number.isFinite(c.expiresAt)));
}

function maskCredential(credential: Credential | undefined): string {
  const key = credential?.apiKey;
  if (!key || typeof key !== "string") return "••••";
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••";
}

function sameCredential(a: Credential, b: Credential): boolean {
  return a.provider === b.provider && a.apiKey === b.apiKey && a.secret === b.secret
    && a.jwt === b.jwt && a.userId === b.userId && a.expiresAt === b.expiresAt;
}

/**
 * Create a deterministic scheduler over an immutable account snapshot.
 * Profiles are cloned at construction; caller mutations cannot alter active
 * requests or the scheduler's failure state.
 */
export function createAccountRotator(accounts: readonly AccountProfile[], options: AccountRotatorOptions = {}): AccountRotator {
  return new AccountRotator(accounts, options);
}

export class AccountRotator {
  private readonly accounts: RuntimeProfile[];
  private readonly plan: AccountPlan | undefined;
  private readonly provider: Credential["provider"] | undefined;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private cursor = 0;
  private lastSelectedId: string | undefined;

  constructor(accounts: readonly AccountProfile[], options: AccountRotatorOptions = {}) {
    this.accounts = accounts.map((account, index) => cloneProfile(account, index));
    this.plan = options.plan;
    this.provider = options.provider;
    this.now = options.now ?? (() => Date.now());
    this.cooldownMs = Number.isFinite(options.cooldownMs) && (options.cooldownMs ?? 0) > 0
      ? options.cooldownMs!
      : DEFAULT_COOLDOWN_MS;
  }

  private isPlanCompatible(account: RuntimeProfile): boolean {
    if (!this.plan) return true;
    if (account.plan !== undefined && account.plan !== this.plan) return false;
    if (this.plan === "start-plan") return typeof account.credential?.jwt === "string" && account.credential.jwt.trim().length > 0;
    // Coding-plan credentials use the API key portion. Secret is required by
    // some Z.AI accounts upstream, but provider-specific validation handles it
    // later; requiring it here would hide valid BigModel profiles.
    return typeof account.credential?.apiKey === "string" && account.credential.apiKey.trim().length > 0;
  }

  private isUsable(account: RuntimeProfile, now: number, excluded = new Set<string>()): boolean {
    if (excluded.has(account.id) || !validProfile(account)) return false;
    if (this.provider && account.credential.provider !== this.provider) return false;
    if (!this.isPlanCompatible(account)) return false;
    if (isExpired(account.credential, now)) return false;
    if (account.exhaustedUntil !== undefined && account.exhaustedUntil > now) return false;
    // A reset marker in the past is lazily cleared when encountered.
    if (account.exhaustedUntil !== undefined && account.exhaustedUntil <= now) {
      account.exhaustedUntil = undefined;
      account.lastFailureReason = undefined;
    }
    return true;
  }

  /** Return the next account's credential, using least-recently-used ordering. */
  getCredential(): Credential {
    return this.getCredentialHandle().credential;
  }

  /** Same selection as getCredential, with the stable id needed for marking failures. */
  getCredentialHandle(): AccountHandle {
    const now = this.now();
    const excluded = new Set<string>();
    const candidates = this.accounts.filter((account) => this.isUsable(account, now, excluded));
    if (candidates.length === 0) throw new NoUsableAccountError();
    const total = this.accounts.length || 1;
    candidates.sort((a, b) => {
      const aUsed = a.lastUsedAt ?? Number.NEGATIVE_INFINITY;
      const bUsed = b.lastUsedAt ?? Number.NEGATIVE_INFINITY;
      if (aUsed !== bUsed) return aUsed - bUsed;
      const aDistance = (a.order - this.cursor + total) % total;
      const bDistance = (b.order - this.cursor + total) % total;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return a.order - b.order;
    });
    const account = candidates[0];
    account.lastUsedAt = now;
    this.cursor = (account.order + 1) % total;
    this.lastSelectedId = account.id;
    return { id: account.id, credential: { ...account.credential } };
  }

  /** Id associated with the most recent getCredential call, if any. */
  getSelectedId(): string | undefined {
    return this.lastSelectedId;
  }

  /** Resolve a credential returned by getCredential back to its account id. */
  idForCredential(credential: Credential): string | undefined {
    const exact = this.accounts.find((account) => sameCredential(account.credential, credential));
    return exact?.id;
  }

  /** Alias useful to AuthManager integration code that wants an explicit handle. */
  select(): AccountHandle {
    return this.getCredentialHandle();
  }

  /**
   * Quarantine an account after an explicit upstream balance/quota signal.
   * `resetAt` is honored only when it is a finite future timestamp; otherwise
   * a bounded cooldown prevents request storms while allowing recovery.
   */
  markExhausted(id: string, reason = "quota exhausted", resetAt?: number): void {
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account) return;
    const now = this.now();
    const requestedReset = typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > now
      ? resetAt
      : now + this.cooldownMs;
    account.exhaustedUntil = requestedReset;
    account.lastFailureAt = now;
    // Keep persisted failure details bounded and line-oriented. Callers should
    // pass a stable code (1005/1113/3001) rather than provider response text.
    account.lastFailureReason = safeFailureReason(reason);
  }

  /** Clear a transient exhaustion marker so the account can be selected again. */
  clearFailure(id: string): boolean {
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account) return false;
    const changed = account.exhaustedUntil !== undefined || account.lastFailureAt !== undefined || account.lastFailureReason !== undefined;
    account.exhaustedUntil = undefined;
    account.lastFailureAt = undefined;
    account.lastFailureReason = undefined;
    return changed;
  }

  /** Return a bounded redacted view suitable for CLI text or JSON output. */
  list(): AccountListView[] {
    const now = this.now();
    return this.accounts.map((account) => {
      const credential = account.credential;
      let state: AccountListView["state"] = "ready";
      if (!validProfile(account)) state = "invalid";
      else if (this.provider && credential.provider !== this.provider) state = "invalid";
      else if (!this.isPlanCompatible(account)) state = "invalid";
      else if (isExpired(credential, now)) state = "expired";
      else if (account.exhaustedUntil !== undefined && account.exhaustedUntil > now) state = "exhausted";
      else if (account.id === this.lastSelectedId) state = "active";
      const preview = maskCredential(credential);
      return {
        id: account.id,
        ...(account.label === undefined ? {} : { label: account.label }),
        provider: credential?.provider,
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
      } as AccountListView;
    });
  }

  /** Snapshot profiles for persistence. Never returns references to internal credentials. */
  profiles(): AccountProfile[] {
    return this.accounts.map(({ order: _order, ...account }) => ({
      ...account,
      credential: { ...account.credential },
      ...(account.lastFailureReason === undefined ? {} : { lastFailureReason: safeFailureReason(account.lastFailureReason) }),
    }));
  }
}
