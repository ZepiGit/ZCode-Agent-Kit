// Event lines: every NEW log event of the proxy and
// the manager is one line `ISO-time LEVEL component message key=value…`.
// Existing lines keep their exact text.
//
// Runtime-neutral plain ESM: used by the proxy under
// Bun and by the manager under Node. No Node-only or Bun-only APIs, no imports.
// Two byte-identical copies: zcode-proxy-src/src/log/event-line.mjs (the proxy
// builds from zcode-proxy-src alone, e.g. its Dockerfile) and lib/event-line.mjs
// (the manager runs from cli/ + lib/ + proxy/). tests/event-line.test.mjs fails
// when they differ: edit one, copy it over the other.

export const EVENT_LEVELS = Object.freeze(["DEBUG", "INFO", "WARN", "ERROR"]);

const CONTROL_ESCAPES = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
// C0 controls, DEL and the Unicode line/paragraph separators: none may reach a
// log line raw, or one event could read as two.
const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/g;
const NEEDS_QUOTES_RE = /[\s"=\u0000-\u001f\u007f\u2028\u2029]/;

function escapeControls(text) {
  return text.replace(CONTROL_RE, (c) => CONTROL_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Keys and the component are single tokens of [A-Za-z0-9_.-]; anything else becomes `_`. */
function escapeToken(text) {
  return String(text).replace(/[^A-Za-z0-9_.-]/g, "_") || "_";
}

function valueText(value) {
  if (value === null) return "null";
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  }
  return String(value);
}

/** Bare when unambiguous, otherwise double-quoted with `\` and `"` escaped. */
function escapeValue(value) {
  const text = valueText(value);
  if (text !== "" && !NEEDS_QUOTES_RE.test(text)) return text;
  return `"${escapeControls(text.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}"`;
}

// ---------------------------------------------------------------- redaction
// Applies to every line, old and new. Lines without a
// secret come back byte-identical, and the function is idempotent.

export const REDACTED = "<redacted>";
// Exact known secrets shorter than this are ignored: masking every "ab" would
// rewrite secret-free lines.
const MIN_KNOWN_SECRET = 8;

const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SK_RE = /\bsk-[A-Za-z0-9_-]{16,}/g;
// Opaque tokens: the proxy key and the stop token (32 random bytes as
// base64url, 43 chars), OAuth states/poll tokens (64 hex). A run of 32+ token
// characters counts only when it looks random: a lower-case letter plus a digit
// or an upper-case letter, at most 4 hyphens (slugs have more), and not a UUID.
// Upper-case env names, paths, model ids and short hashes never qualify.
const OPAQUE_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksRandom(run) {
  if (UUID_RE.test(run)) return false;
  if ((run.match(/-/g) ?? []).length > 4) return false;
  return /[a-z]/.test(run) && /[0-9A-Z]/.test(run);
}

function envSecrets() {
  const token = globalThis.process?.env?.ZCODE_KIT_STOP_TOKEN;
  return token ? [token] : [];
}

/**
 * Mask secrets in one log line of any format. `secrets` are exact values the
 * caller knows (the proxy key, a stop token); the stop token in
 * `ZCODE_KIT_STOP_TOKEN` is always included.
 * @param {string} text
 * @param {Iterable<string | null | undefined>} [secrets]
 */
export function redactLine(text, secrets = []) {
  let out = String(text);
  for (const secret of [...secrets, ...envSecrets()]) {
    if (typeof secret === "string" && secret.length >= MIN_KNOWN_SECRET) out = out.split(secret).join(REDACTED);
  }
  return out
    .replace(BEARER_RE, (_, scheme) => `${scheme} ${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(SK_RE, REDACTED)
    .replace(OPAQUE_RE, (run) => (looksRandom(run) ? REDACTED : run));
}

/** Field names that always hold a secret, matched per camelCase/snake segment. */
const SECRET_SEGMENTS = new Set(["token", "secret", "password", "passwd", "authorization", "cookie", "credential", "credentials", "signature", "apikey", "bearer"]);
const SECRET_PAIRS = new Set(["api key", "proxy key", "private key", "access key", "session key"]);

function isSecretKey(key) {
  const segments = String(key).split(/[-_.\s]+|(?<=[a-z0-9])(?=[A-Z])/).map((s) => s.toLowerCase()).filter(Boolean);
  return segments.some((s, i) => SECRET_SEGMENTS.has(s) || SECRET_PAIRS.has(`${s} ${segments[i + 1]}`));
}

// ------------------------------------------------------------------- format

/**
 * Format one event line (no trailing newline). Secret-named fields are masked,
 * and the whole line goes through `redactLine`.
 * @param {{ time?: Date, level: string, component: string, message: string, fields?: Record<string, unknown>, secrets?: Iterable<string> }} event
 */
export function formatEventLine({ time = new Date(), level, component, message, fields = {}, secrets = [] }) {
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

// ------------------------------------------------------------------- logger

/**
 * The one logger for new event lines. `write` receives each finished line
 * without a newline (default: console.log, which reaches the proxy log in the
 * proxy). Logging never throws into the caller. Each method returns the line.
 * @param {{ component: string, write?: (line: string) => void, now?: () => Date, secrets?: () => Iterable<string | null | undefined> }} options
 */
export function createEventLogger({ component, write = (line) => console.log(line), now = () => new Date(), secrets = () => [] }) {
  const emit = (level) => (message, fields = {}) => {
    let known = [];
    try { known = [...secrets()]; } catch {}
    const line = formatEventLine({ time: now(), level, component, message, fields, secrets: known });
    try { write(line); } catch {}
    return line;
  };
  return { debug: emit("DEBUG"), info: emit("INFO"), warn: emit("WARN"), error: emit("ERROR") };
}
