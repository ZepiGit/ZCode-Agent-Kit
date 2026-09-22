/**
 * Deterministic in-memory account scheduler.
 *
 * Persistence belongs to account-store.ts; this class deliberately owns only
 * a cloned snapshot and request-time failure state. A caller can persist the
 * updated profiles after an exhaustion event without exposing a secret to a
 * list or log. At most one profile is selected for each call to getCredential.
 */
import { createHash } from "node:crypto";
import { credentialString, type Credential } from "./types.js";
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
  /** Optional project/policy filters applied before every selection. */
  allowedAccountIds?: readonly string[] | ReadonlySet<string>;
  /** Operator-paused ids; unlike quota cooldowns this is administrative. */
  pausedAccountIds?: readonly string[] | ReadonlySet<string>;
  /** Exclude paid or unknown-cost profiles when false. */
  allowPaid?: boolean;
}

/**
 * Immutable request context.  A handle is intentionally richer than a bare
 * credential: a late response can only update the account state when all of
 * these generations still match the state that was selected for the request.
 * `effectiveIdentity` is a one-way value used solely to exclude duplicate
 * credentials during one recovery chain; it is never persisted or displayed.
 */
export interface AccountHandle {
  readonly id: string;
  readonly credential: Credential;
  readonly credentialRevision: number;
  readonly failureGeneration: number;
  readonly quotaGeneration: number;
  readonly provider: Credential["provider"];
  readonly plan?: AccountPlan;
  readonly effectiveIdentity: string;
}

export type AccountOperation = "inference" | "billing" | "quota" | "async";

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
  credentialRevision: number;
  failureGeneration: number;
  quotaGeneration: number;
  unknownFailureCount: number;
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
  const source = account as AccountProfile & Record<string, unknown>;
  const revision = Number.isInteger(source.credentialRevision) && Number(source.credentialRevision) > 0
    ? Number(source.credentialRevision) : 1;
  const failureGeneration = Number.isInteger(source.failureGeneration) && Number(source.failureGeneration) >= 0
    ? Number(source.failureGeneration) : 0;
  const quotaGeneration = Number.isInteger(source.quotaGeneration) && Number(source.quotaGeneration) >= 0
    ? Number(source.quotaGeneration) : 0;
  return {
    ...account,
    credential: { ...account.credential },
    order,
    credentialRevision: revision,
    failureGeneration,
    quotaGeneration,
    unknownFailureCount: 0,
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
  // Even a prefix/suffix is a reusable credential fingerprint. Status and
  // diagnostics therefore expose a constant marker only.
  return credential ? "redacted" : "redacted";
}

function sameCredential(a: Credential, b: Credential): boolean {
  return a.provider === b.provider && a.apiKey === b.apiKey && a.secret === b.secret
    && a.jwt === b.jwt && a.userId === b.userId && a.expiresAt === b.expiresAt;
}

/** Hash the effective upstream identity, never retaining the token itself. */
function effectiveIdentity(credential: Credential, plan?: AccountPlan): string {
  const token = plan === "start-plan" ? credential.jwt ?? "" : credentialString(credential);
  return createHash("sha256")
    .update(JSON.stringify([credential.provider, plan ?? "", token, credential.userId ?? ""]))
    .digest("hex");
}

