/**
 * Anthropic-format route handler: POST /v1/messages.
 * @see .omo/plans/zcode-proxy.md Task 8
 */
import { proxyRequest, type ProxyHandlerOptions } from "../proxy/handler.js";

/** Handle POST /v1/messages — forward to upstream Anthropic endpoint. */
export async function handleMessages(
  req: Request,
  opts: ProxyHandlerOptions,
): Promise<Response> {
  return proxyRequest(req, "anthropic", opts);
}
