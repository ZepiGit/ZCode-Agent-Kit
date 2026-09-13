// OMP extension: on-demand start of the local zcode-proxy when OMP first uses
// the ZCode provider (models glm-5.3 / glm-5.3-flash). Other providers are
// never touched: if the proxy cannot be started, the request proceeds and
// fails like any other provider outage.
//
// TEMPLATE — setup.mjs substitutes __ZCODE_OM_ROOT__ and __ZCODE_OM_PORT__
// with the clone's absolute path / proxy port at install time. Edit the
// template in the integration clone, then re-run setup.mjs.
const ROOT = "__ZCODE_OM_ROOT__";
const HEALTH_URL = "http://127.0.0.1:__ZCODE_OM_PORT__/health";
const KEY_FILE = ROOT + "/.proxykey";
const MANAGER = ROOT + "/proxy/zcode-proxy-manager.mjs";
const HEALTH_TTL_MS = 60_000; // skip re-checks within this window
const HEALTH_TIMEOUT_MS = 800;
const START_TIMEOUT_MS = 30_000;

interface ZcodeExtensionContext {
  model?: { provider?: string };
  models?: { current?: () => { provider?: string } | undefined };
}

export default function (pi: {
  on: (event: string, handler: (event: unknown, ctx: ZcodeExtensionContext) => Promise<void> | void) => void;
}) {
  let lastHealthyAt = 0;
  let ensurePromise: Promise<void> | null = null;

  const DEBUG = false; // probe logging to <root>/logs/ext-probe.log
  function probe(msg: string) {
    if (!DEBUG) return;
    try {
      (async () => {
        const { appendFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        const f = ROOT + "/logs/ext-probe.log";
        mkdirSync(dirname(f), { recursive: true });
        appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
      })();
    } catch {}
  }
  probe("extension loaded");

  async function isHealthy(): Promise<boolean> {
    try {
      const { readFileSync } = await import("node:fs");
      const key = readFileSync(KEY_FILE, "utf8").trim();
      // Authenticated identity check: only OUR proxy knows the local key and
      // answers with the expected identity payload.
      const res = await fetch(HEALTH_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.status !== 200) return false;
      const body = (await res.json()) as { status?: string; provider?: string };
      return body?.status === "ok" && body?.provider === "zai";
    } catch {
      return false;
    }
  }

  async function ensureProxy(): Promise<void> {
    if (Date.now() - lastHealthyAt < HEALTH_TTL_MS) return;
    if (await isHealthy()) {
      lastHealthyAt = Date.now();
      return;
    }
    if (!ensurePromise) {
      ensurePromise = (async () => {
        const { execFile } = await import("node:child_process");
        // process.execPath inside OMP is the omp binary itself — run the
        // manager with a real Node/Bun runtime from PATH instead.
        const runManager = (runtime: string) =>
          new Promise<void>((resolve, reject) => {
            execFile(
              runtime,
              [MANAGER, "start"],
              { timeout: START_TIMEOUT_MS, windowsHide: true },
              (err, stdout) => {
                if (err) reject(err);
                else {
                  console.log(`[zcode-autostart] ${String(stdout).trim().split("\n").pop() ?? ""}`);
                  resolve();
                }
              },
            );
          });
        try {
          await runManager("node");
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") await runManager("bun");
          else throw err;
        }
      })().finally(() => {
        ensurePromise = null;
      });
    }
    try {
      await ensurePromise;
      if (await isHealthy()) lastHealthyAt = Date.now();
    } catch (err) {
      console.log(`[zcode-autostart] proxy start failed: ${(err as Error).message} — request will fail naturally`);
    }
  }

  pi.on("before_provider_request", async (event, ctx) => {
    const provider = ctx?.model?.provider ?? ctx?.models?.current?.()?.provider;
    const payload = event as { payload?: { model?: string } };
    probe(`before_provider_request ctxProvider=${JSON.stringify(provider)} payloadModel=${JSON.stringify(payload?.payload?.model ?? payload?.model)}`);
    if (provider !== "zcode") return;
    await ensureProxy();
  });
}
