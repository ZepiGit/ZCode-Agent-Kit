/**
 * Emit a single immediate keepalive frame as a `Uint8Array`.
 * Useful for flushing one frame before pausing on a long upstream call.
 */
export function keepaliveFrame(text: string = "keepalive"): Uint8Array {
  const clean = text.replace(/[\r\n]/g, " ");
  return new TextEncoder().encode(`: ${clean}\n\n`);
}
