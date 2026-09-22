/**
 * Entry point — load config, create auth manager, start proxy server.
 * @see .omo/plans/zcode-proxy.md Task 7
 */
import { loadConfig } from "./config/loader.js";
import { createStoredAuthManagerWithAccounts } from "./auth/runtime.js";
import { importFromZCodeConfig } from "./auth/desktop.js";
import { startServer, type ProxyServer } from "./server/server.js";
import { startControlListener, LogBuffer, type ControlState } from "./android/control.js";
import { loadCredential, saveCredential, clearCredential, getStorePath } from "./auth/store.js";
import { ZaiOAuthClient, BigmodelOAuthClient, LOGIN_TIMEOUT_MS, parsePastedCallbackUrl, type OAuthResult } from "./auth/oauth.js";
import { KeyResolver } from "./auth/resolver.js";
import type { Credential } from "./auth/types.js";
import type { ProviderId } from "./provider/types.js";
import type { ProxyConfig } from "./config/types.js";
import { updateConfigYaml, ensureConfigFile } from "./config/edit.js";
import { openBrowser } from "./runtime/open-browser.js";
import { pasteLoginInstructions, readPastedLine, boldIfTTY } from "./runtime/paste-login.js";
import { buildServerOptions } from "./server/server-options.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureNodeFetchNoTimeouts } from "./runtime/node-fetch-compat.js";
import { installGuestErrorBoundary } from "./runtime/guest-error.js";
import {
  addAccount,
  getAccountStorePath,
  loadAccountStore,
  removeAccount,
} from "./auth/account-store.js";
import { createAccountRotator } from "./auth/account-rotator.js";

export const VERSION = "4.6.4";

if (require.main === module) main();

export interface ServeArgs {
  configPath?: string;
  debug: boolean;
}

/**
 * Parse `serve` subcommand arguments. The token `debug` toggles debug mode;
 * any other token is treated as the config path. Order-independent:
 *   []                → { debug: false }
 *   ["debug"]         → { debug: true }
 *   ["my.yaml"]       → { configPath: "my.yaml", debug: false }
 *   ["debug","x.yaml"] → { configPath: "x.yaml", debug: true }
 *   ["x.yaml","debug"] → { configPath: "x.yaml", debug: true }
 */
export function parseServeArgs(args: string[]): ServeArgs {
  const debug = args.includes("debug");
  const configPath = args.find((a) => a !== "debug");
  return { configPath, debug };
}

