/**
 * GET /quota — live free-quota snapshot from ZCode billing endpoints.
 *
 * Queries the same control plane the desktop client uses (`billing/balance` +
 * `billing/preview` on the configured claim origin) with the stored OAuth JWT
 * and the full desktop identity fingerprint. The billing gateway requires a
 * stable `X-Device-Mid`, so the config identity is forwarded unchanged.
 *
 * @see scripts in vibe-coding-labs/zcode-reverse-engineer (header shape) and
 *      zcode.z.ai desktop bundle `pio()` (identity header semantics).
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { loadCredential } from "../auth/store.js";
import { buildIdentityHeaders, normalizePrintableHeaderValue } from "../proxy/identity.js";
import { inspectJwt } from "../auth/jwt-age.js";
import type { ProxyConfig } from "../config/types.js";
import { errorResponse } from "../proxy/handler.js";
import type { AccountProfile } from "../auth/account-store.js";

export interface QuotaBalanceEntry {
  showName: string;
  /** Unknown/missing upstream values are null — never an invented 0. */
  remainingUnits: number | null;
  totalUnits: number | null;
  usedUnits: number | null;
  unitType?: string;
  expiresAt?: number;
  /** Provider-confirmed independence; absent means the bucket is not safely summable. */
  independent?: boolean;
}

export interface QuotaPlanEntry {
  planId: string;
  name: string;
  description?: string;
  entitlements: Array<{ showName: string; grantUnits: number | null; unitType: string; effectiveAt?: number }>;
}

export interface QuotaSnapshot {
  provider: string;
  serverTime: number;
  /**
   * Stored start-plan JWT age (informational). The token has no `exp` and is
   * not rejected by age — an 8-day-old JWT still serves billing/balance. Only
   * a real 401/3012 from the billing gateway indicates re-login is needed,
   * which surfaces in `errors`.
   */
  jwt: { ageHours: number; issuedAt: number } | null;
  balances: QuotaBalanceEntry[];
  claimablePlans: QuotaPlanEntry[];
  errors: string[];
  /** When the billing endpoints were actually queried (ISO). With `cached`, consumers must display this as the data age. */
  asOf: string;
  /** True when served from the singleflight cache (within QUOTA_CACHE_TTL_MS of `asOf`). */
  cached: boolean;
}

export interface PoolQuotaAccountSnapshot {
  accountId: string;
  provider: string;
  plan: string | null;
  /** Offline/live distinction is explicit for consumers rendering status. */
  source: "live" | "error" | "duplicate";
  asOf: string | null;
  balances: QuotaBalanceEntry[];
  errors: string[];
}

export interface PoolQuotaSnapshot {
  schemaVersion: 1;
  source: "live-runtime";
  provider: string;
  plan: string;
  asOf: string;
  accounts: PoolQuotaAccountSnapshot[];
  /** Sums contain only comparable, independent buckets with known units. */
  totals: QuotaBalanceEntry[];
  errors: string[];
}

/** Billing calls are single-shot UI data: bound them hard. */
const BILLING_TIMEOUT_MS = 10_000;
/** Singleflight cache: parallel /quota hits reuse one billing round-trip. */
const QUOTA_CACHE_TTL_MS = 15_000;

type QuotaCacheEntry = { snapshot: QuotaSnapshot | null; fetchedAtMs: number; promise: Promise<QuotaSnapshot> };
const quotaCache = new Map<string, QuotaCacheEntry>();
const poolQuotaCache = new Map<string, { snapshot: QuotaSnapshot; fetchedAtMs: number }>();

/** Test hook: drop the /quota cache so tests are isolated from each other. */
export function clearQuotaCache(): void {
  quotaCache.clear();
  poolQuotaCache.clear();
}

/**
 * Query all configured accounts with bounded concurrency. This is deliberately
 * provider-agnostic: it reuses the same billing calls as /quota and never
 * invents a balance for a provider that returns an unknown field. Cache keys
 * include account id, credential revision and billing context; a stale reply
 * therefore cannot populate a replacement account's entry.
 */
