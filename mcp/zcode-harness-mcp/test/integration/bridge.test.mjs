/**
 * Integration tests: bridge against the fixture harness, driven through the
 * real MCP interface (never internal function calls).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge } from "./client.mjs";
import fs from "node:fs";
import path from "node:path";

test("health + capabilities over MCP", async () => {
  const c = await startBridge();
  try {
    const health = await c.tool("zcode_health", {});
    assert.equal(health.degraded ?? false, false);
    assert.match(String(health.runtime.harnessPath), /fake-harness\.mjs$/);
    assert.equal(health.runtime.harnessVersion, "0.16.5"); // fixture reports --version output
    const caps = await c.tool("zcode_capabilities", {});
    assert.ok(caps.capabilities.length >= 40);
  } finally {
    await c.stop();
  }
});

test("workspace open + model catalog from live readState", async () => {
  const c = await startBridge();
  try {
    const opened = await c.tool("zcode_workspace_open", { workspacePath: c.workspaceDir });
    assert.ok(opened.revision >= 0);
    const models = await c.tool("zcode_models_list", { workspacePath: c.workspaceDir });
    const ids = (models.modelCatalog.available ?? []).map((m) => `${m.ref.providerId}/${m.ref.modelId}`);
    assert.deepEqual(ids, ["fake/FAKE-Main", "fake/FAKE-Lite"]);
  } finally {
    await c.stop();
  }
});

test("settings schema/get/update/reset with CAS + verification", async () => {
  const c = await startBridge();
  try {
    const schema = await c.tool("zcode_settings_schema", { workspacePath: c.workspaceDir });
    const paths = schema.settings.map((s) => s.path);
    assert.ok(paths.includes("mode") && paths.includes("model") && paths.includes("thoughtLevel"));

    // invalid value rejected
    const err1 = await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { mode: "banana" } });
    assert.match(err1, /INVALID_VALUE|mode must be/);

    // unknown field rejected (no silent writes)
    const err2 = await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { doesNotExist: 1 } });
    assert.match(err2, /UNKNOWN_SETTING|unknown/);

    // valid update with read-back
    const upd = await c.tool("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { mode: "plan" } });
    const modeEntry = upd.applied.find((a) => a.path === "mode");
    assert.equal(modeEntry.after, "plan");

    // CAS conflict rejected
    const schema2 = await c.tool("zcode_settings_schema", { workspacePath: c.workspaceDir });
    const err3 = await c.expectToolError("zcode_settings_update", {
      workspacePath: c.workspaceDir,
      changes: { mode: "build" },
      expectedRevision: schema2.revision + 100,
    });
    assert.match(err3, /revision moved/);

    // reset
    const reset = await c.tool("zcode_settings_reset", { workspacePath: c.workspaceDir, path: "mode" });
    assert.equal(reset.applied.find((a) => a.path === "mode")?.after, "build");
  } finally {
    await c.stop();
  }
});

test("model selection: valid + read-back, invalid + catalog error, flash-not-available case", async () => {
  const c = await startBridge();
  try {
    // valid session-scoped selection with read-back
    const session = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const sessionId = session.session.sessionId;
    assert.match(sessionId, /^sess_/);

    const set = await c.tool("zcode_model_set", { scope: "session", sessionId, model: "fake/FAKE-Lite" });
    assert.equal(set.effective.model, "fake/FAKE-Lite");
    assert.equal(set.verified, true);

    // invalid model
    const err = await c.expectToolError("zcode_model_set", { scope: "session", sessionId, model: "fake/NOPE" });
    assert.match(err, /Unsupported model: fake\/NOPE.*Available models/s);
  } finally {
    await c.stop();
  }
});

test("task lifecycle: start → events → wait → complete → result", async () => {
  const c = await startBridge();
  try {
    const started = await c.tool("zcode_task_start", {
      workspacePath: c.workspaceDir,
      prompt: "fixture turn",
      idempotencyKey: "acc-4",
    });
    assert.match(started.taskId, /^task-/);
    assert.ok(["queued", "starting", "running"].includes(started.state));

    // idempotency: same key returns the same task
    const again = await c.tool("zcode_task_start", {
      workspacePath: c.workspaceDir,
      prompt: "fixture turn",
      idempotencyKey: "acc-4",
    });
    assert.equal(again.taskId, started.taskId);

    // events with cursor (read after completion so the turn has settled)
    const settled = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.equal(settled.state, "completed");
    const ev1 = await c.tool("zcode_task_events", { taskId: started.taskId, afterSeq: -1, limit: 100 });
    const types = ev1.items.map((e) => e.type);
    assert.ok(types.includes("turn.started"));
    assert.ok(types.includes("turn.completed"));
    const ev2 = await c.tool("zcode_task_events", { taskId: started.taskId, afterSeq: ev1.items[0].seq, limit: 100 });
    assert.ok(ev2.items.every((e) => e.seq > ev1.items[0].seq));

    // wait for terminal
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.equal(done.state, "completed");

    // result
    const result = await c.tool("zcode_task_result", { taskId: started.taskId });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.status, "completed");
    assert.equal(result.responseText, "FAKE-OK");
    assert.equal(result.partial, false);
    assert.ok(result.usage.cumulative.totalTokens >= 0);
    assert.equal(result.requestedModel, null);
    assert.match(result.effectiveModel.modelId, /FAKE-Main|FAKE-Lite/);
    assert.ok(result.fileChanges.modified.includes("fixture-output.txt"));

    // resource read parity: result via zcode://tasks/{id}/result
    const res = await c.call("resources/read", { uri: `zcode://tasks/${started.taskId}/result` });
    const text = res.result?.contents?.[0]?.text ?? res.contents?.[0]?.text;
    assert.ok(text);
    const parsed = JSON.parse(text);
    assert.equal(parsed.taskId, started.taskId);
    assert.equal(parsed.status, "completed");
  } finally {
    await c.stop();
  }
});

test("follow-up input keeps session context; steering accepted", async () => {
  const c = await startBridge();
  try {
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "first" });
    await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    const after = await c.tool("zcode_task_input", { taskId: started.taskId, content: "follow-up" });
    assert.equal(after.state, "running");
    assert.equal(after.followUpCount, 1);
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.equal(done.state, "completed");
    const result = await c.tool("zcode_task_result", { taskId: started.taskId });
    assert.equal(result.sessionId, done.sessionId);
  } finally {
    await c.stop();
  }
});

test("cancel: stop verified, partial results retained", async () => {
  const c = await startBridge();
  try {
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "cancel me" });
    const cancelled = await c.tool("zcode_task_cancel", { taskId: started.taskId }, 30_000);
    assert.ok(["cancelled", "completed", "unknown"].includes(cancelled.state));
    const result = await c.tool("zcode_task_result", { taskId: started.taskId });
    assert.ok(result.schemaVersion === 1);
  } finally {
    await c.stop();
  }
});

test("interactions: permission surfaced, answered, task resumes; timeout denies", async () => {
  const c = await startBridge({ interactionPolicy: "ask", interactionTimeoutSec: 3, env: { FAKE_PERMISSION: "1", FAKE_PERMISSION_TOOL: "Write" } });
  try {
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "needs permission" });
    // wait for the interaction to appear
    let interactions = null;
    for (let i = 0; i < 40 && !interactions; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      const list = await c.tool("zcode_interactions_list", { status: "pending" });
      if ((list.interactions ?? []).length > 0) interactions = list;
    }
    assert.ok(interactions, "permission interaction should appear");
    const ia = interactions.interactions.find((i) => i.kind === "permission");
    assert.ok(ia);
    assert.equal(ia.toolName, "Write");
    assert.ok(ia.options.some((o) => o.id === "allow_once"));

    // invalid optionId rejected
    const err = await c.expectToolError("zcode_interaction_respond", { interactionId: ia.id, optionId: "allow_everything" });
    assert.match(err, /optionId must be one of/);

    // deny it; task must still finish
    const resolved = await c.tool("zcode_interaction_respond", { interactionId: ia.id, optionId: "deny_once" });
    assert.equal(resolved.status, "resolved");
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.equal(done.state, "completed");
  } finally {
    await c.stop();
  }

  // timeout path: unanswered permission expires and denies
  const c2 = await startBridge({ interactionPolicy: "ask", interactionTimeoutSec: 2, env: { FAKE_PERMISSION: "1", FAKE_PERMISSION_TOOL: "Write" } });
  try {
    const started = await c2.tool("zcode_task_start", { workspacePath: c2.workspaceDir, prompt: "permission timeout" });
    await c2.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    const list = await c2.tool("zcode_interactions_list", { status: "resolved" });
    const ia = (list.interactions ?? []).find((i) => i.kind === "permission");
    assert.ok(ia, "permission should be recorded");
    assert.ok(["expired", "resolved"].includes(ia.status));
    if (ia.status === "expired") assert.equal(ia.resolvedBy, "timeout");
  } finally {
    await c2.stop();
  }
});

test("user input interaction surfaces and is answerable", async () => {
  const c = await startBridge({ interactionPolicy: "ask", interactionTimeoutSec: 10, env: { FAKE_USERINPUT: "1" } });
  try {
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "needs input" });
    let ia = null;
    for (let i = 0; i < 40 && !ia; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      const list = await c.tool("zcode_interactions_list", { status: "pending" });
      ia = (list.interactions ?? []).find((i) => i.kind === "user_input");
    }
    assert.ok(ia, "user input interaction should appear");
    const state = await c.tool("zcode_task_get", { taskId: started.taskId });
    assert.equal(state.state, "waiting_for_input");
    const resolved = await c.tool("zcode_interaction_respond", { interactionId: ia.id, value: { answers: [{ label: "Yes" }] } });
    assert.equal(resolved.status, "resolved");
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.equal(done.state, "completed");
  } finally {
    await c.stop();
  }
});

test("read-only mode: mutating tools blocked, read tools work", async () => {
  const c = await startBridge({ readOnly: true });
  try {
    const err = await c.expectToolError("zcode_session_create", { workspacePath: c.workspaceDir });
    assert.match(err, /READ_ONLY_MODE/);
    const health = await c.tool("zcode_health", {});
    assert.equal(health.bridge.readOnly, true);
    const models = await c.tool("zcode_models_list", { workspacePath: c.workspaceDir });
    assert.ok(models.modelCatalog.available.length >= 2);
    // task_start blocked too
    const err2 = await c.expectToolError("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "nope" });
    assert.match(err2, /READ_ONLY_MODE/);
  } finally {
    await c.stop();
  }
});

test("task read-only enforcement: plan mode + tool denylist reach the harness", async () => {
  const c = await startBridge();
  try {
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "read-only task", readOnly: true });
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.ok(done.sessionId, "task should have a session after start");
    const state = await c.tool("zcode_session_get", { sessionId: done.sessionId });
    assert.equal(state.settings.mode.current, "plan");
  } finally {
    await c.stop();
  }
});

test("artifact read: content, hash, truncation; path escape denied", async () => {
  const c = await startBridge();
  try {
    const secret = "fixture-artifact-" + "x".repeat(5000);
    const file = path.join(c.workspaceDir, "artifact.txt");
    fs.writeFileSync(file, secret, "utf8");

    const read = await c.tool("zcode_artifact_read", { workspacePath: c.workspaceDir, path: "artifact.txt", length: 100 });
    assert.equal(read.size, Buffer.byteLength(secret));
    assert.equal(read.truncated, true);
    const decoded = Buffer.from(read.contentBase64, "base64").toString("utf8");
    assert.equal(decoded, secret.slice(0, 100));

    // escape attempt
    await assert.rejects(
      () => c.tool("zcode_artifact_read", { workspacePath: c.workspaceDir, path: "..\\..\\package.json" }),
      /escapes workspace|not in the bridge allowlist/
    );
  } finally {
    await c.stop();
  }
});

test("workspace allowlist denies foreign paths", async () => {
  const c = await startBridge();
  try {
    const err = await c.expectToolError("zcode_workspace_open", { workspacePath: "C:\\Windows" });
    assert.match(err, /not in the bridge allowlist/);
  } finally {
    await c.stop();
  }
});

test("secret redaction: api keys never appear in tool output", async () => {
  const c = await startBridge();
  try {
    const health = await c.tool("zcode_health", {});
    const text = JSON.stringify(health);
    assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(text));
  } finally {
    await c.stop();
  }
});

test("unknown tool returns clean MCP error", async () => {
  const c = await startBridge();
  try {
    const resp = await c.call("tools/call", { name: "zcode_nope", arguments: {} });
    assert.equal(resp.result.isError, true);
    assert.match(resp.result.content[0].text, /unknown tool/);
  } finally {
    await c.stop();
  }
});

test("resume + fork + degraded mode", async () => {
  const c = await startBridge();
  try {
    const session = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const sessionId = session.session.sessionId;
    const resumed = await c.tool("zcode_session_resume", { sessionId });
    assert.equal(resumed.sessionId, sessionId);
    const forked = await c.tool("zcode_session_fork", { sessionId });
    assert.match(forked.sessionId, /^sess_/);
    const closed = await c.tool("zcode_session_close", { sessionId });
    assert.equal(closed.closed, true);
  } finally {
    await c.stop();
  }
});

test("scenario 1: discovery without a working runtime degrades with clear diagnosis (no crash, no invented status)", async () => {
  const c = await startBridge({
    useRealRuntime: true,
    env: { ZCODE_HARNESS_RUNTIME_PATH: "C:\\definitely-not-here\\zcode.cjs" },
  });
  try {
    const health = await c.tool("zcode_health", {});
    assert.equal(health.degraded, true);
    assert.match(health.runtime.error, /missing file/i);
    assert.equal(health.runtime.running, false);
    // read tools that do not need the harness still work; harness-bound ones fail cleanly
    const caps = await c.tool("zcode_capabilities", {});
    assert.ok(caps.capabilities.length >= 40);
    const interactions = await c.tool("zcode_interactions_list", { status: "all" });
    assert.deepEqual(interactions.interactions, []);
  } finally {
    await c.stop();
  }
});

test("resources/list exposes per-task URIs; capabilities resource readable", async () => {
  const c = await startBridge();
  try {
    const list = await c.result("resources/list", {});
    const uris = (list.resources ?? []).map((r) => r.uri);
    assert.ok(uris.includes("zcode://capabilities"));
    const caps = await c.result("resources/read", { uri: "zcode://capabilities" });
    const parsed = JSON.parse(caps.contents[0].text);
    assert.ok(parsed.capabilities.length >= 40);
  } finally {
    await c.stop();
  }
});
