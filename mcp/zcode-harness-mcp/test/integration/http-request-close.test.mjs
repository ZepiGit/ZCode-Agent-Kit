/**
 * HTTP mode builds a server and a transport per request. They must be closed
 * exactly once on every path: after the answer, when the client leaves while
 * a handler is still running (the response closes before the transport's
 * handleRequest returns), and when setting the request up fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openHttpRequestServers, serveHttp } from "../../dist/mcp/server.js";

const KEY = "request-close-key";
const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}` };

async function freePort() {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

function post(port, body) {
  let req;
  const answer = new Promise((resolve) => {
    req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/mcp", headers: HEADERS, agent: false }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", (err) => resolve({ status: 0, error: err.code }));
    req.end(JSON.stringify(body));
  });
  return { answer, abort: () => req.destroy() };
}

async function until(what, predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`${what} (open request servers: ${openHttpRequestServers()})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("a per-request server and transport are closed on every path", async (t) => {
  const port = await freePort();
  // The read of this task's result blocks until the test releases it.
  let running = 0;
  let release;
  const blocked = new Promise((r) => { release = r; });
  let failSetup = false;
  const opts = {
    toolCtx: {},
    resourceCtx: { tasks: { list: () => [], buildResult: async () => { running += 1; await blocked; return { done: true }; } } },
    get serverInfo() {
      if (failSetup) throw new Error("setup failed on purpose");
      return { name: "test", version: "0.0.0" };
    },
  };
  const closeServer = await serveHttp(opts, "127.0.0.1", port, KEY);
  t.after(async () => { release(); await closeServer(); });
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  const slowRead = { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "zcode://tasks/task-1/result" } };

  await t.test("after an answer", async () => {
    assert.equal(openHttpRequestServers(), 0);
    const answered = await post(port, ping).answer;
    assert.equal(answered.status, 200, JSON.stringify(answered));
    await until("the answered request released its server", () => openHttpRequestServers() === 0);
  });

  await t.test("when the client leaves while the handler is still running", async () => {
    const pending = post(port, slowRead);
    await until("the read handler started", () => running === 1);
    assert.equal(openHttpRequestServers(), 1, "the request holds one server while its handler runs");
    pending.abort();
    // Released at the disconnect, not when the handler finishes: the handler is still blocked here.
    await until("the abandoned request released its server while its handler was still running", () => openHttpRequestServers() === 0);
    assert.equal((await pending.answer).status, 0, "the client got no answer");
    release();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(openHttpRequestServers(), 0, "the late handler result closes nothing a second time");
  });

  await t.test("when setting the request up fails", async () => {
    failSetup = true;
    const failed = await post(port, ping).answer;
    failSetup = false;
    assert.deepEqual(failed, { status: 500, body: "internal error" });
    await until("the failed request left nothing open", () => openHttpRequestServers() === 0);
  });

  await t.test("after many requests, some of them abandoned", async () => {
    for (let i = 0; i < 12; i += 1) {
      const request = post(port, { ...ping, id: i });
      if (i % 4 === 3) request.abort();
      await request.answer;
    }
    await until("every request released its server", () => openHttpRequestServers() === 0);
    assert.equal((await post(port, ping).answer).status, 200, "the bridge still answers");
  });
});
