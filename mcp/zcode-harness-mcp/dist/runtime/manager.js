/**
 * RuntimeManager — owns the single app-server connection, routes reverse
 * requests to the InteractionManager and notifications to subscribers.
 *
 * Restarts are lazy: when the harness exits, the crash handler (onCrash)
 * marks the running tasks interrupted, and nothing is respawned until the
 * next harness-bound call (or task start) needs a connection. Every harness
 * start after the bridge's first is a restart and needs a slot of the restart
 * budget (the proxy manager's policy shape): at most `limit`
 * restarts per rolling window (default 3 per 15 min), each after a backoff
 * from the last exit (1 s, 2 s, 4 s, … capped at 30 s). Concurrent calls
 * share one restart. With the budget exhausted, a call fails with
 * HARNESS_RESTART_BUDGET_EXHAUSTED (what, why, next step) and spawns nothing.
 */
import path from "node:path";
import { ZcodeConnection, ZcodeConnectionError } from "../protocol/connection.js";
import { workspaceRef, parseSessionId } from "../protocol/types.js";
import { DEFAULT_RESTART_BUDGET } from "../config.js";
import { createEventLogger, createLogger } from "../util/log.js";
const log = createLogger("runtime");
const events = createEventLogger("runtime");
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30_000;
/** "15 min" for whole minutes, else "<n> s". */
function windowText(windowSec) {
    return windowSec % 60 === 0 ? `${windowSec / 60} min` : `${windowSec} s`;
}
/**
 * The harness restart budget: restart times inside the rolling window (at
 * most `limit` entries, so every check is O(limit), never O(tasks)).
 */
