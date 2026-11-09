/**
 * RuntimeManager — owns the single app-server connection, routes reverse
 * requests to the InteractionManager and notifications to subscribers.
 *
 * Restarts are lazy: when the harness exits, the crash handler (onCrash)
 * marks the running tasks interrupted, and nothing is respawned until the
 * next harness-bound call (or task start) needs a connection. Every harness
 * start after the bridge's first is a restart and needs a slot of the restart
 * budget (ticket 57; the proxy manager's policy shape): at most `limit`
 * restarts per rolling window (default 3 per 15 min), each after a backoff
 * from the last exit (1 s, 2 s, 4 s, … capped at 30 s). Concurrent calls
 * share one restart. With the budget exhausted, a call fails with
 * HARNESS_RESTART_BUDGET_EXHAUSTED (what, why, next step) and spawns nothing.
 */
import path from "node:path";
import { ZcodeConnection, ZcodeConnectionError, type ReverseRequestContext } from "../protocol/connection.js";
import { workspaceRef, parseSessionId } from "../protocol/types.js";
import type { InteractionManager } from "../interactions/manager.js";
import type { RuntimeInfo } from "../discovery.js";
import type { BridgeConfig } from "../config.js";
import { createEventLogger, createLogger } from "../util/log.js";

const log = createLogger("runtime");
const events = createEventLogger("runtime");

const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30_000;

/** "15 min" for whole minutes, else "<n> s". */
function windowText(windowSec: number): string {
  return windowSec % 60 === 0 ? `${windowSec / 60} min` : `${windowSec} s`;
}

/**
 * The harness restart budget: restart times inside the rolling window (at
 * most `limit` entries, so every check is O(limit), never O(tasks)).
 */
export class RestartBudget {
  private readonly history: number[] = [];

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly backoffBaseMs = RESTART_BACKOFF_BASE_MS,
    private readonly backoffMaxMs = RESTART_BACKOFF_MAX_MS,
  ) {}

  private prune(now: number): void {
    while (this.history.length > 0 && now - (this.history[0] ?? now) >= this.windowMs) this.history.shift();
  }

  /** Restarts inside the window at `now`. */
  used(now: number): number {
    this.prune(now);
    return this.history.length;
  }

  /** Reserve one restart: its number in the window and its backoff, or null when the budget is exhausted. */
  reserve(now: number): { restart: number; backoffMs: number } | null {
    this.prune(now);
    if (this.history.length >= this.limit) return null;
    this.history.push(now);
    const restart = this.history.length;
    return { restart, backoffMs: Math.min(this.backoffBaseMs * 2 ** (restart - 1), this.backoffMaxMs) };
  }

  /** When the oldest restart leaves the window (a slot comes back), or null while a slot is free or restarts are disabled. */
  retryAt(now: number): number | null {
    this.prune(now);
    if (this.limit === 0 || this.history.length < this.limit) return null;
    return (this.history[0] ?? now) + this.windowMs;
  }
}

export interface HarnessEvent {
  channel: "session/event" | "state.updated" | "other";
  method: string;
  params: Record<string, unknown>;
}

export class RuntimeManager {
  private connection: ZcodeConnection | null = null;
  private readonly config: BridgeConfig;
  private readonly runtimeInfo: RuntimeInfo;
  private readonly interactions: InteractionManager;
  private readonly eventListeners = new Set<(evt: HarnessEvent) => void>();
  private readonly reverseListeners = new Set<(ctx: ReverseRequestContext) => boolean | void>();
  private onCrash: (() => void) | null = null;
  private restarting: Promise<void> | null = null;
  private readonly requestTimeoutMs: number;
  private readonly budget: RestartBudget;
  /** The in-flight harness start; concurrent callers share it (and its budget slot). */
  private connecting: Promise<ZcodeConnection> | null = null;
  /** Whether the bridge started a harness before: every later start is a restart. */
  private startedOnce = false;
  /** Bumped by stop(): a start still waiting out its backoff is abandoned. */
  private generation = 0;
  private lastExit: { at: number; code: number | null; signal: string | null } | null = null;
  private exhaustedLogged = false;

  constructor(config: BridgeConfig, runtimeInfo: RuntimeInfo, interactions: InteractionManager) {
    this.config = config;
    this.runtimeInfo = runtimeInfo;
    this.interactions = interactions;
    this.requestTimeoutMs = config.defaultRequestTimeoutMs;
    this.budget = new RestartBudget(config.restartBudget.limit, config.restartBudget.windowSec * 1000);
  }

  get info(): RuntimeInfo {
    return this.runtimeInfo;
  }

  setCrashHandler(fn: () => void): void {
    this.onCrash = fn;
  }

