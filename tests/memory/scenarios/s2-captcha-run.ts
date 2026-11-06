/**
 * S2 body (runs under Bun; spawned by s2-captcha.mjs). Drives the REAL captcha
 * solver dispatcher (captcha-solver.ts → captcha-solver-worker.ts → happy-dom)
 * with the offline fixture backend, in the production default configuration
 * unless a phase says otherwise. Emits one JSON line per second on stdout:
 *   {"type":"sample","solves":n,"rssMB":..,"mainHeapMB":..,"phase":..,"solver":{..}}
 * and {"type":"phase", ...} marks. Measurement only: solver behaviour is unchanged.
 * Phases (S2_PHASES, default ABCDE): A heavy solves, B retained heap, C hung
 * solves, D CDN map, E cold start + idle exit; K (alone, S2_KILL=hung|idle)
 * waits to be SIGKILLed with a live generation.
 */
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { configureCaptchaSolver, getCaptchaSolverStats, requestCaptchaSolverRecycle, runCaptchaSolve, shutdownCaptchaSolver } from "../../../zcode-proxy-src/src/proxy/captcha-solver.js";
import { CaptchaCdnCache } from "../../../zcode-proxy-src/src/proxy/captcha-cdn-cache.js";

const LONG = process.env.S2_PROFILE === "long";
const PHASES = process.env.S2_PHASES ?? "ABCDE";
const BACKEND = join(import.meta.dir, "..", "fixtures", "s2-backend.ts");
const MB = 1048576;
let solves = 0;
let phase = "init";
const marks: Array<Record<string, unknown>> = [];

function emit(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function sample() {
  const m = process.memoryUsage();
  emit({ type: "sample", t: Date.now(), phase, solves, rssMB: Math.round(m.rss / MB), mainHeapMB: Math.round(m.heapUsed / MB), solver: getCaptchaSolverStats() });
}
const timer = setInterval(sample, 1000);
function mark(name: string, extra: Record<string, unknown> = {}) {
  Bun.gc(true);
  const m = process.memoryUsage();
  const rec = { type: "phase", name, phase, solves, rssMB: Math.round(m.rss / MB), mainHeapMB: Math.round(m.heapUsed / MB), solver: getCaptchaSolverStats(), ...extra };
  marks.push(rec);
  emit(rec);
}
const solve = async (scene: string) => {
  try { await runCaptchaSolve(scene, "cn-shanghai", "fixture"); return true; }
  catch { return false; } finally { solves += 1; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

configureCaptchaSolver({ backendModule: BACKEND });

if (PHASES.includes("A")) {
// A. Production lifecycle: heavy happy-dom solves with the default recycling
//    (every 200 solves, heap > 768 MB, 3 failures, 10 min idle).
phase = "A-heavy-dom";
mark("A-start");
const nA = LONG ? 2000 : 420;
for (let i = 0; i < nA; i++) {
  await solve("heavy-dom:3000:512");
  if (i === 9 || (i + 1) % 100 === 0) mark(`A-after-${i + 1}`);
}
mark("A-end");
}
if (PHASES.includes("B")) {
// B. Retained guest heap inside one generation. Production recycles on heap
//    only above 768 MB of worker heap: how much RSS does that allow, and does
//    terminate() give it back?
phase = "B-retain";
requestCaptchaSolverRecycle("s2-phase");
await sleep(500);
mark("B-start");
for (let i = 0; i < (LONG ? 30 : 22); i++) {
  await solve("retain:4"); // +4 x 8 MB arrays per solve, kept by the worker
  if ((i + 1) % 2 === 0) mark(`B-after-${i + 1}`);
}
mark("B-before-recycle");
requestCaptchaSolverRecycle("s2-measure");
for (let i = 0; i < 5; i++) { await sleep(1000); }
mark("B-after-recycle-5s");
await solve("token:after"); // fresh generation
mark("B-fresh-generation");
}
if (PHASES.includes("C")) {
// C. Hung solves: a guest that holds 256 MB and parks its thread. The
//    dispatcher terminates it at the deadline. Does the thread (and its heap) go?
phase = "C-hang";
configureCaptchaSolver({ deadlineMs: 3000 });
mark("C-start");
for (let i = 0; i < (LONG ? 10 : 5); i++) {
  await solve("fat-hang:32");
  await sleep(1500);
  mark(`C-after-hang-${i + 1}`);
}
configureCaptchaSolver({ deadlineMs: 90_000 });
await solve("token:post-hang");
for (let i = 0; i < 5; i++) await sleep(1000);
mark("C-end");
}
if (PHASES.includes("D")) {
// D. CDN cache memory map: distinct URLs (rotating dynamicJS) are never
//    evicted from memory, only refused on read after the TTL.
phase = "D-cdn-cache";
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "s2-cdn-"));
const cache = new CaptchaCdnCache({ directory: dir });
mark("D-start");
const body = Buffer.alloc(256 * 1024, 1);
const nD = LONG ? 2000 : 600;
for (let i = 0; i < nD; i++) {
  cache.put(`https://o.alicdn.com/captcha-frontend/dynamicJS/${i}/pe.js`, Buffer.from(body));
  if ((i + 1) % 100 === 0) mark(`D-after-${i + 1}`, { entries: i + 1 });
}
rmSync(dir, { recursive: true, force: true });
mark("D-end");
}

if (PHASES.includes("E")) {
// E. Cold start of a fresh generation, then the idle exit. The host keeps
//    running for 3 s after the mark so the loop can count solver processes.
phase = "E-idle-exit";
requestCaptchaSolverRecycle("s2-cold-start");
await sleep(1000);
configureCaptchaSolver({ idleMs: 2000 });
const t0 = performance.now();
const coldStartOk = await solve("token:cold-start");
const coldStartMs = Math.round(performance.now() - t0);
await sleep(4000);
mark("E-idle-exited", { coldStartMs, coldStartOk, idleExited: getCaptchaSolverStats().lastRecycleReason === "idle" });
await sleep(3000);
configureCaptchaSolver({ idleMs: 10 * 60_000 });
}
if (PHASES.includes("K")) {
// K. The host is SIGKILLed by the loop (as the watchdog does to a stuck
//    proxy) with a generation alive: S2_KILL=hung parks the solver in a hung
//    solve, S2_KILL=idle leaves it idle after a solve. Never returns.
phase = "K-kill";
if (process.env.S2_KILL === "hung") {
  configureCaptchaSolver({ deadlineMs: 120_000 });
  void solve("fat-hang:1");
  while (getCaptchaSolverStats().generation < 1) await sleep(50);
  await sleep(1000);
} else {
  await solve("token:before-kill");
}
mark("K-ready", { killMode: process.env.S2_KILL ?? "idle" });
await new Promise(() => {});
}

shutdownCaptchaSolver();
await sleep(2000);
mark("end");
clearInterval(timer);
emit({ type: "done", marks: marks.length });
process.exit(0);
