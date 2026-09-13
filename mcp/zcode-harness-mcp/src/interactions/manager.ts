/**
 * InteractionManager — visibility and controlled resolution of harness
 * reverse requests (permissions, user input questions, provider headers).
 *
 * Policies:
 *  - "deny":      every permission is denied automatically.
 *  - "allowlist": tool names matching a configured prefix are auto-approved,
 *                 everything else is denied.
 *  - "ask":       the interaction is surfaced over MCP and waits for
 *                 zcode_interaction_respond until a timeout; on timeout the
 *                 safe default (deny) applies. This policy never expands the
 *                 caller's own authority: responders can only answer with
 *                 options the harness itself offered.
 */
import { randomUUID } from "node:crypto";
import { createLogger } from "../util/log.js";
import { redactDeep } from "../security/redact.js";
import type { JsonStore } from "../store/store.js";
import type { InteractionPolicy } from "../config.js";

const log = createLogger("interactions");

export type InteractionKind =
  | "permission"
  | "user_input"
  | "provider_runtime_headers"
  | "official_mcp_auth_headers"
  | "browser_list"
  | "browser_execute"
  | "hook_trust"
  | "unknown";

export interface InteractionRecord {
  id: string;
  kind: InteractionKind;
  method: string;
  sessionId: string | null;
  workspace: string | null;
  /** Redacted harness params for display. */
  summary: Record<string, unknown>;
  /** Options the harness offered (for permission/user_input kinds). */
  options: Array<{ id: string; label: string; kind?: string }>;
  status: "pending" | "resolved" | "expired" | "failed";
  resolution: unknown | null;
  resolvedBy: "agent" | "policy" | "timeout" | "bridge" | null;
  createdAt: string;
  resolvedAt: string | null;
  /** Tool name for permission interactions. */
  toolName: string | null;
  taskId: string | null;
}

export interface InteractionDecision {
  /** Auto-applied result when policy decides without an agent. */
  auto: { result: unknown } | null;
  /** True when a human/agent must answer via MCP. */
  needsAgent: boolean;
}

function kindForMethod(method: string): InteractionKind {
  if (method === "interaction/requestPermission") return "permission";
  if (method === "interaction/requestUserInput") return "user_input";
  if (method === "interaction/requestProviderRuntimeHeaders") return "provider_runtime_headers";
  if (method === "interaction/requestOfficialMcpAuthHeaders") return "official_mcp_auth_headers";
  if (method === "interaction/browserList") return "browser_list";
  if (method === "interaction/browserExecute") return "browser_execute";
  if (method === "workspace/hooks/trustGrant") return "hook_trust";
  return "unknown";
}

export class InteractionManager {
  private readonly store: JsonStore;
  private readonly policy: InteractionPolicy;
  private readonly allowlist: string[];
  private readonly timeoutSec: number;
  private readonly pending = new Map<string, InteractionRecord>();
  private readonly waiters = new Map<string, (rec: InteractionRecord) => void>();
  /** Auto-deny patterns for tool names (applies in every policy). */
  private readonly alwaysDenyTools = ["Bash", "PowerShell", "Shell"];

  constructor(store: JsonStore, policy: InteractionPolicy, allowlist: string[], timeoutSec: number) {
    this.store = store;
    this.policy = policy;
    this.allowlist = allowlist;
    this.timeoutSec = timeoutSec;
  }

  list(status?: "pending" | "resolved" | "all"): InteractionRecord[] {
    const resolved = this.store.readLines("interactions/resolved.jsonl") as InteractionRecord[];
    const all: InteractionRecord[] = [...this.pending.values(), ...resolved];
    if (status === undefined || status === "all") return all;
    if (status === "pending") return all.filter((r) => r.status === "pending");
    // "resolved" means non-pending (resolved, expired or failed).
    return all.filter((r) => r.status !== "pending");
  }

  get(id: string): InteractionRecord | null {
    const p = this.pending.get(id);
    if (p) return p;
    const resolved = this.store.readLines("interactions/resolved.jsonl") as InteractionRecord[];
    return resolved.find((r) => r.id === id) ?? null;
  }

