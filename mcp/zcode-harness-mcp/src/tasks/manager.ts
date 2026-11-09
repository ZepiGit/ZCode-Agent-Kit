/**
 * TaskManager — persistent tasks driving real harness turns.
 *
 * State machine:
 *   queued → starting → running → (waiting_for_input | waiting_for_approval)
 *          → completed | failed | cancelled | interrupted | unknown
 *
 * Responsibilities here are orchestration only (start / input / cancel /
 * result building). Event ingestion lives in tasks/ingress.ts, reverse-request
 * relaying in tasks/relay.ts. All harness communication goes through the
 * typed IPC façade on RuntimeManager (local stdio IPC).
 */
import { randomUUID } from "node:crypto";
import type { RuntimeManager } from "../runtime/manager.js";
import type { InteractionManager, InteractionRecord } from "../interactions/manager.js";
import type { JsonStore } from "../store/store.js";
import type { BridgeConfig } from "../config.js";
import { workspaceRef } from "../protocol/types.js";
import { WorkspaceAllowlist } from "../security/allowlist.js";
import { sessionInScope, workspaceIdentity } from "../security/session.js";
import { safeJsonStringify } from "../security/redact.js";
import { createLogger } from "../util/log.js";
import { TaskIngress, type IngressTask, type IngressTaskRecord, type IngressState } from "./ingress.js";
import { TaskRelay } from "./relay.js";

const log = createLogger("tasks");

export type TaskState = IngressState;

export const TERMINAL_STATES: TaskState[] = ["completed", "failed", "cancelled", "interrupted", "unknown"];

/**
 * Task retention (ADR-0009 correction 3): a terminal task is evicted when there
 * are more than 500 of them or it finished more than 7 days ago, whichever
 * comes first. Its files go with it and its idempotency key is forgotten, so
 * the idempotency window equals the retention. Non-terminal tasks are never
 * evicted. `unknown` counts as non-terminal here: execution could not be
 * confirmed, and every slot, session and workspace guard still treats it as
 * active (those are bounded by the task queue limit instead).
 */
export const TASK_RETENTION = Object.freeze({ maxTerminalTasks: 500, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
const EVICTABLE_STATES: TaskState[] = ["completed", "failed", "cancelled", "interrupted"];

type RetainedRecord = { taskId: string; state: TaskState; finishedAt: string | null; createdAt: string };

/** Finish time in ms (createdAt when missing); an unreadable time counts as oldest. */
function finishedMs(rec: RetainedRecord): number {
  const at = Date.parse(rec.finishedAt ?? rec.createdAt);
  if (Number.isFinite(at)) return at;
  const created = Date.parse(rec.createdAt);
  return Number.isFinite(created) ? created : -Infinity;
}

/** Ids to evict at `now`: the oldest terminal tasks beyond the count, plus every terminal task past the age limit. */
function retentionVictims(records: readonly RetainedRecord[], now: number): string[] {
  const cutoff = now - TASK_RETENTION.maxAgeMs;
  const evictable = records.filter((rec) => EVICTABLE_STATES.includes(rec.state)).map((rec) => ({ rec, at: finishedMs(rec) }));
  evictable.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1) || a.rec.createdAt.localeCompare(b.rec.createdAt) || a.rec.taskId.localeCompare(b.rec.taskId));
  const excess = evictable.length - TASK_RETENTION.maxTerminalTasks;
  return evictable.filter((e, i) => i < excess || e.at < cutoff).map((e) => e.rec.taskId);
}

/** Every file a task owns in the store; the record goes last, so an interrupted prune is redone at the next start. */
const TASK_FILE_SUFFIXES = [".result.json", ".events.jsonl", ".events.jsonl.previous", ".json"];

const READ_ONLY_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell", "BashOutput", "KillShell"];

export interface TaskRecord extends IngressTaskRecord {
  schemaVersion: 1;
  idempotencyKey: string | null;
  workspaceKey: string;
  sessionOwnedByTask: boolean;
  prompt: string;
  mode: string | null;
  requestedModel: string | null;
  effectiveModel: { providerId: string; modelId: string } | null;
  thoughtLevel: string | null;
  // Missing on older persisted records; absence is not proof of selection.
  selectionVerified?: boolean;
  createdAt: string;
  startedAt: string | null;
  followUpCount: number;
  interruptionReason: string | null;
}

export interface FileChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
  source: "tool_events" | "none";
  preExistingUncommitted: string[];
}

export interface TaskEventRecord {
  seq: number;
  ts: string;
  type: string;
  payload: unknown;
  origin: "harness" | "bridge";
}

