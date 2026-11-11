/** Test-only failure injection around the actual serve auth factory.
 * No replacement listener, AuthManager, factory, shutdown or flush. Only the
 * first synthetic store update fails; a non-retryable injected error prevents
 * a background retry from making a missing shutdown flush pass by accident.
 */
import { mock } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as store from "../../auth/account-store.js";
import { AuthManager } from "../../auth/manager.js";

const path = process.env.ZCODE_PROXY_ACCOUNTS_PATH;
const home = process.env.HOME;
if (!home || !path || resolve(path) !== join(resolve(home), "synthetic-serve-accounts.json")) {
  throw new Error("isolated synthetic serve fixture required");
}
const realUpdate = store.updateAccountStore;
let writes = 0;
mock.module(resolve(import.meta.dir, "../../auth/account-store.ts"), () => ({
  ...store,
  updateAccountStore: async (...args: Parameters<typeof realUpdate>) => {
    if (++writes === 1) throw new store.AccountStoreError("invalid", "synthetic first write rejected");
    return realUpdate(...args);
  },
}));
const realGet = AuthManager.prototype.getCredential;
let prepared = false;
AuthManager.prototype.getCredential = async function () {
  const credential = await realGet.call(this);
  if (!prepared) {
    prepared = true;
    if (!this.isAccountPoolEnabled()) throw new Error("actual serve factory must enable fixture pool");
    this.markCredentialHealthy(credential);
    await Bun.sleep(0);
    const status = this.getPersistenceStatus();
    if (writes !== 1 || !status.unsaved || status.nextRetryAt !== undefined) {
      throw new Error("actual serve auth must remain dirty without background retry");
    }
    const snapshot = await store.loadAccountStore({ path });
    const metadata = snapshot.map(({ id, failureGeneration, lastFailureAt, exhaustedUntil, paused }) => ({ id, failureGeneration, lastFailureAt, exhaustedUntil, paused }));
    if (metadata.find(p => p.id === "synthetic")?.failureGeneration !== 0) throw new Error("fixture already persisted");
    writeFileSync(join(home!, "dirty-before-stop.json"), JSON.stringify(metadata));
  }
  return credential;
};
