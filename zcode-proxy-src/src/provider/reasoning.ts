/**
 * GLM-5.3 family reasoning-effort contract.
 *
 * The Anthropic upstream ignores the OpenAI `reasoning_effort` field entirely
 * for this model family — `output_config.effort` is the only channel that
 * actually changes how much the model thinks, and it must be paired with a
 * matching `thinking.budget_tokens` (the effort label alone still produces
 * near-zero thinking). Values below come from ZCode's own model catalog
 * entry for `glm-5.3` (`defaultLevel: "max"`, three effort levels each
 * setting both fields) plus live upstream verification.
 */

import { MODELS } from "./models.js";

/** Fields inspected at the JSON boundary; malformed values are never coerced. */
interface ThinkingRequest {
  model?: unknown;
  thinking?: unknown;
  output_config?: unknown;
  max_tokens?: unknown;
  temperature?: unknown;
  top_k?: unknown;
  top_p?: unknown;
}

/**
 * Flash always thinks: upstream rejects disabled with validation code 1210.
 * Only rewrite an explicit disabled request for this verified model. The
 * disabled → enabled transition lets the native path apply additive compat
 * once, while leaving already-translated requests' total budgets untouched.
 * A supported explicit effort wins; otherwise off means the lowest effort.
 */
export function normalizeGlm53FlashThinking(body: ThinkingRequest, requestedEffort?: string): boolean {
  if (typeof body.model !== "string" || body.model.toLowerCase() !== "glm-5.3-flash") return false;
  const thinking = body.thinking;
  if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)
    || !("type" in thinking) || thinking.type !== "disabled") return false;
  const output = body.output_config;
  const config = output && typeof output === "object" && !Array.isArray(output) ? output : undefined;
  const explicitEffort = config && "effort" in config ? config.effort : undefined;
  const effort = explicitEffort === "low" || explicitEffort === "high" || explicitEffort === "max"
    ? explicitEffort : requestedEffort === "low" || requestedEffort === "high" || requestedEffort === "max" ? requestedEffort : "low";
  const reasoning = buildGlm53Reasoning(effort);
  body.thinking = reasoning.thinking;
  body.output_config = { ...config, ...reasoning.output_config };
  return true;
}

/**
 * Mirror the SDK's Anthropic builder: thinking removes sampling parameters
 * and adds its budget on top of the answer allowance, capped at the model
 * ceiling. Enabled thinking without a budget uses 1024; adaptive does not.
 * Call once for translated requests, or only after native disabled thinking
 * was normalized. Native enabled requests already carry a total allowance.
 */
export function applyAnthropicThinkingCompat(result: ThinkingRequest): void {
  const thinking = result.thinking;
  if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)
    || !("type" in thinking) || (thinking.type !== "enabled" && thinking.type !== "adaptive")) {
    if (result.temperature !== undefined && result.top_p !== undefined) delete result.top_p;
    return;
  }
  let budget = "budget_tokens" in thinking ? thinking.budget_tokens : undefined;
  if (thinking.type === "enabled" && (typeof budget !== "number" || !Number.isFinite(budget))) {
    budget = GLM53_MIN_THINKING_BUDGET;
    Object.assign(thinking, { budget_tokens: GLM53_MIN_THINKING_BUDGET });
  }
  delete result.temperature;
  delete result.top_k;
  delete result.top_p;
  if (typeof result.max_tokens !== "number" || !Number.isFinite(result.max_tokens) || result.max_tokens <= 0) return;
  const effective = typeof budget === "number" && Number.isFinite(budget) ? budget : 0;
  result.max_tokens += effective;
  const modelMax = MODELS.find((m) => m.id === result.model)?.maxOutputTokens;
  if (modelMax !== undefined && result.max_tokens > modelMax) result.max_tokens = modelMax;
}

/** The three legal `output_config.effort` levels for GLM-5.3 models (module-local; the type below is the public contract). */
const GLM53_EFFORT_LEVELS = ["low", "high", "max"] as const;

