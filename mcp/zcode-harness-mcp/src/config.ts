/**
 * Bridge configuration: CLI arguments + environment, no secrets beyond the
 * HTTP bearer key (which never leaves the local machine).
 *
 * Validation is strict: unknown flags are a hard error. A typo like
 * `--read-onyl` must not silently disable the intended read-only mode.
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
  /**
   * Whether MCP clients may select the harness "yolo" permission mode
   * (no permission prompts). Off by default: it would let a client bypass
   * the interaction policy entirely (audit D-02). Operator opt-in only.
   */
  allowYolo: boolean;
  /** Bearer token required by HTTP transport (stdio needs none). */
  httpKey: string | null;
  runtimePathOverride: string | null;
  dataDir: string;
  allowWorkspaces: string[];
  /** Auto-answer policy for tool permission requests raised by the harness. */
  interactionPolicy: InteractionPolicy;
  /** Exact tool names auto-approved when interactionPolicy === "allowlist". */
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

/** Hosts an HTTP bridge may bind to: loopback only, by design. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(h) || LOOPBACK_HOSTS.has(`[${h}]`)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function positiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid ${label}: ${String(value)} (must be a positive integer)`);
  }
  return value;
}

export function parseConfig(argv: string[]): BridgeConfig {
  const args = [...argv];
  const config: BridgeConfig = {
    transport: "stdio",
    port: Number(process.env.ZCODE_HARNESS_HTTP_PORT ?? 3322),
    host: process.env.ZCODE_HARNESS_HTTP_HOST ?? "127.0.0.1",
    readOnly: false,
    allowYolo: process.env.ZCODE_HARNESS_ALLOW_YOLO === "1",
    httpKey: process.env.ZCODE_HARNESS_HTTP_KEY ?? null,
    runtimePathOverride: process.env.ZCODE_HARNESS_RUNTIME_PATH ?? null,
    dataDir: defaultDataDir(),
    allowWorkspaces: splitList(process.env.ZCODE_HARNESS_ALLOW_WORKSPACES),
    interactionPolicy:
      (process.env.ZCODE_HARNESS_INTERACTION_POLICY as InteractionPolicy | undefined) ?? "deny",
    interactionAllowlist: splitList(process.env.ZCODE_HARNESS_INTERACTION_ALLOWLIST?.replace(/,/g, ";")),
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
    const a = args[i] ?? "";
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
      case "--allow-yolo":
        config.allowYolo = true;
        break;
      case "--http-key":
        config.httpKey = next() || null;
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
      case "--help":
      case "-h":
        // handled by the caller (prints usage); recognized here as valid
        break;
      default:
        if (a.startsWith("-")) {
          throw new Error(
            `unknown option "${a}" — refusing to start with a possibly-misspelled flag ` +
              `(e.g. --read-onyl instead of --read-only would silently enable writes)`,
          );
        }
        break;
    }
  }

  if (config.interactionPolicy !== "allowlist" && config.interactionPolicy !== "deny" && config.interactionPolicy !== "ask") {
    throw new Error(`invalid interaction policy: ${String(config.interactionPolicy)}`);
  }
  positiveInt(config.port, "port");
  if (config.port > 65535) throw new Error(`invalid port: ${String(config.port)}`);
  positiveInt(config.interactionTimeoutSec, "interaction timeout");
  positiveInt(config.maxConcurrentTasks, "max concurrent tasks");
  positiveInt(config.taskQueueLimit, "task queue limit");
  positiveInt(config.defaultRequestTimeoutMs, "request timeout");
  positiveInt(config.maxArtifactBytes, "max artifact bytes");
  if (config.interactionPolicy === "allowlist" && config.interactionAllowlist.length === 0) {
    throw new Error('interaction policy "allowlist" requires --interaction-allowlist entries (deny-by-default otherwise)');
  }
  if (config.transport === "http") {
    if (!isLoopbackHost(config.host)) {
      throw new Error(
        `refusing to bind HTTP transport to non-loopback host "${config.host}" — ` +
          `the bridge exposes desktop control and only supports 127.0.0.1 / localhost / ::1`,
      );
    }
    if (!config.httpKey) {
      throw new Error(
        "HTTP transport requires --http-key (or ZCODE_HARNESS_HTTP_KEY) — " +
          "the bridge never serves unauthenticated requests; prefer stdio when in doubt",
      );
    }
  }
  return config;
}