export function main(): void {
  // Fire-and-forget is race-safe: the dynamic import resolves in a microtask,
  // before the listener's event-loop callback can admit a request.
  void ensureNodeFetchNoTimeouts();
  try {
    runCli();
  } catch (err) {
    process.stderr.write(`zcode-proxy: uncaught error: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  }
}

function runCli(): void {
  const args = process.argv.slice(2);

  // `--cli` opts out of the default TUI and restores the classic CLI dispatch
  // (bare `--cli` = the old no-arg default: serve).
  if (args[0] === "--cli") {
    dispatchCli(args.slice(1));
    return;
  }
  // Default surface is the TUI. Bare invocation, the retired `tui` token
  // (kept as a silent alias), and tui-style args (`debug`, `*.yaml`) all land
  // here — the former `tui <args>` subcommand simply dropped its prefix.
  if (
    args.length === 0 ||
    args[0] === "tui" ||
    args[0] === "debug" ||
    args[0].endsWith(".yaml") ||
    args[0].endsWith(".yml")
  ) {
    launchTui(parseServeArgs(args[0] === "tui" ? args.slice(1) : args));
    return;
  }
  dispatchCli(args);
}

/** Classic CLI dispatch — subcommand routing where bare = serve. */
function dispatchCli(args: string[]): void {
  const cmd = args[0] ?? "serve";

  if (cmd === "auth") {
    authCommand(args.slice(1));
  } else if (cmd === "claim") {
    void claimCommand(args.slice(1));
  } else if (cmd === "android") {
    // Explicit catch: an async startup failure (e.g. control port already
    // bound by an orphaned process) must exit non-zero deterministically, not
    // surface as an unhandled rejection.
    runAndroid().catch((err: unknown) => {
      process.stderr.write(`zcode-proxy: android entry failed: ${(err as Error).stack ?? String(err)}\n`);
      process.exit(1);
    });
  } else if (cmd === "tui") {
    // Kept for muscle memory under `--cli`: the default dispatch already
    // routes `tui` to the TUI, but `--cli tui` should not regress to an error.
    launchTui(parseServeArgs(args.slice(1)));
  } else if (cmd === "serve" || cmd.endsWith(".yaml") || cmd.endsWith(".yml")) {
    const serveArgs = cmd === "serve"
      ? parseServeArgs(args.slice(1))
      : parseServeArgs(args);
    serve(serveArgs.configPath, serveArgs.debug);
  } else if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    console.log(`zcode-proxy ${VERSION}`);
  } else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
  } else {
    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  }
}

function launchTui(args: ServeArgs): void {
  // Dynamic import: the TUI module imports helpers back from this file, so a
  // static edge would create a load-time cycle (same pattern as claimCommand).
  import("./tui/app.js")
    .then((m) => m.runTui(args))
    .catch((err: unknown) => {
      process.stderr.write(`zcode-proxy: tui failed: ${(err as Error).stack ?? String(err)}\n`);
      process.exit(1);
    });
}

function printHelp(): void {
  console.log(`zcode-proxy ${VERSION}

Usage:
  zcode-proxy                       Interactive terminal UI (default):
                                    login, start/stop, live logs
  zcode-proxy [debug] [config.yaml] Same, with debug diagnostics / custom config
  zcode-proxy serve [config.yaml]   Start the proxy server (classic CLI mode)
  zcode-proxy serve debug [config.yaml]
                                    Start with verbose per-request diagnostics
  zcode-proxy --cli                 Classic CLI mode (bare --cli = serve)
  zcode-proxy android               Android entry: proxy + localhost control listener
  zcode-proxy auth login <provider> Login via OAuth (provider: zai | bigmodel)
  zcode-proxy auth login <provider> --account ID [--replace]
  zcode-proxy auth login <provider> --import
                                    Import API key from ~/.zcode/v2/config.json
  zcode-proxy auth logout           Clear stored credentials
  zcode-proxy auth status           Show current authentication state
  zcode-proxy auth accounts [--json]
                                    List configured accounts (redacted, offline)
  zcode-proxy auth accounts remove ID [--yes]
                                    Remove one configured account
  zcode-proxy claim [list|now]      List / claim weekend-plan trial packages
  zcode-proxy version               Show version
  zcode-proxy help                  Show this help

Examples:
  zcode-proxy                       Terminal UI: login, start/stop, live logs
  zcode-proxy debug                 Terminal UI with per-request diagnostics
  zcode-proxy serve debug           CLI: start with extra debug logging
  zcode-proxy auth login bigmodel   OAuth login for Bigmodel
  zcode-proxy auth login bigmodel --import
                                    Import existing key from ZCode config
  zcode-proxy auth status           Check if logged in
  zcode-proxy auth accounts --json  List account ids and redacted state
`);
}

async function serve(configPath: string | undefined, debug: boolean): Promise<void> {
  if (process.env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA === "1") installGuestErrorBoundary();
  const path = configPath ?? process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
  if (ensureConfigFile(path)) {
    ensureDeviceMidInConfig(path);
    console.log(`Created ${path} from bundled template.`);
    console.log(`Run: zcode-proxy auth login <zai|bigmodel>\n`);
  }
  const config = loadConfig(path);

  const auth = await createStoredAuthManagerWithAccounts(config.plan, {
    ...(config.auth.accounts ?? { enabled: false }),
    provider: config.provider,
  });
  let cred: Credential | null = null;
  if (!auth.isAccountPoolEnabled()) {
    cred = await loadCredential();
    if (!cred) {
      console.error("Not logged in. Run: zcode-proxy auth login " + config.provider);
      process.exit(1);
    }
    auth.setOAuthCredential(cred);
  } else {
    try { await auth.getCredential(); }
    catch (err) {
      console.error(`No usable configured account. Run: zcode-proxy auth login ${config.provider} --account ID`);
      if (debug) console.error((err as Error).message);
      process.exit(1);
    }
  }

  if (debug) printDebugBanner(config, path, cred);

  const server = await startServer(buildServerOptions(config, auth, debug));
  const url = `http://${server.hostname}:${server.port}`;
  console.log(`zcode-proxy listening on ${url}`);
  if (config.plan === "start-plan") {
    // Pre-solve the captcha token pool in the background so first requests
    // don't pay the full solve latency (in-process happy-dom backend).
    import("./proxy/captcha.js")
      .then((m) => m.startCaptchaPool(config.identity.appVersion))
      .catch((err) => console.error(`[captcha] pool warmup failed: ${(err as Error).message}`));
  }
  if (config.claim.enabled && config.claim.auto) {
    import("./claim/runtime.js")
      .then((m) => {
        m.startAutoClaim(config, auth);
        console.log(`  claim: auto ON (poll ${Math.round(config.claim.pollIntervalMs / 1000)}s)`);
      })
      .catch((err) => console.error(`[claim] scheduler failed to start: ${(err as Error).message}`));
  }
  console.log(`  provider: ${config.provider}`);
  console.log(`  plan: ${config.plan}`);
  console.log(`  models: ${config.models.length} available`);
  if (config.responses.enabled) console.log(`  /v1/responses: ON`);
  if (config.async.enabled) {
    console.log(config.plan === "coding-plan" ? `  /async/v1/*: ON` : `  /async/v1/*: OFF (requires plan "coding-plan")`);
  }
  if (debug) console.log(`  debug: ON`);

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.stop(true);
  });
  process.on("SIGTERM", () => {
    server.stop(true);
  });
}

