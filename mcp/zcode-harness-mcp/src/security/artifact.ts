import fs from "node:fs";
import { createHash } from "node:crypto";
import { resolveInsideWorkspace } from "./allowlist.js";

export async function readArtifact(workspace: string, candidate: string, offset: number, length: number, maxBytes: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) throw new Error("invalid artifact byte range");
  const abs = resolveInsideWorkspace(workspace, candidate);
  const handle = await fs.promises.open(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("artifact is not a regular file");
    if (before.size > maxBytes) throw new Error(`ARTIFACT_TOO_LARGE: maximum ${maxBytes} bytes`);
    const verified = resolveInsideWorkspace(workspace, candidate);
    const named = await fs.promises.stat(verified);
    if (verified !== abs || named.dev !== before.dev || named.ino !== before.ino) throw new Error("artifact path changed while opening");
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024);
    const parts: Buffer[] = [];
    let position = 0;
    while (position <= maxBytes) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, maxBytes - position + 1), position);
      if (bytesRead === 0) break;
      if (position + bytesRead > maxBytes) throw new Error(`ARTIFACT_TOO_LARGE: maximum ${maxBytes} bytes`);
      hash.update(chunk.subarray(0, bytesRead));
      const from = Math.max(offset, position);
      const to = Math.min(offset + length, position + bytesRead);
      if (to > from) parts.push(Buffer.from(chunk.subarray(from - position, to - position)));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (position !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("artifact changed while reading");
    const content = Buffer.concat(parts);
    return {
      path: abs, size: before.size, offset, bytesReturned: content.length,
      sha256: hash.digest("hex"), truncated: offset + content.length < before.size,
      encoding: "base64", contentBase64: content.toString("base64"),
    };
  } finally {
    await handle.close();
  }
}
