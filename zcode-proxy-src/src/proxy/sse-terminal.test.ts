/**
 * Terminal-event guarantee for natively passed-through Anthropic streams:
 * bytes are forwarded unchanged; exactly one `event: error` frame is appended
 * when the upstream ends without message_stop (or the read fails), never a
 * fabricated message_stop, never a second terminal event.
 */
import { describe, it, expect } from "bun:test";
import { ANTHROPIC_INCOMPLETE_EVENT, ANTHROPIC_STREAM_ERROR_EVENT, ensureAnthropicSseTerminal } from "./sse-terminal.js";

const encoder = new TextEncoder();
const START = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';
const DELTA = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n';
const STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
const UPSTREAM_ERROR = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';

function streamOf(chunks: string[], opts: { failAfter?: boolean; onCancel?: () => void } = {}): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }
      if (opts.failAfter) controller.error(new Error("upstream socket reset"));
      else controller.close();
    },
    cancel() { opts.onCancel?.(); },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

describe("ensureAnthropicSseTerminal", () => {
  it("forwards a complete stream unchanged", async () => {
    expect(await collect(ensureAnthropicSseTerminal(streamOf([START, DELTA, STOP])))).toBe(START + DELTA + STOP);
  });

  it("appends exactly one terminal error frame when the stream ends before message_stop", async () => {
    const text = await collect(ensureAnthropicSseTerminal(streamOf([START, DELTA])));
    expect(text).toBe(START + DELTA + ANTHROPIC_INCOMPLETE_EVENT);
    expect(text).not.toContain("event: message_stop"); // no fabricated stop event
  });

  it("leaves a stream that already ended with an upstream error event alone", async () => {
    expect(await collect(ensureAnthropicSseTerminal(streamOf([START, UPSTREAM_ERROR])))).toBe(START + UPSTREAM_ERROR);
  });

  it("detects a terminal event line split across chunks", async () => {
    const text = await collect(ensureAnthropicSseTerminal(streamOf([START, "event: message_", "stop\ndata: {\"type\":\"message_stop\"}\n\n"])));
    expect(text).toBe(START + STOP);
  });

  it("turns a read failure into one well-formed error frame and a clean end (no fabricated stop)", async () => {
    const text = await collect(ensureAnthropicSseTerminal(streamOf([START, DELTA], { failAfter: true })));
    expect(text).toBe(START + DELTA + ANTHROPIC_STREAM_ERROR_EVENT);
    const frames = text.trim().split("\n\n");
    expect(frames.filter((f) => f.startsWith("event: error")).length).toBe(1);
    expect(text).not.toContain("event: message_stop");
  });

  it("an empty upstream body still gets a terminal error frame", async () => {
    expect(await collect(ensureAnthropicSseTerminal(streamOf([])))).toBe(ANTHROPIC_INCOMPLETE_EVENT);
  });

  it("propagates a client cancel to the source without appending anything", async () => {
    let cancelled = false;
    const monitored = ensureAnthropicSseTerminal(streamOf([START, DELTA], { onCancel: () => { cancelled = true; } }));
    const reader = monitored.getReader();
    await reader.read();
    await reader.cancel("client went away");
    expect(cancelled).toBe(true);
  });

  it("the error frames are valid Anthropic error events", () => {
    for (const frame of [ANTHROPIC_INCOMPLETE_EVENT, ANTHROPIC_STREAM_ERROR_EVENT]) {
      const [eventLine, dataLine] = frame.trim().split("\n");
      expect(eventLine).toBe("event: error");
      const data = JSON.parse(dataLine.replace(/^data: /, ""));
      expect(data.type).toBe("error");
      expect(typeof data.error.type).toBe("string");
      expect(typeof data.error.message).toBe("string");
    }
  });
});
