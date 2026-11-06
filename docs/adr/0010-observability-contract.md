---
status: accepted
---

# Observability contract: additive memory, restarts and admission fields, and one event-line format

`proxy status`, its `--json` and the `/health` details gain three additive objects: `memory` (per process: `role`, `pid`, `rssMB`, `footprintMB`, `capMB`, `enforcement`), `restarts` (`last15m`, `budget`) and `admission` (`inFlightBytes`, `queued`, `shedTotal`). Existing fields keep their names, types and meaning, and `schemaVersion` stays 1. `/health` stays behind bearer auth. The fields serve §9 UX (per-process RSS in the TUI) and make the caps of [ADR-0002](0002-captcha-solver-in-capped-child-process.md), the respawn budget of [ADR-0008](0008-proxy-health-supervisor-and-respawn-handoff.md) and the admission of [ADR-0004](0004-admission-shed-contract.md) visible. Field names are hard to change once released: the JSON is a documented superset.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q5 (REJECTED in part; the corrections below replace the rejected parts).

## Binding rules

1. **The enforcement enum is `job-object` | `cgroup` | `sampling` | `none`.** It follows [ADR-0002](0002-captcha-solver-in-capped-child-process.md) condition 8. The proposed `sampled` contradicted that decision and is not used. `none` is added for the thread fallback adapter and for caps that are switched off.
2. **`processes` counts only what the proxy owns,** for example `processes: { proxy: 1, solver: n }`. A count of every kit process of the installation (launchers, bridges, preflights) was rejected: it needs a process-table scan with command-line matching, which on Windows cannot read another process's environment. `/health` details stay synchronous and O(1), because hung-proxy detection depends on it. Every memory value comes from a cached sample.
3. **When `doctor` WARNs.** WARN appears above the soft limit, when enforcement is `none`, or when the platform supports a hard cap that was not applied (Linux without a delegated memory controller, a failed Job Object). On macOS `sampling` is the designed mode, so it is PASS with a detail note. A permanent WARN with no possible next command would break C3 and the meaning of WARN (Round 1, Q10).
4. **Event-line format, new lines only.** `ISO-time LEVEL component message key=value…` applies to new event lines: memory, recycle, shed, supervisor, lock takeover. Existing lines stay byte-identical, because the golden-path script greps them. The existing redaction applies to every line, and no line carries a secret.
5. **The solver entry carries its fail-fast state** and the time the window ends (Round 2, Q2).

## Considered options

- **An installation-wide `processes` count:** rejected, see rule 2.
- **WARN whenever enforcement is not a kernel cap:** rejected. It would WARN on every macOS `doctor` run with nothing the user can do.

## Consequences

- Strict JSON consumers see new keys and the new enum values; both are listed as additive in the release notes.
- The TUI process strip reads the same in-process snapshots that `/health` exposes (Round 2, Q9), so there are no new endpoints.

## Amended 2026-11-06 (Round 3, Q7)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 3, Q7 (REJECTED in part; check names fall under this ADR).

- **Four new `doctor` checks,** named in the existing style (lower-case phrases, no colons): `proxy memory`, `solver memory`, `memory cap enforcement`, `restart budget`. Their JSON names are additive. The off-TTY form is `WARN  <name> — <detail>`, covered by the grammar regex test of [ADR-0001](0001-terminal-design-language-ledger.md). Every WARN has what/why/next.
- **`proxy memory`** WARNs at or above the soft limit, naming the `config.yaml` key and `zcode-kit proxy restart`.
- **`solver memory` does not WARN at 80 % of the cap.** 80 % is the footprint recycle threshold, and a solver above it mid-solve is normal. It WARNs while the solver is in the fail-fast window, or when an abnormal exit (cap kill, crash, deadline kill) happened inside the 10-minute restart window. The next step names the cap's `config.yaml` key for cap kills, otherwise `zcode-kit proxy logs 50`. It is PASS with footprint/cap in the detail otherwise, and SKIP when no solver has run.
- **`memory cap enforcement`:** WARN for `sampling` on Linux (next: `systemctl --user status` and the README section); WARN for `sampling` on Windows, which means the Job Object failed (next: `zcode-kit proxy logs 50`); WARN for `none` (next: the config key that switches caps on); PASS for `job-object`, `cgroup` and macOS `sampling`; SKIP before the first solver spawn.
- **`restart budget`** WARNs when the 15-minute budget is exhausted, next `zcode-kit proxy logs 50`.
- **Values come from the cached `/health` details.** `doctor` triggers no new sampling work in the proxy.
