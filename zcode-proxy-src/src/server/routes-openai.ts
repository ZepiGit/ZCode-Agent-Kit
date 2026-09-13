/**
 * OpenAI-format route handlers: /v1/chat/completions + /v1/models.
 * @see .omo/plans/zcode-proxy.md Task 7
 */
import { proxyRequest, type ProxyHandlerOptions } from "../proxy/handler.js";
import { MODELS } from "../provider/models.js";
import type { ProxyConfig } from "../config/types.js";
import type { OpenAIModelList } from "../translator/types.js";

/** Handle POST /v1/chat/completions — forward OpenAI-compatible chat requests upstream. */
export async function handleChatCompletions(
  req: Request,
  opts: ProxyHandlerOptions,
): Promise<Response> {
  return proxyRequest(req, "openai", opts);
}

/**
 * Models the endpoint may advertise: the registry intersected with the
 * configured whitelist (config.models). The whitelist may contain ids the
 * registry does not know — those are forwarded at request time but are NOT
 * advertised (no invented specs for unknown ids).
 */
export function advertisedModels(config?: Pick<ProxyConfig, "models">) {
  const allowed = config?.models;
  if (!allowed || allowed.length === 0) return MODELS;
  const allow = new Set(allowed);
  return MODELS.filter((m) => allow.has(m.id));
}

/** Handle GET /v1/models — return the model list in OpenAI format. */
export function handleListModels(req: Request, config?: Pick<ProxyConfig, "models">): Response {
  // CLIProxyAPI-style rich catalog: DSH's better-basicfun synchronizer probes
  // with ?client_version=pi and parses a top-level `models[]` array with
  // slug/context_window/max_tokens/supported_reasoning_levels fields. A plain
  // OpenAI request keeps the original `data[]` shape.
  const clientVersion = new URL(req.url).searchParams.get("client_version");
  const models = advertisedModels(config);
  if (clientVersion === "pi") {
    const body = {
      object: "list",
      models: models.map((m) => ({
        slug: m.id,
        display_name: m.name,
        description: m.name,
        context_window: m.contextWindow,
        max_context_window: m.contextWindow,
        ...(m.maxOutputTokens === undefined ? {} : { max_tokens: m.maxOutputTokens }),
        // Registry-derived, not name heuristics: only models with a verified
        // inputModalities entry advertise image (the old id.includes("v")
        // check silently hid glm-5.3-flash's live-verified image support).
        input_modalities: m.inputModalities ?? ["text"],
        // Only verified effort levels are advertised; unverified reasoning
        // models expose [] rather than invented medium/xhigh entries.
        supported_reasoning_levels: (m.efforts ?? []).map((effort) => ({ effort })),
        visibility: "list",
      })),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const list: OpenAIModelList = {
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model" as const,
      owned_by: "zcode-proxy",
    })),
  };
  return new Response(JSON.stringify(list), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
