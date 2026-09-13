/**
 * TaskIngress — harness event ingestion for the TaskManager.
 * Local stdio IPC only; session ids are validated before use and event
 * payloads are redacted before persistence.
 */
import type { RuntimeManager } from "../runtime/manager.js";
import type { JsonStore } from "../store/store.js";
import { redactDeep } from "../security/redact.js";

export type IngressState =
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "unknown";

export interface IngressTaskRecord {
  taskId: string;
  state: IngressState;
  sessionId: string;
  workspacePath: string;
  readOnly: boolean;
  lastSeq: number;
  error: string | null;
  finishedAt: string | null;
  usage: { totalTokens: number; inputTokens: number; outputTokens: number; source: string } | null;
  fileChanges: { added: string[]; modified: string[]; deleted: string[]; source: "tool_events" | "none"; preExistingUncommitted: string[] };
}

export interface IngressTask<R extends IngressTaskRecord = IngressTaskRecord> {
  record: R;
  quietPolls: number;
  accumulatedText: string;
  toolCalls: Map<string, string>;
  artifacts: Map<string, { path: string; bytes: number; sha256: string | null }>;
  interactionIds: Set<string>;
  warnings: string[];
  errors: string[];
  persist(): void;
  onTerminal(): void;
}

export class TaskIngress<R extends IngressTaskRecord = IngressTaskRecord> {
  private readonly runtime: RuntimeManager;
  private readonly store: JsonStore;
  private readonly tasks = new Map<string, IngressTask<R>>();
  private readonly bySession = new Map<string, string>();

  constructor(runtime: RuntimeManager, store: JsonStore) {
    this.runtime = runtime;
    this.store = store;
  }

  /** Called by TaskManager whenever task bookkeeping changes. */
  syncTasks(tasks: Iterable<IngressTask<R>>, bySession: Map<string, string>): void {
    this.tasks.clear();
    for (const t of tasks) this.tasks.set(t.record.taskId, t);
    this.bySession.clear();
    for (const [sid, tid] of bySession) this.bySession.set(sid, tid);
  }

  /** Reverse-request relay lookup: task owning a session, if any. */
  taskForSession(sessionId: string): IngressTask<R> | undefined {
    const taskId = this.bySession.get(sessionId);
    if (!taskId) return undefined;
    return this.tasks.get(taskId);
  }

  handleEvent(evt: { channel: string; method: string; params: Record<string, unknown> }): void {
    if (evt.method !== "session/event") return;
    const p = evt.params;
    const sessionId = p.sessionId;
    if (typeof sessionId !== "string" || !sessionId.startsWith("sess_")) return;
    const taskId = this.bySession.get(sessionId);
    if (!taskId) return;
    const t = this.tasks.get(taskId);
    if (!t) return;
    const seq = typeof p.seq === "number" ? p.seq : t.record.lastSeq + 1;
    const type = typeof p.type === "string" ? p.type : "unknown";
    const payload = p.payload ?? {};
    // Gap detection: harness seq is monotonic per session; a jump means events
    // were lost (crash/reconnect) and replays must not look contiguous.
    if (t.record.lastSeq >= 0 && seq > t.record.lastSeq + 1) {
      this.store.appendLine(`tasks/${taskId}.events.jsonl`, {
        seq: t.record.lastSeq + 1,
        ts: new Date().toISOString(),
        type: "bridge.event_gap",
        payload: { fromSeq: t.record.lastSeq + 1, toSeq: seq - 1, note: "harness events missing in this range" },
        origin: "bridge",
      });
      t.warnings.push(`event gap detected: seq ${t.record.lastSeq + 1}..${seq - 1} missing`);
    }
    t.record.lastSeq = Math.max(t.record.lastSeq, seq);
    this.store.appendLine(`tasks/${taskId}.events.jsonl`, {
      seq,
      ts: new Date().toISOString(),
      type,
      payload: redactDeep(payload),
      origin: "harness",
    });

    if (type === "turn.started") {
      t.record.state = "running";
      t.quietPolls = 0;
    } else if (type === "turn.failed") {
      const err = (payload as { error?: { message?: string } }).error;
      const msg = err?.message ?? "turn failed";
      t.errors.push(msg);
      t.record.error = msg;
      t.record.state = "failed";
      t.record.finishedAt = new Date().toISOString();
      t.persist();
      t.onTerminal();
    } else if (type === "turn.completed") {
      t.quietPolls = 0;
      void this.checkQuiet(t);
    } else {
      this.ingressDerived(t, type, payload);
    }
  }

