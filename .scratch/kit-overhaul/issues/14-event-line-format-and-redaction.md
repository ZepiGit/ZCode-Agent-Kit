# 14: Event-line format and redaction for new log events (prefactor)

**Blocked by:** None (can start immediately)

**Status:** resolved

Model: glm

Risk: low

ADR: 0010

**What to build:** One small logger for new event lines, `ISO-time LEVEL component message key=value…`, in the proxy (TS) and the manager (mjs), with redaction applied to all lines. Existing lines stay byte-identical. Every later ticket's new events (memory, recycle, shed, supervisor, lock takeover, rotation WARN, respawn ERROR) use it.

**Acceptance criteria:**

- [ ] Unit tests: format, key escaping, redaction of keys/tokens (incl. a stop-token-shaped value) in old and new lines.
- [ ] Golden-path classifier and existing log-reading tests unchanged.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 88

## Comments

### 2026-11-06 — implementer (substitute for glm-5.3-flash)

**Branch:** `ticket/14-event-line-format` (worktree `/home/AgentKit/wt/t14`). Implementation commit `ad98a80`, integration tip `e96c86f` merged in (`d5b7d78`); the head SHA is the commit that adds this comment.

**What landed**
- `zcode-proxy-src/src/log/event-line.mjs` + `.d.mts`: one runtime-neutral module (plain ESM, no imports, ADR-0011 cond 1). `formatEventLine({ time, level, component, message, fields, secrets })` → `ISO-time LEVEL component message key=value…`; `redactLine(text, secrets)` for lines of any format; `createEventLogger({ component, write, now, secrets })` → `debug|info|warn|error(message, fields)`, never throws into the caller, default sink `console.log`.
- `lib/event-line.mjs`: a byte-identical copy that the manager imports (see decision 1). A test fails when the two copies differ.
- Manager (`proxy/zcode-proxy-manager.mjs`): `logEvent(level, message, fields)` on the `createManager` result writes new events as event lines (component `manager`) to the console and `proxy.log`. Existing `logLine` keeps the `[manager <ISO>] …` text and redacts it (proxy key from `.proxykey`, the stop token in `ZCODE_KIT_STOP_TOKEN`, token shapes). `proxy logs N` shows the tail redacted, which covers the lines the proxy writes until ticket 33's writer exists.
- Format rules: level ∈ `DEBUG|INFO|WARN|ERROR` (anything else throws); component and keys escaped to `[A-Za-z0-9_.-]` (other chars → `_`, empty → `_`); values bare unless empty or containing whitespace, `"`, `=` or control characters, then double-quoted with `\` `"` escaped and CR/LF/TAB/C0/U+2028/U+2029 escaped; control characters in the message are escaped as well, so one event is always one line; `undefined` fields are left out, `null` → `null`, objects → JSON, `Error` → its message.
- Redaction rules: exact known secrets (length ≥ 8) and `ZCODE_KIT_STOP_TOKEN`; `Bearer|Basic <token>` → `Bearer <redacted>`; JWTs; `sk-…`; opaque runs of 32+ `[A-Za-z0-9_-]` chars that look random (a lower-case letter plus a digit or an upper-case letter, ≤ 4 hyphens, not a UUID), which covers the 43-char base64url proxy key and stop token and 64-hex OAuth states. Event-line fields whose name has a secret segment (`token`, `secret`, `password`, `authorization`, `cookie`, `credential(s)`, `signature`, `apikey`, `bearer`, or the pairs `api key`/`proxy key`/`private key`/`access key`/`session key`, split on camelCase and `-_.`) are always `<redacted>`; `inputTokens` and `key` are not secret names.

