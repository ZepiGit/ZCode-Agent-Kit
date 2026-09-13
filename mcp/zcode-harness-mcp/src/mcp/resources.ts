/**
 * MCP resources — every URI is really readable via ReadResourceRequest.
 * The same content is available through tools for clients without resource
 * support (parity requirement).
 */
import type { TaskManager } from "../tasks/manager.js";
import type { InteractionManager } from "../interactions/manager.js";
import type { SettingsManager } from "../settings/manager.js";
import type { WorkspaceAllowlist } from "../security/allowlist.js";
import { resolveInsideWorkspace } from "../security/allowlist.js";
import { capabilitiesForMcp, BRIDGE_VERSION, TARGET_PROTOCOL } from "../capabilities/registry.js";
import { redactDeep } from "../security/redact.js";
import { parseSessionId } from "../protocol/types.js";
import fs from "node:fs";

export interface ResourceContext {
  tasks: TaskManager;
  interactions: InteractionManager;
  settings: SettingsManager;
  allowlist: WorkspaceAllowlist;
}

export const RESOURCE_ROOTS = [
  { uri: "zcode://capabilities", name: "Capability registry", description: "All known harness capabilities with status", mimeType: "application/json" },
];

export function listResources(ctx: ResourceContext): Array<{ uri: string; name: string; description?: string; mimeType?: string }> {
  const out: Array<{ uri: string; name: string; description?: string; mimeType?: string }> = [...RESOURCE_ROOTS];
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

export async function readResource(ctx: ResourceContext, uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const send = (text: string, mimeType = "application/json"): { contents: Array<{ uri: string; mimeType: string; text: string }> } => ({
    contents: [{ uri, mimeType, text }],
  });

  if (uri === "zcode://capabilities") {
    return send(JSON.stringify({ bridgeVersion: BRIDGE_VERSION, protocol: TARGET_PROTOCOL, capabilities: capabilitiesForMcp() }, null, 2));
  }

  const mTask = uri.match(/^zcode:\/\/tasks\/([\w-]+)\/(status|result|events)$/);
  if (mTask) {
    const taskId = mTask[1]!;
    const kind = mTask[2]!;
    if (kind === "status") {
      const rec = ctx.tasks.get(taskId);
      if (!rec) throw new Error(`unknown task: ${taskId}`);
      return send(JSON.stringify(rec, null, 2));
    }
    if (kind === "result") {
      return send(JSON.stringify(await ctx.tasks.buildResult(taskId), null, 2));
    }
    const evs = ctx.tasks.events(taskId, -1, 100_000);
    return send(evs.items.map((e) => JSON.stringify(e)).join("\n"), "application/x-ndjson");
  }

  const mSession = uri.match(/^zcode:\/\/sessions\/(sess_[A-Za-z0-9._-]+)$/);
  if (mSession) {
    const sessionId = parseSessionId(mSession[1]!);
    if (!sessionId) throw new Error(`invalid session id in ${uri}`);
    const { RuntimeManagerHolder } = await import("./runtime-holder.js");
    const runtime = RuntimeManagerHolder.get();
    return send(JSON.stringify(redactDeep(await runtime.ipcSessionRead(sessionId)), null, 2));
  }

  const mArtifact = uri.match(/^zcode:\/\/artifacts\/(.+)$/);
  if (mArtifact) {
    const raw = decodeURIComponent(mArtifact[1]!);
    // artifact id format: <abs-path> registered by a task; enforce allowlist.
    const canonical = ctx.allowlist.check(raw);
    if (!canonical) throw new Error(`artifact path not allowlisted: ${raw}`);
    const abs = resolveInsideWorkspace(canonical, raw);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(`not a file: ${abs}`);
    const sizeCap = 1_048_576;
    const len = Math.min(st.size, sizeCap);
    const fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(len);
    try {
      if (len > 0) fs.readSync(fd, buf, 0, len, 0);
    } finally {
      fs.closeSync(fd);
    }
    return send(
      JSON.stringify({ path: abs, size: st.size, truncated: st.size > len, contentBase64: buf.toString("base64") }, null, 2),
      "application/json"
    );
  }

  throw new Error(`unknown resource: ${uri}`);
}
