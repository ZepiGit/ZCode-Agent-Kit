/**
 * Secret redaction. Every structured value that leaves the bridge (tool results,
 * events, logs, errors) is passed through `redactDeep`.
 *
 * Never construct output strings directly from provider configuration.
 */
// D-10: token-style keys (access/refresh/id tokens, cookies, private keys,
// client secrets, signatures) are covered too, not only "api_key"-like names.
const SECRET_KEY_RE =
  /(api[-_]?key|auth[-_]?token|authorization|password|passwd|secret|credential|(?:access|refresh|id|bearer|session|csrf|xsrf)[-_]?token|^token$|cookie|set-?cookie|private[-_]?key|client[-_]?secret|signature|x-aliyun-captcha-verify-param|proxy[-_]?key)/i;

/** Known bearer/API-key shapes inside free-form strings. */
const SECRET_VALUE_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b[A-Za-z0-9._~+/=-]{200,}\b/g, // very long opaque tokens
];

const MAX_DEEP = 12;

function redactString(s: string): string {
  let out = s;
  for (const re of SECRET_VALUE_RES) out = out.replace(re, (m) => `<redacted:${m.length}ch>`);
  return out;
}

/** Redact secret shapes in a free-form string (error texts, log lines). */
export function redactText(s: string): string {
  return redactString(s);
}

export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > MAX_DEEP) return "[depth-limit]" as unknown as T;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    for (const item of value) arr.push(redactDeep(item, depth + 1));
    return arr as unknown as T;
  }
  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && v !== null && v !== undefined && v !== "") {
        obj[k] = "<redacted>";
      } else {
        obj[k] = redactDeep(v, depth + 1);
      }
    }
    return obj as unknown as T;
  }
  return value;
}

/** Wrap a JSON-serializable value for output as text. */
export function safeJsonStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(redactDeep(value), null, space) ?? "undefined";
  } catch (err) {
    return JSON.stringify({ unserializable: String(err) });
  }
}