**Tests (seam 6, the shared module under Bun and Node; seam 2, `createManager`)**
- `zcode-proxy-src/src/log/event-line.test.ts` (bun, picked up by `bun test`): 15 tests. Format; quoting/escaping; key escaping (a key cannot forge a pair or a line break); line breaks in message/component cannot forge a second line; null/object/Error/undefined; level validation; redaction of bearer/JWT/sk-/opaque/stop-token-shaped values in old-format lines (`[zcode-proxy] …`, `[manager <ISO>] …`); exact known secrets and the env stop token; 11 secret-free existing lines byte-identical (real `proxy.log` lines from the memory loop, the handler's debug header line with its existing `<redacted>`/preview masking, Windows paths, module-not-found text, upper-case env names with digits, a UUID, a too-short known secret); idempotence; secret-named fields; secrets in message and values; the logger sink and a throwing sink.
- `tests/event-line.test.mjs` (node, wired into `npm run test` after `tests/transaction-audit.test.mjs`): 5 tests. Byte-identical copies; the same lines under Node; `logEvent` writes one event line to `proxy.log` and the console, with the proxy key masked; an existing `[manager <ISO>] ERROR: cannot start the proxy — …` line (start with a `bunResolver` whose error carries the proxy key as a bearer token and a stop-token-shaped value) keeps its text, with both values masked in `proxy.log` and on the console; `proxy logs N` masks the key and a stop-token-shaped value in proxy-written lines and leaves the other lines byte-identical.
- Ports used: 19140–19143 (only for config; nothing listens).

**RED → GREEN** (logs in the integration worktree's `reports/`)
- `t14-red1` (module missing, 0 pass 1 fail) → `t14-green1` 1 pass.
- `t14-red2` (escaping, 1 pass 5 fail) → `t14-green2` 6 pass.
- `t14-red3` (`redactLine` missing, load error) → `t14-green3` 13 pass.
- `t14-red4` (`createEventLogger` missing) → `t14-green4` 15 pass.
- `t14-red5` (`m.logEvent is not a function`; existing manager line and `proxy logs` still showed the secrets) → `t14-green5` 4/4.
- `t14-red6` (copy guard: copies differed after a header edit, 4 pass 1 fail) → `t14-green6` 5/5.

**Full suites after merging the integration tip `e96c86f`** (Bun 1.4.2; ticket 11 not merged yet)
- `npm run test` (`t14-full-kit`): 303 tests, 292 pass, 0 fail, 11 skipped (the Windows-only/opt-in skips of the baseline).
- `npm run test:proxy` (`t14-full-proxy`): 1303 pass, 0 fail, 89 files (baseline 1288/88 + these 15/1).
- `npm run test:mcp` (`t14-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged after the build.
- `node scripts/verify-golden-path.mjs` mock mode, `GOLDEN_PORT=19143` (`t14-golden`): PASS for both models. The classifier and `tests/golden-path.test.mjs` are unchanged and green.
- `bun build --target bun` of the module (`t14-bundle`): bundles, 4.0 KB.
- No pre-existing test file changed (`git diff overhaul/stability-terminal-ux HEAD --stat`: only new files, `package.json` wiring and the manager).
- Metrics delta: none. The memory loop does not exercise or measure this module (DECISIONS round 5 item 4); no expected-RED entry belongs to this ticket.

**Decisions taken (spec/ADRs silent)**
1. **Two byte-identical copies instead of one cross-package import.** The proxy must build from `zcode-proxy-src/` alone (its Dockerfile copies only `src/`), so its copy lives in `zcode-proxy-src/src/log/`. The manager could import that file, but the kit's test fixtures and the golden-path script copy only `cli/`, `lib/` and the manager into a mini-kit; importing from `zcode-proxy-src/src/` broke 6 existing tests (3 in `auto-heal`, 1 in `cli-audit`, 2 in `harness-consent`; probe log `t14-kit-probe`: "Cannot find module …/zcode-proxy-src/src/log/event-line.mjs"). Changing those fixtures would change pre-existing tests, so the manager imports `lib/event-line.mjs`, and `tests/event-line.test.mjs` fails on any byte difference. Edit one copy, copy it over the other. The ADR-0011 tickets (`lib/term/` on `tui/tokens.mjs`) will meet the same fixture issue.
2. **Redaction is masking by value shape plus exact known secrets, not by `key=value` names in free text.** A generic `x-api-key=…` rule would rewrite the handler's existing debug preview (`abcdef...wxyz`) and so change secret-free existing lines. Names are matched only for event-line fields.
3. **Where "applied to all lines" is enforced in this ticket:** every event line (proxy and manager), every existing manager line on write, and the whole tail shown by `proxy logs`. The proxy's own existing stdout/stderr lines are not rewritten on write yet. The proxy has no log writer until ticket 33, and patching `console`/`process.stdout` now would touch the TUI's stdout routing. **For 33:** pass every line through `redactLine(line, [proxyKey])` in the size-capped writer.
4. **The stop token shape is assumed to be 32 random bytes as base64url (43 chars), like the proxy key (`cli/context.mjs`).** **For 18:** generate it that way. The opaque rule catches it in any case where it looks random, and `ZCODE_KIT_STOP_TOKEN` is always masked exactly. If 18 writes the token into `proxy.pid`, add it to the manager's `knownSecrets()`.
5. `pack/verify-payload.mjs` REQUIRED_FILES not extended. `lib/` and `zcode-proxy-src/src/` are already in the pack allowlist, and adding required entries would break the `release-audit` payload fixture (a pre-existing test). This can be folded into the ADR-0011 `verify-payload` change.

**Common acceptance**
- RED → GREEN at seams 6 and 2: ✓ (above).
- Fast suite green locally on ubuntu: ✓. The windows-latest leg and the `memory-budget` job: pending CI (orchestrator verifies after merge+push).
- New test files wired: ✓ (`tests/event-line.test.mjs` in `npm run test`; the bun test is auto-discovered by `bun test`); `tests/test-wiring.test.mjs` from ticket 04 passes.
- No pre-existing test changes: ✓.
- No new config key or `ZCODE_PROXY_*` env override: n/a.

**For later tickets:** proxy code uses `import { createEventLogger } from "<rel>/log/event-line.mjs"` with a component name (`memory`, `recycle`, `shed`, `supervisor`, `solver`, `log`). Manager code uses `logEvent("WARN", "lock takeover", { … })`.

- Merged 2026-11-06 as b3b8ece; fast suite: kit 295/306 (0 fail, 11 skipped), proxy 1303/1303, mcp 95/96 (0 fail, 1 skipped). `dist/` unchanged. Logs: reports/merge-14-{npmci,test,proxy,mcp}.log.
