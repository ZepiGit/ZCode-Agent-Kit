/**
 * S6 body (Bun): the TUI's log pane and frame builder with the TUI's own
 * capacity (app.ts: new LogPane(2000)). Phases:
 *   A 100k (long: 1M) ordinary log lines, rendering a frame every 100 lines
 *   B resize storm: 5k (long: 50k) frames at random sizes
 *   C 4,000 long lines (64 KB each — a body or stack dumped into one record);
 *     the pane's 8 MB byte cap holds (ticket 32; before it, 2,000 x 64 KB)
 *   D adversarial records against the byte cap, while scrolled to the top
 *     (ticket 32): 64 KB ASCII lines with one emoji (held two bytes per
 *     UTF-16 unit), one 20 MB line (above the cap), 64 KB CJK lines, and
 *     multi-line records whose rows are substrings of a 20 MB parent (Bun
 *     keeps a substring's parent alive). Marked after each part.
 *   E (information, not gated; Round 21 Q1): 2,000 short ordinary lines evict
 *     every stored row, then a `flushed` mark.
 * One JSON line per second on stdout, phase marks with forced-GC heap and the
 * pane's byte count (paneBytes).
 */
import { LogPane } from "../../../zcode-proxy-src/src/tui/log-pane.js";
import { buildFrame, type FrameState } from "../../../zcode-proxy-src/src/tui/frame.js";

const LONG = process.env.S6_PROFILE === "long";
const MB = 1048576;
let progress = 0;
let phase = "init";
const emit = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + "\n");
setInterval(() => {
  const m = process.memoryUsage();
  emit({ type: "sample", phase, progress, rssMB: Math.round(m.rss / MB), heapMB: Math.round(m.heapUsed / MB) });
}, 1000);
function mark(name: string, extra: Record<string, unknown> = {}) {
  Bun.gc(true);
  const m = process.memoryUsage();
  // paneBytes: the pane's own byte count at the mark (Round 21 Q1 condition 3, information).
  emit({ type: "phase", name, progress, ms: Math.round(performance.now()), rssMB: Math.round(m.rss / MB), heapMB: Math.round(m.heapUsed / MB), paneBytes: pane.bytes, ...extra });
}

const pane = new LogPane(2000);
const state = (w: number, h: number): FrameState => {
  const view = pane.view(Math.max(1, h - 20));
  return {
    version: "s6", configPath: "/isolated/config.yaml", provider: "zai", plan: "coding-plan", loggedIn: true,
    apiKeyPreview: "fixture…", loginInFlight: false, loginHint: "", serverStatus: "running", serverUrl: "http://127.0.0.1:18457",
    serverError: "", modelCount: 2, responsesEnabled: true, claimAuto: false, logTotal: view.total, logView: view.lines,
    logFollowing: pane.following, logFromBottom: view.fromBottom, toast: null, width: w, height: h,
  } as FrameState;
};

phase = "A-lines";
mark("A-start");
const nA = LONG ? 1_000_000 : 100_000;
for (let i = 0; i < nA; i++) {
  pane.push(`[req ${i}] POST /v1/messages 200 glm-5.3 in=1234 out=56 ${i % 7 === 0 ? "\x1b[33mwarn\x1b[0m" : ""}`, i % 50 === 0 ? "warn" : "info");
  if (i % 100 === 0) buildFrame(state(120, 40));
  progress += 1;
  if ((i + 1) % 25_000 === 0) { mark(`A-after-${i + 1}`, { lines: pane.count }); await Bun.sleep(0); }
}

phase = "B-resize";
mark("B-start");
const nB = LONG ? 50_000 : 5_000;
for (let i = 0; i < nB; i++) {
  const w = 20 + ((i * 37) % 300), h = 5 + ((i * 17) % 120);
  buildFrame(state(w, h));
  progress += 1;
  if ((i + 1) % 1000 === 0) { mark(`B-after-${i + 1}`); await Bun.sleep(0); }
}

phase = "C-long-lines";
mark("C-start");
const long = "x".repeat(64 * 1024);
for (let i = 0; i < 4000; i++) {
  pane.push(`[dump ${i}] ${long}${i}`, "info");
  if (i % 50 === 0) buildFrame(state(120, 40));
  progress += 1;
  if ((i + 1) % 500 === 0) { mark(`C-after-${i + 1}`, { lines: pane.count }); await Bun.sleep(0); }
}
mark("C-end", { lines: pane.count });

phase = "D-adversarial";
pane.scrollUp(pane.count); // a flood while the user reads the oldest rows
mark("D-start", { lines: pane.count });
const mixed = "x".repeat(64 * 1024 - 2) + "😀";
for (let i = 0; i < 1000; i++) {
  pane.push(`[mixed ${i}] ${mixed}`, "warn");
  if (i % 50 === 0) buildFrame(state(120, 40));
  progress += 1;
}
mark("D-mixed", { lines: pane.count });
pane.push(`[huge] ${"z".repeat(20 * MB)}`, "error");
const hugeT0 = performance.now();
for (let i = 0; i < 20; i++) buildFrame(state(120, 40));
const hugeFrameMs = Number(((performance.now() - hugeT0) / 20).toFixed(3));
progress += 1;
mark("D-huge", { lines: pane.count, hugeFrameMs });
const cjk = "上游服务暂时不可用".repeat(2427); // 21,843 chars, 65,529 UTF-8 bytes
for (let i = 0; i < 1000; i++) {
  pane.push(`[cjk ${i}] ${cjk}`, "info");
  if (i % 50 === 0) buildFrame(state(120, 40));
  progress += 1;
}
mark("D-cjk", { lines: pane.count });
for (let k = 0; k < 4; k++) {
  const rows: string[] = [`[record ${k}] ${"y".repeat(20 * MB)}`];
  for (let j = 0; j < 2000; j++) rows.push(`[record ${k}] at frame ${j} (/srv/app/handlers/messages.ts:${j}:17) ${"·".repeat(40)}`);
  pane.push(rows.join("\n"), "error");
  buildFrame(state(120, 40));
  progress += 1;
  await Bun.sleep(0);
}
mark("D-records", { lines: pane.count });
pane.scrollDown(pane.count);
mark("end", { lines: pane.count });
// Attribution, not gated (Round 21 Q1 condition 3): 2,000 short ordinary lines
// evict every stored row; heap the pane's rows held is free at `flushed`.
phase = "E-flush";
for (let i = 0; i < 2000; i++) pane.push(`[flush ${i}] GET /health 200`, "info");
mark("flushed", { lines: pane.count });
emit({ type: "done" });
process.exit(0);
