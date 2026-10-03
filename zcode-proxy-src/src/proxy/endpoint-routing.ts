/**
 * Provider endpoint routing — mirrors the ZCode 3.7+ `ProviderEndpointRoutingService`.
 *
 * The desktop client periodically fetches `GET {zcodeApiBase}/api/v1/client/configs`
 * with its app version and platform as query parameters
 * and rewrites provider request URLs according to the returned
 * `data.proxyEndpoint.mapping` table (`from` → `to`, exact normalized-URL match).
 * As of 2026-08-19 the server maps the coding-plan Anthropic endpoints to
 * `zcode.z.ai/api/v1/ultra[-zai]/...`; the table is server-controlled and may
 * grow at any time, so resolution is generic.
 *
 * Failure semantics are strictly fail-open: any fetch/parse error keeps the
 * previous snapshot (or none) and requests go to their original URL after a
 * cooldown.
 */
import { buildIdentityHeaders, identityCacheKey } from "./identity.js";
import type { ProxyIdentity } from "../config/types.js";

const DEFAULT_ORIGIN = "https://zcode.z.ai";
const CONFIG_PATH = "/api/v1/client/configs";
const SUCCESS_TTL_MS = 300_000;
const FAILURE_COOLDOWN_MS = 30_000;
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_MAPPING_ENTRIES = 256;

function normalizeConfigUrl(origin?: string): string {
  const raw = (origin?.trim() || DEFAULT_ORIGIN).replace(/\/+$/u, "");
  const parsed = new URL(raw);
  const host = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const localHttp = parsed.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "::1");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new Error("endpoint routing origin must use https (http is allowed only for loopback tests)");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new Error("endpoint routing origin must be a bare origin without credentials, path, query, or fragment");
  }
  return `${parsed.origin}${CONFIG_PATH}`;
}

function defaultPlatform(): string {
  // Keep the query in lock-step with the identity headers. The Android entry
  // point can describe a desktop target through the same env overrides.
  const platform = process.env.ZCODE_IDENTITY_PLATFORM?.trim() || process.platform;
  const arch = process.env.ZCODE_IDENTITY_ARCH?.trim() || process.arch;
  return `${platform}-${arch}`;
}

export interface EndpointRoutingOptions {
  /** Origin of the client-configs endpoint. */
  origin?: string;
  identity: ProxyIdentity;
  /** @deprecated Kept for callers compiled against older kits; client-configs is unauthenticated. */
  credential?: () => string | undefined;
  /** Runtime platform sent to the client-configs endpoint (defaults to `${process.platform}-${process.arch}`). */
  platform?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  successTtlMs?: number;
  failureCooldownMs?: number;
  requestTimeoutMs?: number;
  onSnapshot?: (entries: number) => void;
}

export interface RoutedUrl {
  routed: boolean;
  url: string;
}

interface RoutingSnapshot {
  expiresAt: number;
  mapping: Map<string, string>;
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/u, "") || "/";
}

