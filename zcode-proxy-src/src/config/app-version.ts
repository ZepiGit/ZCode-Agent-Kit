/**
 * Client identity the proxy announces to the ZCode gateway.
 *
 * The start-plan gateway answers an outdated identity with HTTP 200 and an
 * empty success envelope (`{"code":0,"msg":""}`) instead of a model reply.
 * 4.0.0 is the current ZCode desktop release. Only the previous shipped
 * default is rewritten; a version the operator chose is left alone.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const CURRENT_APP_VERSION = "4.0.0";

/** Kit defaults the current gateway no longer accepts. */
export const RETIRED_APP_VERSIONS = ["3.14.3"] as const;

const APP_VERSION_LINE = /^([ \t]*appVersion:[ \t]*)(["']?)([0-9A-Za-z._-]+)\2([ \t]*(?:#.*)?)$/gm;

/** Replace a retired `identity.appVersion` value. Comments, quoting and line endings stay. */
export function migrateRetiredAppVersion(text: string): string {
  if (!text) return text;
  return text.replace(APP_VERSION_LINE, (line, prefix: string, quote: string, version: string, rest: string) => {
    if (!(RETIRED_APP_VERSIONS as readonly string[]).includes(version)) return line;
    return `${prefix}${quote}${CURRENT_APP_VERSION}${quote}${rest}`;
  });
}

/**
 * Rewrite `path` when it still announces a retired default.
 * Returns true when the file changed. A missing file is left alone.
 */
export function migrateRetiredAppVersionFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const source = readFileSync(path, "utf8");
  const migrated = migrateRetiredAppVersion(source);
  if (migrated === source) return false;
  writeFileSync(path, migrated, "utf8");
  return true;
}
