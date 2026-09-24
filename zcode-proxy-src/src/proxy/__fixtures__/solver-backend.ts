/**
 * Offline solver backend for captcha-solver.test.ts. Loaded INSIDE the real
 * solver worker via configureCaptchaSolver({ backendModule }); the scene name
 * selects the behavior. Never touches the network.
 */
import { solveTraceless as realSolveTraceless } from "../captcha-happy.js";
import { CaptchaSdkIncompatibleError, normalizeCaptchaError } from "../captcha-token.js";

let active = 0;
let retained: unknown[] = [];

const param = (label: string) => Buffer.from(JSON.stringify({
  certifyId: label, sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
})).toString("base64");

export async function solveTraceless({ scene }: { scene: string }): Promise<string> {
  active += 1;
  try {
    const [kind, arg] = scene.split(":");
    const concurrency = `active=${active}`;
    switch (kind) {
      case "token":
        return param(`token:${arg}:${concurrency}`);
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
