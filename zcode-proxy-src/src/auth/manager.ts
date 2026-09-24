import { createHash } from "node:crypto";
import { credentialString, isExpired, type Credential } from "./types.js";
import type { AccountProfile } from "./account-store.js";
import { AccountRotator, NoUsableAccountError, type AccountHandle, type AccountOperation } from "./account-rotator.js";

export interface CredentialSource {
  plan?: string;
  /** Clock seam for bounded transient persistence retry; defaults to Date.now. */
  now?: () => number;
  /** Opaque revision of the existing desktop source; never an upstream call. */
  importRevision?: () => string;
  persistCredential?: (credential: Credential) => Promise<boolean>;
  /** Opt-in only: explicit/injected credentials do not read disk by default. */
  loadCredential?: () => Promise<Credential | null>;
  /** Read-only existing desktop import; never login, create keys, or claim. */
  importCredential?: (provider: Credential["provider"]) => Promise<Credential | null>;
  /** Optional multi-account scheduler. When present it is authoritative and
   * legacy single-credential reload/recovery is never used for requests. */
  accountRotator?: AccountRotator;
  /** Refresh the authoritative account source before admitting a new request. */
  refreshAccountPool?: () => Promise<void>;
  /** Persist scheduler metadata (exhaustion/reset markers) after rotation. */
  persistAccounts?: (accounts: readonly AccountProfile[]) => Promise<void>;
}

function valid(cred: Credential | null, allowExpired = false): cred is Credential {
  return !!cred && typeof cred.apiKey === "string" && cred.apiKey.trim().length > 0
    && (cred.provider === "zai" || cred.provider === "bigmodel")
    && (cred.secret === undefined || typeof cred.secret === "string")
    && (cred.jwt === undefined || typeof cred.jwt === "string")
    && (cred.expiresAt === undefined || (Number.isFinite(cred.expiresAt) && (allowExpired || !isExpired(cred))));
}
function fingerprint(cred: Credential, plan?: string): string {
  const token = plan === "start-plan" ? cred.jwt ?? "" : credentialString(cred);
  return createHash("sha256").update(JSON.stringify([cred.provider, token, plan ? undefined : cred.jwt, plan ? undefined : cred.expiresAt])).digest("hex");
}

/** Request-time persisted reload with last-good retention and singleflight recovery. */
export class AuthManager {
  private oauthCred: Credential | null = null;
  private revision = 0;
  private persistedFingerprint: string | undefined;
  private loading: Promise<void> | undefined;
  private recovering: Promise<void> | undefined;
  // Hashes only; bounded memory. At capacity recovery fails closed until restart.
  private attempted = new Set<string>();
  private persistenceFailures = new Map<string, { count: number; retryAt: number }>();
  private poolRecoveries = new Map<string, Promise<AccountHandle | null>>();
  private poolPersistence: Promise<void> | undefined;
  private poolPersistenceDirty = false;
  private readonly sameCredentialRetryBlockedUntil = new Map<string, number>();
  private persistenceStatus: { state: "clean" | "dirty" | "error"; code?: string; at?: number; attempts: number } = { state: "clean", attempts: 0 };
  constructor(private source: CredentialSource = {}) {}

  /** True when an explicitly enabled account pool is authoritative. */
  isAccountPoolEnabled(): boolean { return this.source.accountRotator !== undefined; }

  /** Redacted scheduler view for callers that need to display account state. */
  listAccounts(): ReturnType<AccountRotator["list"]> {
    return this.source.accountRotator?.list() ?? [];
  }

  /** Refresh the authoritative pool for status/diagnostic reads without selecting an account. */
  async refreshAccountPool(): Promise<void> {
    await this.source.refreshAccountPool?.();
  }

  /** Resolve a credential returned by the pool to its redacted account id. */
  accountIdForCredential(credential: Credential): string | undefined {
    return this.source.accountRotator?.idForCredential(credential);
  }

  /** Select an immutable request context. New pooled call sites should use this. */
  async getCredentialHandle(options: { operation?: AccountOperation; model?: string } = {}): Promise<AccountHandle> {
    if (this.source.refreshAccountPool) await this.source.refreshAccountPool();
    const rotator = this.source.accountRotator;
    if (!rotator) {
      const credential = await this.getCredential();
      return {
        id: "legacy",
        credential: { ...credential },
        credentialRevision: this.revision,
        failureGeneration: 0,
        quotaGeneration: 0,
        provider: credential.provider,
        ...(this.source.plan === undefined ? {} : { plan: this.source.plan }),
        // Legacy requests do not participate in pool failover. Keep an opaque
        // identity value without retaining the credential in diagnostics.
        effectiveIdentity: "legacy",
      };
    }
    try { return rotator.getCredentialHandle(options); }
    catch (error) {
      if (error instanceof NoUsableAccountError) {
        throw new Error("No usable account is available — add an account or wait for quota reset");
      }
      throw error;
    }
  }

