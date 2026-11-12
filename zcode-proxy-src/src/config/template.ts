/**
 * Bundled config template — inlined as a string constant so it compiles into
 * the single-file binary (`bun build --compile`) without requiring a sidecar
 * `config.example.yaml` file at runtime.
 *
 * Source of truth: config.example.yaml at repo root. When editing the schema,
 * update BOTH this file AND config.example.yaml to keep them in sync.
 */

export const EXAMPLE_CONFIG_YAML: string = `server:
  port: 8080
  host: "127.0.0.1"
  # Admission control (optional): cap on the request-body bytes the proxy
  # holds at once, in MB (default 64, allowed 1-4096). Requests beyond it wait
  # unread in a FIFO (at most 64 waiting, at most 15 s), then get HTTP 503 with
  # Retry-After in their endpoint's error shape, never 429. An idle proxy always
  # admits one request. Open response streams are never limited.
  # Env override: ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB.
  # admission:
  #   maxInFlightMB: 64

auth:
  # Key that clients must provide to use the proxy.
  # Required for serving; generate a unique secret and replace the placeholder.
  proxyApiKey: "your-proxy-secret"

  # Upstream credentials come from the OAuth login flow — run this first:
  #   bun run src/index.ts auth login <zai|bigmodel>
  # Parsed but currently not honored — the credential store path is fixed at
  # ~/.zcode-proxy/credentials.json:
  # oauthCredentialsPath: "~/.zcode-proxy/credentials.json"

  # Optional encrypted account pool for automatic free/start-plan quota rotation.
  # Disabled by default; enable only after adding accounts with repeated logins:
  #   bun run src/index.ts auth login <zai|bigmodel> --account NAME
  # The pool is stored at ~/.zcode-proxy/accounts.json (0600). Set \`path\` or
  # ZCODE_PROXY_ACCOUNTS_PATH to use a different location.
  accounts:
    enabled: false
    # path: "~/.zcode-proxy/accounts.json"
    # Optional operator policy (credentials never belong in config files):
    # allowedIds: [work, personal]
    # pausedIds: [maintenance]
    # allowPaid: false
    # allowedOrigins: ["http://127.0.0.1:8080"]

# Which upstream provider to use: "zai" or "bigmodel"
provider: zai

# Which plan tier to use:
#   "coding-plan" (default) — direct upstream endpoints, permanent API key
#   "start-plan"            — routes through zcode.z.ai with JWT auth (requires \`auth login\`)
plan: coding-plan

providers:
  zai:
    anthropicBase: "https://api.z.ai/api/anthropic"
    openaiBase: "https://api.z.ai/api/coding/paas/v4"
  bigmodel:
    anthropicBase: "https://open.bigmodel.cn/api/anthropic"
    openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4"

defaultModel: glm-4.6

models:
  - glm-4.5-air
  - glm-4.6
  - glm-4.6v
  - glm-4.7
  - glm-5
  - glm-5-turbo
  - glm-5v-turbo
  - glm-5.1
  - glm-5.2
  - glm-5.3
  - glm-5.3-flash

# Configurable identity headers injected on every upstream request to mimic the
# ZCode desktop client (User-Agent, X-ZCode-App-Version, X-Title,
# X-ZCode-Agent, HTTP-Referer). Runtime platform headers (X-Platform,
# X-Os-Category, X-Os-Version) are detected dynamically and are not configured
# here. All fields below are optional; env vars override YAML, which overrides
# defaults.
identity:
  # Mirrors process.env.ZCODE_APP_VERSION in the ZCode bundle.
  # Must be printable ASCII; non-conforming values fall back to the default.
  # Default: "3.14.3" (current ZCode release). Override to match your real client.
  appVersion: "3.14.3"
  # X-Title suffix → "Z Code@{sourceTitle}". Default "cli".
  sourceTitle: "cli"
  # HTTP-Referer URL. Default "https://zcode.z.ai".
  refererOrigin: "https://zcode.z.ai"
  # Device identity (X-Device-Mid) — random UUIDv4, generated ONCE and reused
  # forever (mirrors ZCode's telemetry deviceMid; no hardware values involved).
  # Auto-generated into this file at first \`auth login\` or config creation.
  # Leave empty on Android — the app injects ZCODE_IDENTITY_DEVICE_MID instead.
  deviceMid: ""

# Local client-session inference for cache-affinity experiments.
# "observe" (default) logs inferred sessions in debug mode but does not change
# upstream x-session-id. "enforce" reuses a stable x-session-id for inferred
# coding-plan sessions. "off" disables inference entirely.
clientIdentity:
  mode: observe
  ttlSeconds: 900
  maxSessions: 1024

# Server-controlled upstream URL remapping (mirrors the ZCode client's
# ProviderEndpointRoutingService). Known official gateway routes are applied
# immediately; the proxy also periodically fetches
# {origin}/api/v1/client/configs?app_version=&platform= and rewrites matching upstream URLs per the
# returned proxyEndpoint.mapping table (currently the coding-plan Anthropic
# endpoints -> zcode.z.ai ultra endpoints). Fail-open: any fetch/parse error
# keeps the original URLs. Env override: ZCODE_ENDPOINT_ROUTING=false.
endpointRouting:
  enabled: true
  origin: "https://zcode.z.ai"

# Legacy client request signing V4 (mirrors the ZCode 3.9.1 client).
# It is disabled by default because current ZCode releases no longer advertise
# the gate. When explicitly enabled, the proxy probes {origin}/api/v1/client/configs (cached 1h) and,
# only if the server sets data.codingPlanSignature.enable=true, signs coding-plan
# requests: handshake against {provider}/api/paas/c1f3a7e2/v2/client, Ed25519
# signature + proof-of-work headers on every request, fail-open retry ladder
# (two 401 VERIFY rejections -> permanent unsigned bypass). Start-plan and
# off-peak paths are never signed. Env override: ZCODE_CLIENT_SIGNING=false.
clientSigning:
  enabled: false
  origin: "https://zcode.z.ai"

logging:
  level: info

# Health supervisor (optional): samples the proxy's memory footprint
# (Pss on Linux, commit charge on Windows; RSS where neither is available).
# Soft limit: WARN event line only. Hard limit: asks the kit manager for a
# respawn (budget 3 per 15 min) and drains only once the manager has
# acknowledged it (reserved the budget, within 10 s): requests already
# accepted finish, new ones get 503 + Retry-After. A refused or
# unacknowledged respawn keeps the proxy serving: one ERROR line, restarts
# exhausted, no new request until the 15 min window has passed. Without the
# kit manager (TUI, standalone proxy) it only logs and keeps serving. Each limit must be
# held for "samples" samples taken "sampleIntervalSeconds" apart.
# Defaults shown; no env override.
# health:
#   memory:
#     softLimitMB: 512           # 64-65536
#     hardLimitMB: 1024          # 64-65536, above softLimitMB
#     samples: 3                 # 1-20
#     sampleIntervalSeconds: 15  # 1-600

# Captcha solver process (optional): the solver runs in a process of its own
# under a memory cap, in MB. Windows enforces the cap with a Job Object, Linux
# with a systemd user scope (cgroup) once its limit has been read back from
# the kernel; where the operating system cannot enforce it (macOS, a Linux
# without a delegated memory controller) the solver process measures its own
# footprint and ends itself at the cap. A solver that ends at the cap is
# logged with this key's name. Raise the cap only if solves need more memory.
# Default shown; allowed 128-65536; no env override.
# solver:
#   memoryCapMB: 300
`;
