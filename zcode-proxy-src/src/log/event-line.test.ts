// Event lines under Bun: the proxy's side of the shared
// event-line module. The same vectors run under Node in tests/event-line.test.mjs.
import { describe, expect, test } from "bun:test";
import { createEventLogger, formatEventLine, redactLine } from "./event-line.mjs";

const AT = new Date("2026-11-06T12:34:56.789Z");

describe("formatEventLine", () => {
  test("renders ISO-time LEVEL component message key=value… on one line", () => {
    expect(formatEventLine({
      time: AT, level: "WARN", component: "supervisor", message: "footprint above soft limit",
      fields: { rssMB: 530, limitMB: 512, draining: false },
    })).toBe("2026-11-06T12:34:56.789Z WARN supervisor footprint above soft limit rssMB=530 limitMB=512 draining=false");
  });

  test("quotes values with spaces, quotes, '=' or control characters and escapes them", () => {
    expect(formatEventLine({
      time: AT, level: "ERROR", component: "manager", message: "respawn refused",
      fields: { reason: "budget exhausted", path: "C:\\kit\\logs", quote: 'say "hi"', eq: "a=b", nl: "one\ntwo\r", empty: "" },
    })).toBe(
      '2026-11-06T12:34:56.789Z ERROR manager respawn refused reason="budget exhausted" path=C:\\kit\\logs '
      + 'quote="say \\"hi\\"" eq="a=b" nl="one\\ntwo\\r" empty=""',
    );
  });

  test("escapes keys to [A-Za-z0-9_.-] so a key can never forge a second pair or a line break", () => {
    expect(formatEventLine({
      time: AT, level: "INFO", component: "lock", message: "takeover",
      fields: { "holder pid": 7, "a=b": 1, "x\ny": 2, "": 3 },
    })).toBe("2026-11-06T12:34:56.789Z INFO lock takeover holder_pid=7 a_b=1 x_y=2 _=3");
  });

  test("keeps the line single even when the message or component carries line breaks", () => {
    const line = formatEventLine({ time: AT, level: "WARN", component: "proxy log\nfake", message: "rotation blocked\n2026-01-01T00:00:00.000Z ERROR forged" });
    expect(line).toBe("2026-11-06T12:34:56.789Z WARN proxy_log_fake rotation blocked\\n2026-01-01T00:00:00.000Z ERROR forged");
    expect(line.includes("\n")).toBe(false);
  });

  test("renders null, objects and errors; omits undefined fields", () => {
    expect(formatEventLine({
      time: AT, level: "INFO", component: "memory", message: "sample",
      fields: { cap: null, skipped: undefined, procs: { proxy: 1, solver: 0 }, err: new Error("spawn EACCES") },
    })).toBe('2026-11-06T12:34:56.789Z INFO memory sample cap=null procs="{\\"proxy\\":1,\\"solver\\":0}" err="spawn EACCES"');
  });

  test("rejects a level outside DEBUG|INFO|WARN|ERROR", () => {
    expect(() => formatEventLine({ time: AT, level: "warn" as never, component: "x", message: "y" })).toThrow(/level/);
  });
});

// Fixture shapes only, never real credentials (B2). The stop token and the
// proxy key are 32 random bytes as base64url (43 chars), see cli/context.mjs.
const STOP_TOKEN_SHAPED = "q3Vx8mZ0bK2fT9wLr7YpN4sJd1HcE6uGaO5iWzXlQvA";
const HEX_STATE = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlLXVzZXIifQ.c2lnbmF0dXJlLWZpeHR1cmUtdmFsdWU";

