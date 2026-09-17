import { readArtifact } from "../security/artifact.js";
import { sessionInScope } from "../security/session.js";
import { capabilitiesForMcp, BRIDGE_VERSION, TARGET_PROTOCOL } from "../capabilities/registry.js";
import { safeJsonStringify } from "../security/redact.js";
import { parseSessionId } from "../protocol/types.js";
export const RESOURCE_ROOTS = [
    { uri: "zcode://capabilities", name: "Capability registry", description: "All known harness capabilities with status", mimeType: "application/json" },
];
export function listResources(ctx) {
    const out = [...RESOURCE_ROOTS];
    for (const t of ctx.tasks.list()) {
        out.push({ uri: `zcode://tasks/${t.taskId}/status`, name: `Task ${t.taskId} status`, mimeType: "application/json" });
        out.push({ uri: `zcode://tasks/${t.taskId}/result`, name: `Task ${t.taskId} result`, mimeType: "application/json" });
        out.push({ uri: `zcode://tasks/${t.taskId}/events`, name: `Task ${t.taskId} events`, mimeType: "application/x-ndjson" });
        if (t.sessionId) {
            out.push({ uri: `zcode://sessions/${t.sessionId}`, name: `Session ${t.sessionId}`, mimeType: "application/json" });
        }
    }
    return out;
}
export async function readResource(ctx, uri) {
    const send = (text, mimeType = "application/json") => ({
        contents: [{ uri, mimeType, text }],
    });
    if (uri === "zcode://capabilities") {
        return send(JSON.stringify({ bridgeVersion: BRIDGE_VERSION, protocol: TARGET_PROTOCOL, capabilities: capabilitiesForMcp() }, null, 2));
    }
    const mTask = uri.match(/^zcode:\/\/tasks\/([\w-]+)\/(status|result|events)$/);
    if (mTask) {
        const taskId = mTask[1];
        const kind = mTask[2];
        if (kind === "status") {
            const rec = ctx.tasks.get(taskId);
            if (!rec)
                throw new Error(`unknown task: ${taskId}`);
            return send(safeJsonStringify(rec));
        }
        if (kind === "result") {
            return send(safeJsonStringify(await ctx.tasks.buildResult(taskId)));
        }
        const evs = ctx.tasks.events(taskId, -1, 100_000);
        return send(evs.items.map((e) => JSON.stringify(e)).join("\n"), "application/x-ndjson");
    }
    const mSession = uri.match(/^zcode:\/\/sessions\/(sess_[A-Za-z0-9._-]+)$/);
    if (mSession) {
        const sessionId = parseSessionId(mSession[1]);
        if (!sessionId)
            throw new Error(`invalid session id in ${uri}`);
        const { RuntimeManagerHolder } = await import("./runtime-holder.js");
        const runtime = RuntimeManagerHolder.get();
        await sessionInScope(runtime, ctx.allowlist, sessionId);
        return send(safeJsonStringify(await runtime.ipcSessionRead(sessionId)));
    }
    const mArtifact = uri.match(/^zcode:\/\/artifacts\/(.+)$/);
    if (mArtifact) {
        const raw = decodeURIComponent(mArtifact[1]);
        // artifact id format: <abs-path> registered by a task; enforce allowlist.
        const canonical = ctx.allowlist.check(raw);
        if (!canonical)
            throw new Error(`artifact path not allowlisted: ${raw}`);
        const artifact = await readArtifact(canonical, raw, 0, 1_048_576, ctx.maxArtifactBytes);
        return send(JSON.stringify(artifact), "application/json");
    }
    throw new Error(`unknown resource: ${uri}`);
}
