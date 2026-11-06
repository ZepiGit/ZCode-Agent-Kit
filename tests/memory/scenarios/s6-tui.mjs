// S6 TUI: log pane with 100k lines, resize storms, frame buffer growth, and
// long log records (see s6-tui-run.ts). Runs the TUI's real LogPane and
// buildFrame under Bun; no terminal is needed.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { bunPath, KIT_ROOT } from "../lib/isolated-kit.mjs";

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
  const longLineHeap = (by["end"]?.heapMB ?? 0) - (by["C-start"]?.heapMB ?? 0);
  ctx.note("marks", marks.map(({ name, rssMB, heapMB, lines }) => ({ name, rssMB, heapMB, ...(lines ? { lines } : {}) })));
  ctx.note("derived", { linesHeapMB: linesHeap, resizeHeapMB: resizeHeap, longLineHeapMB: longLineHeap });
  ctx.log(`heap delta: 100k lines ${linesHeap} MB, resize storm ${resizeHeap} MB, long lines ${longLineHeap} MB (pane ${by.end?.lines} lines)`);
  return {
    budgets: {
      orphans: 0,
      extra: [
        { name: "tui:log-pane-heap", red: linesHeap > 16, value: linesHeap, budget: 16, unit: "MB" },
        { name: "tui:resize-storm-heap", red: resizeHeap > 8, value: resizeHeap, budget: 8, unit: "MB" },
        // Proposed: the pane bounds bytes, not only lines (2,000 lines x 64 KB is the current ceiling).
        { name: "tui:long-line-heap", red: longLineHeap > 32, value: longLineHeap, budget: 32, unit: "MB" },
      ],
    },
  };
}
