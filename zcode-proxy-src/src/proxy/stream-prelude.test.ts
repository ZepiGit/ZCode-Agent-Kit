/**
 * Stream prelude gate: a 200 event stream is read up to the first content
 * event; an early transient error or end is reported as retryable, a content
 * event hands on the held prelude plus the untouched rest byte-exactly, and
 * every bound (time, size, undecodable coding) falls back to passthrough.
 */
import { describe, it, expect } from "bun:test";
import { gzipSync } from "node:zlib";
import { classifyStreamError, gateStreamPrelude, isGatedStream, MAX_PRELUDE_BYTES } from "./stream-prelude.js";

const enc = new TextEncoder();
const START = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';
const PING = 'event: ping\ndata: {"type":"ping"}\n\n';
const BLOCK = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
const DELTA = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n';
const STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
const OVERLOADED = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
const INVALID = 'event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"bad request"}}\n\n';
const QUOTA = 'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"[1005] exceed quota limit"}}\n\n';
const GATEWAY_1302 = 'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"[1302] rate limited"}}\n\n';

function sse(chunks: Array<string | Uint8Array>, opts: { failAfter?: boolean; hang?: boolean; onCancel?: () => void; headers?: Record<string, string>; status?: number } = {}): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk);
        return;
      }
      if (opts.hang) return new Promise<void>(() => {});
      if (opts.failAfter) controller.error(new Error("upstream socket reset"));
      else controller.close();
    },
    cancel() { opts.onCancel?.(); },
  });
  return new Response(body, { status: opts.status ?? 200, headers: { "content-type": "text/event-stream", ...(opts.headers ?? {}) } });
}

