/**
 * Stable upstream-user identity for local account deduplication.
 *
 * A login is the "same account" when it belongs to the same upstream user,
 * even if its tokens rotated or it arrived through a different path (Desktop
 * import carries no OAuth userId; an OAuth login does). The OAuth `userId`
 * wins when present; otherwise the `sub` claim of the start-plan login JWT is
 * used. On the live pool every account that has a userId carries the same
 * value as its JWT `sub`, so both name one upstream user.
 *
 * Trust boundary: the JWT is decoded WITHOUT signature verification. Its
 * subject is only a candidate identity for duplicate diagnostics. A matching
 * subject alone must not authorize overwriting another credential: ambiguous
 * re-logins require explicit account selection/replacement. The inferred value
 * is NEVER written into `credential.userId`, which is forwarded upstream as
 * `metadata.user_id` and must only ever hold what OAuth returned.
 */
import type { Credential } from "./types.js";

function jwtSubject(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    const sub = (payload as { sub?: unknown }).sub;
    if (typeof sub === "string") return sub.trim() || null;
    if (typeof sub === "number" && Number.isFinite(sub)) return String(sub);
    return null;
  } catch {
    return null;
  }
}

/** Upstream user identity of a login, or null when it cannot be derived. */
export function accountIdentity(credential: Pick<Credential, "userId" | "jwt">): string | null {
  const userId = typeof credential.userId === "string" ? credential.userId.trim() : "";
  if (userId) return userId;
  return typeof credential.jwt === "string" && credential.jwt ? jwtSubject(credential.jwt) : null;
}
