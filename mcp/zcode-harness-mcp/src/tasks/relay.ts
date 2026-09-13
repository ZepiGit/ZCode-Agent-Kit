/**
 * TaskRelay — routes harness reverse requests (permission prompts, user
 * input questions) that belong to a bridge-managed task session to the
 * InteractionManager, and relays the (whitelisted) resolution back.
 *
 * Replies are rebuilt through sanitizeInteractionReply so only known-safe
 * shapes ever travel back over the local stdio IPC.
 */
import type { InteractionManager } from "../interactions/manager.js";
import type { TaskIngress, IngressTask, IngressTaskRecord } from "./ingress.js";

/**
 * Rebuild an interaction reply from known-safe fields only. Values coming
 * back from the interaction store are never forwarded verbatim.
 */
function sanitizeInteractionReply(raw: unknown, kind: string): Record<string, unknown> {
  const src = (raw ?? {}) as Record<string, unknown>;
  if (kind === "permission") {
    const decision = src.decision === "allow" ? "allow" : "deny";
    const reason = typeof src.reason === "string" ? src.reason.slice(0, 200) : "resolved via bridge";
    return { decision, reason };
  }
  const answers = Array.isArray(src.answers) ? src.answers : [];
  const cancelled = src.cancelled === true;
  const reason = typeof src.reason === "string" ? src.reason.slice(0, 200) : undefined;
  const out: Record<string, unknown> = { answers, cancelled };
  if (reason !== undefined) out.reason = reason;
  return out;
}

export interface RelayReplyContext {
  method: string;
  params: unknown;
  reply: (r: unknown) => void;
  replyError: (c: number, m: string) => void;
}

export class TaskRelay {
  private readonly interactions: InteractionManager;
  private readonly ingress: TaskIngress;
  private readonly interactionTimeoutSec: number;

  constructor(interactions: InteractionManager, ingress: TaskIngress, interactionTimeoutSec: number) {
    this.interactions = interactions;
    this.ingress = ingress;
    this.interactionTimeoutSec = interactionTimeoutSec;
  }

  /** Returns true when the request was handled (task session matched). */
  handleReverseRequest(ctx: RelayReplyContext): boolean {
    const p = (ctx.params ?? {}) as Record<string, unknown>;
    const rawSessionId = p.sessionId;
    const sessionId = typeof rawSessionId === "string" && rawSessionId.startsWith("sess_") ? rawSessionId : null;
    const task: IngressTask<IngressTaskRecord> | undefined = sessionId ? this.ingress.taskForSession(sessionId) : undefined;
    if (!task) return false;
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
      if (!resolved) return;
      if (resolved.status === "resolved" && resolved.resolution !== null && resolved.resolution !== undefined) {
        ctx.reply(sanitizeInteractionReply(resolved.resolution, last.kind));
      } else {
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
