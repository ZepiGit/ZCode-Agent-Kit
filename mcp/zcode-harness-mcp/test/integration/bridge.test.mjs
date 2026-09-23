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
    const caps = await c.tool("zcode_capabilities", {});
    assert.ok(caps.capabilities.length >= 40);
  } finally {
    await c.stop();
  }
});

test("workspace presentation and full catalog do not invent defaults or retain discovery sessions", async () => {
  const c = await startBridge();
  try {
    const opened = await c.tool("zcode_workspace_open", { workspacePath: c.workspaceDir });
    assert.equal(opened.revision, null);
    assert.equal(opened.settings.model, null);
    assert.equal(opened.presentation.mode, "build");
    const existing = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const before = await c.tool("zcode_sessions_list", {});
    const models = await c.tool("zcode_models_list", { workspacePath: c.workspaceDir });
    assert.deepEqual(models.modelCatalog.available.map(m => `${m.ref.providerId}/${m.ref.modelId}`), ["zai-api/GLM-5.3-Flash", "fake/FAKE-Main", "fake/FAKE-Lite"]);
    assert.equal(models.revision, null);
    assert.deepEqual(await c.tool("zcode_sessions_list", {}), before);
    const original = await c.tool("zcode_session_get", { sessionId: existing.session.sessionId });
    assert.equal(original.settings.mode.current, "build");
    assert.equal(original.settings.model.current.modelId, "FAKE-Main");
    assert.equal(original.projection.turnCount, 0);
    assert.equal(original.settings.model.available.length, 1); // native read is current-only
  } finally {
    await c.stop();
  }
});

test("settings expose native process scope and reject unavailable workspace defaults and CAS", async () => {
  const c = await startBridge();
  try {
    const schema = await c.tool("zcode_settings_schema", { workspacePath: c.workspaceDir });
    assert.equal(schema.revision, null);
    assert.equal(schema.settings.find(s => s.path === "model").writable, false);
    const preference = schema.settings.find(s => s.path === "dynamicWorkflowEnabled");
    assert.equal(preference.scope, "runtime");
    assert.equal(preference.effective, null);
    const changes = { askUserQuestionAutoResolutionEnabled: false, modelIoFullRetentionEnabled: false, offPeakToolEnabled: false, dynamicWorkflowEnabled: true };
    const update = await c.tool("zcode_settings_update", { workspacePath: c.workspaceDir, changes });
    assert.deepEqual(Object.fromEntries(update.applied.map(a => [a.path, a.after])), changes);
    assert.equal(update.revision, null);
    assert.ok(update.applied.every(a => a.scope === "runtime" && a.verification === "native-acknowledgement"));
    assert.match(await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { mode: "plan" } }), /UNSUPPORTED_WORKSPACE_DEFAULT/);
    assert.match(await c.expectToolError("zcode_model_set", { scope: "workspace", workspacePath: c.workspaceDir, model: "fake\/FAKE-Lite" }), /UNSUPPORTED_WORKSPACE_DEFAULT/);
    assert.match(await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes, expectedRevision: 0 }), /UNSUPPORTED_REVISION/);
    assert.match(await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { unknown: true } }), /UNKNOWN_SETTING/);
    assert.match(await c.expectToolError("zcode_settings_reset", { workspacePath: c.workspaceDir, path: "mode" }), /UNSUPPORTED_WORKSPACE_DEFAULT/);
    const state = await c.tool("zcode_settings_get", { workspacePath: c.workspaceDir });
    assert.equal(state.settings.model, null);
  } finally {
    await c.stop();
  }
});

