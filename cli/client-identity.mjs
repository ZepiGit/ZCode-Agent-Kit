// Client identity the kit writes into proxy/config.yaml.
// Kept in step with zcode-proxy-src/src/config/app-version.ts: the proxy
// builds on its own, so the two copies cannot import each other. A test
// pins that the current release and the retired defaults stay equal.
//
// The start-plan gateway answers an outdated identity with HTTP 200 and an
// empty success envelope instead of a model reply. Only the previous shipped
// default is rewritten; a version the operator chose is left alone.

export const CURRENT_APP_VERSION = "4.0.0";

/** Kit defaults the current gateway no longer accepts. */
export const RETIRED_APP_VERSIONS = ["3.14.3"];

const APP_VERSION_LINE = /^([ \t]*appVersion:[ \t]*)(["']?)([0-9A-Za-z._-]+)\2([ \t]*(?:#.*)?)$/gm;

/** Replace a retired `identity.appVersion` value. Comments, quoting and line endings stay. */
export function migrateRetiredAppVersion(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  return text.replace(APP_VERSION_LINE, (line, prefix, quote, version, rest) => {
    if (!RETIRED_APP_VERSIONS.includes(version)) return line;
    return `${prefix}${quote}${CURRENT_APP_VERSION}${quote}${rest}`;
  });
}