export interface TaskResultV1 {
  schemaVersion: 1;
  taskId: string;
  sessionId: string;
  workspacePath: string;
  status: TaskState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedModel: string | null;
  effectiveModel: { providerId: string; modelId: string } | null;
  mode: string | null;
  thoughtLevel: string | null;
  responseText: string;
  partial: boolean;
  completeness: { status: "full" | "partial" | "unknown"; explanation: string };
  usage: {
    cumulative: { totalTokens: number; inputTokens: number; outputTokens: number; reasoningTokens: number } | null;
    note: string;
  };
  toolCalls: Array<{ toolName: string; summary: string }>;
  fileChanges: FileChangeSet;
  artifacts: Array<{ path: string; bytes: number; sha256: string | null }>;
  interactions: Array<{ id: string; kind: string; status: string; toolName: string | null }>;
  errors: string[];
  warnings: string[];
  eventsRef: { firstSeq: number; lastSeq: number; storage: string };
}

export interface StartTaskParams {
  workspacePath: string;
  workspaceKey: string;
  prompt: string;
  sessionId?: string | null;
  model?: { providerId: string; modelId: string } | null;
  thoughtLevel?: string | null;
  mode?: string | null;
  readOnly?: boolean;
  idempotencyKey?: string | null;
}

interface TaskInternal extends IngressTask<TaskRecord> {
  errors: string[];
  inputPending: boolean;
  pendingSend: Promise<Record<string, unknown>> | null;
  /** Counted in the manager's retention index as evictable. */
  retentionCounted: boolean;
}

export class TaskError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
  }
}

export class TaskManager {
  private readonly runtime: RuntimeManager;
  private readonly interactions: InteractionManager;
  private readonly store: JsonStore;
  private readonly config: BridgeConfig;
  private readonly allowlist: WorkspaceAllowlist;
  readonly ingress: TaskIngress<TaskRecord>;
  private readonly relay: TaskRelay;
  private readonly tasks = new Map<string, TaskInternal>();
  private readonly byIdempotency = new Map<string, string>();
  private readonly bySession = new Map<string, string>();
  private readonly startQueue = new Map<string, StartTaskParams>();
  private readonly clock: () => number;
  /**
   * Retention index, so that the check on every request is O(1) instead of a
   * scan of every retained task (a scan per request is garbage that grows with
   * the retained set). `evictableCount` is the exact number of retained tasks
   * in an evictable state; `oldestEvictableMs` is a lower bound of their finish
   * times. Every change of a record goes through `persist()`, which updates
   * both; a task leaving an evictable state can leave the bound too low, which
   * costs one scan that recomputes it, never a missed eviction.
   */
  private evictableCount = 0;
  private oldestEvictableMs = Infinity;

  constructor(runtime: RuntimeManager, interactions: InteractionManager, store: JsonStore, config: BridgeConfig, clock: () => number = () => Date.now()) {
    this.runtime = runtime;
    this.interactions = interactions;
    this.store = store;
    this.config = config;
    this.clock = clock;
    this.allowlist = new WorkspaceAllowlist([...config.allowWorkspaces, store.ensureDir("workspaces")]);
    this.ingress = new TaskIngress<TaskRecord>(runtime, store);
    this.relay = new TaskRelay(interactions, this.ingress, config.interactionTimeoutSec);
  }

  /** Wire this manager to the runtime event/reverse-request streams. */
  attach(): { onEvent: (evt: { channel: string; method: string; params: Record<string, unknown> }) => void; onReverseRequest: (ctx: { method: string; params: unknown; reply: (r: unknown) => void; replyError: (c: number, m: string) => void }) => boolean } {
    return {
      onEvent: (evt) => this.ingress.handleEvent(evt),
      onReverseRequest: (ctx) => this.relay.handleReverseRequest(ctx),
    };
  }

  /** Load persisted tasks. Non-terminal states become `interrupted` — never
   * auto-completed; the harness state is not re-verified on restart. Only the
   * tasks within the retention are loaded; the files of the others are pruned
   * (the retention migration: a no-op when run again). */
  restore(): number {
    const files = this.store.listFiles("tasks");
    const loaded: Array<{ file: string; rec: TaskRecord; interrupted: boolean }> = [];
    for (const f of files) {
      // Only plain task records: task-<id>.json (not .result.json snapshots).
      if (!/^task-[A-Za-z0-9-]+\.json$/.test(f)) continue;
      const rec = this.store.readJson<TaskRecord>(`tasks/${f}`);
      if (!rec || rec.schemaVersion !== 1 || !this.allowlist.isAllowed(rec.workspacePath)) continue;
      const interrupted = !TERMINAL_STATES.includes(rec.state);
      if (interrupted) {
        rec.state = "interrupted";
        rec.interruptionReason = "bridge restart; harness state not re-verified";
        rec.finishedAt = rec.finishedAt ?? new Date(this.clock()).toISOString();
      }
      loaded.push({ file: f, rec, interrupted });
    }
    const victims = new Set(retentionVictims(loaded.map((l) => l.rec), this.clock()));
    for (const { file, rec } of loaded) {
      if (!victims.has(rec.taskId)) continue;
      this.deleteTaskFiles(rec.taskId);
      this.store.deleteFile(`tasks/${file}`);
    }
    let n = 0;
    for (const { file, rec, interrupted } of loaded) {
      if (victims.has(rec.taskId)) continue;
      if (interrupted) this.store.writeJson(`tasks/${file}`, rec);
      this.tasks.set(rec.taskId, this.internalFromRecord(rec));
      if (rec.idempotencyKey) this.byIdempotency.set(rec.idempotencyKey, rec.taskId);
      if (rec.sessionId) this.bySession.set(rec.sessionId, rec.taskId);
      n += 1;
    }
    if (n > 0) log.info("restored tasks from store", victims.size > 0 ? { count: n, evicted: victims.size } : { count: n });
    this.reindexRetention();
    this.syncIngress();
    return n;
  }

