/**
 * Offline solver backend for captcha-solver.test.ts. Loaded INSIDE the real
 * solver worker via configureCaptchaSolver({ backendModule }); the scene name
 * selects the behavior. Never touches the network.
 */
import { captchaFetch, captchaGenerationResources, solveTraceless as realSolveTraceless, syncFetchBlocking } from "../captcha-happy.js";
import { CaptchaSdkIncompatibleError, normalizeCaptchaError } from "../captcha-token.js";

let active = 0;
let retained: unknown[] = [];

const param = (label: string) => Buffer.from(JSON.stringify({
  certifyId: label, sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
})).toString("base64");

/** The generation's CDN memory tier and stall counters, as `cdn:<entries>:<bytes>:stalls:<urls>`. */
function resources(): string {
  const { cdnCache, stallCounts } = captchaGenerationResources();
  const { entries, bytes } = cdnCache.memoryUsage();
  return `cdn:${entries}:${bytes}:stalls:${stallCounts.size}`;
}

export async function solveTraceless({ scene, region, prefix }: { scene: string; region?: string; prefix?: string }): Promise<string> {
  active += 1;
  try {
    const [kind, arg] = scene.split(":");
    const concurrency = `active=${active}`;
    switch (kind) {
      case "token":
        return param(`token:${arg}:${concurrency}`);
      case "env":
        // Environment parity: what the solver generation sees of one variable.
        return param(`env:${process.env[arg!] ?? "unset"}`);
      case "env-names":
        // The names (any case) of the generation's environment matching a pattern.
        return param(`env-names:${Object.keys(process.env).filter((name) => new RegExp(arg!, "i").test(name)).sort().join(",")}`);
      case "args":
        // Solve inputs as the generation received them.
        return param(`args:${JSON.stringify({ scene, region, prefix })}`);
      case "pid":
        return param(`pid:${process.pid}`);
      case "egress": {
        // Captcha egress from inside the generation (loopback targets only):
        // the real captchaFetch over http and https, and the sync-XHR path.
        const { target, tlsPort } = JSON.parse(Buffer.from(arg!, "base64").toString()) as { target: string; tlsPort: number };
        const out: Record<string, string> = {};
        try { const r = await captchaFetch(`${target}/fetch`); out.fetch = `${r.status} ${await r.text()}`; }
        catch { out.fetch = "error"; }
        const s = syncFetchBlocking(`${target}/sync-xhr`, { method: "GET", headers: {} }, 5000);
        out.syncXhr = "error" in s ? "error" : `${s.status} ${s.body.toString()}`;
        try { const r = await captchaFetch(`https://127.0.0.1:${tlsPort}/tls`); out.tls = String(r.status); await r.body?.cancel(); }
        catch { out.tls = "error"; }
        return param(`egress:${JSON.stringify(out)}`);
      }
      case "stderr-line": {
        // A child log line, as captcha-happy writes its own (e.g. [pe-cache-evict]).
        process.stderr.write(Buffer.from(arg!, "base64"));
        return param("stderr-line:written");
      }
      case "slow":
        await Bun.sleep(Number(arg));
        return param(`token:slow:${concurrency}`);
      case "slow429":
        await Bun.sleep(Number(arg));
        throw normalizeCaptchaError({ status: 429, message: "PRIVATE_SDK_MARKER" });
      case "invalid":
        return "x".repeat(300);
      case "oversized":
        return "x".repeat(20_000);
      case "hang":
        // The sync-XHR failure mode: the thread parks and never returns.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        return "unreachable";
      case "host-throw":
        setTimeout(() => { throw new Error("fixture host fault"); }, 0);
        return await new Promise<string>(() => {});
      case "guest-throw":
        setTimeout(() => {
          const err = new TypeError("moveBy is not defined");
          err.stack = "TypeError: moveBy is not defined\n    at tE (https://g.alicdn.com/captcha-frontend/FeiLin/1.5.1/feilin008.js:1:2)";
          throw err;
        }, 0);
        await Bun.sleep(30);
        return param(`token:guest:${concurrency}`);
      case "rate-limit":
        throw normalizeCaptchaError({ status: 429, message: "PRIVATE_SDK_MARKER" });
      case "incompatible":
        throw new CaptchaSdkIncompatibleError(true, undefined);
      case "fail":
        throw new Error("captcha solve stall lastXhr=83228ms | captchaMetadata={}");
      case "cleanup":
        throw new Error("CAPTCHA DOM cleanup failed; runtime unavailable");
      case "alloc":
        retained = Array.from({ length: Number(arg) }, (_, i) => new Array(1_000_000).fill({ i }));
        return param(`token:alloc:${retained.length}`);
      case "real-dom":
        // The real happy-dom solve path, aliasing window globals onto the
        // worker's globalThis, with hermetic resources.
        return await realSolveTraceless({ scene: "fixture", timeoutMs: 2_000, stallMs: 5_000, reuseWindow: false }, {
          primeCookies: async () => [],
          documentHtml: `<!doctype html><html><body><div id="cap"></div><button id="btn"></button><script>
            window.initAliyunCaptcha = function (options) {
              options.getInstance({ startTracelessVerification: function () {
                options.success({ verifyParam: ${JSON.stringify(param("real-dom"))} });
              } });
            };</script></body></html>`,
        });
      case "cdn-fill": {
        // cdn-fill:<count>/<bytes each>: the generation's real CDN cache.
        const [count, bytes] = arg.split("/").map(Number);
        const { cdnCache } = captchaGenerationResources();
        for (let i = 0; i < count; i++) {
          cdnCache.put(`https://g.alicdn.com/captcha-frontend/dynamicJS/fill/${bytes}/${i}/pe.js`, Buffer.alloc(bytes, i % 251));
        }
        return param(resources());
      }
      case "stall-fill": {
        const { stallCounts } = captchaGenerationResources();
        for (let i = 0; i < Number(arg); i++) stallCounts.stalled(`https://g.alicdn.com/captcha-frontend/dynamicJS/stall/${i}/pe.js`);
        return param(resources());
      }
      case "stall-evict": {
        // Two stalls of a cached pe URL evict it from the generation's cache.
        const { cdnCache, stallCounts } = captchaGenerationResources();
        const url = "https://g.alicdn.com/captcha-frontend/dynamicJS/evict/pe.js";
        cdnCache.put(url, Buffer.from("var pe = 1;"));
        const before = cdnCache.get(url)?.source ?? "none";
        stallCounts.stalled(url);
        stallCounts.stalled(url);
        return param(`evict:${before}:${cdnCache.get(url)?.source ?? "none"}`);
      }
      case "resources":
        return param(resources());
      default:
        throw new Error(`unknown fixture scene ${scene}`);
    }
  } finally {
    active -= 1;
  }
}

export function lastCaptchaSdkScripts() {
  return [{ filename: "feilin008.js", sha256: "a".repeat(64) }, { filename: "https://evil/PRIVATE", sha256: "PRIVATE" }];
}
