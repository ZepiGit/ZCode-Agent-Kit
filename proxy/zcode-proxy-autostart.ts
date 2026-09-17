// OMP extension: shared startup preflight followed by cached local health.
// Quota is not polled on normal turns. Failed starts cool down for one minute;
// later requests can recover a crashed proxy without recurring retry loops.
// TEMPLATE: setup substitutes the owning installation root.
const ROOT = "__ZCODE_OM_ROOT__";
const KEY_FILE = "__ZCODE_OM_KEY_FILE__";
const HEALTH_URL = "http://127.0.0.1:__ZCODE_OM_PORT__/health";
const PREFLIGHT = ROOT + "/cli/heal.mjs";
// The preflight detaches the proxy and returns; a hard kill here could leave
// a started proxy without its manager bookkeeping (audit F-10), so the
// timeout stays well above the manager's own bounded start wait.
const START_TIMEOUT_MS = 120_000;
const HEALTH_TTL_MS = 60_000;

interface ZcodeExtensionContext {
  model?: { provider?: string };
  models?: { current?: () => { provider?: string } | undefined };
}

export default function (pi: {
  on: (event: string, handler: (event: unknown, ctx: ZcodeExtensionContext) => Promise<void> | void) => void;
}) {
  let gate: Promise<() => Promise<void>> | null = null;
  async function ensureProxy(): Promise<void> {
    if (!gate) gate = (async () => {
      const { pathToFileURL } = await import("node:url");
      const { createSessionPreflight } = await import(pathToFileURL(PREFLIGHT).href);
      const { execFile } = await import("node:child_process");
      const { readFileSync } = await import("node:fs");
      return createSessionPreflight({
        ttlMs: HEALTH_TTL_MS,
        health: async () => {
          try {
            const key = readFileSync(KEY_FILE, "utf8").trim();
            const res = await fetch(HEALTH_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(800) });
            const body = await res.json() as { status?: string; provider?: string };
            return res.ok && body.status === "ok" && body.provider === "zai";
          } catch { return false; }
        },
        run: async () => {
          // OMP execPath may be the bundled OMP binary, not a JS runtime.
          const run = (runtime: string) => new Promise<void>((resolve, reject) => {
            execFile(runtime, [PREFLIGHT], { timeout: START_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (err, _stdout, stderr) => {
              if (err) reject(err);
              else {
                if (stderr.trim()) console.error(`[zcode-autostart] ${stderr.trim()}`);
                resolve();
              }
            });
          });
          try { await run("node"); }
          catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") await run("bun");
            else throw err;
          }
        },
      });
    })();
    try { await (await gate)(); }
    catch {
      console.error("[zcode-autostart] preflight failed; run zcode-kit doctor. Listener left untouched; request will fail naturally.");
    }
  }
  pi.on("before_provider_request", async (_event, ctx) => {
    const provider = ctx?.model?.provider ?? ctx?.models?.current?.()?.provider;
    if (provider === "zcode") await ensureProxy();
  });
}
