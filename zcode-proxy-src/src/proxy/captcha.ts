/**
 * Aliyun Captcha V3 front-end — config fetch + pre-solved token pool.
 *
 * Solving itself lives in captcha-happy.ts (in-process happy-dom solver,
 * production-proven, self-contained: bundled into the single-file release
 * binary — no external Node.js, no browser, no jsdom). Tokens are minted
 * into a pool (captcha-pool.ts); requests take an already-solved token
 * (sub-ms) while background refills keep the pool warm. An empty pool waits
 * for the shared serial solver.
 *
 * Fingerprint stability: the happy-dom solver's polyfill/guest-patch values
 * are deterministic and STABLE (never randomized) — Aliyun's risk engine
 * correlates fingerprint stability across requests; randomizing per-solve
 * flags it as `verifyCode: F001`. See captcha-happy.ts.
 */
import { requestCaptchaSolverRecycle, shutdownCaptchaSolver } from "./captcha-solver.js";
import { registerCaptchaRuntime } from "../runtime/health-monitor.js";
import {
  configureCaptchaPool,
  getCaptchaPoolStats,
  prefillCaptchaPool,
  takeCaptchaToken,
  startCaptchaPoolRefill,
  stopCaptchaPool,
  urgentCaptchaRefill,
  type CaptchaConfig,
} from "./captcha-pool.js";

// /health must never import this module (it would start the solver machinery
// on a plain health probe), so the module announces itself instead.
registerCaptchaRuntime({
  stats: () => {
    const s = getCaptchaPoolStats();
    return {
      ready: s.ready,
      target: s.target,
      activeSolves: s.activeSolves,
      storm: s.storm,
      mintSuccessRate10m: s.mintSuccessRate10m,
      solver: s.solver,
    };
  },
  recycle: (reason) => requestCaptchaSolverRecycle(reason),
  shutdown: () => shutdownCaptcha(),
});

const CAPTCHA_HEADER = "x-aliyun-captcha-verify-param";
const REGION_HEADER = "x-aliyun-captcha-verify-region";
const CONFIGS_API = "https://zcode.z.ai/api/v1/client/configs";

interface FetchedCaptchaConfig { enabled: boolean; prefix: string; sceneId: string; region: string; }
let cachedConfig: { value: FetchedCaptchaConfig | null; expiresAt: number } = { value: null, expiresAt: 0 };

export function detectCaptchaChallenge(resp: Response): string | null {
  const v = resp.headers.get(CAPTCHA_HEADER);
  return v && v.trim().length > 0 ? v.trim() : null;
}


async function fetchCaptchaConfig(appVersion: string): Promise<FetchedCaptchaConfig | null> {
  if (cachedConfig.value && cachedConfig.expiresAt > Date.now()) return cachedConfig.value;
  try {
    const resp = await fetch(`${CONFIGS_API}?app_version=${encodeURIComponent(appVersion)}&platform=win32-x64`);
    const json = (await resp.json()) as { data?: { configs?: { captcha?: FetchedCaptchaConfig } } };
    const cfg = json?.data?.configs?.captcha ?? null;
    cachedConfig = { value: cfg, expiresAt: Date.now() + 60000 };
    return cfg;
  } catch { return null; }
}

/**
 * Solve backend: in-process happy-dom (captcha-happy.ts) served through the
 * pre-solved token pool. Retries are handled inside the pool
 * (ZCODE_CAPTCHA_RETRIES attempts with a fresh solve per retry).
 */
export async function getCaptchaToken(appVersion: string): Promise<{ verifyParam: string; region: string }> {
  if (process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA !== '1') throw new Error('Remote CAPTCHA execution is disabled without explicit standalone operator opt-in');
  const cfg = await fetchCaptchaConfig(appVersion);
  if (!cfg || !cfg.enabled || !cfg.prefix || !cfg.sceneId) throw new Error("Captcha config unavailable");
  // Pre-solved token pool: requests take an already-minted token (sub-ms)
  // while background solves refill; an empty bank waits for a serial solve.
  const verifyParam = await takeCaptchaToken(cfg);
  return { verifyParam, region: cfg.region };
}

export function shutdownCaptcha(): void {
  try { shutdownCaptchaSolver(); } catch {}
  try { stopCaptchaPool(); } catch {}
}

/**
 * Start background pre-solving of the token pool (happy backend).
 * Warms only the idle minimum; the pool grows on demand with traffic.
 */
export async function startCaptchaPool(appVersion: string): Promise<void> {
  if (process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA !== '1') return;
  const cfg = await fetchCaptchaConfig(appVersion);
  if (!cfg || !cfg.enabled) return;
  // Use the pool's bounded defaults (warm 1, bank at most 4), or previously
  // supplied options. Only observed takes may grow the background target.
  try {
    await prefillCaptchaPool(cfg as CaptchaConfig);
  } finally {
    // A failed warmup (provider pause, storm) must still arm the refill
    // loop: it is what runs the storm probe and resumes after a pause.
    startCaptchaPoolRefill(cfg as CaptchaConfig);
  }
}

/** Request an urgent refill burst (e.g. after a challenge/retry). */
export function urgentCaptcha(): void {
  if (process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA !== '1') return;
  urgentCaptchaRefill();
}

export function captchaPoolStats(): { ready: number; target: number; activeSolves: number } {
  return getCaptchaPoolStats();
}

export function configureCaptchaSolving(opts: Parameters<typeof configureCaptchaPool>[0]): void {
  configureCaptchaPool(opts);
}

export const RETRY_HEADERS = { PARAM: CAPTCHA_HEADER, REGION: REGION_HEADER };
