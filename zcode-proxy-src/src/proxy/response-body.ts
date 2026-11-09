/**
 * The response-body module (ticket 61, architecture candidate 6): a streamed
 * answer is observed in the client's path, not through a `tee()`.
 *
 * Before, each SSE answer was tee()'d: a stats branch read the upstream at
 * upstream speed while the client's branch queued, without bound, whatever a
 * slow or stalled client had not read yet (Round 12 Q3: on Windows, where the
 * loopback socket takes little, that queue is the S1/stalled peak). Here the
 * observer sees each chunk as the client pulls it, so the upstream is read no
 * faster than the client drains it. Nothing is capped, shed or ended: a
 * client that resumes reading gets every byte, in order (Round 1 Q5).
 *
 * The bytes the client receives are exactly the bytes of `source`; the
 * observer only reads them. The stream record keeps the meaning of the
 * request row's fields: the first chunk's arrival, the end of the upstream
 * stream at the proxy, and the tokens of the SSE events read from it.
 */

/** What the request row and the dump summary are built from, once the stream is over. */
export interface StreamRecord {
  /** When the first chunk arrived from the upstream (0 when none did). */
  firstChunkAt: number;
  /** When the upstream stream ended, failed or was cancelled by the client. */
  endAt: number;
  /** Output tokens observed in the SSE events (0 for a compressed stream, which is not parsed). */
  tokens: number;
  /** Bytes read from the upstream (counted only with `sample`, as the dump summary needs). */
  totalBytes: number;
  /** The first 4 KiB of the stream as text (only with `sample`). */
  firstBytesSample: string;
  outcome: "done" | "error" | "cancel";
}

export interface ObserveOptions {
  /** The stream is content-encoded: its bytes are forwarded, not parsed for tokens. */
  compressed: boolean;
  /** Count bytes and keep the first 4 KiB (the dump summary). */
  sample: boolean;
  /** Called once, when the stream ends, fails or is cancelled. */
  onEnd: (record: StreamRecord) => void;
  now?: () => number;
}

const SAMPLE_BYTES = 4096;

/** Output tokens of the SSE lines in `text`, folded into `tokens` (usage totals win over counted deltas). */
function countTokens(text: string, tokens: number): number {
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j.usage?.completion_tokens) { tokens = j.usage.completion_tokens; continue; }
      if (j.usage?.output_tokens) { tokens = j.usage.output_tokens; continue; }
      // OpenAI content delta: choices[0].delta.content
      const oai = j.choices?.[0]?.delta?.content;
      if (typeof oai === "string" && oai.length > 0) { tokens++; continue; }
      // Anthropic content delta: type=content_block_delta, delta.type=text_delta
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
        const t = j.delta?.text;
        if (typeof t === "string" && t.length > 0) tokens++;
      }
    } catch {}
  }
  return tokens;
}

/**
 * `source` as the stream the client reads, observed as the client pulls it.
 * The upstream is read one chunk per client pull (high-water mark 0): a
 * client that stops reading stops the upstream reads.
 */
export function observeInClientPath(source: ReadableStream<Uint8Array>, opts: ObserveOptions): ReadableStream<Uint8Array> {
  const now = opts.now ?? Date.now;
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const sampleDecoder = new TextDecoder();
  let tokens = 0;
  let sseBuffer = "";
  let firstChunkAt = 0;
  let totalBytes = 0;
  let firstBytesSample = "";
  let ended = false;

  const end = (outcome: StreamRecord["outcome"]): void => {
    if (ended) return;
    ended = true;
    // A stream that ended normally flushes its last unterminated line; a
    // failed or cancelled one does not (as the stats branch never did).
    if (outcome === "done" && !opts.compressed && sseBuffer) tokens = countTokens(sseBuffer, tokens);
    sseBuffer = "";
    try {
      opts.onEnd({ firstChunkAt, endAt: now(), tokens, totalBytes, firstBytesSample, outcome });
    } catch {}
  };

  const observe = (value: Uint8Array): void => {
    if (firstChunkAt === 0) firstChunkAt = now();
    if (opts.sample) {
      totalBytes += value.byteLength;
      if (firstBytesSample.length < SAMPLE_BYTES) {
        firstBytesSample += sampleDecoder.decode(value.slice(0, SAMPLE_BYTES - firstBytesSample.length), { stream: true });
      }
    }
    if (!opts.compressed) {
      sseBuffer += decoder.decode(value, { stream: true });
      const idx = sseBuffer.lastIndexOf("\n");
      if (idx >= 0) {
        tokens = countTokens(sseBuffer.slice(0, idx), tokens);
        sseBuffer = sseBuffer.slice(idx + 1);
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await reader.read();
      } catch (err) {
        end("error");
        controller.error(err);
        return;
      }
      if (result.done) {
        end("done");
        controller.close();
        return;
      }
      try { observe(result.value); } catch {}
      controller.enqueue(result.value);
    },
    cancel(reason) {
      end("cancel");
      return reader.cancel(reason).catch(() => {});
    },
  }, { highWaterMark: 0 });
}
