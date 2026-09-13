function cap(id, title, description, backend, direction, availability, implementation, verification, mcpTool, evidence) {
    return { id, title, description, backend, direction, availability, implementation, verification, mcpTool, evidence };
}
export const BRIDGE_VERSION = "0.1.0";
export const TARGET_PROTOCOL = "ZCode Protocol v1 (zcode.cjs app-server --stdio, verified 0.16.5)";
export const HARNESS_FINGERPRINT = "sha256-16 of bundle, see zcode_health";
export const CAPABILITIES = [
    // ---- session lifecycle -------------------------------------------------
    cap("session.create", "Create a session", "Create a harness session in a workspace (blocks until runtime preferences are answered).", "session/create", "client_call", "available", "implemented", "live_verified", "zcode_session_create", "live probe: result.session.sessionId + protocol {ZCode Protocol,1}"),
    cap("session.list", "List sessions", "List harness sessions.", "session/list", "client_call", "available", "implemented", "live_verified", "zcode_sessions_list", "live probe returned sessions incl. workspaces"),
    cap("session.read", "Read session state", "Projection, settings, todos for a session.", "session/read", "client_call", "available", "implemented", "live_verified", "zcode_session_get", "live probe: projection.status/settings.model"),
    cap("session.send", "Send a prompt", "Send content to a session; accepts toolDenylist.", "session/send", "client_call", "available", "implemented", "live_verified", "zcode_task_start", "live probe: {accepted:true,stateRevision}"),
    cap("session.stop", "Stop the running turn", "Stop generation; verified via session/read.", "session/stop", "client_call", "available", "implemented", "live_verified", "zcode_task_cancel", "live probe: {} + projection idle"),
    cap("session.close", "Close a session", "Close and release a session.", "session/close", "client_call", "available", "implemented", "live_verified", "zcode_session_close", "live probe: {closed:true}"),
    cap("session.resume", "Resume a session", "Resume a persisted session by id.", "session/resume", "client_call", "available", "implemented", "fixture_verified", "zcode_session_resume", "fixture harness; live blocked when session already closed"),
    cap("session.fork", "Fork a session", "Fork from latest checkpoint.", "session/fork", "client_call", "available", "implemented", "fixture_verified", "zcode_session_fork", "live probe: 'Cannot fork while a prompt is running' → guarded"),
    cap("session.subscribe", "Subscribe to events", "Subscribe with deliveryKind desktop-continuous.", "session/subscribe", "client_call", "available", "implemented", "live_verified", "zcode_task_start (internal)", "live probe: {eventSeq,events}"),
    cap("session.messages", "Stored transcript", "Read stored conversation entries.", "session/messages", "client_call", "available", "implemented", "live_verified", "zcode_task_result (internal)", "live probe: {messages:[]}"),
    cap("session.events", "Event history", "Read past events by seq.", "session/events", "client_call", "available", "implemented", "live_verified", "zcode_task_events (internal)", "live probe: {events:[]}"),
    cap("session.usage", "Session usage", "Token usage per session.", "session/usage", "client_call", "available", "implemented", "live_verified", "zcode_task_result (internal)", "live probe: totalTokens/inputTokens/outputTokens"),
    cap("session.setModel", "Select session model", "Set model per session; harness validates against catalog.", "session/setModel", "client_call", "available", "implemented", "live_verified", "zcode_model_set", "live probe: invalid model → 'Unsupported model ... Available models'"),
    cap("session.setMode", "Select session mode", "Set permission mode per session.", "session/setMode", "client_call", "available", "implemented", "live_verified", "zcode_model_set (mode)", "live probe: mode plan/build OK"),
    cap("session.setThoughtLevel", "Reasoning level", "Set reasoning effort; levels are model-specific.", "session/setThoughtLevel", "client_call", "available", "implemented", "live_verified", "zcode_model_set (thoughtLevel)", "live probe: GLM-5-Turbo rejects 'high' → surfaced as error"),
    cap("session.compact", "Compact context", "Compact the session context.", "session/compact", "client_call", "available", "implemented", "live_verified", "zcode_session_compact", "live probe: {response,snapshot}"),
    cap("session.goal", "Session goal", "Show/set/replace/pause/resume/clear the session goal.", "session/goal", "client_call", "available", "implemented", "live_verified", "zcode_session_goal", "live probe: action enum from validation error"),
    cap("session.subagents", "Subagents", "List subagent state for a session.", "session/subagents", "client_call", "unknown", "partial", "untested", "zcode_session_get (projection.backgroundJobs)", "live probe returned 'Session not found' for live session → needs different params; unknown"),
    cap("session.cancelBackgroundTask", "Cancel background task", "Cancel a background job of a session.", "session/cancelBackgroundTask", "client_call", "available", "implemented", "fixture_verified", "zcode_task_cancel (internal)", "registered; live condition (running background job) not reproducible"),
    // ---- workspace ---------------------------------------------------------
    cap("workspace.readState", "Workspace state", "Model catalog, settings and revision for a workspace.", "workspace/readState", "client_call", "available", "implemented", "live_verified", "zcode_workspace_open", "live probe: modelCatalog + settings + revision"),
    cap("workspace.setDefaultModel", "Workspace default model", "Set the default model of a workspace.", "workspace/setDefaultModel", "client_call", "available", "implemented", "fixture_verified", "zcode_settings_update", "schema verified; live response timing varies"),
    cap("workspace.setDefaultMode", "Workspace default mode", "Set the default permission mode of a workspace.", "workspace/setDefaultMode", "client_call", "available", "implemented", "fixture_verified", "zcode_settings_update", "schema verified"),
    cap("workspace.setDefaultThoughtLevel", "Workspace default reasoning", "Set default reasoning level of a workspace.", "workspace/setDefaultThoughtLevel", "client_call", "available", "implemented", "fixture_verified", "zcode_settings_update", "schema verified"),
    cap("workspace.upsertModelProvider", "Custom model provider", "Register a custom provider.", "workspace/upsertModelProvider", "client_call", "available", "missing", "untested", null, "deliberately not exposed: writing provider configs (API keys) is out of scope v1"),
    cap("workspace.removeModelProvider", "Remove model provider", "Remove a custom provider.", "workspace/removeModelProvider", "client_call", "available", "missing", "untested", null, "not exposed in v1"),
    cap("workspace.updateProviderRegistry", "Provider registry", "Update provider registry.", "workspace/updateProviderRegistry", "client_call", "available", "missing", "untested", null, "not exposed in v1"),
    cap("workspace.updateInteractionPreferences", "Interaction preferences", "Update interaction preferences.", "workspace/updateInteractionPreferences", "client_call", "available", "missing", "untested", null, "schema unknown; not exposed in v1"),
    cap("workspace.updateModelIoPreferences", "Model IO preferences", "Update model IO preferences.", "workspace/updateModelIoPreferences", "client_call", "available", "missing", "untested", null, "schema unknown; not exposed in v1"),
    cap("workspace.generateText", "One-shot text generation", "Generate text without a session.", "workspace/generateText", "client_call", "available", "missing", "untested", null, "model-dependent; blocked by environment (captcha) for live verification"),
    cap("workspace.hooks.trustGrant", "Hook trust", "Grant trust for workspace hooks.", "workspace/hooks/trustGrant", "server_callback", "available", "implemented", "fixture_verified", "(auto-declined by policy)", "registered; auto-decline keeps authority with operator"),
    // ---- discovery ---------------------------------------------------------
    cap("mcp.list", "Harness-internal MCP servers", "List MCP servers configured inside the harness.", "mcp/list", "client_call", "available", "implemented", "live_verified", "zcode_operations_list (mcp)", "live probe requires workspace object; schema verified"),
    cap("plugins.list", "Harness plugins", "List plugins of the harness.", "plugins/list", "client_call", "available", "implemented", "live_verified", "zcode_operations_list (plugins)", "live probe requires workspace object"),
    cap("skills.referenceCatalog", "Skills catalog", "List local skills.", "skills/referenceCatalog", "client_call", "available", "implemented", "live_verified", "zcode_operations_list (skills)", "live probe issued"),
    cap("plugins.overview|install|...", "Plugin management", "Full plugin lifecycle (overview/install/uninstall/update/configure/validate/describe/marketplace).", "plugins/*", "client_call", "available", "missing", "untested", null, "mutating plugin management deliberately not exposed in v1 (no auto-install per security policy)"),
    // ---- automation / usage ------------------------------------------------
    cap("automation.*", "Scheduled automations", "Create/update/list/delete time-based automations.", "automation/*", "client_call", "removed_in_version", "not_applicable", "live_verified", null, "live probe: automation/list → -32601 Method not found (removed in 0.16.5)"),
    cap("usage.stats", "Account usage", "Usage statistics (all|7d|30d).", "usage/stats", "client_call", "available", "implemented", "live_verified", "zcode_operations_list (usage)", "live probe: {range:'7d', summary:{totalTokens...}}"),
    // ---- reverse calls (server → client) -----------------------------------
    cap("interaction.requestPermission", "Permission requests", "Harness asks for tool permission; bridge policy or agent answers.", "interaction/requestPermission", "server_callback", "available", "implemented", "fixture_verified", "zcode_interactions_list / zcode_interaction_respond", "policy: deny|allowlist|ask; options extracted from harness payload"),
    cap("interaction.requestUserInput", "User input questions", "AskUserQuestion / plan approval relays.", "interaction/requestUserInput", "server_callback", "available", "implemented", "fixture_verified", "zcode_interactions_list / zcode_interaction_respond", "fixture harness"),
    cap("session.requestRuntimePreferences", "Runtime preferences", "Blocks session/create; bridge answers with configured booleans.", "session/requestRuntimePreferences", "server_callback", "available", "implemented", "live_verified", "(internal, config)", "live probe: create succeeded after answering; error otherwise"),
    cap("interaction.requestProviderRuntimeHeaders", "Provider runtime headers", "Desktop injects captcha/risk headers; bridge answers headersApplied:false.", "interaction/requestProviderRuntimeHeaders", "server_callback", "requires_desktop", "implemented", "fixture_verified", null, "harness code path exists (zaiStartPlan/bigmodel providers); captcha solving is a desktop UI capability"),
    cap("interaction.requestOfficialMcpAuthHeaders", "Official MCP auth", "Official plugin MCP OAuth.", "interaction/requestOfficialMcpAuthHeaders", "server_callback", "requires_desktop", "implemented", "live_verified", null, "live probe: seen for image_search/document-skills; bridge answers {ok:false,reason:'unsupported'}"),
    cap("interaction.browserList/browserExecute", "Browser use relay", "Browser control via client adapter.", "interaction/browser*", "server_callback", "requires_desktop", "implemented", "fixture_verified", null, "bridge declines (no adapter); desktop app provides browsers"),
    cap("computer-use.operation-event", "Computer use events", "Notification stream of computer-use operations.", "computer-use/operation-event", "event", "requires_desktop", "implemented", "fixture_verified", null, "notification is logged and forwarded to task events"),
    // ---- v4 face ------------------------------------------------------------
    cap("v4.*", "Desktop v4 gateway", "Conversation frames, controller, attachments, rewind (desktop face).", "v4/*", "client_call", "unknown", "partial", "untested", null, "requireV4Gateway exists; not initialized in standalone app-server sessions observed; v4 attachment upload not required for task flow"),
    // ---- environment --------------------------------------------------------
    cap("model.turn", "Model turn execution", "Provider turn execution with the authorized Z.AI login.", "session/send → provider", "client_call", "requires_login", "implemented", "blocked_by_environment", "zcode_task_start", "live: turn executes (hooks, events, streaming) but provider returns 400 'captcha verify failed' for CLI-spawned harness sessions; desktop sessions work; see KNOWN_LIMITATIONS.md"),
];
export function capabilitiesForMcp() {
    return CAPABILITIES.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        backend: c.backend,
        direction: c.direction,
        availability: c.availability,
        implementation: c.implementation,
        verification: c.verification,
        mcpTool: c.mcpTool,
        evidence: c.evidence,
    }));
}
