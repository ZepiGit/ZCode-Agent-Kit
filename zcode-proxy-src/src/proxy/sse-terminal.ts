/**
 * Terminal-event guarantee for Anthropic Messages streams that are passed
 * through natively (no translation). The gateway sometimes closes a stream
 * without `message_stop`, or the upstream read fails mid-stream. Without a
 * terminal event, Anthropic-format clients (OMP, Claude Code) see a silently
 * truncated turn; with a well-formed `event: error` frame they can report
 * the failure instead.
 *
 * Bytes are forwarded frame by frame: a complete SSE frame goes out unchanged
 * as soon as its closing blank line arrived, and an unfinished last frame
 * (the usual shape of a cut connection: `…"text":"Hel`) is dropped so that
 * the appended error frame stays parseable — a client could not have used
 * the partial frame anyway. Nothing already forwarded is ever replayed and no
 * `message_stop` is ever fabricated.
 */

/** Standard Anthropic error type; the cause is named in the message. */
export const ANTHROPIC_INCOMPLETE_EVENT =
  'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Upstream stream ended before message_stop (upstream_incomplete)"}}\n\n';
export const ANTHROPIC_STREAM_ERROR_EVENT =
  'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Upstream stream failed before completion (upstream_stream_error)"}}\n\n';

/** With the m flag `$` matches before LF and CR alike, so CRLF frames are covered. */
const TERMINAL_EVENT_LINE = /^event:[ \t]*(message_stop|error)[ \t]*\r?$/m;
/**
 * A frame that has not ended after this many bytes is forwarded unframed
 * (memory bound). The guarantee then degrades to a closing blank line before
 * the error frame; Anthropic frames are far smaller than this.
 */
export const MAX_PENDING_FRAME_BYTES = 1 << 20;
const EMPTY = new Uint8Array(0);

/**
 * End (exclusive) of the last complete SSE frame in `buf`, or 0. A frame ends
 * with an empty line; a line ends with CRLF, LF or CR. A trailing lone CR is
 * left pending because it may be the first half of a CRLF.
 */
export function lastFrameEnd(buf: Uint8Array): number {
  let end = 0;
  let lineJustEnded = false;
  for (let i = 0; i < buf.length; i += 1) {
    const b = buf[i];
    if (b === 0x0d) {
      if (i + 1 >= buf.length) break;
      if (buf[i + 1] === 0x0a) i += 1;
      if (lineJustEnded) end = i + 1;
      lineJustEnded = true;
    } else if (b === 0x0a) {
      if (lineJustEnded) end = i + 1;
      lineJustEnded = true;
    } else {
      lineJustEnded = false;
    }
  }
  return end;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Forward `source` frame by frame and append one terminal `event: error`
 * frame if the stream ends (EOF or read failure) before a `message_stop` or
 * `error` event was seen. A client cancel is propagated to the source.
 */
export function ensureAnthropicSseTerminal(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending: Uint8Array = EMPTY;
  let terminalSeen = false;
  let framed = true; // the last forwarded byte closed a frame
  let cancelled = false;

  const forward = (controller: ReadableStreamDefaultController<Uint8Array>, bytes: Uint8Array, atFrameEnd: boolean): void => {
    if (!terminalSeen && TERMINAL_EVENT_LINE.test(decoder.decode(bytes, { stream: true }))) terminalSeen = true;
    framed = atFrameEnd;
    controller.enqueue(bytes);
  };
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, frame: string): void => {
    if (cancelled) return;
    // An unfinished last frame (still in `pending`) is dropped: the client
    // could not parse it, and the error frame below must stay well-formed.
    if (!terminalSeen) controller.enqueue(encoder.encode((framed ? "" : "\n\n") + frame));
    controller.close();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } catch {
          finish(controller, ANTHROPIC_STREAM_ERROR_EVENT);
          return;
        }
        if (result.done) {
          finish(controller, ANTHROPIC_INCOMPLETE_EVENT);
          return;
        }
        pending = concat(pending, result.value);
        const end = lastFrameEnd(pending);
        if (end > 0) {
          const complete = pending.subarray(0, end);
          pending = end < pending.length ? pending.slice(end) : EMPTY;
          forward(controller, complete, true);
          return;
        }
        if (pending.length > MAX_PENDING_FRAME_BYTES) {
          const unframed = pending;
          pending = EMPTY;
          forward(controller, unframed, false);
          return;
        }
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
  });
}
