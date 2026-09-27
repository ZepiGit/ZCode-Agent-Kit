/**
 * Gateway business codes as the official ZCode client (3.14.3,
 * failure-provider-business-codes.ts) classifies them. Shared by the
 * transient ladder (handler.ts) and the stream prelude gate
 * (stream-prelude.ts) so both retry exactly the same verdicts.
 */

/** Transient gateway conditions the official client retries, with any HTTP status or inside a stream. */
export const RETRYABLE_GATEWAY_CODES: ReadonlySet<number> = new Set([500, 1120, 1230, 1234, 1302, 1303, 1305, 1312, 2007, 3002]);

/**
 * Verdicts about this request or account: quota/balance (their own retry
 * schedule and rotation), captcha (its own re-solve), model, authorization,
 * authentication and the thinking-config rejection. Never retried, whatever
 * the HTTP status — the official client treats them as terminal too.
 */
export const TERMINAL_GATEWAY_CODES: ReadonlySet<number> = new Set([401, 1005, 1006, 1113, 1210, 3001, 3006, 3007, 3008, 3009, 3010, 3012]);
