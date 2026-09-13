/**
 * Rebuild an interaction reply from known-safe fields only. Values coming
 * back from the interaction store are never forwarded verbatim.
 */
function sanitizeInteractionReply(raw, kind) {
    const src = (raw ?? {});
    if (kind === "permission") {
        const decision = src.decision === "allow" ? "allow" : "deny";
        const reason = typeof src.reason === "string" ? src.reason.slice(0, 200) : "resolved via bridge";
        return { decision, reason };
    }
    const answers = Array.isArray(src.answers) ? src.answers : [];
    const cancelled = src.cancelled === true;
    const reason = typeof src.reason === "string" ? src.reason.slice(0, 200) : undefined;
    const out = { answers, cancelled };
    if (reason !== undefined)
        out.reason = reason;
    return out;
}
export class TaskRelay {
    interactions;
    ingress;
    interactionTimeoutSec;
    constructor(interactions, ingress, interactionTimeoutSec) {
        this.interactions = interactions;
        this.ingress = ingress;
        this.interactionTimeoutSec = interactionTimeoutSec;
    }
    /** Returns true when the request was handled (task session matched). */
    handleReverseRequest(ctx) {
        const p = (ctx.params ?? {});
        const rawSessionId = p.sessionId;
        const sessionId = typeof rawSessionId === "string" && rawSessionId.startsWith("sess_") ? rawSessionId : null;
        const task = sessionId ? this.ingress.taskForSession(sessionId) : undefined;
        if (!task)
            return false;
        const rec = task.record;
        const decision = this.interactions.register({
            method: ctx.method,
            harnessParams: p,
            sessionId,
            workspace: rec.workspacePath,
            taskId: rec.taskId,
            readOnlyMode: rec.readOnly,
        });
        if (decision.auto !== null) {
            ctx.reply(sanitizeInteractionReply(decision.auto.result, ctx.method === "interaction/requestUserInput" ? "user_input" : "permission"));
            return true;
        }
        if (!decision.needsAgent) {
            ctx.replyError(-32601, `bridge does not support ${ctx.method}`);
            return true;
        }
        const pending = this.interactions.list("pending").filter((i) => i.sessionId === sessionId);
        const last = pending[pending.length - 1];
        if (!last) {
            ctx.replyError(-32603, "interaction registration failed");
            return true;
        }
        task.interactionIds.add(last.id);
        rec.state = ctx.method === "interaction/requestUserInput" ? "waiting_for_input" : "waiting_for_approval";
        task.persist();
        void this.interactions.waitFor(last.id, this.interactionTimeoutSec * 1000 + 2000).then((resolved) => {
            if (!resolved)
                return;
            if (resolved.status === "resolved" && resolved.resolution !== null && resolved.resolution !== undefined) {
                ctx.reply(sanitizeInteractionReply(resolved.resolution, last.kind));
            }
            else {
                ctx.replyError(-32002, `interaction ${resolved.status}`);
            }
            if (rec.state === "waiting_for_approval" || rec.state === "waiting_for_input") {
                rec.state = "running";
                task.persist();
            }
        });
        return true;
    }
}
