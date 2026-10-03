/**
 * Pre-output transient retry ladder (dispatchWithConnectRetry): which
 * failures are re-dispatched before any byte reaches the client, which are
 * handed to the recovery layers untouched, and the bounds (attempts,
 * Retry-After cap, client abort).
 */
import { describe, it, expect } from "bun:test";
import {
  dispatchWithConnectRetry, MAX_TRANSIENT_ATTEMPTS, TRANSIENT_RETRY_AFTER_CAP_MS, retryAfterMs, transientErrorKind, transientRetryPolicy,
} from "./handler.js";
import { CAPTCHA_CHALLENGE_HEADER } from "./captcha-retry.js";

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

  it("never retries a terminal gateway verdict, whatever the HTTP status", async () => {
    for (const [status, body] of [
      [500, { code: 1005, msg: "exceed quota limit" }],
      [503, { code: 3007, msg: "captcha verify failed" }],
      [502, { code: 3001, msg: "rejected" }],
      [429, { code: 1113, msg: "Insufficient balance" }],
      [529, { code: 3006, msg: "model not allowed" }],
      [200, { code: 1005, msg: "exceed quota limit" }],
      [503, { type: "error", error: { type: "invalid_request_error", message: "[1210] thinking" } }],
    ] as const) {
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => { calls += 1; return json(status, body); }, { retryDelayMs: 0 });
      expect(calls).toBe(1);
      expect(resp.status).toBe(status);
      expect(JSON.stringify(await resp.json())).toBe(JSON.stringify(body)); // the body was inspected without being consumed
    }
  });

  it("retries the gateway codes the official client retries with any status; other codes follow the HTTP status", async () => {
    for (const [status, code] of [[200, 1302], [500, 1234], [429, 1305], [200, 3002], [503, 2007]] as const) {
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => { calls += 1; return calls < 2 ? json(status, { code, msg: "PRIVATE" }) : new Response("ok"); }, { retryDelayMs: 0 });
      expect(resp.status).toBe(200);
      expect(calls).toBe(2);
    }
    let calls = 0;
    const unknownOn200 = await dispatchWithConnectRetry(async () => { calls += 1; return json(200, { code: 4242, msg: "?" }); }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect((await unknownOn200.json()).code).toBe(4242);
    calls = 0;
    const unknownOn503 = await dispatchWithConnectRetry(async () => { calls += 1; return calls < 2 ? json(503, { code: 4242 }) : new Response("ok"); }, { retryDelayMs: 0 });
    expect(unknownOn503.status).toBe(200);
    expect(calls).toBe(2);
    calls = 0;
    const rateLimited = await dispatchWithConnectRetry(async () => { calls += 1; return calls < 2 ? json(429, { code: 429, msg: "rate limited" }) : new Response("ok"); }, { retryDelayMs: 0 });
    expect(rateLimited.status).toBe(200);
    expect(calls).toBe(2);
    calls = 0;
    const plain200 = await dispatchWithConnectRetry(async () => { calls += 1; return json(200, { id: "msg", type: "message", content: [] }); }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect((await plain200.json()).id).toBe("msg"); // a real message is never inspected away
  });

  it("retries official symbolic provider codes and keeps symbolic quota codes terminal", async () => {
    for (const code of ["rate_limit_error", "engine_overloaded_error"]) {
      let calls = 0;
      const resp = await dispatchWithConnectRetry(async () => {
        calls += 1;
        return calls < 2 ? json(200, { code, msg: "private" }) : new Response("ok");
      }, { retryDelayMs: 0 });
      expect(resp.status).toBe(200);
      expect(calls).toBe(2);
    }
    let calls = 0;
    const terminal = await dispatchWithConnectRetry(async () => {
      calls += 1;
      return json(429, { code: "insufficient_quota", msg: "private" });
    }, { retryDelayMs: 0 });
    expect(terminal.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("hands a captcha challenge to the captcha layer even on a transient status", async () => {
    let calls = 0;
    const resp = await dispatchWithConnectRetry(async () => { calls += 1; return html(503, { [CAPTCHA_CHALLENGE_HEADER]: "challenge" }); }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect(resp.status).toBe(503);
  });

  it("reads an HTTP-date Retry-After, treats an unparseable one as absent and surfaces a far one", async () => {
    const soon = new Date(Date.now() + 1000).toUTCString();
    const soonMs = retryAfterMs(new Response("", { headers: { "retry-after": soon } }));
    expect(soonMs).toBeGreaterThan(0);
    expect(soonMs).toBeLessThanOrEqual(1000);
    expect(retryAfterMs(new Response("", { headers: { "retry-after": new Date(Date.now() - 60_000).toUTCString() } }))).toBe(0);
    expect(retryAfterMs(new Response("", { headers: { "retry-after": "soonish" } }))).toBeNull();
    expect(retryAfterMs(new Response(""))).toBeNull();
    expect(retryAfterMs(new Response("", { headers: { "retry-after": " 3 " } }))).toBe(3000);
    let calls = 0;
    const far = new Date(Date.now() + TRANSIENT_RETRY_AFTER_CAP_MS + 60_000).toUTCString();
    const surfaced = await dispatchWithConnectRetry(async () => { calls += 1; return html(503, { "retry-after": far }); }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect(surfaced.status).toBe(503);
  });

  it("stops when the account is no longer admitted and hands back the last outcome intact", async () => {
    let calls = 0;
    const resp = await dispatchWithConnectRetry(async () => { calls += 1; return html(503); }, { retryDelayMs: 0, beforeRetry: () => false });
    expect(calls).toBe(1);
    expect(resp.status).toBe(503);
    expect(await resp.text()).toContain("edge error"); // the refused retry did not release the body
    calls = 0;
    await expect(dispatchWithConnectRetry(async () => { calls += 1; throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); }, { retryDelayMs: 0, beforeRetry: async () => false })).rejects.toThrow(/reset/);
    expect(calls).toBe(1);
    calls = 0;
    let checks = 0;
    const ok = await dispatchWithConnectRetry(async () => { calls += 1; return calls < 3 ? html(502) : new Response("ok"); }, { retryDelayMs: 0, beforeRetry: () => { checks += 1; return true; } });
    expect(ok.status).toBe(200);
    expect(calls).toBe(3);
    expect(checks).toBe(2); // once before every retry
  });

  it("a case variant of text/event-stream is still a stream", async () => {
    let calls = 0;
    await dispatchWithConnectRetry(async () => { calls += 1; return new Response("event: error\n\n", { status: 503, headers: { "content-type": "Text/Event-Stream; charset=utf-8" } }); }, { retryDelayMs: 0 });
    expect(calls).toBe(1);
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
    // postWrite (ordered transport wrote the request): a drop like on the fetch path, never a "connect"
    expect(transientErrorKind(Object.assign(new Error("x"), { code: "ECONNRESET", postWrite: true }))?.kind).toBe("drop");
    expect(transientErrorKind(Object.assign(new Error("x"), { code: "ECONNREFUSED", postWrite: true }))?.kind).toBe("drop");
    expect(transientErrorKind(Object.assign(new Error("upstream closed before sending response headers"), { postWrite: true }))?.kind).toBe("drop");
    expect(transientErrorKind(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("y"), { postWrite: true }) }))).toBeNull(); // unknown failure shape
    expect(transientErrorKind(Object.assign(new Error("cert"), { code: "CERT_HAS_EXPIRED" }))).toBeNull();
    expect(transientErrorKind(Object.assign(new Error("socket"), { code: "UND_ERR_SOCKET", cause: Object.assign(new Error("cert"), { code: "CERT_HAS_EXPIRED" }) }))).toBeNull(); // TLS anywhere in the chain wins
    expect(transientErrorKind(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBeNull();
    expect(transientErrorKind(new Error("something else"))).toBeNull();
    expect(transientErrorKind(null)).toBeNull();
  });
});