export async function collectPoolQuotaSnapshot(
  config: ProxyConfig,
  profiles: readonly AccountProfile[],
  fetchImpl: typeof fetch = fetch,
  options: { concurrency?: number; now?: () => number } = {},
): Promise<PoolQuotaSnapshot> {
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)));
  const now = options.now ?? (() => Date.now());
  const liveIds = new Set(profiles.map((profile) => profile.id));
  const liveCacheKeys = new Set<string>();
  for (const profile of profiles) {
    const revision = Number((profile as unknown as { credentialRevision?: number }).credentialRevision)
      || profile.lastUsedAt || profile.createdAt || 0;
    liveCacheKeys.add(`${profile.id}:${revision}:${profile.credential.provider}:${profile.plan ?? config.plan}:${config.claim.origin}:${config.identity.deviceMid ?? ""}:${config.identity.appVersion}`);
  }
  for (const key of poolQuotaCache.keys()) {
    const separator = key.indexOf(":");
    if (separator > 0 && (!liveIds.has(key.slice(0, separator) || "") || !liveCacheKeys.has(key))) poolQuotaCache.delete(key);
  }
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  const fetchLimited: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (inFlight >= concurrency) await new Promise<void>((resolve) => waiters.push(resolve));
    inFlight++;
    try { return await fetchImpl(input, init); }
    finally {
      inFlight--;
      waiters.shift()?.();
    }
  }) as typeof fetch;
  const queue = profiles.slice();
  const results: PoolQuotaAccountSnapshot[] = [];
  const seenCredentials = new Set<string>();
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const profile = queue.shift();
      if (!profile) return;
      const revision = Number((profile as unknown as { credentialRevision?: number }).credentialRevision)
        || profile.lastUsedAt || profile.createdAt || 0;
      const cacheKey = `${profile.id}:${revision}:${profile.credential.provider}:${profile.plan ?? config.plan}:${config.claim.origin}:${config.identity.deviceMid ?? ""}:${config.identity.appVersion}`;
      liveCacheKeys.add(cacheKey);
      // Only authenticated OAuth identity or identical credentials can suppress
      // a billing probe. Decoded JWT subjects are duplicate hints, not proof.
      const userIdentity = profile.credential.userId?.trim();
      const identityKey = createHash("sha256").update(JSON.stringify(userIdentity
        ? [profile.credential.provider, profile.plan ?? config.plan, "user", userIdentity]
        : [
          profile.credential.provider,
          profile.plan ?? config.plan,
          profile.credential.apiKey,
          profile.credential.jwt ?? "",
          profile.credential.secret ?? "",
        ])).digest("hex");
      if (seenCredentials.has(identityKey)) {
        results.push({ accountId: profile.id, provider: profile.credential.provider, plan: profile.plan ?? null, source: "duplicate", asOf: null, balances: [], errors: ["duplicate_effective_credential"] });
        continue;
      }
      seenCredentials.add(identityKey);
      const cached = poolQuotaCache.get(cacheKey);
      if (cached && now() - cached.fetchedAtMs < QUOTA_CACHE_TTL_MS) {
        results.push({ accountId: profile.id, provider: profile.credential.provider, plan: profile.plan ?? null, source: "live", asOf: cached.snapshot.asOf, balances: cached.snapshot.balances, errors: cached.snapshot.errors });
        continue;
      }
      try {
        const snapshot = await collectQuotaSnapshot(config, fetchLimited, async () => profile.credential);
        poolQuotaCache.set(cacheKey, { snapshot, fetchedAtMs: now() });
        results.push({ accountId: profile.id, provider: profile.credential.provider, plan: profile.plan ?? null, source: "live", asOf: snapshot.asOf, balances: snapshot.balances, errors: snapshot.errors });
      } catch (err) {
        results.push({ accountId: profile.id, provider: profile.credential.provider, plan: profile.plan ?? null, source: "error", asOf: null, balances: [], errors: [safeQuotaError(err)] });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker()));
  results.sort((a, b) => a.accountId.localeCompare(b.accountId));

  const totals = new Map<string, QuotaBalanceEntry>();
  for (const result of results) {
    if (result.source !== "live") continue;
    for (const balance of result.balances) {
      // Unknown units and unknown remaining values cannot be safely summed.
      if (balance.independent !== true || !balance.unitType || balance.remainingUnits === null || balance.totalUnits === null || balance.usedUnits === null) continue;
      const key = `${balance.showName}\u0000${balance.unitType}`;
      const prior = totals.get(key);
      if (!prior) {
        totals.set(key, { ...balance });
      } else {
        prior.remainingUnits = (prior.remainingUnits ?? 0) + balance.remainingUnits;
        prior.totalUnits = (prior.totalUnits ?? 0) + balance.totalUnits;
        prior.usedUnits = (prior.usedUnits ?? 0) + balance.usedUnits;
        if (balance.expiresAt !== undefined) prior.expiresAt = Math.min(prior.expiresAt ?? balance.expiresAt, balance.expiresAt);
      }
    }
  }
  return {
    schemaVersion: 1,
    source: "live-runtime",
    provider: config.provider,
    plan: config.plan,
    asOf: new Date(now()).toISOString(),
    accounts: results,
    totals: [...totals.values()],
    errors: [
      ...(profiles.length === 0 ? ["account_pool_empty"] : []),
      ...results.flatMap((result) => result.errors.map((error) => `${result.accountId}: ${error}`)),
    ].slice(0, 32),
  };
}