  /** Extract text deltas / tool calls / artifacts from generic events. */
  private ingressDerived(t: IngressTask<R>, type: string, payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (type === "model.streaming") {
      const kind = String(p.kind ?? "");
      if (kind === "text_delta" && typeof (p.text ?? p.delta) === "string") {
        t.accumulatedText += String(p.text ?? p.delta);
      }
      return;
    }
    if (type === "tool.updated") {
      const toolName = typeof p.toolName === "string" ? p.toolName : typeof p.name === "string" ? p.name : "tool";
      const state = String(p.state ?? p.kind ?? "");
      const key = typeof p.toolCallId === "string" ? p.toolCallId : `${toolName}:${t.record.lastSeq}`;
      t.toolCalls.set(key, toolName);
      const filePath = this.extractFilePath(p);
      if (filePath !== null && ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName) && state !== "error") {
        const fc = t.record.fileChanges;
        if (!fc.added.includes(filePath) && !fc.modified.includes(filePath)) {
          fc.modified.push(filePath);
        }
        fc.source = "tool_events";
        t.artifacts.set(filePath, { path: filePath, bytes: -1, sha256: null });
      }
    }
  }

  private extractFilePath(p: Record<string, unknown>): string | null {
    for (const c of [p.file_path, p.filePath, p.path]) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    const input = p.input;
    if (input && typeof input === "object") {
      const irec = input as Record<string, unknown>;
      for (const c of [irec.file_path, irec.filePath]) {
        if (typeof c === "string" && c.length > 0) return c;
      }
    }
    return null;
  }

  /** After turn.completed: require a quiet projection, then complete. */
  private async checkQuiet(t: IngressTask<R>): Promise<void> {
    const rec = t.record;
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      if (t.record.state !== "running") return; // failed/cancelled meanwhile
      let projection: Record<string, unknown> = {};
      try {
        const readBack = await this.runtime.ipcSessionRead(rec.sessionId);
        projection = (readBack?.projection ?? {}) as Record<string, unknown>;
      } catch (err) {
        t.warnings.push(`quiet check failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const active = Array.isArray(projection.activeToolCalls) ? (projection.activeToolCalls as unknown[]).length : 0;
      const jobs = Array.isArray(projection.backgroundJobs) ? (projection.backgroundJobs as unknown[]).length : 0;
      const perms = Array.isArray(projection.pendingPermissions) ? (projection.pendingPermissions as unknown[]).length : 0;
      if (active === 0 && jobs === 0 && perms === 0) {
        rec.state = "completed";
        rec.finishedAt = new Date().toISOString();
        void this.captureUsage(t);
        t.persist();
        t.onTerminal();
        return;
      }
      if (perms > 0 && rec.state === "running") {
        rec.state = "waiting_for_approval";
        t.persist();
        return;
      }
      t.quietPolls = 0;
    }
    t.warnings.push("turn.completed but projection never became quiet within the confirmation window");
    rec.state = "unknown";
    rec.finishedAt = new Date().toISOString();
    t.persist();
    t.onTerminal();
  }

  private async captureUsage(t: IngressTask<R>): Promise<void> {
    try {
      const usage = await this.runtime.ipcSessionUsage(t.record.sessionId);
      t.record.usage = {
        totalTokens: Number(usage?.totalTokens ?? 0),
        inputTokens: Number(usage?.inputTokens ?? 0),
        outputTokens: Number(usage?.outputTokens ?? 0),
        source: "session/usage IPC",
      };
    } catch (err) {
      t.warnings.push(`usage read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
