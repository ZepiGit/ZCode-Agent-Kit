/**
 * Replays the recorded 2025-era wire transcripts (test/fixture/wire/, see
 * wire-transcript.mjs) against the built bridge: every stdio line and every
 * HTTP status, header and body must equal the recording byte for byte. The
 * recordings were made on the bridge built with MCP SDK 1.32.2, so they hold
 * the wire a client of protocol revision 2025-06-18 or 2025-11-25 has always
 * seen, whatever MCP library the bridge is built with.
 *
 * One answer differs from the recording, to a request no client can validly
 * send (DIVERGED below); the recording itself stays as SDK 1.32.2 wrote it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HTTP_REQUESTS, STDIO_SESSIONS, readFixture, recordHttp, recordStdioSession } from "./wire-transcript.mjs";

const stdioFixture = readFixture("legacy-stdio.json");
const httpFixture = readFixture("legacy-http.json");

// A tools/call without a tool name. Both SDK lines refuse it with the same
// schema failure before the bridge's handler runs; SDK 1.x reported it as an
// internal error (-32603) with the bare failure as the message, SDK 2.x
// reports it as invalid params (-32602) and names the request.
const DIVERGED = {
  request: (line) => { const m = JSON.parse(line); return m.method === "tools/call" && m.params?.name === undefined; },
  answer(recorded) {
    const was = JSON.parse(recorded);
    assert.equal(was.error.code, -32603, "the recording holds the SDK 1.x answer");
    return JSON.stringify({ jsonrpc: was.jsonrpc, id: was.id, error: { code: -32602, message: `Invalid tools/call request: ${was.error.message}` } });
  },
};

/** The answer the bridge must give to `line`: the recorded one, except for the one diverged request. */
function expectedAnswer(line, recorded) {
  return DIVERGED.request(line) ? DIVERGED.answer(recorded) : recorded;
}

test("the recorded stdio sessions are the scripted ones", () => {
  assert.deepEqual(stdioFixture.map((s) => [s.name, s.send]), STDIO_SESSIONS.map((s) => [s.name, s.send]));
});

for (const session of STDIO_SESSIONS) {
  test(`wire replay, ${session.name}: every answer equals the recording`, async () => {
    const want = stdioFixture.find((s) => s.name === session.name);
    assert.ok(want, "the session has a recording (re-record with wire-transcript.mjs --write)");
    const got = await recordStdioSession(session);
    const asked = session.send.filter((line) => JSON.parse(line).id !== undefined);
    assert.equal(got.received.length, asked.length, "one answer per request, nothing else on stdout");
    for (const [i, line] of got.received.entries()) assert.deepEqual(line, expectedAnswer(asked[i], want.received[i]), `answer to ${asked[i].slice(0, 200)}`);
    assert.equal(got.end, want.end, "nothing was written after the last scripted answer");
  });
}

test("wire replay, HTTP: every status, header and body equals the recording", async () => {
  assert.deepEqual(httpFixture.map((x) => x.name), HTTP_REQUESTS.map((x) => x.name), "the recording covers the scripted requests (re-record with wire-transcript.mjs --write)");
  const got = await recordHttp();
  for (const [i, exchange] of got.entries()) {
    const want = httpFixture[i].response;
    const single = HTTP_REQUESTS[i].body?.startsWith("{") && want.status === 200 && typeof want.body === "string";
    if (single && DIVERGED.request(HTTP_REQUESTS[i].body)) {
      const body = DIVERGED.answer(want.body);
      assert.deepEqual(exchange.response, { status: 200, headers: [`content-length: ${Buffer.byteLength(body)}`, "content-type: application/json"], body }, exchange.name);
    } else {
      assert.deepEqual(exchange.response, want, exchange.name);
    }
  }
});

test("the recordings hold what a 2025-era client relies on", () => {
  const answers = (name) => {
    const s = stdioFixture.find((x) => x.name === name);
    const asked = s.send.filter((line) => JSON.parse(line).id !== undefined).map((line) => JSON.parse(line));
    return asked.map((request, i) => ({ request, answer: typeof s.received[i] === "string" ? JSON.parse(s.received[i]) : s.received[i] }));
  };
  for (const [asked, negotiated] of [["2025-06-18", "2025-06-18"], ["2025-11-25", "2025-11-25"], ["2025-03-26", "2025-03-26"], ["2024-11-05", "2024-11-05"], ["2026-07-28", "2025-11-25"], ["1999-01-01", "2025-11-25"]]) {
    const init = answers(`stdio ${asked}`)[0].answer.result;
    assert.equal(init.protocolVersion, negotiated, `a client asking for ${asked} gets ${negotiated}: never more than 2025-11-25`);
    assert.deepEqual(init.capabilities, { tools: { listChanged: false }, resources: { subscribe: false }, logging: {} });
    assert.deepEqual(init.serverInfo, { name: "zcode-harness-mcp", version: "0.1.0" });
  }
  const full = answers("stdio 2025-11-25");
  const missing = full.find((x) => x.request.method === "resources/read" && x.request.params.uri === "zcode://nothing/here");
  assert.deepEqual(missing.answer.error, { code: -32002, message: "unknown resource: zcode://nothing/here" });
  const discover = full.find((x) => x.request.method === "server/discover");
  assert.equal(discover.answer.error.code, -32601, "the 2026-07-28 discovery method is not offered to a 2025-era session");
  const http = (name) => httpFixture.find((x) => x.name === name).response;
  assert.equal(http("GET /mcp").status, 405);
  assert.equal(http("DELETE /mcp").status, 405);
  assert.equal(http("no bearer").status, 401);
  assert.equal(http("foreign host").status, 403);
  assert.equal(http("foreign origin").status, 403);
  assert.equal(http("declared body over 4 MiB").status, 413);
  assert.equal(http("initialize 2025-06-18").headers.some((h) => /^mcp-session-id:/i.test(h)), false, "stateless: no session id");
});
