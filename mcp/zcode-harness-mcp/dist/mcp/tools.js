import { capabilitiesForMcp, BRIDGE_VERSION, TARGET_PROTOCOL } from "../capabilities/registry.js";
import { readArtifact } from "../security/artifact.js";
import { validateArguments } from "./validate.js";
import { sessionInScope, sessionWorkspaceOf, workspaceIdentity } from "../security/session.js";
import { workspaceRef } from "../protocol/types.js";
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
/**
 * D-02: the "yolo" permission mode disables the harness's permission
 * prompts and therefore the bridge's interaction policy. Only an operator
 * who started the bridge with --allow-yolo may enable it.
 */
function requireModeAllowed(ctx, mode) {
    if (mode === "yolo" && !ctx.config.allowYolo) {
        throw new Error("MODE_NOT_PERMITTED: mode \"yolo\" bypasses permission prompts and is not permitted; start the bridge with --allow-yolo to enable it deliberately");
    }
}
function normPath(p) {
    return p.replace(/[\\/]+$/, "");
}
/** Parse "providerId/modelId". */
function parseModelRef(args) {
    const obj = optObj(args, "model");
    if (obj && typeof obj.providerId === "string" && typeof obj.modelId === "string") {
        return { providerId: obj.providerId, modelId: obj.modelId };
    }
    const s = optStr(args, "model");
    if (s && s.includes("/")) {
        const slash = s.indexOf("/");
        if (slash === 0 || slash === s.length - 1)
            throw new Error("model must contain a nonempty providerId and modelId");
        return { providerId: s.slice(0, slash), modelId: s.slice(slash + 1) };
    }
    if (args.model !== undefined)
        throw new Error("model must be providerId/modelId");
    return null;
}
/** Invoke a whitelisted read-only native operation. */
// Audit H5: session/goal was removed — its action enum includes mutating
// verbs (set/replace/pause/resume/clear), so listing it here let --read-only
// bypass requireWritable. Mutating access goes through zcode_session_goal.
const INVOKE_ALLOWLIST = new Set([
    "session/list",
    "session/read",
    "session/messages",
    "session/events",
    "session/usage",
    "session/subagents",
    "workspace/readPresentation",
    "runtime/capabilities",
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
            const sessionMethod = method.startsWith("session/");
            const workspaceMethod = !sessionMethod && method !== "usage/stats" && method !== "runtime/capabilities";
            const properties = sessionMethod && method !== "session/list"
                ? { sessionId: { type: "string" } }
                : workspaceMethod
                    ? { workspace: { type: "object", properties: { workspacePath: { type: "string" }, workspaceKey: { type: "string" } }, required: ["workspacePath"], additionalProperties: false } }
                    : method === "usage/stats" ? { range: { type: "string", enum: ["all", "7d", "30d"] } } : {};
            if (method === "session/events") {
                properties.afterSeq = { type: "integer", minimum: -1 };
                properties.limit = { type: "integer", minimum: 1, maximum: 1000 };
            }
            validateArguments({ type: "object", properties, required: workspaceMethod ? ["workspace"] : sessionMethod && method !== "session/list" ? ["sessionId"] : [], additionalProperties: false }, params);
            if (workspaceMethod) {
                const w = params.workspace;
                params.workspace = workspaceRef(ctx.allowlist.enforce(String(w.workspacePath)));
            }
            if (typeof params.sessionId === "string") {
                // D-01: session-scoped reads (messages/events/usage/...) are only
                // allowed for sessions whose workspace is allowlisted.
                const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, params.sessionId);
                params.sessionId = sessionId;
            }
            else if (method.startsWith("session/") && method !== "session/list") {
                throw new Error(`${method} requires params.sessionId`);
            }
            const result = await ctx.runtime.call(method, params);
            if (method === "session/list") {
                // Hide sessions of non-allowlisted workspaces from listings.
                const r = (result ?? {});
                const sessions = Array.isArray(r.sessions) ? r.sessions : [];
                return { ...r, sessions: sessions.filter((s) => { const wp = sessionWorkspaceOf(s); return wp !== null && ctx.allowlist.isAllowed(wp); }) };
            }
            return result;
        },
    });
    // ---------------------------------------------------------------- models
    tools.push({
        name: "zcode_models_list",
        title: "List available models",
        description: "Full native model catalog (provider, model id, context, reasoning, modalities). Native 0.16.9 requires creating and closing an owned deferred session without a prompt; unavailable in bridge read-only mode. No invented models or workspace revision.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" } },
            required: ["workspacePath"],
            additionalProperties: false,
        },
        mutating: true,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            const state = await ctx.runtime.readWorkspaceCatalog(workspacePath);
            return { modelCatalog: state.modelCatalog, revision: null, source: state.source };
        },
    });
    tools.push({
        name: "zcode_model_set",
        title: "Select model / mode / reasoning",
        description: "Select model (providerId/modelId), reasoning and/or permission mode for a session. Returns requested and effective values with actual read-back comparison. Native 0.16.9 has no workspace-default setters; scope=workspace returns an explicit unsupported error without mutation.",
        inputSchema: {
            type: "object",
            properties: {
                scope: { type: "string", enum: ["session", "workspace"] },
                expectedRevision: { type: "integer", minimum: 0 },
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
            const thoughtLevel = args.thoughtLevel === undefined ? null : str(args, "thoughtLevel");
            const mode = optStr(args, "mode");
            requireModeAllowed(ctx, mode);
            const requested = {};
            if (modelRef)
                requested.model = `${modelRef.providerId}/${modelRef.modelId}`;
            if (thoughtLevel)
                requested.thoughtLevel = thoughtLevel;
            if (mode)
                requested.mode = mode;
            if (scope === "session") {
                const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
                let revision = optNum(args, "expectedRevision");
                const mutations = [];
                if (modelRef)
                    mutations.push(["session/setModel", { model: { ...modelRef, ...(thoughtLevel === null ? {} : { options: { reasoningLevel: thoughtLevel } }) } }]);
                else if (thoughtLevel !== null)
                    mutations.push(["session/setThoughtLevel", { thoughtLevel }]);
                if (mode)
                    mutations.push(["session/setMode", { mode }]);
                if (!mutations.length)
                    throw new Error("nothing to set: provide model, thoughtLevel or mode");
                for (const [method, fields] of mutations) {
                    const result = await ctx.runtime.call(method, { sessionId, ...fields, ...(revision === null ? {} : { expectedRevision: revision }) });
                    if (revision !== null) {
                        const next = result.runtime?.stateRevision;
                        if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0)
                            throw new Error("INVALID_NATIVE_RESPONSE: setter omitted session revision; refusing remaining mutations");
                        revision = next;
                    }
                }
                const readBack = await ctx.runtime.ipcSessionRead(sessionId);
                const settings = (readBack?.settings ?? {});
                const model = (settings.model ?? {});
                const current = (model.current ?? {});
                const sMode = (settings.mode ?? {});
                const sThought = (settings.thoughtLevel ?? settings.reasoning ?? {});
                const effective = {
                    model: current.providerId && current.modelId ? `${String(current.providerId)}/${String(current.modelId)}` : null,
                    mode: sMode.current ?? null,
                    thoughtLevel: sThought.current ?? null,
                };
                return {
                    scope, requested, effective,
                    revision: readBack.runtime?.stateRevision ?? null,
                    verified: Object.entries(requested).every(([key, value]) => effective[key] === value),
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
        description: "Update native process-wide, non-persisted boolean preferences: askUserQuestionAutoResolutionEnabled, modelIoFullRetentionEnabled, offPeakToolEnabled, dynamicWorkflowEnabled. Returns native acknowledgement; no read-back getter or CAS revision exists. Workspace mode/model/thoughtLevel defaults are unsupported; use session-scoped model selection.",
        inputSchema: {
            type: "object",
            properties: {
                workspacePath: { type: "string" },
                changes: { type: "object", description: "Explicit process-runtime booleans, e.g. {\"dynamicWorkflowEnabled\": false}. Applies beyond this workspace; not persisted." },
                expectedRevision: { type: "integer", minimum: 0, description: "Unsupported for native 0.16.9 workspace preferences; supplying this rejects the update without mutation." },
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
            if (typeof changes.mode === "string")
                requireModeAllowed(ctx, changes.mode);
            const expectedRevision = optNum(args, "expectedRevision");
            return await ctx.settings.update(workspacePath, changes, expectedRevision);
        },
    });
    tools.push({
        name: "zcode_settings_reset",
        title: "Reset setting",
        description: "Native 0.16.9 exposes no resettable workspace defaults. Returns an explicit unsupported/default-unknown error without mutation; set an explicit process-runtime preference or use session-scoped model selection instead.",
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
                    if (s.workspace?.workspacePath && ctx.allowlist.isAllowed(s.workspace.workspacePath))
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
        description: "Validate the workspace allowlist and read native presentation (mode and slash commands). Model/reasoning defaults and workspace revision are not exposed by 0.16.9; use zcode_models_list separately for full catalog discovery.",
        inputSchema: {
            type: "object",
            properties: { workspacePath: { type: "string" } },
            required: ["workspacePath"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            return { workspacePath, ...await ctx.settings.readWorkspaceState(workspacePath) };
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
            // D-01: the harness session store is shared with the desktop app; only
            // sessions of allowlisted workspaces are visible through the bridge.
            const sessions = (listResult?.sessions ?? []).filter((s) => {
                const wp = sessionWorkspaceOf(s);
                return wp !== null && ctx.allowlist.isAllowed(wp);
            });
            const wp = optStr(args, "workspacePath");
            if (wp) {
                const canonical = normPath(ctx.allowlist.enforce(wp));
                const filtered = sessions.filter((s) => {
                    const p = sessionWorkspaceOf(s);
                    return p !== null && normPath(ctx.allowlist.check(p) ?? p) === canonical;
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
            requireModeAllowed(ctx, mode);
            const result = await ctx.runtime.ipcSessionCreate(workspacePath, mode ?? (ctx.config.allowYolo ? null : "build"));
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
            const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
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
            const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
            return redactDeep(await ctx.runtime.call("session/resume", { sessionId }));
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
            const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
            return redactDeep(await ctx.runtime.call("session/fork", { sessionId, target: { kind: "latestCheckpoint" } }));
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
            const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
            return redactDeep(await ctx.runtime.call("session/close", { sessionId }));
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
            const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
            const instructions = optStr(args, "instructions");
            return redactDeep(await ctx.runtime.call("session/compact", { sessionId, ...(instructions ? { instructions } : {}) }));
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
            const { sessionId } = await sessionInScope(ctx.runtime, ctx.allowlist, str(args, "sessionId"));
            const action = str(args, "action");
            const value = optStr(args, "value");
            return redactDeep(await ctx.runtime.call("session/goal", { sessionId, action, ...(value !== null ? { target: value } : {}) }));
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
            const thoughtLevel = args.thoughtLevel === undefined ? null : str(args, "thoughtLevel");
            const mode = optStr(args, "mode");
            requireModeAllowed(ctx, mode);
            let sessionIdRaw = optStr(args, "sessionId");
            if (sessionIdRaw) {
                // D-01: a reused session must belong to the very workspace the task
                // claims; otherwise the turn would run (and be attributed) elsewhere.
                const scoped = await sessionInScope(ctx.runtime, ctx.allowlist, sessionIdRaw);
                if (workspaceIdentity(scoped.workspacePath) !== workspaceIdentity(workspacePath)) {
                    throw new Error(`WORKSPACE_MISMATCH: session ${scoped.sessionId} belongs to ${scoped.workspacePath}, not to ${workspacePath}`);
                }
                sessionIdRaw = scoped.sessionId;
            }
            const modelRef = parseModelRef(args);
            // GLM-5.3-Flash preference guard: refuse silent model swaps.
            if (modelRef) {
                const state = await ctx.runtime.readWorkspaceCatalog(workspacePath);
                const available = state.modelCatalog.available;
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
                thoughtLevel,
                mode,
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
            properties: { taskId: { type: "string" }, timeoutMs: { type: "integer", minimum: 0, maximum: 120000, description: "Default 60000, maximum 120000" } },
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
            properties: { taskId: { type: "string" }, afterSeq: { type: "integer", minimum: -1 }, limit: { type: "integer", minimum: 1, maximum: 1000, description: "Default 200" } },
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
                offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Byte offset (default 0)" },
                length: { type: "integer", minimum: 1, maximum: 1048576, description: "Max bytes to return (default 262144)" },
            },
            required: ["workspacePath", "path"],
            additionalProperties: false,
        },
        mutating: false,
        handler: async (args) => {
            const { workspacePath } = ws(ctx, args);
            const rel = str(args, "path");
            const artifact = await readArtifact(workspacePath, rel, optNum(args, "offset") ?? 0, optNum(args, "length") ?? 262_144, ctx.config.maxArtifactBytes);
            return { ...artifact, mimeType: guessMime(artifact.path) };
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
            const visible = [];
            for (const interaction of ctx.interactions.list(status)) {
                if (interaction.workspace && ctx.allowlist.isAllowed(interaction.workspace))
                    visible.push(interaction);
                else if (interaction.taskId && ctx.tasks.get(interaction.taskId))
                    visible.push(interaction);
            }
            return { interactions: visible };
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
            const interaction = ctx.interactions.get(interactionId);
            if (!interaction)
                throw new Error('unknown interaction');
            if (interaction.sessionId)
                await sessionInScope(ctx.runtime, ctx.allowlist, interaction.sessionId);
            else if (interaction.workspace)
                ctx.allowlist.enforce(interaction.workspace);
            else
                throw new Error('interaction workspace cannot be verified against the allowlist');
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