/**
 * Desktop-Linux identity defaults for the Android entry (anti-pattern #34).
 * Without these, the Node process on Android reports its true host values:
 * `X-Platform: linux-arm64` and `X-Os-Version: 6.1.xx-android14-…` — a kernel
 * string no real ZCode desktop emits. `identity.ts` reads these env vars per
 * request, so setting them once here retargets every upstream call. Values are
 * deliberately CONSTANT (Ubuntu 24.04 x64 profile — the largest desktop-Linux
 * population): kernel strings are shared by millions of real machines, and
 * stability is required by anti-pattern #13 (never randomize fingerprints).
 * Explicit env values (adb shell setprop / NodeRunner) still win — each is set
 * with `??`, not unconditionally.
 */
export function applyAndroidIdentityDefaults(): void {
  process.env.ZCODE_IDENTITY_PLATFORM = process.env.ZCODE_IDENTITY_PLATFORM ?? "linux";
  process.env.ZCODE_IDENTITY_ARCH = process.env.ZCODE_IDENTITY_ARCH ?? "x64";
  process.env.ZCODE_IDENTITY_RELEASE = process.env.ZCODE_IDENTITY_RELEASE ?? "6.8.0-49-generic";
}

/**
 * Android entry — starts the proxy plus a localhost control listener.
 * Caller (Kotlin shell) must set env: ZCODE_CONTROL_PORT (control listener),
 * ZCODE_OAUTH_CALLBACK_PORT (fixed OAuth callback port for WebView redirect).
 */
