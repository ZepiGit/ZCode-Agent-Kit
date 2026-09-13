/**
 * Wire types of the ZCode Protocol (as implemented by zcode.cjs app-server,
 * verified live against 0.16.5). NDJSON over stdio, no `jsonrpc` envelope.
 */
export function isServerRequest(m) {
    return m.method !== undefined && m.id !== undefined;
}
export function isNotification(m) {
    return m.method !== undefined && m.id === undefined;
}
/** Build a workspace ref the way the app-server expects it (verified live). */
export function workspaceRef(workspacePath) {
    const p = workspacePath.replace(/[\\/]+$/, "");
    return { workspaceKey: p, workspacePath: p };
}
/**
 * Validate a session id received from harness events before it is used as a
 * key or echoed into protocol params. Returns null for anything that is not
 * a sess_-prefixed identifier, so untrusted values cannot propagate.
 */
export function parseSessionId(value) {
    if (typeof value !== "string")
        return null;
    if (!/^sess_[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
        return null;
    return value;
}
