/**
 * zcode_artifact_read returns a file's bytes as base64. That field is the
 * content the caller asked for and must come back intact, whatever it looks
 * like to the secret redaction; every other field of the answer is still
 * redacted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { startBridge } from "./client.mjs";

async function read(c, args) {
  const resp = await c.call("tools/call", { name: "zcode_artifact_read", arguments: { workspacePath: c.workspaceDir, ...args } });
  assert.equal(resp.result?.isError, undefined, JSON.stringify(resp.result?.content));
  const structured = resp.result.structuredContent;
  assert.deepEqual(JSON.parse(resp.result.content[0].text), structured, "the text block carries the same answer");
  return structured;
}

test("zcode_artifact_read returns the file's bytes intact and redacts the other fields", async () => {
  const c = await startBridge();
  try {
    // 15 bytes whose base64 is, character for character, shaped like an AWS access key id.
    const keyShaped = Buffer.from("AKIAABCDEFGHIJKLMNOP", "base64");
    assert.equal(keyShaped.toString("base64"), "AKIAABCDEFGHIJKLMNOP");
    fs.writeFileSync(path.join(c.workspaceDir, "small.bin"), keyShaped);
    const small = await read(c, { path: "small.bin" });
    assert.equal(small.contentBase64, "AKIAABCDEFGHIJKLMNOP");
    assert.deepEqual(Buffer.from(small.contentBase64, "base64"), keyShaped);

    // 4096 random bytes: one unbroken base64 run far beyond the 200 characters the redaction takes for a token.
    const binary = crypto.randomBytes(4096);
    fs.writeFileSync(path.join(c.workspaceDir, "image.bin"), binary);
    const whole = await read(c, { path: "image.bin", length: 4096 });
    assert.deepEqual(Buffer.from(whole.contentBase64, "base64"), binary);
    assert.equal(whole.bytesReturned, 4096);
    assert.equal(whole.sha256, crypto.createHash("sha256").update(binary).digest("hex"));
    assert.equal(whole.truncated, false);

    // A chunk from the middle, and text content long enough to be one run.
    const chunk = await read(c, { path: "image.bin", offset: 1000, length: 600 });
    assert.deepEqual(Buffer.from(chunk.contentBase64, "base64"), binary.subarray(1000, 1600));
    assert.equal(chunk.truncated, true);
    const text = "line of text that is long enough\n".repeat(20);
    fs.writeFileSync(path.join(c.workspaceDir, "notes.txt"), text);
    assert.equal(Buffer.from((await read(c, { path: "notes.txt" })).contentBase64, "base64").toString("utf8"), text);

    // The other fields still go through the redaction: a token-shaped file name is masked in `path`.
    const name = "sk-abcdefgh12345678.bin";
    fs.writeFileSync(path.join(c.workspaceDir, name), keyShaped);
    const named = await read(c, { path: name });
    assert.equal(named.contentBase64, "AKIAABCDEFGHIJKLMNOP");
    assert.doesNotMatch(named.path, /sk-abcdefgh12345678/);
    assert.match(named.path, /<redacted:\d+ch>/);
  } finally {
    await c.stop();
  }
});

test("the error text of a failed artifact read is still redacted", async () => {
  const c = await startBridge();
  try {
    const text = await c.expectToolError("zcode_artifact_read", { workspacePath: c.workspaceDir, path: "missing-sk-abcdefgh12345678.bin" });
    assert.doesNotMatch(text, /sk-abcdefgh12345678/);
  } finally {
    await c.stop();
  }
});
