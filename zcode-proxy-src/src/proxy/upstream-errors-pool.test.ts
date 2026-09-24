import { describe, expect, it } from "bun:test";
import { AuthManager } from "../auth/manager.js";
import { createAccountRotator } from "../auth/account-rotator.js";
import type { AccountHandle } from "../auth/account-rotator.js";
import { quotaRetryDelays, recoverAndMapUpstream } from "./upstream-errors.js";
import { brotliCompressSync } from "node:zlib";

const first = { apiKey: "pool-one", provider: "zai" as const };
const second = { apiKey: "pool-two", provider: "zai" as const };

function poolAuth(): AuthManager {
  return new AuthManager({ accountRotator: createAccountRotator([
    { id: "one", credential: first },
    { id: "two", credential: second },
  ]) });
}

async function run(
  response: Response,
  resendImpl?: (apiKey: string) => Response,
  seam: readonly number[] = [0],
): Promise<{ response: Response; calls: number; sent: string[]; auth: AuthManager }> {
  const auth = poolAuth();
  let calls = 0;
  const sent: string[] = [];
  const result = await recoverAndMapUpstream({
    response,
    auth,
    credential: first,
    plan: "coding-plan",
    signal: new AbortController().signal,
    quotaRetryDelaysMs: seam,
    resend: async (credential) => {
      calls++;
      sent.push(credential.apiKey);
      return resendImpl ? resendImpl(credential.apiKey) : Response.json({ ok: true });
    },
  });
  return { response: result, calls, sent, auth };
}

