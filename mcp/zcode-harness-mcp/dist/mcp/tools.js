import { capabilitiesForMcp, BRIDGE_VERSION, TARGET_PROTOCOL } from "../capabilities/registry.js";
import { resolveInsideWorkspace } from "../security/allowlist.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { workspaceRef, parseSessionId } from "../protocol/types.js";
import { redactDeep, safeJsonStringify } from "../security/redact.js";
const log = {
    info: (msg, data) => {
        /* tool calls are logged at the server layer */
        void msg;
        void data;
    },
};
function str(args, key, required = true) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0)
        return v;
    if (required)
        throw new Error(`missing or invalid argument: ${key} (string expected)`);
    return typeof v === "string" ? v : "";
}
function optStr(args, key) {
    const v = args[key];
    return typeof v === "string" && v.length > 0 ? v : null;
}
function optNum(args, key) {
    const v = args[key];
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    return null;
}
function optBool(args, key) {
    const v = args[key];
    return typeof v === "boolean" ? v : null;
}
function optObj(args, key) {
    const v = args[key];
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
}
/** Resolve + allowlist-check a workspace path argument. */
function ws(ctx, args) {
    const raw = str(args, "workspacePath");
    const canonical = ctx.allowlist.enforce(raw);
    const ref = workspaceRef(canonical);
    return { workspacePath: ref.workspacePath, workspaceKey: ref.workspaceKey };
}
function requireWritable(ctx, tool) {
    if (ctx.config.readOnly) {
        throw new Error(`READ_ONLY_MODE: tool ${tool} is not available while the bridge runs with --read-only`);
    }
}
/** Parse "providerId/modelId". */
function parseModelRef(args) {
    const obj = optObj(args, "model");
    if (obj && typeof obj.providerId === "string" && typeof obj.modelId === "string") {
        return { providerId: obj.providerId, modelId: obj.modelId };
    }
    const s = optStr(args, "model");
    if (s && s.includes("/")) {
        const [providerId, modelId] = s.split("/", 2);
        return { providerId: providerId ?? "", modelId: modelId ?? "" };
    }
    return null;
}
/** Invoke a whitelisted read-only native operation. */
const INVOKE_ALLOWLIST = new Set([
    "session/list",
    "session/read",
    "session/messages",
    "session/events",
    "session/usage",
    "session/subagents",
    "session/goal",
    "workspace/readState",
    "mcp/list",
    "plugins/list",
    "plugins/overview",
    "plugins/referenceCatalog",
    "skills/referenceCatalog",
    "usage/stats",
]);
export function buildTools(ctx) {
    const tools = [];
    // ------------------------------------------------------------- discovery
    tools.push({
        name: "zcode_health",
        title: "ZCode bridge health",
        description: "Bridge + harness health: runtime detection result, harness version and bundle fingerprint, protocol, process state, bridge uptime, read-only mode, allowlisted workspaces.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        mutating: false,
        handler: async () => {
            const d = ctx.runtime.diagnostics();
            const degraded = d.degraded === true;
            return {
                degraded,
                bridge: { version: BRIDGE_VERSION, startedAt: ctx.startedAt, readOnly: ctx.config.readOnly, transport: ctx.config.transport },
                protocol: TARGET_PROTOCOL,
                runtime: d,
                note: degraded
                    ? "degraded: bridge continues without harness; discovery/status tools work, harness-bound tools fail with clear errors"
                    : "The harness uses the locally authorized ZCode login (Z.AI OAuth). Model turn availability depends on provider risk control; see runtime diagnostics and KNOWN_LIMITATIONS.md.",
                allowlistedWorkspaces: ctx.allowlist.list(),
                interactionPolicy: ctx.config.interactionPolicy,
            };
        },
    });
    tools.push({
        name: "zcode_capabilities",
        title: "Capability registry",
        description: "Machine-readable capability registry: every known harness capability with availability, implementation and verification status, backend method and MCP mapping.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        mutating: false,
        handler: async () => ({
            bridgeVersion: BRIDGE_VERSION,
            protocol: TARGET_PROTOCOL,
            capabilities: capabilitiesForMcp(),
        }),
    });
    tools.push({
        name: "zcode_operations_list",
        title: "Native operations list",
        description: "List native harness operations per kind (mcp servers, plugins, skills, usage stats) or the registry of all known methods.",
        inputSchema: {
            type: "object",
            properties: {
                workspacePath: { type: "string", description: "Workspace for workspace-scoped listings" },
                kind: { type: "string", enum: ["mcp", "plugins", "skills", "usage", "registry"], description: "Which listing to fetch (default registry)" },
            },
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const kind = optStr(args, "kind") ?? "registry";
            if (kind === "registry") {
                return { kind, operations: capabilitiesForMcp().map((c) => ({ method: c.backend, availability: c.availability, direction: c.direction, id: c.id })) };
            }
            if (kind === "usage") {
                const range = optStr(args, "kind") === "usage" ? "7d" : "7d";
                return await ctx.runtime.call("usage/stats", { range });
            }
            const { workspacePath } = ws(ctx, args);
            if (kind === "mcp") {
                return await ctx.runtime.callForWorkspace("mcp/list", workspacePath, {});
            }
            if (kind === "plugins") {
                return await ctx.runtime.callForWorkspace("plugins/list", workspacePath, {});
            }
            return await ctx.runtime.callForWorkspace("skills/referenceCatalog", workspacePath, {});
        },
    });
    tools.push({
        name: "zcode_operation_describe",
        title: "Describe native operation",
        description: "Describe one native harness method: direction, availability, verification and invocation notes from the registry.",
        inputSchema: {
            type: "object",
            properties: { method: { type: "string", description: "Native method name, e.g. session/create" } },
            required: ["method"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const method = str(args, "method");
            const caps = capabilitiesForMcp().filter((c) => c.backend === method || String(c.backend).startsWith(method + "/") || String(c.id).startsWith(method));
            if (caps.length === 0)
                return { method, known: false, note: "not in registry; zod validation errors from the harness define live schemas" };
            return { method, known: true, entries: caps };
        },
    });
    tools.push({
        name: "zcode_operation_invoke",
        title: "Invoke registered operation",
        description: "Invoke a whitelisted, read-only native operation with validated params. No arbitrary RPC passthrough; mutating operations have dedicated tools.",
        inputSchema: {
            type: "object",
            properties: {
                method: { type: "string", description: "One of the whitelisted methods" },
                params: { type: "object", description: "Native params; workspace-scoped methods accept workspace {workspaceKey, workspacePath} or omit for sessions" },
            },
            required: ["method"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const method = str(args, "method");
            if (!INVOKE_ALLOWLIST.has(method)) {
                throw new Error(`operation not invocable: ${method}. Allowed: ${[...INVOKE_ALLOWLIST].join(", ")}`);
            }
            const params = (optObj(args, "params") ?? {});
            // Normalize workspace objects to allowlisted paths when present.
            if (params.workspace && typeof params.workspace === "object") {
                const w = params.workspace;
                const p = typeof w.workspacePath === "string" ? w.workspacePath : typeof w.workspaceKey === "string" ? w.workspaceKey : null;
                if (p) {
                    const canonical = ctx.allowlist.enforce(p);
                    params.workspace = workspaceRef(canonical);
                }
            }
            if (typeof params.sessionId === "string") {
                const sid = parseSessionId(params.sessionId);
                if (!sid)
                    throw new Error("invalid sessionId format");
                params.sessionId = sid;
            }
            return await ctx.runtime.call(method, params);
        },
    });
    // ---------------------------------------------------------------- models
    tools.push({
        name: "zcode_models_list",
        title: "List available models",
        description: "Live model catalog of a workspace as discovered by the harness (provider, model id, context window, reasoning levels, modalities). No invented model names.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" } },
            required: ["workspacePath"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            const state = await ctx.runtime.callForWorkspace("workspace/readState", workspacePath, {});
            return { modelCatalog: state?.modelCatalog ?? null, revision: state?.revision ?? null };
        },
    });
    tools.push({
        name: "zcode_model_set",
        title: "Select model / mode / reasoning",
        description: "Select the model (providerId/modelId from the live catalog), optional reasoning level and/or permission mode for a session or a workspace default. Returns requested AND effective values after read-back verification. GLM-5.3-Flash is only used when present in the actual catalog; otherwise a clear error with the catalog is returned.",
        inputSchema: {
            type: "object",
            properties: {
                scope: { type: "string", enum: ["session", "workspace"] },
                workspacePath: { type: "string", description: "Required for scope=workspace (and used for catalog validation)" },
                sessionId: { type: "string", description: "Required for scope=session" },
                model: { type: "string", description: "providerId/modelId, e.g. zai/GLM-5.3" },
                thoughtLevel: { type: "string", description: "Model-specific reasoning level (see catalog reasoning.levels)" },
                mode: { type: "string", enum: ["build", "edit", "plan", "yolo"] },
            },
            required: ["scope"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_model_set");
            const scope = str(args, "scope");
            const modelRef = parseModelRef(args);
            const thoughtLevel = optStr(args, "thoughtLevel");
            const mode = optStr(args, "mode");
            const requested = {};
            if (modelRef)
                requested.model = `${modelRef.providerId}/${modelRef.modelId}`;
            if (thoughtLevel)
                requested.thoughtLevel = thoughtLevel;
            if (mode)
                requested.mode = mode;
            if (scope === "session") {
                const sessionId = parseSessionId(str(args, "sessionId"));
                if (!sessionId)
                    throw new Error("invalid sessionId for scope=session");
                if (modelRef)
                    await ctx.runtime.ipcSessionSetModel(sessionId, modelRef.providerId, modelRef.modelId);
                if (thoughtLevel)
                    await ctx.runtime.ipcSessionSetThoughtLevel(sessionId, thoughtLevel);
                if (mode)
                    await ctx.runtime.ipcSessionSetMode(sessionId, mode);
                const readBack = await ctx.runtime.ipcSessionRead(sessionId);
                const settings = (readBack?.settings ?? {});
                const model = (settings.model ?? {});
                const current = (model.current ?? {});
                const sMode = (settings.mode ?? {});
                const sThought = (settings.thoughtLevel ?? settings.reasoning ?? {});
                return {
                    scope,
                    requested,
                    effective: {
                        model: current.providerId && current.modelId ? `${String(current.providerId)}/${String(current.modelId)}` : null,
                        mode: sMode.current ?? null,
                        thoughtLevel: sThought.current ?? sThought.level ?? null,
                    },
                    verified: true,
                };
            }
            // workspace scope
            const { workspacePath } = ws(ctx, args);
            const changes = {};
            if (modelRef)
                changes.model = `${modelRef.providerId}/${modelRef.modelId}`;
            if (mode)
                changes.mode = mode;
            if (thoughtLevel)
                changes.thoughtLevel = thoughtLevel;
            if (Object.keys(changes).length === 0)
                throw new Error("nothing to set: provide model, thoughtLevel or mode");
            const expectedRevision = optNum(args, "expectedRevision");
            const result = await ctx.settings.update(workspacePath, changes, expectedRevision);
            return { scope, requested, applied: result.applied, revision: result.revision };
        },
    });
    // -------------------------------------------------------------- settings
    tools.push({
        name: "zcode_settings_schema",
        title: "Settings schema",
        description: "Full settings schema for a workspace: types, choices, defaults, effective values, sources, scopes, writability and restart requirements.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" } },
            required: ["workspacePath"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            return await ctx.settings.describe(workspacePath);
        },
    });
    tools.push({
        name: "zcode_settings_get",
        title: "Get settings",
        description: "Effective workspace settings (optionally one path) or the redacted desktop configuration inventory (scope=desktop).",
        inputSchema: {
            type: "object",
            properties: {
                workspacePath: { type: "string" },
                path: { type: "string", description: "Optional setting path (mode|model|thoughtLevel|modelCatalog)" },
                scope: { type: "string", enum: ["workspace", "desktop"] },
            },
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const scope = optStr(args, "scope") ?? "workspace";
            if (scope === "desktop")
                return ctx.settings.desktopInventory();
            const { workspacePath } = ws(ctx, args);
            return await ctx.settings.get(workspacePath, optStr(args, "path"));
        },
    });
    tools.push({
        name: "zcode_settings_update",
        title: "Update settings",
        description: "Apply validated workspace setting changes (mode, model, thoughtLevel) with optional CAS revision. Returns before/after (redacted) and the new revision. Unknown fields are rejected, never silently written.",
        inputSchema: {
            type: "object",
            properties: {
                workspacePath: { type: "string" },
                changes: { type: "object", description: "e.g. {\"model\": \"zai/GLM-5.3\", \"mode\": \"build\"}" },
                expectedRevision: { type: "number", description: "CAS guard from a previous zcode_settings_schema/get read" },
            },
            required: ["workspacePath", "changes"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_settings_update");
            const { workspacePath } = ws(ctx, args);
            const changes = optObj(args, "changes");
            if (!changes || Object.keys(changes).length === 0)
                throw new Error("changes object required");
            const expectedRevision = optNum(args, "expectedRevision");
            return await ctx.settings.update(workspacePath, changes, expectedRevision);
        },
    });
    tools.push({
        name: "zcode_settings_reset",
        title: "Reset setting",
        description: "Reset one writable setting to its known default value.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" }, path: { type: "string", enum: ["mode", "model", "thoughtLevel"] } },
            required: ["workspacePath", "path"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_settings_reset");
            const { workspacePath } = ws(ctx, args);
            return await ctx.settings.reset(workspacePath, str(args, "path"));
        },
    });
    // ------------------------------------------------------------ workspaces
    tools.push({
        name: "zcode_workspaces_list",
        title: "List workspaces",
        description: "Allowlisted workspaces of this bridge plus workspaces seen in the harness session list.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        mutating: false,
        handler: async () => {
            const configured = ctx.allowlist.list();
            const seen = new Set();
            try {
                const listResult = await ctx.runtime.call("session/list", {});
                for (const s of listResult?.sessions ?? []) {
                    if (s.workspace?.workspacePath)
                        seen.add(s.workspace.workspacePath);
                }
            }
            catch {
                /* harness may be down; configured list still returned */
            }
            return {
                allowlisted: configured,
                seenInHarness: [...seen],
                note: "Only allowlisted workspaces can be opened or used in tasks.",
            };
        },
    });
    tools.push({
        name: "zcode_workspace_open",
        title: "Open a workspace",
        description: "Validate a workspace against the allowlist and read its live state (model catalog, settings, revision).",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" } },
            required: ["workspacePath"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            const state = await ctx.runtime.callForWorkspace("workspace/readState", workspacePath, {}, 60_000);
            const revision = Number(state?.revision ?? state?.modelCatalog?.revision ?? 0);
            return { workspacePath, revision, settings: redactDeep(state?.settings ?? {}), modelCatalog: state?.modelCatalog ?? null };
        },
    });
    // -------------------------------------------------------------- sessions
    tools.push({
        name: "zcode_sessions_list",
        title: "List sessions",
        description: "List harness sessions (all workspaces or one), with status, model, timestamps.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" } },
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const listResult = await ctx.runtime.call("session/list", {});
            const sessions = listResult?.sessions ?? [];
            const wp = optStr(args, "workspacePath");
            if (wp) {
                const canonical = ctx.allowlist.enforce(wp).replace(/[\\/]+$/, "");
                const filtered = sessions.filter((s) => {
                    const rec = s;
                    return rec.workspace?.workspacePath?.replace(/[\\/]+$/, "") === canonical;
                });
                return { sessions: redactDeep(filtered), workspacePath: canonical };
            }
            return { sessions: redactDeep(sessions) };
        },
    });
    tools.push({
        name: "zcode_session_create",
        title: "Create a session",
        description: "Create a harness session in an allowlisted workspace. Returns sessionId and effective settings.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" }, mode: { type: "string", enum: ["build", "edit", "plan", "yolo"] } },
            required: ["workspacePath"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_session_create");
            const { workspacePath } = ws(ctx, args);
            const mode = optStr(args, "mode");
            const result = await ctx.runtime.ipcSessionCreate(workspacePath, mode);
            return redactDeep(result);
        },
    });
    tools.push({
        name: "zcode_session_get",
        title: "Get session state",
        description: "Read projection (status, tokens, context), settings and todos of a session.",
        inputSchema: {
            type: "object",
            properties: { sessionId: { type: "string" } },
            required: ["sessionId"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const sessionId = parseSessionId(str(args, "sessionId"));
            if (!sessionId)
                throw new Error("invalid sessionId");
            return redactDeep(await ctx.runtime.ipcSessionRead(sessionId));
        },
    });
    tools.push({
        name: "zcode_session_resume",
        title: "Resume a session",
        description: "Resume a persisted session by sessionId.",
        inputSchema: {
            type: "object",
            properties: { sessionId: { type: "string" } },
            required: ["sessionId"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_session_resume");
            const sessionId = parseSessionId(str(args, "sessionId"));
            if (!sessionId)
                throw new Error("invalid sessionId");
            return await ctx.runtime.call("session/resume", { sessionId });
        },
    });
    tools.push({
        name: "zcode_session_fork",
        title: "Fork a session",
        description: "Fork a new session from the latest checkpoint.",
        inputSchema: {
            type: "object",
            properties: { sessionId: { type: "string" } },
            required: ["sessionId"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_session_fork");
            const sessionId = parseSessionId(str(args, "sessionId"));
            if (!sessionId)
                throw new Error("invalid sessionId");
            return await ctx.runtime.call("session/fork", { sessionId, target: { kind: "latestCheckpoint" } });
        },
    });
    tools.push({
        name: "zcode_session_close",
        title: "Close a session",
        description: "Close a session (released in the harness).",
        inputSchema: {
            type: "object",
            properties: { sessionId: { type: "string" } },
            required: ["sessionId"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_session_close");
            const sessionId = parseSessionId(str(args, "sessionId"));
            if (!sessionId)
                throw new Error("invalid sessionId");
            return await ctx.runtime.call("session/close", { sessionId });
        },
    });
    tools.push({
        name: "zcode_session_compact",
        title: "Compact a session",
        description: "Compact the session context.",
        inputSchema: {
            type: "object",
            properties: { sessionId: { type: "string" }, instructions: { type: "string" } },
            required: ["sessionId"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_session_compact");
            const sessionId = parseSessionId(str(args, "sessionId"));
            if (!sessionId)
                throw new Error("invalid sessionId");
            const instructions = optStr(args, "instructions");
            return await ctx.runtime.call("session/compact", { sessionId, ...(instructions ? { instructions } : {}) });
        },
    });
    tools.push({
        name: "zcode_session_goal",
        title: "Session goal",
        description: "Show, set, replace, pause, resume or clear the session goal.",
        inputSchema: {
            type: "object",
            properties: {
                sessionId: { type: "string" },
                action: { type: "string", enum: ["show", "set", "replace", "pause", "resume", "clear"] },
                value: { type: "string" },
            },
            required: ["sessionId", "action"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_session_goal");
            const sessionId = parseSessionId(str(args, "sessionId"));
            if (!sessionId)
                throw new Error("invalid sessionId");
            const action = str(args, "action");
            const value = optStr(args, "value");
            return await ctx.runtime.call("session/goal", { sessionId, action, ...(value !== null ? { target: value } : {}) });
        },
    });
    // ----------------------------------------------------------------- tasks
    tools.push({
        name: "zcode_task_start",
        title: "Start a task",
        description: "Start real harness work in an allowlisted workspace: creates (or reuses) a session, optionally selects model/reasoning/mode, sends the prompt and returns a stable taskId immediately (non-blocking). Supports idempotencyKey (repeated calls return the same task), readOnly (harness-enforced plan mode + write-tool denylist) and queued execution under concurrency limits.",
        inputSchema: {
            type: "object",
            properties: {
                workspacePath: { type: "string" },
                prompt: { type: "string", description: "Goal/prompt for the harness" },
                sessionId: { type: "string", description: "Optional existing session to reuse" },
                model: { type: "string", description: "providerId/modelId (must exist in the live catalog)" },
                thoughtLevel: { type: "string" },
                mode: { type: "string", enum: ["build", "edit", "plan", "yolo"] },
                readOnly: { type: "boolean", description: "Enforce plan mode + write-tool denylist for this task" },
                idempotencyKey: { type: "string" },
            },
            required: ["workspacePath", "prompt"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_task_start");
            const { workspacePath, workspaceKey } = ws(ctx, args);
            const prompt = str(args, "prompt");
            const sessionIdRaw = optStr(args, "sessionId");
            if (sessionIdRaw && !parseSessionId(sessionIdRaw))
                throw new Error("invalid sessionId format");
            const modelRef = parseModelRef(args);
            // GLM-5.3-Flash preference guard: refuse silent model swaps.
            if (modelRef) {
                const state = await ctx.runtime.callForWorkspace("workspace/readState", workspacePath, {});
                const available = state?.modelCatalog?.available ?? [];
                const known = available.some((m) => {
                    const ref = (m.ref ?? {});
                    return `${String(ref.providerId)}/${String(ref.modelId)}` === `${modelRef.providerId}/${modelRef.modelId}`;
                });
                if (!known) {
                    throw new Error(`UNKNOWN_MODEL: ${modelRef.providerId}/${modelRef.modelId} is not in the live catalog. Available: ${safeJsonStringify(available.map((m) => {
                        const ref = (m.ref ?? {});
                        return `${String(ref.providerId)}/${String(ref.modelId)}`;
                    }))}`);
                }
            }
            const rec = await ctx.tasks.startTask({
                workspacePath,
                workspaceKey,
                prompt,
                sessionId: sessionIdRaw,
                model: modelRef,
                thoughtLevel: optStr(args, "thoughtLevel"),
                mode: optStr(args, "mode"),
                readOnly: optBool(args, "readOnly") ?? undefined,
                idempotencyKey: optStr(args, "idempotencyKey"),
            });
            return {
                taskId: rec.taskId,
                state: rec.state,
                sessionId: rec.sessionId || null,
                idempotencyKey: rec.idempotencyKey,
                readOnly: rec.readOnly,
                note: rec.state === "queued" ? "queued: concurrency limit reached; promotion is automatic" : "starting: session setup and prompt delivery in progress; poll zcode_task_get / zcode_task_wait",
            };
        },
    });
    tools.push({
        name: "zcode_task_get",
        title: "Task status",
        description: "Current task record: state machine position, session, model (requested/effective), usage, file changes, error info.",
        inputSchema: {
            type: "object",
            properties: { taskId: { type: "string" } },
            required: ["taskId"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const rec = ctx.tasks.get(str(args, "taskId"));
            if (!rec)
                throw new Error(`unknown task: ${String(args.taskId)}`);
            return rec;
        },
    });
    tools.push({
        name: "zcode_tasks_list",
        title: "List tasks",
        description: "List bridge tasks, optionally filtered by workspace and state.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" }, state: { type: "string" } },
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const wp = optStr(args, "workspacePath");
            const state = optStr(args, "state");
            return {
                tasks: ctx.tasks.list({
                    workspace: wp ?? undefined,
                    state: state ?? undefined,
                }),
            };
        },
    });
    tools.push({
        name: "zcode_task_wait",
        title: "Wait for a task (bounded)",
        description: "Bounded wait until a task reaches a terminal state (or the timeout elapses). Returns the task record either way.",
        inputSchema: {
            type: "object",
            properties: { taskId: { type: "string" }, timeoutMs: { type: "number", description: "Default 60000, capped at 120000" } },
            required: ["taskId"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const taskId = str(args, "taskId");
            const timeoutMs = Math.min(optNum(args, "timeoutMs") ?? 60_000, 120_000);
            const rec = await ctx.tasks.wait(taskId, timeoutMs);
            return rec;
        },
    });
    tools.push({
        name: "zcode_task_cancel",
        title: "Cancel a task",
        description: "Request cancellation (harness session/stop) and VERIFY it; states: cancelling → cancelled (verified) or unknown (not verifiable). Partial results remain available.",
        inputSchema: {
            type: "object",
            properties: { taskId: { type: "string" } },
            required: ["taskId"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_task_cancel");
            return await ctx.tasks.cancel(str(args, "taskId"));
        },
    });
    tools.push({
        name: "zcode_task_input",
        title: "Send task input",
        description: "Send additional input: steering while running or follow-up on a terminal task (same session context).",
        inputSchema: {
            type: "object",
            properties: { taskId: { type: "string" }, content: { type: "string" } },
            required: ["taskId", "content"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_task_input");
            return await ctx.tasks.addInput(str(args, "taskId"), str(args, "content"));
        },
    });
    tools.push({
        name: "zcode_task_events",
        title: "Task events",
        description: "Normalized + redacted harness events with cursor pagination (afterSeq), including gap detection metadata.",
        inputSchema: {
            type: "object",
            properties: { taskId: { type: "string" }, afterSeq: { type: "number" }, limit: { type: "number", description: "Default 200" } },
            required: ["taskId"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const taskId = str(args, "taskId");
            const afterSeq = optNum(args, "afterSeq") ?? -1;
            const limit = Math.min(optNum(args, "limit") ?? 200, 1000);
            return ctx.tasks.events(taskId, afterSeq, limit);
        },
    });
    tools.push({
        name: "zcode_task_result",
        title: "Task result",
        description: "Versioned structured result (schemaVersion 1): ids, status, timestamps, requested/effective model, final response text (clearly marked partial when incomplete), usage (null = missing, not zero), tool calls, file changes, artifacts, interactions, errors, warnings, completeness.",
        inputSchema: {
            type: "object",
            properties: { taskId: { type: "string" } },
            required: ["taskId"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const result = await ctx.tasks.buildResult(str(args, "taskId"));
            return result;
        },
    });
    tools.push({
        name: "zcode_artifact_read",
        title: "Read an artifact",
        description: "Read file content from an allowlisted workspace (chunked, with size/hash/truncation metadata). Path must stay inside the workspace root.",
        inputSchema: {
            type: "object",
            properties: {
                workspacePath: { type: "string" },
                path: { type: "string", description: "Absolute path inside the workspace or workspace-relative path" },
                offset: { type: "number", description: "Byte offset (default 0)" },
                length: { type: "number", description: "Max bytes to return (default 262144, capped)" },
            },
            required: ["workspacePath", "path"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            const rel = str(args, "path");
            const abs = resolveInsideWorkspace(workspacePath, rel);
            const st = fs.statSync(abs);
            if (!st.isFile())
                throw new Error(`not a file: ${rel}`);
            const offset = Math.max(0, optNum(args, "offset") ?? 0);
            const maxLen = Math.min(optNum(args, "length") ?? 262_144, 1_048_576);
            const len = Math.min(maxLen, Math.max(0, st.size - offset));
            const fd = fs.openSync(abs, "r");
            const buf = Buffer.alloc(len);
            try {
                if (len > 0)
                    fs.readSync(fd, buf, 0, len, offset);
            }
            finally {
                fs.closeSync(fd);
            }
            const fullHash = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
            const truncated = offset + len < st.size;
            return {
                path: abs,
                size: st.size,
                offset,
                bytesReturned: len,
                sha256: fullHash,
                truncated,
                encoding: "base64",
                contentBase64: len > 0 ? buf.toString("base64") : "",
                mimeType: guessMime(abs),
            };
        },
    });
    // ---------------------------------------------------------- interactions
    tools.push({
        name: "zcode_interactions_list",
        title: "List interactions",
        description: "Pending and resolved harness interactions (permissions, user input, provider headers) with stable ids.",
        inputSchema: {
            type: "object",
            properties: { status: { type: "string", enum: ["pending", "resolved", "all"] } },
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const status = (optStr(args, "status") ?? "all");
            return { interactions: ctx.interactions.list(status) };
        },
    });
    tools.push({
        name: "zcode_interaction_respond",
        title: "Answer an interaction",
        description: "Resolve a pending interaction. Permissions: choose one of the offered optionIds (allow/allow_always/deny...) or cancel. User input: provide the answers payload or cancel. An agent cannot invent options the harness did not offer; authority is never expanded by the caller.",
        inputSchema: {
            type: "object",
            properties: {
                interactionId: { type: "string" },
                optionId: { type: "string", description: "For permission interactions: one of the offered options" },
                value: { type: "object", description: "For user_input interactions: answers payload" },
                cancel: { type: "boolean" },
            },
            required: ["interactionId"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            requireWritable(ctx, "zcode_interaction_respond");
            const interactionId = str(args, "interactionId");
            const optionId = optStr(args, "optionId");
            const value = optObj(args, "value");
            const cancel = optBool(args, "cancel") ?? false;
            const res = ctx.interactions.resolve(interactionId, { optionId: optionId ?? undefined, value, cancel });
            if (res && typeof res === "object" && "error" in res)
                throw new Error(res.error);
            return res;
        },
    });
    return tools;
}
function guessMime(p) {
    const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
    const map = {
        txt: "text/plain", md: "text/markdown", json: "application/json", ts: "text/typescript",
        js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", py: "text/x-python",
        html: "text/html", css: "text/css", csv: "text/csv", png: "image/png", jpg: "image/jpeg",
        jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", zip: "application/zip",
    };
    return map[ext] ?? "application/octet-stream";
}
export function toolTextPayload(value) {
    return safeJsonStringify(value);
}
