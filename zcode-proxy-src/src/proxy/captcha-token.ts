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
  }
}

/** Only locally inspected method types may survive the SDK redaction boundary. */
export class CaptchaSdkIncompatibleError extends CaptchaSdkError {
  constructor(primary: unknown, fallback: unknown) {
    super("incompatible");
    const describe = (value: unknown) => value === undefined ? "missing" : `non-callable (${value === null ? "null" : typeof value})`;
    this.message += `: startTracelessVerification ${describe(primary)}; show ${describe(fallback)}`;
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
  if (error instanceof CaptchaSdkError) return error.category;
  if (typeof error === "string") return classifyMessage(error);
  if (!error || typeof error !== "object") return "other";
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

export function normalizeCaptchaError(error: unknown): CaptchaSdkError {
  return error instanceof CaptchaSdkError ? error : new CaptchaSdkError(classifyCaptchaError(error));
}

/** Aliyun F008 — certifyId / verify token already consumed or duplicated. */
export function isCaptchaDuplicateError(error: unknown): boolean {
  return classifyCaptchaError(error) === "duplicate";
}

/** Provider rate limits/IP blocks, not local stalls or F008 duplicate tokens. */
export function isCaptchaIpBlockError(error: unknown): boolean {
  return classifyCaptchaError(error) === "rate-limit";
}
