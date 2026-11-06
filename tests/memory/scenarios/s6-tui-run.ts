/**
 * S6 body (Bun): the TUI's log pane and frame builder with the TUI's own
 * capacity (app.ts: new LogPane(2000)). Phases:
 *   A 100k (long: 1M) ordinary log lines, rendering a frame every 100 lines
 *   B resize storm: 5k (long: 50k) frames at random sizes
 *   C 2,000 long lines (64 KB each — a body or stack dumped into one record);
 *     the pane caps lines, not bytes
 * One JSON line per second on stdout, phase marks with forced-GC heap.
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
  emit({ type: "phase", name, progress, rssMB: Math.round(m.rss / MB), heapMB: Math.round(m.heapUsed / MB), ...extra });
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
mark("end", { lines: pane.count });
emit({ type: "done" });
process.exit(0);
