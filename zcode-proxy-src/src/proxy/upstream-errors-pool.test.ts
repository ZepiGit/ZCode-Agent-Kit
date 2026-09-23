import { describe, expect, it } from "bun:test";
import { AuthManager } from "../auth/manager.js";
import { createAccountRotator } from "../auth/account-rotator.js";
import type { AccountHandle } from "../auth/account-rotator.js";
import { recoverAndMapUpstream } from "./upstream-errors.js";
import { brotliCompressSync } from "node:zlib";

const first = { apiKey: "pool-one", provider: "zai" as const };
const second = { apiKey: "pool-two", provider: "zai" as const };

function poolAuth(): AuthManager {
  return new AuthManager({ accountRotator: createAccountRotator([
    { id: "one", credential: first },
    { id: "two", credential: second },
  ]) });
}

async function run(response: Response, code: string | undefined = undefined): Promise<{ response: Response; calls: number }> {
  const auth = poolAuth();
  let calls = 0;
  const result = await recoverAndMapUpstream({
    response,
    auth,
    credential: first,
    plan: "coding-plan",
    signal: new AbortController().signal,
    resend: async (credential) => {
      calls++;
      expect(credential.apiKey).toBe("pool-two");
      return Response.json({ ok: true });
    },
  });
  return { response: result, calls };
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
  for (const code of [1005, 1113, 3001]) {
    it(`rotates once for explicit quota code ${code}, including HTTP 200 envelopes`, async () => {
      const { response, calls } = await run(Response.json({ code, msg: "redacted upstream text" }, { status: 200 }));
      expect(calls).toBe(1);
      expect(response.status).toBe(200);
    });
  }

  it("does not rotate 401/3012, streams, or retry a second quota failure", async () => {
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
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth, credential: first,
      plan: "coding-plan", signal: new AbortController().signal,
      resend: async () => { calls++; return Response.json({ code: 1005 }, { status: 400 }); },
    });
    expect(calls).toBe(1);
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

  it("rejects a late response carrying an older handle generation", async () => {
    const rotator = createAccountRotator([
      { id: "one", credential: first },
      { id: "two", credential: second },
    ]);
    const auth = new AuthManager({ accountRotator: rotator });
    const handle = rotator.getCredentialHandle();
    auth.markCredentialExhausted(handle, "1005", Date.now() + 60_000);
    let calls = 0;
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth,
      credential: handle.credential, handle, plan: "coding-plan",
      signal: new AbortController().signal,
      resend: async () => { calls++; return Response.json({ ok: true }); },
    });
    expect(calls).toBe(0);
    expect(result.status).toBe(400);
  });

  it("uses handle context for resend and never reverse maps duplicate credentials", async () => {
    const rotator = createAccountRotator([
      { id: "alias-a", credential: first },
      { id: "alias-b", credential: first },
      { id: "independent", credential: second },
    ]);
    const auth = new AuthManager({ accountRotator: rotator });
    const handle = rotator.getCredentialHandle();
    let selected: AccountHandle | undefined;
    const result = await recoverAndMapUpstream({
      response: Response.json({ code: 1005 }, { status: 400 }), auth,
      credential: handle.credential, handle, plan: "coding-plan",
      signal: new AbortController().signal,
      resend: async () => { throw new Error("bare resend must not be used"); },
      resendHandle: async (next) => { selected = next; return Response.json({ ok: true }); },
    });
    expect(result.status).toBe(200);
    expect(selected?.id).toBe("independent");
  });
});
