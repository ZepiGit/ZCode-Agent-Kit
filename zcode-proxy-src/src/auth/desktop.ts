import { createDecipheriv, createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import type { Credential } from "./types.js";

export interface DesktopCredentialOptions {
  /** Defaults to the current OS home; callers may isolate a supported Desktop store. */
  home?: string;
  /** Uses ZCODE_CREDENTIAL_SECRET when omitted, not the proxy's store secret. */
  credentialSecret?: string;
}

function parseRecord(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Never include JSON parser excerpts from a credential file. */ }
  throw new Error("Desktop credential configuration is invalid.");
}

/** Local expiry inspection only; this does not verify signatures or establish user identity. */
function checkJwt(token: string, requireJwt = false): void {
  const parts = token.split(".");
  if (!requireJwt && parts.length !== 3) return;
  let payload: Record<string, unknown>;
  try {
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    payload = parseRecord(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload.exp !== undefined && (typeof payload.exp !== "number" || !Number.isFinite(payload.exp))) throw new Error();
  } catch {
    if (!requireJwt) return; // Older config files also support opaque API keys.
    throw new Error("Desktop start-plan credential is not a valid JWT.");
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    throw new Error("Desktop credential expired.");
  }
}

/** Supported legacy config format, used only when credentials.json is absent. */
export function parseDesktopCredential(raw: string, provider: Credential["provider"], plan?: string): Credential {
  const config = parseRecord(raw) as { provider?: Record<string, { options?: { apiKey?: unknown } }> };
  const key = config.provider?.[`builtin:${provider}-coding-plan`]?.options?.apiKey;
  const token = config.provider?.[`builtin:${provider}-start-plan`]?.options?.apiKey;
  if (typeof key !== "string" || !key.trim()) throw new Error("Desktop coding credential unavailable.");
  const jwt = typeof token === "string" && token.trim() ? token.trim() : undefined;
  if (plan === "start-plan" && !jwt) throw new Error("Desktop start-plan credential unavailable.");
  checkJwt(plan === "start-plan" ? jwt! : key.trim());
  return { apiKey: key.trim(), provider, jwt };
}

function credentialKey(home: string, secret: string | undefined): Buffer {
  let material = secret?.trim();
  if (!material) {
    let username = "unknown";
    try { username = userInfo().username; } catch { /* Vendor fallback for unavailable OS user info. */ }
    material = `zcode-credential-fallback:${platform()}:${home}:${username}`;
  }
  return createHash("sha256").update(material).digest();
}

function parseCurrentCredential(raw: string, provider: Credential["provider"], plan: string | undefined, home: string, secret: string | undefined): Credential {
  const record = parseRecord(raw);
  let key: Buffer | undefined;
  const readValue = (name: string): string | undefined => {
    const stored = record[name];
    if (stored === undefined || stored === null) return undefined;
    if (typeof stored !== "string") throw new Error("Desktop credential value is invalid.");
    const value = stored.trim();
    if (!value.startsWith("enc:")) return value || undefined;
    const match = /^enc:v1:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value);
    if (!match) throw new Error("Desktop credential encryption is unsupported or invalid.");
    const parts = match.slice(1).map(part => Buffer.from(part, "base64url"));
    if (parts[0].length !== 12 || parts[1].length !== 16 || parts.some((part, i) => part.toString("base64url") !== match[i + 1])) {
      throw new Error("Desktop credential encryption is unsupported or invalid.");
    }
    try {
      key ??= credentialKey(home, secret);
      const decipher = createDecipheriv("aes-256-gcm", key, parts[0]);
      decipher.setAuthTag(parts[1]);
      const plaintext = Buffer.concat([decipher.update(parts[2]), decipher.final()]);
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext).trim() || undefined;
    } catch {
      // Never fall back to a machine key after failure with an explicit secret.
      throw new Error("Desktop credential decryption failed; check ZCODE_CREDENTIAL_SECRET and the Desktop user.");
    }
  };

  const active = readValue("oauth:active_provider");
  if (!active) throw new Error("Desktop current active login unavailable.");
  if ((active !== "zai" && active !== "bigmodel") || active !== provider) {
    throw new Error("Desktop active login does not match the requested provider.");
  }
  const accessToken = readValue(`oauth:${provider}:access_token`);
  if (!accessToken) throw new Error("Desktop current OAuth credential unavailable.");
  // These are OAuth tokens, NOT coding API keys. Resolving a coding key can
  // create one remotely, so this read-only importer must not run KeyResolver.
  // Require an explicit plan so a caller cannot send this token to a coding API.
  if (provider !== "zai" || plan !== "start-plan") {
    throw new Error("Desktop current login supports read-only import only for the Z.AI start-plan; use OAuth login for coding-plan.");
  }
  const jwt = readValue("zcodejwttoken");
  if (!jwt) throw new Error("Desktop current start-plan credential unavailable.");
  checkJwt(jwt, true);
  // Credential requires apiKey, but start-plan authenticates with jwt only.
  // No userId is inferred from unverified JWT claims for account deduplication.
  return { apiKey: accessToken, provider, jwt };
}

function desktopSource(home: string): { path: string; modern: boolean } {
  const path = join(home, ".zcode", "v2", "credentials.json");
  try {
    // lstat keeps a dangling modern-store symlink from reviving stale config.
    lstatSync(path);
    return { path, modern: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Desktop credential store is unavailable.");
  }
  return { path: join(home, ".zcode", "v2", "config.json"), modern: false };
}

/** Read-only current login import. An existing modern store is always authoritative. */
export function importFromZCodeConfig(provider: Credential["provider"], plan?: string, options: DesktopCredentialOptions = {}): Credential {
  const home = options.home ?? homedir();
  const source = desktopSource(home);
  let raw: string;
  try { raw = readFileSync(source.path, "utf8"); }
  catch { throw new Error("Desktop credential store is unavailable."); }
  return source.modern
    ? parseCurrentCredential(raw, provider, plan, home, options.credentialSecret ?? process.env.ZCODE_CREDENTIAL_SECRET)
    : parseDesktopCredential(raw, provider, plan);
}

/** Opaque metadata marker for the effective source; never reads credential values. */
export function desktopCredentialRevision(options: Pick<DesktopCredentialOptions, "home"> = {}): string {
  let source: ReturnType<typeof desktopSource>;
  try { source = desktopSource(options.home ?? homedir()); }
  catch { return "unavailable"; }
  const kind = source.modern ? "credentials" : "config";
  try {
    const stat = statSync(source.path, { bigint: true });
    return `${kind}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch { return `${kind}:unavailable`; }
}
