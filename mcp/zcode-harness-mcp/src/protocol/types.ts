/**
 * Wire types of the ZCode Protocol (as implemented by zcode.cjs app-server,
 * verified live against 0.16.5). NDJSON over stdio, no `jsonrpc` envelope.
 */

export interface ZcodeRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface ZcodeNotification {
  method: string;
  params?: unknown;
}

export interface ZcodeErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export interface ZcodeResponse {
  id: string | number;
  result?: unknown;
  error?: ZcodeErrorShape;
}

export type ZcodeIncomingMessage = ZcodeRequest | ZcodeNotification | ZcodeResponse;

export function isServerRequest(m: ZcodeIncomingMessage): m is ZcodeRequest {
  return (m as ZcodeRequest).method !== undefined && (m as ZcodeRequest).id !== undefined;
}

export function isNotification(m: ZcodeIncomingMessage): m is ZcodeNotification {
  return (m as ZcodeNotification).method !== undefined && (m as ZcodeRequest).id === undefined;
}

export interface WorkspaceRef {
  workspaceKey: string;
  workspacePath: string;
}

/** Build a workspace ref the way the app-server expects it (verified live). */
export function workspaceRef(workspacePath: string): WorkspaceRef {
  const p = workspacePath.replace(/[\\/]+$/, "");
  return { workspaceKey: p, workspacePath: p };
}

/**
 * Validate a session id received from harness events before it is used as a
 * key or echoed into protocol params. Returns null for anything that is not
 * a sess_-prefixed identifier, so untrusted values cannot propagate.
 */
export function parseSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^sess_[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) return null;
  return value;
}
