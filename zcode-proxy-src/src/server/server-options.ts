/**
 * `startServer` option assembly shared by every entry that boots the proxy
 * in-process (serve / android / tui).
 */
import type { ProxyConfig } from "../config/types.js";
import type { AuthManager } from "../auth/manager.js";
import { ResponseStore } from "../responses/store.js";
import type { ServerOptions } from "./server.js";

/**
 * The stop-request wiring (ticket 22, ADR-0014): only the manager-spawned
 * `serve` entry passes it. The TUI and Android host the proxy in-process
 * without a manager, so they pass none and the stop route answers 404.
 */
export interface StopWiring {
  /** This spawn's stop token (`ZCODE_KIT_STOP_TOKEN`); absent without a manager. */
  stopToken?: string;
  /** Runs the graceful shutdown sequence when the stop request is accepted. */
  onStopRequest?: () => void;
}

/** Build `startServer` options, wiring the Responses store when its config gate is on. */
export function buildServerOptions(
  config: ProxyConfig,
  auth: AuthManager,
  debug: boolean,
  stop: StopWiring = {},
): Omit<ServerOptions, "admission" | "drain" | "fetchImpl"> {
  const opts: Omit<ServerOptions, "admission" | "drain" | "fetchImpl"> = { config, auth, debug, ...stop };
  if (config.responses.enabled) {
    opts.responseStore = new ResponseStore({ maxEntries: config.responses.storeMaxEntries, ttlMs: config.responses.storeTtlMs });
  }
  return opts;
}
