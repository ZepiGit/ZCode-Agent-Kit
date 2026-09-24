/**
 * One combined, redacted health view of the account pool.
 *
 * Pure: the CLI gathers the offline store view plus the live `/accounts/status`
 * and `/accounts/quota` bodies and this module only merges and judges them, so
 * every verdict is testable without a proxy or upstream. No credential field
 * ever enters the report — only ids, runtime state and quota numbers.
 */
import type { QuotaBalanceEntry } from "../server/routes-quota.js";

export type AccountVerdict =
  | "ok" | "low" | "empty" | "no_quota_data" | "exhausted" | "auth_error"
  | "expired" | "invalid" | "blocked" | "paused" | "duplicate" | "unknown";

/** Below this share of a package's total, the account is flagged `low`. */
export const LOW_QUOTA_RATIO = 0.1;

/** Offline store facts (redacted) for one configured account. */
export interface OfflineAccount {
  id: string;
  provider: string;
  plan: string | null;
  paused: boolean;
  state: string;
  lastUsedAt: number | null;
  exhaustedUntil: number | null;
  /** Another account naming the same upstream login (kept one). */
  duplicateOf?: string;
}

/** Subset of the live `/accounts/status` body this view relies on. */
export interface LiveStatus {
  activeAccountId: string | null;
  accounts: Array<{ id: string; provider?: string; plan?: string | null; state: string; lastUsedAt: number | null; exhaustedUntil: number | null }>;
}

/** Subset of the live `/accounts/quota` body this view relies on. */
export interface LiveQuota {
  accounts: Array<{ accountId: string; source: string; balances: QuotaBalanceEntry[]; errors: string[] }>;
  totals: QuotaBalanceEntry[];
}

/** Inputs of one account's verdict; `quotaSource` null = no quota answer for it. */
export interface VerdictInput {
  state: string;
  paused: boolean;
  exhaustedUntil: number | null;
  duplicateOf?: string;
  quotaSource: string | null;
  balances: readonly QuotaBalanceEntry[];
  errors: readonly string[];
}

export interface HealthBalance {
  showName: string;
  remainingUnits: number | null;
  totalUnits: number | null;
  unitType?: string;
  /** Unix seconds, as reported upstream. */
  expiresAt?: number;
  percentRemaining: number | null;
}

export interface HealthAccount {
  id: string;
  probeSource: string;
  verdict: AccountVerdict;
  state: string;
  paused: boolean;
  plan: string | null;
  provider: string;
  lastUsedAt: number | null;
  exhaustedUntil: number | null;
  balances: HealthBalance[];
  errors: string[];
  duplicateOf?: string;
}

export interface HealthReport {
  schemaVersion: 1;
  source: "combined";
  asOf: string;
  activeAccountId: string | null;
  proxy: { reachable: boolean; quotaAvailable: boolean };
  accounts: HealthAccount[];
  summary: { usable: number; total: number; totals: HealthBalance[] };
}

// Billing 401 and provider 3012 mean the stored login is no longer accepted.
const AUTH_ERROR = /\bprovider_(?:401|3012)\b/;

function percent(balance: Pick<QuotaBalanceEntry, "remainingUnits" | "totalUnits">): number | null {
  const { remainingUnits: remaining, totalUnits: total } = balance;
  if (remaining === null || total === null || total <= 0) return null;
  return Math.round((Math.max(0, remaining) / total) * 1000) / 10;
}

/**
 * Precedence mirrors what blocks traffic first: an administrative pause or
 * policy block wins over credential problems, which win over quota state.
 * Quota verdicts are conservative: `ok`/`low`/`empty` need a clean answer
 * (no endpoint error) in which every bucket has known numbers; anything
 * partial is `unknown`, never a usable guess.
 */
export function accountVerdict(entry: VerdictInput, now: number): AccountVerdict {
  if (entry.paused || entry.state === "paused") return "paused";
  if (entry.state === "blocked") return "blocked";
  if (entry.state === "expired") return "expired";
  if (entry.state === "invalid") return "invalid";
  if (entry.errors.some((error) => AUTH_ERROR.test(error))) return "auth_error";
  if (entry.exhaustedUntil !== null && entry.exhaustedUntil > now) return "exhausted";
  if (entry.duplicateOf || entry.quotaSource === "duplicate") return "duplicate";
  if (entry.quotaSource !== "live" || entry.errors.length > 0) return "unknown";
  // Code 0 with no buckets is a real upstream answer, not a healthy account.
  if (entry.balances.length === 0) return "no_quota_data";
  const ratios: number[] = [];
  for (const { remainingUnits: remaining, totalUnits: total } of entry.balances) {
    if (remaining === null || total === null || total <= 0) return "unknown";
    ratios.push(Math.max(0, remaining) / total);
  }
  if (ratios.every((ratio) => ratio === 0)) return "empty";
  if (ratios.some((ratio) => ratio < LOW_QUOTA_RATIO)) return "low";
  return "ok";
}

const finiteOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

function parseBalances(value: unknown): QuotaBalanceEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: QuotaBalanceEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const b = raw as Record<string, unknown>;
    const expiresAt = finiteOrNull(b.expiresAt);
    out.push({
      showName: typeof b.showName === "string" ? b.showName : "",
      remainingUnits: finiteOrNull(b.remainingUnits),
      totalUnits: finiteOrNull(b.totalUnits),
      usedUnits: finiteOrNull(b.usedUnits),
      ...(typeof b.unitType === "string" ? { unitType: b.unitType } : {}),
      ...(expiresAt !== null ? { expiresAt } : {}),
      ...(b.independent === true ? { independent: true } : {}),
    });
  }
  return out;
}

/** Validate a `/accounts/status` body once; a malformed body counts as no live data. */
export function parseLiveStatus(body: unknown): LiveStatus | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.accounts)) return null;
  const accounts: LiveStatus["accounts"] = [];
  for (const item of raw.accounts) {
    if (!item || typeof item !== "object") return null;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.state !== "string") return null;
    accounts.push({
      id: a.id,
      state: a.state,
      ...(typeof a.provider === "string" ? { provider: a.provider } : {}),
      plan: typeof a.plan === "string" ? a.plan : null,
      lastUsedAt: finiteOrNull(a.lastUsedAt),
      exhaustedUntil: finiteOrNull(a.exhaustedUntil),
    });
  }
  return { activeAccountId: typeof raw.activeAccountId === "string" ? raw.activeAccountId : null, accounts };
}

/** Validate a `/accounts/quota` body once; a malformed body counts as no quota data. */
export function parseLiveQuota(body: unknown): LiveQuota | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const totals = parseBalances(raw.totals);
  if (!Array.isArray(raw.accounts) || !totals) return null;
  const accounts: LiveQuota["accounts"] = [];
  for (const item of raw.accounts) {
    if (!item || typeof item !== "object") return null;
    const a = item as Record<string, unknown>;
    const balances = parseBalances(a.balances);
    if (typeof a.accountId !== "string" || typeof a.source !== "string" || !balances || !Array.isArray(a.errors)) return null;
    accounts.push({ accountId: a.accountId, source: a.source, balances, errors: a.errors.map(String) });
  }
  return { accounts, totals };
}

// Only machine codes produced by the quota route pass through; anything else
// (transport error text, future free-form messages) is collapsed so the report
// can never echo upstream text or credential fragments.
const SAFE_ERROR = /^(?:(?:balance|preview): provider_(?:-?\d+|unknown)|duplicate_effective_credential)$/;

function healthBalance(balance: QuotaBalanceEntry): HealthBalance {
  return {
    // Package names are upstream display strings: keep them single-line and bounded.
    showName: String(balance.showName).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 60),
    remainingUnits: balance.remainingUnits,
    totalUnits: balance.totalUnits,
    ...(balance.unitType ? { unitType: balance.unitType } : {}),
    ...(balance.expiresAt !== undefined ? { expiresAt: balance.expiresAt } : {}),
    percentRemaining: percent(balance),
  };
}

