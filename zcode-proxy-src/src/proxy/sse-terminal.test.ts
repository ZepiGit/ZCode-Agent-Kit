/**
 * Terminal-event guarantee for natively passed-through Anthropic streams:
 * complete frames are forwarded byte-exactly, an unfinished last frame is
 * dropped, and exactly one `event: error` frame is appended when the upstream
 * ends without message_stop (or the read fails) — never a fabricated
 * message_stop, never a second terminal event.
 */
import { describe, it, expect } from "bun:test";
import {
  ANTHROPIC_INCOMPLETE_EVENT, ANTHROPIC_STREAM_ERROR_EVENT, MAX_PENDING_FRAME_BYTES, ensureAnthropicSseTerminal, lastFrameEnd,
} from "./sse-terminal.js";

const encoder = new TextEncoder();
const START = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';
const DELTA = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n';
const STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
const UPSTREAM_ERROR = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
const CUT = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel';
const crlf = (s: string): string => s.replace(/\n/g, "\r\n");

function streamOf(chunks: Array<string | Uint8Array>, opts: { failAfter?: boolean; onCancel?: () => void } = {}): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        return;
      }
      if (opts.failAfter) controller.error(new Error("upstream socket reset"));
      else controller.close();
    },
    cancel() { opts.onCancel?.(); },
  });
}

async function collectBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(parts);
    parts.push(value);
  }
}
async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new TextDecoder().decode(await collectBytes(stream));
}
/** Every frame of `text` is an event line plus one JSON data line. */
function expectParseableFrames(text: string): void {
  for (const frame of text.split("\n\n").filter(Boolean)) {
    const [eventLine, dataLine, ...rest] = frame.split("\n");
    expect(rest).toEqual([]);
    expect(eventLine.startsWith("event: ")).toBe(true);
    expect(() => JSON.parse(dataLine.replace(/^data: /, ""))).not.toThrow();
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

  it("drops an unfinished last frame so the error frame stays parseable (mid-frame cut)", async () => {
    const text = await collect(ensureAnthropicSseTerminal(streamOf([START, DELTA, CUT])));
    expect(text).toBe(START + DELTA + ANTHROPIC_INCOMPLETE_EVENT);
    expectParseableFrames(text);
    const failed = await collect(ensureAnthropicSseTerminal(streamOf([START, CUT], { failAfter: true })));
    expect(failed).toBe(START + ANTHROPIC_STREAM_ERROR_EVENT);
    expectParseableFrames(failed);
  });

  it("a message_stop line whose frame never completed is not a terminal event", async () => {
    expect(await collect(ensureAnthropicSseTerminal(streamOf([START, "event: message_stop\n"])))).toBe(START + ANTHROPIC_INCOMPLETE_EVENT);
    expect(await collect(ensureAnthropicSseTerminal(streamOf([START, 'event: message_stop\ndata: {"type":"message_stop"}\n'])))).toBe(START + ANTHROPIC_INCOMPLETE_EVENT);
  });

  it("forwards frames byte-exactly even when chunks split a frame or a multi-byte character", async () => {
    const delta = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Héllo"}}\n\n';
    const bytes = encoder.encode(START + delta + STOP);
    const cut = START.length + delta.indexOf("é") + 1; // between the two bytes of é
    const chunks = [bytes.subarray(0, 5), bytes.subarray(5, cut), bytes.subarray(cut, cut + 7), bytes.subarray(cut + 7)];
    const out = await collectBytes(ensureAnthropicSseTerminal(streamOf(chunks)));
    expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
  });

  it("recognises CRLF frames: no second terminal frame, none after a CRLF message_stop, one after a CRLF cut", async () => {
    expect(await collect(ensureAnthropicSseTerminal(streamOf([crlf(START), crlf(STOP)])))).toBe(crlf(START) + crlf(STOP));
    expect(await collect(ensureAnthropicSseTerminal(streamOf([crlf(START), crlf(UPSTREAM_ERROR)])))).toBe(crlf(START) + crlf(UPSTREAM_ERROR));
    expect(await collect(ensureAnthropicSseTerminal(streamOf([crlf(START), crlf(DELTA), crlf(CUT)])))).toBe(crlf(START) + crlf(DELTA) + ANTHROPIC_INCOMPLETE_EVENT);
  });

  it("lastFrameEnd finds the last blank line for LF, CRLF and CR endings and leaves a trailing CR pending", () => {
    const at = (s: string): number => lastFrameEnd(encoder.encode(s));
    expect(at("a\n\nb")).toBe(3);
    expect(at("a\r\n\r\nb\r\n")).toBe(5);
    expect(at("a\n\r\n")).toBe(4);
    expect(at("a\r\rb")).toBe(3);
    expect(at("a\nb\n")).toBe(0);
    expect(at("a\n\r")).toBe(0);
    expect(at("x\n\ny\n\nz")).toBe(6);
    expect(at("")).toBe(0);
  });

  it("forwards an oversized unframed chunk and still closes it before the error frame", async () => {
    const big = "x".repeat(MAX_PENDING_FRAME_BYTES + 1);
    const text = await collect(ensureAnthropicSseTerminal(streamOf([START, big])));
    expect(text).toBe(START + big + "\n\n" + ANTHROPIC_INCOMPLETE_EVENT);
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

  it("the error frames are valid Anthropic error events of the standard api_error type", () => {
    for (const [frame, cause] of [[ANTHROPIC_INCOMPLETE_EVENT, "upstream_incomplete"], [ANTHROPIC_STREAM_ERROR_EVENT, "upstream_stream_error"]]) {
      const [eventLine, dataLine] = frame.trim().split("\n");
      expect(eventLine).toBe("event: error");
      const data = JSON.parse(dataLine.replace(/^data: /, ""));
      expect(data.type).toBe("error");
      expect(data.error.type).toBe("api_error");
      expect(data.error.message).toContain(cause);
    }
  });
});
