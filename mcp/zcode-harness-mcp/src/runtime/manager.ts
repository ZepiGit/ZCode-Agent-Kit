/**
 * RuntimeManager — owns the single app-server connection, routes reverse
 * requests to the InteractionManager and notifications to subscribers, and
 * restarts the harness on unexpected exit (running tasks are marked
 * interrupted by the TaskManager via onCrash).
 */
import path from "node:path";
import { ZcodeConnection, ZcodeConnectionError, type ReverseRequestContext } from "../protocol/connection.js";
import { workspaceRef, parseSessionId } from "../protocol/types.js";
import type { InteractionManager } from "../interactions/manager.js";
import type { RuntimeInfo } from "../discovery.js";
import type { BridgeConfig } from "../config.js";
import { createLogger } from "../util/log.js";

const log = createLogger("runtime");

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

  constructor(config: BridgeConfig, runtimeInfo: RuntimeInfo, interactions: InteractionManager) {
    this.config = config;
    this.runtimeInfo = runtimeInfo;
    this.interactions = interactions;
    this.requestTimeoutMs = config.defaultRequestTimeoutMs;
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

  private ensureConnection(): ZcodeConnection {
    if (this.connection && this.connection.running) return this.connection;
    const conn = new ZcodeConnection({
      harnessPath: this.runtimeInfo.harnessPath,
      bundledProviderConfigPath: this.runtimeInfo.bundledProviderConfigPath,
      cwd: path.dirname(this.config.dataDir + path.sep) , // stable neutral cwd (data dir parent)
      requestTimeoutMs: this.requestTimeoutMs,
      onNotification: (method, params) => this.dispatchNotification(method, params),
      onReverseRequest: (ctx) => this.handleReverseRequest(ctx),
      onExit: () => {
        if (this.connection !== conn) return;
        this.connection = null;
        log.warn("harness exited; notifying crash handler");
        this.onCrash?.();
      },
    });
    this.connection = conn;
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
    const conn = this.ensureConnection();
    await conn.start();
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
    const conn = this.ensureConnection();
    if (!conn.running) {
      await conn.start();
    }
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
    };
  }
}
