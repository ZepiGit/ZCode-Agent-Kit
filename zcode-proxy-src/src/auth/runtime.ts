import { existsSync, readFileSync } from "node:fs";
import { AuthManager, type CredentialSource } from "./manager.js";
import { getStorePath, loadCredential, saveCredentialIfUnchanged } from "./store.js";
import { desktopCredentialRevision, importFromZCodeConfig } from "./desktop.js";

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