test("model selection: valid read-back and unsupported model error", async () => {
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

test("native session CAS selects Flash and low reasoning atomically before mode changes", async () => {
  const c = await startBridge({ env: { FAKE_REQUIRE_REASONING: "1" } });
  try {
    const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const sessionId = created.session.sessionId;
    const selected = await c.tool("zcode_model_set", { scope: "session", sessionId, model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low", mode: "plan", expectedRevision: 0 });
    assert.deepEqual(selected.effective, { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low", mode: "plan" });
    assert.equal(selected.verified, true);
    const conflict = await c.expectToolError("zcode_model_set", { scope: "session", sessionId, model: "fake/FAKE-Main", thoughtLevel: "max", expectedRevision: 0 });
    assert.match(conflict, /revision mismatch/);
    const invalid = await c.expectToolError("zcode_model_set", { scope: "session", sessionId, model: "fake/FAKE-Lite", thoughtLevel: "low", mode: "build", expectedRevision: selected.revision });
    assert.match(invalid, /Unsupported reasoning effort/);
    const unchanged = await c.tool("zcode_session_get", { sessionId });
    assert.equal(unchanged.settings.model.current.modelId, "GLM-5.3-Flash");
    assert.equal(unchanged.settings.thoughtLevel.current, "low");
    assert.equal(unchanged.settings.mode.current, "plan");
    assert.equal(unchanged.runtime.stateRevision, selected.revision);
    const thoughtOnly = await c.tool("zcode_model_set", { scope: "session", sessionId, thoughtLevel: "max", expectedRevision: selected.revision });
    assert.equal(thoughtOnly.verified, true);
    assert.deepEqual(thoughtOnly.effective, { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "max", mode: "plan" });
  } finally { await c.stop(); }
});

test("model selection does not claim verification when native read-back differs", async () => {
  const c = await startBridge({ env: { FAKE_MODEL_MISMATCH: "1" } });
  try {
    const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const selected = await c.tool("zcode_model_set", { scope: "session", sessionId: created.session.sessionId, model: "fake/FAKE-Lite" });
    assert.equal(selected.verified, false);
    assert.equal(selected.effective.model, "fake/FAKE-Main");
  } finally { await c.stop(); }
});

test("model selection does not verify an acknowledged but unapplied reasoning level", async () => {
  const c = await startBridge({ env: { FAKE_REQUIRE_REASONING: "1", FAKE_THOUGHT_MISMATCH: "1" } });
  try {
    const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const selected = await c.tool("zcode_model_set", { scope: "session", sessionId: created.session.sessionId, model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low" });
    assert.equal(selected.verified, false);
    assert.deepEqual(selected.effective, { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "max", mode: "build" });
  } finally { await c.stop(); }
});

test("task_start completes with Flash and low reasoning when atomic reasoning is required", async () => {
  const c = await startBridge({ env: { FAKE_REQUIRE_REASONING: "1" } });
  try {
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "fixture Flash turn", model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low", readOnly: true });
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    assert.equal(done.state, "completed");
    const result = await c.tool("zcode_task_result", { taskId: started.taskId });
    assert.equal(result.status, "completed");
    assert.equal(result.responseText, "FAKE-OK");
    assert.equal(result.requestedModel, "zai-api/GLM-5.3-Flash");
    assert.deepEqual(result.effectiveModel, { providerId: "zai-api", modelId: "GLM-5.3-Flash" });
    assert.equal(result.thoughtLevel, "low");
    const session = await c.tool("zcode_session_get", { sessionId: done.sessionId });
    assert.equal(session.settings.thoughtLevel.current, "low");
    assert.equal(session.settings.mode.current, "plan");
    assert.equal(session.projection.turnCount, 1);
  } finally { await c.stop(); }
});

for (const scenario of [
  { name: "model mismatch", env: { FAKE_MODEL_MISMATCH: "1" }, request: { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low" }, error: /differs from effective model/ },
  { name: "atomic effort mismatch", env: { FAKE_THOUGHT_MISMATCH: "1" }, request: { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low" }, error: /differs from effective reasoning level/ },
  { name: "thought-only effort mismatch", env: { FAKE_THOUGHT_MISMATCH: "1" }, request: { thoughtLevel: "low" }, error: /differs from effective reasoning level/ },
  { name: "invalid atomic effort", env: {}, request: { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "enabled" }, error: /Unsupported reasoning effort/ },
  { name: "invalid thought-only effort", env: {}, request: { thoughtLevel: "enabled" }, error: /Unsupported reasoning effort/ },
  // Matching the current model does not excuse a rejected startup setter.
  { name: "missing required effort on the current model", env: {}, request: { model: "fake/FAKE-Main" }, error: /Reasoning level is required/ },
]) {
  test(`task_start rejects ${scenario.name} before sending and retains the user session`, async () => {
    const c = await startBridge({ env: { FAKE_REQUIRE_REASONING: "1", ...scenario.env } });
    try {
      const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
      const sessionId = created.session.sessionId;
      const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, sessionId, prompt: "must not be sent", ...scenario.request });
      const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
      assert.equal(done.state, "failed");
      assert.match(done.error, scenario.error);
      const result = await c.tool("zcode_task_result", { taskId: started.taskId });
      assert.equal(result.status, "failed");
      assert.equal(result.responseText, "");
      assert.ok(result.errors.some(error => scenario.error.test(error)));
      const session = await c.tool("zcode_session_get", { sessionId });
      assert.equal(session.projection.turnCount, 0);
      assert.equal(session.projection.status, "idle");
      const beforeInput = await c.tool("zcode_task_get", { taskId: started.taskId });
      const rejected = await c.expectToolError("zcode_task_input", { taskId: started.taskId, content: "must not bypass failed selection" });
      assert.match(rejected, /selection was never verified.*start a new task/);
      assert.deepEqual(await c.tool("zcode_session_get", { sessionId }), session);
      assert.deepEqual(await c.tool("zcode_task_get", { taskId: started.taskId }), beforeInput);
      assert.deepEqual(await c.tool("zcode_task_result", { taskId: started.taskId }), result);
    } finally { await c.stop(); }
  });
}

for (const scenario of [
  { name: "model", request: { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low" }, change: { model: "fake/FAKE-Main", thoughtLevel: "low" }, error: /differs from effective model/ },
  { name: "effort with explicit model", request: { model: "zai-api/GLM-5.3-Flash", thoughtLevel: "low" }, change: { thoughtLevel: "max" }, error: /differs from effective reasoning level/ },
  { name: "effort without explicit model", request: { thoughtLevel: "low" }, change: { thoughtLevel: "max" }, error: /differs from effective reasoning level/ },
]) {
  test(`terminal task_input rejects changed ${scenario.name} without altering the session or completed result`, async () => {
    const c = await startBridge({ env: { FAKE_REQUIRE_REASONING: "1" } });
    try {
      const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
      const sessionId = created.session.sessionId;
      const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, sessionId, prompt: "first verified turn", ...scenario.request });
      const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
      assert.equal(done.state, "completed");
      const result = await c.tool("zcode_task_result", { taskId: started.taskId });
      assert.equal(result.responseText, "FAKE-OK");
      const beforeInput = await c.tool("zcode_task_get", { taskId: started.taskId });
      const changed = await c.tool("zcode_model_set", { scope: "session", sessionId, ...scenario.change });
      assert.equal(changed.verified, true);
      const session = await c.tool("zcode_session_get", { sessionId });
      assert.equal(session.projection.turnCount, 1);

      const rejected = await c.expectToolError("zcode_task_input", { taskId: started.taskId, content: "must not use changed selection" });
      assert.match(rejected, scenario.error);
      assert.deepEqual(await c.tool("zcode_session_get", { sessionId }), session);
      assert.deepEqual(await c.tool("zcode_task_get", { taskId: started.taskId }), beforeInput);
      assert.deepEqual(await c.tool("zcode_task_result", { taskId: started.taskId }), result);

      // Restoring the original selection permits a real follow-up in the same
      // user session, rather than permanently disabling completed-task input.
      const restored = await c.tool("zcode_model_set", { scope: "session", sessionId, ...scenario.request });
      assert.equal(restored.verified, true);
      await c.tool("zcode_task_input", { taskId: started.taskId, content: "follow-up with original selection" });
      const followed = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
      assert.equal(followed.state, "completed");
      assert.equal(followed.sessionId, sessionId);
      assert.equal(followed.followUpCount, 1);
      const finalSession = await c.tool("zcode_session_get", { sessionId });
      assert.equal(finalSession.projection.turnCount, 2);
      assert.equal(finalSession.settings.thoughtLevel.current, "low");
      const followupResult = await c.tool("zcode_task_result", { taskId: started.taskId });
      assert.equal(followupResult.responseText, "FAKE-OK");
      assert.deepEqual(followupResult.effectiveModel, finalSession.settings.model.current);
    } finally { await c.stop(); }
  });
}

test("empty explicit effort is rejected rather than silently using the model default", async () => {
  const c = await startBridge();
  try {
    const created = await c.tool("zcode_session_create", { workspacePath: c.workspaceDir });
    const sessionId = created.session.sessionId;
    assert.match(await c.expectToolError("zcode_model_set", { scope: "session", sessionId, model: "zai-api/GLM-5.3-Flash", thoughtLevel: "" }), /thoughtLevel/);
    assert.match(await c.expectToolError("zcode_task_start", { workspacePath: c.workspaceDir, sessionId, prompt: "must not be sent", model: "zai-api/GLM-5.3-Flash", thoughtLevel: "" }), /thoughtLevel/);
    const session = await c.tool("zcode_session_get", { sessionId });
    assert.equal(session.settings.model.current.modelId, "FAKE-Main");
    assert.equal(session.projection.turnCount, 0);
  } finally { await c.stop(); }
});

test("missing native catalog is an error and still closes the owned deferred session", async () => {
  const c = await startBridge({ env: { FAKE_MISSING_CATALOG: "1" } });
  try {
    assert.match(await c.expectToolError("zcode_models_list", { workspacePath: c.workspaceDir }), /INVALID_NATIVE_RESPONSE/);
    assert.deepEqual((await c.tool("zcode_sessions_list", {})).sessions, []);
  } finally { await c.stop(); }
});

test("catalog cleanup refusal is surfaced instead of claiming successful discovery", async () => {
  const c = await startBridge({ env: { FAKE_REFUSE_CLOSE: "1" } });
  try {
    assert.match(await c.expectToolError("zcode_models_list", { workspacePath: c.workspaceDir }), /CATALOG_SESSION_NOT_CLOSED/);
  } finally { await c.stop(); }
});

test("runtime preference acknowledgement mismatch is not reported as applied", async () => {
  const c = await startBridge({ env: { FAKE_PREFERENCE_MISMATCH: "1" } });
  try {
    assert.match(await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { dynamicWorkflowEnabled: true } }), /VERIFICATION_FAILED/);
  } finally { await c.stop(); }
});

test("invalid preference batch is rejected before its valid prefix mutates native state", async () => {
  const c = await startBridge();
  try {
    const before = await c.tool("zcode_workspace_open", { workspacePath: c.workspaceDir });
    const result = await c.expectToolError("zcode_settings_update", { workspacePath: c.workspaceDir, changes: { dynamicWorkflowEnabled: true, modelIoFullRetentionEnabled: "yes" } });
    assert.match(result, /INVALID_VALUE/);
    assert.deepEqual(await c.tool("zcode_workspace_open", { workspacePath: c.workspaceDir }), before);
  } finally { await c.stop(); }
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
    assert.match(await c.expectToolError("zcode_models_list", { workspacePath: c.workspaceDir }), /READ_ONLY_MODE/);
    const presentation = await c.tool("zcode_workspace_open", { workspacePath: c.workspaceDir });
    assert.equal(presentation.presentation.mode, "build");
    const capability = await c.tool("zcode_operation_invoke", { method: "runtime/capabilities" });
    assert.equal(capability.independentPlanState, true);
    assert.deepEqual((await c.tool("zcode_sessions_list", {})).sessions, []);
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
