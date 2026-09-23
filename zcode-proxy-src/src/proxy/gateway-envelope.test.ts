import { describe, expect, test } from "bun:test";
import { parseGatewayErrorEnvelope } from "./handler.js";

describe("parseGatewayErrorEnvelope", () => {
  test("maps quota envelope to non-retryable 400", () => {
    const r = parseGatewayErrorEnvelope('{"code":1005,"msg":"exceed quota limit"}');
    expect(r).toEqual({ status: 400, type: "invalid_request_error", message: "[1005] exceed quota limit", code: 1005 });
  });

  test("maps balance envelope to non-retryable 400", () => {
    const r = parseGatewayErrorEnvelope('{"code":1113,"msg":"Insufficient balance"}');
    expect(r?.status).toBe(400);
  });

  test("maps captcha failure to non-retryable 403", () => {
    const r = parseGatewayErrorEnvelope('{"code":3007,"msg":"captcha verify failed"}');
    expect(r).toEqual({ status: 403, type: "permission_error", message: "[3007] captcha verify failed", code: 3007 });
  });

  test("maps model-not-allowed to 403", () => {
    const r = parseGatewayErrorEnvelope('{"code":3006,"msg":"model not allowed"}');
    expect(r).toEqual({ status: 403, type: "permission_error", message: "[3006] model not allowed", code: 3006 });
  });

  test("maps anchored Anthropic 1210 without echoing provider text or request IDs", () => {
    const r = parseGatewayErrorEnvelope(JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "[1210][该模型始终思考，不支持关闭思考；请使用 low、high 或 max。][private-request-id] https://secret.invalid/?token=secret-token\r\nSet-Cookie: secret-cookie" },
    }));
    expect(r?.status).toBe(400);
    expect(r?.type).toBe("invalid_request_error");
    expect(r?.code).toBe(1210);
    for (const effort of ["low", "high", "max"]) expect(r?.message).toContain(effort);
    for (const secret of ["private-request-id", "secret.invalid", "secret-token", "secret-cookie", "该模型"]) {
      expect(r?.message).not.toContain(secret);
    }
    const other = parseGatewayErrorEnvelope(JSON.stringify({ type: "error", error: { message: "[1210] completely different provider text" } }));
    expect(other?.message).toBe(r?.message);
  });

  test("does not generalize arbitrary or malformed Anthropic error messages", () => {
    for (const error of [null, [], "[1210]", { message: 1210 }, { message: "prefix [1210]" }, { message: "[12100]" }, { message: "[9999]" }]) {
      expect(parseGatewayErrorEnvelope(JSON.stringify({ type: "error", error }))).toBeNull();
    }
    expect(parseGatewayErrorEnvelope(JSON.stringify({ error: { message: "[1210]" } }))).toBeNull();
    expect(parseGatewayErrorEnvelope(JSON.stringify({ type: "message", error: { message: "[1210]" } }))).toBeNull();
  });

  test("maps unknown codes to 502", () => {
    const r = parseGatewayErrorEnvelope('{"code":9999,"msg":"weird"}');
    expect(r?.status).toBe(502);
  });

  test("accepts normal message responses untouched", () => {
    expect(parseGatewayErrorEnvelope('{"id":"msg_1","type":"message","content":[]}')).toBeNull();
    expect(parseGatewayErrorEnvelope('{"code":1005,"msg":"x","content":[{"type":"text","text":"hi"}]}')).toBeNull();
  });

  test("ignores non-JSON, non-object and oversized bodies", () => {
    expect(parseGatewayErrorEnvelope("")).toBeNull();
    expect(parseGatewayErrorEnvelope("event: message_start")).toBeNull();
    expect(parseGatewayErrorEnvelope("[1,2,3]")).toBeNull();
    expect(parseGatewayErrorEnvelope("x".repeat(5000))).toBeNull();
  });
});
