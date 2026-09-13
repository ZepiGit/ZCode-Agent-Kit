/**
 * Fixture harness: a deterministic stand-in for `zcode.cjs app-server --stdio`.
 *
 * Speaks the ZCode Protocol (NDJSON, no jsonrpc envelope) with a scripted
 * turn lifecycle so the bridge can be integration-tested without provider
 * access. Activated by pointing ZCODE_HARNESS_RUNTIME_PATH at this file.
 *
 * Behaviour flags via env:
 *   FAKE_TURN=ok|fail|hang          turn outcome (default ok)
 *   FAKE_PERMISSION=0|1             raise interaction/requestPermission during turn
 *   FAKE_USERINPUT=0|1              raise interaction/requestUserInput during turn
 *   FAKE_SLOW_CREATE_MS=...         delay before session/create answers
 */
import readline from "node:readline";

// Discovery probe: answer `--version` like the real harness and exit.
if (process.argv.includes("--version")) {
  process.stdout.write("zcode 0.16.5\n");
  process.exit(0);
}

const env = (k, d) => process.env[k] ?? d;
let seq = 0;
let serverReqCounter = 0;
const sessions = new Map();
let workspaceRevision = 3;
const wsDefaults = { mode: "build", model: { providerId: "fake", modelId: "FAKE-Main" }, thoughtLevel: "max" };

const MODELS = [
  { ref: { providerId: "fake", modelId: "FAKE-Main" }, label: "FAKE-Main", contextWindow: 200000, maxOutputTokens: 64000, reasoning: { enabled: true, levels: [{ value: "low" }, { value: "max" }], defaultLevel: "max" } },
  { ref: { providerId: "fake", modelId: "FAKE-Lite" }, label: "FAKE-Lite", contextWindow: 200000, maxOutputTokens: 64000, reasoning: { enabled: true, levels: [{ value: "enabled" }, { value: "disabled" }], defaultLevel: "enabled" } },
];

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function notify(method, params) {
  write({ method, params });
}

function serverRequest(method, params, respond) {
  const id = `server-${++serverReqCounter}`;
  pendingServer.set(id, respond);
  write({ id, method, params });
}

const pendingServer = new Map();

function emit(sessionId, type, payload) {
  seq += 1;
  notify("session/event", { sessionId, seq, type, payload });
}

function workspaceState(workspacePath) {
  return {
    revision: workspaceRevision,
    modelCatalog: { available: MODELS, providers: [{ providerId: "fake", source: "builtin", models: MODELS.map((m) => ({ ...m, modelId: m.ref.modelId })) }] },
    settings: {
      mode: { current: wsDefaults.mode },
      model: { available: MODELS, current: { ...wsDefaults.model } },
      thoughtLevel: { current: wsDefaults.thoughtLevel },
    },
    workspace: { workspaceKey: workspacePath, workspacePath },
  };
}