  private async reload(): Promise<void> {
    if (!this.source.loadCredential) return;
    if (this.loading) return this.loading;
    const revision = this.revision;
    this.loading = (async () => {
      try {
        const cred = await this.source.loadCredential!();
        if (this.revision !== revision) return;
        if (cred === null) {
          this.oauthCred = null;
          this.persistedFingerprint = undefined;
          this.revision++;
          return;
        }
        if (!valid(cred, true)) return;
        const key = fingerprint(cred);
        if (key === this.persistedFingerprint) return;
        this.persistedFingerprint = key;
        this.oauthCred = { ...cred };
        this.revision++;
      } catch { /* A partial write must not replace the last good credential. */ }
    })();
    try { await this.loading; } finally { this.loading = undefined; }
  }

  async getCredential(): Promise<Credential> {
    if (this.source.refreshAccountPool) await this.source.refreshAccountPool();
    if (this.source.accountRotator) {
      try {
        return this.source.accountRotator.getCredential();
      } catch (error) {
        if (error instanceof NoUsableAccountError) {
          throw new Error("No usable account is available — add an account or wait for quota reset");
        }
        throw error;
      }
    }
    await this.reload();
    if (this.oauthCred) {
      if (isExpired(this.oauthCred)) {
        if (this.source.plan) {
          const fresh = await this.recoverCredential(this.oauthCred, this.source.plan);
          if (fresh) return fresh;
        }
        // Retain a configured expired recovery candidate, but never return it upstream.
        if (!this.source.plan) this.oauthCred = null;
        throw new Error("OAuth credential expired; re-authentication required — run: zcode-proxy auth login");
      }
      return { ...this.oauthCred };
    }
    throw new Error("OAuth credential not available — run: zcode-proxy auth login");
  }

  /** Redacted machine-readable persistence state for doctor/live status. */
  getPersistenceStatus(): Readonly<{ state: "clean" | "dirty" | "error"; code?: string; at?: number; attempts: number }> {
    return { ...this.persistenceStatus };
  }

  /** Re-read the authoritative store and validate an admitted request handle. */
  async validateAccountHandle(handle: AccountHandle): Promise<boolean> {
    if (!this.source.accountRotator) return true;
    if (this.source.refreshAccountPool) await this.source.refreshAccountPool();
    return this.source.accountRotator.isHandleCurrent(handle);
  }

  /** At most one desktop read per rejected effective credential, shared by requests. */
  async recoverCredential(failed: Credential, plan: string, reason?: string, resetAt?: number): Promise<Credential | null> {
    if (this.source.accountRotator) {
      const handle = this.source.accountRotator.handleForId(this.source.accountRotator.idForCredential(failed) ?? "");
      const recovered = await this.recoverFromAccountPool(handle ?? failed, reason, resetAt);
      return recovered?.credential ?? null;
    }
    // 1005 is an account quota signal, not a credential-refresh signal. A
    // legacy single-account install has no alternate profile to use, so do
    // not re-import and replay the same exhausted account.
    if (reason === "1005") return null;
    const failedKey = fingerprint(failed, plan);
    const different = (): Credential | null => {
      const current = this.oauthCred;
      return valid(current) && current.provider === failed.provider
        && (plan !== "start-plan" || !!current.jwt?.trim())
        && fingerprint(current, plan) !== failedKey ? { ...current } : null;
    };
    await this.reload();
    if (!this.oauthCred) return null; // An explicit logout must not be undone by an in-flight failure.
    if (different()) return different();
    if (this.recovering) { await this.recovering; return different(); }
    let sourceRevision: string;
    try { sourceRevision = this.source.importRevision?.() ?? "fixed"; } catch { return null; }
    const attemptKey = `${failedKey}:${sourceRevision}`;
    const persistenceFailure = this.persistenceFailures.get(attemptKey);
    const now = this.source.now?.() ?? Date.now();
    const retryPersistence = persistenceFailure && persistenceFailure.count < 3 && now >= persistenceFailure.retryAt;
    if (!this.source.importCredential || (this.attempted.has(attemptKey) && !retryPersistence)
      || (!this.attempted.has(attemptKey) && this.attempted.size >= 128)) return null;
    this.attempted.add(attemptKey);
    const revision = this.revision;
    this.recovering = (async () => {
      try {
        const fresh = await this.source.importCredential!(failed.provider);
        if (this.revision !== revision || !valid(fresh) || fresh.provider !== failed.provider
          || (plan === "start-plan" && !fresh.jwt?.trim()) || fingerprint(fresh, plan) === failedKey) return;
        if (this.source.persistCredential) {
          let persisted = false;
          try { persisted = await this.source.persistCredential(fresh); } catch { /* retry bounded below */ }
          if (!persisted) {
            this.persistenceFailures.set(attemptKey, { count: (persistenceFailure?.count ?? 0) + 1,
              retryAt: (this.source.now?.() ?? Date.now()) + 30_000 });
            return;
          }
          this.persistenceFailures.delete(attemptKey);
        }
        if (this.revision !== revision) return;
        this.oauthCred = { ...fresh };
        if (this.source.persistCredential) this.persistedFingerprint = fingerprint(fresh);
        this.revision++;
      } catch { /* Import failures are deliberately silent and non-destructive. */ }
    })();
    try { await this.recovering; } finally { this.recovering = undefined; }
    return different();
  }

