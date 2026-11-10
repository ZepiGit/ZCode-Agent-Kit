import { createHash } from "node:crypto";

// Canonical host-built state is held outside mutable Error objects. Neither an
// instanceof check nor a readonly TypeScript field makes category/message safe.
interface HostFailure {
  readonly category: CaptchaFailureCategory;
  readonly message: string;
  readonly kind: "sdk" | "incompatible" | "local-verification";
}
const hostFailures = new WeakMap<object, HostFailure>();
const LOCAL_REFUSAL = /^(solver returned empty param|verify param too short \(\d{1,6} chars\) — degraded result, refused|verify param missing securityToken — degraded result, refused|verify param not base64-JSON)$/;

/** Decode certifyId from a base64 Aliyun verify-param blob. */
export function parseCertifyId(param: string): string | null {
  try {
    const json = JSON.parse(Buffer.from(param, "base64").toString("utf8")) as {
      certifyId?: unknown;
    };
    return typeof json.certifyId === "string" && json.certifyId.length > 0
      ? json.certifyId
      : null;
  } catch {
    return null;
  }
}

export type CaptchaFailureCategory = "rate-limit" | "duplicate" | "other" | "incompatible";

/** Host-created failure: no guest message, stack, cause, or payload is retained. */
export class CaptchaSdkError extends Error {
  constructor(readonly category: CaptchaFailureCategory) {
    super(category === "rate-limit" ? "captcha SDK rate limit (429)"
      : category === "duplicate" ? "captcha SDK duplicate (F008)"
      : category === "incompatible" ? "CAPTCHA SDK incompatible"
      : "captcha SDK failure");
    this.name = "CaptchaSdkError";
    hostFailures.set(this, { category, message: this.message, kind: "sdk" });
  }
}

/** Only locally inspected method types may survive the SDK redaction boundary. */
export class CaptchaSdkIncompatibleError extends CaptchaSdkError {
  constructor(primary: unknown, fallback: unknown) {
    super("incompatible");
    const describe = (value: unknown) => value === undefined ? "missing" : `non-callable (${value === null ? "null" : typeof value})`;
    this.message += `: startTracelessVerification ${describe(primary)}; show ${describe(fallback)}`;
    hostFailures.set(this, { category: "incompatible", message: this.message, kind: "incompatible" });
  }
}

/**
 * Local verification refusal (GitHub issue 32): our own validation rejected a
 * solver result (degraded SDK output path). The detail is host-built —
 * literals plus lengths — and never contains refused payload content; control
 * characters are stripped and the text bounded so the provenance survives
 * normalization and can surface on a subsequent request failure.
 */
export class CaptchaLocalVerificationError extends CaptchaSdkError {
  constructor(detail: string) {
    super("other");
    this.name = "CaptchaLocalVerificationError";
    this.message = `verify param refused: ${LOCAL_REFUSAL.test(detail) ? detail : "local validation failure"}`;
    hostFailures.set(this, { category: "other", message: this.message, kind: "local-verification" });
  }
}

