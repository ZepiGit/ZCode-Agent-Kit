---
status: accepted
---

# Stream contract: reports and data on stdout, diagnostics on stderr

Every command writes its report and its data to stdout, and every diagnostic to stderr. Today errors, progress and prompts go to stdout, and `zcode-kit run … | jq` even receives kit status lines in the harness's stdout (audit A-05, A-09). The move happens in one release, announced in the release notes, with no phased dual output. Exit codes and JSON documents are unchanged.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q9 (ACCEPTED with the clarifications below).

## The contract

- **stdout (reports and data):** `doctor` check rows and its verdict, `status` and `proxy status` text, the setup summary, the connection details, `proxy logs`, `models`, explicit `--help`, and all JSON.
- **stderr (diagnostics):** progress, spinners, warnings, error blocks, prompts, usage errors, and every kit line printed by `run`.
- Human reports are pinned to stdout explicitly. A reading that moves `doctor` output to stderr would break the check grammar that [ADR-0001](0001-terminal-design-language-ledger.md) protects.

## Verification gate (Windows)

On windows-latest, run the installer's setup call and the `zcode-kit.cmd` → `zcode-kit.ps1` shim under Windows PowerShell 5.1 with stderr redirected (`2>&1`, and `-File … 2> file`), and with `$ErrorActionPreference = "Stop"` as `install.ps1` sets it. Assert that the added stderr lines neither become a terminating NativeCommandError nor change the exit code. If they do, the PowerShell call sites are hardened in the same ticket.

## Consequences

- A two-way door technically, but script authors adapt to it, so reverting would break them a second time.
- The extra stderr traffic on PowerShell 5.1 is a primary-platform risk that the evidence has not covered; the gate above exists for it.