/** Merge offline store facts with whatever live data the proxy returned. */
export function buildHealthReport(
  offline: readonly OfflineAccount[],
  status: LiveStatus | null,
  quota: LiveQuota | null,
  now: number,
): HealthReport {
  const live = new Map((status?.accounts ?? []).map((account) => [account.id, account]));
  const quotaById = new Map((quota?.accounts ?? []).map((account) => [account.accountId, account]));
  const ids = [...offline.map((account) => account.id)];
  for (const id of live.keys()) if (!ids.includes(id)) ids.push(id);
  const offlineById = new Map(offline.map((account) => [account.id, account]));

  const accounts = ids.map((id): HealthAccount => {
    const stored = offlineById.get(id);
    const runtime = live.get(id);
    const quotaEntry = quotaById.get(id);
    // Offline ordering can pick a paused/excluded leader. A real response is
    // authoritative for this row; only the collector decides probe duplication.
    const duplicateOf = quotaEntry?.source === "duplicate" ? stored?.duplicateOf : undefined;
    const state = runtime?.state ?? stored?.state ?? "unknown";
    const paused = stored?.paused === true || state === "paused";
    const exhaustedUntil = runtime ? runtime.exhaustedUntil : stored?.exhaustedUntil ?? null;
    const balances = quotaEntry?.balances ?? [];
    const errors = quotaEntry?.errors ?? [];
    return {
      id,
      // Without the runtime, stored state cannot tell whether an account would
      // serve a request now; claiming a verdict would be a guess.
      verdict: status === null ? "unknown" : accountVerdict({
        state, paused, exhaustedUntil, duplicateOf,
        quotaSource: quotaEntry?.source ?? null, balances, errors,
      }, now),
      state,
      paused,
      plan: stored?.plan ?? runtime?.plan ?? null,
      provider: stored?.provider ?? runtime?.provider ?? "unknown",
      lastUsedAt: runtime ? runtime.lastUsedAt : stored?.lastUsedAt ?? null,
      exhaustedUntil,
      balances: balances.map(healthBalance),
      errors: [...new Set(errors.map((error) => SAFE_ERROR.test(error) ? error : "quota_query_failed"))],
      ...(duplicateOf ? { duplicateOf } : {}),
      probeSource: quotaEntry?.source ?? "not_probed",
    };
  });

  return {
    schemaVersion: 1,
    source: "combined",
    asOf: new Date(now).toISOString(),
    activeAccountId: status?.activeAccountId ?? null,
    proxy: { reachable: status !== null, quotaAvailable: quota !== null },
    accounts,
    summary: {
      usable: accounts.filter((account) => account.verdict === "ok" || account.verdict === "low").length,
      total: accounts.length,
      totals: (quota?.totals ?? []).map(healthBalance),
    },
  };
}

export const UNREACHABLE_MESSAGE = "live data unavailable — start the proxy with: zcode-kit proxy start";

function clock(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function balanceText(balance: HealthBalance): string {
  const pct = balance.percentRemaining === null ? "" : ` (${Math.round(balance.percentRemaining)}%)`;
  const reset = balance.expiresAt === undefined ? "" : ` resets ${clock(balance.expiresAt)}`;
  const [remaining, total] = [balance.remainingUnits, balance.totalUnits].map((value) => value === null ? "?" : value.toLocaleString("en-US"));
  return `${balance.showName} ${remaining}/${total}${pct}${reset}`;
}

function age(lastUsedAt: number | null, now: number): string {
  if (lastUsedAt === null) return "never used";
  const seconds = Math.max(0, Math.floor((now - lastUsedAt) / 1000));
  if (seconds < 60) return `used ${seconds}s ago`;
  if (seconds < 3600) return `used ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `used ${Math.floor(seconds / 3600)}h ago`;
  return `used ${Math.floor(seconds / 86_400)}d ago`;
}

function quotaText(account: HealthAccount): string {
  if (account.duplicateOf) return `same login as ${account.duplicateOf}`;
  if (account.balances.length) return account.balances.map(balanceText).join(" · ");
  if (account.verdict === "no_quota_data") return "no quota packages¹";
  return account.errors.length ? account.errors.join(", ") : "—";
}

/** Compact table for terminals; `now` only drives relative ages. */
export function renderHealthText(report: HealthReport, now = Date.parse(report.asOf)): string {
  const lines: string[] = [];
  if (!report.proxy.reachable) lines.push(UNREACHABLE_MESSAGE, "");
  else if (!report.proxy.quotaAvailable) lines.push("quota data unavailable — verdicts use runtime state only", "");
  if (report.accounts.length === 0) {
    lines.push("No accounts configured.");
    return lines.join("\n");
  }
  const idWidth = Math.max(...report.accounts.map((account) => account.id.length));
  const verdictWidth = Math.max(...report.accounts.map((account) => account.verdict.length));
  const stateWidth = Math.max(...report.accounts.map((account) => account.state.length));
  for (const account of report.accounts) {
    const marker = account.id === report.activeAccountId ? "*" : " ";
    lines.push(`${marker} ${account.id.padEnd(idWidth)}  ${account.verdict.padEnd(verdictWidth)}  ${account.state.padEnd(stateWidth)}  ${quotaText(account)}  ${age(account.lastUsedAt, now)}`);
  }
  const totals = report.summary.totals.length ? report.summary.totals.map(balanceText).join(" · ") : "n/a";
  lines.push("", `usable: ${report.summary.usable} of ${report.summary.total}; totals: ${totals}`);
  if (report.activeAccountId) lines.push("* = active account");
  if (report.accounts.some((account) => account.verdict === "no_quota_data")) {
    lines.push("¹ no_quota_data: upstream reported no quota packages for that account right now.");
  }
  return lines.join("\n");
}
