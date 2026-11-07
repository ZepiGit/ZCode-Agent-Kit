#!/usr/bin/env node
// Soak upstream for the memory loop: tests/mock-upstream.mjs extended with the
// failure modes a soak needs (slow/large streams, upstream errors, hangs). It
// never logs bodies (2,000 large payloads would only measure the disk), and it
// listens on loopback only.
//
// The behaviour is selected per request by a marker anywhere in the body:
//   [[mock:ok]]            default: one short answer (SSE when stream:true)
//   [[mock:big:<KB>]]      streamed answer of about <KB> kilobytes
//   [[mock:slow:<ms>]]     <ms> between SSE events (lets clients abort mid-stream)
//   [[mock:err:<status>]]  error status (500, 429, 529 …) with an Anthropic error body
//   [[mock:flaky:<status>]] first attempt of a body fails with <status>, retry succeeds
//   [[mock:hang]]          headers sent, then silence until the client gives up
//
// Prints `MOCK_READY <port>` on stdout once listening; `GET /__stats` reports counters.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 0);
const stats = { requests: 0, bytesIn: 0, byMode: {}, aborted: 0, open: 0 };
const flakySeen = new Map(); // body hash -> attempts (bounded below)

function modeOf(raw) {
  const m = raw.match(/\[\[mock:([a-z]+)(?::(\d+))?\]\]/);
  return m ? { kind: m[1], arg: m[2] === undefined ? null : Number(m[2]) } : { kind: "ok", arg: null };
}

function hash(raw) {
  let h = 0;
  for (let i = 0; i < raw.length; i += 97) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${raw.length}:${h}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function anthropicStream(res, model, { chunks = 3, chunkText = "mock-ok", gapMs = 0, signal }) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("message_start", { type: "message_start", message: { id: "msg_soak", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (let i = 0; i < chunks; i++) {
    if (signal.aborted) return;
    if (gapMs) await sleep(gapMs);
    if (signal.aborted) return;
    const ok = res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunkText } })}\n\n`);
    if (!ok) {
      await new Promise((r) => {
        const done = () => { res.off("drain", done); res.off("close", done); r(); };
        res.on("drain", done);
        res.on("close", done);
      });
    }
  }
  send("content_block_stop", { type: "content_block_stop", index: 0 });
  send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: chunks } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

function openaiStream(res, model, { chunks = 3, chunkText = "mock-ok" }) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const base = { id: "chatcmpl-soak", object: "chat.completion.chunk", created: 1, model };
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
  for (let i = 0; i < chunks; i++) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: chunkText }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: chunks, total_tokens: 10 + chunks } })}\n\n`);
  res.end("data: [DONE]\n\n");
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/__stats") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(stats));
    return;
  }
  const ac = new AbortController();
  stats.open += 1;
  res.on("close", () => { stats.open -= 1; if (!res.writableEnded) { stats.aborted += 1; ac.abort(); } });
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  stats.requests += 1;
  stats.bytesIn += raw.length;
  let body = {};
  try { body = JSON.parse(raw); } catch {}
  const mode = modeOf(raw);
  stats.byMode[mode.kind] = (stats.byMode[mode.kind] ?? 0) + 1;
  const model = body?.model ?? "mock";
  const anthropic = req.url.includes("/messages");

  let kind = mode.kind;
  if (kind === "flaky") {
    const key = hash(raw);
    const n = (flakySeen.get(key) ?? 0) + 1;
    flakySeen.set(key, n);
    if (flakySeen.size > 10_000) flakySeen.clear();
    kind = n === 1 ? "err" : "ok";
  }
  if (kind === "err") {
    const status = mode.arg ?? 500;
    res.writeHead(status, { "content-type": "application/json", ...(status === 429 ? { "retry-after": "0" } : {}) });
    res.end(JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : status === 529 ? "overloaded_error" : "api_error", message: `soak fixture ${status}` } }));
    return;
  }
  if (kind === "hang") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": hang\n\n");
    await new Promise((r) => { ac.signal.addEventListener("abort", r); setTimeout(r, 120_000).unref(); });
    try { res.end(); } catch {}
    return;
  }
  const big = kind === "big" ? Math.max(1, mode.arg ?? 64) : 0;
  const streamOpts = big
    ? { chunks: Math.ceil((big * 1024) / 1024), chunkText: "x".repeat(1000) + "\n" + "y".repeat(22) }
    : kind === "slow" ? { chunks: 40, chunkText: "slow ", gapMs: mode.arg ?? 100 } : {};
  if (body?.stream) {
    if (anthropic) await anthropicStream(res, model, { ...streamOpts, signal: ac.signal });
    else openaiStream(res, model, streamOpts);
    return;
  }
  const text = big ? "z".repeat(big * 1024) : "mock-ok";
  if (kind === "slow") await sleep(mode.arg ?? 100);
  res.writeHead(200, { "content-type": "application/json" });
  if (anthropic) {
    res.end(JSON.stringify({ id: "msg_soak", type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
  } else {
    res.end(JSON.stringify({ id: "chatcmpl-soak", object: "chat.completion", created: 1, model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  }
});

server.keepAliveTimeout = 5_000;
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`MOCK_READY ${server.address().port}\n`);
});
process.on("SIGTERM", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
