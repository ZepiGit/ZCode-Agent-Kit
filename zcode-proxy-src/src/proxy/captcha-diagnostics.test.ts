import { describe, expect, it, spyOn } from "bun:test";
import crypto from "node:crypto";
import { PropertySymbol } from "happy-dom";
import { createDom, destroyDom } from "./captcha-happy.js";
import { CaptchaSdkIncompatibleError, classifyCaptchaError, normalizeCaptchaError } from "./captcha-token.js";
import {
  beginCaptchaAttempt, captchaDiagnostics, captchaFailureSummary, captchaResourceId,
  lastCaptchaActivity, lastCaptchaPeUrl, recordCaptchaEvaluation, recordCaptchaLoad,
  recordCaptchaRequest, startCaptchaInstance,
} from "./captcha-diagnostics.js";

const URL = "https://g.alicdn.com/dynamicJS/v1/pe.123.js?token=PRIVATE_QUERY";
const hash = (body: Buffer | string) => crypto.createHash("sha256").update(body).digest("hex");
const original = Buffer.from("var original = 1;");
const entry = { body: original, sha256: hash(original), fetchedAt: 1_000, source: "network" as const };

describe("attempt provenance", () => {
  it("freezes original, loaded and evaluated identities independently of later cache bytes", () => {
    const w = {};
    const loaded = Buffer.from("var patched = 1;");
    const evaluated = "with(scope){" + loaded + "}";
    recordCaptchaLoad(w, URL, entry, loaded);
    recordCaptchaEvaluation(w, URL, evaluated, loaded.toString());
    const snapshot = captchaDiagnostics(w);
    expect(snapshot.scripts[0]).toEqual({
      filename: "pe.123.js", originalSha256: hash(original), loadedSha256: hash(loaded),
      evaluatedSha256: hash(evaluated), fetchedAt: 1_000, source: "network",
    });
    expect(Object.isFrozen(snapshot.scripts[0])).toBe(true);
    expect(Object.isFrozen(snapshot.scripts)).toBe(true);
    recordCaptchaLoad(w, URL, { ...entry, fetchedAt: 2_000, body: loaded, sha256: hash(loaded) }, loaded);
    expect(snapshot.scripts[0].fetchedAt).toBe(1_000);
    expect(captchaDiagnostics(w).loads.map((record) => record.originalSha256)).toEqual([hash(original), hash(loaded)]);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_QUERY");
  });

  it("marks compiler-generated and local code provenance unknown instead of guessing", () => {
    const w = {};
    recordCaptchaLoad(w, URL, entry, original);
    recordCaptchaEvaluation(w, URL, "var compilerWrapper = 1;");
    recordCaptchaEvaluation(w, "C:\\private\\secret.js", "var local = 1;");
    const records = captchaDiagnostics(w).evaluations;
    expect(records[0]).toMatchObject({ originalSha256: null, loadedSha256: null, fetchedAt: null, source: "unknown" });
    expect(records[1]).toMatchObject({ filename: "unknown", fetchedAt: null, source: "unknown", evaluatedSha256: hash("var local = 1;") });
    expect(captchaFailureSummary(w)).not.toContain("private");
  });

  it("attributes stalls only to this window and resets reused attempt activity", () => {
    const a = {}, b = {};
    recordCaptchaRequest(a, URL, "GET", 1_050);
    recordCaptchaRequest(b, URL, "GET", 8_000);
    expect(lastCaptchaActivity(a, 1_000)).toBe(1_050);
    recordCaptchaLoad(a, URL, entry, original);
    const completed = captchaDiagnostics(a);
    beginCaptchaAttempt(a);
    expect(lastCaptchaActivity(a, 9_000)).toBe(9_000);
    expect(captchaDiagnostics(a).requests).toEqual([]);
    expect(completed.requests[0].at).toBe(1_050);
    expect(lastCaptchaPeUrl(a)).toBe(URL);
    expect(lastCaptchaPeUrl(b)).toBeUndefined();
    expect(captchaDiagnostics(a).scripts[0].originalSha256).toBe(hash(original));
  });

  it("bounds request history without retaining arbitrary methods or identifiers", () => {
    const w = {};
    for (let at = 0; at < 300; at++) recordCaptchaRequest(w, URL, "GET", at);
    recordCaptchaRequest(w, "https://g.alicdn.com/PRIVATE_PATH.js?token=PRIVATE_QUERY", "PRIVATE_METHOD", 300);
    const snapshot = captchaDiagnostics(w);
    expect(snapshot.requests.map((r) => r.at)).toEqual(Array.from({ length: 256 }, (_, i) => i + 45));
    expect(snapshot.requests[255].method).toBe("OTHER");
    expect(captchaFailureSummary(w)).not.toContain("PRIVATE");
    expect(captchaResourceId("https://g.alicdn.com/AliyunCaptcha-PRIVATE.js")).toMatch(/^resource-[a-f0-9]{16}$/);
  });

  it("metadata failures do not replace the original evaluation error", async () => {
    const dom = await createDom("sgp", "fixture", {
      primeCookies: async () => [], documentHtml: "<!doctype html><html><body></body></html>",
    });
    const marker = "__captchaOriginalFailure";
    const error = Object.freeze(new Error("original fixture error"));
    (globalThis as any)[marker] = error;
    const hashing = spyOn(crypto, "createHash").mockImplementation(() => { throw new Error("metadata hashing failure"); });
    try {
      let caught: unknown;
      try {
        (dom.window as any)[PropertySymbol.evaluateScript](`throw globalThis.${marker};`, { filename: URL });
      } catch (failure) { caught = failure; }
      expect(caught).toBe(error);
    } finally {
      hashing.mockRestore();
      await destroyDom(dom.window);
      delete (globalThis as any)[marker];
    }
  });

  it("records bytes passed to the actual evaluation funnel without claiming retrieval", async () => {
    const dom = await createDom("sgp", "fixture", {
      primeCookies: async () => [], documentHtml: "<!doctype html><html><body></body></html>",
    });
    try {
      const value = (dom.window as any)[PropertySymbol.evaluateScript]("40 + 2", { filename: URL });
      expect(value).toBe(42);
      const records = captchaDiagnostics(dom.window).evaluations;
      const record = records[records.length - 1];
      expect(record.filename).toBe("pe.123.js");
      expect(record.source).toBe("unknown");
      expect(record.fetchedAt).toBeNull();
      expect(record.evaluatedSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally { await destroyDom(dom.window); }
  });
});

describe("callable SDK start alternatives", () => {
  it("prefers traceless verification and preserves its receiver", () => {
    const calls: string[] = [];
    const instance = {
      ready: false,
      startTracelessVerification() { this.ready = true; calls.push("traceless"); },
      show() { calls.push("show"); },
    };
    startCaptchaInstance(instance);
    expect(instance.ready).toBe(true);
    expect(calls).toEqual(["traceless"]);
  });

  it("uses callable show when the primary method is missing or noncallable", () => {
    for (const primary of [undefined, true, "not a function", null]) {
      const instance = { startTracelessVerification: primary, ready: false, show() { this.ready = true; } };
      startCaptchaInstance(instance);
      expect(instance.ready).toBe(true);
    }
  });

  it("rejects missing and noncallable methods with trusted diagnostics but no guest values", () => {
    for (const instance of [{}, { startTracelessVerification: "PRIVATE_METHOD_MARKER", show: null }]) {
      let caught: unknown;
      try { startCaptchaInstance(instance); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(CaptchaSdkIncompatibleError);
      expect(classifyCaptchaError(caught)).toBe("incompatible");
      if (!(caught instanceof CaptchaSdkIncompatibleError)) throw new Error('Expected trusted SDK incompatibility');
      const safe = normalizeCaptchaError(caught);
      expect(safe).toBe(caught);
      expect(safe.message).not.toContain("PRIVATE_METHOD_MARKER");
    }
  });

  it("does not hide a functional primary method's failure by invoking show", () => {
    const failure = new Error("SDK failure");
    let fallback = false;
    let caught: unknown;
    try { startCaptchaInstance({ startTracelessVerification() { throw failure; }, show() { fallback = true; } }); }
    catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(fallback).toBe(false);
  });
});
