// The graceful stop's shared deadlines (ADR-0014 cond 4, ticket 22). Runtime-
// neutral plain ESM (ADR-0011 condition 1): used by the manager under Node and
// by the proxy under Bun. No Bun-only or Node-only APIs.
//
// Two byte-identical copies: lib/stop-deadlines.mjs (the manager runs from
// cli/ + lib/ + proxy/) and zcode-proxy-src/src/runtime/stop-deadlines.mjs
// (the proxy builds from zcode-proxy-src alone, e.g. its Dockerfile). The
// lifecycle test fails when they differ: edit one, copy it over the other.
//
// The strict order (ADR-0014 cond 4): the proxy's own hard deadline is
// STOP_GRACE_MS — its drain, the 3 s account-metadata flush and the close all
// end inside it. The manager forces only after STOP_GRACE_MS +
// STOP_EXIT_MARGIN_MS, so the two timers never race and a stop cannot kill the
// proxy in the middle of its flush. The respawn wait (30 s, ADR-0015) stays
// longer than the acknowledgement wait (10 s) + STOP_GRACE_MS + the margin.

/** The proxy's own graceful-stop hard deadline: drain + flush + exit, in ms. */
export const STOP_GRACE_MS = 10_000;

/**
 * The named margin between the proxy's deadline and the manager's force
 * point, in ms: a few 300 ms exit-poll intervals, so a proxy that exits right
 * at its deadline is never killed mid-exit.
 */
export const STOP_EXIT_MARGIN_MS = 2_000;

/** The stop request's path on the proxy's loopback listener. */
export const STOP_REQUEST_PATH = "/__kit/stop";

/**
 * The stop token's request header (ADR-0014 cond 1): the per-spawn capability
 * next to the proxy key, compared by the proxy in constant time.
 */
export const STOP_TOKEN_HEADER = "x-zcode-stop-token";
