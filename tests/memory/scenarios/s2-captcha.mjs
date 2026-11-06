// S2 Captcha path: the real solver dispatcher + worker + happy-dom under Bun,
// with the offline fixture backend (src/proxy/__fixtures__/solver-backend.ts
// via tests/memory/fixtures/s2-backend.ts). Phases (see s2-captcha-run.ts):
//   A repeated heavy happy-dom solves with production recycling
//   B guest heap retained within one generation, then recycle
//   C hung solves (thread parked holding 256 MB) killed at the deadline
//   D CDN cache memory map growth with rotating URLs
// The solver worker is a thread of this process, exactly as in the proxy, so
// the process RSS is the proxy's captcha cost.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bunPath, KIT_ROOT } from "../lib/isolated-kit.mjs";

export async function run(ctx) {
  const heapLog = join(ctx.outDir, "worker-heap.jsonl");
  const marks = [];
  const phaseT = {};
  let last = null;
  const child = spawn(bunPath(), [join(KIT_ROOT, "tests", "memory", "scenarios", "s2-captcha-run.ts")], {
    cwd: join(KIT_ROOT, "zcode-proxy-src"),
    env: { ...process.env, S2_PROFILE: ctx.profile, S2_HEAP_LOG: heapLog, TMPDIR: join(ctx.outDir), ...(ctx.variant === "gc" ? { S2_GC: "1", S2_PHASES: "A" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errTail = "";
  child.stderr.on("data", (b) => { errTail = (errTail + b).slice(-4000); });
  let buf = "";
  child.stdout.on("data", (b) => {
    buf += b;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "sample") {
        last = msg;
        ctx.setProgress(msg.solves);
        ctx.reportHeap(child.pid, msg.mainHeapMB);
        phaseT[msg.phase] ??= { from: ctx.elapsed() };
        phaseT[msg.phase].to = ctx.elapsed();
      } else if (msg.type === "phase") {
        marks.push({ ...msg, tMs: ctx.elapsed() });
        ctx.log(`${msg.name}: rss ${msg.rssMB} MB, main heap ${msg.mainHeapMB} MB, gen ${msg.solver.generation}, recycles ${msg.solver.recycles} (${msg.solver.lastRecycleReason ?? "-"})`);
      }
    }
  });
  const code = await new Promise((r) => child.on("close", r));
  if (code !== 0) throw new Error(`s2 body exited ${code}: ${errTail}`);
  const heap = existsSync(heapLog) ? readFileSync(heapLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const byName = Object.fromEntries(marks.map((m) => [m.name, m]));
  const maxWorkerHeap = (kind) => Math.max(0, ...heap.filter((h) => h.kind === kind).map((h) => h.heapMB));
  ctx.note("marks", marks.map(({ name, rssMB, mainHeapMB, tMs, solver, entries }) => ({ name, tMs, rssMB, mainHeapMB, generation: solver.generation, recycles: solver.recycles, lastRecycleReason: solver.lastRecycleReason, deadlineKills: solver.deadlineKills, ...(entries ? { entries } : {}) })));
  ctx.note("workerHeap", {
    heavyDomMaxMB: maxWorkerHeap("heavy-dom"),
    heavyDomFirst10: heap.filter((h) => h.kind === "heavy-dom").slice(0, 10).map((h) => h.heapMB),
    heavyDomLast10: heap.filter((h) => h.kind === "heavy-dom").slice(-10).map((h) => h.heapMB),
    retainMaxMB: maxWorkerHeap("retain"),
  });
  const rss = (name) => byName[name]?.rssMB ?? null;
  const hangLeakMB = rss("C-end") - rss("C-start");
  const retainedBeforeRecycle = rss("B-before-recycle") - rss("B-start");
  const returnedOnRecycle = rss("B-before-recycle") - rss("B-after-recycle-5s");
  const cdnGrowthMB = rss("D-end") - rss("D-start");
  ctx.note("derived", { retainedBeforeRecycleMB: retainedBeforeRecycle, returnedOnRecycleMB: returnedOnRecycle, hangLeakMB, cdnGrowthMB, cdnEntries: byName["D-end"] ? (ctx.long ? 2000 : 600) : null });
  return {
    budgets: {
      growth: { role: "scenario", axis: "progress", maxPctPer1k: 5, risingWindows: 3, fromT: phaseT["A-heavy-dom"]?.from ?? 0, untilT: phaseT["A-heavy-dom"]?.to ?? Infinity },
      procPeaks: { scenario: 600 },
      orphans: 0,
      extra: [
        // §9: each solver hard-capped at 300 MB. The worker shares the proxy's
        // address space; the only limit is the 768 MB worker-heap heuristic.
        { name: "solver:retained-before-recycle", red: retainedBeforeRecycle > 300, value: retainedBeforeRecycle, budget: 300, unit: "MB" },
        { name: "solver:hang-not-reclaimed", red: hangLeakMB > 64, value: hangLeakMB, budget: 64, unit: "MB" },
        { name: "cdn-cache:memory-growth", red: cdnGrowthMB > 64, value: cdnGrowthMB, budget: 64, unit: "MB" },
      ],
    },
  };
}
