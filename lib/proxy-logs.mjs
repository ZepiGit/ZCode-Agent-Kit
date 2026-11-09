// The tail of the proxy log (`proxy logs [n]`), shared by the manager CLI and
// `zcode-kit proxy logs` (ticket 40). It reads bounded tail windows across
// proxy.log.1 and proxy.log (ticket 33), oldest first, and prints nothing.
//
//   readLogTail(file, { n, level, grep, redact }) → { exists, lines }
//
// lines are the last `n` non-empty lines of the window, redacted (ADR-0010
// rule 4), after the optional filters (A-23, additive), which see the lines
// as they are shown (redacted):
//   level "warn"   lines at WARN or ERROR (lineLevel below);
//   level "error"  lines at ERROR only;
//   grep           lines that contain the text (plain substring, case-sensitive).
// Without a filter the window is the last 64 KiB, as `proxy logs` always
// read; with one it is the last 1 MiB, so a filter still finds older matches.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export const LOG_LEVELS = Object.freeze(["warn", "error"]);
const WINDOW = 64 * 1024;
const FILTER_WINDOW = 1024 * 1024;

/**
 * The level of one proxy.log line: "error", "warn" or "info". The log mixes
 * event lines (`ISO LEVEL component …`), manager narration
 * (`[manager ISO] …`, `ERROR: …` for failures) and the proxy's request lines
 * (`r001 ANT glm-5.3 429 …`: 5xx is an error, 4xx a warning).
 */
export function lineLevel(line) {
  const event = line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z (DEBUG|INFO|WARN|ERROR) /);
  if (event) return event[1] === "ERROR" ? "error" : event[1] === "WARN" ? "warn" : "info";
  const request = line.match(/^r\d+ \S+ \S+ (\d{3})\b/);
  if (request) return request[1] >= "500" ? "error" : request[1] >= "400" ? "warn" : "info";
  if (/(^|\] )ERROR\b|\bmanager error\b/.test(line)) return "error";
  if (/(^|\] )(WARN|WARNING)\b|\bwarn(ing)?:/i.test(line)) return "warn";
  return "info";
}

const RANK = { info: 0, warn: 1, error: 2 };

function tailLines(file, window) {
  let fh;
  try { fh = openSync(file, "r"); } catch (err) { if (err?.code === "ENOENT") return { exists: false, lines: [], whole: true }; throw err; }
  try {
    // Size and bytes must refer to the same open file even if it is rotated.
    const size = fstatSync(fh).size;
    const tailBytes = Math.min(size, window);
    const offset = size - tailBytes;
    const buf = Buffer.alloc(tailBytes);
    const read = readSync(fh, buf, 0, tailBytes, offset);
    let bytes = buf.subarray(0, read);
    // A cut line may start inside a secret, which redaction cannot recognise.
    // Discard it before decoding, redacting or filtering; no newline means
    // there is no complete line in this window. At byte 0 keep the first line.
    if (offset > 0) {
      const newline = bytes.indexOf(0x0a);
      bytes = newline < 0 ? bytes.subarray(bytes.length) : bytes.subarray(newline + 1);
    }
    return { exists: true, lines: bytes.toString("utf8").split("\n").filter(Boolean), whole: offset === 0 };
  } finally {
    closeSync(fh);
  }
}

export function readLogTail(file, { n = 40, level = null, grep = null, redact = (text) => text } = {}) {
  const filtered = level !== null || grep !== null;
  const window = filtered ? FILTER_WINDOW : WINDOW;
  const current = tailLines(file, window);
  // Ticket 33's cross-rotation tail survives the shared-reader extraction.
  const previous = current.whole && (filtered || current.lines.length < n) ? tailLines(`${file}.1`, window) : null;
  if (!current.exists && !previous?.exists) return { exists: false, lines: [] };
  let lines = [...(previous?.lines ?? []), ...current.lines];
  // Without a filter: the last n lines, redacted as one text (as `proxy logs`
  // always printed them). With one, the window is redacted first, so the
  // filters see exactly the lines that would be shown.
  if (!filtered) {
    const shown = redact(lines.slice(-n).join("\n"));
    return { exists: true, lines: shown === "" ? [] : shown.split("\n") };
  }
  lines = redact(lines.join("\n")).split("\n").filter(Boolean);
  if (level !== null) lines = lines.filter((line) => RANK[lineLevel(line)] >= RANK[level]);
  if (grep !== null) lines = lines.filter((line) => line.includes(grep));
  return { exists: true, lines: lines.slice(-n) };
}
