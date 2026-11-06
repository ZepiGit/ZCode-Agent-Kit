// S5 MCP bridge: one long bridge session through the real MCP interface
// (mcp/zcode-harness-mcp/test/integration/client.mjs) against the fixture
// runtime (test/fixture/fake-harness.mjs): many tasks in a row (task manager,
// relay, store, interactions), then a restart on the same data dir, which
// reloads every stored task.
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT_ROOT } from "../lib/isolated-kit.mjs";
import { scan } from "../lib/sampler.mjs";

function dirBytes(dir) {
  let total = 0, files = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) { const d = dirBytes(p); total += d.total; files += d.files; }
    else { total += statSync(p).size; files += 1; }
  }
  return { total, files };
}

export async function run(ctx) {
  const { startBridge } = await import(pathToFileURL(join(KIT_ROOT, "mcp", "zcode-harness-mcp", "test", "integration", "client.mjs")).href);
  const dataDir = join(ctx.outDir, "bridge-data");
  mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  const bridgeRss = () => scan(ctx.marker).filter((p) => p.role === "mcp-bridge").reduce((a, p) => a + p.rssKb, 0) / 1024;
  const settle = async () => { await new Promise((r) => setTimeout(r, 3000)); return Math.round(bridgeRss()); };

  let c = await startBridge({ reuseDataDir: dataDir, maxConcurrentTasks: "2", interactionTimeoutSec: "2" });
  const emptyRss = await settle();
  const n = ctx.long ? 3000 : 400;
  const loadStart = ctx.elapsed();
  let failures = 0;
  const big = "x".repeat(16 * 1024);
  for (let i = 0; i < n; i++) {
    try {
      const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: `task ${i} ${i % 10 === 0 ? big : ""}`, readOnly: true });
      await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
      await c.tool("zcode_task_result", { taskId: started.taskId });
      if (i % 25 === 0) await c.tool("zcode_tasks_list", {}).catch(() => null);
    } catch { failures += 1; }
    ctx.setProgress(i + 1);
  }
  const loadEnd = ctx.elapsed();
  const afterRss = await settle();
  await c.stop();
  const disk = dirBytes(dataDir);
  // Restart on the same data dir: what does the stored history cost at boot?
  c = await startBridge({ reuseDataDir: dataDir, maxConcurrentTasks: "2" });
  await c.tool("zcode_health", {});
  const rebootRss = await settle();
  await c.stop();
  ctx.note("bridge", { tasks: n, failures, emptyRssMB: emptyRss, afterTasksRssMB: afterRss, rebootWithHistoryRssMB: rebootRss, dataDirMB: Number((disk.total / 1048576).toFixed(1)), dataDirFiles: disk.files });
  ctx.log(`bridge rss: empty ${emptyRss} MB, after ${n} tasks ${afterRss} MB, reboot with history ${rebootRss} MB, data ${(disk.total / 1048576).toFixed(1)} MB in ${disk.files} files`);
  return {
    budgets: {
      growth: { role: "mcp-bridge", axis: "progress", maxPctPer1k: 5, risingWindows: 3, fromT: loadStart, untilT: loadEnd },
      procPeaks: { "mcp-bridge": 150 },
      orphans: 0,
      extra: [
        { name: "bridge:reboot-cost-of-history", red: rebootRss - emptyRss > 20, value: rebootRss - emptyRss, budget: 20, unit: "MB" },
        { name: "bridge:task-failures", red: failures > 0, value: failures, budget: 0, unit: "tasks" },
      ],
    },
  };
}
