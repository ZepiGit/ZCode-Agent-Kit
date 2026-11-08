/**
 * jsonCopy and transformBuiltRequestBody (ticket 20).
 *
 * A translated request used to be serialised, parsed back and serialised again
 * by the body transforms. It is now copied structurally (jsonCopy) and
 * serialised once. The reference for every case below is the old path itself:
 * JSON.parse(JSON.stringify(value)) for the copy, and
 * transformRequestBody(JSON.stringify(value), ctx) for the bytes sent upstream.
 */
import { describe, it, expect } from "bun:test";
import { jsonCopy, transformBuiltRequestBody, transformRequestBody } from "./body-transformer.js";
import { translateRequestOpenAIToAnthropic } from "../translator/openai-to-anthropic.js";
import { responsesToChatCompletions } from "../translator/responses-to-chat.js";

/** Structure, key order, prototypes and values (Object.is) of two JSON-ish trees. */
function sameTree(a: unknown, b: unknown, path = "$"): void {
  if (a === null || typeof a !== "object") {
    expect({ path, value: Object.is(a, b) ? "same" : a }).toEqual({ path, value: "same" });
    return;
  }
  expect(b !== null && typeof b === "object").toBe(true);
  expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(b as object));
  expect(Array.isArray(a)).toBe(Array.isArray(b));
  expect(Object.keys(a)).toEqual(Object.keys(b as object));
  for (const k of Object.keys(a)) {
    const da = Object.getOwnPropertyDescriptor(a, k)!;
    const db = Object.getOwnPropertyDescriptor(b as object, k)!;
    expect([da.writable, da.enumerable, da.configurable]).toEqual([db.writable, db.enumerable, db.configurable]);
    sameTree(da.value, db.value, `${path}.${k}`);
  }
}

function oracle(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : JSON.parse(text);
}

const shared = { type: "text", text: "shared block" };
const protoKey = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
const tricky: [string, unknown][] = [
  ["undefined, function and symbol properties", { a: undefined, b: () => 1, c: Symbol("s"), d: 1 }],
  ["undefined, function and symbol array elements, and holes", [undefined, () => 1, Symbol("s"), , 2]], // eslint-disable-line no-sparse-arrays
  ["non-finite numbers and negative zero", { nan: NaN, inf: Infinity, ninf: -Infinity, nz: -0, arr: [-0, NaN] }],
  ["integer-like keys keep JSON's order", { b: 1, 10: "ten", 2: "two", a: 2, "4294967295": "big", "-1": "neg" }],
  ["an own __proto__ key from JSON.parse", protoKey],
  ["toJSON with its key, and a Date", { when: new Date(Date.UTC(2026, 10, 8, 10, 0, 0)), custom: { toJSON: (key: string) => `key:${key}` }, list: [{ toJSON: (key: string) => `index:${key}` }] }],
  ["wrapper objects", { n: new Number(3), s: new String("x"), b: new Boolean(false) }],
  ["lone surrogates and control characters", { s: "a\ud800b\udc00c\u2028\u0000\"\\" }],
  ["the same object twice", { first: shared, second: shared, list: [shared, shared] }],
  ["nested empties and nulls", { o: {}, a: [], n: null, deep: [[[{}]]] }],
  ["a primitive", "text"],
];

describe("jsonCopy is JSON.parse(JSON.stringify(value)) without the text", () => {
  for (const [name, value] of tricky) {
    it(name, () => {
      const copy = jsonCopy(value);
      sameTree(oracle(value), copy);
      expect(JSON.stringify(copy)).toBe(JSON.stringify(value));
    });
  }

  it("returns undefined where JSON.stringify does", () => {
    expect(jsonCopy(undefined)).toBeUndefined();
    expect(jsonCopy(() => 1)).toBeUndefined();
  });

  it("copies a shared object once per place, as a parse would", () => {
    const copy = jsonCopy({ first: shared, second: shared }) as { first: { text: string }; second: { text: string } };
    copy.first.text = "changed";
    expect(copy.second.text).toBe("shared block");
    expect(shared.text).toBe("shared block");
  });

  it("throws JSON.stringify's TypeError on a cycle and on a BigInt", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => JSON.stringify(cyclic)).toThrow(TypeError);
    expect(() => jsonCopy(cyclic)).toThrow(TypeError);
    expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
    expect(() => jsonCopy({ n: 1n })).toThrow(TypeError);
  });
});

