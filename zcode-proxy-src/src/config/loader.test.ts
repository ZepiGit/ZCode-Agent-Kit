/**
 * Tests for config loader.
 * @see .omo/plans/zcode-proxy.md Task 2
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./loader.js";
import { EXAMPLE_CONFIG_YAML } from "./template.js";
import { fixtureSecret } from "../test-fixtures.js";

const TMP = join(tmpdir(), `zcode-proxy-test-${Date.now()}`);

const PROXY_KEY = fixtureSecret("loader-proxy-key");
/** Legacy `auth.apiKey`, which the oauth-only loader must drop entirely. */
const LEGACY_KEY = fixtureSecret("loader-legacy-key");
const CLIENT_KEY = fixtureSecret("loader-client-key");
const ENV_PROXY_KEY = fixtureSecret("loader-env-proxy-key");

function writeYaml(content: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, "config.yaml");
  writeFileSync(p, content, "utf-8");
  return p;
}

beforeEach(() => {
  // Clean env overrides
  delete process.env.ZCODE_PROXY_PORT;
  delete process.env.ZCODE_PROXY_API_KEY;
  delete process.env.ZCODE_PROVIDER;
  delete process.env.ZCODE_APP_VERSION;
  delete process.env.ZCODE_SOURCE_TITLE;
  delete process.env.ZCODE_REFERER_ORIGIN;
  delete process.env.ZCODE_ASYNC_ENABLED;
  delete process.env.ZCODE_ASYNC_ORIGIN;
  delete process.env.ZCODE_CLAIM_ENABLED;
  delete process.env.ZCODE_CLAIM_AUTO;
  delete process.env.ZCODE_CLAIM_ORIGIN;
  delete process.env.ZCODE_CLAIM_POLL_INTERVAL_MS;
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("vendored template vs loader (H4)", () => {
  it("the bundled first-run template parses AND passes validate() — no 0.0.0.0 startup death", () => {
    // The template ships inside the compiled binary and is written out on
    // first run; if it violates a loader invariant (notably the loopback
    // binding rule that rejects 0.0.0.0), first-run serve dies immediately.
    const path = writeYaml(EXAMPLE_CONFIG_YAML);
    const cfg = loadConfig(path);
    expect(["127.0.0.1", "::1", "localhost"]).toContain(cfg.server.host);
  });
});

describe("identity.deviceMid", () => {
  it("loads identity.deviceMid from YAML", () => {
    const path = writeYaml(`
server:
  port: 9090
  host: "127.0.0.1"
provider: zai
identity:
  appVersion: "3.8.1"
  deviceMid: "0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0"
`);
    const cfg = loadConfig(path);
    expect(cfg.identity.deviceMid).toBe("0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0");
  });

  it("leaves identity.deviceMid undefined when the key is absent or empty", () => {
    const path = writeYaml(`
server:
  port: 9090
  host: "127.0.0.1"
provider: zai
identity:
  appVersion: "3.8.1"
  deviceMid: ""
`);
    expect(loadConfig(path).identity.deviceMid).toBeUndefined();

    const path2 = writeYaml(`
server:
  port: 9090
provider: zai
identity:
  appVersion: "3.8.1"
`);
    expect(loadConfig(path2).identity.deviceMid).toBeUndefined();
  });

  it("trims whitespace around identity.deviceMid", () => {
    const path = writeYaml(`
server:
  port: 9090
provider: zai
identity:
  deviceMid: "  0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0  "
`);
    expect(loadConfig(path).identity.deviceMid).toBe("0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0");
  });
});

describe("loadConfig", () => {
  it("loads a valid YAML config with all fields", () => {
    const path = writeYaml(`
server:
  port: 9090
  host: "127.0.0.1"
auth:
  proxyApiKey: "${PROXY_KEY}"
provider: bigmodel
defaultModel: glm-4.6
models:
  - glm-4.6
  - glm-4.5
logging:
  level: debug
`);
    const cfg = loadConfig(path);
    expect(cfg.server.port).toBe(9090);
    expect(cfg.server.host).toBe("127.0.0.1");
    expect(cfg.auth.proxyApiKey).toBe(PROXY_KEY);
    expect(cfg.provider).toBe("bigmodel");
    expect(cfg.defaultModel).toBe("glm-4.6");
    expect(cfg.models).toEqual(["glm-4.6", "glm-4.5"]);
    expect(cfg.logging.level).toBe("debug");
  });

  it("applies defaults for missing optional fields", () => {
    const path = writeYaml(`
`);
    const cfg = loadConfig(path);
    expect(cfg.server.port).toBe(8080);
    expect(cfg.server.host).toBe("127.0.0.1"); // ZAK-002: loopback default
    expect(cfg.provider).toBe("zai");
    expect(cfg.defaultModel).toBe("glm-4.6");
    expect(cfg.logging.level).toBe("info");
    expect(cfg.providers.zai.anthropicBase).toBe("https://api.z.ai/api/anthropic");
    expect(cfg.providers.bigmodel.openaiBase).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
    expect(cfg.clientIdentity).toEqual({ mode: "observe", ttlSeconds: 900, maxSessions: 1024 });
    expect(cfg.responses).toEqual({ enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 });
    expect(cfg.mcp).toEqual({ enabled: true, webSearch: true, webReader: false, zread: false });
    expect(cfg.async).toEqual({
      enabled: false,
      origin: "https://zcode.z.ai",
      pollIntervalMs: 5000,
      keepAliveIntervalMs: 3000,
      maxWaitMs: 0,
      maxRetries: 3,
      settleTimeoutMs: 8000,
      controlTimeoutMs: 15000,
      defaultModel: "",
    });
    expect(cfg.claim).toEqual({
      // ZAK-001 remediation: fail-closed defaults — an omitted claim block
      // must NOT enable automatic trial claiming.
      enabled: false,
      auto: false,
      origin: "https://zcode.z.ai",
      pollIntervalMs: 300000,
      cooldownMs: 600000,
      planId: "",
    });
  });

  it("clientIdentity: YAML values override defaults", () => {
    const path = writeYaml(`
clientIdentity:
  mode: enforce
  ttlSeconds: 60
  maxSessions: 8
`);
    const cfg = loadConfig(path);
    expect(cfg.clientIdentity).toEqual({ mode: "enforce", ttlSeconds: 60, maxSessions: 8 });
  });

  it("responses + mcp: YAML values override defaults", () => {
    const path = writeYaml(`
responses:
  enabled: false
  store:
    maxEntries: 50
    ttlMs: 3600000
mcp:
  enabled: true
  webSearch: false
  webReader: true
  zread: true
`);
    const cfg = loadConfig(path);
    expect(cfg.responses).toEqual({ enabled: false, storeMaxEntries: 50, storeTtlMs: 3600000 });
    expect(cfg.mcp).toEqual({ enabled: true, webSearch: false, webReader: true, zread: true });
  });

  it("async: YAML values override defaults", () => {
    const path = writeYaml(`
async:
  enabled: true
  origin: "https://custom.example.com"
  pollIntervalMs: 1000
  keepAliveIntervalMs: 500
  maxWaitMs: 600000
  maxRetries: 5
  settleTimeoutMs: 3000
  controlTimeoutMs: 8000
  defaultModel: "glm-5"
`);
    const cfg = loadConfig(path);
    expect(cfg.async).toEqual({
      enabled: true,
      origin: "https://custom.example.com",
      pollIntervalMs: 1000,
      keepAliveIntervalMs: 500,
      maxWaitMs: 600000,
      maxRetries: 5,
      settleTimeoutMs: 3000,
      controlTimeoutMs: 8000,
      defaultModel: "glm-5",
    });
  });

  it("async: snake_case YAML keys also accepted", () => {
    const path = writeYaml(`
async:
  poll_interval_ms: 2000
  keepalive_interval_ms: 700
  max_wait_ms: 300000
  max_retries: 2
  settle_timeout_ms: 4000
  control_timeout_ms: 9000
`);
    const cfg = loadConfig(path);
    expect(cfg.async.pollIntervalMs).toBe(2000);
    expect(cfg.async.keepAliveIntervalMs).toBe(700);
    expect(cfg.async.maxWaitMs).toBe(300000);
    expect(cfg.async.maxRetries).toBe(2);
    expect(cfg.async.settleTimeoutMs).toBe(4000);
    expect(cfg.async.controlTimeoutMs).toBe(9000);
  });

  it("async: ZCODE_ASYNC_ENABLED env overrides YAML", () => {
    const path = writeYaml(`
async:
  enabled: false
`);
    process.env.ZCODE_ASYNC_ENABLED = "true";
    const cfg = loadConfig(path);
    expect(cfg.async.enabled).toBe(true);
  });

  it("claim: YAML values override defaults", () => {
    const path = writeYaml(`
claim:
  enabled: true
  auto: false
  origin: "https://zcode.z.ai"
  pollIntervalMs: 60000
  cooldownMs: 120000
  planId: "weekend-special"
`);
    const cfg = loadConfig(path);
    expect(cfg.claim).toEqual({
      enabled: true,
      auto: false,
      origin: "https://zcode.z.ai",
      pollIntervalMs: 60000,
      cooldownMs: 120000,
      planId: "weekend-special",
    });
  });

  it("claim: ZCODE_CLAIM_ENABLED / ZCODE_CLAIM_POLL_INTERVAL_MS env override", () => {
    const path = writeYaml(`
claim:
  enabled: false
`);
    process.env.ZCODE_CLAIM_ENABLED = "true";
    process.env.ZCODE_CLAIM_POLL_INTERVAL_MS = "45000";
    const cfg = loadConfig(path);
    expect(cfg.claim.enabled).toBe(true);
    expect(cfg.claim.pollIntervalMs).toBe(45000);
  });

  // Audit backlog: full precedence matrix — env > YAML > default(false).
  it("claim precedence: env > YAML > fail-closed default", () => {
    // 1. default: neither YAML nor env → false/false
    expect(loadConfig(writeYaml(`\n`)).claim.enabled).toBe(false);
    expect(loadConfig(writeYaml(`\n`)).claim.auto).toBe(false);

    // 2. YAML true, no env → true
    const yamlTrue = writeYaml(`
claim:
  enabled: true
  auto: true
`);
    expect(loadConfig(yamlTrue).claim.enabled).toBe(true);
    expect(loadConfig(yamlTrue).claim.auto).toBe(true);

    // 3. env false overrides YAML true
    process.env.ZCODE_CLAIM_ENABLED = "false";
    process.env.ZCODE_CLAIM_AUTO = "false";
    expect(loadConfig(yamlTrue).claim.enabled).toBe(false);
    expect(loadConfig(yamlTrue).claim.auto).toBe(false);
    delete process.env.ZCODE_CLAIM_ENABLED;
    delete process.env.ZCODE_CLAIM_AUTO;

    // 4. env true overrides YAML false
    const yamlFalse = writeYaml(`
claim:
  enabled: false
  auto: false
`);
    process.env.ZCODE_CLAIM_ENABLED = "true";
    process.env.ZCODE_CLAIM_AUTO = "true";
    expect(loadConfig(yamlFalse).claim.enabled).toBe(true);
    expect(loadConfig(yamlFalse).claim.auto).toBe(true);
    delete process.env.ZCODE_CLAIM_ENABLED;
    delete process.env.ZCODE_CLAIM_AUTO;
  });

  it("async: maxWaitMs=0 is allowed (non-negative, not positive)", () => {
    const path = writeYaml(`
async:
  maxWaitMs: 0
`);
    const cfg = loadConfig(path);
    expect(cfg.async.maxWaitMs).toBe(0);
  });

  it("async: throws on negative maxWaitMs", () => {
    const path = writeYaml(`
async:
  maxWaitMs: -1
`);
    expect(() => loadConfig(path)).toThrow(/non-negative/);
  });

  it("async: throws on zero pollIntervalMs (must be positive)", () => {
    const path = writeYaml(`
async:
  pollIntervalMs: 0
`);
    expect(() => loadConfig(path)).toThrow(/positive integer/);
  });

  it("throws on invalid clientIdentity.mode", () => {
    const path = writeYaml(`
clientIdentity:
  mode: always
`);
    expect(() => loadConfig(path)).toThrow(/Invalid clientIdentity\.mode/);
  });

  it("plan: accepts coding-plan and start-plan, defaults when absent (CL-07)", () => {
    const coding = loadConfig(writeYaml("plan: coding-plan\n"));
    expect(coding.plan).toBe("coding-plan");
    const start = loadConfig(writeYaml("plan: start-plan\n"));
    expect(start.plan).toBe("start-plan");
    const dflt = loadConfig(writeYaml("server:\n  port: 8080\n"));
    expect(dflt.plan).toBe("coding-plan");
  });

  it("plan: THROWS on a typo'd value instead of silently falling back (CL-07)", () => {
    // NOTE: `plan:` with NO value parses as null → default (tested above);
    // only a present-but-unrecognized string throws.
    for (const bad of ["start_plan", "startplan", "Start-Plan", "team-plan", "openai-plan"]) {
      const path = writeYaml(`plan: ${bad}\n`);
      expect(() => loadConfig(path), `plan: ${bad}`).toThrow(/Invalid plan/);
    }
  });

  it("env vars override YAML values", () => {
    const path = writeYaml(`
server:
  port: 9090
provider: zai
`);
    process.env.ZCODE_PROXY_PORT = "3000";
    process.env.ZCODE_PROXY_API_KEY = ENV_PROXY_KEY;
    process.env.ZCODE_PROVIDER = "bigmodel";

    const cfg = loadConfig(path);
    expect(cfg.server.port).toBe(3000);
    expect(cfg.auth.proxyApiKey).toBe(ENV_PROXY_KEY);
    expect(cfg.provider).toBe("bigmodel");
  });

  it("throws when port is out of range", () => {
    const path = writeYaml(`
server:
  port: 99999
`);
    expect(() => loadConfig(path)).toThrow(/out of range/);
  });

  it("throws on invalid provider", () => {
    const path = writeYaml(`
provider: openai
`);
    expect(() => loadConfig(path)).toThrow(/Invalid provider/);
  });

  // ZAK-002: loopback binding is a load-time invariant, not a template default.
  it("throws on non-loopback server.host (0.0.0.0, LAN address, DNS name)", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.10", "proxy.example.com"]) {
      const path = writeYaml(`
server:
  port: 8457
  host: "${host}"
`);
      expect(() => loadConfig(path)).toThrow(/loopback/);
    }
  });

  // Audit backlog: spelling variants that could sneak past a sloppy allowlist.
  it("rejects loopback lookalikes (malformed IPv4, mapped IPv6, expanded IPv6)", () => {
    for (const host of ["127.0.0.01", "127.0.0.1.", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1"]) {
      const path = writeYaml(`
server:
  port: 8457
  host: "${host}"
`);
      expect(() => loadConfig(path)).toThrow(/loopback/);
    }
  });

  it("accepts loopback server.host forms and canonicalizes the bracketed IPv6 literal", () => {
    for (const [host, normalized] of [["127.0.0.1", "127.0.0.1"], ["localhost", "localhost"], ["LOCALHOST", "localhost"], ["::1", "::1"], ["[::1]", "::1"]] as const) {
      const path = writeYaml(`
server:
  port: 8457
  host: "${host}"
`);
      const cfg = loadConfig(path);
      expect(cfg.server.host).toBe(normalized);
    }
  });

  it("ignores legacy auth.mode/auth.apiKey keys (oauth-only proxy)", () => {
    const path = writeYaml(`
auth:
  mode: apikey
  apiKey: "${LEGACY_KEY}"
  proxyApiKey: "${CLIENT_KEY}"
`);
    const cfg = loadConfig(path);
    expect(cfg.auth).toEqual({ proxyApiKey: CLIENT_KEY });
  });

  it("throws when config file not found", () => {
    expect(() => loadConfig("/nonexistent/path/config.yaml")).toThrow(/not found/);
  });

  it("auto-adds defaultModel to models list if missing", () => {
    const path = writeYaml(`
defaultModel: glm-5
models:
  - glm-4.6
`);
    const cfg = loadConfig(path);
    expect(cfg.models).toContain("glm-5");
    expect(cfg.models).toContain("glm-4.6");
  });

  it("identity defaults to current ZCode release when no field provided", () => {
    const path = writeYaml(`
`);
    const cfg = loadConfig(path);
    expect(cfg.identity.appVersion).toBe("3.11.2");
    expect(cfg.identity.sourceTitle).toBe("cli");
    expect(cfg.identity.refererOrigin).toBe("https://zcode.z.ai");
  });

  it("identity: YAML values override defaults", () => {
    const path = writeYaml(`
identity:
  appVersion: "9.9.9"
  sourceTitle: "electron"
  refererOrigin: "https://example.com"
`);
    const cfg = loadConfig(path);
    expect(cfg.identity.appVersion).toBe("9.9.9");
    expect(cfg.identity.sourceTitle).toBe("electron");
    expect(cfg.identity.refererOrigin).toBe("https://example.com");
  });

  it("identity: ZCODE_APP_VERSION env overrides YAML", () => {
    const path = writeYaml(`
identity:
  appVersion: "from-yaml"
`);
    process.env.ZCODE_APP_VERSION = "from-env";
    const cfg = loadConfig(path);
    expect(cfg.identity.appVersion).toBe("from-env");
  });

  it("identity: non-ASCII appVersion falls back to default", () => {
    const path = writeYaml(`
identity:
  appVersion: "v3.3.3-中文"
`);
    const cfg = loadConfig(path);
    expect(cfg.identity.appVersion).toBe("3.11.2");
  });
});
