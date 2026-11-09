/**
 * Event lines (ADR-0010 rule 4, spec §9, ticket 14): every NEW log event is
 * one line `ISO-time LEVEL component message key=value…`. Existing bridge log
 * lines keep their JSON format.
 *
 * A TypeScript port of the kit's lib/event-line.mjs (the bridge builds from
 * this package alone, so it cannot import the kit's copy). The format and the
 * redaction rules are the same: test/unit/event-line.test.mjs compares this
 * module's output with lib/event-line.mjs line for line.
 */

export type EventLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export const EVENT_LEVELS: readonly EventLevel[] = Object.freeze(["DEBUG", "INFO", "WARN", "ERROR"]);

const CONTROL_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
// C0 controls, DEL and the Unicode line/paragraph separators: none may reach a
// log line raw, or one event could read as two.
const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/g;
const NEEDS_QUOTES_RE = /[\s"=\u0000-\u001f\u007f\u2028\u2029]/;

function escapeControls(text: string): string {
  return text.replace(CONTROL_RE, (c) => CONTROL_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Keys and the component are single tokens of [A-Za-z0-9_.-]; anything else becomes `_`. */
function escapeToken(text: unknown): string {
  return String(text).replace(/[^A-Za-z0-9_.-]/g, "_") || "_";
}

function valueText(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Bare when unambiguous, otherwise double-quoted with `\` and `"` escaped. */
function escapeValue(value: unknown): string {
  const text = valueText(value);
  if (text !== "" && !NEEDS_QUOTES_RE.test(text)) return text;
  return `"${escapeControls(text.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}"`;
}

// ---------------------------------------------------------------- redaction

export const REDACTED = "<redacted>";
// Exact known secrets shorter than this are ignored: masking every "ab" would
// rewrite secret-free lines.
const MIN_KNOWN_SECRET = 8;

const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SK_RE = /\bsk-[A-Za-z0-9_-]{16,}/g;
// Opaque tokens: a run of 32+ token characters counts only when it looks
// random (a lower-case letter plus a digit or an upper-case letter, at most 4
// hyphens, not a UUID).
const OPAQUE_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksRandom(run: string): boolean {
  if (UUID_RE.test(run)) return false;
  if ((run.match(/-/g) ?? []).length > 4) return false;
  return /[a-z]/.test(run) && /[0-9A-Z]/.test(run);
}

function envSecrets(): string[] {
  const token = process.env.ZCODE_KIT_STOP_TOKEN;
  return token ? [token] : [];
}

/** Mask secrets in one log line of any format; secret-free lines come back byte-identical. */
export function redactLine(text: string, secrets: Iterable<string | null | undefined> = []): string {
  let out = String(text);
  for (const secret of [...secrets, ...envSecrets()]) {
    if (typeof secret === "string" && secret.length >= MIN_KNOWN_SECRET) out = out.split(secret).join(REDACTED);
  }
  return out
    .replace(BEARER_RE, (_m: string, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(SK_RE, REDACTED)
    .replace(OPAQUE_RE, (run: string) => (looksRandom(run) ? REDACTED : run));
}

/** Field names that always hold a secret, matched per camelCase/snake segment. */
const SECRET_SEGMENTS = new Set(["token", "secret", "password", "passwd", "authorization", "cookie", "credential", "credentials", "signature", "apikey", "bearer"]);
const SECRET_PAIRS = new Set(["api key", "proxy key", "private key", "access key", "session key"]);

function isSecretKey(key: string): boolean {
  const segments = String(key).split(/[-_.\s]+|(?<=[a-z0-9])(?=[A-Z])/).map((s) => s.toLowerCase()).filter(Boolean);
  return segments.some((s, i) => SECRET_SEGMENTS.has(s) || SECRET_PAIRS.has(`${s} ${segments[i + 1]}`));
}

// ------------------------------------------------------------------- format

export interface EventLineInput {
  time?: Date;
  level: EventLevel;
  component: string;
  message: string;
  fields?: Record<string, unknown>;
  secrets?: Iterable<string | null | undefined>;
}

/** `ISO-time LEVEL component message key=value…`, redacted, no trailing newline. */
export function formatEventLine({ time = new Date(), level, component, message, fields = {}, secrets = [] }: EventLineInput): string {
  if (!EVENT_LEVELS.includes(level)) throw new TypeError(`event line: unknown level ${JSON.stringify(level)} (use ${EVENT_LEVELS.join("|")})`);
  const known = [...secrets];
  const parts = [time.toISOString(), level, escapeToken(component), escapeControls(redactLine(String(message), known))];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const shown = isSecretKey(key) ? REDACTED : redactLine(valueText(value), known);
    parts.push(`${escapeToken(key)}=${escapeValue(shown)}`);
  }
  return redactLine(parts.join(" "), known);
}
