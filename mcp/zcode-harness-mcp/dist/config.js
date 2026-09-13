/**
 * Bridge configuration: CLI arguments + environment, no secrets.
 */
import path from "node:path";
import os from "node:os";
function defaultDataDir() {
    return process.env.ZCODE_HARNESS_DATA_DIR ?? path.join(os.homedir(), ".zcode-harness-mcp");
}
function splitList(v) {
    if (!v)
        return [];
    return v
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
export function parseConfig(argv) {
    const args = [...argv];
    const config = {
        transport: "stdio",
        port: Number(process.env.ZCODE_HARNESS_HTTP_PORT ?? 3322),
        host: process.env.ZCODE_HARNESS_HTTP_HOST ?? "127.0.0.1",
        readOnly: false,
        runtimePathOverride: process.env.ZCODE_HARNESS_RUNTIME_PATH ?? null,
        dataDir: defaultDataDir(),
        allowWorkspaces: splitList(process.env.ZCODE_HARNESS_ALLOW_WORKSPACES),
        interactionPolicy: process.env.ZCODE_HARNESS_INTERACTION_POLICY ?? "deny",
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
        const next = () => {
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
                    if (t)
                        config.allowWorkspaces.push(t);
                }
                break;
            }
            case "--interaction-policy":
                config.interactionPolicy = next();
                break;
            case "--interaction-allowlist": {
                const v = next();
                for (const part of v.split(",")) {
                    const t = part.trim();
                    if (t)
                        config.interactionAllowlist.push(t);
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