  /** Recount the retention index from the retained tasks (restore, and after a scan). */
  private reindexRetention(): void {
    let count = 0;
    let oldest = Infinity;
    for (const t of this.tasks.values()) {
      t.retentionCounted = EVICTABLE_STATES.includes(t.record.state);
      if (!t.retentionCounted) continue;
      count += 1;
      oldest = Math.min(oldest, finishedMs(t.record));
    }
    this.evictableCount = count;
    this.oldestEvictableMs = oldest;
  }

  /** Update the retention index for one task after its record changed. */
  private noteRetention(t: TaskInternal): void {
    const evictable = EVICTABLE_STATES.includes(t.record.state);
    if (evictable !== t.retentionCounted) {
      this.evictableCount += evictable ? 1 : -1;
      t.retentionCounted = evictable;
    }
    if (evictable) this.oldestEvictableMs = Math.min(this.oldestEvictableMs, finishedMs(t.record));
  }

  private deleteTaskFiles(taskId: string): void {
    // Only ids the bridge mints; a hand-edited record cannot aim the prune elsewhere.
    if (!/^task-[A-Za-z0-9-]+$/.test(taskId)) return;
    for (const suffix of TASK_FILE_SUFFIXES) this.store.deleteFile(`tasks/${taskId}${suffix}`);
  }

  /** Evict the terminal tasks beyond the retention (memory, files, idempotency key). */
  private enforceRetention(): void {
    const now = this.clock();
    // O(1) on every request: nothing can be beyond the retention unless the index says so.
    if (this.evictableCount <= TASK_RETENTION.maxTerminalTasks && this.oldestEvictableMs >= now - TASK_RETENTION.maxAgeMs) return;
    const victims = retentionVictims([...this.tasks.values()].map((t) => t.record), now);
    for (const taskId of victims) {
      const t = this.tasks.get(taskId);
      if (!t) continue;
      this.tasks.delete(taskId);
      this.startQueue.delete(taskId);
      const rec = t.record;
      if (rec.idempotencyKey && this.byIdempotency.get(rec.idempotencyKey) === taskId) this.byIdempotency.delete(rec.idempotencyKey);
      if (rec.sessionId && this.bySession.get(rec.sessionId) === taskId) this.bySession.delete(rec.sessionId);
      this.deleteTaskFiles(taskId);
    }
    this.reindexRetention();
    if (victims.length > 0) this.syncIngress();
  }

  private internalFromRecord(rec: TaskRecord): TaskInternal {
    const t: TaskInternal = {
      record: rec,
      turnRevision: 0,
      acceptingEvents: false,
      inputPending: false,
      pendingSend: null,
      accumulatedText: "",
      toolCalls: new Map(),
      artifacts: new Map(),
      interactionIds: new Set(),
      warnings: [],
      errors: rec.error ? [rec.error] : [],
      retentionCounted: false,
      persist: () => {
        this.store.writeJson(`tasks/${rec.taskId}.json`, rec);
        this.noteRetention(t);
      },
      onTerminal: () => {
        this.drainQueue();
        // Persist the structured result eagerly so it survives restarts.
        void this.buildResult(rec.taskId).catch(() => {
          /* best effort; buildResult can be retried via zcode_task_result */
        });
        this.enforceRetention();
      },
    };
    return t;
  }

  /** The task, if retained; every lookup first applies the retention. */
  private lookup(taskId: string): TaskInternal | undefined {
    this.enforceRetention();
    return this.tasks.get(taskId);
  }

  private syncIngress(): void {
    this.ingress.syncTasks(this.tasks.values(), this.bySession);
  }

  get(taskId: string): TaskRecord | null {
    return this.lookup(taskId)?.record ?? null;
  }