/** One of the three legal GLM-5.3 effort levels. */
export type Glm53Effort = (typeof GLM53_EFFORT_LEVELS)[number];

/** ZCode catalog's `defaultLevel` for glm-5.3 — used when no effort is requested. */
export const GLM53_DEFAULT_EFFORT: Glm53Effort = "max";

/**
 * Thinking token budgets ZCode's catalog pairs with each effort level.
 * Sending `output_config.effort` without a matching `thinking.budget_tokens`
 * leaves the upstream at its own near-zero default.
 */
export const GLM53_THINKING_BUDGETS: Readonly<Record<Glm53Effort, number>> = {
  low: 8_000,
  high: 16_000,
  max: 32_000,
};

/**
 * Floor below which a thinking budget stops being useful — measured live
 * against the upstream (a budget this small collapses back to near-zero
 * thinking output). Doubles as the SDK's default budget: the bundle's
 * anthropic request builder forces `budget_tokens: 1024` whenever thinking
 * is enabled without one ("thinking budget is required when thinking is
 * enabled. using default budget of 1024 tokens.").
 */
export const GLM53_MIN_THINKING_BUDGET = 1_024;

/**
 * Match the GLM-5.3 model family, including `glm-5.3-flash`, case-insensitively
 * (the upstream also accepts `GLM-5.3`). Deliberately excludes `glm-5`,
 * `glm-5.1`, and `glm-5.2` — the negative lookahead rejects a trailing digit
 * so `glm-5.30` (were it ever added) would not falsely match either.
 */
const GLM53_MODEL_PATTERN = /glm-5\.3(?![0-9])/i;

/** True when `model` belongs to the GLM-5.3 family (`glm-5.3`, `glm-5.3-flash`, ...). */
export function isGlm53Model(model: string | undefined): boolean {
  if (!model) return false;
  return GLM53_MODEL_PATTERN.test(model);
}

/**
 * Map an OpenAI `reasoning_effort` value onto the three GLM-5.3 effort
 * levels, per Z.AI's official mapping table. Unrecognized or absent values
 * fall back to the catalog default (`max`) rather than the OpenAI-side
 * default (`medium`), since ZCode's own `defaultLevel` for this family is
 * `max`. The mapping rounds UP, not to nearest — `medium` maps to `high`,
 * not `low`.
 */
export function normalizeGlm53Effort(effort: string | undefined): Glm53Effort {
  switch (effort) {
    case "none":
    case "minimal":
    case "light":
    case "low":
      return "low";
    case "medium":
    case "high":
      return "high";
    case "xhigh":
    case "max":
    case "ultra":
      return "max";
    default:
      return GLM53_DEFAULT_EFFORT;
  }
}

/** Build the paired `thinking` + `output_config` fields for a GLM-5.3 effort level. */
export function buildGlm53Reasoning(effort: Glm53Effort): {
  thinking: { type: "enabled"; budget_tokens: number };
  output_config: { effort: Glm53Effort };
} {
  return {
    thinking: { type: "enabled", budget_tokens: GLM53_THINKING_BUDGETS[effort] },
    output_config: { effort },
  };
}

/**
 * Clamp a thinking budget against the MODEL's maxOutputTokens ceiling —
 * mirrors ZCode's catalog-patch clamp (`Math.min(budgetTokens,
 * maxOutputTokens - 1)`, applied against the large fixed model ceiling, not
 * the per-request `max_tokens`). The request-level budget-vs-answer split is
 * NOT clamped here: the bundle's anthropic builder instead ADDS the budget on
 * top of `max_tokens` (see applyAnthropicThinkingCompat above), which is how
 * real traffic keeps answer room.
 * Passes `budget` through unchanged when `modelMaxTokens` isn't a finite
 * number (unknown model ids — nothing to clamp against).
 */
export function clampGlm53BudgetToModel(budget: number, modelMaxTokens: unknown): number {
  if (typeof modelMaxTokens !== "number" || !Number.isFinite(modelMaxTokens)) return budget;
  return Math.min(budget, Math.floor(modelMaxTokens) - 1);
}
