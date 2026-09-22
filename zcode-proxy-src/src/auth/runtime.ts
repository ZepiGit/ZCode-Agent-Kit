import { existsSync, readFileSync } from "node:fs";
import { AuthManager, type CredentialSource } from "./manager.js";
import { getStorePath, loadCredential, saveCredentialIfUnchanged } from "./store.js";
import { desktopCredentialRevision, importFromZCodeConfig } from "./desktop.js";
import { createAccountRotator } from "./account-rotator.js";
import { loadAccountStore, saveAccountStore, type AccountStoreOptions } from "./account-store.js";
import type { Credential } from "./types.js";

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
  const profiles = await loadAccountStore(storeOptions);
  const rotator = createAccountRotator(profiles, { plan, provider: accounts.provider });
  return new AuthManager({
    plan,
    accountRotator: rotator,
    persistAccounts: async next => { await saveAccountStore(next, storeOptions); },
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