  /** Handle-preserving recovery for transport code that carries request context. */
  async recoverCredentialHandle(
    failed: AccountHandle,
    plan: string,
    reason?: string,
    resetAt?: number,
    attemptedIdentities?: ReadonlySet<string>,
  ): Promise<AccountHandle | null> {
    if (!this.source.accountRotator) return null;
    return this.recoverFromAccountPool(failed, reason, resetAt, attemptedIdentities);
  }

  setOAuthCredential(cred: Credential): void {
    // Pool mode is authoritative. Keeping this setter harmless lets the TUI,
    // Android control path, and compatibility callers refresh the legacy
    // credential without accidentally disabling account rotation.
    if (this.source.accountRotator) return;
    this.oauthCred = { ...cred };
    this.revision++;
  }

  /** Clear a transient quota marker after a successful request. */
  markCredentialHealthy(credentialOrHandle: Credential | AccountHandle): void {
    const rotator = this.source.accountRotator;
    if (!rotator) return;
    const changed = "id" in credentialOrHandle && "credentialRevision" in credentialOrHandle
      ? rotator.clearFailure(credentialOrHandle)
      : (() => {
        const id = rotator.idForCredential(credentialOrHandle);
        return id ? rotator.clearFailure(id) : false;
      })();
    if (changed) void this.persistAccounts();
  }

  /** Mark the selected pooled account exhausted after a final quota response. */
  markCredentialExhausted(credentialOrHandle: Credential | AccountHandle, reason: string, resetAt?: number): void {
    const rotator = this.source.accountRotator;
    if (!rotator) return;
    if ("id" in credentialOrHandle && "credentialRevision" in credentialOrHandle) {
      rotator.markExhausted(credentialOrHandle, reason, resetAt);
    } else {
      const id = rotator.idForCredential(credentialOrHandle);
      if (!id) return;
      rotator.markExhausted(id, reason, resetAt);
    }
    void this.persistAccounts();
  }

  private persistAccounts(): Promise<void> {
    const persist = this.source.persistAccounts;
    const rotator = this.source.accountRotator;
    if (!persist || !rotator) return Promise.resolve();
    this.poolPersistenceDirty = true;
    this.persistenceStatus = { state: "dirty", attempts: this.persistenceStatus.attempts };
    if (this.poolPersistence) return this.poolPersistence;
    // One writer owns the store at a time. A failure/health change arriving
    // while encryption or I/O is pending sets dirty again; the next pass uses
    // the current snapshot rather than losing it to the sidecar's live lock.
    // Queue the first pass so the shared promise is installed even when an
    // injected writer throws synchronously. Clear it in the loop's own final
    // microtask so no completed promise can absorb a later dirty update.
    this.poolPersistence = Promise.resolve().then(async () => {
      try {
        let passes = 0;
        do {
          passes += 1;
          this.poolPersistenceDirty = false;
          try {
            await persist(rotator.profiles());
            this.persistenceStatus = { state: "clean", attempts: this.persistenceStatus.attempts };
          } catch {
            this.persistenceStatus = { state: "error", code: "ACCOUNT_STORE_PERSISTENCE_FAILED", at: Date.now(), attempts: this.persistenceStatus.attempts + 1 };
            // Do not spin forever while a lock or disk is unavailable. The
            // live state remains usable only after the next authoritative
            // refresh succeeds; diagnostics expose this failure explicitly.
            this.poolPersistenceDirty = false;
          }
        } while (this.poolPersistenceDirty && passes < 3);
      } finally { this.poolPersistence = undefined; }
    });
    return this.poolPersistence;
  }

