/**
 * Request body transformer — applies ZCode-equivalent body mutations before
 * forwarding upstream. All transformations are no-ops on parse failure (the
 * original body is returned unchanged) so a malformed body never breaks the
 * proxy: it just loses the optimization.
 *
 * Transformations applied:
 *   0. Anthropic glm-5.3-flash + disabled thinking → enabled low (or an
 *      explicit supported effort), adding the budget once for answer room.
 *   1. OpenAI + `stream: true` → inject `stream_options.include_usage: true`
 *      (matches the upstream client's default).
 *   2. start-plan → prepend ZCode gateway system blocks. OpenAI upstream gets
 *      system messages; Anthropic-shaped input gets the Anthropic `system` field.
 *   3. Anthropic format → clear existing `cache_control` markers on all
 *      non-system messages, then add `{ type: "ephemeral" }` to the last
 *      content block of the last non-system message (mirrors the bundle's
 *      `zsi`+`Fsi` pair). Anthropic's API silently ignores `cache_control`
 *      below the per-model token floor, so unconditional marking is safe and
 *      matches ZCode's `applyCacheControl: true` default.
 *   4. Anthropic format + `ctx.metadataUserId` set → inject
 *      `metadata: { user_id }` (bundle `E2e`/`UIo` device/session blob —
 *      value assembled by the caller via buildAnthropicMetadataUserId).
 *
 */
import type { Format } from "../translator/types.js";
import { normalizeGlm53FlashThinking, applyAnthropicThinkingCompat } from "../provider/reasoning.js";
import { buildStartPlanSystem, buildContextPrefixMessage } from "./system-prompt.js";
import { resolveEnvPromptInfo } from "./identity.js";

interface TransformContext {
  format: Format;
  /**
   * When set, the Anthropic-format body gets `metadata.user_id` injected.
   * Callers pass the bundle's device/session blob (see
   * buildAnthropicMetadataUserId in trace-headers.ts) — real traffic never
   * carries the account uuid here (account_uuid is hardcoded "" upstream).
   */
  metadataUserId?: string;
  /** When true (start-plan), prepend ZCode gateway system blocks. */
  startPlan?: boolean;
}

/**
 * Apply body transformations. Returns the original `body` string when nothing
 * changed OR when parsing failed; otherwise returns the re-serialized body.
 */
export function transformRequestBody(body: string | undefined, ctx: TransformContext): string | undefined {
  if (body === undefined || body.length === 0) return body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed !== "object" || parsed === null) return body;

  return applyRequestBodyTransforms(parsed, ctx) ? JSON.stringify(parsed) : body;
}

/**
 * `transformRequestBody(JSON.stringify(value), ctx)` for a request this
 * process built (a translated body), without serialising it and parsing the
 * text back (two fewer copies of every translated body). The
 * transforms run on `jsonCopy(value)`, which is what parsing that text would
 * give, and the result is serialised once. When nothing changed, that
 * serialisation is the text `JSON.stringify(value)` itself, so the bytes are
 * the same either way.
 */
export function transformBuiltRequestBody(value: object, ctx: TransformContext): string {
  const copy = jsonCopy(value) as object;
  applyRequestBodyTransforms(copy, ctx);
  return JSON.stringify(copy);
}

const SKIP = Symbol("json-skip");

/**
 * `JSON.parse(JSON.stringify(value))` without the text: a copy with the same
 * keys, order and values, built the way JSON.stringify serialises (toJSON,
 * wrapper objects unwrapped, non-finite numbers and dropped array elements as
 * null, -0 as 0, undefined/function/symbol properties left out, an own
 * `__proto__` key kept as a data property) and the way JSON.parse builds
 * (plain objects and arrays). Strings are immutable and shared, so a long
 * string is never copied. Throws the TypeErrors JSON.stringify throws (cycle,
 * BigInt). Returns undefined where JSON.stringify returns undefined.
 */
export function jsonCopy(value: unknown): unknown {
  const copied = copyJsonProperty("", value, []);
  return copied === SKIP ? undefined : copied;
}

function copyJsonProperty(key: string, input: unknown, stack: object[]): unknown {
  let value = input;
  if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") value = toJSON.call(value, key);
  }
  if (value instanceof Number) value = Number(value);
  else if (value instanceof String) value = String(value);
  else if (value instanceof Boolean) value = value.valueOf();
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
  if (typeof value === "bigint") throw new TypeError("JSON.stringify cannot serialize BigInt.");
  if (typeof value !== "object") return SKIP;
  if (stack.includes(value)) throw new TypeError("JSON.stringify cannot serialize cyclic structures.");
  stack.push(value);
  let out: unknown;
  if (Array.isArray(value)) {
    const array: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const element = copyJsonProperty(String(i), value[i], stack);
      array.push(element === SKIP ? null : element);
    }
    out = array;
  } else {
    const object: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const k of Object.keys(source)) {
      const property = copyJsonProperty(k, source[k], stack);
      if (property === SKIP) continue;
      if (k === "__proto__") Object.defineProperty(object, k, { value: property, writable: true, enumerable: true, configurable: true });
      else object[k] = property;
    }
    out = object;
  }
  stack.pop();
  return out;
}

/**
 * The transformations of `transformRequestBody`, applied in place to a body
 * the caller has already parsed (one JSON parse per request body instead of
 * one per reader). Returns true when the object changed; the caller
 * then sends `JSON.stringify(parsed)`, otherwise the body text it parsed, so
 * the bytes upstream are exactly those of `transformRequestBody(text, ctx)`.
 */
