// S2 Captcha path: the real solver dispatcher + worker + happy-dom under Bun,
// with the offline fixture backend (src/proxy/__fixtures__/solver-backend.ts
// via tests/memory/fixtures/s2-backend.ts). Phases (see s2-captcha-run.ts):
//   A repeated heavy happy-dom solves with production recycling
//   B guest heap retained within one generation, then recycle
//   C hung solves (thread parked holding 256 MB) killed at the deadline
//   D CDN cache memory map growth with rotating URLs
//   E cold start of a fresh generation, then the idle exit
//   K (two more hosts) the host SIGKILLed with a live generation: hung, idle
// The S2 body plays the proxy: the dispatcher lives in it exactly as in the
// proxy. Today the solver is a worker thread of that process (its RSS is the
// captcha cost); with the solver process (ADR-0002, ticket 27) it is a child
// with the `solver` role, and the process-level claims become observable:
// ≤ 1 solver per proxy at every sample, 0 after an idle exit, 0 after the
// proxy is SIGKILLed.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bunPath, KIT_ROOT } from "../lib/isolated-kit.mjs";
import { MEMORY, PROCESSES, growthBudget } from "../lib/budgets.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run one S2 body; `onMark(msg, child)` sees every phase mark. Resolves { code, signal, errTail }. */
function runBody(ctx, env, { onSample = () => {}, onMark = () => {} } = {}) {
  const child = spawn(bunPath(), [join(KIT_ROOT, "tests", "memory", "scenarios", "s2-captcha-run.ts")], {
    cwd: join(KIT_ROOT, "zcode-proxy-src"),
    env: { ...process.env, S2_PROFILE: ctx.profile, TMPDIR: join(ctx.outDir), ...env },
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
      if (msg.type === "sample") onSample(msg, child);
      else if (msg.type === "phase") onMark(msg, child);
    }
  });
  return new Promise((r) => child.on("close", (code, signal) => r({ code, signal, errTail, pid: child.pid })));
}

export async function run(ctx) {
  const heapLog = join(ctx.outDir, "worker-heap.jsonl");
  const marks = [];
  const phaseT = {};
  const main = await runBody(ctx, { S2_HEAP_LOG: heapLog, ...(ctx.variant === "gc" ? { S2_GC: "1", S2_PHASES: "A" } : {}) }, {
    onSample(msg, child) {
      ctx.setProgress(msg.solves);
      ctx.reportHeap(child.pid, msg.mainHeapMB);
      phaseT[msg.phase] ??= { from: ctx.elapsed() };
      phaseT[msg.phase].to = ctx.elapsed();
    },
    onMark(msg) {
      marks.push({ ...msg, tMs: ctx.elapsed() });
      ctx.log(`${msg.name}: rss ${msg.rssMB} MB, main heap ${msg.mainHeapMB} MB, gen ${msg.solver.generation}, recycles ${msg.solver.recycles} (${msg.solver.lastRecycleReason ?? "-"})`);
      // The body sleeps 3 s after this mark: count solver processes now.
      if (msg.name === "E-idle-exited") ctx.observe("after-idle-exit");
    },
  });
  if (main.code !== 0) throw new Error(`s2 body exited ${main.code}: ${main.errTail}`);

  // K: SIGKILL the host while a generation is alive, then count solvers.
  const kills = [];
  if (ctx.variant !== "gc") {
    for (const mode of ["hung", "idle"]) {
      let killedAt = null;
      const k = await runBody(ctx, { S2_PHASES: "K", S2_KILL: mode }, {
        onMark(msg, child) {
          if (msg.name !== "K-ready") return;
          killedAt = ctx.elapsed();
          child.kill("SIGKILL");
        },
      });
      if (killedAt === null) throw new Error(`s2 kill host (${mode}) never got ready: exit ${k.code} ${k.errTail}`);
      await sleep(2000); // grace for a child to notice its parent is gone
      const counts = ctx.observe(`after-proxy-sigkill:${mode}`);
      kills.push({ mode, signal: k.signal, solversAfter: counts.solver ?? 0 });
    }
  }
  ctx.note("kills", kills);

  const heap = existsSync(heapLog) ? readFileSync(heapLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const byName = Object.fromEntries(marks.map((m) => [m.name, m]));
  const maxWorkerHeap = (kind) => Math.max(0, ...heap.filter((h) => h.kind === kind).map((h) => h.heapMB));
  ctx.note("marks", marks.map(({ name, rssMB, mainHeapMB, tMs, solver, entries, coldStartMs, idleExited }) => ({ name, tMs, rssMB, mainHeapMB, generation: solver.generation, recycles: solver.recycles, lastRecycleReason: solver.lastRecycleReason, deadlineKills: solver.deadlineKills, ...(entries ? { entries } : {}), ...(coldStartMs !== undefined ? { coldStartMs, idleExited } : {}) })));
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
  const e = byName["E-idle-exited"];
  ctx.note("derived", { retainedBeforeRecycleMB: retainedBeforeRecycle, returnedOnRecycleMB: returnedOnRecycle, hangLeakMB, cdnGrowthMB, cdnEntries: byName["D-end"] ? (ctx.long ? 2000 : 600) : null, coldStartMs: e?.coldStartMs ?? null });
  const A = phaseT["A-heavy-dom"];
  const full = ctx.variant !== "gc";
  return {
    budgets: {
      growth: growthBudget("scenario", { fromT: A?.from ?? 0, untilT: A?.to ?? Infinity }),
      // The host process as a whole (the proxy's captcha cost while the solver is a thread).
      procPeaks: { scenario: 600, solver: MEMORY.S2.solverCapMB },
      windowPeaks: [{ name: "solver:cost-per-generation", roles: ["scenario", "solver"], fromT: A?.from ?? 0, untilT: A?.to ?? Infinity, baseMB: rss("A-start") ?? 0, maxMB: MEMORY.S2.costPerGenerationMB }],
      perParent: [{ role: "solver", max: PROCESSES.solversPerProxy }],
      ...(full ? {
        observed: [
          { name: "solver:after-idle-exit", label: "after-idle-exit", role: "solver", max: PROCESSES.solversAfterIdleExit },
          { name: "solver:after-proxy-sigkill", label: "after-proxy-sigkill", role: "solver", max: PROCESSES.solversAfterProxyKill },
        ],
      } : {}),
      orphans: PROCESSES.orphans,
      extra: full ? [
        { name: "solver:retained-before-recycle", red: retainedBeforeRecycle > MEMORY.S2.retainedBeforeRecycleMB, value: retainedBeforeRecycle, budget: MEMORY.S2.retainedBeforeRecycleMB, unit: "MB" },
        { name: "solver:hang-not-reclaimed", red: hangLeakMB > MEMORY.S2.hungReclaimMB, value: hangLeakMB, budget: MEMORY.S2.hungReclaimMB, unit: "MB" },
        { name: "cdn-cache:memory-growth", red: cdnGrowthMB > MEMORY.S2.cdnMemoryMB, value: cdnGrowthMB, budget: MEMORY.S2.cdnMemoryMB, unit: "MB" },
        { name: "solver:cold-start", red: !e?.coldStartOk || e.coldStartMs > MEMORY.S2.coldStartMs, value: e?.coldStartMs ?? "no solve", budget: MEMORY.S2.coldStartMs, unit: "ms" },
        // The idle-exit count only means something if the idle exit happened.
        { name: "solver:idle-exit-happened", red: e?.idleExited !== true, value: e?.idleExited === true ? 1 : 0, budget: 1, unit: "idle exits" },
      ] : [],
    },
  };
}
