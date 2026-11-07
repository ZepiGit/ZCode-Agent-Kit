# happy-dom: latest version, Window lifecycle and teardown

## Answer
1. Latest stable is **happy-dom 21.0.4**, published 2026-10-20 (npm `latest`). The proxy pins `^20.11.6`, which resolves to 20.14.6 (2026-10-08) as the newest 20.x. Since 20.11 there has been one new major (21.0.0, 2026-10-11).
2. The teardown code is **byte-identical from 20.11.6 to 21.0.4**. That covers Window, DetachedWindowAPI, AsyncTaskManager, BrowserFrameFactory.destroyFrame and the Detached* browser classes. The repo's teardown, `await win.happyDOM.close()` at captcha-happy.ts:2185, is the documented one and stays correct. `window.close()` would not work here: it does nothing on a top-level window (#2424).
3. Recommendation: upgrade to `^21.0.4`. It is the only version that fixes GHSA-834v-8h66-3h79 (ESM import alias, high, affects ≤21.0.3). It also includes the fixes for GHSA-5fpq-26gf-qwcr (cookie scope) and GHSA-c8p4-j97h-3vg8 (SSRF).
4. The upgrade has one behaviour break: CSS and iframe page loading are now off by default. Add `enableCSSFileLoading: true, enableIframePageLoading: true` to the settings at captcha-happy.ts:1804-1814 to keep the 20.x behaviour. Then run the captcha tests and do one live solve before deciding whether to drop either flag.
5. A gap that exists on every version: the async interceptor (captcha-happy.ts:411-472) is registered with happy-dom without an abort handler, and it never passes a signal to `fetchAsync`. As a result, `happyDOM.close()` cannot cancel in-flight host fetches. Those late fetches then read and write cookies through `global.__browserFrame` and `global.__cookieContainer` (lines 446, 351), which may by then belong to the *next* window. Fix: tie an AbortSignal to the window and use the window's own frame instead of the globals.

## Details

### 1. Versions and dates (npm registry `time`, queried 2026-11-05)

