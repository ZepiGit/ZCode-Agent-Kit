// S5 MCP bridge: one long bridge session through the real MCP interface
// (mcp/zcode-harness-mcp/test/integration/client.mjs) against the fixture
// runtime (test/fixture/fake-harness.mjs): many tasks in a row (task manager,
// relay, store, interactions), then a restart on the same data dir, which
// reloads every stored task.
//
// S5/restart (ticket 57): induced harness exits instead (runRestart below).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT_ROOT } from "../lib/isolated-kit.mjs";
import { scan, settled } from "../lib/sampler.mjs";
import { MCP_RESTART, MEMORY, PROCESSES, growthBudget } from "../lib/budgets.mjs";

function dirBytes(dir) {
  let total = 0, files = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) { const d = dirBytes(p); total += d.total; files += d.files; }
    else { total += statSync(p).size; files += 1; }
  }
  return { total, files };
}

/**
 * The harness children of a FAKE_SPAWN_LOG (fake-harness.mjs): their count,
 * spawn times relative to `t0` (Unix ms) and the gaps between them, and the
 * most that were alive at once. A child without an exit line (SIGKILLed, or
 * still running) counts as alive until `endT`.
 */
export function harnessSpawns(text, { t0 = 0, endT = Infinity } = {}) {
  const starts = new Map(), exits = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!Number.isInteger(r?.pid) || !Number.isFinite(r?.t)) continue;
    if (r.event === "start" && !starts.has(r.pid)) starts.set(r.pid, r.t);
    else if (r.event === "exit") exits.set(r.pid, r.t);
  }
  const lives = [...starts].map(([pid, start]) => ({ pid, start, end: exits.get(pid) ?? endT })).sort((a, b) => a.start - b.start);
  let maxAlive = 0;
  for (const life of lives) maxAlive = Math.max(maxAlive, lives.filter((o) => o.start <= life.start && o.end > life.start).length);
  const at = lives.map((l) => l.start - t0);
  return { spawns: lives.length, maxAlive, spawnAtMs: at, gapsMs: at.slice(1).map((t, i) => t - at[i]), withoutExit: lives.filter((l) => !exits.has(l.pid)).length };
}

/**
 * S5/restart (ticket 57, Owner Proxy round 12 Q1 condition 1): the real bridge
 * against the fake harness with FAKE_EXIT_ON_SEND=1. The client issues K
 * back-to-back task calls (zcode_task_start, then zcode_task_wait until the
 * task is terminal); every prompt the harness accepts makes it exit. Then the
 * client stops the bridge. Recorded: the harness children spawned, the most
 * alive at once (spawn log and samples), the children alive after each call
 * and after the stop, the spawn times, and the bridge peak against S5's budget.
 */
