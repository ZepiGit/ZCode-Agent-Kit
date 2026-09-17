import type { RuntimeManager } from "../runtime/manager.js";
import { WorkspaceAllowlist, normalizeWorkspacePath, resolveReal } from "./allowlist.js";
import { parseSessionId } from "../protocol/types.js";

export function workspaceIdentity(p: string): string {
  const normalized = normalizeWorkspacePath(resolveReal(p));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function sessionWorkspaceOf(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  const rec = session as Record<string, unknown>;
  const inner = (rec.session ?? rec) as Record<string, unknown>;
  const workspace = inner.workspace as Record<string, unknown> | undefined;
  return typeof workspace?.workspacePath === "string" ? workspace.workspacePath : null;
}

export async function sessionInScope(runtime: RuntimeManager, allowlist: WorkspaceAllowlist, raw: string) {
  const sessionId = parseSessionId(raw);
  if (!sessionId) throw new Error("invalid sessionId");
  // session/read exposes projection and settings, not necessarily workspace metadata.
  const listed = await runtime.call<{ sessions?: Array<Record<string, unknown>> }>("session/list", {});
  const matches = listed.sessions?.filter((s) => s.sessionId === sessionId) ?? [];
  const workspace = matches.length === 1 ? sessionWorkspaceOf(matches[0]) : null;
  if (!workspace) throw new Error("session workspace cannot be verified against the allowlist");
  return { sessionId, workspacePath: allowlist.enforce(workspace) };
}
