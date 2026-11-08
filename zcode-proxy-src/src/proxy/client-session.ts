/**
 * Local client-session inference for cache-affinity experiments.
 *
 * The resolver stores only hashes and generated IDs. It deliberately avoids
 * prompt markers, response mutation, and full prompt persistence.
 */
import nodeCrypto from "node:crypto";
import type { Format } from "../translator/types.js";
import type { ClientIdentityConfig } from "../config/types.js";

export type ClientSessionSource = "none" | "explicit" | "lineage";
export type ClientSessionAction = "off" | "observe" | "enforce";

export interface ClientSessionResult {
  source: ClientSessionSource;
  action: ClientSessionAction;
  confidence: number;
  sessionId?: string;
  upstreamSessionId?: string;
  requestId?: string;
  traceId?: string;
  queryId?: string;
}

interface StoredNode {
  nodeHash: string;
  sessionId: string;
  upstreamSessionId: string;
  lastSeenAt: number;
}

interface CanonicalRequest {
  model: string;
  identity: unknown;
  messages: unknown[];
}

interface ExplicitTraceContext {
  requestId?: string;
  traceId?: string;
  queryId?: string;
  sessionId?: string;
}

export interface ClientSessionResolver {
  /**
   * `parsedBody`, when given, is `JSON.parse(body)` done by the caller, so the
   * resolver reads it instead of parsing the body text again (ticket 20). It
   * is only read, never changed.
   */
  resolve(req: Request, body: string | undefined, format: Format, model: string, config: ClientIdentityConfig, parsedBody?: unknown): ClientSessionResult;
}

export function createClientSessionResolver(now: () => number = () => Date.now()): ClientSessionResolver {
  const nodes = new Map<string, StoredNode>();
  const sessions = new Map<string, StoredNode>();

  function remember(nodeHash: string, session: StoredNode, config: ClientIdentityConfig): void {
    const stored = { ...session, nodeHash, lastSeenAt: now() };
    nodes.set(nodeHash, stored);
    sessions.set(stored.sessionId, stored);
    prune(config);
  }

  function prune(config: ClientIdentityConfig): void {
    const cutoff = now() - config.ttlSeconds * 1000;
    for (const [hash, node] of nodes.entries()) {
      if (node.lastSeenAt < cutoff) nodes.delete(hash);
    }
    for (const [id, node] of sessions.entries()) {
      if (node.lastSeenAt < cutoff) sessions.delete(id);
    }
    while (sessions.size > config.maxSessions) {
      let oldestId = "";
      let oldestAt = Infinity;
      for (const [id, node] of sessions.entries()) {
        if (node.lastSeenAt < oldestAt) {
          oldestAt = node.lastSeenAt;
          oldestId = id;
        }
      }
      if (!oldestId) break;
      sessions.delete(oldestId);
      for (const [hash, node] of nodes.entries()) {
        if (node.sessionId === oldestId) nodes.delete(hash);
      }
    }
  }

  function action(config: ClientIdentityConfig): ClientSessionAction {
    return config.mode;
  }

  return {
    resolve(req, body, format, model, config, parsedBody) {
      if (config.mode === "off") return { source: "none", action: "off", confidence: 0 };

      prune(config);
      const explicitTrace = requestTraceContext(req, body, parsedBody);
      if (explicitTrace.sessionId) return explicitResult(explicitTrace, config);

      const canonical = canonicalize(body, format, model, parsedBody);
      if (!canonical) {
        if (hasTraceContext(explicitTrace)) return explicitResult(explicitTrace, config);
        return { source: "none", action: action(config), confidence: 0 };
      }

      const nodeHash = hashJson(canonical.identity);
      const existing = nodes.get(nodeHash);
      if (existing) {
        remember(nodeHash, existing, config);
        return withTraceContext(result("lineage", action(config), existing, 0.95), explicitTrace);
      }

      const parent = findLinearParent(canonical, nodes);
      if (parent) {
        remember(nodeHash, parent, config);
        return withTraceContext(result("lineage", action(config), parent, 0.9), explicitTrace);
      }

      const fresh = newSession();
      remember(nodeHash, fresh, config);
      return withTraceContext(result("lineage", action(config), fresh, 0.75), explicitTrace);
    },
  };
}

export const defaultClientSessionResolver = createClientSessionResolver();

function result(source: ClientSessionSource, action: ClientSessionAction, node: StoredNode, confidence: number): ClientSessionResult {
  return {
    source,
    action,
    confidence,
    sessionId: node.sessionId,
    upstreamSessionId: node.upstreamSessionId,
  };
}

function requestTraceContext(req: Request, body: string | undefined, parsedBody?: unknown): ExplicitTraceContext {
  const bodyTrace = bodyMetadataTrace(body, parsedBody);
  return {
    requestId: firstHeader(req.headers, ["x-request-id"]) ?? bodyTrace.requestId,
    traceId: firstHeader(req.headers, ["x-zcode-trace-id"]) ?? bodyTrace.traceId,
    queryId: firstHeader(req.headers, ["x-query-id"]) ?? bodyTrace.queryId,
    sessionId: firstHeader(req.headers, ["x-opencode-session", "x-claude-code-session-id", "x-session-id", "x-parent-session-id", "helicone-session-id"])
      ?? bodyTrace.sessionId,
  };
}

