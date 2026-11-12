// Stub OMP host for the S3 OMP leg: a Bun process that
// loads the GENERATED OMP extension the way OMP does (default export called
// with an `on` registrar) and fires its `before_provider_request` hook once
// for the zcode provider. It measures its own memory while the hook runs; that
// delta is the in-host cost of the extension (reported, never kit footprint).
//
//   bun tests/memory/fixtures/omp-host.ts <generated extension .ts>
//
// Protocol (stdout, one JSON line each; the extension's own lines go to stderr):
//   OMP_HOST_READY {pid, baselineMB, metric}  idle, extension loaded, settled
//   OMP_HOST_DONE  {pid, baselineMB, peakMB, costMB, ms, metric[, wsCostMB]}  the hook returned
// stdin: a line "arm" opens the measurement (sent at spawn), a line "go" fires
// the hook; end of stdin (the loop went away) exits.
// Metric: RSS, or on Windows the commit charge (Bun.unsafe.memoryFootprint:
// PrivateUsage there), matching the loop's per-OS metric. On Windows
// the working-set delta (process.memoryUsage().rss) is measured beside it and
// reported as wsCostMB (every memory check shows both).
import { pathToFileURL } from "node:url";

const extensionPath = process.argv[2];
if (!extensionPath) { console.error("usage: bun omp-host.ts <extension>"); process.exit(2); }

type Hook = (event: unknown, ctx: { model?: { provider?: string } }) => Promise<void> | void;
const MB = 1024 * 1024;
const footprint = (Bun as unknown as { unsafe?: { memoryFootprint?: () => number } }).unsafe?.memoryFootprint;
const metric = process.platform === "win32" && typeof footprint === "function" ? "commit" : "rss";
const now = () => (metric === "commit" ? footprint!() : process.memoryUsage().rss) / MB;
const nowWs = () => process.memoryUsage().rss / MB;
const dual = metric === "commit";
const round = (v: number) => Number(v.toFixed(2));

const hooks = new Map<string, Hook>();
const mod = await import(pathToFileURL(extensionPath).href);
mod.default({ on(event: string, handler: Hook) { hooks.set(event, handler); } });
const hook = hooks.get("before_provider_request");
if (!hook) { console.error("extension registered no before_provider_request hook"); process.exit(2); }

// The control channel is open, and has delivered its first line ("arm"),
// before the baseline: its reader's buffers belong to the idle host, not to
// the hook.
let buffered = "";
let go = false;
let onArmed: () => void;
const armed = new Promise<void>((r) => { onArmed = r; });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffered += chunk;
  if (/(^|\n)arm\r?\n/.test(buffered)) onArmed();
  if (/(^|\n)go\r?\n/.test(buffered)) { go = true; if (ready) void fire(); }
});
// The long-lived host lives until its loop goes away, never longer.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
let ready = false;

// Baseline: the idle host with the same sampler running, after the start-up
// work has settled. Its maximum over an idle second is the level the hook's
// peak is compared with, so the sampler and the host's own idle churn (JIT,
// allocator, GC) are not charged to the extension.
await armed;
Bun.gc(true);
await Bun.sleep(300);
let baselineMB = now();
let wsBaselineMB = dual ? nowWs() : 0;
{
  const idle = setInterval(() => { baselineMB = Math.max(baselineMB, now()); if (dual) wsBaselineMB = Math.max(wsBaselineMB, nowWs()); }, 10);
  await Bun.sleep(1000);
  clearInterval(idle);
}
console.log(`OMP_HOST_READY ${JSON.stringify({ pid: process.pid, baselineMB: round(baselineMB), metric })}`);
ready = true;
if (go) void fire();

let fired = false;
async function fire() {
  if (fired) return;
  fired = true;
  let peakMB = now();
  let wsPeakMB = dual ? nowWs() : 0;
  const sample = setInterval(() => { peakMB = Math.max(peakMB, now()); if (dual) wsPeakMB = Math.max(wsPeakMB, nowWs()); }, 10);
  const t0 = Date.now();
  try { await hook!({}, { model: { provider: "zcode" } }); }
  finally {
    clearInterval(sample);
    peakMB = Math.max(peakMB, now());
    if (dual) wsPeakMB = Math.max(wsPeakMB, nowWs());
  }
  const ws = dual ? { wsCostMB: round(Math.max(0, wsPeakMB - wsBaselineMB)) } : {};
  console.log(`OMP_HOST_DONE ${JSON.stringify({ pid: process.pid, baselineMB: round(baselineMB), peakMB: round(peakMB), costMB: round(Math.max(0, peakMB - baselineMB)), ms: Date.now() - t0, metric, ...ws })}`);
}

