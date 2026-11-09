// The tail of the proxy log (`proxy logs [n]`), shared by the manager CLI and
// `zcode-kit proxy logs` (ticket 40). It reads a bounded window from the end
// of the file and prints nothing.
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
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

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

export function readLogTail(file, { n = 40, level = null, grep = null, redact = (text) => text } = {}) {
  if (!existsSync(file)) return { exists: false, lines: [] };
  const filtered = level !== null || grep !== null;
  const size = statSync(file).size;
  const tailBytes = Math.min(size, filtered ? FILTER_WINDOW : WINDOW);
  const fh = openSync(file, "r");
  let text;
  try {
    const buf = Buffer.alloc(tailBytes);
    readSync(fh, buf, 0, tailBytes, size - tailBytes);
    text = buf.toString("utf8");
  } finally {
    closeSync(fh);
  }
  let lines = text.split("\n").filter(Boolean);
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