function sessionRecord(sessionId, workspacePath, mode) {
  return {
    sessionId,
    mode: mode ?? "build",
    status: "idle",
    workspace: { workspaceKey: workspacePath, workspacePath },
    model: { providerId: "fake", modelId: "FAKE-Main" },
    createdAt: Date.now(),
    title: "",
  };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    write({ error: { code: -32700, message: "Parse error" }, id: "parse-error" });
    return;
  }

  // Response from the client to one of our reverse requests.
  if (msg.id !== undefined && msg.method === undefined) {
    const respond = pendingServer.get(String(msg.id));
    if (respond) {
      pendingServer.delete(String(msg.id));
      respond(msg);
    }
    return;
  }

  // Reverse requests need no params validation in the fixture.
  if (msg.id === undefined) return; // notification: ignore

  const { id, method, params = {} } = msg;
  switch (method) {
    case "workspace/readState": {
      const wp = params.workspace?.workspacePath ?? "C:\\fake";
      write({ id, result: workspaceState(wp) });
      return;
    }
    case "workspace/setDefaultModel": {
      const model = params.model ?? {};
      const known = MODELS.some((m) => m.ref.providerId === model.providerId && m.ref.modelId === model.modelId);
      if (!known) {
        write({ id, error: { code: -32603, message: `Unsupported model: ${model.providerId}/${model.modelId}. Available models: main, fake/FAKE-Main, lite, fake/FAKE-Lite.` } });
        return;
      }
      wsDefaults.model = { providerId: model.providerId, modelId: model.modelId };
      workspaceRevision += 1;
      write({ id, result: workspaceState(params.workspace?.workspacePath ?? "C:\\fake") });
      return;
    }
    case "workspace/setDefaultMode": {
      wsDefaults.mode = params.mode;
      workspaceRevision += 1;
      write({ id, result: workspaceState(params.workspace?.workspacePath ?? "C:\\fake") });
      return;
    }
    case "workspace/setDefaultThoughtLevel": {
      wsDefaults.thoughtLevel = params.thoughtLevel;
      workspaceRevision += 1;
      write({ id, result: workspaceState(params.workspace?.workspacePath ?? "C:\\fake") });
      return;
    }
    case "session/list": {
      write({ id, result: { sessions: [...sessions.values()].map((s) => s.record) } });
      return;
    }
    case "session/create": {
      const slow = Number(env("FAKE_SLOW_CREATE_MS", "0"));
      if (slow > 0) await new Promise((r) => setTimeout(r, slow));
      const wsPath = params.workspace?.workspacePath ?? "C:\\fake";
      const sessionId = `sess_fake-${Math.random().toString(36).slice(2, 10)}`;
      const mode = params.mode ?? "build";
      sessions.set(sessionId, { record: sessionRecord(sessionId, wsPath, mode), events: [], stopped: false });
      // Reverse call that blocks create until answered (as the real harness does).
      serverRequest("session/requestRuntimePreferences", { sessionId, scope: "runtime-materialization" }, (resp) => {
        if (resp.error) {
          write({ id, error: resp.error });
          sessions.delete(sessionId);
          return;
        }
        const prefs = resp.result ?? {};
        if (typeof prefs.nativeSearchEnhancementsEnabled !== "boolean") {
          write({ id, error: { code: -32603, message: "invalid runtime preferences (nativeSearchEnhancementsEnabled boolean required)" } });
          return;
        }
        write({
          id,
          result: {
            protocol: { name: "ZCode Protocol", version: 1 },
            session: sessionRecord(sessionId, wsPath, mode),
            projection: { sessionId, status: "idle", activeToolCalls: [], backgroundJobs: [], pendingPermissions: [], contextWindow: 200000, contextUsed: 0, totalTokenCount: 0, turnCount: 0, mode },
            settings: { mode: { current: mode }, model: { available: MODELS, current: { providerId: "fake", modelId: "FAKE-Main" } } },
            runtime: { eventSeq: 0, stateRevision: 0 },
            messages: [],
          },
        });
      });
      return;
    }
    case "session/subscribe": {
      if (!sessions.has(params.sessionId)) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      if (params.deliveryKind !== "desktop-continuous") {
        write({ id, error: { code: -32602, message: "deliveryKind required" } });
        return;
      }
      write({ id, result: { sessionId: params.sessionId, eventSeq: seq, events: [] } });
      return;
    }
    case "session/setModel": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      const m = params.model ?? {};
      const known = MODELS.some((x) => x.ref.providerId === m.providerId && x.ref.modelId === m.modelId);
      if (!known) {
        write({ id, error: { code: -32603, message: `Unsupported model: ${m.providerId}/${m.modelId}. Available models: main, fake/FAKE-Main, lite, fake/FAKE-Lite.` } });
        return;
      }
      s.record.model = { providerId: m.providerId, modelId: m.modelId };
      seq += 1;
      notify("session/event", { sessionId: params.sessionId, seq, type: "session.updated", payload: { model: `${m.providerId}/${m.modelId}` } });
      write({ id, result: { projection: { sessionId: params.sessionId, status: "idle" }, settings: { model: { current: m } } } });
      return;
    }
    case "session/setMode": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      s.record.mode = params.mode;
      write({ id, result: { projection: { sessionId: params.sessionId, status: "idle", mode: params.mode }, settings: { mode: { current: params.mode } } } });
      return;
    }
    case "session/setThoughtLevel": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      if (!["low", "max", "enabled", "disabled"].includes(params.thoughtLevel)) {
        write({ id, error: { code: -32603, message: "Unsupported reasoning effort: " + params.thoughtLevel } });
        return;
      }
      write({ id, result: { projection: { sessionId: params.sessionId, status: "idle" } } });
      return;
    }
    case "session/send": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      if (typeof params.content !== "string" || params.content.length === 0) {
        write({ id, error: { code: -32602, message: "Invalid params — content: expected string" } });
        return;
      }
      write({ id, result: { accepted: true, sessionId: params.sessionId, stateRevision: (s.stateRevision = (s.stateRevision ?? 0) + 1) } });
      void runTurn(s, params.sessionId, params.content, params.toolDenylist);
      return;
    }
    case "session/stop": {
      const s = sessions.get(params.sessionId);
      if (s) s.stopped = true;
      write({ id, result: {} });
      return;
    }
    case "session/read": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      write({
        id,
        result: {
          projection: {
            sessionId: params.sessionId,
            status: s.stopped ? "idle" : s.status ?? "idle",
            activeToolCalls: [],
            backgroundJobs: [],
            pendingPermissions: [],
            contextWindow: 200000,
            contextUsed: s.tokens ?? 0,
            totalTokenCount: s.tokens ?? 0,
            turnCount: s.turnCount ?? 0,
            mode: s.record.mode,
          },
          settings: { mode: { current: s.record.mode }, model: { available: MODELS, current: s.record.model } },
          todos: [],
        },
      });
      return;
    }
    case "session/messages": {
      const s = sessions.get(params.sessionId);
      write({ id, result: { messages: s?.transcript ?? [] } });
      return;
    }
    case "session/usage": {
      const s = sessions.get(params.sessionId);
      write({ id, result: { sessionId: params.sessionId, totalTokens: s?.tokens ?? 0, inputTokens: s?.inputTokens ?? 0, outputTokens: s?.outputTokens ?? 0, reasoningTokens: 0, cacheCreationTokens: 0 } });
      return;
    }
    case "session/goal": {
      write({ id, result: { goal: params.action === "show" ? "fake goal" : null } });
      return;
    }
    case "session/compact": {
      write({ id, result: { response: "compact ok", snapshot: {} } });
      return;
    }
    case "session/close": {
      sessions.delete(params.sessionId);
      write({ id, result: { closed: true } });
      return;
    }
    case "session/fork": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      const newId = `sess_fake-${Math.random().toString(36).slice(2, 10)}`;
      sessions.set(newId, { record: { ...s.record, sessionId: newId }, events: [] });
      write({ id, result: { sessionId: newId } });
      return;
    }
    case "session/resume": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      write({ id, result: { sessionId: params.sessionId, status: "idle" } });
      return;
    }
    case "usage/stats": {
      if (!["all", "7d", "30d"].includes(params.range)) {
        write({ id, error: { code: -32602, message: 'Invalid params — range: expected one of "all"|"7d"|"30d"' } });
        return;
      }
      write({ id, result: { range: params.range, generatedAt: Date.now(), timeZone: "UTC", source: "fixture", summary: { totalTokens: 1234, inputTokens: 1000, outputTokens: 234 } } });
      return;
    }
    case "mcp/list": {
      write({ id, result: { servers: [{ key: "fixture-server", state: "running", transport: "stdio" }] } });
      return;
    }
    case "plugins/list": {
      write({ id, result: { plugins: [{ id: "fixture-plugin", enabled: true }] } });
      return;
    }
    case "skills/referenceCatalog": {
      write({ id, result: { skills: [{ name: "fixture-skill", description: "fixture" }] } });
      return;
    }
    default:
      write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});

