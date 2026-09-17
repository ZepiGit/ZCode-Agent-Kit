/**
 * Audit regressions (D-01, D-02, D-04, D-05, D-07, D-09, D-11, V3-04):
 * every scenario is driven through the real MCP interface against the fixture
 * harness. The fixture seeds one session in a NON-allowlisted workspace.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge } from "./client.mjs";
import fs from "node:fs";
import path from "node:path";

const FOREIGN = process.platform === "win32" ? "C:\\audit-foreign\\top-secret" : "/audit-foreign/top-secret";
const FOREIGN_SESSION = "sess_foreign-fixture";

test("D-01: session tools refuse sessions outside the allowlist, list hides them", async () => {
  const c = await startBridge({ env: { FAKE_FOREIGN_WORKSPACE: FOREIGN } });
  try {
    const listed = await c.tool("zcode_sessions_list", {});
    assert.ok(!listed.sessions.some((s) => s.sessionId === FOREIGN_SESSION), "foreign session must not be listed");

    for (const [tool, args] of [
      ["zcode_session_get", { sessionId: FOREIGN_SESSION }],
      ["zcode_session_resume", { sessionId: FOREIGN_SESSION }],
      ["zcode_session_fork", { sessionId: FOREIGN_SESSION }],
      ["zcode_session_close", { sessionId: FOREIGN_SESSION }],
      ["zcode_session_compact", { sessionId: FOREIGN_SESSION }],
      ["zcode_session_goal", { sessionId: FOREIGN_SESSION, action: "show" }],
      ["zcode_model_set", { scope: "session", sessionId: FOREIGN_SESSION, mode: "plan" }],
      ["zcode_operation_invoke", { method: "session/messages", params: { sessionId: FOREIGN_SESSION } }],
      ["zcode_operation_invoke", { method: "session/read", params: { sessionId: FOREIGN_SESSION } }],
    ]) {
      const err = await c.expectToolError(tool, args);
      assert.match(err, /allowlist/i, `${tool} must fail on the allowlist, got: ${err}`);
      assert.doesNotMatch(err, /FOREIGN-SECRET/, `${tool} leaked transcript content`);
    }

    // task_start with a foreign session must not run anything in that workspace
    const err = await c.expectToolError("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "hi", sessionId: FOREIGN_SESSION });
    assert.match(err, /allowlist|WORKSPACE_MISMATCH/i);
  } finally {
    await c.stop();
  }
});

test("D-01: a session of an allowlisted workspace stays fully usable", async () => {
  const c = await startBridge({ env: { FAKE_FOREIGN_WORKSPACE: FOREIGN } });
  try {
    const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const sessionId = created.session.sessionId;
    const got = await c.tool("zcode_session_get", { sessionId });
    assert.ok(got.session || got.projection || got.settings, "own session readable");
    const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "own", sessionId });
    const done = await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 20000 });
    assert.equal(done.state, "completed");
  } finally {
    await c.stop();
  }
});

test("D-02: mode yolo is refused unless the operator allowed it on the bridge command line", async () => {
  const c = await startBridge();
  try {
    for (const [tool, args] of [
      ["zcode_session_create", { workspacePath: c.workspaceDir, mode: "yolo" }],
      ["zcode_task_start", { workspacePath: c.workspaceDir, prompt: "x", mode: "yolo" }],
      ["zcode_settings_update", { workspacePath: c.workspaceDir, changes: { mode: "yolo" } }],
      ["zcode_model_set", { scope: "workspace", workspacePath: c.workspaceDir, mode: "yolo" }],
    ]) {
      const err = await c.expectToolError(tool, args);
      assert.match(err, /yolo/i, `${tool}: ${err}`);
      assert.match(err, /--allow-yolo|not permitted|denied/i, `${tool}: ${err}`);
    }
    const session = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const err = await c.expectToolError("zcode_model_set", { scope: "session", sessionId: session.session.sessionId, mode: "yolo" });
    assert.match(err, /yolo/i);
  } finally {
    await c.stop();
  }
  const allowed = await startBridge({ extraArgs: ["--allow-yolo"] });
  try {
    const session = await allowed.tool("zcode_session_create", { workspacePath: allowed.workspaceDir, mode: "yolo" });
    assert.equal(session.settings.mode.current, "yolo");
  } finally {
    await allowed.stop();
  }
});

test("D-07: readOnly denylist also applies to follow-up input", async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "zh-log-")), "runtime.jsonl");
  const c = await startBridge({ env: { FAKE_RUNTIME_LOG: logFile } });
  try {
    const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "first", readOnly: true });
    await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 20000 });
    await c.tool("zcode_task_input", { taskId: task.taskId, content: "second" });
    await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 20000 });
    const sends = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.method === "session/send");
    assert.equal(sends.length, 2);
    for (const s of sends) assert.ok(Array.isArray(s.params.toolDenylist) && s.params.toolDenylist.includes("Write"), `denylist missing on send: ${JSON.stringify(s.params)}`);
  } finally {
    await c.stop();
  }
});

test("D-09: tool arguments are validated against the declared schema", async () => {
  const c = await startBridge();
  try {
    const e1 = await c.expectToolError("zcode_session_create", { workspacePath: c.workspaceDir, mode: "banana" });
    assert.match(e1, /mode|enum|invalid/i);
    const e2 = await c.expectToolError("zcode_task_events", { taskId: "task-x", limit: "many" });
    assert.match(e2, /limit|number|invalid/i);
    const e3 = await c.expectToolError("zcode_task_wait", { taskId: "task-x", timeoutMs: 1.5, extra: true });
    assert.match(e3, /extra|additional|integer|timeoutMs/i);
  } finally {
    await c.stop();
  }
});

test("D-09: limit 0 cannot stall pagination", async () => {
  const c = await startBridge();
  try {
    const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "p" });
    await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 20000 });
    const err = await c.expectToolError("zcode_task_events", { taskId: task.taskId, limit: 0 });
    assert.match(err, /limit/i);
  } finally {
    await c.stop();
  }
});

test("D-04: harness exit mid-turn interrupts the task and frees the workspace", async () => {
  const c = await startBridge({ env: { FAKE_EXIT_ON_SEND: "1" } });
  try {
    const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "crash me" });
    const done = await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 15000 });
    assert.equal(done.state, "interrupted", JSON.stringify(done));
    const tasks = await c.tool("zcode_tasks_list", { workspacePath: c.workspaceDir });
    assert.ok(tasks.tasks.every((t) => t.state === "interrupted"));
  } finally {
    await c.stop();
  }
});

test("D-05: cancelling a queued task cancels it immediately and it never starts", async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "zh-log-")), "runtime.jsonl");
  const c = await startBridge({ maxConcurrentTasks: "1", env: { FAKE_RUNTIME_LOG: logFile, FAKE_TURN: "hang" } });
  try {
    const t1 = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "one", readOnly: true });
    await c.tool("zcode_task_wait", { taskId: t1.taskId, timeoutMs: 2000, });
    const t2 = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "two", readOnly: true });
    assert.equal(t2.state, "queued");
    const started = Date.now();
    const cancelled = await c.tool("zcode_task_cancel", { taskId: t2.taskId });
    assert.equal(cancelled.state, "cancelled");
    assert.ok(Date.now() - started < 2000, "queued cancel must not poll the harness for seconds");
    await c.tool("zcode_task_cancel", { taskId: t1.taskId });
    await new Promise((r) => setTimeout(r, 800));
    const sends = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.method === "session/send");
    assert.ok(!sends.some((s) => s.params.content === "two"), "cancelled queued task must never be sent");
  } finally {
    await c.stop();
  }
});

test("D-11/V3-04: a turn without streamed text is recovered from transcript messages", async () => {
  const c = await startBridge({ env: { FAKE_NO_STREAM: "1" } });
  try {
    const task = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "quiet" });
    await c.tool("zcode_task_wait", { taskId: task.taskId, timeoutMs: 20000 });
    const result = await c.tool("zcode_task_result", { taskId: task.taskId });
    assert.equal(result.responseText, "FAKE-OK");
    assert.equal(result.completeness.status, "full");
    assert.match(result.completeness.explanation, /transcript/);
  } finally {
    await c.stop();
  }
});