export class RestartBudget {
    limit;
    windowMs;
    backoffBaseMs;
    backoffMaxMs;
    history = [];
    constructor(limit, windowMs, backoffBaseMs = RESTART_BACKOFF_BASE_MS, backoffMaxMs = RESTART_BACKOFF_MAX_MS) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.backoffBaseMs = backoffBaseMs;
        this.backoffMaxMs = backoffMaxMs;
    }
    prune(now) {
        while (this.history.length > 0 && now - (this.history[0] ?? now) >= this.windowMs)
            this.history.shift();
    }
    /** Restarts inside the window at `now`. */
    used(now) {
        this.prune(now);
        return this.history.length;
    }
    /** Reserve one restart: its number in the window and its backoff, or null when the budget is exhausted. */
    reserve(now) {
        this.prune(now);
        if (this.history.length >= this.limit)
            return null;
        this.history.push(now);
        const restart = this.history.length;
        return { restart, backoffMs: Math.min(this.backoffBaseMs * 2 ** (restart - 1), this.backoffMaxMs) };
    }
    /** When the oldest restart leaves the window (a slot comes back), or null while a slot is free or restarts are disabled. */
    retryAt(now) {
        this.prune(now);
        if (this.limit === 0 || this.history.length < this.limit)
            return null;
        return (this.history[0] ?? now) + this.windowMs;
    }
}
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
    budget;
    windowSec;
    /** The in-flight harness start; concurrent callers share it (and its budget slot). */
    connecting = null;
    /** Whether the bridge started a harness before: every later start is a restart. */
    startedOnce = false;
    /** Bumped by stop(): a start still waiting out its backoff is abandoned. */
    generation = 0;
    lastExit = null;
    exhaustedLogged = false;
    constructor(config, runtimeInfo, interactions) {
        this.config = config;
        this.runtimeInfo = runtimeInfo;
        this.interactions = interactions;
        this.requestTimeoutMs = config.defaultRequestTimeoutMs;
        // A config built without the key (an older programmatic caller) gets the default budget.
        const { limit, windowSec } = config.restartBudget ?? DEFAULT_RESTART_BUDGET;
        this.windowSec = windowSec;
        this.budget = new RestartBudget(limit, windowSec * 1000);
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
    /** The running connection, or a started one (a restart under the budget). */
    connect() {
        const current = this.connection;
        if (current && current.running)
            return Promise.resolve(current);
        if (!this.connecting) {
            this.connecting = this.startConnection().finally(() => {
                this.connecting = null;
            });
        }
        return this.connecting;
    }
    async startConnection() {
        const generation = this.generation;
        if (this.startedOnce) {
            const now = Date.now();
            const slot = this.budget.reserve(now);
            if (slot === null)
                throw this.budgetExhausted(now);
            this.exhaustedLogged = false;
            const waitMs = Math.max(0, (this.lastExit?.at ?? now) + slot.backoffMs - now);
            events.warn("harness restart", {
                restart: slot.restart,
                budget: this.budget.limit,
                windowSec: this.windowSec,
                backoffMs: waitMs,
                lastExitCode: this.lastExit?.code,
                lastExitSignal: this.lastExit?.signal ?? undefined,
            });
            // Unref'd: a shutdown during the backoff is not held open by it.
            if (waitMs > 0)
                await new Promise((resolve) => setTimeout(resolve, waitMs).unref());
            if (generation !== this.generation)
                throw new ZcodeConnectionError("STOPPED", "harness connection was stopped");
        }
        this.startedOnce = true;
        const conn = this.newConnection();
        this.connection = conn;
        await conn.start();
        return conn;
    }
    budgetExhausted(now) {
        const { limit } = this.budget;
        const windowSec = this.windowSec;
        const window = windowText(windowSec);
        const retryAt = this.budget.retryAt(now);
        const retryIso = retryAt === null ? null : new Date(retryAt).toISOString();
        const exit = this.lastExit ? `exited again (code=${this.lastExit.code}, signal=${this.lastExit.signal})` : "is not running";
        if (!this.exhaustedLogged) {
            this.exhaustedLogged = true;
            events.error("harness restart budget exhausted", {
                restarts: this.budget.used(now),
                windowSec,
                retryAt: retryIso ?? undefined,
                lastExitCode: this.lastExit?.code,
                lastExitSignal: this.lastExit?.signal ?? undefined,
            });
        }
        const what = limit === 0
            ? `the harness ${exit} and harness restarts are disabled`
            : `the harness was restarted ${this.budget.used(now)} ${this.budget.used(now) === 1 ? "time" : "times"} in the last ${window} and ${exit}`;
        const until = retryIso === null ? "until the bridge restarts" : `before ${retryIso}`;
        return new ZcodeConnectionError("HARNESS_RESTART_BUDGET_EXHAUSTED", `HARNESS_RESTART_BUDGET_EXHAUSTED: ${what}; the bridge does not start it again ${until} ` +
            `(restart budget ${limit} per ${window}, ZCODE_HARNESS_RESTART_BUDGET). ` +
            `Next: run zcode_health and check runtime.restartBudget.lastExit and the bridge's stderr log for why the harness exits, ` +
            `fix that, then restart the MCP server${retryIso === null ? "" : ` (or retry after ${retryIso})`}.`);
    }
    newConnection() {
        const conn = new ZcodeConnection({
            harnessPath: this.runtimeInfo.harnessPath,
            bundledProviderConfigPath: this.runtimeInfo.bundledProviderConfigPath,
            cwd: path.dirname(this.config.dataDir + path.sep), // stable neutral cwd (data dir parent)
            requestTimeoutMs: this.requestTimeoutMs,
            onNotification: (method, params) => this.dispatchNotification(method, params),
            onReverseRequest: (ctx) => this.handleReverseRequest(ctx),
            onExit: (code, signal) => {
                if (this.connection !== conn)
                    return;
                this.lastExit = { at: Date.now(), code, signal };
                this.connection = null;
                log.warn("harness exited; notifying crash handler");
                this.onCrash?.();
            },
        });
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
        await this.connect();
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
        const conn = await this.connect();
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
        this.generation += 1;
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
            restartBudget: this.restartBudgetState(),
        };
    }
    /** The restart budget's recorded state (zcode_health, additive). */
    restartBudgetState() {
        const now = Date.now();
        const retryAt = this.budget.retryAt(now);
        const used = this.budget.used(now);
        return {
            limit: this.budget.limit,
            windowSec: this.windowSec,
            used,
            exhausted: used >= this.budget.limit,
            retryAt: retryAt === null ? null : new Date(retryAt).toISOString(),
            lastExit: this.lastExit ? { at: new Date(this.lastExit.at).toISOString(), code: this.lastExit.code, signal: this.lastExit.signal } : null,
        };
    }
}
