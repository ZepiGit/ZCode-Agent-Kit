// Local mock upstream for wire-payload verification (no real quota used).
// Logs every request (path + JSON body) to logs dir, answers with a minimal
// valid response for the Anthropic-messages and OpenAI chat-completions paths.
import http from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.MOCK_PORT || 18765);
const LOG = process.env.MOCK_LOG || join(import.meta.dirname, "mock-requests.jsonl");
mkdirSync(join(LOG, ".."), { recursive: true });

function log(entry) {
  appendFileSync(LOG, JSON.stringify(entry) + "\n");
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const ev of events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  res.end();
}

const server = http.createServer((req, res) => {
  let chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    try { body = JSON.parse(raw); } catch { body = raw; }
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      path: req.url,
      authHeader: req.headers.authorization
        ? req.headers.authorization.slice(0, 12) + "...<redacted>"
        : null,
      xApiKey: req.headers["x-api-key"]
        ? String(req.headers["x-api-key"]).slice(0, 12) + "...<redacted>"
        : null,
      body,
    };
    log(entry);
    console.log(`[mock] ${req.method} ${req.url} body-bytes=${raw.length}`);

    if (req.url.includes("/messages")) {
      const model = body?.model ?? "mock";
      const id = "msg_mock_1";
      const events = [
        { type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "mock-ok" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ];
      sse(res, events);
    } else if (req.url.includes("/chat/completions") || req.url.includes("/completions")) {
      sse(res, [
        { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1, model: body?.model ?? "mock", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
        { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1, model: body?.model ?? "mock", choices: [{ index: 0, delta: { content: "mock-ok" }, finish_reason: null }] },
        { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1, model: body?.model ?? "mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ]);
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT} log=${LOG}`);
});
