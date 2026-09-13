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
