# @modelcontextprotocol/sdk and the MCP protocol revision

## Answer

1. Stay on 1.x for this overhaul: bump `mcp/zcode-harness-mcp/package.json:24` from `^1.30.0` to `^1.32.2` (latest 1.x, 2026-10-23). It picks up batch-length limits, the session-scoped task store and other fixes, with no API change.
2. 2.x is the current stable line (`@modelcontextprotocol/server` 2.4.0, 2026-10-23; 2.0.0 shipped 2026-07-27). The project guarantees 1.x fixes only until at least 2027-01-27, so open a ticket to migrate before then.
3. The migration is small. One file uses the SDK (`src/mcp/server.ts`, 4 import lines and 4 `setRequestHandler` calls), and the codemod covers the mechanical part. Adopting the 2026-07-28 revision (no sessions, no `initialize`, `server/discover`) is a separate architectural step through `createMcpHandler`.
4. The bridge negotiates at most `2025-11-25` today (SDK `LATEST_PROTOCOL_VERSION`). Its stateless, POST-only, JSON-response HTTP design already matches what 2026-07-28 expects of old-era traffic (405 on GET/DELETE, no session IDs).
5. Fix now, independent of the SDK version: declare `zod` explicitly (`^4.2.0`; it is a required peer of 1.x and a direct dependency of 2.x), and register the per-request cleanup (`res.on("close")`) before `handleRequest`, closing in the error path too (`server.ts:280-293`).

## Details

### Versions (verified 2026-11-06 against the npm registry and GitHub releases)

| Line | Package | Latest | Date | Notes |
|---|---|---|---|---|
| 1.x | `@modelcontextprotocol/sdk` | **1.32.2** | 2026-10-23 | npm `latest` tag. Repo pins `^1.30.0`; lockfiles resolve **1.30.0** (2026-07-27). |
| 2.x | `@modelcontextprotocol/server` / `client` / `core` | **2.4.0** | 2026-10-23 | 2.0.0 shipped 2026-07-27, then 2.1.0 (09-23), 2.2.0 (09-28), 2.3.0 (10-02), 2.3.1 (10-05), 2.4.0 (10-23) |
| 2.x | `@modelcontextprotocol/node` (Node HTTP adapter) | 2.1.2 | 2026-10-23 | peer `@modelcontextprotocol/server ^2.4.0` |
| 2.x | `@modelcontextprotocol/server-legacy`, `codemod` | 2.4.0 | 2026-10-23 | frozen v1 copies of SSE and auth; `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` |

