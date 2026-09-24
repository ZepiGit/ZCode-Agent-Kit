// OMP extension: no kit modules are imported into the long-lived host.
// Each cold/unhealthy check executes the shared preflight in a fresh native
// process, so repaired modules are picked up even when Bun caches ESM failures.
// TEMPLATE: setup pins the installation, native interpreter and safe messages.
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const ROOT = "__ZCODE_OM_ROOT__";
const KEY_FILE = "__ZCODE_OM_KEY_FILE__";
const RUNTIME = "__ZCODE_OM_RUNTIME__";
const HEALTH_URL = "http://127.0.0.1:__ZCODE_OM_PORT__/health";
const PREFLIGHT = ROOT + "/cli/heal.mjs";
const FAILURE_DETAILS: Record<string, string> = JSON.parse("__ZCODE_OM_FAILURE_DETAILS__");
const WARNINGS: Record<string, string> = JSON.parse("__ZCODE_OM_WARNINGS__");
// Above the manager's bounded wait: do not interrupt normal detached-child
// bookkeeping (audit F-10). All output is captured; -p stdout is model-only.
const START_TIMEOUT_MS = 120_000;
const HEALTH_TTL_MS = 60_000;

interface ZcodeExtensionContext {
  model?: { provider?: string };
  models?: { current?: () => { provider?: string } | undefined };
}

async function healthy(): Promise<boolean> {
  try {
    const key = readFileSync(KEY_FILE, "utf8").trim();
    if (!key) return false;
    const res = await fetch(HEALTH_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(800) });
    const body = await res.json() as { status?: string; provider?: string };
    return res.ok && body?.status === "ok" && body?.provider === "zai";
  } catch { return false; }
}

function runPreflight(): Promise<void> {
  try {
    if (!statSync(ROOT).isDirectory() || !statSync(PREFLIGHT).isFile()) throw new Error();
  } catch { return Promise.reject({ code: "installation" }); }
  const env = { ...process.env };
  if (process.platform === "win32") {
    const pathKey = Object.hasOwn(env, "PATH") ? "PATH" : Object.keys(env).find(key => key.toLowerCase() === "path");
    const path = pathKey ? env[pathKey] : undefined;
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    if (path !== undefined) env.PATH = path;
  }
  return new Promise((resolve, reject) => {
    execFile(RUNTIME, [PREFLIGHT, "--diagnostic-code"], {
      cwd: ROOT, env, timeout: START_TIMEOUT_MS, maxBuffer: 64 * 1024,
      windowsHide: true, shell: false, windowsVerbatimArguments: false,
    }, (err, _stdout, stderr) => {
      if (err) {
        const code = err.code === "ENOENT" ? "runtime-unavailable"
          : err.code === "EACCES" || err.code === "EPERM" ? "runtime-denied"
          : err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output-limit"
          : err.killed || err.code === "ETIMEDOUT" ? "timeout"
          : err.code === 3 ? "foreign" : err.code === 5 ? "key" : "startup";
        reject({ code });
        return;
      }
      // Never forward runtime errors, provider text, paths or credentials:
      // only exact fixed-vocabulary lines (a hung-proxy recovery and the
      // quota cause can both be reported by one preflight).
      for (const line of stderr.split(/\r?\n/)) {
        const cause = line.trim().match(/^\[zcode-preflight\] cause=([a-z0-9-]+)$/)?.[1];
        if (cause && Object.hasOwn(WARNINGS, cause)) console.error(`[zcode-autostart] ${cause}: ${WARNINGS[cause]}`);
      }
      resolve();
    });
  });
}

export default function (pi: {
  on: (event: string, handler: (event: unknown, ctx: ZcodeExtensionContext) => Promise<void> | void) => void;
}) {
  let pending: Promise<void> | null = null;
  let nextCheck = 0, attempted = false;
  function ensureProxy(): Promise<void> {
    if (pending) return pending;
    if (Date.now() < nextCheck) return Promise.resolve();
    pending = (async () => {
      const first = !attempted;
      attempted = true;
      try {
        if (first || !await healthy()) await runPreflight();
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        const category = typeof code === "string" && Object.hasOwn(FAILURE_DETAILS, code) ? code : "startup";
        console.error(`[zcode-autostart] ${category}: ${FAILURE_DETAILS[category]} Next zcode request after 60s may retry.`);
      }
    })().finally(() => { nextCheck = Date.now() + HEALTH_TTL_MS; pending = null; });
    return pending;
  }
  pi.on("before_provider_request", async (_event, ctx) => {
    const provider = ctx?.model?.provider ?? ctx?.models?.current?.()?.provider;
    if (provider === "zcode") await ensureProxy();
  });
}
