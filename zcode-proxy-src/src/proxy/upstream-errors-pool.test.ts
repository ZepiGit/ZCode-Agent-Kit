import { describe, expect, it } from "bun:test";
import { AuthManager } from "../auth/manager.js";
import { createAccountRotator } from "../auth/account-rotator.js";
import { recoverAndMapUpstream } from "./upstream-errors.js";

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
});
