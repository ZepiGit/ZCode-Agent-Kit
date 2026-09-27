/**
 * Pre-output transient retry ladder (dispatchWithConnectRetry): which
 * failures are re-dispatched before any byte reaches the client, which are
 * handed to the recovery layers untouched, and the bounds (attempts,
 * Retry-After cap, client abort).
 */
import { describe, it, expect } from "bun:test";
import {
  dispatchWithConnectRetry, MAX_TRANSIENT_ATTEMPTS, TRANSIENT_RETRY_AFTER_CAP_MS, transientErrorKind, transientRetryPolicy,
} from "./handler.js";

describe("ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS", () => {
  const previous = process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
  const restore = (): void => {
    if (previous === undefined) delete process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
    else process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = previous;
  };

  it("parses decimal milliseconds with a cap, 'off' restores the connect-only ladder, junk falls back", () => {
    try {
      delete process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
      expect(transientRetryPolicy()).toEqual({ unitMs: 500, extended: true });
      process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "250";
      expect(transientRetryPolicy()).toEqual({ unitMs: 250, extended: true });
      process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "99999";
      expect(transientRetryPolicy().unitMs).toBe(10_000);
      process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = " OFF ";
      expect(transientRetryPolicy().extended).toBe(false);
      process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "1e3";
      expect(transientRetryPolicy()).toEqual({ unitMs: 500, extended: true });
      expect(transientRetryPolicy(0)).toEqual({ unitMs: 0, extended: true }); // explicit seam wins
    } finally {
      restore();
    }
  });

  it("'off' retries never-connected failures only", async () => {
    try {
      process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "off";
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => { calls += 1; return new Response("x", { status: 503 }); });
      expect(resp.status).toBe(503);
      expect(calls).toBe(1);
      calls = 0;
      await expect(dispatchWithConnectRetry(async () => { calls += 1; throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); })).rejects.toThrow(/reset/);
      expect(calls).toBe(1);
      calls = 0;
      process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "0";
      const ok = await dispatchWithConnectRetry(async () => { calls += 1; if (calls === 1) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); return new Response("ok"); });
      expect(ok.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      restore();
    }
  });

  it("unit 0 skips even a short Retry-After (bounded tests, no sleeping operators)", async () => {
    let calls = 0;
    const started = Date.now();
    const resp = await dispatchWithConnectRetry(async () => {
      calls += 1;
      return calls === 1 ? new Response("later", { status: 429, headers: { "retry-after": "5" } }) : new Response("ok");
    }, { retryDelayMs: 0 });
    expect(resp.status).toBe(200);
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function html(status: number, headers: Record<string, string> = {}): Response {
  return new Response("<html><body>edge error</body></html>", { status, headers: { "content-type": "text/html", ...headers } });
}

describe("transient pre-output retry ladder", () => {
  it("retries gateway/edge statuses whose body is not a gateway business envelope", async () => {
    for (const status of [500, 502, 503, 504, 524, 529]) {
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => {
        calls += 1;
        return calls < 3 ? html(status) : new Response("ok");
      }, { retryDelayMs: 0 });
      expect(resp.status).toBe(200);
      expect(calls).toBe(3);
    }
  });

  it("returns the last response once the attempt budget is spent", async () => {
    let calls = 0;
    const resp = await dispatchWithConnectRetry(async () => { calls += 1; return html(503); }, { retryDelayMs: 0 });
    expect(calls).toBe(MAX_TRANSIENT_ATTEMPTS);
    expect(resp.status).toBe(503);
    expect(await resp.text()).toContain("edge error"); // the surfaced response is still readable
  });

  it("never retries a recognised gateway business envelope, whatever the HTTP status", async () => {
    for (const [status, body] of [
      [500, { code: 1005, msg: "exceed quota limit" }],
      [503, { code: 3007, msg: "captcha verify failed" }],
      [502, { code: 3001, msg: "rejected" }],
      [429, { code: 429, msg: "rate limited" }],
    ] as const) {
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => { calls += 1; return json(status, body); }, { retryDelayMs: 0 });
      expect(calls).toBe(1);
      expect(resp.status).toBe(status);
      expect((await resp.json()).code).toBe(body.code); // the body was inspected without being consumed
    }
  });

  it("does not retry request-level errors", async () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => { calls += 1; return json(status, { error: { type: "x", message: "y" } }); }, { retryDelayMs: 0 });
      expect(calls).toBe(1);
      expect(resp.status).toBe(status);
    }
  });

  it("honours a numeric Retry-After on 429/503 up to the cap and surfaces it above the cap", async () => {
    let calls = 0;
    const quick = await dispatchWithConnectRetry(async () => {
      calls += 1;
      return calls === 1 ? html(429, { "retry-after": "0" }) : new Response("ok");
    }, { retryDelayMs: 0 });
    expect(quick.status).toBe(200);
    expect(calls).toBe(2);

    calls = 0;
    const tooLong = String(Math.ceil(TRANSIENT_RETRY_AFTER_CAP_MS / 1000) + 1);
    const surfaced = await dispatchWithConnectRetry(async () => { calls += 1; return html(429, { "retry-after": tooLong }); }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect(surfaced.status).toBe(429);
    expect(surfaced.headers.get("retry-after")).toBe(tooLong); // the client decides
  });

  it("never inspects or retries a stream response", async () => {
    let calls = 0;
    const resp = await dispatchWithConnectRetry(async () => {
      calls += 1;
      return new Response("event: error\ndata: {}\n\n", { status: 503, headers: { "content-type": "text/event-stream" } });
    }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect(resp.status).toBe(503);
  });

  it("stops when the client aborts during the wait and never dispatches again", async () => {
    const controller = new AbortController();
    let calls = 0;
    const promise = dispatchWithConnectRetry(async () => {
      calls += 1;
      setTimeout(() => controller.abort(), 5);
      return html(503);
    }, { retryDelayMs: 200, signal: controller.signal, isAborted: () => controller.signal.aborted });
    await expect(promise).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
  });

  it("reports each retry with its reason and delay", async () => {
    const seen: Array<[number, string, number]> = [];
    let calls = 0;
    await dispatchWithConnectRetry(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      if (calls === 2) return html(502);
      return new Response("ok");
    }, { retryDelayMs: 0, onRetry: (attempt, reason, delayMs) => { seen.push([attempt, reason, delayMs]); } });
    expect(seen).toEqual([[1, "ECONNRESET", 0], [2, "HTTP 502", 0]]);
  });

  it("classifies thrown errors: connect vs drop vs never", () => {
    expect(transientErrorKind(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))?.kind).toBe("connect");
    expect(transientErrorKind(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))?.kind).toBe("drop");
    expect(transientErrorKind(new Error("socket hang up"))?.kind).toBe("drop");
    expect(transientErrorKind(Object.assign(new Error("x"), { code: "ECONNRESET", postWrite: true }))).toBeNull();
    expect(transientErrorKind(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("y"), { postWrite: true }) }))).toBeNull();
    expect(transientErrorKind(Object.assign(new Error("cert"), { code: "CERT_HAS_EXPIRED" }))).toBeNull();
    expect(transientErrorKind(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBeNull();
    expect(transientErrorKind(new Error("something else"))).toBeNull();
    expect(transientErrorKind(null)).toBeNull();
  });
});