| Version | Published (UTC) | Relevance to this usage |
|---|---|---|
| 20.11.6 (pinned, installed) | 2026-08-19 | docs-only release (global-registrator docs, task #2300) |
| 20.11.0 | 2026-07-18 | CookieStore API, `Element.checkVisibility()` |
| 20.11.2 | 2026-08-07 | **MutationObserver callbacks could be GC'd** (orphaned WeakRef, #2264). Already in 20.11.6 |
| 20.11.4 | 2026-08-19 | fetch CORS check compares origins (#1490). Already in 20.11.6 |
| 20.11.7–20.11.15 | 2026-08-26…28 | adoptedStyleSheets validation, custom-element upgrade fixes (#2313–#2331). No lifecycle changes |
| 20.12.0 | 2026-08-29 | `Animation`, `Element.animate()` (adds new window globals) |
| 20.12.1–20.14.5 | 2026-09-01…09-12 | CSS / computed-style work (#2256, #2342–#2366, #2407, #2409). No lifecycle changes |
| 20.14.6 | 2026-10-08 | **cookie scope forgery fix** (GHSA-5fpq-26gf-qwcr) |
| **21.0.0** | 2026-10-11 | **BREAKING: CSS and iframe loading disabled by default** (SSRF, GHSA-c8p4-j97h-3vg8) |
| 21.0.1 | 2026-10-12 | server-renderer CLI aliases only |
| 21.0.2 | 2026-10-15 | server-renderer SSRF (GHSA-pmf4). Not used here |
| 21.0.3 | 2026-10-15 | strips `Authorization` on cross-origin redirects (Fetch.ts / SyncFetch.ts) |
| **21.0.4** | 2026-10-20 | **ESM compiler code injection fix** (GHSA-834v-8h66-3h79). `data:` iframes get opaque-origin parent/top |

Majors and minors since 20.11 that matter for this usage: **20.11.2** (a MutationObserver fix, already included in the pin), **20.14.6** (cookie security) and **21.0.0** (loading defaults). 20.12, 20.13 and 20.14.0 add features and change CSS only.

### 2. Source diff 20.11.6 → 21.0.4 (local `diff -u` of the shipped `src/`)
These files have **0 changed lines**:
- window/Window.ts, GlobalWindow.ts, DetachedWindowAPI.ts, WindowBrowserContext.ts
- async-task-manager/AsyncTaskManager.ts
- browser/utilities/BrowserFrameFactory.ts, BrowserPageUtility.ts
- browser/detached-browser/DetachedBrowser.ts, DetachedBrowserContext.ts, DetachedBrowserPage.ts, DetachedBrowserFrame.ts
- browser/BrowserPage.ts
- mutation-observer/MutationObserverListener.ts
- xml-http-request/XMLHttpRequest.ts

BrowserWindow.ts changed only by adding the Animation, AnimationTimeline, DocumentTimeline and KeyframeEffect globals.

Other things that still work on 21.0.4:
- The deep import `happy-dom/lib/window/WindowBrowserContext.js` (captcha-happy.ts:18) still exists in 21.0.4.
- `package.json` still has no `exports` map, so deep imports keep working.
- `GlobalWindow` and `PropertySymbol` are still exported from the package root.

What changed for this usage:
- **DefaultBrowserSettings:** adds `enableCSSFileLoading: false` and `enableIframePageLoading: false`. `disableCSSFileLoading` and `disableIframePageLoading` are deprecated but still honoured.
- **HTMLIFrameElement `#loadPage`:** any connected iframe without `srcdoc` now hits the "Iframe page loading is disabled" branch unless `enableIframePageLoading` is true. That includes src-less iframes, which resolve to about:blank. In that case it fires `error`, logs a DOMException to `page.console` (the solver's silent console) and creates no child frame. `srcdoc` iframes are not affected.
- **HTMLLinkElement:** `<link rel=stylesheet>` and `preload as=style` are skipped unless `enableCSSFileLoading` is true. The link fires `error`, or `load` if `handleDisabledFileLoadingAsSuccess` is set.
- **Fetch / SyncFetch:** strip `Authorization` on cross-origin redirects. This does not matter here, because the interceptor fetches with `redirect: "error"` itself (captcha-happy.ts:425, 456) and happy-dom never sees the redirects.
- **BrowserFrameNavigator:** `data:` (opaque-origin) child frames get `CrossOriginBrowserWindow` parent/top.

Settings that did **not** change in 20.11→21: `enableJavaScriptEvaluation`, `suppressInsecureJavaScriptEnvironmentWarning`, `fetch.interceptor` / `fetch.disableSameOriginPolicy`, `navigation.*`, `timer.*` and `module.*`. The rename from `disableJavaScriptEvaluation` to `enableJavaScriptEvaluation` (JS off by default) happened in **20.0.0** (2025-10-09). The repo already sets `enableJavaScriptEvaluation: true` (captcha-happy.ts:1805).

UNVERIFIED: whether the Aliyun/FeiLin SDK needs CSS links or iframe child frames to complete a solve. The comment at captcha-happy.ts:2183 implies `#cap` can hold iframes. That is why step 4 of the Answer keeps both flags on until a live solve shows they can go.

### 3. Lifecycle, as implemented (20.11.6 = 21.0.4)
**Construction.** `new Window(opts)` (window/Window.ts) works like this:
- It builds a private `DetachedBrowser(BrowserWindow, {console, settings})` and takes `defaultContext.pages[0].mainFrame`.
- It calls `super(browserFrame)`, sets `browserFrame.window = this` and exposes `happyDOM = new DetachedWindowAPI(browserFrame)`.
- `GlobalWindow` extends `Window` and only adds host intrinsics as own fields.
- `BrowserPage.console = context.browser.console ?? new VirtualConsole(virtualConsolePrinter)` (BrowserPage.ts:34, DetachedBrowserPage.ts:34). The repo passes its own `console` (captcha-happy.ts:1803), so guest logs bypass the unbounded VirtualConsolePrinter buffer from #2202.

**`happyDOM.close()`** calls `browserFrame.page.close()`, which calls `BrowserPageUtility.closePage(page)`. That function:
- returns immediately if `page.closed`;
- otherwise sets `page.closed = true` *first*, splices the page from `context.pages` and closes the virtual console printer;
- then calls `BrowserFrameFactory.destroyFrame(mainFrame)`.

`destroyFrame` sets `frame.closed = true`, then recursively destroys the child frames (iframes) and awaits them. After that it calls `asyncTaskManager.destroy()` and synchronously runs `window[PropertySymbol.destroy]()`. Once the task manager resolves, it does the following:
- disconnects the exception observer;
- replaces `frame.window` with `{ closed: true }`;
- nulls the opener refs;
- clears the navigation listeners.

`DetachedBrowserPage.close()` then calls `context.browser.close()` only if `context.pages[0] === this`. The page was already spliced out, so this looks like it never fires for a detached window. If so, the context's `cookieContainer` and `responseCache` are not cleared, only dropped together with the Window. This is my reading of the source only (UNVERIFIED by test). It does not matter here because `destroyDom` nulls the globals that hold them (captcha-happy.ts:2193-2196).

Two consequences:
- A second `close()` returns the early-resolved promise while child destruction may still be pending. This is exactly why `destroyDom` memoises the first close promise (captcha-happy.ts:2178-2181) and why `_domCloseFailed` exists (1745-1748).
- The wiki documents `close()` as "Closes the window and associated browser."

**`BrowserWindow[PropertySymbol.destroy]()`** sets `closed = true` and then:
- destroys every **MutationObserver** and every **open WebSocket**;
- destroys the document and replaces it with an empty html/head/body;
- destroys location, customElements and history;
- clears the querySelector cache, the json/css/esm module maps and the preloads;
- nulls `parent`/`top`;
- calls `WindowBrowserContext.removeWindowBrowserFrameRelation(this)`.

**`AsyncTaskManager.destroy()`** runs `abortAll(true)`. It marks the manager destroyed, clears every tracked timer and immediate with the host `clearTimeout` / `clearImmediate`, and calls each task's abort handler with `destroy = true`. It resolves after a 1 ms trailing `setTimeout`, so pending microtasks can drain. After destroy:
- `startTimer` / `startImmediate` immediately clear the new handle;
- `startTask` calls the abort handler and **throws** "The asynchronous task manager has been destroyed…".

**Timers and other async work, on close:**

| Kind | Tracked how | Fate on close |
|---|---|---|
| `window.setTimeout`, `setInterval` | `startTimer` | Cleared. After close, `setTimeout` / `setInterval` / `requestAnimationFrame` return `{}` without scheduling, because `this.closed` is true |
| `requestAnimationFrame` | `setImmediate` + `startImmediate` | Cleared |
| `window.queueMicrotask` | task with an `isAborted` flag | Callback suppressed |
| XHR (async) | `startTask(() => this.abort())` | Aborted |
| fetch through `sendRequest` | `startTask(() => this.onAsyncTaskManagerAbort())` | Aborted |
| `fetch.interceptor.beforeAsyncRequest` | `startTask()` **without** an abort handler (Fetch.ts:149-155) | The task is forgotten, but the interceptor's own promise and any host fetch inside it **keep running** |
| MutationObserver, WebSocket | window destroy | Destroyed |
| Host `globalThis.setTimeout` / `setInterval` | not tracked | **Survive close**. This is the reason for the repo's lexical guest scope (captcha-happy.ts:564-623) |

**`happyDOM.abort()`** calls `frame.abort()`, which runs `abortAll(false)` on the frame and all child frames. It cancels the same set of work but leaves the window usable and does not destroy it. `close()` already includes it, so calling `abort()` before `close()` is redundant.

**`happyDOM.waitUntilComplete()`** resolves once no tasks, timers or immediates are tracked, plus a trailing 1 ms tick. A guest `setInterval` heartbeat never lets it resolve. `debug.traceWaitUntilComplete > 0` makes it reject with traces and then `abortAll(true)`. The repo correctly never calls it.

**`window.close()`** (BrowserWindow.ts:2378-2389) only acts if the frame is the page's main frame **and** has an `openerWindow`, meaning the window was opened via `window.open`. On a `new Window()` it does nothing. This is confirmed upstream in issue **#2424** (open, 2026-09-18): jest-environment leaks a Window per test file because its teardown uses `abort()` + `window.close()`. The issue confirms that `happyDOM.close()` does release the window.

**`Browser.close()`** (DetachedBrowser.ts:77-84) empties `contexts` and then closes each context, which closes its pages. The non-detached `Browser` class is not used here.

**`GlobalRegistrator.unregister()`** (v21.0.4) restores or deletes the global descriptors first, then runs `await happyDOM.close()`. The repo uses the reverse order (close, then de-alias with a tombstone) on purpose, because guest stragglers may still resolve bare globals while frames drain. See section 5.

### 4. Known leaks since 20.11 (capricorn86/happy-dom)
- **#2264** (fixed in 20.11.2): MutationObserver callbacks were silently GC'd. This is a correctness bug, not a leak. Included in the pin.
- **#2424** (open): `window.close()` does nothing on top-level windows, so the jest environment leaks. Not applicable here, because the repo uses `happyDOM.close()`.
- **#2202** (open; PR #2204 open): the VirtualConsolePrinter buffers every log forever, and logged Errors pin DOM nodes. Mitigated here because a custom `console` is passed (1791-1803), so the printer is never fed.
- **#2195** (open; PR #2196 open): undefined custom elements (hyphenated tags) pin detached documents to a *long-lived* Window. This only matters for the reuse pool (`CAPTCHA_WINDOW_REUSE=1`, 2254-2291), which caps it at 25 solves or 120 s idle.
- **#2148** (open): documents parsed with DOMParser are not reclaimed promptly after `happyDOM.close()`. The heap stays high until several GCs have run.
- **#2120** (open; PR #2121 "WeakMap for window-to-frame mapping" open): create/close loops grow the heap. 20.11.6 already does `removeWindowBrowserFrameRelation` in destroy. Whether #2120 is fully fixed is UNVERIFIED.
- **#1892** (closed 2025-10-28; PR #1901): event-listener leak. Fixed before 20.11.

None of these has a fix shipped in 20.12–21.0.4: the leak-fix PRs listed are still open. Heap is ultimately bounded by the worker design (captcha-solver-worker.ts:4-7): the host terminates the worker at a deadline, which frees its heap.

### 5. How the repo creates and closes the Window, and whether it matches
- Pin: zcode-proxy-src/package.json:16 `"happy-dom": "^20.11.6"`. The lockfile and node_modules have 20.11.6.
- Imports (captcha-happy.ts:17-18): `GlobalWindow as Window`, `PropertySymbol`, and the deep import `lib/window/WindowBrowserContext.js`.
- Creation (captcha-happy.ts:1751, 1801-1815): `new Window({ url, console, settings: { enableJavaScriptEvaluation, enableImageFileLoading, suppressInsecureJavaScriptEnvironmentWarning, navigator, viewport, fetch: { disableSameOriginPolicy, interceptor } } })`. This is a valid 20.x and 21.x shape. On 21 it would silently stop loading iframes and CSS.
- Frame access (1823-1826): `new WindowBrowserContext(w).getBrowserFrame()`, stored in `global.__browserFrame` and `global.__cookieContainer`.
- Under Bun, the guest runs in the host realm. The repo aliases window members onto `globalThis` (1883-1888, `installGlobalWindowAlias` 2019) and binds guest timers to the window's registry through a `with` scope (564-623). The repo's tests prove that every `setInterval` path dies on close (captcha-happy.test.ts:99-137).
- `w.close` and `w.open` are replaced with no-ops (captcha-happy.ts:990-993). The comment there says happy-dom's `close()` "tears the window down". For a top-level window it is already a no-op (section 3), so the stub is harmless but the comment overstates it. It matters only for `window.open` children, which the `open` stub prevents anyway.
- Teardown (`destroyDom`, 2172-2207):
  1. memoised `await win.happyDOM.close()` (2185);
  2. on failure, latch `_domCloseFailed` and admit no new DOMs;
  3. on success, null the globals (2193-2196), remove the aliases with a tombstone grace period (2199, 2109-2170), remove the guest scope (2202) and stop the sync-fetch worker (2203).

  It is called from `solveTraceless`'s `finally` unless the window was pooled (2436-2455), and from `discardReusableWindow` (2279-2287).

**Verdict: matches the documented teardown.** It uses `happyDOM.close()`, not `window.close()`. It awaits the close, keeps the scope and aliases alive until frames have drained, and drops host references afterwards. There is no `abort()` or `waitUntilComplete()` call, and none is needed.

**Gap (all versions).** The interceptor's `beforeAsyncRequest` (411-472) calls `fetchAsync` (`captchaFetch`, 173-177, with no timeout and no signal) at 425 and 456. happy-dom registers the interceptor as a task with no abort handler (Fetch.ts:149-155), so `close()` cannot cancel these calls. A straggler that resolves after close does three things:
- `new w.Response(...)` on a destroyed window;
- `storeSetCookies` into whatever `global.__cookieContainer` holds at that moment (351), which could be the next solve's window;
- `cookieHeader(request, w, global.__browserFrame)` (446) uses the global frame, not `w`'s.

Fix:
- give each window an `AbortController` and pass its `signal` to `fetchAsync`;
- abort it in `destroyDom` before or alongside `happyDOM.close()`;
- read the frame and cookie container from `_domOwners.get(w).browserFrame` instead of the globals.

The worker's hard-deadline `terminate()` remains the backstop.

## Sources
- npm registry, `npm view happy-dom time` / `dist-tags` (queried 2026-11-05): latest = 21.0.4, published 2026-10-20T18:05:53Z; all dates in the table. https://www.npmjs.com/package/happy-dom
- GitHub releases v20.11.0–v21.0.4 (published 2026-07-18 … 2026-10-20), via `gh api repos/capricorn86/happy-dom/releases`: https://github.com/capricorn86/happy-dom/releases ; v21.0.0 breaking change: https://github.com/capricorn86/happy-dom/releases/tag/v21.0.0 (2026-10-11)
- v20.0.0 release notes, JS evaluation off by default (2025-10-09): https://github.com/capricorn86/happy-dom/releases/tag/v20.0.0
- Security advisories (via `gh api …/security-advisories`): GHSA-834v-8h66-3h79 (2026-10-20), GHSA-c8p4-j97h-3vg8 (2026-10-12), GHSA-5fpq-26gf-qwcr (2026-10-08), GHSA-pmf4-3xr3-xjhg (2026-10-15), GHSA-w4gp-fjgq-3q4g (2026-03-26), GHSA-6q6h-j7hj-3r64 (2026-03-24), GHSA-37j7-fg3j-429f (2025-10-09) — https://github.com/capricorn86/happy-dom/security/advisories
- Issues: #2424 (2026-09-18) https://github.com/capricorn86/happy-dom/issues/2424 ; #2264 (2026-07-30) https://github.com/capricorn86/happy-dom/issues/2264 ; #2202 (2026-06-11) https://github.com/capricorn86/happy-dom/issues/2202 ; #2195 (2026-06-11) https://github.com/capricorn86/happy-dom/issues/2195 ; #2148 (2026-04-29) https://github.com/capricorn86/happy-dom/issues/2148 ; #2120 (2026-04-01) https://github.com/capricorn86/happy-dom/issues/2120 ; #1892 https://github.com/capricorn86/happy-dom/issues/1892 ; PRs #2121, #2196, #2204 (open), #1901 (merged 2025)
- Wiki (fetched 2026-11-05, undated pages): DetachedWindowAPI https://github.com/capricorn86/happy-dom/wiki/DetachedWindowAPI ; Browser https://github.com/capricorn86/happy-dom/wiki/Browser ; IBrowserSettings https://github.com/capricorn86/happy-dom/wiki/IBrowserSettings (still shows the 20.x CSS default, so it is stale relative to 21.0.0)
- Source, happy-dom 20.11.6 as installed: /home/AgentKit/wt/overhaul/zcode-proxy-src/node_modules/happy-dom/src/ (window/Window.ts, window/BrowserWindow.ts:333-343, 2378-2389, 2419-2700, 2968-3017; window/DetachedWindowAPI.ts:44-78; async-task-manager/AsyncTaskManager.ts; browser/utilities/BrowserFrameFactory.ts:29-105; browser/utilities/BrowserPageUtility.ts; browser/detached-browser/*.ts; fetch/Fetch.ts:149-155, 544-546)
- Source, happy-dom 21.0.4 tarball (registry, published 2026-10-20), diffed locally against 20.11.6. Equivalent upstream tree: https://github.com/capricorn86/happy-dom/tree/v21.0.4/packages/happy-dom/src
- GlobalRegistrator and jest-environment teardown at v21.0.4: https://github.com/capricorn86/happy-dom/blob/v21.0.4/packages/@happy-dom/global-registrator/src/GlobalRegistrator.ts , https://github.com/capricorn86/happy-dom/blob/v21.0.4/packages/@happy-dom/jest-environment/src/index.ts
- Repo: /home/AgentKit/wt/overhaul/zcode-proxy-src/package.json:16 ; src/proxy/captcha-happy.ts (lines cited above) ; src/proxy/captcha-solver-worker.ts:4-7, 30-34 ; src/proxy/captcha-happy.test.ts:99-137, 166
