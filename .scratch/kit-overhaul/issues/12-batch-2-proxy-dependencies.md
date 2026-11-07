# 12: Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1

**Blocked by:** 11 (Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0007

**What to build:** happy-dom `^21.0.4` with `enableCSSFileLoading: true` and `enableIframePageLoading: true` (surface unchanged, not stricter), undici `^8.12.4`, yaml `^2.9.1`. The captcha suite runs green right after the happy-dom bump, before any other captcha-path change.

**Acceptance criteria:**

- [ ] `captcha-happy`, `captcha-solver`, `captcha-cdn-cache` suites green on the happy-dom commit alone; full `test:proxy` green after the batch.
- [ ] `bun audit` shows the happy-dom/undici advisories from drift.md resolved.
- [ ] Both `memory-budget` legs green (entries handled as in 09).
- [ ] A test asserts that the happy-dom Window is constructed with `enableCSSFileLoading: true` and `enableIframePageLoading: true`, and fails if either flag is removed (ADR-0007, B1).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 127, 128

## Comments

### 2026-11-07: implementer (substitute for glm; the glm worker has no provider)

**Branch:** `ticket/12-proxy-dependencies` (worktree `/home/AgentKit/wt/t12`), created on the integration tip `07b4ecd`; the tip `7f9f697` (RUNLOG only; ticket 08 still staged) was merged in as `a2a9fda`, clean. Commits:
- `2c7bd87` fix(proxy): happy-dom ^21.0.4 with CSS and iframe loading kept on (package.json, bun.lock, `captcha-happy.ts` settings, 3 tests);
- `366cd10` fix(proxy): undici ^8.12.4 and yaml ^2.9.1 (package.json, bun.lock).
The head SHA is the commit that adds this comment. Bun 1.4.2 everywhere (`bun --version` = 1.4.2 in every log).

**Versions are the latest stable (npm registry, `npm view <pkg> dist-tags time`, read 2026-11-07):**
- happy-dom `latest` = 21.0.4 (2026-10-20T18:05:53Z). https://www.npmjs.com/package/happy-dom
- undici `latest` = 8.12.4 (2026-11-05T08:55:59Z). Other tags are the 5/6/7 lines and prereleases. https://www.npmjs.com/package/undici
- yaml `latest` = 2.9.1 (2026-09-11T20:30:10Z). `next` = 3.0.0-2 is a prerelease, not adopted. https://www.npmjs.com/package/yaml
- The lockfile integrity hashes equal `npm view <pkg>@<v> dist.integrity` for all three: happy-dom `sha512-tFm+GaLB…raLBw==`, undici `sha512-8Mx+uNKK…bam1VA==`, yaml `sha512-3NxN8+78…Eb2yFw==`. The bump changed no transitive entry in `bun.lock`: the happy-dom 21.0.4 dependency set equals 20.11.6's.

**Advisories (GitHub Advisory DB, `gh api 'advisories?ecosystem=npm&affects=<pkg>'`, read 2026-11-07):**
- happy-dom: GHSA-834v-8h66-3h79 (high, >=17.0.0 <=21.0.3, fixed 21.0.4), GHSA-c8p4-j97h-3vg8 (high, <=20.14.6, fixed 21.0.0), GHSA-5fpq-26gf-qwcr (medium, <=20.14.5, fixed 20.14.6). None affects 21.0.4. https://github.com/advisories/GHSA-834v-8h66-3h79 , https://github.com/advisories/GHSA-c8p4-j97h-3vg8 , https://github.com/advisories/GHSA-5fpq-26gf-qwcr
- undici: the 19 from drift.md (fixed in 8.10.2 / 8.12.2) plus GHSA-qq8j-7v2v-3rwp (high, 8.11.0–8.11.1, fixed 8.11.2; new since drift.md and never on our lock). None affects 8.12.4. https://github.com/advisories?query=undici , e.g. https://github.com/advisories/GHSA-qrxm-fqhp-jwvm , https://github.com/advisories/GHSA-2m5v-pch6-74hx , https://github.com/advisories/GHSA-vp8m-p9jh-q5pm , https://github.com/advisories/GHSA-qq8j-7v2v-3rwp
- yaml: GHSA-48c2-rrv3-qjmp (medium, <2.8.3), now outside the `^2.9.1` range. https://github.com/advisories/GHSA-48c2-rrv3-qjmp
- **`bun audit` (proxy), RED to GREEN:** at the tip, **22 vulnerabilities (9 high, 10 moderate, 3 low)**: happy-dom 3, undici 19, the same list as drift.md. After the batch: **"No vulnerabilities found (checked 34 packages)"** (`reports/t12-frozen.log`).

**Lockfile:** `bun install` with Bun 1.4.2 (`reports/t12-install-hd.log`, `t12-install-uy.log`). `bun install --frozen-lockfile` reports "no changes" in the worktree. A fresh frozen install from only the committed `package.json` and `bun.lock` in an empty dir installs happy-dom 21.0.4, undici 8.12.4 and yaml 2.9.1, and leaves the lock byte-identical (sha256 `196cfb1e…23daa` on both) (`reports/t12-frozen.log`).

**ADR-0007 test (criterion 4) and the RED→GREEN order.** New `describe("solve DOM loading surface (ADR-0007)")` in `zcode-proxy-src/src/proxy/captcha-happy.test.ts`, at the `createDom` seam with the hermetic resources (the interceptor answers every request 503, so there is no network):
1. `the solve window is constructed with CSS file and iframe page loading enabled`: `happyDOM.settings.enableCSSFileLoading`/`enableIframePageLoading` are `true`, and the deprecated `disable*` switches are `false`.
2. `a stylesheet link in the solve DOM is fetched through the interceptor`: the link's request reaches the interceptor (error mentions the URL and 503), and there is no "CSS file loading is disabled".
3. `an iframe in the solve DOM gets a child frame`: the iframe gets a `contentWindow` and `childFrames.length` is 1, with no "Iframe page loading is disabled".
- On the tip (20.11.6): 1 fail and 2 pass (`reports/t12-red-tip.log`). Tests 2–3 pin the 20.x surface, and 20.x has no `enableCSSFileLoading` key, so test 1 got `undefined`.
- After the happy-dom bump **without** the flags, all 3 fail. They got `false`, "Failed to load external stylesheet … CSS file loading is disabled." and "Failed to load iframe page … Iframe page loading is disabled." (`reports/t12-red-hd21-noflags.log`).
- With the two flags added, all 3 pass.
- Mutations, each restored with `cp` and checked by `git diff` (only the intended 5 added lines remain):
  - drop `enableCSSFileLoading`: tests 1 and 2 fail (`t12-mut-css`);
  - drop `enableIframePageLoading`: tests 1 and 3 fail (`t12-mut-iframe`);
  - add `disableCSSFileLoading: true` beside the flag: tests 1 and 2 fail (`t12-mut-deprecated`).
- The suite has no new file, so the wiring guard is not affected; `bun test` collects it.

**Captcha suite on the happy-dom commit alone (criterion 1), run before anything else** (`reports/t12-captcha-hd21.log`, `t12-captcha-hd21b.log`):
- `captcha-happy` + `captcha-solver` + `captcha-cdn-cache`: **39 pass, 0 fail**. That is the tip's 36 plus the 3 new tests.
- All 13 `captcha-*.test.ts` files: **133 pass, 0 fail**. That includes `captcha-sdk-contract`, `captcha-compatibility`, `captcha-egress` and `captcha-retry`.

**B1 (anti-abuse behaviour unchanged).**
- The only source change is the two settings lines. Challenge handling, the interceptor, fingerprints and request shape are unchanged. With the flags on, stylesheet and iframe fetches still go through the same `fetch.interceptor` as on 20.x (test 2 proves the request reaches it).
- Per research/happy-dom.md §2, Window/teardown code is byte-identical 20.11.6 → 21.0.4.
- Differences that no flag controls (upstream security fixes that come with 21.x):
  - 21.0.3 strips `Authorization` on cross-origin redirects. It does not apply here, because the interceptor fetches with `redirect: "error"`.
  - 21.0.4 gives `data:` iframes an opaque-origin parent/top.
- Whether the vendor SDK needs CSS links or iframes stays unverified offline (ADR-0007). Dropping a flag still needs a live solve (owner action).

**Full suite after the merge of the tip:**
- `npm run test`: 698 tests, 679 pass, 0 fail, 19 skipped (same as the tip). `reports/t12-full-kit.log`
- `npm run test:proxy`: **1346 pass, 0 fail**, 90 files (the tip has 1343; +3). `reports/t12-full-proxy.log`
- `npm run test:proxy-typecheck`: **0 errors** (`t12-full-typecheck.log`). My first draft of the test had 2 TS2345 errors (happy-dom's EventTarget is not the DOM lib's). They were fixed with a structural type before the commit, and the source never had errors.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped. `git status` is clean afterwards, so `dist/` is unchanged.

**undici on the Node path, verified where it is consumed** (`runtime/node-fetch-compat.ts`, `/tmp/t12-scripts/undici-node-smoke.mjs`, `reports/t12-undici-node-b.log`):
- On Node 26.7.0 and Node 24.22.2, with npm undici 8.12.4 and 8.10.0:
  - `setGlobalDispatcher(new Agent({ headersTimeout: 300 }))` makes Node's **global** `fetch` fail with `UND_ERR_HEADERS_TIMEOUT` against a 3 s local server (port 19121);
  - `new Agent({ headersTimeout: 0, bodyTimeout: 0 })` then returns 200.
- So the Android-path fix still works after the bump.
- A first try with a 100 ms timeout and a 400 ms delay did not trip, on either version. That is undici's coarse timer resolution, not the bump.
- Under Bun the npm package is not loaded: Bun's stub is used and the dispatcher is ignored. That is ticket 26's concern and is unchanged here.

**Memory loop, Linux short profile** (`node tests/memory/job.mjs --only S1/short,S2/short`, systemd cap, Node 26.7.0, Bun 1.4.2, port 19120; run dirs `/home/AgentKit/overhaul-tools/t12-memloop/{before,after,paired}/`):

| run | tip 20.11.6 | branch 21.0.4 |
|---|---|---|
| S1/short | GREEN: procPeak 167.3 MB, steady 118.5 MB, growth 3.91 %/1k | GREEN: procPeak 164.9 MB, steady 123.1 MB, growth 3.03 %/1k |
| S2/short (listed RED → 58; ratchet holds on every run) | | |
| · solver:cost-per-generation | 1004.2, 1011.9, 1114.5, 1055.5 (median 1033.7) | 1111.1, 1132.5, 1018.8, 1070.3 (median 1090.7) |
| · procPeak:scenario | 1046.3, 1044.5, 1143.9, 1106.7 | 1136.1, 1160.4, 1044.0, 1113.9 |
| · solver:retained-before-recycle | 686, 686, 685, 686 | 689, 688, 689, 688 |
| · growth:scenario (%/1k) | −8.09 ok, 16.51 RED, 16.53 RED, −4.33 ok | 46.46 RED, 10.74 RED, −13.49 ok, −35.58 ok |
| · cdn-cache:memory-growth | 151 (run 1) | 149 (run 1) |

- The S2 runs alternated tip and branch. The tip arm ran in a clean detached worktree `/home/AgentKit/wt/t12-base` at `07b4ecd` with happy-dom 20.11.6.
- One sequence was cut short by the RAM sentinel at 15:47:24Z: available RAM fell to 12% from other load (`reports/ram.log`). The three missing runs were then re-run.
- **Did S2 move?** Slightly, within overlapping ranges:
  - cost per generation: median +57 MB (+5.5 %), but the ranges overlap (tip 1004–1115, branch 1019–1133);
  - retained-before-recycle: +2 to +3 MB on every run, consistently;
  - phases B–E: within ±5 MB;
  - the S2 fixture has no stylesheet or iframe, so the flags are not what moved it.
- Finding for ticket 58: `growth:scenario` (phase A, a sawtooth with a recycle at 200 solves) flips between ok and RED on both arms. It is not a stable check at one run.
- `expected-red.json` was not edited, and the ratchet held on every run.

**Criteria:**
- [x] criterion 1, the captcha suites on the happy-dom commit alone and the full `test:proxy` (see above);
- [x] criterion 2, `bun audit` (see above);
- [ ] criterion 3, both `memory-budget` legs: Linux S1/S2 locally as above. The ubuntu and windows CI legs are **pending CI (orchestrator verifies after merge+push)**;
- [x] criterion 4, the ADR-0007 test;
- common acceptance:
  - RED→GREEN shown;
  - no new test file;
  - no pre-existing test changed;
  - no new log events, config keys or env overrides.

**Decisions:**
- One commit for happy-dom (bump + flags + tests), so "green on the happy-dom commit alone" holds at `2c7bd87`. One commit for undici + yaml.
- No dependency-floor guard test was added. `bun audit` is the criterion's own check, and a test asserting the version strings would be tautological.

**Left for others:**
- the security doc wording on the unchanged loading surface → 53;
- undici under Bun → 26;
- S2 cost/retained → 58, plus the `growth:scenario` instability noted above.
