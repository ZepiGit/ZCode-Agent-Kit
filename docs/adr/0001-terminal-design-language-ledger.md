---
status: accepted
---

# Terminal design language: Ledger base, grep-stable off a TTY

Every kit command renders through one design language: variant A ("Ledger": aligned rows, verdict last) as the base, plus three parts of variant C: the help shape (examples first), a failure-first lead line in `doctor` when anything failed, and the proxy TUI sidebar at 100 columns or more. We chose it because it fixes every S1/S2 UX finding with the smallest blast radius and degrades best on pipes, CI, `TERM=dumb` and conhost. Variant B's boxed cards were not adopted for line-mode output. The design is specified in [`.scratch/kit-overhaul/ux/design-language.md`](../../.scratch/kit-overhaul/ux/design-language.md). Where the prototype renders differ from that spec, the spec wins.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q1 (the recommendation was REJECTED as worded and replaced by this decision with binding amendments).

## Binding rules

1. **Check rows off a TTY keep the legacy grammar.** On a pipe, in CI or under `TERM=dumb`, a check row is exactly `^(PASS|FAIL|SKIP)  <name> — <detail>$`, with today's check names. `WARN` is the only additive verdict word (Round 1, Q10). New display labels are allowed on a TTY only. JSON check names stay byte-stable. The A-ledger prototype's own off-TTY render (`  + ok    Bun runtime`: lower-case word, a different leading glyph, renamed checks, wrapped details) is **not** the target.
2. **Boxes only in the full-screen TUI.** Box chrome appears only in the TUI header card and the log-pane card. Line-mode output has no boxes, so copied values stay clean.
3. **The `doctor` lead line states the problem count only.** It must not repeat the check rows, so the "everything twice" defect (audit A-02) cannot return.
4. **TUI memory rows show the enforced solver cap** from [ADR-0002](0002-captcha-solver-in-capped-child-process.md), not the prototype's placeholder caps (768 MB / 1024 MB).

## Considered options

- **A alone:** smallest change, but leaves the help and long-report findings unfixed.
- **B (Cards):** boxed verdict and error cards break triple-click copying and degrade worst on conhost and pipes.
- **C (Outline):** verdict first and collapsed passing checks; its parts were taken where they fix a finding, not as a whole.

## Consequences

- Scripts that grep `^(PASS|FAIL|SKIP)` keep working. The release notes announce `WARN` as the one new word.
- Snapshot tests and docs pin this language as each command migrates. Before that it is reversible per command; afterwards it is expensive to change.