async function runRestart(ctx, startBridge) {
  const dataDir = join(ctx.outDir, "bridge-data");
  mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  const spawnLog = join(ctx.outDir, "harness-spawns.jsonl");
  const t0 = Date.now();
  const c = await startBridge({ reuseDataDir: dataDir, maxConcurrentTasks: "2", interactionTimeoutSec: "2", env: { FAKE_EXIT_ON_SEND: "1", FAKE_SPAWN_LOG: spawnLog } });
  const calls = [];
  for (let i = 0; i < MCP_RESTART.calls; i++) {
    const started = ctx.elapsed();
    const call = { i, state: null, error: null };
    try {
      const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: `restart ${i}`, readOnly: true });
      const done = await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 30_000 });
      call.state = done.state;
      call.error = done.error ?? done.interruptionReason ?? null;
    } catch (err) { call.error = String(err?.message ?? err); }
    // The call's harness has exited (or none was started): count what is left.
    await ctx.observe(`after-exit:${i}`);
    call.ms = ctx.elapsed() - started;
    if (typeof call.error === "string") call.error = call.error.slice(0, 600);
    calls.push(call);
    ctx.setProgress(i + 1);
  }
  await c.stop();
  await ctx.observe("after-bridge-stop");
  const log = harnessSpawns(existsSync(spawnLog) ? readFileSync(spawnLog, "utf8") : "", { t0 });
  const states = {};
  for (const call of calls) states[call.state ?? "tool-error"] = (states[call.state ?? "tool-error"] ?? 0) + 1;
  ctx.note("restart", { calls: calls.length, states, ...log, lastErrors: [...new Set(calls.map((x) => x.error).filter(Boolean))].slice(-3) });
  // The round counts as run (lib/completeness.mjs ROUNDS) only when all K calls
  // ran and the spawn log saw a harness: without one, no restart was exercised.
  ctx.note("rounds", calls.length === MCP_RESTART.calls && log.spawns >= 1 ? [{ name: `restart-k${MCP_RESTART.calls}`, calls: calls.length, spawns: log.spawns }] : []);
  ctx.log(`restart: ${calls.length} calls (${Object.entries(states).map(([k, v]) => `${k} ${v}`).join(", ")}), ${log.spawns} harness spawns at ${log.spawnAtMs.join(", ")} ms, at most ${log.maxAlive} alive at once`);
  return {
    budgets: {
      procPeaks: { "mcp-bridge": MEMORY.S5.procPeakMB },
      counts: { "fake-harness": MCP_RESTART.harnessChildren },
      observed: [
        { name: "restart:harness-after-exit", label: "after-exit", role: "fake-harness", max: MCP_RESTART.harnessAfterExit },
        { name: "restart:harness-after-bridge-stop", label: "after-bridge-stop", role: "fake-harness", max: MCP_RESTART.harnessAfterStop },
      ],
      orphans: PROCESSES.orphans,
      extra: [
        { name: "restart:harness-spawns", red: log.spawns > MCP_RESTART.maxSpawns, value: log.spawns, budget: MCP_RESTART.maxSpawns, unit: "spawns", detail: { calls: calls.length, spawnAtMs: log.spawnAtMs, gapsMs: log.gapsMs } },
        { name: "restart:concurrent-harness", red: log.maxAlive > MCP_RESTART.harnessChildren, value: log.maxAlive, budget: MCP_RESTART.harnessChildren, unit: "procs", detail: { withoutExit: log.withoutExit } },
      ],
    },
  };
}

export async function run(ctx) {
  const { startBridge } = await import(pathToFileURL(join(KIT_ROOT, "mcp", "zcode-harness-mcp", "test", "integration", "client.mjs")).href);
  if (ctx.variant === "restart") return runRestart(ctx, startBridge);
  const dataDir = join(ctx.outDir, "bridge-data");
  mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  // RSS on Linux, commit on Windows (spec §1).
  const bridgeRss = () => scan(ctx.marker).filter((p) => p.role === "mcp-bridge").reduce((a, p) => a + (p.commitKb ?? p.rssKb), 0) / 1024;
  // After 3 s, from the process table as it is then (Windows: a poll that started
  // after the wait), so a bridge that already exited is never summed (ticket 73).
  const settle = async () => { await new Promise((r) => setTimeout(r, 3000)); await settled(ctx.marker); return Math.round(bridgeRss()); };

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
      growth: growthBudget("mcp-bridge", { fromT: loadStart, untilT: loadEnd }),
      procPeaks: { "mcp-bridge": MEMORY.S5.procPeakMB },
      orphans: PROCESSES.orphans,
      extra: [
        { name: "bridge:reboot-cost-of-history", red: rebootRss - emptyRss > MEMORY.S5.rebootCostMB, value: rebootRss - emptyRss, budget: MEMORY.S5.rebootCostMB, unit: "MB" },
        { name: "bridge:task-failures", red: failures > MEMORY.S5.taskFailures, value: failures, budget: MEMORY.S5.taskFailures, unit: "tasks" },
      ],
    },
  };
}