describe("redactLine", () => {
  test("the stop-token-shaped fixture has the real token's shape", () => {
    expect(STOP_TOKEN_SHAPED).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("masks bearer tokens, JWTs, sk- keys and opaque 32+ char tokens in existing lines", () => {
    expect(redactLine(`[zcode-proxy] upstream rejected Authorization: Bearer ${JWT}`))
      .toBe("[zcode-proxy] upstream rejected Authorization: Bearer <redacted>");
    expect(redactLine(`[manager 2026-11-06T00:31:32.688Z] ERROR: cannot start the proxy — token ${STOP_TOKEN_SHAPED} refused`))
      .toBe("[manager 2026-11-06T00:31:32.688Z] ERROR: cannot start the proxy — token <redacted> refused");
    expect(redactLine(`oauth callback state=${HEX_STATE}&code=1`)).toBe("oauth callback state=<redacted>&code=1");
    expect(redactLine(`id_token ${JWT}`)).toBe("id_token <redacted>");
    expect(redactLine("key sk-fixture0123456789abcdef in use")).toBe("key <redacted> in use");
  });

  test("masks exact known secrets of any shape, and the stop token from the environment", () => {
    expect(redactLine("[manager 2026-11-06T00:31:32.688Z] ERROR: bad key test-key-abc123.", ["test-key-abc123"]))
      .toBe("[manager 2026-11-06T00:31:32.688Z] ERROR: bad key <redacted>.");
    const saved = process.env.ZCODE_KIT_STOP_TOKEN;
    process.env.ZCODE_KIT_STOP_TOKEN = "short-stop-tok";
    try {
      expect(redactLine("stop request carried short-stop-tok")).toBe("stop request carried <redacted>");
    } finally {
      if (saved === undefined) delete process.env.ZCODE_KIT_STOP_TOKEN; else process.env.ZCODE_KIT_STOP_TOKEN = saved;
    }
  });

  test("leaves secret-free existing lines byte-identical", () => {
    for (const line of [
      "[manager 2026-11-06T00:31:33.328Z] started (pid 322912) — healthy on http://127.0.0.1:18457",
      "zcode-proxy listening on http://127.0.0.1:18457",
      "  captcha egress: direct",
      "#001 ANT glm-5.3-flash 200 batch 948ms",
      "#004 debug: authorization=Bearer <redacted> x-api-key=abcdef...wxyz content-type=application/json",
      "[pe-cache-evict] resource-0123456789abcdef stalled 3x — evicting cache",
      "[manager 2026-11-06T00:31:32.688Z] ERROR: proxy exited immediately (code 1). See C:\\Users\\me\\.zcode-agent-kit\\logs\\proxy.log",
      "error: Cannot find module 'yaml' from '/home/me/zcode-agent-kit/zcode-proxy-src/src/config/load.ts'",
      "ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA=1 ZCODE_PROXY_CAPTCHA_CDN_CACHE_MAX_MB_V2=64",
      "x-request-id 3b241101-e2bb-4255-8caf-4136c566a962",
      "short known secret ab is ignored",
    ]) expect(redactLine(line, ["ab"])).toBe(line);
  });

  test("is idempotent", () => {
    const once = redactLine(`Bearer ${JWT} ${STOP_TOKEN_SHAPED}`);
    expect(redactLine(once)).toBe(once);
  });
});

describe("createEventLogger", () => {
  test("writes one redacted event line per call through the given sink", () => {
    const lines: string[] = [];
    const log = createEventLogger({ component: "shed", write: (line) => lines.push(line), now: () => AT, secrets: () => ["test-key-abc123"] });
    log.warn("request shed", { endpoint: "/v1/messages", inFlightBytes: 67108864, retryAfterS: 2 });
    log.error("respawn refused", { detail: "key test-key-abc123 rejected" });
    log.info("drained");
    log.debug("queue", { queued: 0 });
    expect(lines).toEqual([
      "2026-11-06T12:34:56.789Z WARN shed request shed endpoint=/v1/messages inFlightBytes=67108864 retryAfterS=2",
      '2026-11-06T12:34:56.789Z ERROR shed respawn refused detail="key <redacted> rejected"',
      "2026-11-06T12:34:56.789Z INFO shed drained",
      "2026-11-06T12:34:56.789Z DEBUG shed queue queued=0",
    ]);
  });

  test("a throwing sink never breaks the caller", () => {
    const log = createEventLogger({ component: "memory", write: () => { throw new Error("EBADF"); }, now: () => AT });
    expect(log.warn("sample", { rssMB: 1 })).toBe("2026-11-06T12:34:56.789Z WARN memory sample rssMB=1");
  });
});

describe("event lines carry no secret", () => {
  test("secret-named fields are masked whatever their value", () => {
    expect(formatEventLine({
      time: AT, level: "INFO", component: "stop", message: "request accepted",
      fields: { stopToken: "x", proxyKey: "abc", apiKey: "k", authorization: "Bearer z", inputTokens: 12, key: "solver.memoryCapMB" },
    })).toBe("2026-11-06T12:34:56.789Z INFO stop request accepted stopToken=<redacted> proxyKey=<redacted> apiKey=<redacted> authorization=<redacted> inputTokens=12 key=solver.memoryCapMB");
  });

  test("token shapes and known secrets in the message or any value are masked", () => {
    expect(formatEventLine({
      time: AT, level: "ERROR", component: "manager", message: `respawn hook failed for ${STOP_TOKEN_SHAPED}`,
      fields: { detail: `upstream said Bearer ${JWT}`, note: "uses test-key-abc123" }, secrets: ["test-key-abc123"],
    })).toBe('2026-11-06T12:34:56.789Z ERROR manager respawn hook failed for <redacted> detail="upstream said Bearer <redacted>" note="uses <redacted>"');
  });
});