1.x changes since the pinned 1.30.0:
- **1.30.1** (2026-09-23): server reads HTTP bodies with a size limit and bounds JSON-RPC batch length (#2717); auth resource-URI fix.
- **1.31.0** (2026-09-28): OAuth credentials bound to their issuer. Client-side only, not used by the bridge.
- **1.32.0** (2026-10-02): client follows only same-origin redirects. Adds the opt-in `maxToolInputElements` on `McpServer` (not usable from the low-level `Server`) and `expectedResource` on `requireBearerAuth`. In-memory task store is scoped to the session; `tools/call` without `arguments` is accepted.
- **1.32.1** (2026-10-05): docs only. The README now states the v1.x support policy.
- **1.32.2** (2026-10-23): `Transport` optional properties typed `| undefined`; registering handlers after `connect()` is allowed when the capability was declared.

v1.x support policy (v1.x README, last changed 2026-10-05):
- 1.x implements the spec up to 2025-11-25.
- Support for 2026-07-28 is **not planned** for 1.x.
- 1.x "continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)", which means at least **2027-01-27**.

### Protocol revision

- **Current revision: `2026-07-28`.** The spec repo lists `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28` and `draft`. The changelog was committed 2026-07-28.
- **What the bridge negotiates today.** The installed SDK 1.30.0 has `LATEST_PROTOCOL_VERSION = '2025-11-25'` and `SUPPORTED_PROTOCOL_VERSIONS = [2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]` (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:2-4`). `Server` echoes the client's requested version when it is supported and otherwise answers with LATEST (`dist/esm/server/index.js:263`). So the bridge speaks at most 2025-11-25.
- **Pins in the repo.**
  - The bridge's own test clients and examples request `2025-06-18`: `examples/smoke-client.mjs:76`, `examples/demo-client.mjs:101`, `test/integration/client.mjs:195`, `test/integration/robustness.test.mjs:232`.
  - The proxy's hand-rolled client defaults to `2025-06-18` (`zcode-proxy-src/src/mcp/client.ts:84`) and accepts the server's downgrade to `2024-11-05` (`client.ts:13-14`).
- **The 2025-11-25 → 2026-07-28 major changes** (spec changelog):
  1. Protocol-level sessions and the `Mcp-Session-Id` header are removed (SEP-2567).
  2. The `initialize`/`notifications/initialized` handshake is removed. Every request carries `_meta` `io.modelcontextprotocol/protocolVersion` and `clientCapabilities`. A version mismatch returns `UnsupportedProtocolVersionError` (SEP-2575).
  3. New `server/discover`, which servers MUST implement. On stdio, clients use it as a backward-compatibility probe.
  4. The HTTP GET endpoint and `resources/subscribe` are replaced by a `subscriptions/listen` POST stream.
  5. `ping`, `logging/setLevel` and `notifications/roots/list_changed` are removed. The log level is set per request.
  6. Tasks move out of the core protocol into the `io.modelcontextprotocol/tasks` extension (SEP-2663).
  7. Multi Round-Trip Requests (`InputRequiredResult`) replace server-initiated sampling, elicitation and roots requests (SEP-2322).
  8. All results carry a required `resultType` field.
  9. SSE resumability and `Last-Event-ID` are removed.
- **2026-07-28 minor changes**:
  - Required `Mcp-Method` and `Mcp-Name` request headers, plus `x-mcp-header` (SEP-2243).
  - Required `ttlMs`/`cacheScope` on list and read results (SEP-2549).
  - The resource-not-found code changes from `-32002` to `-32602`. **The bridge throws `-32002` at `src/mcp/server.ts:99`.**
  - Error codes renumbered to `-32020`..`-32022`.
- **Deprecated in 2026-07-28** (SEP-2577, SEP-2596, PR #2858; minimum 12-month window):
  - Roots, Sampling and Logging. **The bridge advertises `logging: {}` at `server.ts:44`.**
  - The HTTP+SSE transport.
  - `includeContext` values `thisServer` and `allServers`.
  - OAuth Dynamic Client Registration.

### Transport-level changes relevant to the bridge

- **Streamable HTTP, session handling.**
  - From 2026-07-28 on, a modern-only server SHOULD answer GET/DELETE with 405, ignore `Mcp-Session-Id` without minting or echoing one, and ignore `Last-Event-ID` (streamable-http.mdx, "Earlier Streamable HTTP Revisions").
  - The bridge already does this: it is stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`, `server.ts:280`) and POST-only with a 405 otherwise (`server.ts:196-199`).
- **Streamable HTTP, `Content-Type`.** v2 (and the 1.30.0 backport, PR #2444) parses `Content-Type` as a media type and answers 415 to any non-`application/json` POST. Hand-rolled clients must send the header. The bridge's test clients should be checked for this before a v2 move.
- **DNS rebinding and allowed hosts.**
  - The spec still requires `Origin` validation (403 on an invalid Origin), recommends binding to localhost, and recommends authentication (2026-07-28 streamable-http "Security & Endpoint").
  - In 1.x, the transport options `allowedHosts`, `allowedOrigins` and `enableDnsRebindingProtection` are `@deprecated` in favour of external middleware (`dist/esm/server/webStandardStreamableHttp.d.ts:80-96`).
  - In v2, `hostHeaderValidation()` and `localhostHostValidation()` move to `@modelcontextprotocol/express`. Framework-agnostic `validateHostHeader`, `localhostAllowedHostnames` and `hostHeaderValidationResponse` live in `@modelcontextprotocol/server`.
  - The bridge does its own exact Host check, Bearer check and Origin check before the SDK sees the request (`server.ts:129-182`), so neither line changes its behaviour.
- **Auth.**
  - v2 moves Resource Server helpers to `@modelcontextprotocol/express` and the runtime-neutral `requireBearerAuth`/`verifyBearerToken` to `@modelcontextprotocol/server`. Authorization Server helpers are frozen in `server-legacy/auth`.
  - The bridge uses none of these: it does a static timing-safe Bearer compare at `server.ts:153-161`.
- **stdio.**
  - 2026-07-28 drops `initialize`, and clients probe with `server/discover`. A stdio server on the legacy era that does not answer the probe is treated as legacy after a timeout (v2 `support-2026-07-28.md`).
  - In v2, `StdioServerTransport` moves to the `@modelcontextprotocol/server/stdio` subpath.
- **SSE.** The HTTP+SSE transport is Deprecated. In v2, `SSEServerTransport` is removed; a frozen copy remains in `server-legacy/sse`. The bridge does not use it.

### zod

- **1.x** (1.30.0 to 1.32.2): `zod` is a **required** (non-optional) peer, `^3.25 || ^4.0`, and also a dependency.
- **2.x** (`server` 2.4.0, `core` 2.4.0): `zod ^4.2.0` is a direct dependency. **Zod 3 is not supported**: a zod-3 range typechecks but fails at the first `tools/list`. Zod ≥4.2 is required for `~standard.jsonSchema` (migration guide, server-registration reference).
- **In this repo:**
  - No source file imports zod (`grep` in `src`, `test` and `examples` finds nothing). Tools are JSON Schema, validated by the bridge's own `src/mcp/validate.ts`.
  - The resolved zod is **4.6.2** (`bun.lock:201`).
  - **Drift:** commit `81bdc4a` (2026-09-27) dropped the direct zod dependency from `package.json` and `bun.lock`, but `package-lock.json:13` still lists `"zod": "^4.6.2"`. `MANIFEST.md:26` and `MANIFEST.de.md:28` still say "runtime dependencies are `@modelcontextprotocol/sdk` and `zod`".
  - Because zod is a required peer of 1.x, declaring `"zod": "^4.2.0"` explicitly is the clean fix. It is v2-ready and makes `package-lock.json` consistent again.

### SDK memory and retention issues (modelcontextprotocol/typescript-sdk)

- **#2559** (open, P2, v1+v2, 2026-07-27): "JSON-response-mode stream mappings never complete their lifecycle".
  - With `enableJsonResponse: true` on a **stateful** transport, every POST leaks one `_streamMapping` entry until `close()`. A `close()` during an in-flight JSON POST leaves the HTTP request hanging.
  - Confirmed on 1.32.2 (comment 2026-10-29). The v1.x fix PR #2747 is still open.
  - Bridge exposure: low. It uses JSON mode but **stateless**, with one transport per request that is closed afterwards.
- **#2090** (open, P3, 2026-05-14): "Stateless mode: per-request McpServer+Protocol allocation causes memory leak at scale".
  - About 9 Maps/Sets per `Protocol`, plus 3 Maps per transport, are allocated per request. GC lags under sustained load.
  - The bridge uses exactly this pattern (`server.ts:280-281`). It is capped by `MAX_IN_FLIGHT = 16` (`server.ts:140`), so the risk is low for a local bridge.
- **Bridge-local retention risk (UNVERIFIED, not reproduced).**
  - `res.on("close", …)` is attached **after** `await transport.handleRequest(…)` (`server.ts:285-289`). This copies the official v1.x example `src/examples/server/simpleStatelessStreamableHttp.ts:111-117`.
  - If the response's `close` event has already fired when the listener is attached, `transport.close()` and `server.close()` never run for that request.
  - The `catch` path at `server.ts:290-293` also never closes them.
  - Fix: attach the listener before `handleRequest`, and close in `finally` on error.
- **#2002** (closed 2026-09-23, P1): "StdioServerTransport doesn't handle stdin close/end — zombie processes".
  - Fixed on the v2 line by PR #2494 (merged to main 2026-09-23). The **v1.x backport PR #2911 is still open**.
  - The bridge already mitigates it: `src/index.ts:161-163` shuts down on stdin `end`.
- **#2536** (open, P3, v1+v2, 2026-07-23): stdio `ReadBuffer` keeps a reference to already-consumed input (up to the last frame's size) and copies the next chunk. The growth is bounded. Fix PR #2540 (main) is open.
- **#2605** (open, P2, v1+v2, 2026-08-02): `AjvJsonSchemaValidator.getValidator()` recompiles schemas without `$id` on every call, which leaks memory in `Client.listTools()`.
  - Client-side. The bridge uses the low-level `Server` with its own validator, so it is not affected.
- **#771** (closed 2026-10-02): large SSE responses amplify client memory. Fixed by requiring `eventsource-parser ≥3.0.8`. The bridge lock resolves 3.1.1 (`bun.lock:71`), so it is already safe.
- **#2607** (closed 2026-09-28, v2 only): a reused `McpServer` under `createMcpHandler` builds an unbounded `onclose` chain. This matters for a future v2 move: use the factory form, never a shared instance.
- Open v2-only bugs that argue against moving in a hurry:
  - #3148: a dropped GET stream in `toNodeHandler` blocks reconnects.
  - #3097: a late response after cancel raises `onerror`.
  - #3036: `maxSubscriptions` applies to the whole handler, with no per-session cap.

### Every SDK import in the repo, and what a 2.x migration touches

Only `mcp/zcode-harness-mcp` uses the SDK. `zcode-proxy-src/src/mcp/client.ts` and `glm-tools.ts` are a dependency-free `fetch()` client (`client.ts:24`) with **no SDK import**, so a migration does not touch them.

| File:line | Import | 2.x change |
|---|---|---|
| `mcp/zcode-harness-mcp/src/mcp/server.ts:9` | `Server` from `@modelcontextprotocol/sdk/server/index.js` | Comes from `@modelcontextprotocol/server`. The low-level `Server` constructor is unchanged. |
| `src/mcp/server.ts:10` | `StdioServerTransport` from `…/sdk/server/stdio.js` | Comes from `@modelcontextprotocol/server/stdio` (subpath; the root barrel does not export it). |
| `src/mcp/server.ts:11` | `StreamableHTTPServerTransport` from `…/sdk/server/streamableHttp.js` | Becomes `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`. The options (`sessionIdGenerator`, `enableJsonResponse`) and `handleRequest(req, res, parsedBody)` are unchanged. |
| `src/mcp/server.ts:12-21` | `CallToolRequestSchema`, `ListToolsRequestSchema`, `ListResourcesRequestSchema`, `ReadResourceRequestSchema` and the 4 request types from `…/sdk/types.js` | The schema constants are no longer needed: the `setRequestHandler` calls at **`:48`, `:58`, `:89`, `:93`** become method strings (`'tools/list'`, `'tools/call'`, `'resources/list'`, `'resources/read'`). The types come from `@modelcontextprotocol/server`. |
| `mcp/zcode-harness-mcp/dist/mcp/server.js:9-12` | Compiled copies of the above | Regenerated by `tsc` (`dist/` is committed). |
| `mcp/zcode-harness-mcp/package.json:24` | `"@modelcontextprotocol/sdk": "^1.30.0"` | Swap to `@modelcontextprotocol/server` + `@modelcontextprotocol/node` + `zod ^4.2.0`. The `engines.node >=20` setting already meets v2's Node 20+ requirement. |
| `package-lock.json:12,38-40`, `bun.lock:8,19` | Lock entries | Regenerate. |
| `MANIFEST.md:26`, `MANIFEST.de.md:28` | Name the v1 package | Update the text. |

Tests (`test/**`) and examples speak raw JSON-RPC and do not import the SDK. Under a 2026-07-28 adoption they would need new handshakes. Under a plain v2 swap they keep working, because v2 keeps the 2025-era `initialize` path.

Only needed when adopting 2026-07-28 (not the plain v2 swap):
- Switch the HTTP path (`server.ts:277-294`) to `createMcpHandler(factory)` + `toNodeHandler`. Its default `legacy: 'stateless'` serves both eras from one factory.
- Change `-32002` to `-32602` at `server.ts:99`.
- Drop the `logging: {}` capability at `server.ts:44`.
- Add `ttlMs`/`cacheScope` on list and read results, either in the SDK or in `resources.ts`.

### Why stay on 1.x now and migrate later

- The bridge uses the parts of the SDK that change least: the low-level `Server`, JSON-Schema tools, and a stateless transport. 1.x already gives it 2025-11-25, which is the newest revision current clients and v2 clients settle on for the 2025 era (migration guide, "Migrating in stages").
- The 2.x line is three months old and still has v2-only defects (#3148, #3097, #3036). The bridge would gain nothing functional until it adopts 2026-07-28, which is a separate design task.
- 1.x support ends no earlier than 2027-01-27, and 2026-07-28 will never come to 1.x. So the migration cannot be deferred indefinitely. Ticket it for before January 2027.

## Sources

- npm registry, `@modelcontextprotocol/sdk` (versions and times; `latest` = 1.32.2, 2026-10-23): https://registry.npmjs.org/@modelcontextprotocol/sdk (fetched 2026-11-06)
- npm registry, `@modelcontextprotocol/server` 2.4.0 (2026-10-23; deps `zod ^4.2.0`, engines node >=20): https://registry.npmjs.org/@modelcontextprotocol/server (fetched 2026-11-06)
- npm registry, `@modelcontextprotocol/node` 2.1.2 and `@modelcontextprotocol/core` 2.4.0: https://registry.npmjs.org/@modelcontextprotocol/node, https://registry.npmjs.org/@modelcontextprotocol/core (fetched 2026-11-06)
- GitHub releases: 1.30.0 (2026-07-27), 1.30.1 (2026-09-23), 1.31.0 (2026-09-28), 1.32.0 (2026-10-02), 1.32.1 (2026-10-05), 1.32.2 (2026-10-23), v2.4.0 (2026-10-23), `@modelcontextprotocol/server@2.0.0` (2026-07-27): https://github.com/modelcontextprotocol/typescript-sdk/releases
- v1.x README, support statement (last commit 2026-10-05): https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md
- Migration guide index and upgrade guide (last commit 2026-10-13): https://github.com/modelcontextprotocol/typescript-sdk/tree/main/docs/migration and rendered at https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2. Reference files: https://github.com/modelcontextprotocol/typescript-sdk/tree/main/skills/mcp-typescript-sdk-upgrade-to-v2/references (packaging-runtime, imports-transports, http-headers, protocol-ctx, server-registration, types-schemas, behavioral-changes, unchanged-apis)
- Adopting 2026-07-28 in v2: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md (fetched 2026-11-06)
- MCP spec changelog 2026-07-28 (committed 2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/changelog, source https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx
- MCP spec Streamable HTTP 2026-07-28 (Security & Endpoint; Backward Compatibility): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- Spec revision list: https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/specification (fetched 2026-11-06)
- Issues: #2559 (2026-07-27, open) https://github.com/modelcontextprotocol/typescript-sdk/issues/2559; #2090 (2026-05-14, open) …/issues/2090; #2002 (closed 2026-09-23) …/issues/2002; #2536 (2026-07-23, open) …/issues/2536; #2605 (2026-08-02, open) …/issues/2605; #771 (closed 2026-10-02) …/issues/771; #2607 (closed 2026-09-28) …/issues/2607; #3148, #3097, #3036 (v2, open)
- PRs: #2747 (v1.x JSON-mode fix, open), #2494 (stdio stdin-close, merged to main 2026-09-23), #2911 (v1.x backport, open), #2540 (ReadBuffer, open): https://github.com/modelcontextprotocol/typescript-sdk/pulls
- Official v1.x stateless example (close-after-handleRequest ordering): https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts
