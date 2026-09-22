import { loadConfig } from "../config/loader.js";
import type { ProxyConfig } from "../config/types.js";
import { rememberAccount } from "./account-store.js";
import { saveCredential } from "./store.js";
import type { Credential } from "./types.js";

/** All interactive login surfaces share the same opt-in persistence policy. */
export async function saveLoginCredential(
  credential: Credential,
  config: Pick<ProxyConfig, "auth" | "plan"> = loadConfig(process.env.ZCODE_PROXY_CONFIG ?? "config.yaml"),
): Promise<string | undefined> {
  if (config.auth.accounts?.enabled) {
    const account = await rememberAccount(credential, { path: config.auth.accounts.path, plan: config.plan });
    return account.id;
  }
  await saveCredential(credential);
  return undefined;
}
