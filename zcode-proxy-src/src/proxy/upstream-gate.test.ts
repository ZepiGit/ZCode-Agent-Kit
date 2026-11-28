/**
 * Upstream concurrency gate: at most N model requests may be in flight at the
 * upstream at once. The gateway counts parallel lanes per account and rejects
 * the overflow, so the proxy caps its own sends instead of discovering the
 * limit through errors.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { createUpstreamGate, resetUpstreamGate } from "./upstream-gate.js";

afterEach(() => resetUpstreamGate());

describe("createUpstreamGate", () => {
  it("admits up to the cap and queues the rest", async () => {
    const gate = createUpstreamGate(2);
    const a = await gate.acquire();
    const b = await gate.acquire();
    expect(gate.stats()).toEqual({ limit: 2, active: 2, queued: 0, peak: 2 });

    let thirdAdmitted = false;
    const c = gate.acquire().then((release) => { thirdAdmitted = true; return release; });
    await Bun.sleep(10);
    expect(thirdAdmitted).toBe(false); // the third waits for a slot
    expect(gate.stats()).toEqual({ limit: 2, active: 2, queued: 1, peak: 2 });

    a();
    const releaseC = await c;
    expect(thirdAdmitted).toBe(true);
    expect(gate.stats().active).toBe(2);
    b(); releaseC();
    expect(gate.stats().active).toBe(0);
  });

  it("releases once per acquire, even when a release is called twice", async () => {
    const gate = createUpstreamGate(1);
    const release = await gate.acquire();
    release();
    release();
    expect(gate.stats().active).toBe(0);
    const next = await gate.acquire();
    next();
    expect(gate.stats().active).toBe(0);
  });

  it("treats 0 as unlimited", async () => {
    const gate = createUpstreamGate(0);
    for (let i = 0; i < 20; i++) await gate.acquire();
    expect(gate.stats().limit).toBe(0);
    expect(gate.stats().active).toBe(20);
  });

  it("a queued acquire leaves the queue when its signal aborts", async () => {
    const gate = createUpstreamGate(1);
    await gate.acquire();
    const controller = new AbortController();
    const queued = gate.acquire(controller.signal);
    await Bun.sleep(5);
    expect(gate.stats().queued).toBe(1);
    controller.abort();
    await expect(queued).rejects.toThrow(/aborted/);
    expect(gate.stats().queued).toBe(0);
  });
});

describe("upstream dispatch under the gate", () => {
  it("holds the slot until the response body is consumed", async () => {
    const gate = createUpstreamGate(1);
    const release = await gate.acquire();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });
    const resp = gate.holdUntilBodyEnds(new Response(body, { headers: { "content-type": "text/plain" } }), release);
    expect(gate.stats().active).toBe(1); // still held before the body is read
    expect(await resp.text()).toBe("hello");
    expect(gate.stats().active).toBe(0); // released at the end of the body
  });

  it("releases the slot when the client cancels the body", async () => {
    const gate = createUpstreamGate(1);
    const release = await gate.acquire();
    const body = new ReadableStream<Uint8Array>({ start() {} }); // never produces
    const resp = gate.holdUntilBodyEnds(new Response(body), release);
    await resp.body!.cancel();
    expect(gate.stats().active).toBe(0);
  });

  it("releases at once for a body-less response", async () => {
    const gate = createUpstreamGate(1);
    const release = await gate.acquire();
    const resp = gate.holdUntilBodyEnds(new Response(null, { status: 204 }), release);
    expect(resp.status).toBe(204);
    expect(gate.stats().active).toBe(0);
  });
});