// Legacy synthetic errors remain supported, but diagnostics are never evidence.
function failurePrefix(message: string): string {
  const diagnosticStart = message.search(/\||\b(?:captchaMetadata\s*=|guestErrors\s*\(|sha256\s*=|len\s*=)/);
  return diagnosticStart < 0 ? message : message.slice(0, diagnosticStart);
}

const CAPTCHA_DUPLICATE_RE = /(?:^|[^a-z0-9_])F008(?:$|[^a-z0-9_])/i;
const CAPTCHA_IP_BLOCK_RE =
  /\b(?:too many|request was denied|risk control|frequent|rate[\s-]*limit|exceeded.*(?:request|limit)|ip\s*suspicious|denied due to|retry later)\b/i;
const CAPTCHA_STATUS_RE = /^(?:(?:fail|onError|start|verify rejected)\s*:\s*)?(?:(?:HTTP(?:\/\d(?:\.\d)?)?|status(?:Code)?|code)\s*[:=]?\s*)?429(?:$|[^a-z0-9_])/i;

function classifyMessage(message: string): CaptchaFailureCategory {
  const prefix = failurePrefix(message).trim();
  if (CAPTCHA_DUPLICATE_RE.test(prefix)) return "duplicate";
  if (CAPTCHA_IP_BLOCK_RE.test(prefix) || CAPTCHA_STATUS_RE.test(prefix)) return "rate-limit";
  return "other";
}

const CAPTCHA_ERROR_FIELDS = ["verifyCode", "code", "Code", "status", "statusCode", "message", "Message", "msg"] as const;

function errorField(error: object, key: string): unknown {
  try { return (error as Record<string, unknown>)[key]; }
  catch { return undefined; }
}

/**
 * Classify raw SDK fields BEFORE discarding them, or consume a normalized error.
 * Never stringify arbitrary objects or scan payloads/diagnostic metadata. Guest
 * category/code strings cannot impersonate the trusted incompatible error type.
 */
export function classifyCaptchaError(error: unknown): CaptchaFailureCategory {
  if (typeof error === "string") return classifyMessage(error);
  if (!error || typeof error !== "object") return "other";
  const hostFailure = hostFailures.get(error);
  if (hostFailure) return hostFailure.category;
  let category: CaptchaFailureCategory = "other";
  for (const key of CAPTCHA_ERROR_FIELDS) {
    const value = errorField(error, key);
    const fieldCategory = typeof value === "string" ? classifyMessage(value)
      : value === 429 && (key === "status" || key === "statusCode" || key === "code" || key === "Code") ? "rate-limit"
      : "other";
    // F008 remains distinct even if accompanied by a generic rate-limit phrase.
    if (fieldCategory === "duplicate") return "duplicate";
    if (fieldCategory === "rate-limit") category = "rate-limit";
  }
  return category;
}

/** Bounded diagnostic provenance; no raw text or guest serialization survives. */
export function describeCaptchaFailure(error: unknown): string {
  const canonical = error && typeof error === "object" ? hostFailures.get(error) : undefined;
  if (canonical) return canonical.message;
  const category = classifyCaptchaError(error);
  const raw = typeof error === "string" ? error
    : error && typeof error === "object" ? errorField(error, "message") : undefined;
  const message = typeof raw === "string" ? raw : "";
  return `${new CaptchaSdkError(category).message} [len=${message.length} sha256=${createHash("sha256").update(message).digest("hex")}]`;
}

/** Validate diagnostic text again after the worker transport (shape unchanged). */
export function captchaFailureFromTransport(category: CaptchaFailureCategory, message: unknown): CaptchaSdkError {
  const error = new CaptchaSdkError(category);
  const text = typeof message === "string" ? message : "";
  const localDetail = text.startsWith("verify param refused: ") ? text.slice("verify param refused: ".length) : "";
  const fixed = new Set([
    "captcha solver worker failed", "captcha solver worker exited unexpectedly",
    "captcha solver worker fault", "captcha solver deadline exceeded",
    "captcha solver worker unavailable", "captcha solver returned invalid token",
    "CAPTCHA DOM cleanup failed; runtime unavailable", "verify param refused: local validation failure",
  ]);
  const canonicalSdk = /^(captcha SDK rate limit \(429\)|captcha SDK duplicate \(F008\)|CAPTCHA SDK incompatible|captcha SDK failure)(?: \[len=\d{1,16} sha256=[0-9a-f]{64}\])?$/;
  const incompatible = /^CAPTCHA SDK incompatible: startTracelessVerification (?:missing|non-callable \((?:null|boolean|number|string|object|bigint|symbol)\)); show (?:missing|non-callable \((?:null|boolean|number|string|object|bigint|symbol)\))$/;
  // Preserve the dispatcher's pre-existing cleanup recycle predicate using a
  // fixed sentence only. No matching guest text crosses this boundary.
  error.message = /cleanup failed/.test(text) ? "CAPTCHA DOM cleanup failed; runtime unavailable"
    : fixed.has(text) || LOCAL_REFUSAL.test(localDetail) || canonicalSdk.test(text) || incompatible.test(text)
      ? text : describeCaptchaFailure(text);
  hostFailures.set(error, { category, message: error.message, kind: "sdk" });
  return error;
}

/**
 * Preserve the registered host subtype, category and method-type/refusal text,
 * not object identity. Always rebuild: typed errors can acquire hostile message,
 * stack, cause, own properties or serializers after construction.
 */
export function normalizeCaptchaError(error: unknown): CaptchaSdkError {
  const canonical = error && typeof error === "object" ? hostFailures.get(error) : undefined;
  const normalized = canonical?.kind === "incompatible"
    ? new CaptchaSdkIncompatibleError(undefined, undefined)
    : canonical?.kind === "local-verification"
      ? new CaptchaLocalVerificationError("")
      : new CaptchaSdkError(classifyCaptchaError(error));
  if (canonical) {
    // The registry holds only host-built strings/enums, never guest values.
    normalized.message = canonical.message;
    hostFailures.set(normalized, canonical);
  }
  return normalized;
}

/** Aliyun F008 — certifyId / verify token already consumed or duplicated. */
export function isCaptchaDuplicateError(error: unknown): boolean {
  return classifyCaptchaError(error) === "duplicate";
}

/** Provider rate limits/IP blocks, not local stalls or F008 duplicate tokens. */
export function isCaptchaIpBlockError(error: unknown): boolean {
  return classifyCaptchaError(error) === "rate-limit";
}
