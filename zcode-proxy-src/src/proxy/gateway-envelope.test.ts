import { describe, expect, test } from "bun:test";
import { parseGatewayErrorEnvelope } from "./handler.js";

describe("parseGatewayErrorEnvelope", () => {
  test("maps quota envelope to non-retryable 400", () => {
    const r = parseGatewayErrorEnvelope('{"code":1005,"msg":"exceed quota limit"}');
    expect(r).toEqual({ status: 400, type: "invalid_request_error", message: "[1005] exceed quota limit" });
  });

  test("maps balance envelope to non-retryable 400", () => {
    const r = parseGatewayErrorEnvelope('{"code":1113,"msg":"Insufficient balance"}');
    expect(r?.status).toBe(400);
  });

  test("maps captcha failure to non-retryable 403", () => {
    const r = parseGatewayErrorEnvelope('{"code":3007,"msg":"captcha verify failed"}');
    expect(r).toEqual({ status: 403, type: "permission_error", message: "[3007] captcha verify failed" });
  });

  test("maps model-not-allowed to 403", () => {
    const r = parseGatewayErrorEnvelope('{"code":3006,"msg":"model not allowed"}');
    expect(r).toEqual({ status: 403, type: "permission_error", message: "[3006] model not allowed" });
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
