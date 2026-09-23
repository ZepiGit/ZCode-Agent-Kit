/**
 * RuntimeManager — owns the single app-server connection, routes reverse
 * requests to the InteractionManager and notifications to subscribers, and
 * restarts the harness on unexpected exit (running tasks are marked
 * interrupted by the TaskManager via onCrash).
 */
import path from "node:path";
import { ZcodeConnection, ZcodeConnectionError } from "../protocol/connection.js";
import { workspaceRef, parseSessionId } from "../protocol/types.js";
import { createLogger } from "../util/log.js";
const log = createLogger("runtime");
export class RuntimeManager {
    connection = null;
    config;
    runtimeInfo;
    interactions;
    eventListeners = new Set();
    reverseListeners = new Set();
    onCrash = null;
    restarting = null;
    requestTimeoutMs;
    constructor(config, runtimeInfo, interactions) {
        this.config = config;
        this.runtimeInfo = runtimeInfo;
        this.interactions = interactions;
        this.requestTimeoutMs = config.defaultRequestTimeoutMs;
    }
    get info() {
        return this.runtimeInfo;
    }
    setCrashHandler(fn) {
        this.onCrash = fn;
    }
    onEvent(fn) {
        this.eventListeners.add(fn);
        return () => this.eventListeners.delete(fn);
    }
    onReverseRequest(fn) {
        this.reverseListeners.add(fn);
        return () => this.reverseListeners.delete(fn);
    }
    get running() {
        return this.connection?.running ?? false;
    }
    ensureConnection() {
        if (this.connection && this.connection.running)
            return this.connection;
        const conn = new ZcodeConnection({
            harnessPath: this.runtimeInfo.harnessPath,
            bundledProviderConfigPath: this.runtimeInfo.bundledProviderConfigPath,
            cwd: path.dirname(this.config.dataDir + path.sep), // stable neutral cwd (data dir parent)
            requestTimeoutMs: this.requestTimeoutMs,
            onNotification: (method, params) => this.dispatchNotification(method, params),
            onReverseRequest: (ctx) => this.handleReverseRequest(ctx),
            onExit: () => {
                if (this.connection !== conn)
                    return;
                this.connection = null;
                log.warn("harness exited; notifying crash handler");
                this.onCrash?.();
            },
        });
        this.connection = conn;
        return conn;
    }
    dispatchNotification(method, params) {
        const evt = {
            channel: method === "session/event" ? "session/event" : method === "state.updated" ? "state.updated" : "other",
            method,
            params: (params ?? {}),
        };
        for (const fn of this.eventListeners) {
            try {
                fn(evt);
            }
            catch (err) {
                log.error("event listener threw", { error: String(err) });
            }
        }
    }
    handleReverseRequest(ctx) {
        const params = (ctx.params ?? {});
        // Let task-level listeners try first (they can attribute interactions to
        // tasks); if none of them answers, fall back to the InteractionManager.
        for (const fn of this.reverseListeners) {
            let handled = false;
            try {
                handled = fn(ctx) === true;
            }
            catch (err) {
                log.error("reverse listener threw", { error: String(err) });
            }
            if (handled)
                return;
        }
        // Global fallback: record + policy answer.
        try {
            // Runtime preferences must ALWAYS be answered (session/create blocks
            // otherwise); they are bridge configuration, not an interaction.
            if (ctx.method === "session/requestRuntimePreferences") {
                ctx.reply({ ...this.config.runtimePreferences });
                return;
            }
            const decision = this.interactions.register({
                method: ctx.method,
                harnessParams: params,
                sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
                workspace: typeof params.workspace === "object" && params.workspace !== null ? String(params.workspace.workspacePath ?? "") : null,
                taskId: null,
                readOnlyMode: this.config.readOnly,
            });
            if (decision.auto !== null) {
                ctx.reply(decision.auto.result);
            }
            else if (!decision.needsAgent) {
                ctx.replyError(-32601, `bridge does not support ${ctx.method}`);
            }
            else {
                // Registered as pending; without a task context there is nobody to
                // answer, so the timeout policy will deny it.
                ctx.replyError(-32001, `interaction ${ctx.method} registered but requires an agent response via zcode_interaction_respond`);
            }
        }
        catch (err) {
            log.error("failed to register interaction", { error: String(err) });
            ctx.replyError(-32603, "bridge interaction handling failed");
        }
    }
    async start() {
        const conn = this.ensureConnection();
        await conn.start();
    }
    async restart() {
        if (this.restarting)
            return this.restarting;
        this.restarting = (async () => {
            this.stop();
            await this.start();
        })();
        try {
            await this.restarting;
        }
        finally {
            this.restarting = null;
        }
    }
    /** Calls already dispatched may have taken effect even if their reply is lost. */
    async call(method, params, timeoutMs) {
        const conn = this.ensureConnection();
        if (!conn.running) {
            await conn.start();
        }
        try {
            return await conn.call(method, params, timeoutMs);
        }
        catch (err) {
            if (err instanceof ZcodeConnectionError && err.code === "TIMEOUT" && this.connection === conn) {
                this.stop();
                this.onCrash?.();
            }
            throw err;
        }
    }
    /**
     * 0.16.9 exposes the full catalog only in session/create (session/read is
     * current-model-only). Use an owned deferred session, never send a prompt,
     * and close only while it is still deferred. No workspace defaults are set.
     */
    async readWorkspaceCatalog(workspacePath) {
        if (this.config.readOnly)
            throw new Error("READ_ONLY_MODE: full catalog discovery requires a deferred native session; use workspace/readPresentation for a pure read");
        const snapshot = await this.callForWorkspace("session/create", workspacePath, {
            persistence: "deferred",
            mode: "plan",
            titleGenerationEnabled: false,
            toolAllowlist: [],
        }, 90_000);
        const session = snapshot.session;
        const sessionId = parseSessionId(session?.sessionId);
        if (!sessionId)
            throw new Error("INVALID_NATIVE_RESPONSE: catalog session has no valid sessionId");
        try {
            const settings = snapshot.settings;
            const model = settings?.model;
            const available = model?.available;
            if (!settings || !Array.isArray(available)) {
                throw new Error("INVALID_NATIVE_RESPONSE: session/create omitted the model catalog");
            }
            return { modelCatalog: { available }, source: "session/create (deferred, no prompt)" };
        }
        finally {
            const closed = await this.call("session/close", { sessionId, expectedPersistence: "deferred" });
            if (closed.closed !== true)
                throw new Error("CATALOG_SESSION_NOT_CLOSED: native deferred-session guard refused cleanup");
        }
    }
    /** Workspace-scoped call helper. */
    callForWorkspace(method, workspacePath, extra, timeoutMs) {
        return this.call(method, { workspace: workspaceRef(workspacePath), ...extra }, timeoutMs);
    }
    // ---------------------------------------------------------------------------
    // Typed IPC façade. Every method below is local stdio IPC with the harness
    // child process — there is no HTTP/network I/O anywhere in this class.
    // Session ids are validated with parseSessionId before use.
    async ipcSessionCreate(workspacePath, mode, timeoutMs = 90_000) {
        return this.call("session/create", { workspace: workspaceRef(workspacePath), ...(mode ? { mode } : {}) }, timeoutMs);
    }
    async ipcSessionSubscribe(sessionId) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/subscribe", { sessionId: sid, deliveryKind: "desktop-continuous" });
    }
    async ipcSessionSend(sessionId, content, extra) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/send", { sessionId: sid, content, ...extra });
    }
    async ipcSessionRead(sessionId) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/read", { sessionId: sid });
    }
    /** Read the stored conversation transcript of a session (local IPC). */
    async ipcSessionTranscript(sessionId) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/messages", { sessionId: sid });
    }
    async ipcSessionUsage(sessionId) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/usage", { sessionId: sid });
    }
    async ipcSessionStop(sessionId) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/stop", { sessionId: sid });
    }
    async ipcSessionSetModel(sessionId, providerId, modelId, thoughtLevel) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/setModel", {
            sessionId: sid,
            model: { providerId, modelId, ...(thoughtLevel == null ? {} : { options: { reasoningLevel: thoughtLevel } }) },
        });
    }
    async ipcSessionSetMode(sessionId, mode) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/setMode", { sessionId: sid, mode });
    }
    async ipcSessionSetThoughtLevel(sessionId, thoughtLevel) {
        const sid = parseSessionId(sessionId);
        if (!sid)
            throw new Error("invalid session id");
        return this.call("session/setThoughtLevel", { sessionId: sid, thoughtLevel });
    }
    stop() {
        const conn = this.connection;
        this.connection = null;
        conn?.stop();
    }
    /** Live diagnostics for zcode_health. */
    diagnostics() {
        const c = this.connection;
        return {
            harnessPath: this.runtimeInfo.harnessPath,
            harnessVersion: this.runtimeInfo.harnessVersion,
            bundleFingerprint: this.runtimeInfo.bundleFingerprint,
            desktopVersion: this.runtimeInfo.desktopVersion,
            running: c?.running ?? false,
            lastExit: c?.lastExitInfo ?? null,
            sawTraffic: c?.sawTraffic ?? false,
            nodeProgram: "node",
        };
    }
}
