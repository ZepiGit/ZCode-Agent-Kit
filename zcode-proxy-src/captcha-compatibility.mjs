import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Static byte inspection only. A marker does not establish callability or
// automatic CAPTCHA compatibility. Retrieval time is supplied, never file mtime.
export function inspectCaptchaScript(bytes, fetchedAt = null) {
  if (fetchedAt !== null && (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0 || fetchedAt > 8_640_000_000_000_000)) {
    throw new RangeError("fetchedAt must be a nonnegative epoch-millisecond integer or null");
  }
  const source = bytes.toString("utf8");
  const marker = (name) => new RegExp(`\\b${name}\\b`).test(source);
  return Object.freeze({
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    fetchedAt,
    markers: Object.freeze({
      initAliyunCaptcha: marker("initAliyunCaptcha"),
      startTracelessVerification: marker("startTracelessVerification"),
      show: marker("show"),
    }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, timestamp, ...extra] = process.argv.slice(2);
    if (!file || extra.length || (timestamp !== undefined && !/^\d+$/.test(timestamp))) {
      throw new Error("usage");
    }
    console.log(JSON.stringify(inspectCaptchaScript(fs.readFileSync(file), timestamp === undefined ? null : Number(timestamp))));
  } catch {
    // Filesystem errors may contain local paths. Do not echo them.
    console.error("Static inspection failed. Usage: node captcha-compatibility.mjs <saved-script> [retrieval-epoch-ms]");
    process.exitCode = 1;
  }
}
