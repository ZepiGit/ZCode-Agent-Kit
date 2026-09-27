/**
 * Terminal-event guarantee for Anthropic Messages streams that are passed
 * through natively (no translation). The gateway sometimes closes a stream
 * without `message_stop`, or the upstream read fails mid-stream. Without a
 * terminal event, Anthropic-format clients (OMP, Claude Code) see a silently
 * truncated turn; with the documented `event: error` frame they can report
 * or recover from the failure. Bytes already forwarded are never replayed
 * and no `message_stop` is ever fabricated — only one well-formed error
 * frame is appended when the stream ends without any terminal event.
 */

export const ANTHROPIC_INCOMPLETE_EVENT =
  'event: error\ndata: {"type":"error","error":{"type":"upstream_incomplete","message":"Upstream stream ended before message_stop"}}\n\n';
export const ANTHROPIC_STREAM_ERROR_EVENT =
  'event: error\ndata: {"type":"error","error":{"type":"upstream_stream_error","message":"Upstream stream failed before completion"}}\n\n';

const TERMINAL_EVENT_LINE = /^event:[ \t]*(message_stop|error)[ \t]*$/m;
const TAIL_KEEP = 128;

/**
 * Forward `source` unchanged and append one terminal `event: error` frame if
 * the stream ends (EOF or read failure) before a `message_stop` or `error`
 * event was seen. A client cancel is propagated to the source.
 */
export function ensureAnthropicSseTerminal(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let tail = "";
  let terminalSeen = false;
  let cancelled = false;

  const observe = (chunk: Uint8Array): void => {
    if (terminalSeen) return;
    const text = tail + decoder.decode(chunk, { stream: true });
    if (TERMINAL_EVENT_LINE.test(text)) terminalSeen = true;
    tail = text.length > TAIL_KEEP ? text.slice(-TAIL_KEEP) : text;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await reader.read();
      } catch {
        if (!cancelled) {
          if (!terminalSeen) controller.enqueue(encoder.encode(ANTHROPIC_STREAM_ERROR_EVENT));
          controller.close();
        }
        return;
      }
      if (result.done) {
        if (!cancelled) {
          if (!terminalSeen) controller.enqueue(encoder.encode(ANTHROPIC_INCOMPLETE_EVENT));
          controller.close();
        }
        return;
      }
      observe(result.value);
      controller.enqueue(result.value);
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
  });
}