  list(filter?: { workspace?: string; state?: TaskState }): TaskRecord[] {
    this.enforceRetention();
    let all = [...this.tasks.values()].map((t) => t.record);
    if (filter?.workspace) {
      const norm = filter.workspace.replace(/[\\/]+$/, "");
      all = all.filter((t) => t.workspacePath === norm);
    }
    if (filter?.state) all = all.filter((t) => t.state === filter.state);
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  events(taskId: string, afterSeq: number, limit: number): { items: TaskEventRecord[]; nextSeq: number; hasMore: boolean } {
    const t = this.lookup(taskId);
    if (!t) throw new TaskError("TASK_NOT_FOUND", `unknown task: ${taskId}`);
    const res = this.store.readLinesAfter(`tasks/${taskId}.events.jsonl`, afterSeq, limit);
    return { items: res.items as TaskEventRecord[], nextSeq: res.nextSeq, hasMore: res.hasMore };
  }

  /** Bounded wait for a terminal (or requested) state. */
  async wait(taskId: string, timeoutMs: number, until?: TaskState[]): Promise<TaskRecord> {
    const start = Date.now();
    for (let first = true; ; first = false) {
      const t = first ? this.lookup(taskId) : this.tasks.get(taskId);
      if (!t) throw new TaskError("TASK_NOT_FOUND", `unknown task: ${taskId}`);
      if (TERMINAL_STATES.includes(t.record.state)) return t.record;
      if (until && until.includes(t.record.state)) return t.record;
      if (Date.now() - start >= timeoutMs) return t.record;
      await new Promise((r) => setTimeout(r, Math.min(250, Math.max(50, Math.floor(timeoutMs / 20)))));
    }
  }

  /**
   * Start a task. Idempotent on idempotencyKey. When the concurrency limit is
   * reached the task is created as `queued` and promoted by the scheduler.
   */
  private async verifySessionWorkspace(sessionId: string, workspacePath: string): Promise<void> {
    const actual = await sessionInScope(this.runtime, this.allowlist, sessionId);
    const requested = this.allowlist.enforce(workspacePath);
    if (workspaceIdentity(actual.workspacePath) !== workspaceIdentity(requested)) throw new TaskError("WORKSPACE_MISMATCH", "session belongs to a different workspace");
  }

  async startTask(params: StartTaskParams): Promise<TaskRecord> {
    this.allowlist.enforce(params.workspacePath);
    if (params.mode === "yolo" && !this.config.allowYolo) throw new TaskError("MODE_NOT_PERMITTED", "yolo requires operator --allow-yolo");
    if (params.sessionId) await this.verifySessionWorkspace(params.sessionId, params.workspacePath);
    if (params.idempotencyKey) {
      const existing = this.byIdempotency.get(params.idempotencyKey);
      if (existing) {
        const rec = this.get(existing);
        if (rec) {
          this.allowlist.enforce(rec.workspacePath);
          if (workspaceIdentity(rec.workspacePath) !== workspaceIdentity(params.workspacePath)) throw new TaskError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to a different workspace");
          return rec;
        }
      }
    }
    if (params.sessionId && this.list().some(t => t.sessionId === params.sessionId && (!TERMINAL_STATES.includes(t.state) || t.state === "unknown"))) {
      throw new TaskError("SESSION_BUSY", "session already has an active task");
    }
    const activeCount = this.list().filter((t) => !TERMINAL_STATES.includes(t.state) || t.state === "unknown").length;
    if (activeCount >= this.config.taskQueueLimit) {
      throw new TaskError("QUEUE_LIMIT", `task queue limit reached (${this.config.taskQueueLimit})`);
    }
    // Guard against concurrent WRITE jobs in the same workspace: two
    // non-read-only tasks may not run in parallel in one workspace (use
    // isolated workspaces, mark tasks readOnly, or wait for the running one).
    const requestedReadOnly = params.readOnly ?? this.config.readOnly;
    if (!requestedReadOnly) {
      const conflicting = this.list().find(
        (t) => workspaceIdentity(t.workspacePath) === workspaceIdentity(params.workspacePath) && (!TERMINAL_STATES.includes(t.state) || t.state === "unknown") && !t.readOnly
      );
      if (conflicting) {
        throw new TaskError(
          "WORKSPACE_BUSY",
          `WORKSPACE_BUSY: workspace already has a running write task (${conflicting.taskId}, state=${conflicting.state}); use isolated workspaces, readOnly:true, or cancel the running task first`
        );
      }
    }
    const rec: TaskRecord = {
      schemaVersion: 1,
      taskId: "task-" + randomUUID().slice(0, 12),
      idempotencyKey: params.idempotencyKey ?? null,
      workspacePath: params.workspacePath,
      workspaceKey: params.workspaceKey,
      sessionId: params.sessionId ?? "",
      sessionOwnedByTask: !params.sessionId,
      prompt: params.prompt,
      state: "queued",
      readOnly: params.readOnly ?? this.config.readOnly,
      mode: params.mode ?? null,
      requestedModel: params.model ? `${params.model.providerId}/${params.model.modelId}` : null,
      effectiveModel: null,
      thoughtLevel: params.thoughtLevel ?? null,
      selectionVerified: false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      lastSeq: 0,
      followUpCount: 0,
      error: null,
      usage: null,
      fileChanges: { added: [], modified: [], deleted: [], source: "none", preExistingUncommitted: [] },
      interruptionReason: null,
    };
    const t = this.internalFromRecord(rec);
    this.tasks.set(rec.taskId, t);
    if (rec.idempotencyKey) this.byIdempotency.set(rec.idempotencyKey, rec.taskId);
    t.persist();
    this.syncIngress();
    this.scheduleStart(t, params);
    return rec;
  }

  private activeCount(): number {
    return this.list().filter((r) => r.state !== "queued" && (!TERMINAL_STATES.includes(r.state) || r.state === "unknown")).length;
  }

  private scheduleStart(t: TaskInternal, params: StartTaskParams): void {
    this.startQueue.set(t.record.taskId, params);
    this.drainQueue();
  }

  private drainQueue(): void {
    for (const [taskId, params] of this.startQueue) {
      const t = this.tasks.get(taskId);
      if (!t || t.record.state !== "queued") {
        this.startQueue.delete(taskId);
        continue;
      }
      if (this.activeCount() >= this.config.maxConcurrentTasks) break;
      this.startQueue.delete(taskId);
      void this.startNow(t, params);
    }
  }

  private async verifySelection(t: TaskInternal): Promise<TaskRecord["effectiveModel"]> {
    const rec = t.record;
    let effectiveModel: TaskRecord["effectiveModel"] = null;
    let effectiveThoughtLevel: unknown = null;
    try {
      const readBack = await this.runtime.ipcSessionRead(rec.sessionId);
      const settings = (readBack?.settings ?? {}) as Record<string, unknown>;
      const model = (settings.model ?? {}) as Record<string, unknown>;
      const current = (model.current ?? {}) as Record<string, unknown>;
      if (typeof current.providerId === "string" && typeof current.modelId === "string") {
        effectiveModel = { providerId: current.providerId, modelId: current.modelId };
      }
      const thought = (settings.thoughtLevel ?? settings.reasoning ?? {}) as Record<string, unknown>;
      effectiveThoughtLevel = thought.current ?? null;
    } catch (err) {
      if (rec.requestedModel !== null || rec.thoughtLevel !== null) {
        throw new TaskError("SELECTION_VERIFICATION_FAILED", `cannot verify requested model/reasoning before sending prompt: ${err instanceof Error ? err.message : String(err)}`);
      }
      t.warnings.push(`session read before send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (rec.requestedModel !== null) {
      const slash = rec.requestedModel.indexOf("/");
      if (effectiveModel?.providerId !== rec.requestedModel.slice(0, slash) || effectiveModel?.modelId !== rec.requestedModel.slice(slash + 1)) {
        throw new TaskError("MODEL_MISMATCH", `requested model ${rec.requestedModel} differs from effective model ${effectiveModel ? `${effectiveModel.providerId}/${effectiveModel.modelId}` : "unknown"}; prompt not sent`);
      }
    }
    if (rec.thoughtLevel !== null && effectiveThoughtLevel !== rec.thoughtLevel) {
      throw new TaskError("THOUGHT_LEVEL_MISMATCH", `requested reasoning level ${rec.thoughtLevel} differs from effective reasoning level ${String(effectiveThoughtLevel)}; prompt not sent`);
    }
    return effectiveModel;
  }

  private async startNow(t: TaskInternal, params: StartTaskParams): Promise<void> {
    const rec = t.record;
    if (rec.state !== "queued") return;
    const stillStarting = () => this.get(rec.taskId)?.state === "starting";
    try {
      rec.state = "starting";
      t.persist();
      await this.runtime.start();
      if (!stillStarting()) return;

      let sessionId = "";
      if (params.sessionId) {
        await this.verifySessionWorkspace(params.sessionId, rec.workspacePath);
        if (!stillStarting()) return;
        sessionId = params.sessionId;
      } else {
        const createResult = await this.runtime.ipcSessionCreate(rec.workspacePath, rec.mode);
        const session = (createResult?.session ?? {}) as Record<string, unknown>;
        const id = typeof session.sessionId === "string" ? session.sessionId : "";
        if (!id.startsWith("sess_")) {
          throw new TaskError("CREATE_FAILED", `session/create returned no usable sessionId: ${safeJsonStringify(createResult).slice(0, 300)}`);
        }
        sessionId = id;
      }
      if (!stillStarting()) {
        if (!params.sessionId) void this.runtime.call("session/close", { sessionId }).catch(() => {});
        return;
      }
      rec.sessionId = sessionId;
      this.bySession.set(sessionId, rec.taskId);
      rec.startedAt = new Date().toISOString();
      this.syncIngress();

      if (params.model) {
        try {
          await this.runtime.ipcSessionSetModel(sessionId, params.model.providerId, params.model.modelId, params.thoughtLevel);
        } catch (err) {
          throw new TaskError(
            "MODEL_SET_FAILED",
            `selecting ${params.model.providerId}/${params.model.modelId} failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      } else if (params.thoughtLevel != null) {
        try {
          await this.runtime.ipcSessionSetThoughtLevel(sessionId, params.thoughtLevel);
        } catch (err) {
          throw new TaskError("THOUGHT_LEVEL_SET_FAILED", `setThoughtLevel failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const mode = rec.readOnly ? "plan" : rec.mode ?? (this.config.allowYolo ? null : "build");
      if (mode) await this.runtime.ipcSessionSetMode(sessionId, mode);
      if (!stillStarting()) return;

      // The persisted marker is evidence of startup verification, not a substitute
      // for reading the current selection again before a terminal follow-up.
      const effectiveModel = await this.verifySelection(t);
      if (!stillStarting()) return;
      rec.effectiveModel = effectiveModel;
      rec.selectionVerified = true;
      t.persist();

      const subscription = await this.runtime.ipcSessionSubscribe(sessionId);
      if (typeof subscription.eventSeq === 'number') rec.lastSeq = Math.max(rec.lastSeq, subscription.eventSeq);

      if (!stillStarting()) return;
      const denylist = rec.readOnly ? { toolDenylist: READ_ONLY_TOOLS } : {};
      t.turnRevision += 1;
      t.acceptingEvents = true;
      t.pendingSend = this.runtime.ipcSessionSend(sessionId, params.prompt, denylist);
      const sendResult = await t.pendingSend.finally(() => { t.pendingSend = null; });
      if (sendResult?.accepted !== true) {
        throw new TaskError("SEND_REJECTED", `prompt not accepted: ${safeJsonStringify(sendResult).slice(0, 300)}`);
      }
      if (stillStarting()) { rec.state = "running"; t.persist(); }
    } catch (err) {
      if (!stillStarting()) return;
      if (rec.sessionOwnedByTask && rec.sessionId && this.runtime.running) void this.runtime.call('session/close', { sessionId: rec.sessionId }).catch(() => {});
      rec.state = "failed";
      rec.error = err instanceof Error ? err.message : String(err);
      rec.finishedAt = new Date().toISOString();
      t.errors.push(rec.error);
      t.persist();
      t.onTerminal();
    }
  }

  /** Send additional input: steering while running, follow-up when terminal. */
  async addInput(taskId: string, content: string): Promise<TaskRecord> {
    const t = this.lookup(taskId);
    if (!t) throw new TaskError("TASK_NOT_FOUND", `unknown task: ${taskId}`);
    const rec = t.record;
    if (!rec.sessionId) throw new TaskError("NO_SESSION", "task has no session yet");
    if (t.inputPending || ["queued", "starting", "cancelling", "unknown"].includes(rec.state)) {
      throw new TaskError("TASK_BUSY", "task cannot accept input in its current state");
    }
    if (rec.mode === "yolo" && !this.config.allowYolo) throw new TaskError("MODE_NOT_PERMITTED", "yolo requires operator --allow-yolo");
    const restarting = TERMINAL_STATES.includes(rec.state);
    if (restarting && this.activeCount() >= this.config.maxConcurrentTasks) throw new TaskError("CONCURRENCY_LIMIT", "all task slots are in use");
    if (restarting && !rec.readOnly && this.list().some(other => other.taskId !== taskId && workspaceIdentity(other.workspacePath) === workspaceIdentity(rec.workspacePath) && !other.readOnly && (!TERMINAL_STATES.includes(other.state) || other.state === "unknown"))) {
      throw new TaskError("WORKSPACE_BUSY", "another write task is active in this workspace");
    }
    if (this.bySession.get(rec.sessionId) !== taskId) throw new TaskError("SESSION_BUSY", "session is owned by a newer task");
    if (restarting && (rec.requestedModel !== null || rec.thoughtLevel !== null) && rec.selectionVerified !== true) {
      throw new TaskError("SELECTION_NOT_VERIFIED", "task model/reasoning selection was never verified; start a new task with the requested selection; prompt not sent");
    }
    const previousState = rec.state;
    t.inputPending = true;
    if (restarting) rec.state = "starting";
    const revision = ++t.turnRevision;
    const canSend = () => t.turnRevision === revision && !["cancelling", "cancelled", "interrupted", "unknown"].includes(rec.state);
    let dispatched = false;
    try {
      await this.verifySessionWorkspace(rec.sessionId, rec.workspacePath);
      if (!canSend()) throw new TaskError("INTERRUPTED", "task interrupted before input was sent");
      const effectiveModel = restarting ? await this.verifySelection(t) : rec.effectiveModel;
      if (!canSend()) throw new TaskError("INTERRUPTED", "task interrupted before input was sent");
      const mode = rec.readOnly ? "plan" : rec.mode ?? (this.config.allowYolo ? null : "build");
      if (mode) await this.runtime.ipcSessionSetMode(rec.sessionId, mode);
      const subscription = await this.runtime.ipcSessionSubscribe(rec.sessionId);
      if (typeof subscription.eventSeq === "number") rec.lastSeq = Math.max(rec.lastSeq, subscription.eventSeq);
      if (!canSend()) throw new TaskError("INTERRUPTED", "task interrupted before input was sent");
      t.accumulatedText = "";
      t.errors = [];
      t.warnings = [];
      t.toolCalls.clear();
      t.artifacts.clear();
      rec.fileChanges = { added: [], modified: [], deleted: [], source: "none", preExistingUncommitted: [] };
      rec.usage = null;
      rec.finishedAt = null;
      rec.error = null;
      rec.interruptionReason = null;
      rec.effectiveModel = effectiveModel;
      rec.state = "starting";
      t.persist();
      dispatched = true;
      t.acceptingEvents = true;
      t.pendingSend = this.runtime.ipcSessionSend(rec.sessionId, content, rec.readOnly ? { toolDenylist: READ_ONLY_TOOLS } : {});
      const sendResult = await t.pendingSend.finally(() => { t.pendingSend = null; });
      if (sendResult?.accepted !== true) throw new TaskError("SEND_REJECTED", "follow-up prompt was not accepted");
      if (canSend()) {
        this.store.deleteFile(`tasks/${taskId}.result.json`);
        rec.followUpCount += 1;
        if (rec.state === "starting") rec.state = "running";
        t.persist();
      }
      return rec;
    } catch (err) {
      if (canSend()) {
        rec.state = dispatched ? "unknown" : previousState;
        if (dispatched) {
          rec.interruptionReason = "input acknowledgement failed; execution cannot be confirmed";
          rec.finishedAt = new Date().toISOString();
        }
        t.persist();
        this.drainQueue();
      }
      throw err;
    } finally {
      t.inputPending = false;
    }
  }

  /** Cancel a task. The wish only counts as cancelled after verification. */
  async cancel(taskId: string): Promise<TaskRecord> {
    const t = this.lookup(taskId);
    if (!t) throw new TaskError("TASK_NOT_FOUND", `unknown task: ${taskId}`);
    const rec = t.record;
    if (TERMINAL_STATES.includes(rec.state) && rec.state !== "unknown") return rec;
    if (rec.state === "queued" || (rec.state === "starting" && !t.pendingSend)) {
      this.startQueue.delete(taskId);
      t.turnRevision += 1;
      if (rec.sessionOwnedByTask && rec.sessionId) void this.runtime.call("session/close", { sessionId: rec.sessionId }).catch(() => {});
      rec.state = "cancelled";
      rec.finishedAt = new Date().toISOString();
      t.persist();
      t.onTerminal();
      return rec;
    }
    rec.state = "cancelling";
    t.turnRevision += 1;
    t.persist();
    try {
      if (t.pendingSend) await t.pendingSend.catch(() => {});
      if (rec.state !== "cancelling") return rec;
      await this.verifySessionWorkspace(rec.sessionId, rec.workspacePath);
      await this.runtime.ipcSessionStop(rec.sessionId);
    } catch (err) {
      t.warnings.push(`stop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    let stopped = false;
    for (let i = 0; i < 10 && !stopped; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, 500));
      if (rec.state !== "cancelling") return rec;
      try {
        const readBack = await this.runtime.ipcSessionRead(rec.sessionId);
        const projection = (readBack?.projection ?? {}) as Record<string, unknown>;
        const status = String(projection.status ?? "");
        const active = Array.isArray(projection.activeToolCalls) ? (projection.activeToolCalls as unknown[]).length : 0;
        if (status === "idle" && active === 0) stopped = true;
      } catch {
        /* harness may be restarting; keep polling */
      }
    }
    if (rec.state !== "cancelling") return rec;
    rec.state = stopped ? "cancelled" : "unknown";
    rec.interruptionReason = stopped ? null : "cancel could not be verified against the harness";
    rec.finishedAt = new Date().toISOString();
    t.warnings.push(stopped ? "cancel verified via session read" : "cancel NOT verified; task state unknown");
    t.persist();
    t.onTerminal();
    return rec;
  }

  // ------------------------------------------------------------------ result

  async buildResult(taskId: string): Promise<TaskResultV1> {
    const t = this.lookup(taskId);
    if (!t) throw new TaskError("TASK_NOT_FOUND", `unknown task: ${taskId}`);
    const rec = t.record;
    // Terminal results are persisted once and served from the store so they
    // survive bridge restarts (harness transcripts may be gone by then).
    const revision = t.turnRevision;
    const state = rec.state;
    const cached = this.store.readJson<TaskResultV1>(`tasks/${taskId}.result.json`);
    if (cached && cached.schemaVersion === 1 && cached.status === state && cached.finishedAt === rec.finishedAt && TERMINAL_STATES.includes(state)) {
      return cached;
    }
    if (rec.sessionId && rec.usage === null && this.runtime.running && TERMINAL_STATES.includes(rec.state)) {
      await this.ingress.captureUsage(t);
    }
    let responseText = t.accumulatedText;
    let completeness: TaskResultV1["completeness"] = responseText && state === "completed"
      ? { status: "full", explanation: "turn stream captured via session events" }
      : { status: "unknown", explanation: "no completed assistant response has been captured" };
    if (!responseText && rec.sessionId && rec.startedAt && this.runtime.running) {
      try {
        // Local IPC read of the stored assistant turn for this session.
        const transcript = await this.runtime.ipcSessionTranscript(rec.sessionId);
        const entries = Array.isArray(transcript?.messages) ? (transcript.messages as Array<Record<string, unknown>>) : [];
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          const entry = entries[i]!;
          const info = (entry.info ?? {}) as Record<string, unknown>;
          if (String(info.role ?? "") === "assistant") {
            const parts = (entry.parts ?? entry.content ?? []) as Array<Record<string, unknown>>;
            const texts = parts.filter((pt) => String(pt.type ?? "") === "text").map((pt) => String(pt.text ?? ""));
            responseText = texts.join("\n");
            if (responseText && state === "completed") completeness = { status: "full", explanation: "response recovered from stored transcript" };
            break;
          }
        }
      } catch (err) {
        completeness = { status: "unknown", explanation: `transcript read failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    if (revision !== t.turnRevision || state !== rec.state) throw new TaskError("TASK_CHANGED", "task changed while its result was being read; request the result again");
    if (t.warnings.some((warning) => warning.startsWith("event gap detected:"))) {
      completeness = { status: "partial", explanation: "session events were lost; captured output may be incomplete" };
    }
    if (["failed", "cancelled", "interrupted", "unknown"].includes(rec.state)) {
      completeness = { status: "partial", explanation: `task ended in state ${rec.state}` };
    }

    const toolCalls = [...t.toolCalls.entries()].map(([id, name]) => ({ toolName: name, summary: `toolCall ${id}` }));
    const interactionRecords: InteractionRecord[] = this.interactions
      .list("all")
      .filter((i) => i.taskId === taskId || (i.sessionId !== null && i.sessionId === rec.sessionId));
    const evs = this.events(taskId, -1, 1_000_000);
    const firstSeq = evs.items.length > 0 ? evs.items[0]!.seq : 0;
    const lastSeq = evs.items.length > 0 ? evs.items[evs.items.length - 1]!.seq : rec.lastSeq;

    const result: TaskResultV1 = {
      schemaVersion: 1,
      taskId,
      sessionId: rec.sessionId,
      workspacePath: rec.workspacePath,
      status: rec.state,
      createdAt: rec.createdAt,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt,
      requestedModel: rec.requestedModel,
      effectiveModel: rec.effectiveModel,
      mode: rec.mode,
      thoughtLevel: rec.thoughtLevel,
      responseText,
      partial: completeness.status !== "full",
      completeness,
      usage: rec.usage
        ? {
            cumulative: { ...rec.usage, reasoningTokens: 0 },
            note: "cumulative per session from the harness usage IPC; per-turn breakdown is not exposed by this harness version",
          }
        : {
            cumulative: null,
            note: "usage unavailable (usage IPC returned no data); null means missing, not zero",
          },
      toolCalls,
      fileChanges: rec.fileChanges,
      artifacts: [...t.artifacts.values()],
      interactions: interactionRecords.map((i) => ({ id: i.id, kind: i.kind, status: i.status, toolName: i.toolName })),
      errors: t.errors,
      warnings: t.warnings,
      eventsRef: { firstSeq, lastSeq, storage: `tasks/${taskId}.events.jsonl` },
    };
    if (TERMINAL_STATES.includes(rec.state)) {
      this.store.writeJson(`tasks/${taskId}.result.json`, result);
    }
    return result;
  }

  stopAll(reason = "bridge shutting down"): void {
    this.startQueue.clear();
    for (const t of this.tasks.values()) {
      if (!TERMINAL_STATES.includes(t.record.state) || t.record.state === "unknown") {
        t.turnRevision += 1;
        t.record.state = "interrupted";
        t.record.interruptionReason = reason;
        t.record.finishedAt = t.record.finishedAt ?? new Date().toISOString();
        t.persist();
      }
    }
  }
}