function safeQuotaError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/[\r\n]+/g, " ").replace(/(?:Bearer\s+)[^\s]+/gi, "Bearer <redacted>").slice(0, 160);
}

/** Query one billing URL, tolerating per-endpoint failures. */
async function fetchBilling(
  origin: string,
  path: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ code?: number; msg?: string; data?: unknown } | null> {
  try {
    const resp = await fetchImpl(`${origin.replace(/\/+$/, "")}${path}`, { headers, signal: AbortSignal.timeout(BILLING_TIMEOUT_MS) });
    const text = await resp.text();
    if (!resp.ok) return { code: resp.status };
    try {
      return JSON.parse(text) as { code?: number; msg?: string; data?: unknown };
    } catch {
      return { code: resp.status, msg: text.slice(0, 120) };
    }
  } catch (e) {
    return { code: -1, msg: String(e).slice(0, 120) };
  }
}

/** Coerce an upstream value to a finite number, or undefined (never NaN — JSON.stringify would emit null). */
function toFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Build the billing snapshot. Exported for tests. `loadCredentialImpl` is injectable for tests. */
export async function collectQuotaSnapshot(
  config: ProxyConfig,
  fetchImpl: typeof fetch = fetch,
  loadCredentialImpl: typeof loadCredential = loadCredential,
): Promise<QuotaSnapshot> {
  const cred = await loadCredentialImpl();
  if (!cred?.jwt) {
    throw new Error("not logged in — no JWT credential (run: zcode-proxy auth login)");
  }
  const jwtInfo = inspectJwt(cred.jwt);
  const jwt = jwtInfo
    ? { ageHours: Number(jwtInfo.ageHours.toFixed(2)), issuedAt: jwtInfo.iat }
    : null;
  const identity = config.identity;
  const idHeaders = buildIdentityHeaders(identity);
  // The claim client drops X-ZCode-Agent for zcode.z.ai control-plane calls;
  // the billing gateway follows the same precedent.
  delete idHeaders["X-ZCode-Agent"];
  const headers: Record<string, string> = { ...idHeaders, authorization: `Bearer ${cred.jwt}`, Accept: "application/json" };
  // Billing fingerprint is reconstructed from the observed claim-client format
  // (`${platform}-${arch}`). Reuses identity.ts's env-override normalization
  // (same ZCODE_IDENTITY_PLATFORM/ARCH overrides the proxy headers use —
  // Android seeds linux-x64 via index.ts); empty or non-printable overrides
  // fall back to the real values — an empty override must not yield
  // `-x64`/`linux-`.
  // NOTE: ProxyIdentity has no platform/arch fields — do not read them off `identity`.
  const platform = `${normalizePrintableHeaderValue(process.env.ZCODE_IDENTITY_PLATFORM) ?? process.platform}-${normalizePrintableHeaderValue(process.env.ZCODE_IDENTITY_ARCH) ?? os.arch()}`;
  const origin = config.claim.origin || "https://zcode.z.ai";
  const appVersion = identity.appVersion;

  const errors: string[] = [];
  const [balance, preview] = await Promise.all([
    fetchBilling(origin, `/api/v1/zcode-plan/billing/balance?app_version=${encodeURIComponent(appVersion)}&platform=${encodeURIComponent(platform)}`, headers, fetchImpl),
    fetchBilling(origin, `/api/v1/zcode-plan/billing/preview?app_version=${encodeURIComponent(appVersion)}&platform=${encodeURIComponent(platform)}`, headers, fetchImpl),
  ]);
  // Keep diagnostics machine-readable and bounded; provider messages may
  // contain request ids, URLs, or account metadata and are never forwarded.
  if (balance && balance.code !== 0) errors.push(`balance: ${quotaErrorCode(balance.code)}`);
  if (preview && preview.code !== 0) errors.push(`preview: ${quotaErrorCode(preview.code)}`);

  const balances: QuotaBalanceEntry[] = [];
  const balanceData = (balance?.data ?? {}) as { balances?: any[]; server_time?: number };
  if (balance?.code === 0 && !Array.isArray(balanceData.balances)) errors.push("balance: provider_unknown");
  for (const b of Array.isArray(balanceData.balances) ? balanceData.balances : []) {
    // unitType/expiresAt camelCase aliases observed live alongside snake_case;
    // accept both so neither casing drops the field.
    const expiresAt = toFiniteNumber(b.expires_at ?? b.expiresAt);
    const unitType = b.unit_type ?? b.unitType;
    // Unknown/NaN numbers stay null (audit §10): an invented 0 would make a
    // partially-known balance look exhausted/empty.
    balances.push({
      showName: String(b.show_name ?? ""),
      remainingUnits: toFiniteNumber(b.remaining_units ?? b.remainingUnits) ?? null,
      totalUnits: toFiniteNumber(b.total_units ?? b.totalUnits) ?? null,
      usedUnits: toFiniteNumber(b.used_units ?? b.usedUnits) ?? null,
      ...(unitType ? { unitType: String(unitType) } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...((b.independent === true || b.independent_bucket === true) ? { independent: true } : {}),
    });
  }

  const claimablePlans: QuotaPlanEntry[] = [];
  const previewData = (preview?.data ?? {}) as { plans?: any[] };
  for (const p of Array.isArray(previewData.plans) ? previewData.plans : []) {
    claimablePlans.push({
      planId: String(p.plan_id ?? ""),
      name: String(p.name ?? p.plan_id ?? ""),
      ...(p.description ? { description: String(p.description) } : {}),
      entitlements: (Array.isArray(p.entitlements) ? p.entitlements : []).map((e: any) => ({
        showName: String(e.show_name ?? ""),
        grantUnits: toFiniteNumber(e.grant_units ?? e.grantUnits) ?? null,
        unitType: String(e.unit_type ?? e.unitType ?? "token"),
        ...(toFiniteNumber(e.effective_at ?? e.effectiveAt) !== undefined
          ? { effectiveAt: toFiniteNumber(e.effective_at ?? e.effectiveAt) as number }
          : {}),
      })),
    });
  }

  return {
    provider: config.provider,
    serverTime: toFiniteNumber(balanceData.server_time) ?? Math.floor(Date.now() / 1000),
    jwt,
    balances,
    claimablePlans,
    errors,
    asOf: new Date().toISOString(),
    cached: false,
  };
}

function quotaErrorCode(code: unknown): string {
  if (typeof code === "number" && Number.isFinite(code)) return `provider_${Math.trunc(code)}`;
  return "provider_unknown";
}

/** Handle GET /quota — JSON snapshot with the proxy error envelope on failure. `loadCredentialImpl` is injectable for tests. */
export async function handleQuota(
  config: ProxyConfig,
  fetchImpl: typeof fetch = fetch,
  loadCredentialImpl: typeof loadCredential = loadCredential,
  /** Cache partition. Pool callers pass the selected account id so one account never serves another's snapshot. */
  cacheKey = "legacy",
): Promise<Response> {
  try {
    // Singleflight + short TTL: parallel UI probes (manager status, doctor,
    // webui) share one billing round-trip instead of hammering the gateway.
    // Cache states are kept distinct (ZAK-009): an in-flight entry carries a
    // null snapshot and is always awaited — never spread as if it were a
    // completed snapshot. A completed entry is served only within its TTL;
    // afterwards a fresh fetch starts instead of serving stale data forever.
    const now = Date.now();
    for (const [key, entry] of quotaCache) {
      if (entry.snapshot && now - entry.fetchedAtMs >= QUOTA_CACHE_TTL_MS) quotaCache.delete(key);
    }
    let entry = quotaCache.get(cacheKey);
    if (entry?.snapshot) {
      const cached: QuotaSnapshot = { ...entry.snapshot, cached: true };
      return new Response(JSON.stringify(cached, null, 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (!entry) {
      const promise = collectQuotaSnapshot(config, fetchImpl, loadCredentialImpl)
        .then((snapshot) => {
          if (quotaCache.get(cacheKey)?.promise === promise) {
            quotaCache.set(cacheKey, { snapshot, fetchedAtMs: Date.now(), promise });
          }
          return snapshot;
        })
        .catch((err) => {
          if (quotaCache.get(cacheKey)?.promise === promise) quotaCache.delete(cacheKey);
          throw err;
        });
      entry = { snapshot: null, fetchedAtMs: now, promise };
      quotaCache.set(cacheKey, entry);
    }
    const snapshot = await entry.promise;
    return new Response(JSON.stringify(snapshot, null, 1), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return errorResponse(503, "quota_unavailable", `quota query failed: ${(e as Error).message}`);
  }
}
