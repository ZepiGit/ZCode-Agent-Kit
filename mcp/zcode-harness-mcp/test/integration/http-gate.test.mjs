/** HTTP transport gate tests: auth, host and origin checks with a real server. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { serveHttp } from "../../dist/mcp/server.js";

const KEY = "unit-test-key";
let port = 0;

function request({ headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path: "/mcp", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("http gate: no auth / wrong auth / correct auth / bad host / bad origin", async () => {
  // find a free port with a probe server, then start the real bridge on it
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const closeServer = await serveHttp(
    // The gates under test fire BEFORE any MCP handling; a stub context is
    // enough — a request that passes the gates reaches the (stub) MCP layer,
    // a request blocked by a gate gets 401/403/413.
    { toolCtx: {}, resourceCtx: {}, serverInfo: { name: "test", version: "0.0.0" } },
    "127.0.0.1",
    port,
    KEY,
  );
  try {
    await runGateAssertions();
  } finally {
    await closeServer();
  }
});

async function runGateAssertions() {
  const mcpBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  const gatePassed = (r) => r.status !== 401 && r.status !== 403 && r.status !== 413;

  // 1. no auth → 401, before anything else
  const noAuth = await request({ headers: { "content-type": "application/json" }, body: mcpBody });
  assert.equal(noAuth.status, 401, "unauthenticated request must be rejected");
  // 2. wrong auth → 401
  const badAuth = await request({ headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: mcpBody });
  assert.equal(badAuth.status, 401);
  // 3. correct auth + host → passes the gate (stub context yields 5xx)
  const ok = await request({
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: mcpBody,
  });
  assert.ok(gatePassed(ok), `authenticated request must reach the MCP layer (got ${ok.status})`);
  // 4. spoofed Host header (DNS rebinding) → 403 even with valid auth
  const rebinding = await request({
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, host: "attacker.example:1" },
    body: mcpBody,
  });
  assert.equal(rebinding.status, 403, "foreign Host header must be rejected");
  // 5. evil origin that STARTSWITH 127.0.0.1 (the old bypass) → 403
  const evilOrigin = await request({
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      origin: `http://127.0.0.1.evil.example:${port}`,
    },
    body: mcpBody,
  });
  assert.equal(evilOrigin.status, 403, "origin must be checked exactly, not by prefix");
  // 6. legit origin passes the gate
  const okOrigin = await request({
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      origin: `http://127.0.0.1:${port}`,
    },
    body: mcpBody,
  });
  assert.ok(gatePassed(okOrigin), `legit origin must reach the MCP layer (got ${okOrigin.status})`);
}

// ZAK-010: the 4 MiB body bound must hold on the ACTUAL stream — a chunked
// request without Content-Length used to bypass the declared-size check.
test("http gate: oversized chunked body without content-length is refused with 413", async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const closeServer = await serveHttp(
    { toolCtx: {}, resourceCtx: {}, serverInfo: { name: "test", version: "0.0.0" } },
    "127.0.0.1",
    port,
    KEY,
  );
  try {
    // 5 MiB chunked POST, no content-length → must hit the streaming
    // byte bound. The server refuses as soon as the limit is crossed
    // (413 + Connection: close + teardown); depending on timing the client
    // either reads the 413 or observes the connection reset mid-upload —
    // both mean "refused, never processed".
    const oversized = await requestChunked({
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, connection: "close" },
      chunkCount: 5 * 1024 * 1024 / (64 * 1024),
      chunkSize: 64 * 1024,
    });
    assert.ok(
      oversized.status === 413 || oversized.reset === true,
      `oversized chunked body must be refused early (got status ${oversized.status}, reset ${oversized.reset})`,
    );

    // A chunked body under the bound still reaches the MCP layer (chunked
    // transfer itself is not treated as an error).
    const underLimit = await requestChunked({
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, connection: "close" },
      chunkCount: 4,
      chunkSize: 64 * 1024,
      jsonBody: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.ok(underLimit.status !== 413 && underLimit.status !== 401 && underLimit.status !== 403, `under-limit chunked body must pass the gate (got ${underLimit.status})`);
  } finally {
    await closeServer();
  }
});

// AUD-006 fast path: a DECLARED oversized Content-Length is refused before
// any body byte is read (headers-only request).
test("http gate: declared oversized content-length refused without body", async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const closeServer = await serveHttp(
    { toolCtx: {}, resourceCtx: {}, serverInfo: { name: "test", version: "0.0.0" } },
    "127.0.0.1",
    port,
    KEY,
  );
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1", port, method: "POST", path: "/mcp",
          headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "content-length": String(5 * 1024 * 1024) },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 413, "declared oversized body must be refused from headers alone");
  } finally {
    await closeServer();
  }
});

// Audit backlog (AUD-006): slow writer — the 413 must arrive BEFORE the
// client finishes the upload, so the request slot is freed immediately.
test("http gate: oversized slow writer receives 413 before EOF", async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const closeServer = await serveHttp(
    { toolCtx: {}, resourceCtx: {}, serverInfo: { name: "test", version: "0.0.0" } },
    "127.0.0.1",
    port,
    KEY,
  );
  try {
    const outcome = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port, method: "POST", path: "/mcp",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, connection: "close" },
      });
      let answered = null;
      const finish = (v) => { if (!answered) { answered = v; resolve(v); } };
      req.on("response", (res) => {
        res.resume();
        res.on("end", () => finish({ status: res.statusCode, beforeEof: true }));
      });
      req.on("error", (err) => {
        if (err?.code === "ECONNRESET" || err?.code === "EPIPE") finish({ status: 0, beforeEof: true, reset: true });
        else reject(err);
      });
      // write past the limit in small chunks and DO NOT call req.end() —
      // a slow writer holding the slot is exactly the scenario under test
      const chunk = Buffer.alloc(64 * 1024, 0x41);
      let written = 0;
      const timer = setInterval(() => {
        try { req.write(chunk); written += chunk.length; } catch { clearInterval(timer); }
        if (written > 5 * 1024 * 1024) {
          clearInterval(timer);
          // 5 MiB written, still no refusal and no EOF — the server is letting
          // the slow writer hold the slot: fail the assertion
          finish({ status: -1, beforeEof: false });
        }
      }, 5);
    });
    assert.ok(
      outcome.beforeEof === true && (outcome.status === 413 || outcome.reset === true),
      `slow writer must be refused before finishing the upload (got ${JSON.stringify(outcome)})`,
    );
  } finally {
    await closeServer();
  }
});

// Audit backlog: exact raw-byte boundary — a body of exactly MAX_BODY_BYTES
// (valid JSON padded with whitespace) passes; one byte more is refused.
test("http gate: raw-byte boundary at exactly 4 MiB", async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const closeServer = await serveHttp(
    { toolCtx: {}, resourceCtx: {}, serverInfo: { name: "test", version: "0.0.0" } },
    "127.0.0.1",
    port,
    KEY,
  );
  const MAX = 4 * 1024 * 1024;
  const bodyAtLimit = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }).padEnd(MAX, " "), "utf8");
  assert.equal(bodyAtLimit.length, MAX, "test body must be exactly 4 MiB");
  const bodyOverLimit = Buffer.concat([bodyAtLimit, Buffer.from(" ")]);

  const post = (body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1", port, method: "POST", path: "/mcp",
          headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "content-length": String(body.length) },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: data, reset: false }));
        },
      );
      // an oversized upload may be answered by teardown (413 flushed, then
      // RST) — the client can observe either the response or the reset
      req.on("error", (err) => {
        if (err?.code === "ECONNRESET" || err?.code === "EPIPE") resolve({ status: 0, body: "", reset: true });
        else reject(err);
      });
      req.end(body);
    });

  try {
    const at = await post(bodyAtLimit);
    assert.ok(at.status !== 413, `exactly-4MiB body must not be refused as oversized (got ${at.status})`);
    const over = await post(bodyOverLimit);
    assert.ok(over.status === 413 || over.reset === true, `4MiB + 1 byte must be refused (got status ${over.status}, reset ${over.reset})`);
  } finally {
    await closeServer();
  }
});

// Audit backlog: abandoned upload — a client that dies mid-body must not
// wedge the bridge; the next request is served normally.
test("http gate: abandoned upload leaves the bridge healthy", async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const closeServer = await serveHttp(
    { toolCtx: {}, resourceCtx: {}, serverInfo: { name: "test", version: "0.0.0" } },
    "127.0.0.1",
    port,
    KEY,
  );
  try {
    // start a POST, write a partial body, destroy the socket without end
    const req = http.request({
      host: "127.0.0.1", port, method: "POST", path: "/mcp",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "content-length": "1048576" },
    });
    req.on("error", () => {}); // expected: we destroy mid-upload on purpose
    req.write(Buffer.alloc(1024, 0x41));
    req.destroy();
    await new Promise((r) => setTimeout(r, 100));

    const healthy = await request({
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.ok(healthy.status !== 401 && healthy.status !== 403 && healthy.status !== 413, `bridge must serve normally after an abandoned upload (got ${healthy.status})`);
  } finally {
    await closeServer();
  }
});

function requestChunked({ headers = {}, chunkCount = 1, chunkSize = 1024, jsonBody = null } = {}) {
  return new Promise((resolve, reject) => {
    // No content-length → Node sends Transfer-Encoding: chunked.
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path: "/mcp", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data, reset: false }));
      },
    );
    let reset = false;
    req.on("error", (err) => {
      if (err?.code === "ECONNRESET" || err?.code === "EPIPE") resolve({ status: 0, body: "", reset: true });
      else reject(err);
    });
    req.on("socket", (socket) => {
      socket.on("error", () => { reset = true; });
    });
    if (jsonBody) {
      req.write(jsonBody);
      const filler = Buffer.alloc(chunkSize, 0x20); // spaces
      for (let i = 0; i < chunkCount; i += 1) req.write(filler);
    } else {
      const filler = Buffer.alloc(chunkSize, 0x41); // 'A'
      for (let i = 0; i < chunkCount; i += 1) req.write(filler);
    }
    req.end();
  });
}
