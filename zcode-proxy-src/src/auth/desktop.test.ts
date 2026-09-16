import { expect, test } from "bun:test";
import { parseDesktopCredential } from "./desktop.js";
import { fixtureSecret } from "../test-fixtures.js";

const ZAI_KEY = fixtureSecret("desktop-zai-key");
const ZAI_JWT = fixtureSecret("desktop-zai-jwt");
/** A different provider's entry, which selecting "zai" must ignore. */
const BIGMODEL_KEY = fixtureSecret("desktop-bigmodel-key");

test("existing desktop import selects only the requested builtin provider", () => {
  expect(parseDesktopCredential(JSON.stringify({ provider: {
    // Surrounding whitespace is intentional: the parser must trim it.
    "builtin:zai-coding-plan": { options: { apiKey: ` ${ZAI_KEY} ` } },
    "builtin:zai-start-plan": { options: { apiKey: ` ${ZAI_JWT} ` } },
    "builtin:bigmodel-coding-plan": { options: { apiKey: BIGMODEL_KEY } },
  } }), "zai")).toEqual({ apiKey: ZAI_KEY, jwt: ZAI_JWT, provider: "zai" });
});
test("partial, empty, invalid and expired desktop credentials are rejected safely", () => {
  for (const raw of ["{", "{}", '{"provider":{"builtin:zai-coding-plan":{"options":{"apiKey":42}}}}']) {
    expect(() => parseDesktopCredential(raw, "zai")).toThrow();
  }
  const jwt = `fixture.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.fixture`;
  expect(() => parseDesktopCredential(JSON.stringify({ provider: { "builtin:zai-coding-plan": { options: { apiKey: "fixture" } }, "builtin:zai-start-plan": { options: { apiKey: jwt } } } }), "zai", "start-plan")).toThrow(/expired/);
});