function explicitResult(trace: ExplicitTraceContext, config: ClientIdentityConfig): ClientSessionResult {
  return {
    source: "explicit",
    action: config.mode,
    confidence: 1,
    ...(trace.requestId ? { requestId: trace.requestId } : {}),
    ...(trace.traceId ? { traceId: trace.traceId } : {}),
    ...(trace.queryId ? { queryId: trace.queryId } : {}),
    ...(trace.sessionId ? { sessionId: trace.sessionId, upstreamSessionId: trace.sessionId } : {}),
  };
}

function withTraceContext(session: ClientSessionResult, trace: ExplicitTraceContext): ClientSessionResult {
  if (!trace.requestId && !trace.traceId && !trace.queryId) return session;
  return {
    ...session,
    ...(trace.requestId ? { requestId: trace.requestId } : {}),
    ...(trace.traceId ? { traceId: trace.traceId } : {}),
    ...(trace.queryId ? { queryId: trace.queryId } : {}),
  };
}

function hasTraceContext(trace: ExplicitTraceContext): boolean {
  return Boolean(trace.requestId || trace.traceId || trace.queryId || trace.sessionId);
}

function firstHeader(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function bodyMetadataTrace(body: string | undefined, parsedBody?: unknown): ExplicitTraceContext {
  if (!body) return {};
  try {
    const parsed = (parsedBody !== undefined ? parsedBody : JSON.parse(body)) as Record<string, unknown>;
    const metadata = parsed?.metadata as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== "object") return {};
    return {
      requestId: stringProperty(metadata, ["requestId", "request_id"]),
      traceId: stringProperty(metadata, ["traceId", "trace_id"]),
      queryId: stringProperty(metadata, ["queryId", "query_id"]),
      sessionId: stringProperty(metadata, ["sessionId", "session_id", "conversationId", "conversation_id"]),
    };
  } catch {
    return {};
  }
}

function stringProperty(obj: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function canonicalize(body: string | undefined, format: Format, fallbackModel: string, parsedBody?: unknown): CanonicalRequest | null {
  if (!body) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = (parsedBody !== undefined ? parsedBody : JSON.parse(body)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const model = typeof parsed.model === "string" ? parsed.model : fallbackModel;
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  if (messages.length === 0) return null;

  const identity = {
    format,
    model,
    system: parsed.system,
    developer: messages.filter((m: unknown) => typeof m === "object" && m !== null && (m as Record<string, unknown>).role === "developer"),
    tools: parsed.tools,
    tool_choice: parsed.tool_choice,
    messages,
  };
  return { model, identity, messages };
}

function findLinearParent(canonical: CanonicalRequest, nodes: Map<string, StoredNode>): StoredNode | null {
  if (canonical.messages.length < 3) return null;
  const prefix = {
    ...(canonical.identity as Record<string, unknown>),
    messages: canonical.messages.slice(0, -2),
  };
  if ((prefix.messages as unknown[]).length === 0) return null;
  return nodes.get(hashJson(prefix)) ?? null;
}

function newSession(): StoredNode {
  const upstreamSessionId = crypto.randomUUID();
  return {
    nodeHash: "",
    sessionId: `ses_${upstreamSessionId.replace(/-/g, "").slice(0, 12)}`,
    upstreamSessionId,
    lastSeenAt: Date.now(),
  };
}

/**
 * SHA-256 of the identity's stable stringification: keys sorted, no
 * whitespace, leaves as JSON.stringify writes them. The text is fed to the
 * hash piece by piece instead of being built first (ticket 20): building it
 * joined a full copy of the conversation at every nesting level. The digest is
 * that of the whole text, including its quirks: an object property whose value
 * JSON.stringify drops (undefined, e.g. an absent `system`) is written as the
 * word `undefined`, such an array element as nothing. Called with objects only.
 */
function hashJson(value: unknown): string {
  const hash = nodeCrypto.createHash("sha256");
  let pending = "";
  const write = (text: string): void => {
    if (text.length >= STABLE_FLUSH_CHARS) {
      if (pending) { hash.update(pending, "utf-8"); pending = ""; }
      hash.update(text, "utf-8");
      return;
    }
    pending += text;
    if (pending.length >= STABLE_FLUSH_CHARS) { hash.update(pending, "utf-8"); pending = ""; }
  };
  writeStable(value, write, "undefined");
  if (pending) hash.update(pending, "utf-8");
  return hash.digest("hex");
}

/** Small pieces are batched into one hash update of up to this many UTF-16 units. */
const STABLE_FLUSH_CHARS = 16 * 1024;

/**
 * Write the stable stringification of `value` in pieces. Pieces are whole
 * JSON tokens, so no surrogate pair is split between two hash updates.
 * `dropped` is the text for a leaf JSON.stringify drops: "undefined" in an
 * object property (template interpolation), "" in an array element
 * (Array.prototype.join).
 */
function writeStable(value: unknown, write: (text: string) => void, dropped: string): void {
  if (value === null || typeof value !== "object") {
    const leaf = JSON.stringify(value) as string | undefined;
    write(leaf === undefined ? dropped : leaf);
    return;
  }
  if (Array.isArray(value)) {
    write("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) write(",");
      writeStable(value[i], write, "");
    }
    write("]");
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  write("{");
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) write(",");
    write(JSON.stringify(keys[i]));
    write(":");
    writeStable(obj[keys[i]], write, "undefined");
  }
  write("}");
}
