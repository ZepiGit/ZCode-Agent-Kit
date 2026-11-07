# Owner Proxy round 14 — triage of tickets 67 and 69

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-14-answers.md` (write nothing inside the integration worktree).

For each ticket decide its triage role (`ready-for-agent` with criteria, label and edges; `needs-info` with the exact missing fact; or `wontfix` with the reason), per `docs/agents/triage-labels.md`. Read each ticket file whole and `issues/INDEX.md`; check the graph stays acyclic.

## Q1 — Ticket 67: a plain expected-RED listing of a single-run key accepts any RED

Facts: Round 9 condition 1 made a listed repeated key accept only a RED median (any other RED fails). For single-run keys listed plainly (linux `S5/short → 30`, `S3/short → 37`, `S3/hung → 16`, `S4/short → 17`, `S7/short → 34`, `S2/short → 58`, `S3/omp → 35`, `S1/burst4|16|32|bigbody → 19` (single-run variants), windows equivalents), `tests/memory/lib/ratchet.mjs` accepts the run whenever its outcome is RED, whatever checks are RED. A new RED on a check the owner does not own (an orphan, a second proxy, a ceiling) passes silently. The RED check sets of several entries vary run to run (e.g. S3/short's procPeak checks come and go; S2's growth:scenario flips, ticket 58 note; S3/hung's set differs per leg).

Recommendation: `ready-for-agent`, sol, medium. Each plain entry names the checks it owns (`{ "ticket": "37", "owns": ["peak:kit", "failed-launches", ...] }`), derived from the last N CI runs per leg (the union of the RED checks seen on unchanged code, recorded with the run ids); a RED on any unowned check fails the ratchet; an owned check going GREEN is allowed (the entry is deleted only when the run is GREEN, as today). Owner tickets that delete their entry are unaffected. Blocked by none; 55 gains an edge on it (the empty-list guard should land on the stricter schema).

## Q2 — Ticket 69: `ensureDeviceMidInConfig` reads past an empty unquoted `deviceMid:`

Facts: found by ticket 68's audit. For an empty unquoted `deviceMid:` line, the reader takes the next line's text (e.g. `appVersion: "3.8.1`) as the device ID it then sends upstream. The kit template writes `deviceMid: ""` (not affected); hand-edited or third-party-written configs can be. The code sits in identity handling (B1: do not change how anti-abuse code behaves; IN SCOPE: error handling, observability, UX of output, tests). B2: tests use fixtures only.

Recommendation: `ready-for-agent`, sol, high, as error handling inside B1's IN-SCOPE list: an empty unquoted value is read as empty, exactly as the empty quoted form already is, so the existing empty-value path (whatever it does today for `deviceMid: ""`) runs; nothing else in identity handling changes (no new ID source, no format change, no different upstream request for any well-formed config). Tests: quoted, unquoted, empty-quoted, empty-unquoted, missing key, CRLF variants; a test that a well-formed config produces byte-identical identity output before and after. Blocked by 68 (same function's writer was just fixed there).
