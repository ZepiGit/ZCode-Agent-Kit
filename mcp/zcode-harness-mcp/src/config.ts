/**
 * Bridge configuration: CLI arguments + environment, no secrets.
 */
import path from "node:path";
import os from "node:os";

export type TransportMode = "stdio" | "http";
export type InteractionPolicy = "deny" | "allowlist" | "ask";

export interface BridgeConfig {
  transport: TransportMode;
  port: number;
  host: string;
  readOnly: boolean;
  runtimePathOverride: string | null;
  dataDir: string;
  allowWorkspaces: string[];
  /** Auto-answer policy for tool permission requests raised by the harness. */
  interactionPolicy: InteractionPolicy;
  /** Tool-name prefixes auto-approved when interactionPolicy === "allowlist". */
  interactionAllowlist: string[];
  /** Seconds before an unanswered interaction is resolved with the safe default. */
  interactionTimeoutSec: number;
  maxConcurrentTasks: number;
  taskQueueLimit: number;
  defaultRequestTimeoutMs: number;
  maxArtifactBytes: number;
  /** Values answered for session/requestRuntimePreferences reverse calls. */
  runtimePreferences: {
    nativeSearchEnhancementsEnabled: boolean;
    memoryEnabled: boolean;
    askUserQuestionAutoResolutionEnabled: boolean;
    modelContextBudgetStrategy: "legacy" | "preflight-v1";
  };
  /** Static headers relayed for interaction/requestProviderRuntimeHeaders (operator-provided). */
  providerRuntimeHeaders: Record<string, string> | null;
}

function defaultDataDir(): string {
  return process.env.ZCODE_HARNESS_DATA_DIR ?? path.join(os.homedir(), ".zcode-harness-mcp");
}

function splitList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseConfig(argv: string[]): BridgeConfig {
  const args = [...argv];
  const config: BridgeConfig = {
    transport: "stdio",
    port: Number(process.env.ZCODE_HARNESS_HTTP_PORT ?? 3322),
    host: process.env.ZCODE_HARNESS_HTTP_HOST ?? "127.0.0.1",
    readOnly: false,
    runtimePathOverride: process.env.ZCODE_HARNESS_RUNTIME_PATH ?? null,
    dataDir: defaultDataDir(),
    allowWorkspaces: splitList(process.env.ZCODE_HARNESS_ALLOW_WORKSPACES),
    interactionPolicy:
      (process.env.ZCODE_HARNESS_INTERACTION_POLICY as InteractionPolicy | undefined) ?? "deny",
    interactionAllowlist: splitList(process.env.ZCODE_HARNESS_INTERACTION_ALLOWLIST),
    interactionTimeoutSec: Number(process.env.ZCODE_HARNESS_INTERACTION_TIMEOUT_SEC ?? 300),
    maxConcurrentTasks: Number(process.env.ZCODE_HARNESS_MAX_CONCURRENT_TASKS ?? 2),
    taskQueueLimit: Number(process.env.ZCODE_HARNESS_TASK_QUEUE_LIMIT ?? 50),
    defaultRequestTimeoutMs: Number(process.env.ZCODE_HARNESS_REQUEST_TIMEOUT_MS ?? 60_000),
    maxArtifactBytes: Number(process.env.ZCODE_HARNESS_MAX_ARTIFACT_BYTES ?? 10 * 1024 * 1024),
    runtimePreferences: {
      nativeSearchEnhancementsEnabled: false,
      memoryEnabled: false,
      askUserQuestionAutoResolutionEnabled: true,
      modelContextBudgetStrategy: "preflight-v1",
    },
    providerRuntimeHeaders: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = (): string => {
      const v = args[i + 1];
      i += 1;
      return v ?? "";
    };
    switch (a) {
      case "--stdio":
        config.transport = "stdio";
        break;
      case "--http":
        config.transport = "http";
        break;
      case "--port":
        config.port = Number(next());
        break;
      case "--host":
        config.host = next();
        break;
      case "--read-only":
        config.readOnly = true;
        break;
      case "--runtime-path":
        config.runtimePathOverride = next();
        break;
      case "--data-dir":
        config.dataDir = next();
        break;
      case "--allow-workspace": {
        const v = next();
        for (const part of v.split(";")) {
          const t = part.trim();
          if (t) config.allowWorkspaces.push(t);
        }
        break;
      }
      case "--interaction-policy":
        config.interactionPolicy = next() as InteractionPolicy;
        break;
      case "--interaction-allowlist": {
        const v = next();
        for (const part of v.split(",")) {
          const t = part.trim();
          if (t) config.interactionAllowlist.push(t);
        }
        break;
      }
      case "--interaction-timeout-sec":
        config.interactionTimeoutSec = Number(next());
        break;
      case "--max-concurrent-tasks":
        config.maxConcurrentTasks = Number(next());
        break;
      default:
        // Unknown args are ignored so that MCP client launch configs stay simple.
        break;
    }
  }

  if (config.interactionPolicy !== "allowlist" && config.interactionPolicy !== "deny" && config.interactionPolicy !== "ask") {
    throw new Error(`invalid interaction policy: ${String(config.interactionPolicy)}`);
  }
  if (!Number.isFinite(config.port) || config.port <= 0 || config.port > 65535) {
    throw new Error(`invalid port: ${String(config.port)}`);
  }
  return config;
}