const PNG = `data:image/png;base64,${Buffer.alloc(2048, 7).toString("base64")}`;
const chats: [string, Record<string, unknown>][] = [
  ["text", { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] }],
  ["system, tools, tool calls and results", { model: "glm-5.3", stream: true, temperature: 0.2, stop: "END", tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }], tool_choice: { type: "function", function: { name: "read" } }, messages: [{ role: "system", content: "terse" }, { role: "user", content: "read" }, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{\"p\":1}" } }] }, { role: "tool", tool_call_id: "c1", content: "ok" }, { role: "tool", tool_call_id: "c2", content: [{ type: "text", text: "a" }] }] }],
  ["image and reasoning effort", { model: "glm-5.3-flash", reasoning_effort: "high", messages: [{ role: "user", content: [{ type: "text", text: "what" }, { type: "image_url", image_url: { url: PNG } }] }] }],
  ["disabled thinking on glm-5.3-flash", { model: "glm-5.3-flash", thinking: { type: "disabled" }, max_tokens: 100, messages: [{ role: "user", content: "x" }] }],
  ["a model outside the catalogue, tool_choice none", { model: "other-model", tool_choice: "none", tools: [{ type: "function", function: { name: "t" } }], messages: [{ role: "user", content: [{ type: "text" }] }] }],
  ["no messages to mark", { model: "glm-5.3", messages: [{ role: "system", content: "only system" }] }],
];
const contexts = [
  { format: "anthropic" as const, metadataUserId: "{\"device_id\":\"d\",\"account_uuid\":\"\",\"session_id\":\"\"}" },
  { format: "anthropic" as const, metadataUserId: "{\"device_id\":\"d\",\"account_uuid\":\"\",\"session_id\":\"ses_1\"}", startPlan: true },
  { format: "anthropic" as const },
];

describe("transformBuiltRequestBody sends the bytes of transformRequestBody(JSON.stringify(value))", () => {
  for (const [name, chat] of chats) {
    for (const [i, ctx] of contexts.entries()) {
      it(`translated chat request: ${name} (context ${i + 1})`, () => {
        const reference = transformRequestBody(JSON.stringify(translateRequestOpenAIToAnthropic(structuredClone(chat) as never)), ctx);
        expect(transformBuiltRequestBody(translateRequestOpenAIToAnthropic(structuredClone(chat) as never), ctx)).toBe(reference as string);
      });
    }
  }

  it("a translated Responses request", () => {
    const req = { model: "glm-5.3", instructions: "be brief", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }, { type: "function_call", call_id: "c9", name: "f", arguments: "{}" }, { type: "function_call_output", call_id: "c9", output: "done" }], tools: [{ type: "function", name: "f", parameters: { type: "object" } }] };
    const build = () => translateRequestOpenAIToAnthropic(responsesToChatCompletions(structuredClone(req) as never).chatRequest);
    expect(transformBuiltRequestBody(build(), contexts[0])).toBe(transformRequestBody(JSON.stringify(build()), contexts[0]) as string);
  });

  it("a built request the transforms leave unchanged, with undefined fields and a shared block", () => {
    const userId = contexts[0].metadataUserId;
    const block = { type: "text", text: "same object twice", cache_control: undefined };
    const built = { model: "glm-5.3", system: undefined, messages: [], metadata: { user_id: userId }, extra: [block, block], n: -0 };
    expect(transformBuiltRequestBody(built, contexts[0])).toBe(transformRequestBody(JSON.stringify(built), contexts[0]) as string);
    const marked = { model: "glm-5.3", messages: [{ role: "user", content: [block] }, { role: "user", content: [block] }] };
    expect(transformBuiltRequestBody(marked, contexts[0])).toBe(transformRequestBody(JSON.stringify(marked), contexts[0]) as string);
  });
});