  onEvent(fn: (evt: HarnessEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onReverseRequest(fn: (ctx: ReverseRequestContext) => void): () => void {
    this.reverseListeners.add(fn);
    return () => this.reverseListeners.delete(fn);
  }

  get running(): boolean {
    return this.connection?.running ?? false;
  }

  /** The running connection, or a started one (a restart under the budget). */
  private connect(): Promise<ZcodeConnection> {
    const current = this.connection;
    if (current && current.running) return Promise.resolve(current);
    if (!this.connecting) {
      this.connecting = this.startConnection().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async startConnection(): Promise<ZcodeConnection> {
    const generation = this.generation;
    if (this.startedOnce) {
      const now = Date.now();
      const slot = this.budget.reserve(now);
      if (slot === null) throw this.budgetExhausted(now);
      this.exhaustedLogged = false;
      const waitMs = Math.max(0, (this.lastExit?.at ?? now) + slot.backoffMs - now);
      events.warn("harness restart", {
        restart: slot.restart,
        budget: this.budget.limit,
        windowSec: this.config.restartBudget.windowSec,
        backoffMs: waitMs,
        lastExitCode: this.lastExit?.code,
        lastExitSignal: this.lastExit?.signal ?? undefined,
      });
      // Unref'd: a shutdown during the backoff is not held open by it.
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref());
      if (generation !== this.generation) throw new ZcodeConnectionError("STOPPED", "harness connection was stopped");
    }
    this.startedOnce = true;
    const conn = this.newConnection();
    this.connection = conn;
    await conn.start();
    return conn;
  }

  private budgetExhausted(now: number): ZcodeConnectionError {
    const { limit, windowSec } = this.config.restartBudget;
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
    return new ZcodeConnectionError(
      "HARNESS_RESTART_BUDGET_EXHAUSTED",
      `HARNESS_RESTART_BUDGET_EXHAUSTED: ${what}; the bridge does not start it again ${until} ` +
        `(restart budget ${limit} per ${window}, ZCODE_HARNESS_RESTART_BUDGET). ` +
        `Next: run zcode_health and check runtime.restartBudget.lastExit and the bridge's stderr log for why the harness exits, ` +
        `fix that, then restart the MCP server${retryIso === null ? "" : ` (or retry after ${retryIso})`}.`,
    );
  }

  private newConnection(): ZcodeConnection {
    const conn = new ZcodeConnection({
      harnessPath: this.runtimeInfo.harnessPath,
      bundledProviderConfigPath: this.runtimeInfo.bundledProviderConfigPath,
      cwd: path.dirname(this.config.dataDir + path.sep) , // stable neutral cwd (data dir parent)
      requestTimeoutMs: this.requestTimeoutMs,
      onNotification: (method, params) => this.dispatchNotification(method, params),
      onReverseRequest: (ctx) => this.handleReverseRequest(ctx),
      onExit: (code, signal) => {
        if (this.connection !== conn) return;
        this.lastExit = { at: Date.now(), code, signal };
        this.connection = null;
        log.warn("harness exited; notifying crash handler");
        this.onCrash?.();
      },
    });
    return conn;
  }

  private dispatchNotification(method: string, params: unknown): void {
    const evt: HarnessEvent = {
      channel: method === "session/event" ? "session/event" : method === "state.updated" ? "state.updated" : "other",
      method,
      params: (params ?? {}) as Record<string, unknown>,
    };
    for (const fn of this.eventListeners) {
      try {
        fn(evt);
      } catch (err) {
        log.error("event listener threw", { error: String(err) });
      }
    }
  }

  private handleReverseRequest(ctx: ReverseRequestContext): void {
    const params = (ctx.params ?? {}) as Record<string, unknown>;
    // Let task-level listeners try first (they can attribute interactions to
    // tasks); if none of them answers, fall back to the InteractionManager.
    for (const fn of this.reverseListeners) {
      let handled = false;
      try {
        handled = fn(ctx) === true;
      } catch (err) {
        log.error("reverse listener threw", { error: String(err) });
      }
      if (handled) return;
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
        workspace: typeof params.workspace === "object" && params.workspace !== null ? String((params.workspace as Record<string, unknown>).workspacePath ?? "") : null,
        taskId: null,
        readOnlyMode: this.config.readOnly,
      });
      if (decision.auto !== null) {
        ctx.reply(decision.auto.result);
      } else if (!decision.needsAgent) {
        ctx.replyError(-32601, `bridge does not support ${ctx.method}`);
      } else {
        // Registered as pending; without a task context there is nobody to
        // answer, so the timeout policy will deny it.
        ctx.replyError(-32001, `interaction ${ctx.method} registered but requires an agent response via zcode_interaction_respond`);
      }
    } catch (err) {
      log.error("failed to register interaction", { error: String(err) });
      ctx.replyError(-32603, "bridge interaction handling failed");
    }
  }

  async start(): Promise<void> {
    await this.connect();
  }

  async restart(): Promise<void> {
    if (this.restarting) return this.restarting;
    this.restarting = (async () => {
      this.stop();
      await this.start();
    })();
    try {
      await this.restarting;
    } finally {
      this.restarting = null;
    }
  }

  /** Calls already dispatched may have taken effect even if their reply is lost. */
  async call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const conn = await this.connect();
    try {
      return await conn.call<T>(method, params, timeoutMs);
    } catch (err) {
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
  async readWorkspaceCatalog(workspacePath: string): Promise<Record<string, unknown>> {
    if (this.config.readOnly) throw new Error("READ_ONLY_MODE: full catalog discovery requires a deferred native session; use workspace/readPresentation for a pure read");
    const snapshot = await this.callForWorkspace<Record<string, unknown>>("session/create", workspacePath, {
      persistence: "deferred",
      mode: "plan",
      titleGenerationEnabled: false,
      toolAllowlist: [],
    }, 90_000);
    const session = snapshot.session as Record<string, unknown> | undefined;
    const sessionId = parseSessionId(session?.sessionId);
    if (!sessionId) throw new Error("INVALID_NATIVE_RESPONSE: catalog session has no valid sessionId");
    try {
      const settings = snapshot.settings as Record<string, unknown> | undefined;
      const model = settings?.model as Record<string, unknown> | undefined;
      const available = model?.available;
      if (!settings || !Array.isArray(available)) {
        throw new Error("INVALID_NATIVE_RESPONSE: session/create omitted the model catalog");
      }
      return { modelCatalog: { available }, source: "session/create (deferred, no prompt)" };
    } finally {
      const closed = await this.call<{ closed?: boolean }>("session/close", { sessionId, expectedPersistence: "deferred" });
      if (closed.closed !== true) throw new Error("CATALOG_SESSION_NOT_CLOSED: native deferred-session guard refused cleanup");
    }
  }

  /** Workspace-scoped call helper. */
  callForWorkspace<T = unknown>(method: string, workspacePath: string, extra?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    return this.call<T>(method, { workspace: workspaceRef(workspacePath), ...extra }, timeoutMs);
  }

  // ---------------------------------------------------------------------------
  // Typed IPC façade. Every method below is local stdio IPC with the harness
  // child process — there is no HTTP/network I/O anywhere in this class.
  // Session ids are validated with parseSessionId before use.

  async ipcSessionCreate(workspacePath: string, mode: string | null, timeoutMs = 90_000): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>(
      "session/create",
      { workspace: workspaceRef(workspacePath), ...(mode ? { mode } : {}) },
      timeoutMs
    );
  }

  async ipcSessionSubscribe(sessionId: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/subscribe", { sessionId: sid, deliveryKind: "desktop-continuous" });
  }

  async ipcSessionSend(sessionId: string, content: string, extra?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/send", { sessionId: sid, content, ...extra });
  }

  async ipcSessionRead(sessionId: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/read", { sessionId: sid });
  }

  /** Read the stored conversation transcript of a session (local IPC). */
  async ipcSessionTranscript(sessionId: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/messages", { sessionId: sid });
  }

  async ipcSessionUsage(sessionId: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/usage", { sessionId: sid });
  }

  async ipcSessionStop(sessionId: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/stop", { sessionId: sid });
  }

  async ipcSessionSetModel(sessionId: string, providerId: string, modelId: string, thoughtLevel?: string | null): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/setModel", {
      sessionId: sid,
      model: { providerId, modelId, ...(thoughtLevel == null ? {} : { options: { reasoningLevel: thoughtLevel } }) },
    });
  }

  async ipcSessionSetMode(sessionId: string, mode: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/setMode", { sessionId: sid, mode });
  }

  async ipcSessionSetThoughtLevel(sessionId: string, thoughtLevel: string): Promise<Record<string, unknown>> {
    const sid = parseSessionId(sessionId);
    if (!sid) throw new Error("invalid session id");
    return this.call<Record<string, unknown>>("session/setThoughtLevel", { sessionId: sid, thoughtLevel });
  }

  stop(): void {
    this.generation += 1;
    const conn = this.connection;
    this.connection = null;
    conn?.stop();
  }

  /** Live diagnostics for zcode_health. */
  diagnostics(): Record<string, unknown> {
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
  restartBudgetState(): Record<string, unknown> {
    const now = Date.now();
    const retryAt = this.budget.retryAt(now);
    const used = this.budget.used(now);
    return {
      limit: this.budget.limit,
      windowSec: this.config.restartBudget.windowSec,
      used,
      exhausted: used >= this.budget.limit,
      retryAt: retryAt === null ? null : new Date(retryAt).toISOString(),
      lastExit: this.lastExit ? { at: new Date(this.lastExit.at).toISOString(), code: this.lastExit.code, signal: this.lastExit.signal } : null,
    };
  }
}
