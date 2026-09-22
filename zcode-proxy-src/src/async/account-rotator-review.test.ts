import { describe, expect, it } from "bun:test";
import { runAsyncBridge } from "./bridge.js";
import type { OffPeakClient } from "./client.js";
import type { OffPeakCredentials, TakeTicketResult, TicketState } from "./types.js";
import type { ProxyIdentity } from "../config/types.js";

const credentials: OffPeakCredentials = { jwt: "review-jwt", codingPlanApiKey: "review-api-key" };
const identity: ProxyIdentity = { appVersion: "review", sourceTitle: "test", refererOrigin: "https://fixture.invalid" };

function bridgeClient(states: TicketState[]): OffPeakClient & { settles: string[]; takes: string[] } {
  const settles: string[] = [];
  const takes: string[] = [];
  let poll = 0;
  return {
    settles,
    takes,
    async getAvailability() { return { canTakeNumber: true }; },
    async takeTicket(taskId: string): Promise<TakeTicketResult> {
      takes.push(taskId);
      return { ticketId: `review-retake-${takes.length}`, state: "queued", registeredAt: Date.now() };
    },
    async batchStatus(ticketIds: string[]) {
      const state = states[Math.min(poll++, states.length - 1)] ?? "expired";
      return { tickets: [{ ticketId: ticketIds[0], state }] };
    },
    async settle(ticketId: string) { settles.push(ticketId); },
  };
}

function readyResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

describe("account rotator async lifecycle regressions", () => {
  it("stops queue retries after client abort and settles the current ticket once", async () => {
    const client = bridgeClient(["queued"]);
    const controller = new AbortController();
    const { stream, outcome } = runAsyncBridge({
      client,
      credentials,
      origin: "https://fixture.invalid",
      identity,
      llmRequestBody: "{}",
      initialTicket: { ticketId: "review-initial", state: "queued", registeredAt: Date.now() },
      taskId: "review-task",
      pollIntervalMs: 100,
      keepAliveIntervalMs: 10,
      maxRetries: 5,
      maxWaitMs: 0,
      clientSignal: controller.signal,
      fetchImpl: async () => readyResponse("event: message_stop\ndata: {}\n\n"),
    });
    setTimeout(() => controller.abort(), 15);
    await drain(stream);
    const result = await outcome;
    expect(result.terminalPhase).toBe("abort");
    expect(client.takes).toEqual([]);
    expect(client.settles).toEqual(["review-initial"]);
  });

  it("does not replay a request after an SSE response has started", async () => {
    const client = bridgeClient(["ready"]);
    let upstreamCalls = 0;
    const { stream, outcome } = runAsyncBridge({
      client,
      credentials,
      origin: "https://fixture.invalid",
      identity,
      llmRequestBody: "{}",
      initialTicket: { ticketId: "review-ready", state: "ready", registeredAt: Date.now() },
      taskId: "review-task",
      pollIntervalMs: 10,
      keepAliveIntervalMs: 10,
      maxRetries: 3,
      maxWaitMs: 0,
      fetchImpl: async () => {
        upstreamCalls++;
        return readyResponse("event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n");
      },
    });
    const output = await drain(stream);
    const result = await outcome;
    expect(output).toContain("message_start");
    expect(upstreamCalls).toBe(1);
    expect(result.terminalPhase).toBe("done");
  });

  it("enforces one retake across the total retry budget", async () => {
    const client = bridgeClient(["expired", "expired"]);
    const { stream, outcome } = runAsyncBridge({
      client,
      credentials,
      origin: "https://fixture.invalid",
      identity,
      llmRequestBody: "{}",
      initialTicket: { ticketId: "review-expired", state: "queued", registeredAt: Date.now() },
      taskId: "review-task",
      pollIntervalMs: 1,
      keepAliveIntervalMs: 1,
      maxRetries: 1,
      maxWaitMs: 0,
      fetchImpl: async () => readyResponse("event: message_stop\ndata: {}\n\n"),
    });
    const output = await drain(stream);
    const result = await outcome;
    expect(output).toContain("event: error");
    expect(client.takes).toEqual(["review-task"]);
    expect(client.settles).toEqual(["review-expired", "review-retake-1"]);
    expect(result.attempts).toBe(2);
  });
});
