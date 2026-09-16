import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credential } from "./types.js";

const DESKTOP_CONFIG = join(homedir(), ".zcode", "v2", "config.json");

/** The existing --import format and source only; no alternate precedence or network. */
export function parseDesktopCredential(raw: string, provider: Credential["provider"], plan?: string): Credential {
  let config: any;
  try { config = JSON.parse(raw); } catch { throw new Error("Desktop credential configuration is incomplete."); }
  const key = config?.provider?.[`builtin:${provider}-coding-plan`]?.options?.apiKey;
  const token = config?.provider?.[`builtin:${provider}-start-plan`]?.options?.apiKey;
  if (typeof key !== "string" || !key.trim()) throw new Error("Desktop coding credential unavailable.");
  const jwt = typeof token === "string" && token.trim() ? token.trim() : undefined;
  const effective = plan === "start-plan" ? jwt : key.trim();
  if (plan === "start-plan" && !jwt) throw new Error("Desktop start-plan credential unavailable.");
  // JWT expiry is checked locally only, never refreshed over the network.
  if (effective?.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(effective.split(".")[1], "base64url").toString("utf8"));
      if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) throw new Error("expired");
    } catch (err) {
      if ((err as Error).message === "expired") throw new Error("Desktop credential expired.");
    }
  }
  return { apiKey: key.trim(), provider, jwt };
}
export function importFromZCodeConfig(provider: Credential["provider"], plan?: string): Credential {
  return parseDesktopCredential(readFileSync(DESKTOP_CONFIG, "utf8"), provider, plan);
}
/** Opaque file change marker; does not read credentials or choose another source. */
export function desktopCredentialRevision(): string {
  try {
    const stat = statSync(DESKTOP_CONFIG, { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch { return "unavailable"; }
}
