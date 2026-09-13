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
const log = createLogger("interactions");
function kindForMethod(method) {
    if (method === "interaction/requestPermission")
        return "permission";
    if (method === "interaction/requestUserInput")
        return "user_input";
    if (method === "interaction/requestProviderRuntimeHeaders")
        return "provider_runtime_headers";
    if (method === "interaction/requestOfficialMcpAuthHeaders")
        return "official_mcp_auth_headers";
    if (method === "interaction/browserList")
        return "browser_list";
    if (method === "interaction/browserExecute")
        return "browser_execute";
    if (method === "workspace/hooks/trustGrant")
        return "hook_trust";
    return "unknown";
}
export class InteractionManager {
    store;
    policy;
    allowlist;
    timeoutSec;
    pending = new Map();
    waiters = new Map();
    /** Auto-deny patterns for tool names (applies in every policy). */
    alwaysDenyTools = ["Bash", "PowerShell", "Shell"];
    constructor(store, policy, allowlist, timeoutSec) {
        this.store = store;
        this.policy = policy;
        this.allowlist = allowlist;
        this.timeoutSec = timeoutSec;
    }
    list(status) {
        const resolved = this.store.readLines("interactions/resolved.jsonl");
        const all = [...this.pending.values(), ...resolved];
        if (status === undefined || status === "all")
            return all;
        if (status === "pending")
            return all.filter((r) => r.status === "pending");
        // "resolved" means non-pending (resolved, expired or failed).
        return all.filter((r) => r.status !== "pending");
    }
    get(id) {
        const p = this.pending.get(id);
        if (p)
            return p;
        const resolved = this.store.readLines("interactions/resolved.jsonl");
        return resolved.find((r) => r.id === id) ?? null;
    }
    /**
     * Decide how an incoming harness reverse request is handled and register it
     * when an agent answer is required.
     */
    register(params) {
        const kind = kindForMethod(params.method);
        const p = (params.harnessParams ?? {});
        const record = {
            id: "ia-" + randomUUID().slice(0, 12),
            kind,
            method: params.method,
            sessionId: params.sessionId,
            workspace: params.workspace,
            summary: redactDeep(p),
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
        const denyNow = () => {
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
            const toolName = record.toolName;
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
            if (!rec)
                return;
            log.warn("interaction timed out; resolving with safe default (deny)", { id: rec.id });
            this.resolveExpired(rec);
        }, this.timeoutSec * 1000);
        timer.unref?.();
        return { auto: null, needsAgent: true };
    }
    resolveExpired(rec) {
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
    resolve(id, choice) {
        const rec = this.pending.get(id);
        if (!rec) {
            const existing = this.get(id);
            if (existing && existing.status !== "pending")
                return { error: `interaction ${id} is already ${existing.status}` };
            return { error: `interaction ${id} not found or no longer pending` };
        }
        let result;
        if (rec.kind === "permission") {
            if (choice.cancel) {
                result = { decision: "deny", reason: "cancelled by operator" };
            }
            else {
                const opt = rec.options.find((o) => o.id === choice.optionId);
                if (!opt) {
                    return {
                        error: `optionId must be one of: ${rec.options.map((o) => o.id).join(", ") || "(none)"}${choice.cancel ? ", or omit optionId with cancel:true" : ""}`,
                    };
                }
                result = opt.kind === "deny" ? { decision: "deny", reason: `denied via option ${opt.id}` } : { decision: "allow", reason: `allowed via option ${opt.id}` };
            }
        }
        else if (rec.kind === "user_input") {
            if (choice.cancel) {
                result = { answers: [], cancelled: true, reason: "cancelled by operator" };
            }
            else if (choice.value === undefined) {
                return { error: "value (answers payload) or cancel:true is required for user_input interactions" };
            }
            else {
                result = choice.value;
            }
        }
        else {
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
    waitFor(id, timeoutMs) {
        return new Promise((resolve) => {
            const existing = this.pending.get(id);
            if (!existing)
                return resolve(this.get(id));
            const timer = setTimeout(() => resolve(null), timeoutMs);
            this.waiters.set(id, (rec) => {
                clearTimeout(timer);
                resolve(rec);
            });
        });
    }
    finalize(record, by, result) {
        record.status = "resolved";
        record.resolution = redactDeep(result);
        record.resolvedBy = by;
        record.resolvedAt = new Date().toISOString();
        this.persistResolved(record);
    }
    persistResolved(rec) {
        this.store.appendLine("interactions/resolved.jsonl", rec);
        this.store.deleteFile(`interactions/${rec.id}.json`);
    }
}
function extractOptions(kind, p) {
    if (kind !== "permission" && kind !== "user_input")
        return [];
    const raw = p.options;
    if (Array.isArray(raw)) {
        const out = [];
        for (const o of raw) {
            const rec = o;
            const id = typeof rec.optionId === "string" ? rec.optionId : typeof rec.id === "string" ? rec.id : null;
            const label = typeof rec.label === "string" ? rec.label : typeof rec.name === "string" ? rec.name : null;
            if (id === null)
                continue;
            out.push({ id, label: label ?? id, kind: typeof rec.kind === "string" ? rec.kind : undefined });
        }
        return out;
    }
    // AskUserQuestion-style payloads expose questions with options.
    const questions = p.questions;
    if (Array.isArray(questions)) {
        const out = [];
        for (const q of questions) {
            const qrec = q;
            const opts = qrec.options;
            if (Array.isArray(opts)) {
                for (const o of opts) {
                    const orec = o;
                    if (typeof orec.label === "string")
                        out.push({ id: orec.label, label: orec.label, kind: undefined });
                }
            }
        }
        return out;
    }
    return [];
}