  /**
   * Whether one same-account resend may still use this credential or handle.
   * Pool mode re-checks full admission via the rotator (revision, identity,
   * usable state, alias quarantine). Legacy single-account installs have no
   * quarantine memory, so a per-credential memo remembers a failed
   * same-account retry until the reset time or a bounded cooldown.
   */
  canResendCredential(target: Credential | AccountHandle): boolean {
    const rotator = this.source.accountRotator;
    if (!rotator) {
      // The memo expires at its recorded reset time or cooldown; without
      // this check the first failed retry would disable the package
      // fall-through until the process restarts.
      const key = this.retryMemoKey(target);
      const until = this.sameCredentialRetryBlockedUntil.get(key);
      if (until !== undefined && until <= Date.now()) this.sameCredentialRetryBlockedUntil.delete(key);
      return !this.sameCredentialRetryBlockedUntil.has(key);
    }
    const handle = "credentialRevision" in target
      ? target
      : (() => {
        const id = rotator.idForCredential(target);
        return id ? rotator.handleForId(id) : undefined;
      })();
    return handle ? rotator.canResendHandle(handle) : false;
  }

  /** Record that a same-account retry already returned a quota envelope. */
  blockSameCredentialRetry(target: Credential | AccountHandle, resetAt?: number): void {
    const key = this.retryMemoKey(target);
    const map = this.sameCredentialRetryBlockedUntil;
    if (map.size >= 256 && !map.has(key)) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    const now = Date.now();
    map.set(key, resetAt !== undefined && resetAt > now ? resetAt : now + 60_000);
  }

  private retryMemoKey(target: Credential | AccountHandle): string {
    const credential = "credentialRevision" in target ? target.credential : target;
    return createHash("sha256")
      .update(JSON.stringify([credential.provider, credential.apiKey, credential.jwt ?? "", credential.userId ?? ""]))
      .digest("hex")
      .slice(0, 24);
  }

  private recoverFromAccountPool(
    failed: Credential | AccountHandle,
    reason?: string,
    resetAt?: number,
    attemptedIdentities?: ReadonlySet<string>,
  ): Promise<AccountHandle | null> {
    const rotator = this.source.accountRotator!;
    // Pool rotation is only authorized by an explicit balance/quota code. A
    // caller without a reason must never turn a generic auth/model/transport
    // failure into account churn.
    if (reason === undefined || !["1005", "1113", "3001"].includes(String(reason))) {
      return Promise.resolve(null);
    }
    const failedHandle: AccountHandle | undefined = "id" in failed && "credentialRevision" in failed
      ? failed
      : (() => {
        const id = rotator.idForCredential(failed);
        return id ? rotator.handleForId(id) : undefined;
      })();
    if (!failedHandle) return Promise.resolve(null);
    const id = failedHandle.id;
    // A response that arrives after a newer quarantine or credential replace
    // must not open another failover chain from stale state.
    const currentHandle = rotator.handleForId(id);
    if (!currentHandle
      || currentHandle.credentialRevision !== failedHandle.credentialRevision
      || currentHandle.failureGeneration !== failedHandle.failureGeneration
      || currentHandle.quotaGeneration !== failedHandle.quotaGeneration
      || currentHandle.effectiveIdentity !== failedHandle.effectiveIdentity) {
      return Promise.resolve(null);
    }
    const existing = this.poolRecoveries.get(`${id}:${failedHandle.credentialRevision}:${failedHandle.quotaGeneration}`);
    if (existing) return existing;
    const recovery = (async () => {
      // Pool rotation is deliberately limited to explicit quota/balance
      // signals. `upstream-errors.ts` filters the code before entering here;
      // the reason is retained only as a bounded local diagnostic.
      rotator.markExhausted(failedHandle, reason ?? "quota exhausted", resetAt);
      await this.persistAccounts();
      try {
        return rotator.getCredentialHandle({
          excludedIds: new Set([failedHandle.id]),
          excludedIdentities: new Set([failedHandle.effectiveIdentity, ...(attemptedIdentities ?? [])]),
        });
      } catch { return null; }
    })();
    const key = `${id}:${failedHandle.credentialRevision}:${failedHandle.quotaGeneration}`;
    this.poolRecoveries.set(key, recovery);
    void recovery.finally(() => {
      if (this.poolRecoveries.get(key) === recovery) this.poolRecoveries.delete(key);
    });
    return recovery;
  }
}
