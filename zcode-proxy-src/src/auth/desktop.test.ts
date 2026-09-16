import { expect, test } from "bun:test";
import { parseDesktopCredential } from "./desktop.js";

test("existing desktop import selects only the requested builtin provider", () => {
  expect(parseDesktopCredential(JSON.stringify({ provider: {
    // mimosa-ignore synthetic local test fixture value, never a real credential
    "builtin:zai-coding-plan": { options: { apiKey: " fixture-key " } },
    // mimosa-ignore synthetic local test fixture value, never a real credential
    "builtin:zai-start-plan": { options: { apiKey: " fixture-jwt " } },
    // mimosa-ignore synthetic local test fixture value, never a real credential
    "builtin:bigmodel-coding-plan": { options: { apiKey: "wrong-provider" } },
  // mimosa-ignore synthetic local test fixture value, never a real credential
  } }), "zai")).toEqual({ apiKey: "fixture-key", jwt: "fixture-jwt", provider: "zai" });
});
test("partial, empty, invalid and expired desktop credentials are rejected safely", () => {
  for (const raw of ["{", "{}", '{"provider":{"builtin:zai-coding-plan":{"options":{"apiKey":42}}}}']) {
    expect(() => parseDesktopCredential(raw, "zai")).toThrow();
  }
  const jwt = `fixture.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.fixture`;
  expect(() => parseDesktopCredential(JSON.stringify({ provider: { "builtin:zai-coding-plan": { options: { apiKey: "fixture" } }, "builtin:zai-start-plan": { options: { apiKey: jwt } } } }), "zai", "start-plan")).toThrow(/expired/);
});
