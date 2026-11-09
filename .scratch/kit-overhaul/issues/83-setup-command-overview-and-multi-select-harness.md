# 83: Setup: curated post-install command overview and multi-select harness consent

**Blocked by:** 40 (UX batch (a)), 42 (Account Rotator decision asked once)

**Status:** ready-for-agent

Model: glm
Risk: medium
ADR: 0001, 0005

**Source:** user request during the active workflow (2026-11-09). Design language is ADR-0001/0005; C3 variants bind all output.

## What to build

Two additive setup-UX changes, tests/memory excluded, no product behaviour beyond `cli/setup-output.mjs`, `cli/harness-consent.mjs`, `cli/zcode-kit.mjs` and their tests:

1. **Multi-select harness consent (TTY).** Replace the sequential per-harness `[y/N]` prompt with one list: every detected harness renders as a row with a checkbox (`[x]`/`[ ]`), the user toggles with **Space**, confirms with **Enter**, `a` toggles all, `Esc`/empty confirm selects none (defaults preserved: previously-yes harnesses start checked, previously-skipped unchecked). Arrow keys move the cursor. Off a TTY, in CI, `TERM=dumb`, `NO_COLOR`, or when stdin is not interactive, behaviour is unchanged: the existing per-harness y/n prompt, `--harness <list>`, and `ZCODE_KIT_HARNESSES` still work exactly as today (C2, Round 1 Q1). Stored decisions under `harness-choices/` and their schema are unchanged. Unknown ids in `--harness` still throw. `--reask` still asks again.

2. **Curated post-install command overview.** After the setup report (after the connection card), print a short block `Next steps` with **5–8 commands** the user will actually use, each on one line with a one-phrase description, in English, through the output module: `zcode-kit doctor`, `zcode-kit proxy start`, `zcode-kit proxy status`, `zcode-kit proxy logs`, `zcode-kit auth status`, `zcode-kit integrate <harness>`, `zcode-kit run <harness>`, `zcode-kit --help`. Order by first-use likelihood. No command is invented; no command shown today is lost (the full help remains at `--help`). The block respects the design language (section header, aligned columns, colour roles, ASCII fallback). It appears on a TTY and off a TTY; the off-TTY render is line-based and grep-stable (no box chrome). `--json` output is unchanged (this is text-only presentation, not a new field).

## Acceptance criteria

- [ ] Multi-select: RED→GREEN at the prompter seam. Snapshot tests in every C3 variant cover: checked/unchecked rows, toggle with Space, confirm with Enter, `a` toggles all, Esc selects none, previously-stored yes starts checked, stored skipped starts unchecked, unknown harness in stored state is never silently accepted.
- [ ] Non-TTY: the y/n prompt, `--harness` and `ZCODE_KIT_HARNESSES` paths produce byte-identical output to today (preservation proof via deliberate mutation, per the brief's preservation rule).
- [ ] Off-TTY multi-select is never attempted: a CI/pipe/TERM=dumb fixture runs the old path and a test asserts it.
- [ ] Command overview: snapshot in every C3 variant; off-TTY render has no box chrome; `grep '^  zcode-kit '` finds every listed command; the `--json` document has no new field.
- [ ] `setup-regressions` and `cli-kit` suites pass unchanged; `install.log` still contains every line the verbose path ever printed (line-set comparison).
- [ ] Existing tests are unchanged or the change is justified in Comments.
- [ ] Windows: the multi-select reads arrows/Space through Node's readline on conhost and Windows Terminal; the PowerShell 5.1 stderr gate (ticket 44) is unaffected.
- [ ] Common acceptance as in every ticket file.

## Model cooperation protocol

Design is co-authored by **GLM-5.3-Flash max**, **gpt-6.1-sol xhigh**, **claude-sonnet-5-5 high** and **grok-4.7-build-fast xhigh** in cooperation. Each model produces a design brief (layout, key bindings, copy, degradation rules); the controller aggregates them; if one model is unavailable or its output is unusable, the remaining three continue and agree on the best result together. The agreed design is recorded in this ticket's Comments before implementation starts. Standard language for all user-facing copy is **English** (C8).

## Comments