function routingKey(url: URL): string {
  const port = url.port || "443";
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}${normalizePath(url.pathname)}`;
}

/**
 * Current ZCode clients use these exact gateway routes without waiting for a
 * control-plane mapping response. Keep the routes as a safe baseline while
 * still accepting additional server-provided mappings below.
 */
const STATIC_GATEWAY_PATHS = new Map([
  [routingKey(new URL("https://api.z.ai/api/anthropic/v1/messages")), "/api/v1/ultra-zai/anthropic/v1/messages"],
  [routingKey(new URL("https://open.bigmodel.cn/api/anthropic/v1/messages")), "/api/v1/ultra/anthropic/v1/messages"],
]);

function parseMappingUrl(value: unknown, field: "from" | "to"): URL {
  if (typeof value !== "string") throw new Error(`mapping.${field} must be a string`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`mapping.${field} URL is not a plain https URL`);
  }
  return parsed;
}

export class EndpointRoutingService {
  private readonly configUrl: string;
  private readonly identity: ProxyIdentity;
  private readonly platform: string;
  private readonly gatewayOrigin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly successTtlMs: number;
  private readonly failureCooldownMs: number;
  private readonly requestTimeoutMs: number;
  private readonly onSnapshot?: (entries: number) => void;
  private snapshot: RoutingSnapshot | undefined;
  private retryAfter = 0;
  private refreshPromise: Promise<void> | undefined;

  constructor(opts: EndpointRoutingOptions) {
    this.configUrl = normalizeConfigUrl(opts.origin);
    this.gatewayOrigin = new URL(this.configUrl).origin;
    this.identity = opts.identity;
    this.platform = opts.platform?.trim() || defaultPlatform();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.successTtlMs = opts.successTtlMs ?? SUCCESS_TTL_MS;
    this.failureCooldownMs = opts.failureCooldownMs ?? FAILURE_COOLDOWN_MS;
    this.requestTimeoutMs = Number.isFinite(opts.requestTimeoutMs) && (opts.requestTimeoutMs ?? 0) > 0
      ? opts.requestTimeoutMs!
      : REQUEST_TIMEOUT_MS;
    this.onSnapshot = opts.onSnapshot;
  }

  /** True when at least one successful snapshot has been fetched. */
  hasSnapshot(): boolean {
    return this.snapshot !== undefined;
  }

  /**
   * Resolve a request URL through the mapping table. Never throws: any error
   * resolves to `{ routed: false, url }` so the caller keeps the original URL.
   * The deprecated credential argument is accepted for caller compatibility,
   * but is never sent to the public client-configs endpoint.
   */
  async resolve(url: string, _credential?: string): Promise<RoutedUrl> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { routed: false, url };
    }
    const key = routingKey(parsed);
    const staticPath = STATIC_GATEWAY_PATHS.get(key);
    const staticTarget = staticPath ? `${this.gatewayOrigin}${staticPath}` : undefined;
    // The current client has these routes built in. Return them immediately
    // and refresh the optional server mapping in the background, so a control-
    // plane outage cannot add latency to the first model request.
    if (staticTarget && !this.snapshot?.mapping.has(key)) {
      if (!this.snapshot || this.snapshot.expiresAt <= this.now()) {
        void this.ensureFresh().catch(() => {});
      }
      return this.rewrite(parsed, staticTarget, url);
    }
    try {
      await this.ensureFresh();
    } catch {
      // fail-open: resolve without a snapshot
    }
    const target = this.snapshot?.mapping.get(key) ?? staticTarget;
    return target ? this.rewrite(parsed, target, url) : { routed: false, url };
  }

  private rewrite(parsed: URL, target: string, original: string): RoutedUrl {
    let rewritten: URL;
    try {
      rewritten = new URL(target);
      const configOrigin = new URL(this.configUrl).origin;
      const allowedOrigins = new Set([parsed.origin, configOrigin, "https://zcode.z.ai", "https://api.z.ai", "https://open.bigmodel.cn"]);
      if (!allowedOrigins.has(rewritten.origin)) return { routed: false, url: original };
    } catch {
      return { routed: false, url: original };
    }
    rewritten.search = parsed.search;
    return { routed: true, url: rewritten.href };
  }

  private async ensureFresh(): Promise<void> {
    const now = this.now();
    if ((this.snapshot && this.snapshot.expiresAt > now) || this.retryAfter > now) return;
    const pending = this.refreshPromise ?? this.beginRefresh();
    await pending;
  }

  private beginRefresh(): Promise<void> {
    const promise = this.refresh().finally(() => {
      if (this.refreshPromise === promise) this.refreshPromise = undefined;
    });
    this.refreshPromise = promise;
    return promise;
  }

  private async refresh(): Promise<void> {
    // QSt (bundle) builds the config-fetch identity set WITHOUT X-ZCode-Agent;
    // the current client-configs endpoint is public and does not receive a
    // model credential. Keep this fetch safe even when called for a request
    // carrying an API key or OAuth token.
    const identityHeaders = Object.fromEntries(
      Object.entries(buildIdentityHeaders(this.identity)).filter(([name]) => name !== "X-ZCode-Agent"),
    );
    const headers: Record<string, string> = {
      ...identityHeaders,
      Accept: "application/json",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const configUrl = new URL(this.configUrl);
      configUrl.searchParams.set("app_version", this.identity.appVersion);
      configUrl.searchParams.set("platform", this.platform);
      const resp = await this.fetchImpl(configUrl.href, {
        method: "GET",
        headers,
        // Never follow a server-controlled redirect for a control-plane
        // response. A redirect is an unavailable snapshot and fail-opens.
        redirect: "error",
        signal: controller.signal,
      });
      if (resp.status < 200 || resp.status >= 300) throw new Error(`client_configs_http_${resp.status}`);
      const parsed = await resp.json() as unknown;
      const envelope = parsed as { code?: unknown; data?: unknown };
      if (!envelope || typeof envelope !== "object" || envelope.code !== 0) {
        throw new Error("client_configs_nonzero_code");
      }
      const data = envelope.data as { proxyEndpoint?: { mapping?: unknown } } | undefined;
      const entries = data?.proxyEndpoint?.mapping;
      const list = Array.isArray(entries) ? entries : [];
      if (list.length > MAX_MAPPING_ENTRIES) throw new Error("client_configs_too_many_mappings");

      const mapping = new Map<string, string>();
      for (const entry of list) {
        const raw = entry as { from?: unknown; to?: unknown };
        const from = parseMappingUrl(raw.from, "from");
        const to = parseMappingUrl(raw.to, "to");
        const key = routingKey(from);
        if (mapping.has(key)) throw new Error("client_configs_duplicate_from");
        mapping.set(key, to.href);
      }
      this.snapshot = { expiresAt: this.now() + this.successTtlMs, mapping };
      this.retryAfter = 0;
      this.onSnapshot?.(mapping.size);
    } catch {
      this.retryAfter = this.now() + this.failureCooldownMs;
    } finally {
      clearTimeout(timer);
    }
  }
}

let defaultRouting: EndpointRoutingService | null = null;
let defaultRoutingKey = "";

/**
 * Process-wide routing service, shared across requests (snapshot cache).
 * Recreated when the relevant config values change (Android `setConfig`) —
 * keyed on the full identity because the service embeds it in config-fetch
 * headers. Returns `null` when disabled.
 */
export function getDefaultEndpointRouting(config: {
  endpointRouting: { enabled: boolean; origin: string };
  identity: ProxyIdentity;
}): EndpointRoutingService | null {
  if (!config.endpointRouting.enabled) return null;
  const key = `${config.endpointRouting.origin}\n${identityCacheKey(config.identity)}\n${defaultPlatform()}`;
  if (!defaultRouting || key !== defaultRoutingKey) {
    defaultRouting = new EndpointRoutingService({
      origin: config.endpointRouting.origin,
      identity: config.identity,
    });
    defaultRoutingKey = key;
  }
  return defaultRouting;
}
