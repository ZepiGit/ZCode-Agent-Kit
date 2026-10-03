// `zcode-kit doctor --upstream`: compare the gateway the kit's proxy uses with
// the provider configuration the ZCode client itself receives.
//
// The ZCode client (3.14) asks GET {origin}/api/v1/client/configs for a
// remote "builtin provider" release (data.configs.builtin_provider_config_json,
// a CDN JSON with providerRules[].config.{access,api.baseUrl,builtinModelIds})
// and overrides its bundled table with it; older app versions get a provider
// list in data.providers[] instead. When the vendor moves a gateway, the
// client follows at once while the kit keeps its compiled constants — this
// check makes that visible. Opt-in (at most three unauthenticated GETs to
// the vendor and its CDN), never part of the default doctor; nothing secret
// is sent.
import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { configuredModelIds } from "./connection-details.mjs";

export const DEFAULT_UPSTREAM_ORIGIN = "https://zcode.z.ai";
export const UPSTREAM_ORIGIN_ENV = "ZCODE_KIT_UPSTREAM_ORIGIN";
/** Platform value the kit's proxy already sends to the same endpoint (captcha config). */
const PLATFORM = "win32-x64";
const TIMEOUT_MS = 8000;
/** Client release the kit was last compared with (zai-org/zcode 3.14.3); used when the configured version gets no plan data. */
export const REFERENCE_APP_VERSION = "3.14.3";
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Anthropic gateway base the kit's proxy uses per plan and provider. Mirrors
 * zcode-proxy-src/src/provider/providers.ts (anthropicBaseURL) and
 * src/proxy/upstream.ts (STARTPLAN_ANTHROPIC_BASE + "/anthropic"); a kit test
 * pins that the two stay equal.
 */
export const KIT_GATEWAY_BASES = Object.freeze({
  "coding-plan": Object.freeze({ zai: "https://api.z.ai/api/anthropic", bigmodel: "https://open.bigmodel.cn/api/anthropic" }),
  "start-plan": Object.freeze({ zai: "https://zcode.z.ai/api/v1/zcode-plan/anthropic", bigmodel: "https://zcode.z.ai/api/v1/zcode-plan/anthropic" }),
});

/** Upstream access modes that correspond to a kit plan. */
const MODES_FOR_PLAN = { "coding-plan": ["individual-coding-plan", "team-coding-plan"], "start-plan": ["start-plan"] };
const LEGACY_PROVIDER_IDS = { "z-ai": "zai", bigmodel: "bigmodel" };

/** provider, plan, identity.appVersion and models from proxy/config.yaml (template defaults when absent). */
export function readProxyTarget(configPath) {
  let text = "";
  try { if (configPath && existsSync(configPath)) text = readFileSync(configPath, "utf8"); } catch { text = ""; }
  const top = (key) => text.match(new RegExp(`^${key}:[ \\t]*["']?([A-Za-z0-9._-]+)["']?[ \\t]*(?:#.*)?$`, "m"))?.[1];
  const appVersion = text.match(/^identity:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+appVersion:[ \t]*["']?([0-9A-Za-z._-]+)["']?/m)?.[1];
  return { provider: top("provider") ?? "zai", plan: top("plan") ?? "start-plan", appVersion: appVersion ?? REFERENCE_APP_VERSION, models: configuredModelIds(configPath) };
}

function isLoopbackUrl(url) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}

/** The config origin: https only, except an explicit loopback test origin. */
export function resolveUpstreamOrigin(env = process.env) {
  const raw = env[UPSTREAM_ORIGIN_ENV];
  if (!raw) return DEFAULT_UPSTREAM_ORIGIN;
  const url = new URL(raw);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackUrl(url)))) {
    throw new Error(`${UPSTREAM_ORIGIN_ENV} must be an https origin (http only for loopback)`);
  }
  return url.origin;
}

