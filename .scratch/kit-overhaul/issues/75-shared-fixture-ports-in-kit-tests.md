# 75: Kit tests share fixed fixture ports (18458 and others): parallel test files collide

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: low
ADR: no

**What to build:** Ticket 72's merge run (2026-11-08) failed once in `tests/json-superset.test.mjs` ("accounts health --json (down): exit 0, baseline 1"): the capture's "down" case found a listener on the shared fixture port 18458, because several test files use that port and `node --test` runs files in parallel. Ticket 15's `tests/proxy-lifecycle.test.mjs` had the same class of problem with 19150-19159 (fixed in ticket/15-fix-windows-teardown by binding port 0). Files that reference 18458 on the integration tip: tests/continue-compatibility.test.mjs tests/term-output.test.mjs tests/ux-before-capture.test.mjs tests/term-fixtures.mjs . Give every kit test that needs a port a free one (bind 127.0.0.1:0 and pass the chosen port into the fixture, or one per-file helper), keep every assertion (a "down" case must still prove nothing listens on the port it checks: choose a port that was just freed, or a port proven unbound), and add a guard test that fails if a test file hard-codes a port in the fixture range again. Snapshot/ux-before outputs that print the port must stay byte-identical (normalise the port in the capture if one is printed).

**Acceptance criteria:**

- [ ] No kit test hard-codes a listening port; a guard test pins it (with a mutation proof).
- [ ] `npm run test` passes 5 times in a row and with two copies running in parallel in separate worktrees; ux-before byte-identical.
- [ ] Full suites green; windows legs green (pending CI).

## Comments

### 2026-11-08 — implementer report (branch `ticket/75-free-fixture-ports`, code head 2aeed5d)

Commits: e835bc6 (guard + `tests/free-port.mjs`), 6572871 (fixtures on free ports), 4bed5f3 (merge of the integration tip 91fa58f), 2aeed5d (the guard also scans fixture code).

**What actually uses fixed ports (measured, not only grepped).** I ran a diagnostic preload, which is not committed. Loaded through `NODE_OPTIONS`, it logged every `listen` and `connect` of every Node process during `npm run test` on the tip. These ports were bound or probed:
- 18458 (json-superset capture), 18459/18460 (ux-before-capture);
- 18601-18605 (manager-safety), 18795-18805 (manager-audit, including the hung listener on 18799);
- 19083 (cli-commands), 19141 (event-line, manager start), 19421 (account-setup: 72 setup/doctor/manager probes), 19500 (adapter-audit setup), 19680 (crlf-writers setup), 19681 (crlf-writers: `doctor --fix` binds the config port exclusively while it aligns the key);
- 8457, the owner's production port: harness-consent (35 probes), setup-regressions (5), cli-audit (4). Their fixtures inherit the port from `proxy/config.example.yaml`, and setup-regressions ran setup against the checkout's own state. harness-consent's "proxy not verified running" assertion therefore depended on nothing listening on the owner's port.

After the fix, a traced run on 2aeed5d logged 592 listen/connect records. None was on a port below 20000, and none was on 8457. Every port was kernel-assigned.

**RED on the integration tip (9601392), two copies of `npm run test` in parallel (t75 + a detached worktree), 2 rounds:**
- 4 of 4 runs failed.
- json-superset failed in every run: "proxy status --json (running): $.pid: type null", "usage --json (running): exit 1, baseline 0".
- cli-commands "entry: run passes the preflight's refusal…" failed: `listen EADDRINUSE: address already in use 127.0.0.1:19083`.
- ux-before-capture CRLF test failed: `update-checkout/pipe.txt line 34` showed "running and verified" where the baseline has "proxy not verified running", because the other copy's fixture proxy was on 18460.
- manager-audit hung in 2 of 4 runs. The hung-listener child died with EADDRINUSE on 18799, and the test waited forever on its "up" line. I stopped those test processes after 1099 s and 439 s.
- Logs: `reports/t75-red-par-{A,B}{1,2}.log`.
- The new parallel-capture test was RED on the tip's capture: the "down" capture showed `health: ours` and exit 0 instead of `health: down` and exit 1 (`reports/t75-red-uxpar.log`).

