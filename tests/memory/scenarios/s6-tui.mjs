// S6 TUI: log pane with 100k lines, resize storms, frame buffer growth, and
// long log records (see s6-tui-run.ts). Runs the TUI's real LogPane and
// buildFrame under Bun; no terminal is needed.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { bunPath, KIT_ROOT } from "../lib/isolated-kit.mjs";
import { MEMORY, PROCESSES } from "../lib/budgets.mjs";

export async function run(ctx) {
  const marks = [];
  const phaseT = {};
  const child = spawn(bunPath(), [join(KIT_ROOT, "tests", "memory", "scenarios", "s6-tui-run.ts")], {
    cwd: join(KIT_ROOT, "zcode-proxy-src"), env: { ...process.env, S6_PROFILE: ctx.profile }, stdio: ["ignore", "pipe", "inherit"],
  });
  let buf = "";
  child.stdout.on("data", (b) => {
    buf += b;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "sample") {
        ctx.setProgress(msg.progress); ctx.reportHeap(child.pid, msg.heapMB);
        phaseT[msg.phase] ??= { from: ctx.elapsed() }; phaseT[msg.phase].to = ctx.elapsed();
      } else if (msg.type === "phase") { marks.push(msg); }
    }
  });
  const code = await new Promise((r) => child.on("close", r));
  if (code !== 0) throw new Error(`s6 body exited ${code}`);
  const by = Object.fromEntries(marks.map((m) => [m.name, m]));
  const linesHeap = (by["B-start"]?.heapMB ?? 0) - (by["A-start"]?.heapMB ?? 0);
  const resizeHeap = (by["C-start"]?.heapMB ?? 0) - (by["B-start"]?.heapMB ?? 0);
  const longLineHeap = (by["C-end"]?.heapMB ?? 0) - (by["C-start"]?.heapMB ?? 0);
  // Ticket 32: the pane's heap after each adversarial part, against the same
  // baseline; the worst part is judged.
  const dMarks = ["D-mixed", "D-huge", "D-cjk", "D-records", "end"].map((n) => by[n]);
  const adversarialHeap = dMarks.every(Boolean)
    ? Math.max(...dMarks.map((m) => m.heapMB)) - (by["C-start"]?.heapMB ?? 0)
    : Infinity;
  ctx.note("marks", marks.map(({ name, rssMB, heapMB, lines }) => ({ name, rssMB, heapMB, ...(lines ? { lines } : {}) })));
  // Frame time is recorded, not gated: the §18 "no frame-time regression from
  // the width core" compares this number before and after ticket 05.
  const resizeFrames = (by["C-start"]?.progress ?? 0) - (by["B-start"]?.progress ?? 0);
  const frameMs = resizeFrames ? Number((((by["C-start"]?.ms ?? 0) - (by["B-start"]?.ms ?? 0)) / resizeFrames).toFixed(3)) : null;
  ctx.note("derived", {
    linesHeapMB: linesHeap, resizeHeapMB: resizeHeap, longLineHeapMB: longLineHeap, adversarialHeapMB: adversarialHeap,
    resizeFrameMs: frameMs, hugeLineFrameMs: by["D-huge"]?.hugeFrameMs ?? null,
  });
  ctx.log(`heap delta: 100k lines ${linesHeap} MB, resize storm ${resizeHeap} MB, long lines ${longLineHeap} MB (pane ${by["C-end"]?.lines} lines), adversarial ${adversarialHeap} MB (pane ${by.end?.lines} lines)`);
  return {
    budgets: {
      orphans: PROCESSES.orphans,
      extra: [
        { name: "tui:log-pane-heap", red: linesHeap > MEMORY.S6.linesHeapMB, value: linesHeap, budget: MEMORY.S6.linesHeapMB, unit: "MB" },
        { name: "tui:resize-storm-heap", red: resizeHeap > MEMORY.S6.resizeHeapMB, value: resizeHeap, budget: MEMORY.S6.resizeHeapMB, unit: "MB" },
        // §18: the pane bounds bytes, not only lines (2,000 lines x 64 KB was the ceiling before ticket 32).
        { name: "tui:long-line-heap", red: longLineHeap > MEMORY.S6.longLineHeapMB, value: longLineHeap, budget: MEMORY.S6.longLineHeapMB, unit: "MB" },
        // Ticket 32: the same budget under two-byte, CJK, over-cap and substring-of-a-parent records.
        { name: "tui:adversarial-line-heap", red: adversarialHeap > MEMORY.S6.longLineHeapMB, value: adversarialHeap, budget: MEMORY.S6.longLineHeapMB, unit: "MB" },
      ],
    },
  };
}