async function getJson(url, fetchImpl, signal) {
  const res = await fetchImpl(url, { method: "GET", redirect: "error", credentials: "omit", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    void res.body?.cancel().catch(() => {});
    throw new Error("response too large");
  }
  // Read with a byte cap: the header may be absent or wrong.
  const chunks = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Fetch the provider entries the ZCode client of `appVersion` receives.
 * Returns { shape: "release"|"legacy", revision?, entries: [{ provider, mode, baseUrl, models }] }.
 */
export async function fetchUpstreamProviders({ appVersion, origin = resolveUpstreamOrigin(), fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  // One budget for both requests together.
  const signal = AbortSignal.timeout(timeoutMs);
  const configUrl = new URL("/api/v1/client/configs", origin);
  configUrl.searchParams.set("app_version", appVersion);
  configUrl.searchParams.set("platform", PLATFORM);
  const payload = await getJson(configUrl, fetchImpl, signal);
  if (payload?.code !== 0 || !payload.data || typeof payload.data !== "object") throw new Error(`unexpected answer (code ${payload?.code ?? "?"})`);
  const releaseRef = payload.data.configs?.builtin_provider_config_json;
  if (typeof releaseRef === "string") {
    const releaseUrl = new URL(releaseRef);
    const originUrl = new URL(origin);
    const trusted = releaseUrl.protocol === "https:" && !releaseUrl.username && !releaseUrl.password
      && (releaseUrl.hostname === "z.ai" || releaseUrl.hostname.endsWith(".z.ai"));
    const testLocal = isLoopbackUrl(originUrl) && releaseUrl.origin === originUrl.origin;
    if (!trusted && !testLocal) throw new Error(`release URL on an unexpected host (${releaseUrl.hostname})`);
    const release = await getJson(releaseUrl, fetchImpl, signal);
    const rules = release?.config?.providerConfigRules?.providerRules;
    if (!Array.isArray(rules)) throw new Error("release without providerRules");
    return {
      shape: "release",
      revision: Number.isInteger(release.revision) ? release.revision : null,
      entries: rules.map((rule) => ({
        provider: rule?.config?.access?.accountType ?? null,
        mode: rule?.config?.access?.mode ?? null,
        baseUrl: rule?.config?.api?.baseUrl ?? null,
        models: Array.isArray(rule?.config?.builtinModelIds) ? rule.config.builtinModelIds.map(String) : [],
      })).filter((e) => typeof e.provider === "string" && typeof e.mode === "string" && typeof e.baseUrl === "string"),
    };
  }
  if (Array.isArray(payload.data.providers)) {
    return {
      shape: "legacy",
      entries: payload.data.providers
        .filter((p) => p?.schema === "anthropic" && LEGACY_PROVIDER_IDS[p?.id] && typeof p.baseUrl === "string")
        .map((p) => ({
          provider: LEGACY_PROVIDER_IDS[p.id],
          mode: "individual-coding-plan",
          baseUrl: p.baseUrl,
          models: Array.isArray(p.models) ? p.models.map((m) => String(m?.modelId ?? "")).filter(Boolean) : [],
        })),
    };
  }
  throw new Error("answer carries neither a provider release nor a provider list");
}

const norm = (url) => String(url).replace(/\/+$/, "").toLowerCase();

/** Doctor checks (ok: true PASS, false FAIL, null SKIP) for the configured plan and provider. */
export function compareUpstream(target, upstream) {
  const checks = [];
  const expected = KIT_GATEWAY_BASES[target.plan]?.[target.provider];
  const label = `upstream gateway (${target.provider}, ${target.plan})`;
  if (!expected) {
    checks.push({ name: label, ok: null, detail: "plan/provider not covered by this check" });
    return checks;
  }
  const modes = MODES_FOR_PLAN[target.plan] ?? [];
  const matching = upstream.entries.filter((e) => e.provider === target.provider && modes.includes(e.mode));
  const source = upstream.shape === "release" ? `remote provider release${upstream.revision !== null ? ` rev ${upstream.revision}` : ""}` : "provider list";
  if (!matching.length) {
    checks.push({ name: label, ok: null, detail: `not listed in the ${source} served to app ${target.appVersion} — nothing to compare` });
    return checks;
  }
  const bases = [...new Set(matching.map((e) => e.baseUrl))];
  if (bases.some((b) => norm(b) === norm(expected))) {
    checks.push({ name: label, ok: true, detail: `${expected} matches the ${source}` });
  } else {
    checks.push({ name: label, ok: false, detail: `the ZCode client now uses ${bases.join(", ")} (${source}); the kit's proxy still sends to ${expected} — update the kit (zcode-kit update) or report it` });
  }
  const offered = new Set(matching.flatMap((e) => e.models.map((m) => m.toLowerCase())));
  if (offered.size) {
    const missing = target.models.filter((m) => !offered.has(m.toLowerCase()));
    checks.push({
      name: `upstream models (${target.plan})`,
      ok: missing.length ? null : true,
      detail: missing.length
        ? `configured but not offered to the ZCode client for this plan: ${missing.join(", ")} (offered: ${[...offered].join(", ")}) — may still work; informational`
        : `configured models offered: ${target.models.join(", ")}`,
    });
  }
  return checks;
}

/** One call for doctor: never throws; a network or format problem is a SKIP. */
export async function upstreamChecks(configPath, { fetchImpl = fetch, env = process.env, timeoutMs = TIMEOUT_MS } = {}) {
  const target = readProxyTarget(configPath);
  try {
    const origin = resolveUpstreamOrigin(env);
    const upstream = await fetchUpstreamProviders({ appVersion: target.appVersion, origin, fetchImpl, timeoutMs });
    const checks = compareUpstream(target, upstream);
    // Older app versions get a provider list without the plan gateways; the
    // current client's view is what the vendor actually routes, so compare
    // against it as well when the configured version says nothing.
    const covered = Boolean(KIT_GATEWAY_BASES[target.plan]?.[target.provider]);
    if (covered && checks.length === 1 && checks[0].ok === null && upstream.shape === "legacy" && target.appVersion !== REFERENCE_APP_VERSION) {
      const current = await fetchUpstreamProviders({ appVersion: REFERENCE_APP_VERSION, origin, fetchImpl, timeoutMs });
      return compareUpstream({ ...target, appVersion: REFERENCE_APP_VERSION }, current).map((c) => ({ ...c, detail: `${c.detail} (as served to app ${REFERENCE_APP_VERSION}; the kit announces ${target.appVersion})` }));
    }
    return checks;
  } catch (err) {
    return [{ name: "upstream gateway", ok: null, detail: `upstream config unreachable or unreadable (${String(err?.message ?? err).slice(0, 160)}) — skipped` }];
  }
}
