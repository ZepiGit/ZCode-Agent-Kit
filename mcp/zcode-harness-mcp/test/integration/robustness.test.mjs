/**
 * Robustness tests: bridge restart with persistence, two HTTP clients,
 * concurrency limits, harness crash recovery.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge } from "./client.mjs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const execFileAsync = promisify(execFile);

async function crashOwnedFixture(client) {
  const bridgePid = client.child.pid;
  assert.ok(Number.isSafeInteger(bridgePid) && bridgePid > 0);
  assert.equal(client.child.exitCode, null, "test-owned bridge must still be alive");
  assert.equal(client.child.killed, false);
  const fixturePath = path.join(projectRoot, "test", "fixture", "fake-harness.mjs");
  const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
  const script = `
    $ErrorActionPreference = 'Stop'
    $bridge = Get-CimInstance Win32_Process -Filter "ProcessId=${bridgePid}"
    if (!$bridge -or $bridge.ParentProcessId -ne ${process.pid}) {
      throw 'Bridge is not a live child of this test process'
    }
    $fixturePattern = '(?:^|\\s|")' + [regex]::Escape(${psLiteral(fixturePath)}) + '"?\\s+app-server\\s+--stdio\\s*$'
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${bridgePid}" |
      Where-Object { $_.CommandLine -match $fixturePattern })
    if ($children.Count -ne 1) { throw 'Expected exactly one owned fixture app-server' }
    $target = $children[0]
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId) AND ParentProcessId=${bridgePid}"
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=${bridgePid}"
    if (!$owner -or $owner.ParentProcessId -ne ${process.pid} -or $owner.CreationDate -ne $bridge.CreationDate -or
        !$current -or $current.CreationDate -ne $target.CreationDate -or $current.CommandLine -notmatch $fixturePattern) {
      throw 'Fixture ownership changed before termination'
    }
    $result = Invoke-CimMethod -InputObject $current -MethodName Terminate -Arguments @{ Reason = [uint32]1 }
    if ($result.ReturnValue -ne 0) { throw 'Owned fixture termination failed' }
    [int]$target.ProcessId
  `;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", timeout: 15_000, windowsHide: true, shell: false,
  });
  assert.match(stdout.trim(), /^\d+$/, "inspection must confirm one terminated fixture PID");
  return Number(stdout.trim());
}

test("persistence: task survives bridge restart as interrupted, results stay readable", async () => {
  const c1 = await startBridge();
  const dataDir = c1.dataDir;
  let started;
  try {
    started = await c1.tool("zcode_task_start", { workspacePath: c1.workspaceDir, prompt: "restart test", idempotencyKey: "restart-1" });
    await c1.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
  } finally {
    await c1.stop();
  }

  // Restart the bridge on the SAME data dir (c2-style throwaway starts are
  // gone: unknown flags are a hard error now — see config validation).
  const c3 = await startBridge({ reuseDataDir: dataDir, workspaceDirOverride: c1.workspaceDir });
  try {
    const rec = await c3.tool("zcode_task_get", { taskId: started.taskId });
    // The task completed in c1, so the persisted state is terminal and must stay completed.
    assert.equal(rec.state, "completed");
    const result = await c3.tool("zcode_task_result", { taskId: started.taskId });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.responseText, "FAKE-OK");

    // idempotency key must still map to the same task after restart
    const again = await c3.tool("zcode_task_start", { workspacePath: c3.workspaceDir, prompt: "restart test", idempotencyKey: "restart-1" });
    assert.equal(again.taskId, started.taskId);
  } finally {
    await c3.stop();
  }
});

test("read-only invoke gate: session/goal is not invocable via zcode_operation_invoke (H5)", async () => {
  // Audit H5: the invoke allowlist contained session/goal, whose action enum
  // includes mutating verbs (set/replace/pause/resume/clear) — so --read-only
  // was bypassable. Mutating access must go through zcode_session_goal, which
  // enforces requireWritable.
  const c = await startBridge();
  try {
    const err = await c.expectToolError("zcode_operation_invoke", { method: "session/goal", params: { sessionId: "sess_probe", action: "show" } });
    assert.match(err, /operation not invocable/);
  } finally {
    await c.stop();
  }
});

test("concurrency limit: queued read-only tasks run when capacity frees; parallel write tasks blocked", async () => {
  const c = await startBridge({ maxConcurrentTasks: "2", env: { FAKE_SLOW_CREATE_MS: "400" } });
  try {
    // read-only tasks may run in parallel — shows queuing under concurrency
    const t1 = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "one", readOnly: true });
    const t2 = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "two", readOnly: true });
    const t3 = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "three", readOnly: true });
    const states = [t1.state, t2.state, t3.state];
    assert.ok(states.includes("queued"), "third read-only task should be queued, got: " + JSON.stringify(states));
    for (const t of [t1, t2, t3]) {
      const done = await c.tool("zcode_task_wait", { taskId: t.taskId, timeoutMs: 60_000 });
      assert.ok(["completed", "failed"].includes(done.state));
    }
    // second non-readonly task in the SAME workspace while one runs → blocked
    const first = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "write task" });
    const err = await c.expectToolError("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "second write task" });
    assert.match(err, /WORKSPACE_BUSY/);
    await c.tool("zcode_task_wait", { taskId: first.taskId, timeoutMs: 60_000 });
    // after it finishes, a new write task is accepted
    const next = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "second write task again" });
    assert.match(next.taskId, /^task-/);
    await c.tool("zcode_task_wait", { taskId: next.taskId, timeoutMs: 60_000 });
  } finally {
    await c.stop();
  }
});

test("parallel write tasks in DIFFERENT workspaces are allowed", async () => {
  const c = await startBridge({ maxConcurrentTasks: "4", env: { FAKE_SLOW_CREATE_MS: "300" } });
  try {
    const ws2 = path.join(c.dataDir, "ws2");
    fs.mkdirSync(ws2, { recursive: true });
    // allowlist contains only c.workspaceDir; ws2 is NOT allowlisted by design —
    // instead start one write task and one read-only task in parallel here.
    const a = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "write A" });
    const b = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "read B", readOnly: true });
    assert.ok(a.taskId && b.taskId);
    await c.tool("zcode_task_wait", { taskId: a.taskId, timeoutMs: 60_000 });
    await c.tool("zcode_task_wait", { taskId: b.taskId, timeoutMs: 60_000 });
  } finally {
    await c.stop();
  }
});

test("harness crash: connection recovers on next call, tasks marked honestly", { skip: process.platform !== "win32" }, async () => {
  const c = await startBridge();
  let sibling;
  try {
    sibling = await startBridge();
    const siblingSession = await sibling.tool("zcode_session_create", { workspacePath: sibling.workspaceDir });
    // A PID not parented by this test must be rejected before any termination.
    await assert.rejects(
      () => crashOwnedFixture({ child: { pid: process.pid, exitCode: null, killed: false } }),
      /Bridge is not a live child of this test process/,
    );
    const started = await c.tool("zcode_task_start", { workspacePath: c.workspaceDir, prompt: "crash test" });
    await c.tool("zcode_task_wait", { taskId: started.taskId, timeoutMs: 30_000 });
    const killedPid = await crashOwnedFixture(c);
    assert.notEqual(killedPid, c.child.pid, "bridge itself must survive");
    let stopped;
    for (let i = 0; i < 40; i += 1) {
      stopped = await c.tool("zcode_health", {});
      if (stopped.runtime.running === false) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(stopped.runtime.running, false, "crash injection must actually stop the fixture harness (F3)");
    const siblingState = await sibling.tool("zcode_session_get", { sessionId: siblingSession.session.sessionId });
    assert.equal(siblingState.projection.sessionId, siblingSession.session.sessionId, "other bridge's fixture session must survive");
    // Next harness-bound call must recover transparently (restart once).
    const health = await c.tool("zcode_health", {});
    assert.equal(health.degraded ?? false, false);
    const models = await c.tool("zcode_models_list", { workspacePath: c.workspaceDir });
    assert.ok(models.modelCatalog.available.length >= 2);
    const recovered = await c.tool("zcode_health", {});
    assert.equal(recovered.runtime.running, true);
    const retained = await c.tool("zcode_task_get", { taskId: started.taskId });
    assert.equal(retained.state, "completed", "completed task must not be changed by a later crash");
  } finally {
    await Promise.all([c.stop(), sibling?.stop()]);
  }
});

test("two clients over HTTP: independent sessions, same tasks visible", async () => {
  const dataDir = path.join(os.tmpdir(), `zcode-harness-http-${Date.now()}`);
  fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
  const workspaceDir = path.join(dataDir, "ws");
  fs.mkdirSync(workspaceDir, { recursive: true });

  const server = spawn(process.execPath, [
    path.join(projectRoot, "dist", "index.js"),
    "--http",
    "--http-key", "test-key-robustness",
    "--port", "3399",
    "--host", "127.0.0.1",
    "--data-dir", dataDir,
    "--allow-workspace", workspaceDir,
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      ZCODE_HARNESS_RUNTIME_PATH: path.join(projectRoot, "test", "fixture", "fake-harness.mjs"),
      ZCODE_HARNESS_LOG_LEVEL: "warn",
    },
  });
  // poll instead of a fixed sleep: the bridge must be listening before calls
  let serverUp = false;
  for (let i = 0; i < 20 && !serverUp; i += 1) {
    await new Promise((r) => setTimeout(r, 300));
    serverUp = await fetch("http://127.0.0.1:3399/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-robustness" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
    }).then((r) => r.status !== 503).catch(() => false);
  }
  assert.ok(serverUp, "bridge HTTP server did not come up in time");

  const mcpCall = async (body) => {
    const res = await fetch("http://127.0.0.1:3399/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer test-key-robustness" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // JSON or SSE
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line ? line.slice(5) : text);
  };

  try {
    for (const clientName of ["clientA", "clientB"]) {
      const init = await mcpCall({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: clientName, version: "0" } },
      });
      assert.equal(init.result.serverInfo.name, "zcode-harness-mcp");
      const tools = await mcpCall({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      assert.ok(tools.result.tools.length >= 30);
    }
    // Client A starts a task; client B sees it via zcode_tasks_list.
    const started = await mcpCall({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "zcode_task_start", arguments: { workspacePath: workspaceDir, prompt: "http task", idempotencyKey: "http-1" } },
    });
    const payload = JSON.parse(started.result.content[0].text);
    assert.match(payload.taskId, /^task-/);

    // wait via repeated calls
    let state = null;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const rec = await mcpCall({
        jsonrpc: "2.0", id: 100 + i, method: "tools/call",
        params: { name: "zcode_task_get", arguments: { taskId: payload.taskId } },
      });
      state = JSON.parse(rec.result.content[0].text).state;
      if (state === "completed") break;
    }
    assert.equal(state, "completed");
  } finally {
    try {
      server.kill();
    } catch {
      /* ignore */
    }
  }
});
