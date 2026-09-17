import { redactDeep } from "../security/redact.js";
export class TaskIngress {
    runtime;
    store;
    tasks = new Map();
    bySession = new Map();
    constructor(runtime, store) {
        this.runtime = runtime;
        this.store = store;
    }
    /** Called by TaskManager whenever task bookkeeping changes. */
    syncTasks(tasks, bySession) {
        this.tasks.clear();
        for (const t of tasks)
            this.tasks.set(t.record.taskId, t);
        this.bySession.clear();
        for (const [sid, tid] of bySession)
            this.bySession.set(sid, tid);
    }
    /** Reverse-request relay lookup: task owning a session, if any. */
    taskForSession(sessionId) {
        const taskId = this.bySession.get(sessionId);
        if (!taskId)
            return undefined;
        return this.tasks.get(taskId);
    }
    handleEvent(evt) {
        if (evt.method !== "session/event")
            return;
        const p = evt.params;
        const sessionId = p.sessionId;
        if (typeof sessionId !== "string" || !sessionId.startsWith("sess_"))
            return;
        const taskId = this.bySession.get(sessionId);
        if (!taskId)
            return;
        const t = this.tasks.get(taskId);
        if (!t || !t.acceptingEvents || ["completed", "failed", "cancelled", "interrupted", "unknown", "cancelling"].includes(t.record.state))
            return;
        const seq = typeof p.seq === "number" ? p.seq : t.record.lastSeq + 1;
        if (seq <= t.record.lastSeq)
            return;
        const type = typeof p.type === "string" ? p.type : "unknown";
        const payload = p.payload ?? {};
        // Gap detection: harness seq is monotonic per session; a jump means events
        // were lost (crash/reconnect) and replays must not look contiguous.
        if (t.record.lastSeq > 0 && seq > t.record.lastSeq + 1) {
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
            if (t.record.state !== "starting")
                t.record.state = "running";
            t.persist();
            t.quietPolls = 0;
        }
        else if (type === "turn.failed") {
            const err = payload.error;
            const msg = err?.message ?? "turn failed";
            t.errors.push(msg);
            t.record.error = msg;
            t.record.state = "failed";
            t.record.finishedAt = new Date().toISOString();
            t.persist();
            t.onTerminal();
        }
        else if (type === "turn.completed") {
            t.quietPolls = 0;
            void this.checkQuiet(t);
        }
        else {
            this.ingressDerived(t, type, payload);
        }
    }
    /** Extract text deltas / tool calls / artifacts from generic events. */
    ingressDerived(t, type, payload) {
        const p = (payload ?? {});
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
    extractFilePath(p) {
        for (const c of [p.file_path, p.filePath, p.path]) {
            if (typeof c === "string" && c.length > 0)
                return c;
        }
        const input = p.input;
        if (input && typeof input === "object") {
            const irec = input;
            for (const c of [irec.file_path, irec.filePath]) {
                if (typeof c === "string" && c.length > 0)
                    return c;
            }
        }
        return null;
    }
    /** After turn.completed: require a quiet projection, then complete. */
    async checkQuiet(t) {
        const rec = t.record;
        const revision = t.turnRevision;
        const startingDeadline = Date.now() + 120_000;
        for (let i = 0; i < 6; i += 1) {
            await new Promise((r) => setTimeout(r, 1500));
            if (t.turnRevision !== revision)
                return;
            if (t.record.state === 'starting') {
                if (Date.now() >= startingDeadline)
                    break;
                i -= 1;
                continue;
            }
            if (t.record.state !== 'running')
                return;
            let projection = {};
            try {
                const readBack = await this.runtime.ipcSessionRead(rec.sessionId);
                projection = (readBack?.projection ?? {});
            }
            catch (err) {
                t.warnings.push(`quiet check failed: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }
            if (t.record.state !== "running" || t.turnRevision !== revision)
                return;
            const active = Array.isArray(projection.activeToolCalls) ? projection.activeToolCalls.length : 0;
            const jobs = Array.isArray(projection.backgroundJobs) ? projection.backgroundJobs.length : 0;
            const perms = Array.isArray(projection.pendingPermissions) ? projection.pendingPermissions.length : 0;
            if (projection.status === "idle" && active === 0 && jobs === 0 && perms === 0) {
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
    async captureUsage(t) {
        try {
            const usage = await this.runtime.ipcSessionUsage(t.record.sessionId);
            t.record.usage = {
                totalTokens: Number(usage?.totalTokens ?? 0),
                inputTokens: Number(usage?.inputTokens ?? 0),
                outputTokens: Number(usage?.outputTokens ?? 0),
                source: "session/usage IPC",
            };
        }
        catch (err) {
            t.warnings.push(`usage read failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
