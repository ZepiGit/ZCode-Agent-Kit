import { existsSync, readFileSync } from "node:fs";
import { AuthManager, type CredentialSource } from "./manager.js";
import { getStorePath, loadCredential, saveCredentialIfUnchanged } from "./store.js";
import { desktopCredentialRevision, importFromZCodeConfig } from "./desktop.js";
import { createAccountRotator } from "./account-rotator.js";
import { loadAccountStoreSnapshot, updateAccountStore, type AccountProfile, type AccountStoreOptions } from "./account-store.js";
import type { Credential } from "./types.js";

function sameCredential(a: Credential, b: Credential): boolean {
  return a.provider === b.provider && a.apiKey === b.apiKey && a.secret === b.secret
    && a.jwt === b.jwt && a.userId === b.userId && a.expiresAt === b.expiresAt;
}

/** Runtime opt-in; tests/explicit injected AuthManagers remain isolated and pinned. */
export function createStoredAuthManager(plan: string, desktop: Pick<CredentialSource, "importCredential" | "importRevision"> = {}): AuthManager {
  let snapshot: string | undefined;
  return new AuthManager({
    plan,
    loadCredential: async () => {
      const path = getStorePath();
      if (!existsSync(path)) { snapshot = undefined; return null; }
      const before = readFileSync(path, "utf8");
      const cred = await loadCredential();
      // null for corruption differs from ENOENT/logout. An unstable read is retried next request.
      if (!cred || !existsSync(path) || readFileSync(path, "utf8") !== before) throw new Error("Credential store temporarily unavailable.");
      snapshot = before;
      return cred;
    },
    importRevision: desktop.importRevision ?? desktopCredentialRevision,
    importCredential: desktop.importCredential ?? (async provider => importFromZCodeConfig(provider, plan)),
    persistCredential: async cred => snapshot !== undefined && await saveCredentialIfUnchanged(cred, snapshot),
  });
}

export interface StoredAccountPoolOptions extends AccountStoreOptions {
  /** Config gate. `false` preserves the legacy credentials.json path. */
  enabled?: boolean;
  provider?: Credential["provider"];
  allowedIds?: readonly string[];
  pausedIds?: readonly string[];
  allowPaid?: boolean;
}

/**
 * Build the runtime auth manager for a loaded proxy config. The encrypted pool
 * is loaded before serving so an enabled-but-corrupt pool fails closed; an
 * enabled empty pool also remains authoritative and never silently falls back
 * to credentials.json. The synchronous factory above remains for tests and
 * compatibility callers that intentionally use one credential.
 */
export async function createStoredAuthManagerWithAccounts(
  plan: string,
  accounts: StoredAccountPoolOptions | undefined,
  desktop: Pick<CredentialSource, "importCredential" | "importRevision"> = {},
): Promise<AuthManager> {
  const base = createStoredAuthManager(plan, desktop);
  if (!accounts?.enabled) return base;
  const storeOptions: AccountStoreOptions = accounts.path ? { path: accounts.path } : {};
  const initial = await loadAccountStoreSnapshot(storeOptions);
  const rotator = createAccountRotator(initial.accounts, {
    plan,
    provider: accounts.provider,
    allowedAccountIds: accounts.allowedIds,
    pausedAccountIds: accounts.pausedIds,
    allowPaid: accounts.allowPaid,
  });
  let observedRevision = initial.revision;
  let refreshInFlight: Promise<void> | undefined;
  const refreshAccountPool = async (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const current = await loadAccountStoreSnapshot(storeOptions);
      if (current.revision !== observedRevision) {
        rotator.syncProfiles(current.accounts);
        observedRevision = current.revision;
      }
    })();
    try { await refreshInFlight; } finally { refreshInFlight = undefined; }
  };
  return new AuthManager({
    plan,
    accountRotator: rotator,
    // Persist only runtime metadata against the current authoritative pool.
    // Administrative add/remove/pause/credential changes made by another
    // process are preserved and become visible on the next request.
    persistAccounts: async next => {
      const byId = new Map(next.map(account => [account.id, account]));
      const result = await updateAccountStore(current => current.map((authoritative): AccountProfile => {
        const runtime = byId.get(authoritative.id);
        if (!runtime) return authoritative;
        // A credential replacement increments the revision. Never apply state
        // from a request that used the old credential to the new one.
        if ((runtime.credentialRevision !== undefined && authoritative.credentialRevision !== undefined
          && runtime.credentialRevision !== authoritative.credentialRevision)
          || (runtime.credential && authoritative.credential
            && !sameCredential(runtime.credential, authoritative.credential))) return authoritative;
        const authoritativeFailureAt = authoritative.lastFailureAt ?? 0;
        const runtimeFailureAt = runtime.lastFailureAt ?? 0;
        const authoritativeFailureGeneration = authoritative.failureGeneration ?? 0;
        const runtimeFailureGeneration = runtime.failureGeneration ?? 0;
        return {
          ...authoritative,
          // Runtime metadata is advisory; never let an older snapshot clear
          // a newer administrator/request update in the authoritative store.
          lastUsedAt: Math.max(authoritative.lastUsedAt ?? 0, runtime.lastUsedAt ?? 0) || undefined,
          lastFailureAt: Math.max(authoritativeFailureAt, runtimeFailureAt) || undefined,
          exhaustedUntil: Math.max(authoritative.exhaustedUntil ?? 0, runtime.exhaustedUntil ?? 0) || undefined,
          lastFailureReason: runtimeFailureGeneration > authoritativeFailureGeneration
            || (runtimeFailureGeneration === authoritativeFailureGeneration && runtimeFailureAt >= authoritativeFailureAt)
            ? (runtime.lastFailureReason ?? authoritative.lastFailureReason)
            : authoritative.lastFailureReason,
          failureGeneration: Math.max(authoritative.failureGeneration ?? 0, runtime.failureGeneration ?? 0),
          quotaGeneration: Math.max(authoritative.quotaGeneration ?? 0, runtime.quotaGeneration ?? 0),
          credentialRevision: authoritative.credentialRevision ?? runtime.credentialRevision,
        };
      }), storeOptions);
      rotator.syncProfiles(result.accounts);
      observedRevision = result.revision;
    },
    refreshAccountPool,
    // Retain the desktop source for explicit claim/login compatibility, but it
    // is intentionally ignored by request-time pool selection.
    importCredential: desktop.importCredential ?? (async provider => importFromZCodeConfig(provider, plan)),
    importRevision: desktop.importRevision ?? desktopCredentialRevision,
    loadCredential: async () => {
      const path = getStorePath();
      if (!existsSync(path)) return null;
      const before = readFileSync(path, "utf8");
      const cred = await loadCredential();
      if (!cred || !existsSync(path) || readFileSync(path, "utf8") !== before) throw new Error("Credential store temporarily unavailable.");
      return cred;
    },
  });
}