describe("gateStreamPrelude", () => {
  it("hands on a stream whose first content event arrived, byte-exactly and without retry", async () => {
    const verdict = await gateStreamPrelude(sse([START, PING, BLOCK, DELTA, STOP]));
    expect(verdict.kind).toBe("content");
    expect(verdict.retryable).toBe(false);
    expect(verdict.reason).toContain("content_block_start");
    expect(await verdict.response.text()).toBe(START + PING + BLOCK + DELTA + STOP);
    expect(verdict.response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("is chunk-boundary agnostic (frames split across reads, several frames in one read)", async () => {
    const whole = START + PING + BLOCK + DELTA + STOP;
    const bytes = enc.encode(whole);
    const chunks = [bytes.subarray(0, 7), bytes.subarray(7, START.length + 3), bytes.subarray(START.length + 3)];
    const verdict = await gateStreamPrelude(sse(chunks));
    expect(verdict.kind).toBe("content");
    expect(await verdict.response.text()).toBe(whole);
  });

  it("reports a transient error event in the prelude as retryable and keeps the stream intact for the surfaced case", async () => {
    const verdict = await gateStreamPrelude(sse([START, OVERLOADED]));
    expect(verdict.kind).toBe("error");
    expect(verdict.retryable).toBe(true);
    expect(verdict.reason).toContain("overloaded_error");
    expect(await verdict.response.text()).toBe(START + OVERLOADED);
  });

  it("never retries a terminal verdict (request error, quota code) and retries a retryable gateway code", async () => {
    expect((await gateStreamPrelude(sse([START, INVALID]))).retryable).toBe(false);
    expect((await gateStreamPrelude(sse([START, QUOTA]))).retryable).toBe(false);
    const gateway = await gateStreamPrelude(sse([START, GATEWAY_1302]));
    expect(gateway.retryable).toBe(true);
    expect(gateway.reason).toContain("1302");
  });

  it("decides at the first content event: an error after it is the client's to see, never a retry", async () => {
    const verdict = await gateStreamPrelude(sse([START, BLOCK, OVERLOADED]));
    expect(verdict.kind).toBe("content");
    expect(verdict.retryable).toBe(false);
    expect(await verdict.response.text()).toBe(START + BLOCK + OVERLOADED);
  });

  it("reports an end or a read failure inside the prelude as a retryable drop", async () => {
    const ended = await gateStreamPrelude(sse([START]));
    expect(ended.kind).toBe("eof");
    expect(ended.retryable).toBe(true);
    expect(await ended.response.text()).toBe(START);
    const failed = await gateStreamPrelude(sse([START, PING], { failAfter: true }));
    expect(failed.kind).toBe("eof");
    expect(failed.retryable).toBe(true);
    await expect(failed.response.text()).rejects.toThrow(/reset/); // the failure is re-raised for the terminal-frame monitor
  });

  it("passes through when the prelude is undecided within the time limit, without losing the in-flight read", async () => {
    let cancelled = false;
    const verdict = await gateStreamPrelude(sse([START], { hang: true, onCancel: () => { cancelled = true; } }), { timeoutMs: 20 });
    expect(verdict.kind).toBe("passthrough");
    expect(verdict.retryable).toBe(false);
    const reader = verdict.response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(START);
    await reader.cancel("client left");
    expect(cancelled).toBe(true);
  });

  it("cancelling the verdict's response cancels the upstream source (the retry path)", async () => {
    let cancelled = false;
    const verdict = await gateStreamPrelude(sse([START, OVERLOADED, PING], { hang: true, onCancel: () => { cancelled = true; } }));
    expect(verdict.retryable).toBe(true);
    await verdict.response.body!.cancel("retrying");
    expect(cancelled).toBe(true);
  });

  it("decodes a compressed stream for the decision and forwards it identity-encoded", async () => {
    const plain = START + BLOCK + DELTA + STOP;
    const verdict = await gateStreamPrelude(sse([gzipSync(Buffer.from(plain))], { headers: { "content-encoding": "gzip" } }));
    expect(verdict.kind).toBe("content");
    expect(verdict.response.headers.get("content-encoding")).toBeNull();
    expect(await verdict.response.text()).toBe(plain);
    const zipped = await gateStreamPrelude(sse([gzipSync(Buffer.from(START + OVERLOADED))], { headers: { "content-encoding": "gzip" } }));
    expect(zipped.retryable).toBe(true);
  });

  it("leaves non-stream, non-200 and undecodable responses untouched", async () => {
    const json = new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    expect((await gateStreamPrelude(json)).response).toBe(json);
    expect(isGatedStream(json)).toBe(false);
    const error = sse([START, OVERLOADED], { status: 503 });
    expect((await gateStreamPrelude(error)).response).toBe(error);
    const unknownCoding = sse([START], { headers: { "content-encoding": "zstd" } });
    const verdict = await gateStreamPrelude(unknownCoding);
    expect(verdict.kind).toBe("passthrough");
    expect(verdict.response).toBe(unknownCoding);
  });

  it("passes through an oversized prelude (a never-ending frame or too many held frames)", async () => {
    const endless = "x".repeat(MAX_PRELUDE_BYTES + 1);
    const noFrame = await gateStreamPrelude(sse([endless, "\n\n" + BLOCK]));
    expect(noFrame.kind).toBe("passthrough");
    expect(await noFrame.response.text()).toBe(endless + "\n\n" + BLOCK);
    const comments = ": keepalive " + "y".repeat(MAX_PRELUDE_BYTES) + "\n\n";
    const held = await gateStreamPrelude(sse([comments, PING, BLOCK]));
    expect(held.kind).toBe("passthrough");
    expect(await held.response.text()).toBe(comments + PING + BLOCK);
  });

  it("classifies data-only frames by their JSON type like the translators (a data-only tool start is output)", async () => {
    const dataOnlyTool = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"read","input":{}}}\n\n';
    const toolFirst = await gateStreamPrelude(sse([START, dataOnlyTool, OVERLOADED]));
    expect(toolFirst.kind).toBe("content");
    expect(toolFirst.retryable).toBe(false);
    const dataOnlyPing = 'data: {"type":"ping"}\n\n';
    const pingThenError = await gateStreamPrelude(sse([START, dataOnlyPing, OVERLOADED]));
    expect(pingThenError.retryable).toBe(true);
    const unknownData = 'data: not-json\n\n';
    expect((await gateStreamPrelude(sse([START, unknownData, OVERLOADED]))).kind).toBe("content"); // unclassifiable data counts as output
  });

  it("reads an already inflated body as it is when the transport says so (stale content-encoding)", async () => {
    const plain = START + BLOCK + DELTA + STOP;
    const verdict = await gateStreamPrelude(sse([plain], { headers: { "content-encoding": "gzip" } }), { decoded: true });
    expect(verdict.kind).toBe("content");
    expect(await verdict.response.text()).toBe(plain);
    expect(verdict.response.headers.get("content-encoding")).toBe("gzip"); // headers handed on unchanged
  });

  it("the size bound covers held frames and a partial frame together, before any classification", async () => {
    const comment = ": pad " + "c".repeat(200 * 1024) + "\n\n";
    const partial = "event: content_block_delta\ndata: " + "p".repeat(100 * 1024);
    const verdict = await gateStreamPrelude(sse([comment, partial]));
    expect(verdict.kind).toBe("passthrough");
    expect(verdict.retryable).toBe(false);
  });

  it("a client abort during the prelude cancels the upstream at once and is never retryable", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const promise = gateStreamPrelude(sse([START], { hang: true, onCancel: () => { cancelled = true; } }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const verdict = await promise;
    expect(verdict.retryable).toBe(false);
    expect(verdict.reason).toContain("aborted");
    expect(cancelled).toBe(true);
  });

  it("splits frames with mixed line endings exactly like the frame-end scanner (no swallowed content frame)", async () => {
    const mixed = 'event: ping\ndata: {"type":"ping"}\n\r\nevent: content_block_start\r\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n';
    const verdict = await gateStreamPrelude(sse([START, mixed, OVERLOADED]));
    expect(verdict.kind).toBe("content");
    expect(await verdict.response.text()).toBe(START + mixed + OVERLOADED);
  });

  it("a body that cannot be decoded is handed on, never retried (deterministic, not a network failure)", async () => {
    const verdict = await gateStreamPrelude(sse(["not gzip at all"], { headers: { "content-encoding": "gzip" } }));
    expect(verdict.retryable).toBe(false);
    expect(verdict.reason).toContain("decoded");
  });

  it("understands CRLF frames", async () => {
    const crlf = (s: string): string => s.replace(/\n/g, "\r\n");
    const verdict = await gateStreamPrelude(sse([crlf(START), crlf(OVERLOADED)]));
    expect(verdict.kind).toBe("error");
    expect(verdict.retryable).toBe(true);
    expect(await verdict.response.text()).toBe(crlf(START) + crlf(OVERLOADED));
  });
});

describe("classifyStreamError", () => {
  it("retries the official client's transient classes and refuses terminal ones", () => {
    expect(classifyStreamError('{"type":"error","error":{"type":"overloaded_error","message":"x"}}').retryable).toBe(true);
    expect(classifyStreamError('{"type":"error","error":{"type":"rate_limit_error","message":"x"}}').retryable).toBe(true);
    expect(classifyStreamError('{"type":"error","error":{"type":"api_error","message":"internal"}}').retryable).toBe(true);
    expect(classifyStreamError('{"type":"error","error":{"type":"authentication_error","message":"x"}}').retryable).toBe(false);
    expect(classifyStreamError('{"type":"error","error":{"type":"permission_error","message":"x"}}').retryable).toBe(false);
    expect(classifyStreamError('{"type":"error","error":{"type":"api_error","message":"[3007] captcha verify failed"}}').retryable).toBe(false);
    expect(classifyStreamError('{"code":1303,"msg":"busy"}').retryable).toBe(true);
    expect(classifyStreamError('{"error":{"code":3007}}').retryable).toBe(false);
    expect(classifyStreamError('{"type":"error","error":{"type":"something_new","message":"?"}}').retryable).toBe(false);
    expect(classifyStreamError("not json").retryable).toBe(false);
  });
});