  /**
   * Decide how an incoming harness reverse request is handled and register it
   * when an agent answer is required.
   */
  register(params: {
    method: string;
    harnessParams: unknown;
    sessionId: string | null;
    workspace: string | null;
    taskId: string | null;
    readOnlyMode: boolean;
  }): InteractionDecision {
    const kind = kindForMethod(params.method);
    const p = (params.harnessParams ?? {}) as Record<string, unknown>;
    const record: InteractionRecord = {
      id: "ia-" + randomUUID().slice(0, 12),
      kind,
      method: params.method,
      sessionId: params.sessionId,
      workspace: params.workspace,
      summary: redactDeep(p) as Record<string, unknown>,
      options: extractOptions(kind, p),
      status: "pending",
      resolution: null,
      resolvedBy: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      toolName: typeof p.toolName === "string" ? p.toolName : null,
      taskId: params.taskId,
    };

    // Kinds the bridge never fulfils — answer deterministically without an agent.
    if (kind === "provider_runtime_headers") {
      const headers = null; // never relayed by default; see config.providerRuntimeHeaders (future)
      void headers;
      this.finalize(record, "bridge", { headersApplied: false, errorMessage: "bridge does not provide provider runtime headers" });
      return { auto: { result: { headersApplied: false, errorMessage: "bridge does not provide provider runtime headers" } }, needsAgent: false };
    }
    if (kind === "official_mcp_auth_headers") {
      this.finalize(record, "bridge", { ok: false, reason: "unsupported" });
      return { auto: { result: { ok: false, reason: "unsupported" } }, needsAgent: false };
    }
    if (kind === "browser_list" || kind === "browser_execute" || kind === "hook_trust" || kind === "unknown") {
      this.finalize(record, "bridge", null);
      return { auto: null, needsAgent: false, };
    }

    // Permission / user input kinds follow the policy.
    const denyNow = (): { result: unknown } => {
      const result = kind === "permission" ? { decision: "deny", reason: "denied by bridge policy" } : { answers: [], cancelled: true, reason: "denied by bridge policy" };
      return { result };
    };
    if (params.readOnlyMode) {
      this.finalize(record, "policy", denyNow().result);
      return { auto: denyNow(), needsAgent: false };
    }
    if (this.policy === "deny") {
      this.finalize(record, "policy", denyNow().result);
      return { auto: denyNow(), needsAgent: false };
    }
    if (this.policy === "allowlist" && kind === "permission" && record.toolName !== null) {
      const toolName: string = record.toolName;
      const allowed = this.allowlist.some((prefix) => toolName === prefix || toolName.startsWith(prefix));
      if (allowed) {
        const result = { decision: "allow", reason: "allowed by bridge allowlist" };
        this.finalize(record, "policy", result);
        return { auto: { result }, needsAgent: false };
      }
      this.finalize(record, "policy", denyNow().result);
      return { auto: denyNow(), needsAgent: false };
    }

    // "ask" (or allowlist miss for user_input): surface to the agent.
    this.pending.set(record.id, record);
    this.store.writeJson(`interactions/${record.id}.json`, record);
    const timer = setTimeout(() => {
      const rec = this.pending.get(record.id);
      if (!rec) return;
      log.warn("interaction timed out; resolving with safe default (deny)", { id: rec.id });
      this.resolveExpired(rec);
    }, this.timeoutSec * 1000);
    timer.unref?.();
    return { auto: null, needsAgent: true };
  }

  private resolveExpired(rec: InteractionRecord): void {
    const result = rec.kind === "permission" ? { decision: "deny", reason: "interaction timed out" } : { answers: [], cancelled: true, reason: "interaction timed out" };
    rec.status = "expired";
    rec.resolution = result;
    rec.resolvedBy = "timeout";
    rec.resolvedAt = new Date().toISOString();
    this.pending.delete(rec.id);
    this.persistResolved(rec);
    const w = this.waiters.get(rec.id);
    if (w) {
      this.waiters.delete(rec.id);
      w(rec);
    }
  }

