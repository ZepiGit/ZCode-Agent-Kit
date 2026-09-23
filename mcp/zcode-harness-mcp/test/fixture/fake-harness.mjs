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
 *   FAKE_FOREIGN_WORKSPACE=...      seed one non-allowlisted session
 *   FAKE_EXIT_ON_SEND=0|1           exit after accepting session/send
 *   FAKE_HANG_AFTER_REQUESTS=N      stop answering after N requests
 *   FAKE_NO_STREAM=0|1              omit model.streaming events
 *   FAKE_RUNTIME_LOG=...            append received method/params as JSONL
 *   FAKE_REQUIRE_REASONING=0|1      require model.options.reasoningLevel in setModel
 *   FAKE_MODEL_MISMATCH=0|1         acknowledge model selection without applying it
 *   FAKE_THOUGHT_MISMATCH=0|1       acknowledge effort selection without applying it
 */
import readline from "node:readline";
import fs from "node:fs";

// Discovery probe: answer `--version` like the real harness and exit.
if (process.argv.includes("--version")) {
  process.stdout.write("zcode 0.16.9\n");
  process.exit(0);
}

const env = (k, d) => process.env[k] ?? d;
let seq = 0;
let serverReqCounter = 0;
let requestCount = 0;
const sessions = new Map();
let dynamicWorkflowEnabled = false;