describe("account-pool upstream recovery", () => {
  it("surfaces Brotli-compressed rejection without rotating or declaring success", async () => {
    const { response, calls } = await run(new Response(brotliCompressSync(JSON.stringify({ code: 3007, msg: "private provider detail" })), {
      headers: { "content-type": "application/json", "content-encoding": "br" },
    }));
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain("[3007]");
    expect(body.error.message).not.toContain("private provider detail");
  });

  it("leaves 3007 captcha envelopes to the handler captcha layer without retrying", async () => {
    const { response, calls, sent, auth } = await run(
      Response.json({ code: 3007, msg: "redacted upstream text" }, { status: 403 }),
    );
    // The handler captcha-retry layer owns 3007; the quota path must not
    // duplicate it, mark the account, or memoize.
    expect(calls).toBe(0);
    expect(sent).toEqual([]);
    expect(response.status).toBe(403);
    expect(auth.listAccounts().find((a) => a.id === "one")?.state).not.toBe("exhausted");
  });
  for (const code of [1005, 1113]) {
    it(`retries the same credential on a clean ${code} envelope before rotating`, async () => {
      const { response, calls, sent, auth } = await run(Response.json({ code, msg: "redacted upstream text" }, { status: 200 }));
      expect(sent).toEqual(["pool-one"]);
      expect(calls).toBe(1);
      expect(response.status).toBe(200);
      // The user-visible point: the account keeps its remaining packages.
      expect(auth.listAccounts().find((a) => a.id === "one")?.state).not.toBe("exhausted");
    });
  }

  it("rotates once for explicit quota code 3001, including HTTP 200 envelopes", async () => {
    const { response, calls, sent } = await run(Response.json({ code: 3001, msg: "redacted upstream text" }, { status: 200 }));
    expect(sent).toEqual(["pool-two"]);
    expect(calls).toBe(1);
    expect(response.status).toBe(200);
  });

  it("falls through to rotation when the same-credential retry also reports exhaustion", async () => {
    const { response, calls, sent } = await run(
      Response.json({ code: 1005, msg: "redacted upstream text" }, { status: 200 }),
      (apiKey) => (apiKey === "pool-one"
        ? Response.json({ code: 1005, msg: "redacted upstream text" }, { status: 200 })
        : Response.json({ ok: true })),
    );
    expect(sent).toEqual(["pool-one", "pool-two"]);
    expect(calls).toBe(2);
    expect(response.status).toBe(200);
  });

  it("stops the schedule without memo when a later attempt succeeds", async () => {
    let quotaSends = 0;
    const { response, calls, sent, auth } = await run(
      Response.json({ code: 1005, msg: "redacted upstream text" }, { status: 200 }),
      (apiKey) => {
        if (apiKey === "pool-one" && quotaSends >= 2) return Response.json({ ok: true });
        quotaSends++;
        return Response.json({ code: 1005, msg: "redacted upstream text" }, { status: 200 });
      },
      [0, 0, 0],
    );
    // Two quota attempts, then the gateway falls through to the package
    // with balance. No rotation, no memo — the account stays usable.
    expect(calls).toBe(3);
    expect(sent).toEqual(["pool-one", "pool-one", "pool-one"]);
    expect(response.status).toBe(200);
    expect(auth.listAccounts().find((a) => a.id === "one")?.state).not.toBe("exhausted");
    expect(auth.canResendCredential(first)).toBe(true);
  });

  it("keeps rotation when the retry fails with a non-quota error or cannot be sent", async () => {
    for (const retryOutcome of [
      (apiKey: string) => (apiKey === "pool-one" ? Response.json({ code: 5000, msg: "x" }, { status: 500 }) : Response.json({ ok: true })),
      (apiKey: string) => (apiKey === "pool-one" ? Response.json({ code: 429 }, { status: 429 }) : Response.json({ ok: true })),
      (apiKey: string) => { if (apiKey === "pool-one") throw new Error("connect failure"); return Response.json({ ok: true }); },
    ]) {
      const { response, calls, sent } = await run(
        Response.json({ code: 1005, msg: "redacted upstream text" }, { status: 200 }),
        retryOutcome,
      );
      expect(sent).toEqual(["pool-one", "pool-two"]);
      expect(calls).toBe(2);
      expect(response.status).toBe(200);
    }
  });

  it("aborts during the retry wait without sending anything or memoizing", async () => {
    // Legacy auth (no rotator): canResendCredential reflects only the retry
    // memo, so this pins that an aborted schedule proves nothing. In pool
    // mode the pre-existing tail marks the account exhausted after a real
    // upstream 1005 — that cooldown is intentional and unchanged.
    const auth = new AuthManager({});
    const controller = new AbortController();
    let calls = 0;
    const pending = recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth, credential: first,
      plan: "coding-plan", signal: controller.signal, quotaRetryDelaysMs: [100],
      resend: async () => { calls++; return Response.json({ ok: true }); },
    });
    setTimeout(() => controller.abort(), 10);
    const result = await pending;
    expect(calls).toBe(0);
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("[1005]");
    expect(auth.canResendCredential(first)).toBe(true);
  });

  it("keeps failover for overlapping requests when a peer quarantines the account", async () => {
    const rotator = createAccountRotator([{ id: "one", credential: first }, { id: "two", credential: second }]);
    const auth = new AuthManager({ accountRotator: rotator });
    const handle = rotator.getCredentialHandle();
    const mk = () => recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth,
      credential: handle.credential, handle, plan: "coding-plan",
      signal: new AbortController().signal, quotaRetryDelaysMs: [0],
      resend: async () => { throw new Error("bare resend must not be used"); },
      resendHandle: async (next) => (next.id === "one"
        ? Response.json({ code: 1005 }, { status: 400 })
        : Response.json({ ok: true })),
    });
    // Whoever finishes first quarantines "one"; the other request's stale
    // handle must still fail over instead of dying with a hard 400.
    const [a, b] = await Promise.all([mk(), mk()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("does not memoize a retry that failed with a non-quota error (legacy)", async () => {
    const auth = new AuthManager({});
    const cred = { apiKey: "legacy-one", provider: "zai" as const };
    let calls = 0;
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth, credential: cred,
      plan: "coding-plan", signal: new AbortController().signal, quotaRetryDelaysMs: [0],
      resend: async () => { calls++; return Response.json({ code: 5000, msg: "x" }, { status: 500 }); },
    });
    expect(calls).toBe(1);
    expect(result.status).toBe(400);
    expect(auth.canResendCredential(cred)).toBe(true);
  });

  it("expires the legacy same-account retry memo at its cooldown", () => {
    // Driven through the AuthManager clock seam — no real timers needed.
    let now = 1_000_000;
    const auth = new AuthManager({ now: () => now });
    const cred = { apiKey: "legacy-two", provider: "zai" as const };
    auth.blockSameCredentialRetry(cred, now + 20);
    expect(auth.canResendCredential(cred)).toBe(false);
    now += 40;
    expect(auth.canResendCredential(cred)).toBe(true);
  });

  it("parses ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS strictly", () => {
    const previous = process.env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS;
    try {
      const withEnv = (env: string): readonly number[] => {
        process.env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS = env;
        return quotaRetryDelays();
      };
      // Invalid input falls back to the whole default schedule.
      expect(withEnv("1000,x,2000")).toEqual([1_000, 4_000, 10_000, 20_000, 30_000]);
      expect(withEnv(" ")).toEqual([1_000, 4_000, 10_000, 20_000, 30_000]);
      expect(withEnv("abc")).toEqual([1_000, 4_000, 10_000, 20_000, 30_000]);
      // "off" disables; "0" is one immediate attempt (not disabled).
      expect(withEnv("off")).toEqual([]);
      expect(withEnv("0")).toEqual([0]);
      // Tokens are clamped and capped; empty segments reject the value.
      expect(withEnv("99999999,1,2,3,4,5,6,7")).toEqual([60_000, 1, 2, 3, 4, 5]);
      // Empty segments are dropped (no silent 0ms attempts); the rest applies.
      expect(withEnv("1000,,2000")).toEqual([1_000, 2_000]);
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS;
      else process.env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS = previous;
    }
  });

  it("does not rotate 401/3012 or streams, and bounds same-account retries to the schedule", async () => {
    for (const response of [
      new Response("unauthorized", { status: 401 }),
      Response.json({ code: 3012 }, { status: 400 }),
      new Response(JSON.stringify({ code: 1005 }), { status: 400, headers: { "content-type": "text/event-stream" } }),
    ]) {
      const result = await run(response);
      expect(result.calls).toBe(0);
    }
    const auth = poolAuth();
    let calls = 0;
    const sent: string[] = [];
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth, credential: first,
      plan: "coding-plan", signal: new AbortController().signal, quotaRetryDelaysMs: [0, 0, 0],
      resend: async (credential) => { calls++; sent.push(credential.apiKey); return Response.json({ code: 1005 }, { status: 400 }); },
    });
    expect(calls).toBe(4);
    expect(sent).toEqual(["pool-one", "pool-one", "pool-one", "pool-two"]);
    expect(result.status).toBe(400);
  });

  it("keeps Anthropic 1210 non-retryable with fixed guidance and the original HTTP error status", async () => {
    for (const status of [400, 422]) {
      const { response, calls } = await run(Response.json({
        type: "error", error: { type: "invalid_request_error", message: "[1210][provider-secret][request-secret]" },
      }, { status }));
      expect(calls).toBe(0);
      expect(response.status).toBe(status);
      const body = await response.json() as { error: { type: string; message: string } };
      expect(body.error.type).toBe("invalid_request_error");
      for (const effort of ["low", "high", "max"]) expect(body.error.message).toContain(effort);
      expect(body.error.message).not.toContain("provider-secret");
      expect(body.error.message).not.toContain("request-secret");
    }
  });

  it("does not mark a streaming 200 healthy from its header alone", async () => {
    const auth = poolAuth();
    auth.markCredentialExhausted(first, "1005", Date.now() + 60_000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("event: error\ndata: {\"error\":{}}\n\n")); controller.close(); },
    });
    const result = await recoverAndMapUpstream({
      response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      auth, credential: first, plan: "coding-plan", signal: new AbortController().signal,
      resend: async () => Response.json({ ok: true }),
    });
    expect(result.status).toBe(200);
    expect(auth.listAccounts().find((a) => a.id === "one")?.state).toBe("exhausted");
  });

  it("fails over on a late response with an older handle generation without re-marking", async () => {
    const rotator = createAccountRotator([
      { id: "one", credential: first },
      { id: "two", credential: second },
    ]);
    const auth = new AuthManager({ accountRotator: rotator });
    const handle = rotator.getCredentialHandle();
    auth.markCredentialExhausted(handle, "1005", Date.now() + 60_000);
    const generationAfterMark = rotator.handleForId("one")?.quotaGeneration;
    const exhaustedUntil = auth.listAccounts().find((a) => a.id === "one")?.exhaustedUntil;
    let calls = 0;
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth,
      credential: handle.credential, handle, plan: "coding-plan",
      signal: new AbortController().signal, quotaRetryDelaysMs: [0],
      resend: async () => { calls++; return Response.json({ ok: true }); },
    });
    // The stale handle cannot open a marking failover chain, but the proven
    // exhaustion still earns the caller a selection from the other accounts.
    expect(calls).toBe(1);
    expect(result.status).toBe(200);
    expect(auth.listAccounts().find((a) => a.id === "one")?.state).toBe("exhausted");
    expect(rotator.handleForId("one")?.quotaGeneration).toBe(generationAfterMark);
    expect(auth.listAccounts().find((a) => a.id === "one")?.exhaustedUntil).toBe(exhaustedUntil);
  });

  it("uses handle context for resend and never reverse maps duplicate credentials", async () => {
    const rotator = createAccountRotator([
      { id: "alias-a", credential: first },
      { id: "alias-b", credential: first },
      { id: "independent", credential: second },
    ]);
    const auth = new AuthManager({ accountRotator: rotator });
    const handle = rotator.getCredentialHandle();
    const seen: string[] = [];
    let selected: AccountHandle | undefined;
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth,
      credential: handle.credential, handle, plan: "coding-plan",
      signal: new AbortController().signal, quotaRetryDelaysMs: [0],
      resend: async () => { throw new Error("bare resend must not be used"); },
      resendHandle: async (next) => {
        selected = next;
        seen.push(next.id);
        return seen.length === 1
          ? Response.json({ code: 1005 }, { status: 400 })
          : Response.json({ ok: true });
      },
    });
    expect(result.status).toBe(200);
    // First resend is the same-credential quota retry, the second the rotation.
    expect(seen).toEqual(["alias-a", "independent"]);
    expect(selected?.id).toBe("independent");
  });
});