**Fix**
- `tests/free-port.mjs` `freePort()`: binds 127.0.0.1:0, releases the port and returns it.
- Fixtures now take a free port, or listen on 0 and read the port: manager-safety, manager-audit, cli-commands, event-line, account-setup, adapter-audit, crlf-writers (`PORT`, `HEAL_PORT`).
- harness-consent and cli-audit write the fixture's `config.example.yaml` with a free port. harness-consent's two base-URL assertions now use that port instead of 8457.
- setup-regressions' `runSetup` uses its own `ZCODE_KIT_STATE_DIR`, created first with this checkout's `.owner.json`, a synthetic key and a config on a free port. It no longer uses the checkout's state (B2/B3). Its update test's template gets a free port too.
- manager-audit's hung listener now rejects with the child's error when it cannot bind, instead of waiting forever.
- **Capture (snapshot decision): normalisation in the capture, not injection.** Without `UX_CAPTURE_PORT`, every scenario, and every live-TUI variant, takes a fresh kernel port (`nextPort()`). `normalise()` writes it back as 18458, as it already did for a pinned non-default port. `UX_CAPTURE_PORT` still pins one port for a whole run. `portBusy()` still runs before every scenario, so a "down" scenario checks a port that was just free.
- The write-back only touches the port because kernel ports are taken from `KERNEL_PORT_FLOOR = 20000` up. A new test pins that no committed capture (linux, windows) holds a word-bounded number ≥ 20000. That is the same `\b<port>\b` rule `normalise()` applies. The digit runs inside hashes are not word-bounded and do not count.
- json-superset and ux-before-capture strip `UX_CAPTURE_PORT` and no longer use the +1/+2 offsets. A new test runs two captures at once, one with the fixture proxy running and one down, and compares both with the BEFORE baseline.
- Snapshot diff: none. `tests/snapshots`, `tests/ux-before/{linux,windows,json-extra}` and `json-baseline.json` are unchanged.

**Guard** (`scripts/fixture-ports.mjs`, tests in `tests/test-wiring.test.mjs`, seam 9). It scans every source file under `tests/`.
- **Binds:** every listen on a literal port fails, with no exception: `.listen(N`, `.listen(${N}`, `listen({ port: N })`, `Bun.serve({ port: N })`, and `.listen(NAME` for a literal-initialised constant, including `env.X || N`.
- **Ports:** a literal in a port position (`port: N`, `PORT = N`, `port: () => N`, `["Port", "N"]`, `127.0.0.1:N`, `localhost:N`), and any literal in 18000-19999, is allowed only where `RECORDED_PORTS` lists it for that file with a reason. Entries no file needs any more are reported stale. 8457 may appear as data.
- **Not scanned:** the four manual live tools (`MANUAL_TOOLS`, which a test proves no test or package script runs), the data trees, and the guard's own vectors.
- **Scanner bug found and fixed while building it:** the first comment stripper treated the `/*` in a `// tests/*.test.mjs` comment as a block comment, which hid code up to the next `*/`. It is now one left-to-right pass that keeps strings, with vectors for that case.

**Mutation proofs** (implementation committed at 6572871, each mutant restored with `git checkout 6572871 -- <file>`, `git status` clean afterwards):
- The repository guard test fails on each of these mutants:
  - `server.listen(19083, …)` in cli-commands ("tests/cli-commands.test.mjs:810: listens on literal port 19083");
  - `const FIXTURE_PORT = 19421` in account-setup ("tests/account-setup.test.mjs:118: literal port 19421");
  - `fixture(t, 18795)` in manager-audit;
  - `let portCounter = 18600` in manager-safety;
  - a pinned 18458 `UX_CAPTURE_PORT` in json-superset;
  - `.listen(${18799}` in the hung-listener template;
  - a `RECORDED_PORTS` entry removed (state-audit 18757);
  - a stale entry added ("tests/state-audit.test.mjs: 18758");
  - an entry moved to another file.
- Restoring the old two-pass comment stripper fails the bind-forms test: the binds after the `/*` comment are missed.
- `KERNEL_PORT_FLOOR = 1024` fails the write-back pin.
- In capture.mjs, removing the port write-back fails the parallel-capture test (`"port": 18458` became `40101`). Forcing one shared port fails it too (`health: down` became `ours`).

**Evidence on 2aeed5d (Linux, Node 26.7.0, Bun 1.4.2)**
- `npm run test` 5 times in a row: 901 tests, 883 pass, 0 fail, 18 skipped, every run (`reports/t75-serial-{1..5}.log`). The tip had 886 tests before the merge; this branch adds 7: 5 guard tests, the parallel-capture test and the write-back pin. The merge brought in ticket 77's tests.
- Two copies of `npm run test` in parallel (t75 + a detached worktree at 2aeed5d), 3 rounds: 6 of 6 runs green, 883 pass, 0 fail (`reports/t75-par-{A,B}{1,2,3}.log`).
- ux-before: `npm run test:ux-before` on 6572871 passed. All 640 captures are byte-identical to `tests/ux-before/linux` in all 7 variants, 0 capture errors, 461 s (`reports/t75-uxbefore.log`). The capture used per-scenario kernel ports. The merge after it brought in only lib/proxy-lifecycle.mjs, a proxy-lifecycle test and a fixture; the capture runs on fixture kits that do not use them. The parallel-capture test (proxy-status running/down, pipe and ci) is byte-identical on 2aeed5d in every run above.
- `npm run test:proxy`: 1596 pass, 0 fail, 107 files. `npm run test:mcp`: 100 tests, 99 pass, 0 fail, 1 skipped; `dist/` unchanged after the build (git clean).
- Memory-loop scenarios: none run. This ticket touches no memory-loop code; the guard only scans it.
- Windows legs: pending CI (orchestrator verifies after merge and push). Windows-relevant points: `freePort()` on Windows; the template rewrite `/^  port: \d+/m` without `$`, so it works on a CRLF checkout; the lower-cased `.owner.json` identity as `lib/state.mjs` computes it. The parallel-capture test is POSIX-only, like the other end-to-end capture tests.

**Decisions taken**
- **Port choice:** a kernel-assigned port, released before use, rather than a random port in a reserved range. Linux hands bind(0) odd ports and connect() even ports, so another run can only collide by binding exactly this port in the short gap.
  - Where one port is threaded through many helpers, it is taken once per file with a top-level `await freePort()`: account-setup, adapter-audit, crlf-writers, harness-consent, cli-audit.
  - Elsewhere it is taken once per test.
- **Literals left as data:** literal ports that nothing binds or connects to stay unchanged, listed in `RECORDED_PORTS` with a reason each. The traced run confirms none of them is bound or probed. Examples: term fixtures (byte-pinned snapshots), continue-compatibility, connection-details, cli-commands' fake-fetch records.
- **Memory loop:** its own default port, 18457 (`proxy-session.mjs`, `isolated-kit.mjs`), is a recorded exception. It is not part of `npm run test`, it runs alone in the memory-budget job, and `ZCODE_MEMLOOP_PORT` overrides it.
- **Left as is:** setup-regressions still calls `ensureRuntimeFiles(createCtx(KIT))` at import (unchanged, other files may rely on it), but no test in it uses the checkout's state any more.

**Left for another ticket**
- The memory loop's default port 18457: two local memory-loop runs without `ZCODE_MEMLOOP_PORT` would collide.
- The guard is static. A fixture that inherits 8457 from the template without any literal (the case fixed here in harness-consent, cli-audit and setup-regressions) is invisible to it. The committed tests keep that case fixed, and the traced run above is the evidence. A permanent runtime trap (a `--import` preload in `npm run test` that refuses listen/connect on fixed ports) would close the gap, but it changes the test command for every leg.