export function applyRequestBodyTransforms(parsed: object, ctx: TransformContext): boolean {
  let modified = false;

  if (ctx.format === "openai") {
    if (ctx.startPlan) {
      modified = applyStartPlanOpenAISystem(parsed as Record<string, unknown>) || modified;
    }
    modified = applyStreamOptionsIncludeUsage(parsed as Record<string, unknown>) || modified;
  }
  if (ctx.format === "anthropic") {
    const obj = parsed as Record<string, unknown>;
    if (normalizeGlm53FlashThinking(obj)) {
      applyAnthropicThinkingCompat(obj);
      modified = true;
    }
    if (ctx.startPlan) {
      modified = applyStartPlanSystem(obj) || modified;
    }
    modified = applyAnthropicCacheControl(obj) || modified;
    if (ctx.metadataUserId) {
      modified = applyAnthropicUserId(obj, ctx.metadataUserId) || modified;
    }
  }

  return modified;
}

/** OpenAI streaming: ensure `stream_options.include_usage: true`. */
function applyStreamOptionsIncludeUsage(body: Record<string, unknown>): boolean {
  if (body.stream !== true) return false;
  const existing = body.stream_options;
  if (isPlainObject(existing) && existing.include_usage === true) {
    return false;
  }
  const merged: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  merged.include_usage = true;
  body.stream_options = merged;
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Anthropic: two-phase cache_control injection, mirroring the bundle's
 * `zsi` (clear) + `Fsi` (mark) pair:
 *   (1) strip `cache_control` from every content block of every NON-system
 *       message (string content carries no marker to clear);
 *   (2) mark the last content block of the LAST non-system message (existing
 *       location algorithm) with `{type: "ephemeral"}`; string content is
 *       converted to a block array first (kept from the previous behavior).
 *
 * Without the clear phase, client-supplied `cache_control` on earlier messages
 * would pass through alongside our marker → multiple cache breakpoints and
 * more cache writes than the real client produces. The top-level `system`
 * field is untouched. The bundle's skipCacheWrite variant (marks the
 * second-to-last message instead) is NOT implemented — this proxy always
 * writes cache.
 *
 * Output-stable: applying this to an already-canonical body yields the same
 * bytes (no duplicate markers, target block unchanged). Note the function
 * still reports `modified` in that case — the clear phase strips the target
 * block's own marker before phase 2 re-adds the identical one — so callers
 * re-serialize once more; harmless (byte-identical output), just not free.
 */
function applyAnthropicCacheControl(body: Record<string, unknown>): boolean {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;

  // Phase 1 (bundle `zsi`): clear stale markers on non-system messages.
  let cleaned = false;
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    if (msg.role === "system") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (typeof block === "object" && block !== null && "cache_control" in block) {
        delete block.cache_control;
        cleaned = true;
      }
    }
  }

  // Phase 2 (bundle `Fsi`): mark the last non-system message's last block.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (typeof msg !== "object" || msg === null) continue;
    if (msg.role === "system") continue;

    if (typeof msg.content === "string") {
      msg.content = [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }];
      return true;
    }
    if (Array.isArray(msg.content) && msg.content.length > 0) {
      const lastBlock = msg.content[msg.content.length - 1];
      if (typeof lastBlock === "object" && lastBlock !== null && !lastBlock.cache_control) {
        lastBlock.cache_control = { type: "ephemeral" };
        return true;
      }
      // Already marked — only report modified if the clear phase stripped
      // stray markers elsewhere (idempotency: avoid needless re-serialize).
      return cleaned;
    }
    return cleaned;
  }
  return cleaned;
}

/**
 * Anthropic: inject `metadata: { user_id }` when not already set.
 * Preserves any existing `metadata.*` fields other than `user_id`.
 */
function applyAnthropicUserId(body: Record<string, unknown>, userId: string): boolean {
  const existing = body.metadata;
  if (isPlainObject(existing) && existing.user_id === userId) {
    return false;
  }
  body.metadata = {
    ...(isPlainObject(existing) ? existing : {}),
    user_id: userId,
  };
  return true;
}

/**
 * start-plan: prepend ZCode gateway system blocks (ContextBuilder mirror —
 * see system-prompt.ts). The gateway rejects requests without these identity
 * blocks with 3012 "method not allowed". Forwards `body.model` so
 * `buildStartPlanSystem` can emit the dynamic "You are powered by the model
 * named ${model}." line inside the Environment section, and attaches the
 * meta_user context_prefix (currentDate `<system-reminder>` user turn) that
 * every real client request carries. Client `cache_control` on tools is
 * stripped: official blocks (3) + last-message marker (1) already fill
 * Anthropic's 4-breakpoint cache budget.
 */
function applyStartPlanSystem(body: Record<string, unknown>): boolean {
  const model = typeof body.model === "string" ? body.model : undefined;
  body.system = buildStartPlanSystem(body.system, model, resolveEnvPromptInfo());
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    body.messages = [buildContextPrefixMessage() as unknown, ...body.messages];
  }
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (typeof tool === "object" && tool !== null && "cache_control" in tool) {
        delete (tool as Record<string, unknown>).cache_control;
      }
    }
  }
  return true;
}

function applyStartPlanOpenAISystem(body: Record<string, unknown>): boolean {
  const messages = body.messages;
  if (!Array.isArray(messages)) return false;

  const model = typeof body.model === "string" ? body.model : undefined;
  const official = buildStartPlanSystem(undefined, model, resolveEnvPromptInfo()).map((block) => ({
    role: "system",
    content: typeof block === "object" && block !== null && "text" in block ? String(block.text) : "",
  }));
  body.messages = [...official, ...messages];
  return true;
}
