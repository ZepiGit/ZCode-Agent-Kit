// The S3 OMP stub-host leg's checks (ADR-0013 cond 3 + 4, spec §6 (a) and §18).
//
// Each round starts OMP_LEG.hosts stub Bun hosts of one installation together;
// each host runs the generated OMP extension's `before_provider_request` hook
// once. Per host the scenario records:
//   preflights  OMP preflight processes the host spawned (its children);
//   causeLines  the fixed-vocabulary `[zcode-autostart] <cause>: …` lines it printed;
//   costMB      its own RSS (commit on Windows) above its idle baseline while
//               the hook ran, or null when it never reported one;
//   killed      the round killed it (the starter, with its process tree);
//   finished    its hook returned.
// A starter is a surviving host that spawned a preflight; a waiter spawned none.
// The checks:
//   omp:concurrent-preflights  ≤ 1 preflight process alive at any moment;
//   omp:waiter-cost            every waiter ≤ 5 MB (starters reported only);
//   omp:waiter-cause-lines     every waiter printed a surviving starter's cause
//                              lines whenever that starter printed any, and a
//                              waiter with no surviving starter got none at all;
//   omp:hosts-finished         no surviving host is still waiting;
//   omp:starter-killed         a killed-starter round really killed a starter.
import { OMP_LEG } from "./budgets.mjs";

const CAUSE_LINE = /^\[zcode-autostart\] ([a-z0-9-]+): /;

/** The cause lines in a host's stderr: categories of the warning vocabulary only (failure categories are not cause lines). */
export function causeLinesOf(stderr, warnings) {
  return String(stderr).split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => {
    const cause = CAUSE_LINE.exec(l)?.[1];
    return cause !== undefined && Object.hasOwn(warnings, cause);
  });
}

const roleOf = (h) => (h.killed ? "killed" : h.preflights > 0 ? "starter" : "waiter");
const mb = (v) => (typeof v === "number" ? `+${Number(v.toFixed(1))} MB` : "unmeasured");

export function ompLegChecks(rounds, budget = OMP_LEG) {
  const worstConcurrent = Math.max(0, ...rounds.map((r) => r.maxConcurrentPreflights ?? 0));
  const waiters = [];
  const missingCauses = [];
  const unfinished = [];
  for (const r of rounds) {
    const alive = r.hosts.filter((h) => !h.killed);
    const starters = alive.filter((h) => h.preflights > 0);
    const sets = starters.map((h) => h.causeLines).filter((s) => s.length > 0);
    for (const h of alive) {
      if (!h.finished) unfinished.push(`${r.name} host ${h.id} (pid ${h.pid})`);
      if (h.preflights > 0) continue;
      waiters.push({ round: r.name, host: h });
      const ok = starters.length > 0 && (sets.length === 0 || sets.some((s) => s.every((line) => h.causeLines.includes(line))));
      if (!ok) missingCauses.push(`${r.name} host ${h.id}: ${starters.length ? `printed ${h.causeLines.length} of the starter's cause lines` : "waited, but no surviving starter ran a preflight"}`);
    }
  }
  const costs = waiters.map((w) => w.host.costMB);
  const unmeasured = costs.some((c) => typeof c !== "number");
  const worstCost = costs.filter((c) => typeof c === "number").reduce((a, c) => Math.max(a, c), 0);
  const notKilled = rounds.filter((r) => r.killExpected && !r.hosts.some((h) => h.killed));
  return [
    {
      name: "omp:concurrent-preflights", red: worstConcurrent > budget.concurrentPreflights, value: worstConcurrent, budget: budget.concurrentPreflights, unit: "procs",
      detail: rounds.map((r) => `${r.name}: max ${r.maxConcurrentPreflights} at once, ${r.hosts.reduce((a, h) => a + h.preflights, 0)} spawned`),
    },
    {
      name: "omp:waiter-cost", red: unmeasured || worstCost > budget.waiterCostMB, value: waiters.length ? (unmeasured ? "unmeasured" : Number(worstCost.toFixed(1))) : "no waiter", budget: budget.waiterCostMB, unit: "MB/host",
      detail: rounds.flatMap((r) => r.hosts.map((h) => `${r.name} host ${h.id} ${roleOf(h)} ${mb(h.costMB)}`)),
    },
    { name: "omp:waiter-cause-lines", red: missingCauses.length > 0, value: missingCauses.length, budget: 0, unit: "waiters without", detail: missingCauses },
    { name: "omp:hosts-finished", red: unfinished.length > 0, value: unfinished.length, budget: 0, unit: "hosts still waiting", detail: unfinished },
    { name: "omp:starter-killed", red: notKilled.length > 0, value: notKilled.length, budget: 0, unit: "rounds without a kill", detail: notKilled.map((r) => r.name) },
  ];
}