async function runAndroid(): Promise<void> {
  applyAndroidIdentityDefaults();
  const path = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
  ensureConfigFile(path);
  const config = loadConfig(path);

  const logBuffer = new LogBuffer();
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => { logBuffer.push(args.join(" ")); origLog(...args); };
  console.error = (...args: unknown[]) => { logBuffer.push("[error] " + args.join(" ")); origErr(...args); };
  console.warn = (...args: unknown[]) => { logBuffer.push("[warn] " + args.join(" ")); origWarn(...args); };

  const auth = await createStoredAuthManagerWithAccounts(config.plan, {
    ...(config.auth.accounts ?? { enabled: false }),
    provider: config.provider,
  });

  const serverRef: { current: ProxyServer | null } = { current: null };

  async function startProxy(): Promise<{ ok: true; port: number } | { ok: false; error: string }> {
    if (serverRef.current) return { ok: false, error: "already_running" };
    if (!auth.isAccountPoolEnabled()) {
      const cred = await loadCredential().catch(() => null);
      if (!cred) return { ok: false, error: "not_logged_in" };
      auth.setOAuthCredential(cred);
    } else {
      try { await auth.getCredential(); }
      catch { return { ok: false, error: "not_logged_in" }; }
    }
    try {
      const s = await startServer(buildServerOptions(config, auth, false));
      serverRef.current = s;
      console.log(`zcode-proxy listening on http://${s.hostname}:${s.port}`);
      return { ok: true, port: s.port };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async function stopProxy(): Promise<{ ok: true } | { ok: false; error: string }> {
    const s = serverRef.current;
    if (!s) return { ok: false, error: "not_running" };
    try {
      s.stop(false);
      serverRef.current = null;
      console.log("zcode-proxy stopped");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async function setConfig(changes: {
    provider?: ProviderId;
    plan?: "coding-plan" | "start-plan";
  }): Promise<{ ok: true; provider: ProviderId; plan: "coding-plan" | "start-plan" } | { ok: false; error: string }> {
    if (serverRef.current) return { ok: false, error: "stop_proxy_first" };
    if (changes.provider) config.provider = changes.provider;
    if (changes.plan) config.plan = changes.plan;
    updateConfigYaml(path, { provider: config.provider, plan: config.plan });
    console.log(`config updated: provider=${config.provider} plan=${config.plan}`);
    return { ok: true, provider: config.provider, plan: config.plan };
  }

  console.log("control listener ready; proxy stopped — use startProxy command to start");

  if (config.claim.enabled && config.claim.auto) {
    import("./claim/runtime.js")
      .then((m) => {
        m.startAutoClaim(config, auth);
        console.log(`[claim] auto ON (poll ${Math.round(config.claim.pollIntervalMs / 1000)}s; waits for login)`);
      })
      .catch((err) => console.error(`[claim] scheduler failed to start: ${(err as Error).message}`));
  }

  const controlPort = Number(process.env.ZCODE_CONTROL_PORT ?? 0) || 0;
  const controlState: ControlState = {
    provider: config.provider,
    plan: config.plan,
    proxyPort: serverRef.current?.port ?? 0,
  };
  const controlListener = await startControlListener({
    capability: process.env.ZCODE_CONTROL_CAPABILITY,
    port: controlPort,
    state: controlState,
    logBuffer,
    onStartProxy: startProxy,
    onStopProxy: stopProxy,
    onSetConfig: setConfig,
    onShutdown: async () => {
      serverRef.current?.stop(true);
    },
  });

  console.log(`control listener: 127.0.0.1:${controlPort}`);
  console.log(`provider: ${config.provider}`);
  console.log(`plan: ${config.plan}`);

  process.on("SIGINT", () => {
    void controlListener.close().then(() => serverRef.current?.stop(true));
  });
  process.on("SIGTERM", () => {
    void controlListener.close().then(() => serverRef.current?.stop(true));
  });
}

function printDebugBanner(config: ProxyConfig, path: string, cred: Credential | null): void {
  const credShape = cred
    ? `<redacted> (${cred.apiKey.length} chars)`
    : "(none)";
  const active = config.providers[config.provider];
  console.log("=== zcode-proxy DEBUG MODE ===");
  console.log(`  config file: ${path}`);
  console.log(`  server: ${config.server.host}:${config.server.port}`);
  console.log(`  proxy api key: ${config.auth.proxyApiKey ? "required" : "open (no client auth)"}`);
  console.log(`  provider: ${config.provider}`);
  console.log(`  plan: ${config.plan}`);
  console.log(`  identity: appVersion=${config.identity.appVersion} sourceTitle=${config.identity.sourceTitle} referer=${config.identity.refererOrigin}`);
  console.log(`  client identity: mode=${config.clientIdentity.mode} ttl=${config.clientIdentity.ttlSeconds}s max=${config.clientIdentity.maxSessions}`);
  console.log(`  anthropic base: ${active.anthropicBase}`);
  console.log(`  openai base:    ${active.openaiBase}`);
  console.log(`  credential: ${credShape}`);
  console.log(`  models (${config.models.length}): ${config.models.join(", ")}`);
  console.log(`  log level: ${config.logging.level}`);
  console.log("===============================");
}

function authCommand(args: string[]): void {
  const sub = args[0];

  if (sub === "login") {
    void authLogin(args.slice(1));
  } else if (sub === "logout") {
    authLogout();
  } else if (sub === "status") {
    void authStatus();
  } else if (sub === "accounts") {
    void authAccounts(args.slice(1));
  } else {
    console.error("Usage: zcode-proxy auth <login|logout|status|accounts>");
    process.exit(1);
  }
}

async function claimCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "now";
  if (sub !== "list" && sub !== "now") {
    console.error("Usage: zcode-proxy claim [list|now]");
    process.exit(1);
  }
  const path = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
  if (!existsSync(path)) {
    console.error(`Config file not found: ${path} (run serve once or create it).`);
    process.exit(1);
  }
  // The billing gateway requires a stable X-Device-Mid — self-heal configs
  // created before the deviceMid feature (idempotent: reuses existing value).
  ensureDeviceMidInConfig(path);
  const config = loadConfig(path);
  try {
    const { runClaimCli } = await import("./claim/runtime.js");
    await runClaimCli(config, sub);
  } catch (err) {
    console.error(`claim failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function authLogin(args: string[]): Promise<void> {
  const provider = args[0] as ProviderId | undefined;
  const importMode = args.includes("--import");
  const accountIndex = args.indexOf("--account");
  const accountId = accountIndex >= 0 ? args[accountIndex + 1] : undefined;
  const replaceAccount = args.includes("--replace");
  // Headless paste login: --paste flag or ZCODE_OAUTH_PASTE=1 (docker-friendly).
  const pasteMode =
    args.includes("--paste") || /^(1|true|yes)$/i.test(process.env.ZCODE_OAUTH_PASTE ?? "");

  if (!provider || (provider !== "zai" && provider !== "bigmodel")) {
    console.error("Usage: zcode-proxy auth login <zai|bigmodel> [--import] [--paste] [--account ID] [--replace]");
    process.exit(1);
  }
  if (accountIndex >= 0 && (!accountId || accountId.startsWith("--"))) {
    console.error("--account requires an account ID.");
    process.exit(1);
  }
  if (pasteMode && provider !== "bigmodel") {
    console.error("--paste applies to the bigmodel auth-code flow only.");
    console.error("zai login is server-mediated (no localhost callback) and already works headless.");
    process.exit(1);
  }

  ensureConfigWithDeviceMid();

  const mode = importMode ? "(import)" : pasteMode ? "(OAuth, paste)" : "(OAuth)";
  console.log(`Logging in: ${provider} ${mode}\n`);

  let cred: Credential;

  if (importMode) {
    cred = importFromZCodeConfig(provider);
  } else {
    const { accessToken, userId, jwt } = await runOAuth(provider, pasteMode);
    console.log("\nResolving API key...");
    const resolver = new KeyResolver();
    cred = await resolver.resolveCodingPlanCredential(accessToken, provider, userId);
    if (jwt) cred.jwt = jwt;
  }

  if (accountId) {
    let accountOptions: { path?: string };
    try {
      accountOptions = accountStoreOptions();
      const configuredPlan = (() => {
        try {
          const cfgPath = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
          return existsSync(cfgPath) ? loadConfig(cfgPath).plan : undefined;
        } catch { return undefined; }
      })();
      await addAccount({
        id: accountId,
        credential: cred,
        createdAt: Date.now(),
        plan: configuredPlan ?? (process.env.ZCODE_PROXY_PLAN === "start-plan" ? "start-plan" : "coding-plan"),
      }, { ...accountOptions, replace: replaceAccount });
    } catch (err) {
      console.error(`Account login failed: ${safeAccountError(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nLogged in as ${provider} (account ${accountId}).`);
    console.log(`  Stored: ${getAccountStorePath(accountOptions.path)}`);
    return;
  }

  await saveCredential(cred);
  console.log(`\nLogged in as ${provider}.`);
  console.log(`  API Key: ${cred.apiKey.substring(0, 12)}...`);
  if (cred.userId) console.log(`  User ID: ${cred.userId}`);
  console.log(`  Stored:  ${getStorePath()}`);
}

/**
 * Resolve an optional configured account-store path without starting the
 * proxy or creating a config. Environment remains the authoritative override;
 * the YAML path is only consulted when it is already present and valid.
 */
function accountStoreOptions(): { path?: string } {
  if (process.env.ZCODE_PROXY_ACCOUNTS_PATH) return {};
  const path = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
  if (!existsSync(path)) return {};
  try {
    const configured = loadConfig(path).auth.accounts?.path;
    if (!configured) return {};
    // Leave tilde shorthand intact; account-store.ts owns its normalization
    // so the special value "~" still resolves to the default accounts.json
    // file rather than the home directory itself.
    return { path: configured };
  } catch {
    // A present but malformed config must never make a mutating account
    // command silently target the default store instead of the configured
    // pool. Callers surface this as a bounded, secret-free error.
    throw new Error("proxy config is unavailable; set ZCODE_PROXY_ACCOUNTS_PATH explicitly");
  }
}

function safeAccountError(err: unknown): string {
  // AccountStoreError messages are intentionally short, but never echo an
  // arbitrary provider/error string in a CLI surface that promises redaction.
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (["invalid", "locked", "corrupt", "conflict"].includes(code)) return (err as Error).message;
  return "account store operation failed";
}

async function authAccounts(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "remove") {
    const id = args[1];
    if (!id || id.startsWith("--")) {
      console.error("Usage: zcode-proxy auth accounts remove ID [--yes]");
      process.exitCode = 2;
      return;
    }
    if (!args.includes("--yes")) {
      console.error(`This removes account \"${id}\" from the encrypted account pool.`);
      console.error("Re-run with --yes to confirm. The account's Desktop login is not touched.");
      process.exitCode = 2;
      return;
    }
    try {
      const options = accountStoreOptions();
      const removed = await removeAccount(id, options);
      if (!removed) {
        console.error(`Account not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Removed account: ${id}`);
    } catch (err) {
      console.error(`Account removal failed: ${safeAccountError(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub && sub.startsWith("-")) {
    // `accounts --json` is the common spelling; all flags are handled below.
  } else if (sub !== undefined) {
    console.error("Usage: zcode-proxy auth accounts [--json] | auth accounts remove ID [--yes]");
    process.exitCode = 2;
    return;
  }

  try {
    const options = accountStoreOptions();
    // The rotator's bounded view includes local cooldown state (exhausted)
    // while still omitting every credential field. Decrypting the pool here is
    // offline only; no upstream/quota request is made.
    const records = (createAccountRotator(await loadAccountStore(options)).list())
      .map(({ lastFailureReason: _redacted, ...record }) => record);
    if (args.includes("--json")) {
      console.log(JSON.stringify({ accounts: records }, null, 2));
      return;
    }
    if (records.length === 0) {
      console.log("No accounts configured.");
      console.log("Add one with: zcode-proxy auth login <zai|bigmodel> --account ID");
      return;
    }
    console.log("Configured accounts:");
    for (const account of records) {
      const label = account.label ? ` (${account.label.replace(/[\r\n\t]+/g, " ").slice(0, 120)})` : "";
      const plan = account.plan ? ` plan=${account.plan}` : "";
      console.log(`  ${account.id}${label}  provider=${account.provider}${plan}  state=${account.state}  credential=${account.credentialPreview}`);
    }
    console.log(`  store: ${getAccountStorePath(options.path)}`);
  } catch (err) {
    const message = `Account listing failed: ${safeAccountError(err)}`;
    if (args.includes("--json")) console.log(JSON.stringify({ accounts: [], error: message }, null, 2));
    else console.error(message);
    process.exitCode = 1;
  }
}

/**
 * Ensure config.yaml exists and carries a stable `identity.deviceMid`.
 * Creates the file from the bundled template when missing (desktop flow;
 * Android's mid comes from NodeRunner env injection instead and is never
 * written here). Returns the mid (existing or freshly generated).
 */
function ensureConfigWithDeviceMid(): string {
  const path = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
  if (ensureConfigFile(path)) {
    console.log(`Created ${path} from bundled template.`);
  }
  return ensureDeviceMidInConfig(path);
}

/**
 * Generate-or-reuse `identity.deviceMid` in a YAML config via targeted line
 * edit (comments preserved): fills an empty `deviceMid:` value, inserts one
 * under a block-style `identity:` key, or appends a new `identity:` block when
 * the key is absent entirely. Idempotent — an existing non-empty value is
 * returned untouched. The regexes are function-local on purpose: `main()` runs
 * synchronously at module top (before later top-level statements initialize),
 * so any module-level const this function touches would still be undefined on
 * the boot-time `serve` path.
 */
export function ensureDeviceMidInConfig(path: string): string {
  const deviceMidLine = /^(\s*)deviceMid:\s*(.*)$/m;
  const identityBlockLine = /^identity:\s*$/m;
  const raw = readFileSync(path, "utf-8");

  const existing = deviceMidLine.exec(raw);
  if (existing) {
    const value = existing[2].trim().replace(/^"|"$/g, "");
    if (value.length > 0) return value;
  }

  const mid = randomUUID();
  let updated: string;
  if (existing) {
    updated = raw.replace(deviceMidLine, `${existing[1]}deviceMid: "${mid}"`);
  } else if (identityBlockLine.test(raw)) {
    updated = raw.replace(identityBlockLine, `identity:\n  deviceMid: "${mid}"`);
  } else {
    const block = `identity:\n  deviceMid: "${mid}"\n`;
    updated = raw.endsWith("\n") || raw.length === 0 ? raw + block : raw + "\n" + block;
  }
  writeFileSync(path, updated, "utf-8");
  console.log(`Device identity generated: ${mid.slice(0, 8)}… (stored in ${path})`);
  return mid;
}

function authLogout(): void {
  if (!existsSync(getStorePath())) {
    console.log("Not logged in.");
    return;
  }
  clearCredential();
  console.log("Logged out. Credentials removed.");
}

async function authStatus(): Promise<void> {
  // An enabled pool is authoritative. Do not report the legacy credentials
  // file as logged out when the configured accounts are healthy (the pool may
  // intentionally have no compatibility credentials.json at all).
  try {
    const cfgPath = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
    if (existsSync(cfgPath)) {
      const config = loadConfig(cfgPath);
      if (config.auth.accounts?.enabled) {
        const records = createAccountRotator(await loadAccountStore(accountStoreOptions()), {
          plan: config.plan,
          provider: config.provider,
        }).list();
        const usable = records.filter((record) => record.state === "ready" || record.state === "active");
        console.log(`Account pool: ${usable.length > 0 ? "logged in" : "not logged in"}`);
        console.log(`  Accounts: ${records.length} configured, ${usable.length} usable`);
        console.log(`  Store:    ${getAccountStorePath(accountStoreOptions().path)}`);
        return;
      }
    }
  } catch (err) {
    console.error(`Account pool status unavailable: ${safeAccountError(err)}`);
    process.exitCode = 1;
    return;
  }

  const cred = await loadCredential();
  if (!cred) {
    console.log("Not logged in.");
    console.log("Run: zcode-proxy auth login <zai|bigmodel>");
    return;
  }
  console.log(`Logged in: ${cred.provider}`);
  console.log(`  API Key: ${cred.apiKey.substring(0, 12)}...`);
  console.log(`  Store:   ${getStorePath()}`);
}

async function runOAuth(provider: ProviderId, pasteMode: boolean): Promise<OAuthResult> {
  if (provider === "bigmodel") {
    const oauth = new BigmodelOAuthClient();
    if (pasteMode) return runPasteLogin(oauth);
    const result = await oauth.authorize((url) => {
      console.log("Open this URL to authorize:\n");
      console.log(`  ${url}\n`);
      console.log("Waiting for authorization... (expires in 300s)\n");
      console.log(
        "Headless/Docker? The callback page will NOT load here — Ctrl-C and " +
        "re-run with `auth login bigmodel --paste` to paste the redirected URL instead.\n",
      );
      openBrowser(url);
    });
    return result;
  }

  const oauth = new ZaiOAuthClient();
  const result = await oauth.authorize((url) => {
    console.log("Open this URL to authorize:\n");
    console.log(`  ${url}\n`);
    console.log("Waiting for authorization... (expires in 300s)\n");
    openBrowser(url);
  });
  return result;
}

/**
 * Headless bigmodel login (`auth login bigmodel --paste`): the localhost
 * callback server is still bound — it defines the redirect port and the
 * browser can never reach it from inside a container anyway — but instead of
 * waiting on it, the user pastes the redirected URL back. The exact
 * `started.callbackUrl` string is used BOTH as the authorize `redirect` param
 * and as the exchange `redirect_uri` (the token endpoint requires them to
 * match), so the pair stays consistent by construction.
 */
async function runPasteLogin(oauth: BigmodelOAuthClient): Promise<OAuthResult> {
  const started = await oauth.start();
  try {
    console.log(pasteLoginInstructions(started.authorizeUrl, started.callbackUrl, LOGIN_TIMEOUT_MS));
    openBrowser(started.authorizeUrl);
    process.stdout.write("\n" + boldIfTTY("Paste the FULL redirected URL here, then press Enter:") + "\n> ");
    const pasted = await readPastedLine(LOGIN_TIMEOUT_MS);
    const code = parsePastedCallbackUrl(pasted, started.state);
    console.log("\nExchanging authorization code...");
    const tokens = await oauth.exchangeCode(code, started.callbackUrl, started.state);
    return { accessToken: tokens.accessToken, provider: "bigmodel", userId: tokens.userId, jwt: tokens.jwt };
  } finally {
    await oauth.close();
  }
}
