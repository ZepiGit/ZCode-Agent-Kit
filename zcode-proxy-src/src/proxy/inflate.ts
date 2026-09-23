/**
 * Shared bounded gzip inflation for request bodies (audit CL-17).
 *
 * Two call sites used to carry byte-for-byte copies of this
 * DecompressionStream+reader+cancel loop (proxy/handler.ts and
 * async/handler.ts); fixes to one never reached the other. The callers keep
 * their own limits and error contracts — this helper only performs the
 * bounded inflation and reports the outcome.
 */

import { Duplex } from "node:stream";
import { createBrotliDecompress } from "node:zlib";

/** Decode HTTP content codings in reverse application order on Node and Bun. */
export function decodeContentStream(source: ReadableStream<Uint8Array>, encoding: string): ReadableStream<Uint8Array> {
  let stream = source;
  for (const coding of encoding.toLowerCase().split(",").map(value => value.trim()).reverse()) {
    if (coding === "identity" || coding === "") continue;
    let decoder: ReadableWritablePair<Uint8Array, Uint8Array>;
    if (coding === "br") {
      decoder = Duplex.toWeb(createBrotliDecompress()) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    } else if (coding === "gzip" || coding === "x-gzip" || coding === "deflate") {
      decoder = new DecompressionStream(coding === "x-gzip" ? "gzip" : coding) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    } else {
      throw new Error("Unsupported upstream content encoding");
    }
    stream = stream.pipeThrough(decoder);
  }
  return stream;
}

export type InflateResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too_large" }
  | { ok: false; reason: "corrupt"; detail: string };

/**
 * Inflate `bytes` as gzip, reading at most `limitBytes` of DECOMPRESSED
 * output. The stream is cancelled and the reader lock released as soon as
 * the limit trips (a small wire payload cannot expand into unbounded
 * memory), and on any decode error.
 *
 * `too_large` carries no detail by design — callers embed their own limit in
 * the user-facing message.
 */
export async function inflateWithCap(bytes: Uint8Array, limitBytes: number): Promise<InflateResult> {
  const gunzip = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(gunzip).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      parts.push(value);
    }
    return { ok: true, bytes: Buffer.concat(parts) };
  } catch (err) {
    return { ok: false, reason: "corrupt", detail: (err as Error).message };
  } finally {
    reader.releaseLock?.();
  }
}
