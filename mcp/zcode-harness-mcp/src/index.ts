/**
 * zcode-harness-mcp entrypoint.
 *
 *   node dist/index.js --stdio                 (default)
 *   node dist/index.js --http --port 3322 --host 127.0.0.1
 *   node dist/index.js --read-only --allow-workspace "C:\path"
 */
import { parseConfig } from "./config.js";
import { discoverRuntime } from "./discovery.js";
import { JsonStore } from "./store/store.js";
import { WorkspaceAllowlist } from "./security/allowlist.js";
import { InteractionManager } from "./interactions/manager.js";
import { RuntimeManager } from "./runtime/manager.js";
import { TaskManager } from "./tasks/manager.js";
import { SettingsManager } from "./settings/manager.js";
import { RuntimeManagerHolder } from "./mcp/runtime-holder.js";
import { serveStdio, serveHttp, type BridgeServerOptions } from "./mcp/server.js";
import type { ToolContext } from "./mcp/tools.js";
import type { ResourceContext } from "./mcp/resources.js";
import { setLogLevel } from "./util/log.js";
import { createLogger } from "./util/log.js";

const log = createLogger("index");

async function main(): Promise<void> {
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) {
    process.stdout.write("Usage: zcode-harness-mcp [--stdio | --http --http-key KEY] [--allow-workspace PATH] [--data-dir PATH] [--runtime-path FILE] [--read-only] [--allow-yolo] [--interaction-policy deny|ask|allowlist] [--interaction-allowlist TOOL,TOOL]\n");
    return;
  }
  const config = parseConfig(process.argv.slice(2));
  const level = process.env.ZCODE_HARNESS_LOG_LEVEL;
  if (level) {
    if (!["debug", "info", "warn", "error"].includes(level)) throw new Error("invalid ZCODE_HARNESS_LOG_LEVEL");
    setLogLevel(level as "debug" | "info" | "warn" | "error");
  }

  // Data dir + store
  const store = new JsonStore(config.dataDir);

  // Workspace allowlist: CLI/env entries plus the bridge-managed workspace dir.
  const managedWorkspaces = store.ensureDir("workspaces");
  const allowlist = new WorkspaceAllowlist([...config.allowWorkspaces, managedWorkspaces]);

  // Runtime discovery (throws with candidate list when nothing found).
  let runtimeInfo;
  let discoveryError: string | null = null;
  const runtimeHolder = { current: null as RuntimeManager | null, note: "discovery pending" };
  try {
    runtimeInfo = await discoverRuntime({ runtimePathOverride: config.runtimePathOverride });
  } catch (err) {
    // Scenario 1 (acceptance): clear diagnosis without crashing, no invented status.
    const message = err instanceof Error ? err.message : String(err);
    discoveryError = message;
    runtimeHolder.note = message;
    log.error("runtime discovery failed; starting degraded", { error: message });
  }

  const interactions = new InteractionManager(store, config.interactionPolicy, config.interactionAllowlist, config.interactionTimeoutSec);
  let runtime: RuntimeManager | null = null;
  let tasks: TaskManager | null = null;

  // Lazy runtime proxy: resolves the real manager once constructed; before
  // that, diagnostics() reports the honest degraded state and every harness
  // call fails with a clear diagnosis (degraded mode, no crash).
  const lazyRuntime = new Proxy({} as RuntimeManager, {
    get(_target, prop) {
      const rt = runtimeHolder.current;
      if (rt !== null) {
        const value = Reflect.get(rt as object, prop);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(rt) : value;
      }
      if (prop === "diagnostics") {
        return () => ({ running: false, degraded: true, error: runtimeHolder.note, harnessVersion: null, harnessPath: "", bundleFingerprint: null, desktopVersion: null, lastExit: null, sawTraffic: false, nodeProgram: "node" });
      }
      throw new Error(`harness runtime unavailable: ${runtimeHolder.note}`);
    },
  });
  const settings = new SettingsManager(lazyRuntime);

  if (runtimeInfo) {
    runtime = new RuntimeManager(config, runtimeInfo, interactions);
    runtimeHolder.current = runtime;
    RuntimeManagerHolder.set(runtime);
    tasks = new TaskManager(runtime, interactions, store, config);
    tasks.restore();
    const wiring = tasks.attach();
    runtime.onEvent((evt) => wiring.onEvent(evt));
    runtime.onReverseRequest((ctx) => wiring.onReverseRequest(ctx));
    runtime.setCrashHandler(() => {
      tasks?.stopAll("harness exited; unfinished work was interrupted");
      log.warn("harness crash detected; active tasks interrupted");
    });
  }

  const toolCtx: ToolContext = {
    config,
    runtime: runtime ?? lazyRuntime,
    runtimeInfo: runtimeInfo ?? {
      harnessPath: "",
      nodeProgram: "node" as const,
      harnessVersion: null,
      bundleFingerprint: null,
      bundleBytes: null,
      desktopVersion: null,
      source: "default-candidates",
      candidatesConsidered: [],
    },
    tasks: tasks ?? (new Proxy({} as TaskManager, {
      get() {
        throw new Error(`task manager unavailable: ${discoveryError ?? "harness runtime not discovered"}`);
      },
    })),
    interactions,
    settings,
    allowlist,
    store,
    startedAt: new Date().toISOString(),
  };
  const resourceCtx: ResourceContext = {
    tasks: toolCtx.tasks,
    interactions,
    settings,
    allowlist,
    maxArtifactBytes: config.maxArtifactBytes,
  };

  const opts: BridgeServerOptions = {
    toolCtx,
    resourceCtx,
    serverInfo: { name: "zcode-harness-mcp", version: "0.1.0" },
  };

  let closeTransport: (() => Promise<void>) | undefined;
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down");
    void closeTransport?.().catch((err: unknown) => log.warn("transport close failed", { error: String(err) }));
    try {
      tasks?.stopAll();
    } catch {
      /* ignore */
    }
    try {
      runtime?.stop();
    } catch {
      /* ignore */
    }
    process.exitCode = 0;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (config.transport === "http") {
    // parseConfig already enforces a key for http; the assert documents that
    // this call site can never start an unauthenticated server.
    if (!config.httpKey) throw new Error("HTTP transport requires --http-key (refusing to serve unauthenticated)");
    closeTransport = await serveHttp(opts, config.host, config.port, config.httpKey);
  } else {
    process.stdin.once("end", shutdown);
    closeTransport = await serveStdio(opts);
    if (process.stdin.readableEnded) shutdown();
  }
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
