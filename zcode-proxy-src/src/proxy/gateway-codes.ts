/**
 * Gateway business codes as the official ZCode client (3.14.3,
 * `failure-provider-business-codes.ts`) classifies them. Shared by the
 * transient ladder (handler.ts) and the stream prelude gate
 * (stream-prelude.ts) so both retry exactly the same verdicts.
 *
 * The gateway has returned both JSON numbers and provider/AI-SDK strings over
 * time. Keep the canonical numeric form for digit-only strings, and lower-case
 * symbolic codes so callers cannot accidentally make the two representations
 * take different retry paths.
 */

export type GatewayCode = number | string;

/** Normalize a gateway/provider code without accepting arbitrary objects or text. */
export function normalizeGatewayCode(value: unknown): GatewayCode | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const code = value.trim();
  if (!code) return undefined;
  if (/^\d+$/.test(code)) {
    const numeric = Number(code);
    return Number.isSafeInteger(numeric) ? numeric : undefined;
  }
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(code) ? code.toLowerCase() : undefined;
}

/** Transient gateway conditions the official client retries, with any HTTP status or inside a stream. */
export const RETRYABLE_GATEWAY_CODES: ReadonlySet<GatewayCode> = new Set<GatewayCode>([
  500, 1120, 1230, 1234, 1302, 1303, 1305, 1312, 2007, 3002,
  "rate_limit_reached_error", "rate_limit_error", "engine_overloaded_error", "overloaded_error",
]);

/**
 * Verdicts about this request or account: quota/balance (their own retry
 * schedule and rotation), captcha (its own re-solve), model, authorization,
 * authentication and the thinking-config rejection. Never retried, whatever
 * the HTTP status — the official client treats them as terminal too.
 */
export const TERMINAL_GATEWAY_CODES: ReadonlySet<GatewayCode> = new Set<GatewayCode>([
  // Existing gateway-specific values (including 401/1210/3012) remain here
  // for compatibility with responses that do not use the provider mapping.
  401, 1005, 1006, 1113, 1210, 3001, 3006, 3007, 3008, 3009, 3010, 3012,
  // Official ZCode provider business-code mapping.
  1008, 1261, 1304, 1308, 1309, 1310, 1311, 1313,
  1314, 1315, 1316, 1317, 1318, 1319, 1320, 1321,
  2056, 20097,
  "insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "exceeded_current_quota_error",
]);
