// S7 Disk-adjacent growth, against the real manager-started proxy:
//   A logs/proxy.log: bytes per request at the shipped log level, and whether
//     the 5 MB rotation can trigger while the proxy runs (the manager rotates
//     only in `start`; the proxy writes to the inherited fd for its lifetime);
//   B the in-memory responses store (shipped config: 1,000 entries, 64 MB
//     byte budget): heap and RSS when it is driven to its byte cap, judged on
//     the store's retained heap: the minimum of ≥ 30 /health readings 1 s
//     apart after a 5 s wait, minus the reading before the load (Round 17 Q1,
//     lib/retained-heap.mjs).
// (install.log is truncated per setup run; heal.log is capped at 2 x 64 KB;
// dump.ts is opt-in and stripped from the managed proxy's environment — all
// three are bounded by code, see the report.)
import { appendFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { startProxySession } from "../lib/proxy-session.mjs";
import { MEMORY, PROCESSES, PROXY_COMMIT_BACKSTOP } from "../lib/budgets.mjs";
import { heapAtCapLine, readHeapSeries, storeHeapAtCap } from "../lib/retained-heap.mjs";

export async function run(ctx) {
  const session = await startProxySession(ctx);
  const { kit } = session;
  const logFile = join(kit.logDir, "proxy.log");
  const size = () => statSync(logFile).size;
  const headers = { authorization: `Bearer ${kit.key}`, "content-type": "application/json" };
  const post = (path, body) => fetch(`${kit.base}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.text()).catch(() => "");

  // A. Log growth per request.
  const a0 = size();
  const nA = ctx.long ? 20_000 : 2_000;
  for (let i = 0; i < nA; i += 4) {
    await Promise.all([
      post("/v1/chat/completions", { model: "glm-5.3", messages: [{ role: "user", content: `[[mock:ok]] ${i}` }] }),
      post("/v1/messages", { model: "glm-5.3-flash", max_tokens: 16, stream: true, messages: [{ role: "user", content: `[[mock:ok]] ${i}` }] }),
      post("/v1/messages", { model: "glm-5.3", max_tokens: 16, messages: [{ role: "user", content: `[[mock:err:500]] ${i}` }] }),
      post("/v1/messages", { model: "glm-5.3", max_tokens: 16, messages: [{ role: "user", content: `[[mock:err:429]] ${i}` }] }),
    ]);
    ctx.setProgress(i + 4);
  }
  const bytesPerRequest = (size() - a0) / nA;
  // Push the file past the 5 MB rotation threshold while the proxy runs: the
  // filler is appended by us (no secret content), the proxy keeps logging.
  appendFileSync(logFile, `${"#".repeat(1023)}\n`.repeat(6 * 1024));
  const beforeMore = size();
  for (let i = 0; i < 400; i++) await post("/v1/messages", { model: "glm-5.3", max_tokens: 16, messages: [{ role: "user", content: `[[mock:err:500]] tail ${i}` }] });
  const whileRunning = size();
  ctx.note("proxyLog", { requests: nA, bytesPerRequest: Number(bytesPerRequest.toFixed(1)), mbPer100kRequests: Number(((bytesPerRequest * 100_000) / 1048576).toFixed(1)), sizeAfterFillerMB: Number((beforeMore / 1048576).toFixed(2)), sizeWhileRunningMB: Number((whileRunning / 1048576).toFixed(2)), rotatedWhileRunning: whileRunning < beforeMore });

  // B. Responses store driven to its byte cap (64 KB inputs, unchained).
  const h0 = (await kit.health())?.details ?? {};
  const input = "r".repeat(64 * 1024);
  const nB = ctx.long ? 4000 : 1500;
  for (let i = 0; i < nB; i += 4) {
    await Promise.all([0, 1, 2, 3].map((k) => post("/v1/responses", { model: "glm-5.3", input: `${input} [[mock:ok]] ${i + k}` })));
    ctx.setProgress(nA + i + 4);
  }
  await new Promise((r) => setTimeout(r, 5000));
  // The store's retained heap (Round 17 Q1): ≥ 30 /health readings 1 s apart, judged on their minimum.
  const series = await readHeapSeries(() => kit.health());
  const h1 = series[0] ?? {};
  ctx.note("responsesStore", { entriesSent: nB, inputKB: 64, heapBeforeMB: h0.heapUsedMB, heapAfterMB: h1.heapUsedMB, rssBeforeMB: h0.rssMB, rssAfterMB: h1.rssMB, heapSeriesMB: series.map((x) => x?.heapUsedMB ?? null), rssLastMB: series.at(-1)?.rssMB ?? null, configuredByteBudgetMB: 64 });
  ctx.log(`proxy.log ${bytesPerRequest.toFixed(0)} B/request, ${(whileRunning / 1048576).toFixed(1)} MB while running (rotated: ${whileRunning < beforeMore}); responses store heap ${h0.heapUsedMB} -> ${h1.heapUsedMB} MB (series of ${series.length}: ${series.map((x) => x?.heapUsedMB ?? "—").join(" ")}), rss ${h0.rssMB} -> ${h1.rssMB} … ${series.at(-1)?.rssMB} MB`);
  // The proxy's early output (ticket 34): ≤ 1 MB plus a bounded overshoot,
  // taken here as one 64 KB write. Absent today, which is within budget.
  const earlyLog = join(kit.logDir, "proxy.early.log");
  const earlyBytes = existsSync(earlyLog) ? statSync(earlyLog).size : 0;
  ctx.note("earlyLog", { exists: existsSync(earlyLog), bytes: earlyBytes });
  await session.stop();
  // After the stop: an incomplete series is a harness failure (thrown), with no proxy left running.
  const heapAtCap = storeHeapAtCap({ before: h0, series, budgetMB: MEMORY.S7.responsesStoreHeapMB });
  ctx.log(heapAtCapLine(heapAtCap));
  const MiB = 1048576;
  return {
    budgets: {
      procPeaks: { proxy: MEMORY.S1.peakMB },
      commitBackstop: PROXY_COMMIT_BACKSTOP, // paced (Round 7 Q1)
      orphans: PROCESSES.orphans,
      extra: [
        { name: "proxy.log:bounded-while-running", red: whileRunning > MEMORY.S7.proxyLogMB * MiB, value: Number((whileRunning / MiB).toFixed(2)), budget: MEMORY.S7.proxyLogMB, unit: "MB" },
        { name: "proxy.early.log:bounded", red: earlyBytes > MEMORY.S7.earlyLogMB * MiB + 64 * 1024, value: Number((earlyBytes / MiB).toFixed(2)), budget: MEMORY.S7.earlyLogMB, unit: "MB (+64 KB overshoot)" },
        heapAtCap,
      ],
    },
  };
}
