# 42: Account Rotator decision asked once, with migration

**Blocked by:** 08 (CLI command-module split, part 2 (migrate remaining commands + contract))

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0012

**What to build:** The decision is stored under `generated/` next to the harness choices and asked only when nothing is stored; `setup --reask` asks again; `--account-rotator` and `ZCODE_KIT_ACCOUNT_ROTATOR=y|n` still override. Migration: `auth.accounts.enabled: true` → "yes" without asking; `false` stays undecided and is asked once on the next TTY setup. `accounts enable|disable` update the stored decision. `update` never blocks without a usable TTY on stdin and stderr. Prompt copy `[y/N]` (A-22).

**Acceptance criteria:**

- [ ] `account-setup`/`transaction-audit` fixtures (seam 8): migration replayed twice; enabled → yes recorded silently; no TTY → no prompt and no hang (timeout-guarded test); `--reask` prompts; overrides win.
- [ ] Snapshots for the prompt in TTY variants.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 98, 99, 100, 101, 135

## Comments