async function runTurn(s, sessionId, content, toolDenylist) {
  const turnNo = (s.turnCount = (s.turnCount ?? 0) + 1);
  s.status = "running";
  seq += 1;
  notify("session/event", { sessionId, seq, type: "turn.started", payload: { turnNumber: turnNo, input: content } });

  if (env("FAKE_PERMISSION", "0") === "1") {
    await new Promise((resolve) => {
      serverRequest(
        "interaction/requestPermission",
        {
          sessionId,
          toolName: "Bash",
          toolInput: { command: "echo hi" },
          reason: "fixture permission",
          options: [
            { optionId: "allow_once", label: "Allow once", kind: "allow_once" },
            { optionId: "deny_once", label: "Deny once", kind: "deny" },
          ],
        },
        (resp) => {
          seq += 1;
          notify("session/event", { sessionId, seq, type: "session.updated", payload: { permissionAnswered: !resp.error } });
          resolve();
        }
      );
    });
  }
  if (env("FAKE_USERINPUT", "0") === "1") {
    await new Promise((resolve) => {
      serverRequest(
        "interaction/requestUserInput",
        {
          sessionId,
          questions: [{ question: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] }],
        },
        (resp) => resolve()
      );
    });
  }

  // Stream a scripted answer.
  const mode = env("FAKE_TURN", "ok");
  seq += 1;
  notify("session/event", { sessionId, seq, type: "model.streaming", payload: { kind: "text_delta", text: "FA" } });
  seq += 1;
  notify("session/event", { sessionId, seq, type: "model.streaming", payload: { kind: "text_delta", text: "KE-OK" } });
  seq += 1;
  notify("session/event", { sessionId, seq, type: "tool.updated", payload: { toolCallId: "tc1", toolName: "Write", state: "completed", input: { file_path: "fixture-output.txt" } } });
  s.tokens = (s.tokens ?? 0) + 42;
  s.inputTokens = (s.inputTokens ?? 0) + 30;
  s.outputTokens = (s.outputTokens ?? 0) + 12;
  s.transcript = [
    { info: { role: "user", sessionId }, parts: [{ type: "text", text: content }] },
    { info: { role: "assistant", sessionId }, parts: [{ type: "text", text: "FAKE-OK" }] },
  ];

  await new Promise((r) => setTimeout(r, 50));
  if (s.stopped) {
    s.status = "idle";
    seq += 1;
    notify("session/event", { sessionId, seq, type: "turn.completed", payload: { turnNumber: turnNo, stopped: true } });
    return;
  }
  if (mode === "fail") {
    s.status = "idle";
    seq += 1;
    notify("session/event", { sessionId, seq, type: "turn.failed", payload: { error: { type: "unknown_error", message: "fixture failure: provider 400" } } });
    return;
  }
  s.status = "idle";
  seq += 1;
  notify("session/event", { sessionId, seq, type: "turn.completed", payload: { turnNumber: turnNo } });
}
