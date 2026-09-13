/** Unit tests: security-critical helpers, no process spawning. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactDeep, safeJsonStringify } from "../../dist/security/redact.js";
import { WorkspaceAllowlist, normalizeWorkspacePath, resolveInsideWorkspace, isWithinRoot } from "../../dist/security/allowlist.js";
import { parseSessionId, workspaceRef } from "../../dist/protocol/types.js";
import { parseConfig } from "../../dist/config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("redactDeep masks secret keys and token shapes", () => {
  const input = {
    apiKey: "sk-abcdef123456",
    nested: { Authorization: "Bearer xyz VeryLongToken", ok: 1 },
    list: [{ sessionCookie: "abc" }],
    text: "call me with sk-abcdefghij please",
    long: "z".repeat(250),
  };
  const out = JSON.parse(safeJsonStringify(input));
  assert.equal(out.apiKey, "<redacted>");
  assert.match(String(out.nested.Authorization), /redacted/);
  assert.equal(out.nested.ok, 1);
  assert.equal(out.list[0].sessionCookie, "<redacted>");
  assert.ok(!out.text.includes("sk-abcdefghij"));
  assert.ok(out.long.startsWith("<redacted"));
});

test("workspace allowlist: inside allowed, outside denied, case-normalized", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "allow-"));
  const list = new WorkspaceAllowlist([tmp]);
  const inside = path.join(tmp, "sub");
  fs.mkdirSync(inside, { recursive: true });
  assert.equal(list.check(inside), normalizeWorkspacePath(inside));
  assert.equal(list.check("C:\\Windows"), null);
  assert.throws(() => list.enforce("C:\\Windows"), /not in the bridge allowlist/);
  // case-insensitive drive letter
  const lower = tmp.charAt(0).toLowerCase() + tmp.slice(1);
  assert.equal(list.check(lower), normalizeWorkspacePath(tmp));
});

test("resolveInsideWorkspace refuses traversal", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-"));
  const okFile = resolveInsideWorkspace(tmp, "a/b.txt");
  assert.ok(normalizeWorkspacePath(okFile).startsWith(normalizeWorkspacePath(tmp)));
  assert.throws(() => resolveInsideWorkspace(tmp, "..\\..\\escape.txt"), /escapes workspace/);
});

test("isWithinRoot blocks prefix collisions", () => {
  assert.equal(isWithinRoot("C:\\work", "C:\\work"), true);
  assert.equal(isWithinRoot("C:\\work\\sub", "C:\\work"), true);
  assert.equal(isWithinRoot("C:\\workshop", "C:\\work"), false);
  assert.equal(isWithinRoot("C:\\wor", "C:\\work"), false);
});

test("parseSessionId accepts harness ids and rejects junk", () => {
  assert.equal(parseSessionId("sess_abc-123"), "sess_abc-123");
  assert.equal(parseSessionId("sess_"), null);
  assert.equal(parseSessionId("nope"), null);
  assert.equal(parseSessionId(42), null);
  assert.equal(parseSessionId("sess_../evil"), null);
});

test("workspaceRef normalizes trailing separators", () => {
  const ref = workspaceRef("C:\\temp\\ws\\");
  assert.equal(ref.workspaceKey, "C:\\temp\\ws");
  assert.equal(ref.workspacePath, "C:\\temp\\ws");
});

test("config parsing: flags, env defaults, invalid policy rejected", () => {
  const cfg = parseConfig(["--http", "--port", "4000", "--read-only", "--allow-workspace", "C:\\a;C:\\b", "--interaction-policy", "allowlist"]);
  assert.equal(cfg.transport, "http");
  assert.equal(cfg.port, 4000);
  assert.equal(cfg.readOnly, true);
  assert.deepEqual(cfg.allowWorkspaces, ["C:\\a", "C:\\b"]);
  assert.equal(cfg.interactionPolicy, "allowlist");
  assert.throws(() => parseConfig(["--interaction-policy", "nonsense"]));
});
