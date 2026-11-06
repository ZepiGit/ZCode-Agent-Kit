# undici and yaml in the proxy: versions, Bun behaviour, body hygiene (research, 2026-11-06)

## Answer

1. **undici**: the latest stable is **8.12.4**, published 2026-11-05. The lockfile pins 8.10.0 (`zcode-proxy-src/bun.lock:34`), which is affected by 3 high-severity GHSAs fixed in 8.10.2 and 3 more fixed in 8.12.2. 8.12.4 fixes 6 more, all in the cache/redirect/SRI code. Recommendation: bump to `^8.12.4`. No defaults changed between 8.10 and 8.12.4 for `connections`, `pipelining`, keep-alive, `maxCachedSessions` or the timeouts.
2. **Under Bun the npm undici package is never loaded.** Bun hard-aliases `undici` to its built-in shim, where `Agent`, `Pool` and `ProxyAgent` are empty stubs and `fetch` is `Bun.fetch`. Bun ignores the `dispatcher` option (oven-sh/bun#38840, open; the fix PR #38855 is not merged). So `ZCODE_PROXY_UPSTREAM_PROXY` has no effect on captcha traffic on the Bun desktop build (`captcha-happy.ts:19,60-63,171-177`), even though the startup banner reports "explicit proxy" (`index.ts:243-252`).
3. Bun's `fetch` also reads `HTTP(S)_PROXY`/`ALL_PROXY` on every call. That contradicts the "ambient proxy ignored" claim in `captcha-happy.ts:167-170,440`. The Bun-side fix is `proxy: CAPTCHA_PROXY_URL ?? false`, with `dispatcher: ProxyAgent` kept only for Node. undici remains a real dependency only on the Node/Android path (`runtime/node-fetch-compat.ts:36`).
4. Body hygiene: undici's docs say to "always either consume or cancel the response body". I found 15 candidate sites in the proxy (listed under §5) that may skip `body.cancel()` on an error path or that never bound the time or size of the body read. These are candidates, not confirmed bugs. The strongest: the cookie-priming fetch whose body is never read (`captcha-happy.ts:1765`), 401 retries that drop the original response (`client-signing.ts:566-576`), and a `drain` wait with no close race (`server/server.ts:349-351`).
5. **yaml**: the latest stable is **2.9.1**, published 2026-09-11. The lockfile resolves 2.9.0, and v3 exists only as the prerelease `3.0.0-2` (dist-tag `next`). 2.x has no breaking changes. 2.9.0 only removed the "never throws" claim from the `parseDocument()` docs. Recommendation: raise the floor to `^2.9.1`, because `^2.5.0` still allows versions affected by CVE-2026-33532 (<2.8.3). Two things to know in `config/edit.ts:22-38`: `String(doc)` throws on a document with errors, and the file is rewritten without an atomic write.

## Details

### 1. undici versions since 8.10.0

Publish times come from `npm view undici time`, read 2026-11-06. Release notes are from GitHub releases.

| Version | Published (npm) | Pool / keep-alive / body / abort changes |
|---|---|---|
| 8.10.0 (locked) | 2026-08-03 | — |
| 8.10.1 | 2026-08-31 | #5707: idle-socket timer floor dropped. #5740: Agent keeps pools that have pending GOAWAY replays. #5675: retry honours abort during backoff. #5673: dedupe settles on abort. #5685: dump interceptor rejects aborted requests. #5687: dispatcher options propagated to the base class. |
| 8.10.2 | 2026-09-04 | Security release (see §2). Includes GHSA-pmjh: an orphaned RetryHandler body made consumers hang forever. |
| 8.11.0 | 2026-09-22 | #5677: drain not dispatched to `clientTtl`-evicted clients. #5799: h2 pool no longer fans out during ALPN. #5829: decompress interceptor honours backpressure. #5815: retry settles after connection close. |
| 8.11.1 | 2026-09-24 | #5850: fixes a hang on a 3xx response with a large body. #5872: docs warn that body mixins buffer the whole body. |
| 8.11.2 | 2026-09-24 | #5846: **avoid reconnecting aborted requests**. Before this, an aborted HTTP/1 request opened a replacement socket that sat idle in the Agent pool. |
| 8.12.0 | 2026-10-14 | #5881: removed pool clients no longer pick up queued requests. Before this, the pool reported 0 connections while a socket was still open, and `destroy()` did not close it. #5882: TLS session-cache bug fixed (this is the `maxCachedSessions` path). #5884: h2 `bodyTimeout` paused under backpressure. #5941: connections reset for no-body transfer-encoding. #5942: interceptor error-body size limited. |
| 8.12.1 | 2026-10-14 | Build fix only. |
| 8.12.2 | 2026-10-15 | Security release (see §2). |
| 8.12.3 | 2026-10-19 | #6052: replaces an h2 connection that stops responding after a stream timeout. #5982: pool keeps the caller's async context for queued requests. |
| **8.12.4 (latest)** | **2026-11-05** | 6 CVEs (cache/redirect/SRI). #6070: **abort propagation preserved after GC** for copied or cloned requests (fixes #4068). #5990: no eager reads from async-iterable bodies. #6028: interim 1xx responses pass through DecoratorHandler. |

Defaults: a diff of `docs/docs/api/{Client,Pool,Agent,ProxyAgent,Fetch}.md` between v8.10.0 and v8.12.4 shows **no default changes**. The values in 8.12.4 are:

- `keepAliveTimeout` 4e3, `keepAliveMaxTimeout` 600e3, `keepAliveTimeoutThreshold` 2e3
- `headersTimeout` and `bodyTimeout` 300e3
- `connect.maxCachedSessions` 100, `connect.timeout` 10e3
- `allowH2` true
- Pool `connections` null (unlimited)

The only doc changes are about h2. Pool and Agent now wait for ALPN on the first TLS connection before fanning out, and the server's `SETTINGS_MAX_CONCURRENT_STREAMS` "can lower this limit, but not raise it". Fetch.md gained the warning that body mixins buffer the whole body.

Leak history:
- #5566 (closed 2026-07-20, before 8.10): aborted HTTP/2 requests stranded the body and leaked the request graph. It was a regression from 8.6.0.
- Still open: #5822, a fetch finalizer that holds the request signal strongly (linked to vercel/next.js#84884).
- Still open: #5704, a SOCKS5 handshake timeout that leaks the socket. Not used here.
- Still open: #5713, a WebSocketStream abort listener. Not used here.

### 2. undici security advisories affecting 8.10.0

Source: the GitHub Advisory DB (`gh api advisories?affects=undici`), read 2026-11-06.

- **Fixed in 8.10.2 (advisories published 2026-09-29):**
  - High: GHSA-vp8m-p9jh-q5pm (cache/dedupe origin isolation, affects only >=8.10.0), GHSA-w293-vg96-wgc3 (BalancedPool TLS options dropped), GHSA-rfgv-xxqx-mfg5 (WebSocket subprotocol crash).
  - Medium: GHSA-3wwx, GHSA-rx4f, GHSA-2jfj, GHSA-3xpg (unbounded decompression), GHSA-pmjh (orphaned retry body).
  - Low: GHSA-8436, GHSA-2gqq, GHSA-r53p.
- **Fixed in 8.12.2 (advisories published 2026-10-23/27):**
  - High: GHSA-qrxm-fqhp-jwvm (a TLS 1.2 renegotiation **crashes the process** in HTTP/1.1 and h2 connection handling), GHSA-2m5v-pch6-74hx (`Agent` dropped function-valued TLS options such as `checkServerIdentity`), GHSA-4w7w-5xrc-9h26 (cache poisoning), GHSA-xjj6-f33q-929c (a crash from an unhandled error on more than 5 content-codings).
  - Medium: GHSA-55wc, GHSA-f72v, GHSA-4qv8 (EventSource memory), GHSA-9fm3 (PONG buffering).
- **Fixed in 8.12.4 (release notes 2026-11-05; not yet in the DB when checked):** CVE-2026-116592 (high), CVE-2026-120474, -116630, -120415, -120222, -120423. All are in the cache/redirect interceptors, cache replay or SRI. The proxy uses none of them.

What applies to this repo:
- On Node (the Android bundle), `setGlobalDispatcher(new Agent(...))` (`node-fetch-compat.ts:36-37`) routes **all** global fetch traffic through the npm package's Agent/Client. That makes GHSA-qrxm (crash) the one with direct impact.
- The cache, dedupe, WebSocket and EventSource advisories do not apply: the proxy does not use those features.
- On Bun, none of them apply, because the npm code never runs (§3).

### 3. undici under Bun

- Bun's resolver lists `undici` (and `ws`, `node-fetch`, `isomorphic-fetch`, `@vercel/fetch`) under "Thirdparty packages we override" (`src/resolve_builtins/HardcodedModule.rs:749-755`, oven-sh/bun main, read 2026-11-06). Importing `undici` resolves to the built-in `src/js/thirdparty/undici.ts`, not to `node_modules/undici`. Inference, not tested: `bun build --compile` therefore does not bundle the npm package either.
- In that shim (last commit 9e76acc6fb, 2026-10-31):
  - `fetch = Bun.fetch` (line 9).
  - `class Agent extends Dispatcher {}`, `class Pool extends Dispatcher { request() {} }` and `class ProxyAgent extends DispatcherBase { constructor() { super(); } }` (lines 270-286) all ignore their arguments.
  - `setGlobalDispatcher` only stores the value (line 459).
  - `request()` maps onto `Bun.fetch` and drops `dispatcher`, `headersTimeout` and `bodyTimeout` (lines 110-118, 169, 186).
- oven-sh/bun#38840 (opened 2026-08-15, open): "the builtin undici shim ignored the dispatcher option". Re-tested on 1.4.0-canary, Agent is "an inert stub". Fix PR #38855 (2026-08-15) is open and not merged. #4474 "Support undici ProxyAgent" has been open since 2023-09-04.
- Bun's own proxy controls (https://bun.com/reference/globals/BunFetchRequestInit and https://bun.sh/docs/runtime/networking/fetch.md, read 2026-11-06):
  - `fetch(url, { proxy: string | URL | false | { url, headers, respectNoProxy } })`.
  - "Without a `proxy` option, Bun reads `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` ... each time `fetch` runs." `proxy: false` connects directly.
  - `Bun.FetchSession` owns a keep-alive pool.
- Effect on the repo:
  - `captchaFetch` (`captcha-happy.ts:172-177`) and the sync-XHR worker (`captcha-happy.ts:60-63`) pass `dispatcher: new ProxyAgent(url)`. On Bun that is a no-op, so the request goes direct, or through an ambient proxy variable.
  - The repo's existing test already depends on the Bun no-op path: "is a safe no-op under Bun (never imports undici)" (`runtime/node-fetch-compat.test.ts:5`).
  - No test covers `ZCODE_PROXY_UPSTREAM_PROXY` (grep of `src/**/*.test.ts`).
- Bun shim body fix: commit 5fce36ebb6 (#42573, 2026-09-14), "node-fetch, undici: end the body stream when a body method took the response". Which Bun release first ships it is UNVERIFIED; it is after 1.4.2, so presumably 1.4.3.
- Bun-side fetch leak fixes in 1.4.3 (an abort-listener cycle, slow compressed body reads) are covered in `research/bun.md`.

### 4. Body-consumption rules (primary source)

From the undici README at v8.12.4, section "Garbage Collection":

> leaving the release of connection resources to the garbage collector can lead to excessive connection usage, reduced performance ..., and even stalls or deadlocks when running out of connections. Therefore, **it is important to always either consume or cancel the response body anyway**.

- For `undici.request`, consuming the body (e.g. `await body.dump()`) is "_mandatory_".
- Since 8.11.1 (#5872), the README and Fetch.md also say that `.arrayBuffer()`, `.json()`, `.text()` and the other mixins "buffer the entire body in memory". For untrusted sources they advise reading `response.body` as a stream with your own size limit.
- On Bun, sockets are owned by `Bun.fetch`, not undici, but the same rule is the safe default.

### 5. Repo grep: undici imports and fetch bodies (candidates, not conclusions)

undici imports (whole repo, excluding node_modules):
- `zcode-proxy-src/src/proxy/captcha-happy.ts:19`: `import { ProxyAgent } from "undici"` (static import; resolves to the Bun shim on Bun).
- `zcode-proxy-src/src/proxy/captcha-happy.ts:62`: `require("undici")` inside the eval Worker source.
- `zcode-proxy-src/src/runtime/node-fetch-compat.ts:36`: `await import("undici")`, Node only, guarded at line 32.
- Comments only: `handler.ts:781,837`, `captcha-retry.ts:45,169`, `captcha-happy.ts:2014,2093`.

Candidate sites:

| # | file:line | Candidate |
|---|---|---|
| 1 | `src/proxy/captcha-happy.ts:171-177`, `:440`, `src/index.ts:243-252` | On Bun, `dispatcher: ProxyAgent` is ignored. The explicit captcha proxy is silently unused while the banner claims it is used. Ambient `HTTP(S)_PROXY` is *honoured* by Bun, which contradicts the comment. |
| 2 | `src/proxy/captcha-happy.ts:60-63` | The sync-XHR worker builds a `new ProxyAgent()` **per request** and never `close()`s it. On Node this creates one pool per request; idle sockets live until keep-alive expires. On Bun it is an inert stub. |
| 3 | `src/proxy/captcha-happy.ts:70` vs `:76` | The worker buffers the whole body (`arrayBuffer()`) before it checks the 8 MiB SAB limit, so there is no size cap while reading. When the host gives up (`:123-126`), the worker fetch keeps running until its own `AbortSignal.timeout`. |
| 4 | `src/proxy/captcha-happy.ts:425-426` | CDN fetch: when the status is not 200 it throws without `res.body?.cancel()`. |
| 5 | `src/proxy/captcha-happy.ts:456-457` | Passthrough XHR fetch has no signal or timeout, and an unbounded `arrayBuffer()`. |
| 6 | `src/proxy/captcha-happy.ts:1765-1775` | Cookie-priming `captchaFetch("https://zcode.z.ai/")` reads only headers. **The body is never consumed or cancelled.** No timeout. |
| 7 | `src/proxy/client-signing.ts:474` | Gate: `if (!resp.ok) return "unavailable"` without cancelling the body. |
| 8 | `src/proxy/client-signing.ts:525` | Handshake: when the status is not 200 it throws without cancelling the body. |
| 9 | `src/proxy/client-signing.ts:566-576` | `isVerifyFailure` reads `resp.clone()` (`:366`). The original 401 response is then overwritten by the retry (`:571`, `:576`) and its tee branch is never cancelled. |
| 10 | `src/auth/resolver.ts:23-25`, `:43-45` | `!resp.ok` throws without consuming the body. No timeout or signal on either fetch. |
| 11 | `src/proxy/endpoint-routing.ts:227` | Status outside 2xx throws without cancelling the body. |
| 12 | `src/mcp/client.ts:189-191`, `:193-195`, `:204` | The timeout timer is cleared once headers arrive (`finally`), so `httpResp.text()` at `:204` has no time bound. `!ok` throws without consuming the body. |
| 13 | `src/proxy/captcha.ts:62-63` | Config fetch has no timeout or signal. The body is consumed. |
| 14 | `src/server/server.ts:349-351` | Backpressure `await new Promise(res.once("drain"))` has no race against `close` or abort. If the client disconnects while backpressured, `onAbort` cancels the reader but this promise never settles. The handler then stays pending, holding `resp` and its reader. |
| 15 | `src/proxy/handler.ts:423,433,441` with `:1346` | `tee()`: `statsBody` keeps pulling after the client branch stops. A slow client makes the tee buffer grow without bound. Upstream abort is tied to client `close` (`server.ts:235-238` → `handler.ts:243`), so a disconnect is covered; a slow-but-connected client is not. |

Sites checked and found to consume or cancel correctly: `routes-quota.ts:225-226`, `index.ts:965-969`, `claim/client.ts:149-155`, `async/client.ts:99-105`, `async/bridge.ts:186-199,309-310,360-425`, `auth/oauth.ts:128-129,427-438`, `upstream-errors.ts:116-128,221-320`, `captcha-retry.ts:109,136-150`, and `handler.ts:753-772,861-874`. The oauth fetches have no timeout (low severity).

### 6. yaml

npm `time` for yaml, read 2026-11-06:

| Version | Date | Notes |
|---|---|---|
| 2.8.3 | 2026-03-21 | "Catch stack overflow during node composition". Fixes CVE-2026-33532 / GHSA-48c2-rrv3-qjmp (medium, stack overflow from deeply nested collections, affects >=2.0.0 <2.8.3). |
| 2.8.4 | 2026-05-02 | `maxAliasCount: 0` disables alias resolution. Invalid unicode escapes handled. |
| 2.9.0 (locked) | 2026-05-11 | "only patches". Lexer recursion removed. **Docs no longer claim `parseDocument()` "never throw[s]"**. From this release on, call-stack exhaustion from malicious input counts as a bug, not a CVE. |
| **2.9.1 (latest)** | **2026-09-11** | "Limit recursive merge aliases (#685, #713)". Quoted-string line unfolding simplified. |
| 3.0.0-2 (`next`) | 2026-09-11 | v3 breaking changes: ESM-only, no default export (`import * as YAML`), `doc.contents` becomes `.value`, the `keepScalar` argument of `get/getIn` is dropped, `node.toJSON()` removed, Node ≥20.19. The repo uses named imports (`parse`, `parseDocument`), but `getIn` return values would change in v3. Do not adopt a prerelease. |

Advisory DB (read 2026-11-06): only GHSA-48c2-rrv3-qjmp (fixed in 2.8.3) and GHSA-f9xv-q969-pqx4 / CVE-2023-2251 (fixed in 2.2.2). The locked 2.9.0 is not affected. The `^2.5.0` floor still admits affected versions.

Usages:
- `zcode-proxy-src/src/config/loader.ts:5,102`: `parse(raw) ?? {}`. Defaults apply: YAML 1.2, `uniqueKeys: true` (a duplicate key raises an error), `strict: true`, `maxAliasCount` 100 (local `node_modules/yaml/dist/doc/Document.js:35-43,300`). `parse` throws on the first error (`dist/public-api.js:74`).
- `zcode-proxy-src/src/config/edit.ts:5,22-25,33-38`: `parseDocument` → `set`/`setIn` → `String(doc)`.
  - `parseDocument` collects errors rather than throwing, but `toString()` throws `"Document with errors cannot be stringified"` (`Document.js:322`). A hand-broken `config.yaml` therefore makes `updateConfigYaml` throw (callers: `index.ts:436`, `tui/app.ts:353`).
  - `writeFileSync` is not atomic.
- `tests/continue-compatibility.test.mjs:12`: `require("yaml")` resolved from `zcode-proxy-src/package.json`.

The 2.9.1 merge-alias limit only matters when merge keys are enabled: the YAML 1.1 schema, or `merge: true`. That happens only if `config.yaml` carries a `%YAML 1.1` directive. This is an inference from `dist/schema/tags.js:39-59` and not tested; issue #685 returned 404 through the API.

## Sources

- npm registry `npm view undici time` / `dist-tags` and `npm view yaml time` / `dist-tags`, read 2026-11-06.
- undici releases v8.10.1 → v8.12.4, 2026-08-31 → 2026-11-05: https://github.com/nodejs/undici/releases (e.g. https://github.com/nodejs/undici/releases/tag/v8.12.4, 2026-11-05T08:54:28Z; https://github.com/nodejs/undici/releases/tag/v8.12.2, 2026-10-15; https://github.com/nodejs/undici/releases/tag/v8.10.2, 2026-09-04).
- undici README, Garbage Collection and body-buffering warning, tag v8.12.4 (2026-11-05): https://github.com/nodejs/undici/blob/v8.12.4/README.md
- undici API docs diff, v8.10.0 vs v8.12.4: https://github.com/nodejs/undici/blob/v8.12.4/docs/docs/api/Client.md, https://github.com/nodejs/undici/blob/v8.12.4/docs/docs/api/Pool.md, https://github.com/nodejs/undici/blob/v8.12.4/docs/docs/api/Agent.md, https://github.com/nodejs/undici/blob/v8.12.4/docs/docs/api/Fetch.md
- undici PRs and issues: https://github.com/nodejs/undici/pull/5846 (merged 2026-09-24), https://github.com/nodejs/undici/pull/5881 (2026-09-28), https://github.com/nodejs/undici/pull/5882 (2026-09-24), https://github.com/nodejs/undici/pull/5677 (2026-09-14), https://github.com/nodejs/undici/pull/5850 (2026-09-23), https://github.com/nodejs/undici/pull/5872 (2026-09-24), https://github.com/nodejs/undici/pull/6070 (2026-10-30), https://github.com/nodejs/undici/issues/5566 (closed 2026-07-20), https://github.com/nodejs/undici/pull/5822 (open, 2026-09-14), https://github.com/nodejs/undici/issues/5704 (open, 2026-08-19).
- GitHub Advisory Database, undici and yaml, read 2026-11-06: https://github.com/advisories?query=undici, https://github.com/advisories/GHSA-qrxm-fqhp-jwvm (2026-10-27), https://github.com/advisories/GHSA-2m5v-pch6-74hx (2026-10-27), https://github.com/advisories/GHSA-vp8m-p9jh-q5pm (2026-09-29), https://github.com/advisories/GHSA-48c2-rrv3-qjmp (2026-03-25), https://github.com/advisories/GHSA-f9xv-q969-pqx4 (2023-04-24).
- Bun hardcoded module aliases, main, read 2026-11-06: https://github.com/oven-sh/bun/blob/main/src/resolve_builtins/HardcodedModule.rs
- Bun undici shim, last commit 9e76acc6fb, 2026-10-31: https://github.com/oven-sh/bun/blob/main/src/js/thirdparty/undici.ts ; body-stream fix https://github.com/oven-sh/bun/pull/42573 (commit 2026-09-14).
- Bun issue on the ignored dispatcher: https://github.com/oven-sh/bun/issues/38840 (opened 2026-08-15, open); PR https://github.com/oven-sh/bun/pull/38855 (open); https://github.com/oven-sh/bun/issues/4474 (opened 2023-09-04, open).
- Bun fetch proxy docs (undated pages, read 2026-11-06): https://bun.com/reference/globals/BunFetchRequestInit, https://bun.sh/docs/runtime/networking/fetch.md, https://bun.com/guides/http/proxy
- yaml releases: https://github.com/eemeli/yaml/releases/tag/v2.9.1 (2026-09-11T20:29:18Z), https://github.com/eemeli/yaml/releases/tag/v2.9.0 (2026-05-11T10:32:38Z), https://github.com/eemeli/yaml/releases/tag/v2.8.4 (2026-05-02), https://github.com/eemeli/yaml/releases/tag/v2.8.3 (2026-03-21), https://github.com/eemeli/yaml/releases/tag/v3.0.0-2 (2026-09-11), https://github.com/eemeli/yaml/releases/tag/v3.0.0-0 (2026-02-13).
- Local installed sources (read-only): `zcode-proxy-src/node_modules/yaml/dist/doc/Document.js`, `dist/public-api.js`, `dist/schema/tags.js` (yaml 2.9.0); `zcode-proxy-src/node_modules/undici/package.json` (8.10.0).
