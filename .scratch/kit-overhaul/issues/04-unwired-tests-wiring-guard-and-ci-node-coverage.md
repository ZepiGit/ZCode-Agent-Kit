# 04: Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage

**Blocked by:** None (can start immediately)

**Status:** resolved

Model: glm

Risk: low

ADR: —

**What to build:** The METRICS baseline findings become fixed: `tests/update.test.mjs` and `tests/upstream-config.test.mjs` run in `npm run test`; a guard test fails when any kit `tests/*.test.mjs` file is referenced by no test script; `test-kit` runs {ubuntu-latest, windows-latest} × {Node 24, 26} instead of Node 20 (Round 1 Q14/Q19).

**Acceptance criteria:**

- [ ] `npm run test` count rises by the 16 previously unwired tests, all passing.
- [ ] The guard test goes RED when a scratch unwired test file is added in a fixture repo and GREEN on the real repo (seam 9).
- [ ] CI shows four `test-kit` legs green with the kit, proxy and MCP suites (the proxy typecheck joins in 11).
- [ ] METRICS.md "pre-existing findings" marked resolved with the CI run link.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 139, 140

## Comments

### 2026-11-06 — implementer report (claude-opus-5-5, logged substitute for glm-5.3-flash)

**Branch:** `ticket/04-test-wiring-guard-ci-node`. Code head before this comment: `1a03358` (the integration tip `3623e87` was already merged in, so there were no conflicts). Bun 1.4.2, because ticket 11 has not merged.

**Changes**
- `package.json` `test` script: adds `tests/update.test.mjs`, `tests/upstream-config.test.mjs` and the new `tests/test-wiring.test.mjs`.
- `scripts/test-wiring.mjs`: `checkTestWiring(root)` returns `{ testFiles, unwired }`. It is not in the pack allowlist, so it does not ship.
- `tests/test-wiring.test.mjs` (seam 9) has four tests:
  - A scratch unwired file in a fixture repo is reported.
  - Only a whole-argument reference in a `test`/`test:*` script wires a file. A `.bak` suffix, a `pre-` prefix or a non-test script does not count. `./`, quotes and `\` do.
  - A package with no scripts leaves every file unwired.
  - The real repo has nothing unwired. The guard must also see its own file, so it cannot pass vacuously.
- `.github/workflows/ci.yml` `test-kit`: matrix `node: [24, 26]` × `os: [ubuntu-latest, windows-latest]`, with `node-version: ${{ matrix.node }}`.

**RED → GREEN (logs in `reports/t04-*.log`)**
- Slice 1, fixture repo: RED `ERR_MODULE_NOT_FOUND` (`t04-slice1-red`), then GREEN 1/1 (`t04-slice1-green`).
- Slice 2, real repo, on the integration tip's wiring: RED with `wire these into a test script in package.json: tests/test-wiring.test.mjs, tests/update.test.mjs, tests/upstream-config.test.mjs` (`t04-slice2-red`). After wiring: GREEN, `npm run test` 296/285 pass/0 fail/11 skip (`t04-slice2-green`).
- Slice 3, adversarial tests: GREEN on the first run (`t04-slice3`). The tokenizer from slice 1 already covered them. Mutation check: with naive substring matching the whole-argument test went RED, 3/4 (`t04-slice3-mutant`). The original was then restored.

**Full suite after merging the tip** (`t04-full-*`):
- `npm run test`: 298 tests, 287 pass, 0 fail, 11 skipped. The baseline was 278/267/0/11: +16 previously unwired, +4 guard tests.
- `npm run test:proxy`: 1288 pass, 0 fail, 88 files. Unchanged.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped. Unchanged. `dist/` is byte-identical after the build.
- `npm run test` on Node 24.22.2 (local stand-in for the ubuntu/Node 24 leg): 298/287/0/11 (`t04-kit-node24`).

**Decisions**
- Wiring means the exact `tests/<name>` token. Globs and directories are not expanded, which keeps the guard simple (C9). If a future script switches to a glob, its files are reported unwired: a loud false RED, never a silent pass. Only top-level `tests/*.test.mjs` files are guarded, per Q19. `tests/memory/` is outside the guard.
- No CI-layout assertion test here. Ticket 09 owns the release-audit pin test (no `node-version: 20`).
- `release.yml` still pins Node 20 in its test job and its `node-version: 20` step. Ticket 09 owns that change ("release.yml changes only in versions and runs on Node 26"). The publish job's Node 24 is untouched.
- Actions stay at `@v4` (ticket 09). `engines.node` stays `>=20` (ticket 10).
- No pre-existing test was changed. `expected-red.json` does not exist on the tip, so no entry to remove. There is no memory-loop scenario or metrics delta, because this ticket does not touch runtime code.

**Left open (not possible from this run)**
- AC 3 (four green `test-kit` legs in CI) and the CI run link for AC 4: the brief forbids pushing. Whoever pushes adds the first green 4-leg run link to METRICS.md ("pre-existing findings"), which is otherwise already marked resolved. The windows legs are unverified locally.
- The proxy typecheck joins `test-kit` in ticket 11.

Merged 2026-11-06 as 8f59b2d; fast suite: kit 287/298 (0 fail, 11 skipped), proxy 1288/1288, mcp 95/96 (0 fail, 1 skipped). `dist/` unchanged. Logs: reports/merge-04-{npm-ci,test,proxy,mcp}.log. CI legs (AC 3/4) pending CI after push.
