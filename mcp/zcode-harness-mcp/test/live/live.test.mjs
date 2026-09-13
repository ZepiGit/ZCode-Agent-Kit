/**
 * Live tests against the REAL installed ZCode harness (0.16.5).
 * Skipped unless LIVE_TEST=1 is set. Usage:
 *   LIVE_TEST=1 node --test test/live/live.test.mjs
 *
 * Live reality (documented in TEST_REPORT.md): model turns from harness
 * processes outside the desktop currently fail with provider risk control
 * ("captcha verify failed"). These tests verify everything up to that
 * honest failure surface and never claim model output that did not happen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge } from "../integration/client.mjs";

const enabled = process.env.LIVE_TEST === "1" && process.env.LIVE_WORKSPACE;

test("live: runtime discovery finds the real installed harness", { skip: !enabled }, async () => {
  const c = await startBridge({ reuseDataDir: process.env.LIVE_DATA_DIR, workspaceDirOverride: process.env.LIVE_WORKSPACE, useRealRuntime: true });
  try {
    const health = await c.tool("zcode_health", {});
    assert.equal(health.degraded ?? false, false);
    assert.match(String(health.runtime.harnessPath), /zcode\.cjs$/);
    assert.equal(health.runtime.harnessVersion, "0.16.5");
    assert.ok(health.runtime.bundleFingerprint);
    assert.ok(health.runtime.bundleFingerprint.length === 16);
    assert.equal(health.protocol, "ZCode Protocol v1 (zcode.cjs app-server --stdio, verified 0.16.5)");
  } finally {
    await c.stop();
  }
});

test("live: real workspace state, model catalog, settings schema", { skip: !enabled }, async () => {
  const c = await startBridge({ reuseDataDir: process.env.LIVE_DATA_DIR, workspaceDirOverride: process.env.LIVE_WORKSPACE, useRealRuntime: true });
  try {
    const opened = await c.tool("zcode_workspace_open", { workspacePath: process.env.LIVE_WORKSPACE });
    assert.ok(opened.revision >= 0);
    const models = await c.tool("zcode_models_list", { workspacePath: process.env.LIVE_WORKSPACE });
    const ids = (models.modelCatalog.available ?? []).map((m) => `${m.ref.providerId}/${m.ref.modelId}`);
    assert.ok(ids.length >= 2, "live catalog should list models, got: " + JSON.stringify(ids));
    console.log("live catalog:", ids.join(", "));
    assert.ok(!ids.includes("zai/GLM-5.3-Flash"), "GLM-5.3-Flash is not part of the local plan catalog; selection must fail with the catalog");
    const schema = await c.tool("zcode_settings_schema", { workspacePath: process.env.LIVE_WORKSPACE });
    assert.ok(schema.settings.find((s) => s.path === "model").choices.length >= 2);
  } finally {
    await c.stop();
  }
});

test("live: session create/setModel read-back/invalid model/close", { skip: !enabled }, async () => {
  const c = await startBridge({ reuseDataDir: process.env.LIVE_DATA_DIR, workspaceDirOverride: process.env.LIVE_WORKSPACE, useRealRuntime: true });
  try {
    const session = await c.tool("zcode_session_create", { workspacePath: process.env.LIVE_WORKSPACE });
    const sessionId = session.session?.sessionId ?? session.sessionId;
    assert.match(String(sessionId), /^sess_/);
    const firstModel = await c.tool("zcode_models_list", { workspacePath: process.env.LIVE_WORKSPACE });
    const pick = firstModel.modelCatalog.available[0].ref;
    const set = await c.tool("zcode_model_set", { scope: "session", sessionId, model: `${pick.providerId}/${pick.modelId}` });
    assert.equal(set.effective.model, `${pick.providerId}/${pick.modelId}`);
    assert.equal(set.verified, true);
    const err = await c.expectToolError("zcode_model_set", { scope: "session", sessionId, model: "zai/GLM-9.9-DoesNotExist" });
    assert.match(err, /Unsupported model|Available models/);
    const closed = await c.tool("zcode_session_close", { sessionId });
    assert.equal(closed.closed, true);
  } finally {
    await c.stop();
  }
});

test("live: task pipeline runs a real turn and surfaces the provider outcome honestly", { skip: !enabled }, async () => {
  const c = await startBridge({ reuseDataDir: process.env.LIVE_DATA_DIR, workspaceDirOverride: process.env.LIVE_WORKSPACE, useRealRuntime: true });
  try {
    const started = await c.tool("zcode_task_start", {
      workspacePath: process.env.LIVE_WORKSPACE,
      prompt: "Reply with exactly: OK",
      idempotencyKey: "live-turn-1",
    });
    const done = await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 120_000 });
    const result = await c.tool("zcode_task_result", { taskId: started.taskId });
    console.log("live turn outcome:", done.state, "| provider events:", result.errors.join("; ").slice(0, 300));
    if (done.state === "failed") {
      // The known environment blocker: provider risk control rejects CLI-spawned turns.
      assert.ok(
        result.errors.some((e) => /captcha|auth_failed|400|provider/i.test(e)),
        "failure must carry the harness/provider attribution: " + JSON.stringify(result.errors)
      );
      assert.equal(result.completeness.status, "partial");
      assert.equal(result.partial, true);
      const events = await c.tool("zcode_task_events", { taskId: started.taskId, afterSeq: -1, limit: 500 });
      const types = events.items.map((e) => e.type);
      assert.ok(types.includes("turn.started"), "the harness really started the turn: " + JSON.stringify(types));
      assert.ok(types.includes("turn.failed"));
    } else if (done.state === "completed") {
      // If risk control no longer blocks CLI turns, the full flow must work.
      assert.ok(result.responseText.length > 0);
      assert.equal(result.partial, false);
    } else {
      assert.fail(`unexpected terminal state: ${done.state}`);
    }
  } finally {
    await c.stop();
  }
});

test("live: usage statistics from the real account", { skip: !enabled }, async () => {
  const c = await startBridge({ reuseDataDir: process.env.LIVE_DATA_DIR, workspaceDirOverride: process.env.LIVE_WORKSPACE, useRealRuntime: true });
  try {
    const usage = await c.tool("zcode_operation_invoke", { method: "usage/stats", params: { range: "7d" } });
    assert.ok(usage.summary.totalTokens >= 0);
  } finally {
    await c.stop();
  }
});
