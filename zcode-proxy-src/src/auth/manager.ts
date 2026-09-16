import { createHash } from "node:crypto";
import { credentialString, isExpired, type Credential } from "./types.js";

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
  constructor(private source: CredentialSource = {}) {}

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

  /** At most one desktop read per rejected effective credential, shared by requests. */
  async recoverCredential(failed: Credential, plan: string): Promise<Credential | null> {
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

  setOAuthCredential(cred: Credential): void {
    this.oauthCred = { ...cred };
    this.revision++;
  }
}
