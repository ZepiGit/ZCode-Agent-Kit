// S1 Proxy steady state: >= 2,000 mixed requests (short) / 20,000 (long) over
// /v1/chat/completions, /v1/messages and /v1/responses against the real proxy
// started by the real manager. Mix: streaming and non-streaming, clients that
// abort mid-stream, clients that stop reading and then disconnect, upstream
// errors and retries, large text payloads and image payloads for glm-5.3-flash,
// and previous_response_id chains.
//
// Variants (--variant):
//   burstN   N concurrent ~10.8 MB bodies at once, 3 x N requests (HWM budget:
//            400 MB at 16, 600 MB at 32, else the 250 MB peak)
//   bigbody  only concurrent large/image payloads (peak per in-flight bytes)
//   stalled  only stop-reading-then-disconnect streaming clients
import net from "node:net";
import { startProxySession } from "../lib/proxy-session.mjs";
import { MEMORY, PROCESSES, PROXY_COMMIT_BACKSTOP, growthBudget } from "../lib/budgets.mjs";

function prng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A deterministic, PNG-headed base64 blob (content is irrelevant to the proxy).
function imageB64(kb) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(kb * 1024, 7);
  return Buffer.concat([head, body]).toString("base64");
}

const MIX = [
  ["chat-stream", 20], ["chat", 14], ["messages-stream", 20], ["messages", 10],
  ["responses", 8], ["responses-stream", 6], ["abort-mid-stream", 7], ["stalled-reader", 2],
  ["upstream-500", 3], ["upstream-flaky", 3], ["upstream-429", 2], ["large-text", 3], ["image", 2],
];

function pick(rand, mix) {
  const total = mix.reduce((a, [, w]) => a + w, 0);
  let x = rand() * total;
  for (const [name, w] of mix) { if ((x -= w) < 0) return name; }
  return mix[0][0];
}