  /**
   * Agent-supplied resolution. The agent may only choose among the options
   * the harness offered (or cancel); it cannot invent new authority.
   */
  resolve(id: string, choice: { optionId?: string; value?: unknown; cancel?: boolean }): InteractionRecord | { error: string } {
    const rec = this.pending.get(id);
    if (!rec) {
      const existing = this.get(id);
      if (existing && existing.status !== "pending") return { error: `interaction ${id} is already ${existing.status}` };
      return { error: `interaction ${id} not found or no longer pending` };
    }
    let result: unknown;
    if (rec.kind === "permission") {
      if (choice.cancel) {
        result = { decision: "deny", reason: "cancelled by operator" };
      } else {
        const opt = rec.options.find((o) => o.id === choice.optionId);
        if (!opt) {
          return {
            error: `optionId must be one of: ${rec.options.map((o) => o.id).join(", ") || "(none)"}${choice.cancel ? ", or omit optionId with cancel:true" : ""}`,
          };
        }
        result = opt.kind === "deny" ? { decision: "deny", reason: `denied via option ${opt.id}` } : { decision: "allow", reason: `allowed via option ${opt.id}` };
      }
    } else if (rec.kind === "user_input") {
      if (choice.cancel) {
        result = { answers: [], cancelled: true, reason: "cancelled by operator" };
      } else if (choice.value === undefined) {
        return { error: "value (answers payload) or cancel:true is required for user_input interactions" };
      } else {
        result = choice.value;
      }
    } else {
      result = choice.value ?? null;
    }
    rec.status = "resolved";
    rec.resolution = redactDeep(result);
    rec.resolvedBy = "agent";
    rec.resolvedAt = new Date().toISOString();
    this.pending.delete(rec.id);
    this.persistResolved(rec);
    const w = this.waiters.get(rec.id);
    if (w) {
      this.waiters.delete(rec.id);
      w(rec);
    }
    return rec;
  }

  /** Wait until the interaction is resolved/expired (used by task runner). */
  waitFor(id: string, timeoutMs: number): Promise<InteractionRecord | null> {
    return new Promise((resolve) => {
      const existing = this.pending.get(id);
      if (!existing) return resolve(this.get(id));
      const timer = setTimeout(() => resolve(null), timeoutMs);
      this.waiters.set(id, (rec) => {
        clearTimeout(timer);
        resolve(rec);
      });
    });
  }

  private finalize(record: InteractionRecord, by: InteractionRecord["resolvedBy"], result: unknown): void {
    record.status = "resolved";
    record.resolution = redactDeep(result);
    record.resolvedBy = by;
    record.resolvedAt = new Date().toISOString();
    this.persistResolved(record);
  }

  private persistResolved(rec: InteractionRecord): void {
    this.store.appendLine("interactions/resolved.jsonl", rec);
    this.store.deleteFile(`interactions/${rec.id}.json`);
  }
}

function extractOptions(kind: InteractionKind, p: Record<string, unknown>): InteractionRecord["options"] {
  if (kind !== "permission" && kind !== "user_input") return [];
  const raw = p.options;
  if (Array.isArray(raw)) {
    const out: InteractionRecord["options"] = [];
    for (const o of raw) {
      const rec = o as Record<string, unknown>;
      const id = typeof rec.optionId === "string" ? rec.optionId : typeof rec.id === "string" ? rec.id : null;
      const label = typeof rec.label === "string" ? rec.label : typeof rec.name === "string" ? rec.name : null;
      if (id === null) continue;
      out.push({ id, label: label ?? id, kind: typeof rec.kind === "string" ? rec.kind : undefined });
    }
    return out;
  }
  // AskUserQuestion-style payloads expose questions with options.
  const questions = p.questions;
  if (Array.isArray(questions)) {
    const out: InteractionRecord["options"] = [];
    for (const q of questions) {
      const qrec = q as Record<string, unknown>;
      const opts = qrec.options;
      if (Array.isArray(opts)) {
        for (const o of opts) {
          const orec = o as Record<string, unknown>;
          if (typeof orec.label === "string") out.push({ id: orec.label, label: orec.label, kind: undefined });
        }
      }
    }
    return out;
  }
  return [];
}
