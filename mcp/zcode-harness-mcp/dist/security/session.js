import { normalizeWorkspacePath, resolveReal } from "./allowlist.js";
import { parseSessionId } from "../protocol/types.js";
export function workspaceIdentity(p) {
    const normalized = normalizeWorkspacePath(resolveReal(p));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
export function sessionWorkspaceOf(session) {
    if (!session || typeof session !== "object")
        return null;
    const rec = session;
    const inner = (rec.session ?? rec);
    const workspace = inner.workspace;
    return typeof workspace?.workspacePath === "string" ? workspace.workspacePath : null;
}
export async function sessionInScope(runtime, allowlist, raw) {
    const sessionId = parseSessionId(raw);
    if (!sessionId)
        throw new Error("invalid sessionId");
    // session/read exposes projection and settings, not necessarily workspace metadata.
    const listed = await runtime.call("session/list", {});
    const matches = listed.sessions?.filter((s) => s.sessionId === sessionId) ?? [];
    const workspace = matches.length === 1 ? sessionWorkspaceOf(matches[0]) : null;
    if (!workspace)
        throw new Error("session workspace cannot be verified against the allowlist");
    return { sessionId, workspacePath: allowlist.enforce(workspace) };
}
