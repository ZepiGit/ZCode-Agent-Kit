// Turns sampler rows into a summary and a RED/GREEN verdict against budgets.
//
// RED conditions (any one):
//   - slope: RSS growth after warm-up above budget (% per 1,000 work units, or
//     MB per minute for time-driven scenarios), AND a trend: either the last 3
//     windows each rise (> 1 % apart) or the last window sits >= 10 % above the
//     first post-warm-up window (a slow leak rises less than 1 % per window).
//     Both must hold, so a GC sawtooth or an allocator plateau is not a leak;
//   - peak: role peak RSS above budget;
//   - steady: median RSS of a role after warm-up above budget;
//   - peak: summed role RSS at any sample above budget (S3 part a: kit total);
//   - procPeak: one process's own peak (RSS or VmHWM) above its role budget
//     (S3 part b: per-role targets);
//   - count: more processes of a role than budgeted at any sample;
//   - perParent: more processes of a role under one parent at any sample
//     (≤ 1 solver process per proxy);
//   - observed: a count the scenario took at a defined moment above budget
//     (0 solver processes after the proxy is SIGKILLed / after an idle exit);
//   - orphans: any marked process alive after the scenario stopped it.

const MB = 1024;
// The kit's own footprint: everything but the test fixtures around it.
const NOT_KIT = new Set(["mock-upstream", "scenario", "fake-harness"]);
const inRole = (p, role) => role === "*" || (role === "kit" ? !NOT_KIT.has(p.role) : p.role === role);

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Least-squares slope of y over x. */
export function slope(points) {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const d = n * sxx - sx * sx;
  return d === 0 ? 0 : (n * sxy - sx * sy) / d;
}

/** Per-row totals for a role: { t, progress, rssMB, heapMB, count, maxProcMB, fds, threads }. */
export function roleSeries(rows, role) {
  return rows.map((r) => {
    const procs = r.procs.filter((p) => inRole(p, role));
    const heaps = procs.map((p) => p.heapMB).filter((h) => typeof h === "number");
    return {
      t: r.t,
      progress: r.progress,
      rssMB: procs.reduce((a, p) => a + p.rssKb, 0) / MB,
      heapMB: heaps.length ? heaps.reduce((a, b) => a + b, 0) : null,
      count: procs.length,
      maxProcMB: procs.reduce((a, p) => Math.max(a, p.rssKb), 0) / MB,
      fds: procs.reduce((a, p) => a + p.fds, 0),
      threads: procs.reduce((a, p) => a + p.threads, 0),
    };
  });
}

/**
 * Growth analysis after warm-up. `axis` "progress" uses the work counter
 * (growth % per 1,000 units); "time" uses MB per minute.
 */
export function growth(series, { warmupFraction = 0.25, windows = 6, axis = "progress" } = {}) {
  const live = series.filter((s) => s.count > 0);
  if (live.length < 6) return { samples: live.length, insufficient: true };
  const start = Math.floor(live.length * warmupFraction);
  const post = live.slice(start);
  const meanMB = post.reduce((a, s) => a + s.rssMB, 0) / post.length;
  const perK = slope(post.map((s) => [s.progress / 1000, s.rssMB]));
  const perMin = slope(post.map((s) => [s.t / 60_000, s.rssMB]));
  const size = Math.max(1, Math.floor(post.length / windows));
  const medians = [];
  for (let i = 0; i < windows; i++) {
    const chunk = post.slice(i * size, i === windows - 1 ? post.length : (i + 1) * size);
    if (chunk.length) medians.push(Number(median(chunk.map((s) => s.rssMB)).toFixed(1)));
  }
  // Trailing rising run: a leak is growth that is still going at the END of
  // the run. A plateau after allocator warm-up (rise, rise, flat) is not.
  // 1 % of the level is the noise floor between windows.
  let rising = 0;
  for (let i = medians.length - 1; i > 0 && medians[i] > medians[i - 1] * 1.01; i--) rising += 1;
  const maxRising = rising;
  const heapPost = post.filter((s) => s.heapMB !== null);
  return {
    samples: live.length,
    warmupSamples: start,
    meanMB: Number(meanMB.toFixed(1)),
    firstPostMB: Number(post[0].rssMB.toFixed(1)),
    lastMB: Number(post[post.length - 1].rssMB.toFixed(1)),
    slopeMBPer1k: Number(perK.toFixed(2)),
    growthPctPer1k: meanMB ? Number(((perK / meanMB) * 100).toFixed(2)) : 0,
    slopeMBPerMin: Number(perMin.toFixed(2)),
    windowMediansMB: medians,
    risingWindows: maxRising + (maxRising ? 1 : 0), // windows in the trailing strictly rising run
    netRisePct: medians.length > 1 && medians[0] ? Number((((medians.at(-1) - medians[0]) / medians[0]) * 100).toFixed(1)) : 0,
    heapSlopeMBPer1k: heapPost.length > 5 ? Number(slope(heapPost.map((s) => [s.progress / 1000, s.heapMB])).toFixed(2)) : null,
    axis,
  };
}