export async function run(ctx) {
  const session = await startProxySession(ctx);
  const { kit } = session;
  const headers = { authorization: `Bearer ${kit.key}`, "content-type": "application/json" };
  const rand = prng(42);
  const burst = Number((ctx.variant ?? "").match(/^burst(\d+)$/)?.[1] ?? 0);
  const heavy = ctx.variant === "bigbody" || burst > 0;
  // The paced short runs are 6,000 requests. Mixed: the first half is warm-up
  // (the allocator and the bounded responses store fill over the first ~3,000
  // requests; the long run plateaus from there on), so a 3,000-request run is
  // all warm-up and its slope cannot tell warm-up from a leak. Stalled: no
  // warm-up shape, but a ±15 % GC sawtooth, so the slope needs the length.
  const total = burst ? burst * 3 : ctx.variant === "bigbody" ? (ctx.long ? 1200 : 240) : ctx.variant === "stalled" ? (ctx.long ? 20_000 : 6_000) : (ctx.long ? 30_000 : 6_000);
  const concurrency = burst || (ctx.variant === "bigbody" ? 16 : 8);
  const big = imageB64(heavy ? 8 * 1024 : 1024); // 8 MB / 1 MB images
  const largeText = "lorem ipsum dolor sit amet ".repeat(heavy ? 400_000 : 20_000); // ~10.8 MB / ~540 KB
  const chains = [];
  const outcomes = {};
  const count = (k) => { outcomes[k] = (outcomes[k] ?? 0) + 1; };

  const post = async (path, body, signal) => fetch(`${kit.base}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });

  async function stalledReader(i) {
    // Raw socket: send a streaming request for a ~4 MB answer, never read,
    // then disconnect. Exercises the server's drain wait on a dead client.
    const body = JSON.stringify({ model: "glm-5.3", max_tokens: 64, stream: true, messages: [{ role: "user", content: `[[mock:big:4096]] stalled ${i}` }] });
    await new Promise((resolveSock) => {
      const sock = net.connect(kit.port, "127.0.0.1", () => {
        sock.write(`POST /v1/messages HTTP/1.1\r\nhost: 127.0.0.1:${kit.port}\r\nauthorization: Bearer ${kit.key}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        sock.pause();
        setTimeout(() => { sock.destroy(); resolveSock(); }, 400);
      });
      sock.on("error", () => resolveSock());
    });
  }

  async function one(i, kind) {
    const model = kind === "image" || i % 3 === 0 ? "glm-5.3-flash" : "glm-5.3";
    const tag = (m) => `[[mock:${m}]] request ${i}`;
    switch (kind) {
      case "chat": return (await post("/v1/chat/completions", { model, messages: [{ role: "user", content: tag("ok") }] })).text();
      case "chat-stream": return (await post("/v1/chat/completions", { model, stream: true, messages: [{ role: "user", content: tag(i % 10 === 0 ? "big:256" : "ok") }] })).text();
      case "messages": return (await post("/v1/messages", { model, max_tokens: 64, messages: [{ role: "user", content: tag("ok") }] })).text();
      case "messages-stream": return (await post("/v1/messages", { model, max_tokens: 64, stream: true, messages: [{ role: "user", content: tag(i % 10 === 0 ? "big:256" : "ok") }] })).text();
      case "responses":
      case "responses-stream": {
        let chain = chains[i % 16];
        if (!chain || chain.length >= 30) chain = chains[i % 16] = [];
        const prev = chain.at(-1);
        const input = (i % 7 === 0 ? "context ".repeat(8_000) : "") + tag("ok");
        const res = await post("/v1/responses", { model, input, stream: kind === "responses-stream", ...(prev ? { previous_response_id: prev } : {}) });
        const text = await res.text();
        const id = kind === "responses" ? (() => { try { return JSON.parse(text).id; } catch { return null; } })()
          : (text.match(/"id":"(resp_[^"]+)"/) ?? [])[1];
        if (id) chain.push(id);
        return text;
      }
      case "abort-mid-stream": {
        const ac = new AbortController();
        const res = await post("/v1/messages", { model, max_tokens: 64, stream: true, messages: [{ role: "user", content: tag("slow:50") }] }, ac.signal);
        const reader = res.body.getReader();
        await reader.read();
        ac.abort();
        try { await reader.cancel(); } catch {}
        return "";
      }
      case "stalled-reader": return stalledReader(i);
      case "upstream-500": return (await post("/v1/messages", { model, max_tokens: 64, messages: [{ role: "user", content: tag("err:500") }] })).text();
      case "upstream-flaky": return (await post("/v1/chat/completions", { model, stream: true, messages: [{ role: "user", content: `[[mock:flaky:529]] unique ${i} ${rand()}` }] })).text();
      case "upstream-429": return (await post("/v1/messages", { model, max_tokens: 64, messages: [{ role: "user", content: tag("err:429") }] })).text();
      case "large-text": return (await post("/v1/messages", { model, max_tokens: 64, messages: [{ role: "user", content: largeText + tag("ok") }] })).text();
      case "image": return (await post("/v1/chat/completions", { model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: tag("ok") }, { type: "image_url", image_url: { url: `data:image/png;base64,${big}` } }] }] })).text();
      default: throw new Error(kind);
    }
  }

  const mix = burst ? [["large-text", 1]] : ctx.variant === "bigbody" ? [["large-text", 1], ["image", 1]] : ctx.variant === "stalled" ? [["stalled-reader", 1]] : MIX;
  const plan = Array.from({ length: total }, (_, i) => pick(rand, mix));
  // Paced, so the loop sees enough samples per 1,000 requests to tell a trend
  // from a GC sawtooth (unpaced, 2,400 requests finish in ~8 s).
  const rps = burst ? Infinity : ctx.variant === "bigbody" ? 4 : 25;
  let next = 0;
  const loadStart = ctx.elapsed();
  const paceStart = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < plan.length) {
      const i = next++;
      const due = paceStart + (i * 1000) / rps - Date.now();
      if (due > 0) await new Promise((r) => setTimeout(r, due));
      try { await one(i, plan[i]); count(`${plan[i]}:ok`); }
      catch (err) { count(`${plan[i]}:${err?.name === "AbortError" ? "aborted" : "error"}`); }
      ctx.addProgress(1);
    }
  }));
  const loadEnd = ctx.elapsed();
  ctx.note("requests", total);
  ctx.note("outcomes", outcomes);
  ctx.note("loadWindowMs", [loadStart, loadEnd]);
  ctx.note("mockStats", await session.mock.stats());
  const idleMs = ctx.long ? 60_000 : 15_000;
  ctx.log(`load done (${total} requests in ${Math.round((loadEnd - loadStart) / 1000)} s); idle ${idleMs / 1000} s`);
  await new Promise((r) => setTimeout(r, idleMs));
  const health = await kit.health();
  ctx.note("healthAfterIdle", health?.details ?? null);
  await session.stop();
  const window = { fromT: loadStart, untilT: loadEnd, warmupFraction: ctx.long ? 0.2 : ctx.variant === "stalled" ? 0.25 : 0.5 };
  const mixed = !ctx.variant;
  return {
    budgets: {
      // Bursts and big bodies are spikes, judged by their peak; growth and the
      // steady level belong to the paced runs (steady: the mixed load only).
      ...(heavy ? {} : { growth: growthBudget("proxy", window) }),
      ...(mixed ? { steady: { role: "proxy", maxMB: MEMORY.S1.steadyMB, ...window } } : {}),
      // Paced runs only (short, stalled): Windows proxy commit ≤ 512 MB per sample (Round 7 Q1).
      ...(heavy ? {} : { commitBackstop: PROXY_COMMIT_BACKSTOP }),
      procPeaks: { proxy: MEMORY.S1.burstPeakMB[ctx.variant] ?? MEMORY.S1.peakMB },
      counts: { proxy: PROCESSES.proxiesPerInstallation },
      orphans: PROCESSES.orphans,
    },
  };
}
