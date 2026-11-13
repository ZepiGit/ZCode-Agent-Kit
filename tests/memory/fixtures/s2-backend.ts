/**
 * S2 solver backend, loaded INSIDE the real solver worker via
 * configureCaptchaSolver({ backendModule }). Delegates to the shipped offline
 * fixture (src/proxy/__fixtures__/solver-backend.ts) and adds one scene that
 * approximates a vendor SDK's footprint without the network: the real
 * happy-dom solve path (captcha-happy solveTraceless) with a guest document
 * that builds a large DOM, holds a big script string, and arms guest
 * setInterval/setTimeout timers that are never cleared by the guest — the
 * pattern captcha-happy's guest-timer bookkeeping exists for.
 *
 * Measurement only: no solver behaviour is changed.
 */
import { appendFileSync } from "node:fs";
import { solveTraceless as realSolveTraceless } from "../../../zcode-proxy-src/src/proxy/captcha-happy.js";
import * as fixture from "../../../zcode-proxy-src/src/proxy/__fixtures__/solver-backend.js";

const token = (label: string) => Buffer.from(JSON.stringify({
  certifyId: label, sceneId: "fixture", isSign: true, securityToken: "fixture-".repeat(40),
})).toString("base64");

/**
 * flags: "t" guest timers, "k" a 20k-object global, "l" DOM listeners,
 * "m" the global's objects are S2KeepMarker instances (findable in heap
 * snapshots). Default "tkl".
 */
function heavyDocument(nodes: number, scriptKB: number, flags = "tkl"): string {
  const blob = "/*" + "s".repeat(scriptKB * 1024) + "*/";
  return `<!doctype html><html><body><div id="cap"></div><button id="btn"></button><script>${blob}
    (function () {
      var root = document.getElementById("cap");
      for (var i = 0; i < ${nodes}; i++) {
        var d = document.createElement("div");
        d.setAttribute("data-i", String(i));
        d.textContent = "node " + i;
        ${flags.includes("l") ? 'd.addEventListener("mousemove", function () {});' : ""}
        root.appendChild(d);
      }
      ${flags.includes("k") ? (flags.includes("m")
        ? 'function S2KeepMarker(i) { this.i = i; this.s = "k" + i; } window.__keep = new Array(20000).fill(0).map(function (_, i) { return new S2KeepMarker(i); });'
        : 'window.__keep = new Array(20000).fill(0).map(function (_, i) { return { i: i, s: "k" + i }; });') : ""}
      ${flags.includes("t") ? 'setInterval(function () { window.__tick = (window.__tick || 0) + 1; }, 2000); setTimeout(function () { window.__late = true; }, 60000);' : ""}
    })();
    window.initAliyunCaptcha = function (options) {
      options.getInstance({ startTracelessVerification: function () {
        options.success({ verifyParam: ${JSON.stringify(token("heavy-dom"))} });
      } });
    };</script></body></html>`;
}

// Worker-side heap after every solve (the host only sees process RSS).
function logHeap(kind: string): void {
  const file = process.env.S2_HEAP_LOG;
  if (!file) return;
  try {
    // S2_GC=1: full GC first, so the figure is retained heap, not lazy garbage.
    if (process.env.S2_GC === "1") Bun.gc(true);
    const { heapStats } = require("bun:jsc");
    const h = heapStats();
    solveNo += 1;
    const types = process.env.S2_GC === "1" && (solveNo === 10 || solveNo % 50 === 0)
      ? Object.entries(h.objectTypeCounts as Record<string, number>).sort((x, y) => y[1] - x[1]).slice(0, 25)
      : undefined;
    appendFileSync(file, JSON.stringify({ t: Date.now(), kind, solveNo, heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), objects: h.objectCount, ...(types ? { types } : {}) }) + "\n");
  } catch {}
}

let retained: unknown[] = [];
let solveNo = 0;

export async function solveTraceless({ scene }: { scene: string }): Promise<string> {
  const [kind, a, b, c] = scene.split(":");
  try {
    if (kind === "heavy-dom") {
      return await realSolveTraceless({ scene: "fixture", timeoutMs: 5_000, stallMs: 10_000, reuseWindow: false }, {
        primeCookies: async () => [],
        documentHtml: heavyDocument(Number(a ?? 3000), Number(b ?? 512), c ?? "tkl"),
      });
    }
    if (kind === "fat-hang") {
      // A guest that holds a large heap and then parks the thread (sync XHR).
      retained = Array.from({ length: Number(a ?? 32) }, (_, i) => new Array(1_000_000).fill({ i }));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return "unreachable";
    }
    if (kind === "retain") {
      // Guest state that survives a successful solve inside one generation.
      retained.push(...Array.from({ length: Number(a ?? 4) }, (_, i) => new Array(1_000_000).fill({ i })));
      return token(`retain:${retained.length}`);
    }
    return await fixture.solveTraceless({ scene });
  } finally {
    logHeap(kind);
  }
}

export const lastCaptchaSdkScripts = fixture.lastCaptchaSdkScripts;
