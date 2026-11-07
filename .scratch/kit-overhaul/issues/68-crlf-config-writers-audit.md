# 68: Every writer of proxy/config.yaml and harness configs keeps the file's line endings (CRLF audit)

**Blocked by:** 42 (Account Rotator decision asked once, with migration)

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Ticket 42 round 3 found that `configureAccountRotator` rewrote a CRLF `proxy/config.yaml` with mixed line endings (10 CRLF, 56 bare LF on the example config) because it wrote back what the yaml library renders; fixed in 04dfbaa by writing the file back with its own line endings. Real Windows configs are CRLF (installers, editors, git autocrlf). Audit every other place the kit reads-modifies-writes a user-owned text file: the harness adapters (cli/adapters/*, including Continue/Kilo/OMP/pi/Codex/Claude configs), upstream-config, `bootstrap`'s copy of config.example.yaml, the transaction/rollback mechanism, update's config migration. For each: does a CRLF input come back CRLF (or the file's majority ending), byte-identical on a no-op replay, with no duplicated keys? Fix the writers that fail, sharing one helper with ticket 42's (do not add a second line-ending policy).

**Acceptance criteria:**

- [ ] A table of every writer with its verdict (ok / fixed), in Comments.
- [ ] One CRLF fixture test per fixed writer, RED first; a no-op replay on CRLF is byte-identical for every writer.
- [ ] One shared line-ending helper; mutation proof.
- [ ] Full suites green; windows test-kit legs green (pending CI).

## Comments