const MODELS = [
  { ref: { providerId: "zai-api", modelId: "GLM-5.3-Flash" }, label: "GLM-5.3-Flash", contextWindow: 200000, maxOutputTokens: 64000, reasoning: { enabled: true, levels: [{ value: "low" }, { value: "max" }], defaultLevel: "max" } },
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

const foreignWorkspace = env("FAKE_FOREIGN_WORKSPACE", "");
if (foreignWorkspace) {
  const sessionId = "sess_foreign-fixture";
  sessions.set(sessionId, {
    record: sessionRecord(sessionId, foreignWorkspace, "build"),
    events: [],
    stopped: false,
    status: "idle",
    transcript: [
      { info: { role: "assistant", sessionId }, parts: [{ type: "text", text: "FOREIGN-SECRET-TRANSCRIPT" }] },
    ],
  });
}

function logRequest(method, params) {
  const logPath = env("FAKE_RUNTIME_LOG", "");
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify({ method, params }) + "\n", "utf8");
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
  requestCount += 1;
  logRequest(method, params);
  const hangAfter = Number(env("FAKE_HANG_AFTER_REQUESTS", "0"));
  if (hangAfter > 0 && requestCount > hangAfter) return;
  if (["session/setModel", "session/setMode", "session/setThoughtLevel"].includes(method) && params.expectedRevision !== undefined) {
    const s = sessions.get(params.sessionId);
    if (s && params.expectedRevision !== (s.stateRevision ?? 0)) {
      write({ id, error: { code: -32009, message: "Session state revision mismatch" } });
      return;
    }
  }
  switch (method) {
    case "workspace/readPresentation": {
      write({ id, result: { workspace: params.workspace, mode: "build", slashCommands: [{ name: "help", description: "Help" }, ...(dynamicWorkflowEnabled ? [{ name: "workflow", description: "Workflow" }] : [])] } });
      return;
    }
    case "runtime/capabilities": {
      write({ id, result: { independentPlanState: true } });
      return;
    }
    case "workspace/updateInteractionPreferences":
    case "workspace/updateModelIoPreferences":
    case "workspace/updateOffPeakToolPolicy":
    case "workspace/updateDynamicWorkflowPolicy": {
      const field = method.endsWith("InteractionPreferences") ? "askUserQuestionAutoResolutionEnabled" : method.endsWith("ModelIoPreferences") ? "fullRetentionEnabled" : "enabled";
      const nested = field !== "enabled";
      const value = nested ? params.preferences?.[field] : params[field];
      const keys = Object.keys(params);
      if (typeof value !== "boolean" || keys.some(k => !["workspace", nested ? "preferences" : "enabled"].includes(k)) || (nested && Object.keys(params.preferences).some(k => k !== field))) {
        write({ id, error: { code: -32602, message: "Invalid preference params" } });
        return;
      }
      if (method === "workspace/updateDynamicWorkflowPolicy") dynamicWorkflowEnabled = value;
      const extra = field === "askUserQuestionAutoResolutionEnabled" ? { snoozedInteractionCount: 0 } : field === "fullRetentionEnabled" ? { updatedSessionCount: sessions.size } : {};
      write({ id, result: { workspace: params.workspace, [field]: env("FAKE_PREFERENCE_MISMATCH", "0") === "1" ? !value : value, ...extra } });
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
      sessions.set(sessionId, { record: sessionRecord(sessionId, wsPath, mode), persistence: params.persistence ?? "immediate", stateRevision: 0, thoughtLevel: "max", events: [], stopped: false });
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
            settings: { mode: { current: mode }, model: { ...(env("FAKE_MISSING_CATALOG", "0") === "1" && params.persistence === "deferred" ? {} : { available: MODELS }), current: { providerId: "fake", modelId: "FAKE-Main" } } },
            runtime: { eventSeq: 0, stateRevision: 0 },
            messages: [],
          },
        });
      });
      return;
    }
    case "session/subscribe": {
      if (env('FAKE_SUBSCRIBE_FAIL', '0') === '1') { write({ id, error: { code: -32603, message: 'fixture subscribe failure' } }); return; }
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
      const known = MODELS.find((x) => x.ref.providerId === m.providerId && x.ref.modelId === m.modelId);
      if (!known) {
        write({ id, error: { code: -32603, message: `Unsupported model: ${m.providerId}/${m.modelId}. Available models: ${MODELS.map(x => `${x.ref.providerId}/${x.ref.modelId}`).join(", ")}.` } });
        return;
      }
      const reasoningLevel = m.options?.reasoningLevel;
      if (env("FAKE_REQUIRE_REASONING", "0") === "1" && reasoningLevel === undefined) {
        write({ id, error: { code: -32603, message: `Reasoning level is required for ${m.providerId}/${m.modelId}` } });
        return;
      }
      if (reasoningLevel !== undefined && !known.reasoning.levels.some(level => level.value === reasoningLevel)) {
        write({ id, error: { code: -32603, message: "Unsupported reasoning effort: " + reasoningLevel } });
        return;
      }
      if (env("FAKE_MODEL_MISMATCH", "0") !== "1") {
        s.record.model = { providerId: m.providerId, modelId: m.modelId };
        if (env("FAKE_THOUGHT_MISMATCH", "0") !== "1") s.thoughtLevel = reasoningLevel ?? known.reasoning.defaultLevel;
      }
      s.stateRevision = (s.stateRevision ?? 0) + 1;
      seq += 1;
      notify("session/event", { sessionId: params.sessionId, seq, type: "session.updated", payload: { model: `${m.providerId}/${m.modelId}` } });
      write({ id, result: { runtime: { stateRevision: s.stateRevision }, projection: { sessionId: params.sessionId, status: "idle" }, settings: { model: { current: s.record.model } } } });
      return;
    }
    case "session/setMode": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      s.record.mode = params.mode;
      s.stateRevision = (s.stateRevision ?? 0) + 1;
      write({ id, result: { runtime: { stateRevision: s.stateRevision }, projection: { sessionId: params.sessionId, status: "idle", mode: params.mode }, settings: { mode: { current: params.mode } } } });
      return;
    }
    case "session/setThoughtLevel": {
      const s = sessions.get(params.sessionId);
      if (!s) {
        write({ id, error: { code: -32602, message: "Session not found" } });
        return;
      }
      const model = MODELS.find(m => m.ref.providerId === s.record.model.providerId && m.ref.modelId === s.record.model.modelId);
      if (!model?.reasoning.levels.some(level => level.value === params.thoughtLevel)) {
        write({ id, error: { code: -32603, message: "Unsupported reasoning effort: " + params.thoughtLevel } });
        return;
      }
      if (env("FAKE_THOUGHT_MISMATCH", "0") !== "1") s.thoughtLevel = params.thoughtLevel;
      s.stateRevision = (s.stateRevision ?? 0) + 1;
      write({ id, result: { runtime: { stateRevision: s.stateRevision }, projection: { sessionId: params.sessionId, status: "idle" } } });
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
      const acknowledge = () => write({ id, result: { accepted: true, sessionId: params.sessionId, stateRevision: (s.stateRevision = (s.stateRevision ?? 0) + 1) } });
      const ackDelay = Number(env('FAKE_ACK_DELAY_MS', '0'));
      if (ackDelay > 0) setTimeout(acknowledge, ackDelay);
      else acknowledge();
      if (env("FAKE_EXIT_ON_SEND", "0") === "1") {
        setTimeout(() => process.exit(7), 20);
        return;
      }
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
          settings: { mode: { current: s.record.mode }, model: { available: MODELS.filter(m => m.ref.modelId === s.record.model.modelId), current: s.record.model }, thoughtLevel: { current: s.thoughtLevel ?? "max" } },
          runtime: { stateRevision: s.stateRevision ?? 0 },
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
      const s = sessions.get(params.sessionId);
      const closed = !!s && (params.expectedPersistence === undefined || params.expectedPersistence === s.persistence) && env("FAKE_REFUSE_CLOSE", "0") !== "1";
      if (closed) sessions.delete(params.sessionId);
      write({ id, result: { closed } });
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
  notify("session/event", { sessionId, seq, type: "turn.started", payload: { turnNumber: turnNo, input: content, toolDenylist: toolDenylist ?? null, workspacePath: s.record.workspace.workspacePath } });

  if (env("FAKE_PERMISSION", "0") === "1") {
    await new Promise((resolve) => {
      serverRequest(
        "interaction/requestPermission",
        {
          sessionId,
          toolName: env("FAKE_PERMISSION_TOOL", "Bash"),
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
  if (mode === "hang") return;
  if (env("FAKE_NO_STREAM", "0") !== "1") {
    seq += 1;
    notify("session/event", { sessionId, seq, type: "model.streaming", payload: { kind: "text_delta", text: "FA" } });
    seq += 1;
    notify("session/event", { sessionId, seq, type: "model.streaming", payload: { kind: "text_delta", text: "KE-OK" } });
  }
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