export function summarize(rows, roles) {
  const out = {};
  for (const role of roles) {
    const series = roleSeries(rows, role);
    const live = series.filter((s) => s.count > 0);
    out[role] = {
      peakMB: Number(Math.max(0, ...series.map((s) => s.rssMB)).toFixed(1)),
      peakProcMB: Number(Math.max(0, ...series.map((s) => s.maxProcMB)).toFixed(1)),
      // VmHWM: the kernel's high-water mark, catches spikes between samples.
      peakHwmMB: Number((Math.max(0, ...rows.flatMap((r) => r.procs.filter((p) => inRole(p, role)).map((p) => p.hwmKb))) / MB).toFixed(1)),
      maxCount: Math.max(0, ...series.map((s) => s.count)),
      maxFds: Math.max(0, ...series.map((s) => s.fds)),
      maxThreads: Math.max(0, ...series.map((s) => s.threads)),
      distinctPids: new Set(rows.flatMap((r) => r.procs.filter((p) => inRole(p, role)).map((p) => p.key))).size,
      peakHeapMB: live.some((s) => s.heapMB !== null) ? Math.max(...live.map((s) => s.heapMB ?? 0)) : null,
    };
  }
  return out;
}

/**
 * budgets: {
 *   growth?: { role, maxPctPer1k?, maxMBPerMin?, risingWindows: 3, axis, warmupFraction },
 *   steady?: { role, maxMB, fromT?, untilT?, warmupFraction? },
 *   peaks?: { [role]: MB } (summed per sample), procPeaks?: { [role]: MB } (per process, incl. VmHWM),
 *   counts?: { [role]: n }, perParent?: [{ role, max }], observed?: [{ name, label, role, max }],
 *   orphans?: 0, extra?: [precomputed checks] }
 * observations: [{ label, counts: { [role]: n } }] taken by the scenario (ctx.observe).
 */
export function verdict(rows, budgets, { orphans = [], observations = [] } = {}) {
  const roles = new Set(["*", "kit"]);
  for (const r of rows) for (const p of r.procs) roles.add(p.role);
  const summary = summarize(rows, [...roles]);
  const checks = [];
  if (budgets.growth) {
    for (const g of [].concat(budgets.growth)) {
      const window = rows.filter((r) => r.t >= (g.fromT ?? 0) && r.t <= (g.untilT ?? Infinity));
      const res = growth(roleSeries(window, g.role), g);
      const metric = g.axis === "time" ? res.slopeMBPerMin : res.growthPctPer1k;
      const limit = g.axis === "time" ? g.maxMBPerMin : g.maxPctPer1k;
      const trend = (res.risingWindows ?? 0) >= (g.risingWindows ?? 3) || (res.netRisePct ?? 0) >= (g.netRisePct ?? 10);
      const red = !res.insufficient && metric > limit && trend;
      checks.push({ name: `growth:${g.role}`, red, value: metric, budget: limit, unit: g.axis === "time" ? "MB/min" : "%/1k", trend, detail: res });
    }
  }
  for (const [role, limit] of Object.entries(budgets.peaks ?? {})) {
    const value = summary[role]?.peakMB ?? 0;
    checks.push({ name: `peak:${role}`, red: value > limit, value, budget: limit, unit: "MB" });
  }
  for (const [role, limit] of Object.entries(budgets.procPeaks ?? {})) {
    // Per-process peak including spikes between samples (VmHWM).
    const value = Math.max(summary[role]?.peakProcMB ?? 0, summary[role]?.peakHwmMB ?? 0);
    checks.push({ name: `procPeak:${role}`, red: value > limit, value, budget: limit, unit: "MB" });
  }
  for (const [role, limit] of Object.entries(budgets.counts ?? {})) {
    const value = summary[role]?.maxCount ?? 0;
    checks.push({ name: `count:${role}`, red: value > limit, value, budget: limit, unit: "procs" });
  }
  for (const s of [].concat(budgets.steady ?? [])) {
    // Steady-state level: median RSS after warm-up inside the load window.
    const live = roleSeries(rows.filter((r) => r.t >= (s.fromT ?? 0) && r.t <= (s.untilT ?? Infinity)), s.role).filter((x) => x.count > 0);
    const post = live.slice(Math.floor(live.length * (s.warmupFraction ?? 0.25)));
    const value = Number(median(post.map((x) => x.rssMB)).toFixed(1));
    checks.push({ name: `steady:${s.role}`, red: post.length > 0 && value > s.maxMB, value, budget: s.maxMB, unit: "MB" });
  }
  for (const p of budgets.perParent ?? []) {
    // At every sample: processes of the role sharing one parent (e.g. solvers per proxy).
    let value = 0;
    for (const r of rows) {
      const perParent = new Map();
      for (const x of r.procs) if (x.role === p.role) perParent.set(x.ppid, (perParent.get(x.ppid) ?? 0) + 1);
      for (const n of perParent.values()) value = Math.max(value, n);
    }
    checks.push({ name: `perParent:${p.role}`, red: value > p.max, value, budget: p.max, unit: "procs/parent" });
  }
  for (const o of budgets.observed ?? []) {
    // Counts the scenario took at a defined moment (after a SIGKILL, after an idle exit).
    // A budget with no matching observation is red: the scenario never checked.
    const seen = observations.filter((x) => x.label === o.label || x.label.startsWith(`${o.label}:`));
    const value = seen.length ? Math.max(...seen.map((x) => x.counts[o.role] ?? 0)) : null;
    checks.push({ name: o.name, red: value === null || value > o.max, value: value ?? "not observed", budget: o.max, unit: "procs", detail: seen.map((x) => `${x.label}=${x.counts[o.role] ?? 0}`) });
  }
  if (budgets.orphans !== undefined) {
    checks.push({ name: "orphans", red: orphans.length > budgets.orphans, value: orphans.length, budget: budgets.orphans, unit: "procs", detail: orphans.map((o) => `${o.pid} ${o.role} ${o.cmd}`) });
  }
  for (const extra of budgets.extra ?? []) checks.push(extra);
  return { red: checks.some((c) => c.red), checks, summary };
}