function sameHandle(account: RuntimeProfile, handle: AccountHandle): boolean {
  return account.id === handle.id
    && account.credentialRevision === handle.credentialRevision
    && account.failureGeneration === handle.failureGeneration
    && account.quotaGeneration === handle.quotaGeneration
    && sameCredential(account.credential, handle.credential);
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
  private allowedAccountIds?: ReadonlySet<string>;
  private pausedAccountIds: ReadonlySet<string>;
  private readonly allowPaid: boolean;
  /** Next stable position to try after the current account is exhausted. */
  private cursor = 0;
  /** Keep serving this account until an explicit quota signal quarantines it. */
  private activeAccountId: string | undefined;
  private lastSelectedId: string | undefined;

  constructor(accounts: readonly AccountProfile[], options: AccountRotatorOptions = {}) {
    this.accounts = accounts.map((account, index) => cloneProfile(account, index));
    this.plan = options.plan;
    this.provider = options.provider;
    this.now = options.now ?? (() => Date.now());
    this.cooldownMs = Number.isFinite(options.cooldownMs) && (options.cooldownMs ?? 0) > 0
      ? options.cooldownMs!
      : DEFAULT_COOLDOWN_MS;
    this.allowedAccountIds = options.allowedAccountIds === undefined
      ? undefined
      : new Set(options.allowedAccountIds);
    this.pausedAccountIds = new Set(options.pausedAccountIds ?? []);
    this.allowPaid = options.allowPaid !== false;
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

  private isUsable(account: RuntimeProfile, now: number, excluded: ReadonlySet<string> = new Set<string>(), operation?: AccountOperation): boolean {
    if (!account || excluded.has(account.id) || !validProfile(account)) return false;
    if (this.allowedAccountIds && !this.allowedAccountIds.has(account.id)) return false;
    if (this.pausedAccountIds.has(account.id)) return false;
    if ((account as AccountProfile & { paused?: boolean }).paused === true) return false;
    if ((operation === "billing" || operation === "quota" || operation === "async")
      && (!account.credential.jwt || account.credential.jwt.trim().length === 0)) return false;
    if (!this.allowPaid && account.plan !== "coding-plan" && account.plan !== "start-plan") return false;
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

  /** Merge the latest authoritative store before a new request is selected. */
  syncProfiles(profiles: readonly AccountProfile[]): boolean {
    const previous = new Map(this.accounts.map((account) => [account.id, account]));
    const activeBefore = this.activeAccountId;
    const next = profiles.map((profile, order) => {
      const prior = previous.get(profile.id);
      const merged = cloneProfile(profile, order);
      if (prior && sameCredential(prior.credential, merged.credential)) {
        merged.unknownFailureCount = prior.unknownFailureCount;
        merged.credentialRevision = Math.max(prior.credentialRevision, merged.credentialRevision);
        merged.failureGeneration = Math.max(prior.failureGeneration, merged.failureGeneration);
        merged.quotaGeneration = Math.max(prior.quotaGeneration, merged.quotaGeneration);
        merged.lastUsedAt = Math.max(prior.lastUsedAt ?? 0, merged.lastUsedAt ?? 0) || undefined;
        merged.lastFailureAt = Math.max(prior.lastFailureAt ?? 0, merged.lastFailureAt ?? 0) || undefined;
        merged.exhaustedUntil = Math.max(prior.exhaustedUntil ?? 0, merged.exhaustedUntil ?? 0) || undefined;
        if (prior.lastFailureReason && !merged.lastFailureReason) merged.lastFailureReason = prior.lastFailureReason;
      } else if (prior) {
        merged.credentialRevision = Math.max(merged.credentialRevision, prior.credentialRevision + 1);
        merged.failureGeneration = Math.max(merged.failureGeneration, prior.failureGeneration + 1);
        merged.quotaGeneration = Math.max(merged.quotaGeneration, prior.quotaGeneration + 1);
      }
      return merged;
    });
    const changed = next.length !== this.accounts.length || next.some((account, index) => {
      const before = this.accounts[index];
      return !before || before.id !== account.id || !sameCredential(before.credential, account.credential)
        || before.paused !== account.paused || before.exhaustedUntil !== account.exhaustedUntil;
    });
    this.accounts.splice(0, this.accounts.length, ...next);
    const active = activeBefore ? this.accounts.find((account) => account.id === activeBefore) : undefined;
    if (!active || !this.isUsable(active, this.now())) {
      this.activeAccountId = undefined;
      if (!active) this.lastSelectedId = undefined;
      this.cursor = this.accounts.length ? Math.min(this.cursor, this.accounts.length - 1) : 0;
    }
    return changed;
  }

  /** Apply a policy edit without resetting the active account unnecessarily. */
  setPolicy(options: Pick<AccountRotatorOptions, "allowedAccountIds" | "pausedAccountIds">): void {
    this.allowedAccountIds = options.allowedAccountIds === undefined ? undefined : new Set(options.allowedAccountIds);
    this.pausedAccountIds = new Set(options.pausedAccountIds ?? []);
    if (this.activeAccountId) {
      const active = this.accounts.find((account) => account.id === this.activeAccountId);
      if (!active || !this.isUsable(active, this.now())) this.activeAccountId = undefined;
    }
  }

  /**
   * Return the active account's credential. The active account remains sticky
   * across requests, so configured quotas are consumed sequentially. The
   * cursor advances only after an explicit exhaustion signal quarantines it.
   */
  getCredential(): Credential {
    return this.getCredentialHandle().credential;
  }

  /** Same selection as getCredential, with the stable id needed for marking failures. */
  getCredentialHandle(options: { excludedIds?: ReadonlySet<string>; excludedIdentities?: ReadonlySet<string>; operation?: AccountOperation; model?: string } = {}): AccountHandle {
    const now = this.now();
    const excluded = options.excludedIds ?? new Set<string>();
    const seenIdentities = new Set<string>();
    const blockedIdentities = new Set<string>();
    const total = this.accounts.length || 1;
    // A duplicate credential is one effective upstream identity. If any alias
    // is quarantined, none of its aliases may masquerade as fresh capacity.
    for (const account of this.accounts) {
      if (account?.exhaustedUntil !== undefined && account.exhaustedUntil > now) {
        blockedIdentities.add(effectiveIdentity(account.credential, this.plan ?? account.plan));
      }
    }
    const candidates: RuntimeProfile[] = [];
    // Stable cyclic search avoids sorting the whole pool on every request and
    // de-duplicates aliases of one effective provider credential.
    for (let offset = 0; offset < total; offset++) {
      const account = this.accounts[(this.cursor + offset) % total];
      if (!this.isUsable(account, now, excluded, options.operation)) continue;
      const identity = effectiveIdentity(account.credential, this.plan ?? account.plan);
      if (blockedIdentities.has(identity) || options.excludedIdentities?.has(identity) || seenIdentities.has(identity)) continue;
      seenIdentities.add(identity);
      candidates.push(account);
    }
    if (candidates.length === 0) throw new NoUsableAccountError();
    const active = this.activeAccountId
      ? candidates.find((candidate) => candidate.id === this.activeAccountId)
      : undefined;
    const account = active ?? candidates[0];
    this.activeAccountId = account.id;
    account.lastUsedAt = now;
    this.lastSelectedId = account.id;
    return {
      id: account.id,
      credential: { ...account.credential },
      credentialRevision: account.credentialRevision,
      failureGeneration: account.failureGeneration,
      quotaGeneration: account.quotaGeneration,
      provider: account.credential.provider,
      ...(account.plan === undefined ? {} : { plan: account.plan }),
      effectiveIdentity: effectiveIdentity(account.credential, this.plan ?? account.plan),
    };
  }

  /** Id associated with the most recent getCredential call, if any. */
  getSelectedId(): string | undefined {
    return this.lastSelectedId;
  }

  /** Resolve a credential returned by getCredential back to its account id. */
  idForCredential(credential: Credential): string | undefined {
    const matches = this.accounts.filter((account) => sameCredential(account.credential, credential));
    // A bare credential has no stable account identity when aliases exist.
    // Returning the first token match would let a late result mutate the wrong
    // account, so callers must pass the immutable AccountHandle in that case.
    return matches.length === 1 ? matches[0].id : undefined;
  }

  /** Return the current handle for an id, if it is still configured. */
  handleForId(id: string): AccountHandle | undefined {
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account) return undefined;
    return {
      id: account.id,
      credential: { ...account.credential },
      credentialRevision: account.credentialRevision,
      failureGeneration: account.failureGeneration,
      quotaGeneration: account.quotaGeneration,
      provider: account.credential.provider,
      ...(account.plan === undefined ? {} : { plan: account.plan }),
      effectiveIdentity: effectiveIdentity(account.credential, this.plan ?? account.plan),
    };
  }

  /** Admission check immediately before transport dispatch. */
  isHandleCurrent(handle: AccountHandle): boolean {
    const account = this.accounts.find((candidate) => candidate.id === handle.id);
    return !!account && sameHandle(account, handle) && this.isUsable(account, this.now());
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
  markExhausted(idOrHandle: string | AccountHandle, reason = "quota exhausted", resetAt?: number): void {
    const id = typeof idOrHandle === "string" ? idOrHandle : idOrHandle.id;
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account) return;
    if (typeof idOrHandle !== "string" && !sameHandle(account, idOrHandle)) return;
    const now = this.now();
    const explicitReset = typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > now;
    const requestedReset = explicitReset
      ? resetAt as number
      : now + Math.min(this.cooldownMs * 2 ** Math.min(account.unknownFailureCount, 4), 15 * 60_000);
    if (explicitReset) account.unknownFailureCount = 0;
    else account.unknownFailureCount += 1;
    // Never shorten a known reset window when a weaker/older response arrives
    // later. This is also safe for the legacy id API, where no generation is
    // available to reject a stale caller outright.
    account.exhaustedUntil = Math.max(account.exhaustedUntil ?? 0, requestedReset);
    account.lastFailureAt = now;
    account.failureGeneration += 1;
    account.quotaGeneration += 1;
    if (this.activeAccountId === id) {
      this.activeAccountId = undefined;
      this.cursor = (account.order + 1) % (this.accounts.length || 1);
    }
    // Keep persisted failure details bounded and line-oriented. Callers should
    // pass a stable code (1005/1113/3001) rather than provider response text.
    account.lastFailureReason = safeFailureReason(reason);
  }

  /** Clear a transient exhaustion marker so the account can be selected again. */
  clearFailure(idOrHandle: string | AccountHandle): boolean {
    const id = typeof idOrHandle === "string" ? idOrHandle : idOrHandle.id;
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account) return false;
    if (typeof idOrHandle !== "string" && !sameHandle(account, idOrHandle)) return false;
    const changed = account.exhaustedUntil !== undefined || account.lastFailureAt !== undefined || account.lastFailureReason !== undefined;
    account.exhaustedUntil = undefined;
    account.lastFailureAt = undefined;
    account.lastFailureReason = undefined;
    account.unknownFailureCount = 0;
    if (changed) account.failureGeneration += 1;
    return changed;
  }

  /** Replace credentials only when the caller names the exact current revision. */
  replaceCredential(id: string, credential: Credential, expectedRevision?: number): boolean {
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account || !validProfile({ ...account, credential })) return false;
    if (expectedRevision !== undefined && account.credentialRevision !== expectedRevision) return false;
    if (sameCredential(account.credential, credential)) return false;
    account.credential = { ...credential };
    account.credentialRevision += 1;
    account.failureGeneration += 1;
    account.quotaGeneration += 1;
    account.exhaustedUntil = undefined;
    account.lastFailureAt = undefined;
    account.lastFailureReason = undefined;
    account.unknownFailureCount = 0;
    if (this.activeAccountId === id) this.activeAccountId = undefined;
    return true;
  }

  /** Return a bounded redacted view suitable for CLI text or JSON output. */
  list(): AccountListView[] {
    const now = this.now();
    return this.accounts.map((account) => {
      const credential = account.credential;
      let state: AccountListView["state"] = "ready";
      if (!validProfile(account)) state = "invalid";
      else if ((account as AccountProfile & { paused?: boolean }).paused === true
        || this.pausedAccountIds.has(account.id)
        || (this.allowedAccountIds !== undefined && !this.allowedAccountIds.has(account.id))) state = "paused" as AccountListView["state"];
      else if (!this.allowPaid && account.plan !== "coding-plan" && account.plan !== "start-plan") state = "invalid";
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
      credentialRevision: account.credentialRevision,
      failureGeneration: account.failureGeneration,
      quotaGeneration: account.quotaGeneration,
    }));
  }
}
