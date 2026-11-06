# Spec: kit overhaul — stability, terminal UX, currency

Status: ready-for-agent

Feature: `kit-overhaul`. Integration branch: `overhaul/stability-terminal-ux`.
Source of every decision below: `DECISIONS.md` (Owner Proxy Rounds 1–4, Charter v1; the Round 4 corrections are listed at the end of Further Notes), `GLOSSARY.md` and `docs/adr/`. Where a round question and its decision differ, the decision (with its conditions, and with the replacements for REJECTED parts) is what this spec states.

## Problem Statement

People who run the ZCode Agent Kit on their own machines have watched it eat their RAM until the PC or their harness sessions went down. One incident reached 11 GB. The measurements show why, and the causes are structural, not one bug:

- The captcha solver runs as a thread inside the proxy. It keeps every closed happy-dom window alive until it is recycled, reaching about 1 GB per solver generation with the offline fixture. The real vendor SDK is heavier, and nothing the OS can enforce stops it.
- Request bodies in flight have no limit. 32 large requests at once push the proxy to 1.6 GB.
- Every harness session costs about 160 MB of Node processes outside the proxy (launcher, MCP bridge, preflight). Ten parallel sessions cost 852 MB before any work is done.
- A start that is killed or interrupted with Ctrl-C leaves a stale start lock. After that, most launches fail, `proxy stop` and `proxy restart` refuse, and a respawn ends with no proxy at all.
- The memory guard reacts only at 1.5 GB and 3 GB of RSS. On Windows, the primary platform, RSS is the working set and not the commit charge that actually runs out.
- Several stores grow without limit: the CDN cache, MCP task history, the TUI log pane by bytes, and `proxy.log` while the proxy runs.

The terminal output also works against the user. There are five status vocabularies. `doctor` prints every manager check twice. The installer tells the user to log in and hides the command that does it. Every `setup` and `update` asks the Account Rotator question again, and an unattended update can hang on it forever. Errors go to stdout, mostly without a next step. `zcode-kit run … | jq` receives kit status lines in the harness's stdout. The proxy TUI shows state by colour alone, ignores NO_COLOR and TERM=dumb, and draws glyphs that Windows 10 conhost cannot render.

The kit is also out of date. CI runs on Node 20, which is end-of-life. The Bun pin is two patch releases behind. happy-dom, undici, yaml and the MCP SDK have known advisories. Two harness adapters write configs the harness rejects or misroutes.

Whatever the overhaul changes, users and scripts must not notice a regression. Commands, flags, env vars, exit codes, JSON fields, config, stored state, consent decisions and the account store must keep working.

## Solution

From the user's point of view, after this change:

- **The kit stays inside a fixed memory budget.** Solves run in a separate solver process under an OS-enforced solver cap (300 MB): a Job Object on Windows, a verified cgroup scope on Linux, sampling where no kernel cap exists. The solver process is recycled well before the cap, dies with the proxy, and only one exists at a time. Admission caps in-flight bytes at 64 MB. A request that cannot be admitted in time is shed with 503 + `Retry-After` in the endpoint's own error shape, never with 429 and never with a connection reset. The health supervisor watches the proxy's own memory footprint against 512/1024 MB. Ten parallel harness sessions fit in ≤ 596 MB of summed RSS on Linux on Node ≥ 26.1 (launcher handover; not claimed on Node 24; macOS unverified, owner action) and ≤ 600 MB of commit on Windows.
- **There is always exactly one proxy, never zero.** A stale start lock is taken over only on proof, so a killed start no longer blocks every later launch. An orphaned proxy is adopted, not duplicated. A respawn drains only after the manager has acknowledged that its restart budget is reserved, so a refused respawn leaves the proxy serving. `proxy stop` and `restart` run a real graceful stop on Windows too, through an authenticated loopback stop request.
- **Every growing store has a bound** and a test that proves it: CDN cache in memory and on disk, stall counters, MCP task registry and files, per-task arrays and text, the TUI log pane, and `proxy.log` (rotated by the proxy while it runs, with early output kept in a small capped file).
- **Users can see the memory state.** `proxy status`, its `--json`, `/health` details, `doctor` (four new checks) and the proxy TUI show per-process RSS and memory footprint, the solver cap, the enforcement mode, the restart budget and admission counters. Every WARN comes with an exact next command.
- **Every command speaks one design language** (Ledger, ADR-0001). Aligned rows end with the verdict, and line mode has no boxes. Glyph tiers degrade to ASCII, and nothing is carried by colour alone. Every error says what happened, why, and the exact next command. Reports go to stdout and diagnostics to stderr. Off a TTY, `doctor` keeps the legacy check grammar for scripts, and `WARN` is its only new word. The Account Rotator question is asked once. Setup output is a compact report by default. Help is grouped, with examples, and every command has its own `--help`. The proxy TUI shows health, per-process RSS, a filterable log pane and key hints.
- **The kit is current.** The support floor is Node 24 (CI runs 24 and 26), Bun is pinned to 1.4.4 everywhere, and happy-dom 21, undici 8.12, yaml 2.9, MCP SDK 1.32, zod 4.6.6, TypeScript 7 and the v7 GitHub Actions are in. The harness adapters write configs that the current harness versions accept.
- **Nothing breaks silently.** Every behaviour change is additive or announced in the release notes. Every migration is automatic, idempotent and transactional. CI on ubuntu and windows enforces the memory budgets and the output snapshots.

## User Stories

### Stability: memory

1. As a kit user, I want the captcha solver to run in its own OS process with a hard memory cap, so that a heavy solve can never take my PC's RAM down with it.
2. As a Windows user, I want the solver cap enforced by a Job Object on commit charge, so that the limit the OS applies matches the memory that actually runs out on Windows.
3. As a Linux user, I want the solver cap enforced by a cgroup scope only when the kit has verified that the limit took effect, so that the kit never claims a cap that is not there.
4. As a macOS user, I want the solver cap enforced by sampling and kill, and reported as the designed mode, so that I am protected as far as my OS allows and am not nagged about it.
5. As a kit user, I want the solver process to load nothing heavy until the cap is confirmed, so that there is no window in which an uncapped solve can run.
6. As a kit user, I want the solver process recycled at 80 % of its cap (240 MB at the default) and after at most 100 solves, so that the OS kill is a backstop and not the normal path.
7. As a kit user, I want only one solver generation to exist at a time, including during a recycle, so that the old and new solver never double the memory peak.
8. As a kit user, I want the solver process to die when the proxy dies, even on a SIGKILL, so that no orphaned solver keeps holding memory.
9. As a kit user, I want the solver spawned only on the first solve and ended after 10 minutes idle, so that sessions that never solve pay nothing for it.
10. As a kit user, I want an idle solver exit to release its cap container, so that nothing is left behind after it ends.
11. As a kit user, I want a crash or a cap kill of the solver to fail only the solve in flight, through the existing error path, so that queued solves and all requests that need no solve keep working.
12. As a kit user, I want solver restarts after abnormal exits limited to 5 per 10 minutes before solves fail fast, so that a broken solver cannot turn into a restart storm.
13. As a kit user, I want planned recycles (count, footprint, idle, request, shutdown) not to count against that limit, so that normal operation never trips fail-fast.
14. As a harness, I want a solve request during the solver's fail-fast window shed with 503 and a `Retry-After` equal to the time until the window reopens, so that I can retry at the right moment.
15. As a kit user, I want the solver cap configurable in `config.yaml` and validated against a documented minimum, so that I can raise it if a real solve needs more, and a bad value is rejected with what/why/next.
16. As a kit user, I want a cap kill logged together with the config key that raises the cap, so that I know exactly what to change.
17. As a kit user, I want solves to keep the same inputs, outputs, environment and 90 s deadline as today, so that moving the solver out of process changes nothing about how challenges are solved.
18. As a user who runs the proxy from source with my own Bun, I want the solver process started from that same Bun, so that the solver matches what I actually run.
19. As a user of a compiled proxy binary, I want the solver process started through a self-exec subcommand, so that compiled builds work without `-e`.
20. As a kit user, I want the solver's cold start (spawn, cap handshake, module load) measured and kept within 5 % of the solve deadline, so that isolation does not make solves time out.
21. As a harness sending large requests, I want the proxy to cap in-flight bytes at 64 MB and hold extra requests in a bounded first-in, first-out queue without reading their bodies, so that a burst cannot balloon proxy memory.
22. As a harness, I want a request that waited past the admission queue's bounds (count or 15 s) shed with HTTP 503 and `Retry-After` in my endpoint's error shape, never 429, so that I retry instead of treating it as quota exhaustion.
23. As a user running many parallel sessions, I want open response streams never limited by default, so that the 17th session is not made to wait while long answers stream.
24. As an operator, I want the byte cap configurable through `config.yaml` and an allowlisted env override, so that I can tune it for my machine.
25. As a kit user, I want the redundant copies of each request body reduced without changing the bytes sent upstream, so that each MB in flight costs less RSS.
26. As a kit user, I want the proxy's health supervisor to sample memory footprint (commit charge on Windows) against a soft limit of 512 MB and a hard limit of 1024 MB, each held for 3 samples 15 s apart, so that a runaway proxy is caught long before it threatens the machine.
27. As a kit user, I want the soft limit to only WARN and log, so that a busy proxy is not restarted needlessly.
28. As an operator, I want the memory thresholds configurable in `config.yaml` and tested with an injected sampler, so that the defaults can be tuned safely.
29. As a user running ten parallel harness sessions on Linux, I want the kit footprint to stay at or below 596 MB of summed RSS on Node ≥ 26.1 (launcher handover; not claimed on Node 24; macOS unverified, owner action), so that a fleet of agents fits on an ordinary machine.
30. As a Windows user running ten parallel sessions, I want the kit footprint to stay at or below 600 MB of commit, so that the primary platform gets the same guarantee.
31. As an OMP user, I want parallel OMP hosts to share one preflight, with the other hosts waiting inside their own process, so that five simultaneous starts cost one preflight process instead of five.
32. As an OMP user whose host waited on another host's preflight, I want to still see that preflight's `cause=` warnings, and to run my own preflight if the shared one failed or timed out, so that no diagnostic is lost.
33. As an OMP user, I want a stale autostart token taken over only on proof, and waits bounded by today's start timeout, so that one crashed host cannot block the others.
34. As a harness user, I want the MCP bridge to load its HTTP transport lazily and run with a smaller young generation, so that each session's bridge costs less memory without changing its behaviour.
35. As a POSIX user on Node 26.1 or newer, I want `zcode-kit run` to hand its process over to the harness after the preflight, so that the launcher costs nothing for the rest of the session.
36. As a POSIX user, I want the handover used only when it is safe (POSIX, Node ≥ 26.1, the target resolved and executable), so that a missing harness still gives today's "run: …" error and exit 2.
37. As a user who prefers the old behaviour, I want an opt-out env var that keeps the launcher resident, so that I can go back without downgrading the kit.
38. As a user whose harness is killed by a signal, I want the exit status to report that signal, and I want this announced, so that scripts see the real cause and are not surprised by the change.
39. As a user running a harness on a TTY, I want no `ExperimentalWarning` from the handover in my session, so that kit noise does not leak into the harness.
40. As a Windows user, I want the launcher to stay resident with signals and exit codes forwarded as today, so that nothing changes where handover is impossible.

### Stability: processes and lifecycle

41. As a kit user, I want exactly one proxy per installation no matter how many harness sessions start at once, so that parallel sessions never multiply proxies.
42. As a kit user, I want a stale start lock taken over when its holder is proven dead or its PID proven reused, so that one killed start no longer makes 7 of 10 launches fail.
43. As a kit user, I want a live holder's start lock never touched, and the takeover protocol proven free of the judge-then-rename race, so that two contenders can never both think they hold the lock.
44. As a kit user, I want a start that is interrupted by Ctrl-C, SIGTERM, SIGHUP, or on Windows SIGBREAK or a console close, to release its own start lock, so that interrupting a start leaves nothing stale behind.
45. As a kit user, I want the next start to adopt an orphaned proxy through the identity proof, so that a proxy that survived an interrupted start is reused, not duplicated.
46. As a kit user upgrading the kit, I want start locks left by older kits (version-less, protocol v0) recovered by the same proof, so that a stale lock from before the update does not keep breaking launches.
47. As a kit user, I want an unparsable lock, or a lock of an unknown higher version, never deleted automatically, and reported with what/why/next and its exact path, so that the kit never destroys a record it does not understand.
48. As a kit user, I want new locks written atomically, so that "unreadable" can only mean foreign corruption, never a contender's half-written record.
49. As a kit user, I want a respawn for memory to start draining only after the manager has acknowledged that the restart budget is reserved, so that a refused respawn leaves my proxy serving instead of gone.
50. As a kit user, I want a refused or unacknowledged respawn logged once as ERROR, reported as an exhausted restart budget, and retried at most once per budget window, so that I know about it and nothing storms.
51. As a kit user, I want restarts limited to 3 per 15 minutes even under induced memory pressure, with exactly one proxy at every moment, so that there is no restart storm.
52. As a harness connected during a respawn, I want new requests shed with 503 + `Retry-After` while the listener stays open, and in-flight requests given the drain window, so that I see a retryable answer and not a connection reset.
53. As a kit user, I want a hung proxy's watchdog path to self-terminate after the acknowledgement or refusal within a bounded wait, so that a hung proxy never lingers and the next preflight starts a fresh one.
54. As a Windows user, I want `proxy stop` and `proxy restart` to run the proxy's graceful sequence, including the account-metadata flush, so that stopping on the primary platform no longer means a hard kill.
55. As a security-conscious user, I want the stop request accepted only on loopback, after Host, Origin and bearer checks, and only with a per-spawn 256-bit stop token compared in constant time, so that no harness holding the proxy key can stop the proxy.
56. As a security-conscious user, I want the stop token never shown in logs, status, JSON, doctor, snapshots or error text, freshly generated for every proxy spawn (overwriting any inherited value), and stripped from the solver's and the respawn hook's environments, so that it cannot leak or be reused by the next proxy.
57. As a kit user, I want the manager to force a stop only after the proxy's own deadline plus a margin, so that a stop never kills the proxy in the middle of its flush.
58. As a kit user stopping an older proxy, I want the manager to fall back to today's signals or `TerminateProcess` when the proxy does not know the stop request, so that stop keeps working across versions.
59. As a kit user, I want `proxy stop` and `restart` to show progress on a TTY while the grace period runs, and to stay line-based off a TTY, so that I know the command is not stuck.
60. As a kit user, I want every child process and worker reaped on stop, restart, crash and update, so that 50 lifecycle cycles leave 0 orphans.
61. As a kit user, I want the manager CLI's commands, exit codes 0–5, output, and the respawn arguments to stay as they are, so that an old running proxy can still call a new manager during an update.

### Stability: bounds and logs

62. As a kit user, I want the captcha CDN cache in memory bounded to 64 MB and 256 entries, so that a solver generation cannot grow it without limit.
63. As a kit user, I want the CDN cache on disk bounded to 256 MB, pruning by age only entries already expired under my configured TTL, so that the disk stays bounded without serving different bytes.
64. As a user with several installations sharing the CDN cache directory, I want pruning to skip temp files and files being written and to tolerate files that vanish, so that concurrent solvers never corrupt each other's cache.
65. As a kit user, I want the stall counters bounded by count only (1,024 entries, oldest first), so that memory is bounded without changing when the cache is invalidated.
66. As an MCP client, I want finished tasks retained until there are more than 500 of them or they are older than 7 days, with running tasks never evicted, so that bridge memory and disk stay bounded.
67. As an MCP client, I want an evicted task to give the existing not-found error, and its idempotency key to be forgotten with it, as documented, so that I know the idempotency window equals the retention.
68. As an MCP client, I want a bridge restart to load only the retained tasks, so that a restart no longer reloads all history.
69. As an MCP client, I want per-task warnings, errors and tool calls capped (200, 200, 1,000), so that one long task cannot grow without limit.
70. As an MCP client, I want task response text capped at 4 MiB of UTF-8 while it is being collected, keeping the first 1 MiB and the last 3 MiB with one `[… N bytes truncated …]` marker, so that I still get the framing and the answer.
71. As an MCP client, I want a truncated result marked `completeness: partial` with an explanation, plus an additive `truncated` field with the dropped byte count, so that existing consumers and new ones both see the truncation.
72. As an MCP client, I want results cached before the change served exactly as stored, so that old results do not change under me.
73. As a TUI user, I want the log pane capped at 2,000 lines and 8 MB, so that very long log lines cannot hold 125 MB of heap.
74. As a kit user, I want the proxy to rotate `proxy.log` itself while it runs (5 MB, keeping `proxy.log.1`), so that the log can no longer grow for the proxy's whole lifetime.
75. As a user reading logs, I want `zcode-kit proxy logs N` to read across `proxy.log.1` and `proxy.log`, so that rotation never hides recent lines.
76. As a user debugging a failed start or a crash, I want early and native output kept in `proxy.early.log` (capped at 1 MB), with its last 64 KB copied into `proxy.log` behind a marker line before the file is truncated again, so that the cause is still where the kit tells me to look.
77. As a Windows user, I want rotation to keep appending and retry, with one WARN line, when an editor or antivirus holds the file, so that no log line is ever lost.
78. As a security-conscious user, I want every log file created with owner-only permissions and the logs directory restricted the same way, so that more frequent rotation does not loosen permissions.
79. As a kit user, I want the manager to rotate the log only under the start lock and only when no live proxy exists, so that a preflight can never delete the file a running proxy writes into.

### Observability

80. As a kit user, I want `proxy status` and its `--json` to show each proxy-owned process's role, pid, RSS, memory footprint, cap and enforcement mode, so that I can see where memory goes.
81. As a kit user, I want the restart budget (`last15m`, `budget`) and the admission counters (`inFlightBytes`, `queued`, `shedTotal`) in status and JSON, so that I can tell whether the proxy is shedding or restarting.
82. As a script author, I want these fields added without changing any existing field's name, type or meaning, with `schemaVersion` staying 1, so that my parsers keep working.
83. As a kit user, I want `/health` details to keep answering synchronously from cached samples, behind bearer auth, so that hung-proxy detection stays reliable and nothing new is exposed.
84. As a kit user, I want `doctor` to report `proxy memory`, `solver memory`, `memory cap enforcement` and `restart budget`, each WARN with what/why/next, so that memory problems are caught where I already look.
85. As a macOS user, I want sampling enforcement shown as PASS with a note, so that doctor does not WARN about something I cannot change.
86. As a Linux user without a delegated memory controller, I want the enforcement WARN to tell me to check `systemctl --user status` and point to the README section, so that I know how to get a real cap.
87. As a kit user, I want the solver row to WARN only during fail-fast or after a recent abnormal exit, not at its recycle threshold, so that a normal mid-solve peak does not cause a flapping WARN.
88. As an operator reading logs, I want new event lines (memory, recycle, shed, supervisor, lock takeover) in one `ISO-time LEVEL component message key=value…` format, with existing lines byte-identical and redaction applied to all, so that new events are greppable and old scripts still work.

### Terminal UX

89. As a kit user, I want every command to render through one design language (aligned rows, verdict last, glyph plus word), so that all output reads the same way.
90. As a script author, I want `doctor` check rows off a TTY to keep exactly `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` (separator ` — `, U+2014, byte-for-byte in every glyph tier) with today's check names, followed by whitespace-indented `why:`/`next:` lines, with `WARN` as the only new word, so that my greps keep working.
91. As a script author, I want `WARN` never to change an exit code, and no check that FAILs today to become a WARN, so that exit codes stay what they were.
92. As a kit user, I want `doctor` to show each check once, with one verdict line and a problem count first when anything failed, so that I get the answer at once and nothing is printed twice.
93. As a script author, I want reports and data on stdout and every diagnostic on stderr, so that `zcode-kit run … | jq` sees only the harness's output.
94. As a Windows PowerShell 5.1 user, I want the extra stderr lines never to become a terminating NativeCommandError or to change an exit code, so that installers and shims keep working with `$ErrorActionPreference = "Stop"`.
95. As a kit user, I want every error to say what happened, why, and the exact next command, so that I can fix it without searching.
96. As a new user installing the kit, I want the installer to show `zcode-kit auth login zai` on screen when login is needed, so that I am not told to log in without being told how.
97. As a kit user, I want `setup` to print a compact report by default (stages, one result row per assistant, the connection check, the connection details and the undo command), with the full output in `install.log` and on screen with `--verbose`, so that I can scan the result and still have every detail.
98. As a kit user, I want the Account Rotator question asked once, stored like the harness choices, and asked again only with `setup --reask`, so that `setup` and `update` stop asking me what I already answered.
99. As a kit user who enabled the rotator before this change, I want that answer recorded automatically, so that the migration does not ask me again.
100. As an unattended updater, I want `update` never to block on an unanswered question without a usable TTY on stdin and stderr, so that updates can no longer hang.
101. As a kit user, I want `accounts enable` and `accounts disable` to update the stored rotator decision, so that there is one meaning for the setting.
102. As a kit user, I want `auth status` in human-readable text on a TTY, the exact current JSON when stdout is not a TTY, and JSON on a TTY with `--json`, so that people get a readable answer and scripts get the same bytes as before.
103. As a kit user, I want help grouped by task, with examples first, environment variables and exit codes, and a `--help` for every command, so that I can find what I need at 80 columns.
104. As a kit user, I want a usage error to print a two-line message on stderr and exit 2, not the whole help page, so that the mistake is obvious.
105. As a kit user, I want the connection details printed once per command, unboxed and within 80 columns, with the key shown only on an interactive TTY, so that I can copy values cleanly and the key stays protected.
106. As a user on a non-UTF-8 code page or Windows 10 conhost, I want glyphs to fall back to the wgl4 or ascii glyph tier while the words stay the same (off a TTY the check-row separator ` — ` and the verdict words never change with the tier), so that output never turns into boxes or mojibake.
107. As a colour-blind user or a NO_COLOR user, I want every state carried by a glyph and a word, and no escape sequences at all in line mode when colour is off, so that I lose nothing without colour.
108. As a CI user, I want progress only as animated lines on a TTY, and as plain start and result lines elsewhere, so that logs stay clean.
109. As a user at 80 columns, I want widths computed with a grapheme-correct width core (CJK, emoji, VS16), so that alignment holds with any text.
110. As a user, I want `--color=auto|always|never`, `ZCODE_KIT_UNICODE`, `ZCODE_KIT_PROGRESS` and `ZCODE_KIT_HYPERLINKS` as documented overrides, with NO_COLOR winning over FORCE_COLOR, so that I can force the behaviour my terminal needs.
111. As a kit user, I want `integrate --dry-run` to list every file it would write and every registration it would make, with the undo command, so that I can review a change before agreeing to it.
112. As a kit user, I want `rollback` and `uninstall` to end with a verdict that counts what was restored or removed, so that I know they finished.
113. As a kit user, I want `update` to show numbered steps and print the connection details once at the end, so that I can follow what it did.
114. As an accounts user, I want account commands to name `zcode-kit …` in their next steps, and to show tables with an active marker and one number format, so that the advice is correct and readable.
115. As a POSIX user, I want the Codex adapter to print the POSIX launcher, not a Windows path, so that the shown command works on my OS.
116. As an installer user, I want installer errors to print real line breaks and a next step, and install.sh not to colour under TERM=dumb, so that error text is readable everywhere.
117. As a TUI user, I want a boxed status header with health, port, uptime, account and plan, and a process strip with per-process RSS, the enforced metric against the cap, the enforcement mode and restarts in 15 min, so that I see the proxy's state at a glance.
118. As a TUI user, I want a log pane I can filter (`/`, `level:warn`/`level:error`), scroll and follow, with a key-hint footer that always keeps `quit` visible, so that errors no longer scroll away unseen.
119. As a TUI user, I want the collapsed settings strip and the toast, with every existing action (provider and plan switching, login, start/stop) still reachable and the selection marked by text, so that nothing I could do before is lost.
120. As a TUI user on a wide terminal, I want a sidebar at 100 columns or more and a defined single-column layout at 80, with a 60×16 minimum, so that the layout uses the space I have.
121. As a TUI user under TERM=dumb or without a TTY, I want the TUI to refuse and print the line-mode commands, so that I get a working alternative instead of a broken frame.
122. As a TUI user, I want the TUI to poll its data at most every 5 s, one request in flight per source, with no new endpoints, so that the view itself cannot load the proxy.
123. As a script author, I want every `--json` output to stay a byte-compatible superset of today's keys and value types, so that my integrations never break.

### Compatibility, currency and docs

124. As a user on Node 20 or 22, I want `setup` and `update` to refuse before changing anything, with what/why/next, and to leave my installation working, so that the new support floor cannot leave me with a broken kit.
125. As an OMP user, I want the preflight to tell me when the autostart's pinned Node path is below the support floor or missing, so that a Node upgrade through a version manager does not silently break autostart.
126. As a kit user, I want Bun 1.4.4 pinned everywhere (CI, release, both installers with verified SHA-256s, docs, SUPPORT_MATRIX), so that every path runs the same runtime.
127. As a kit user, I want happy-dom 21.0.4 with CSS and iframe loading kept on, so that the code-execution advisory is fixed without changing what a solve loads.
128. As a kit user, I want undici, yaml, the MCP SDK and zod raised to versions that fix their advisories, so that known vulnerabilities are gone.
129. As a maintainer, I want staying on MCP protocol revision 2025-11-25 and SDK 1.x documented as a deliberate stay-back, so that the reason is on record.
130. As an operator who sets `ZCODE_PROXY_UPSTREAM_PROXY`, I want captcha egress under Bun to use exactly that setting, or no proxy when it is unset, so that solver traffic never takes an undeclared ambient proxy route.
131. As a Continue user, I want the adapter to write `capabilities` as a string array, so that Continue accepts the config.
132. As a Kilo Code user, I want the Anthropic base URL written with `/v1`, so that requests reach the proxy's routes.
133. As a harness user, I want the medium-severity adapter fixes that primary docs confirm, applied on my next `setup` or `integrate` through the transaction with rollback, so that my configs are current and reversible.
134. As a harness user, I want adapter items that research marked unverified left unchanged, so that the kit does not guess at config formats.
135. As a kit user, I want every migration (lock version, retention pruning, rotator decision, adapter refresh, bridge flags) automatic, idempotent and safe to run twice, so that upgrading is a non-event.
136. As a reader of the docs in English, German, Spanish, Japanese or Chinese, I want README, SECURITY, harness and MCP bridge docs updated with content parity in the same change, so that every language tells the truth.
137. As a security reviewer, I want SECURITY to stop saying the solver is a worker thread and that the start lock is never taken over, and to state that the solver process is still not a sandbox and that the happy-dom loading surface is unchanged, so that the security statements stay accurate.
138. As a kit user, I want release notes that list every user-visible change (stream move, WARN, Node floor, `auth status`, rotator migration, shedding, thresholds, recycle count, retention, log files, JSON additions, Bun 1.4.4, Windows graceful stop, launcher handover exit status, solver visible as a process), so that nothing is removed or changed silently.
139. As a maintainer, I want the existing update and upstream-config tests run by `npm run test`, plus a guard that fails when a test file is wired into no script, so that tests can no longer sit outside CI unnoticed.
140. As a maintainer, I want CI on {ubuntu, windows} × {Node 24, 26} running the kit, proxy, proxy typecheck and MCP suites, so that every supported platform and runtime is tested.
141. As a maintainer, I want a memory-budget job on both OS legs that fails on any RED scenario not on the expected-RED list and on any listed scenario that turns GREEN, so that the guardrail can land first and can only ratchet tighter.
142. As a maintainer, I want snapshots updated only on purpose, with CI failing if the update switch is set, so that output changes are always reviewed.
143. As the owner, I want a draft PR opened at the first merge, never merged, and nothing pushed to `main` or `feature/account-rotator`, so that CI runs throughout and no release is triggered.
144. As the owner, I want every check this run cannot do (a live vendor-SDK solve, real Windows consoles, macOS) recorded as an owner action with copy-paste commands and marked unverified, so that nothing is claimed without evidence.

## Implementation Decisions

Every module below uses the glossary's vocabulary. Interfaces are named where a decision fixes them. File paths are left out on purpose, except for user-visible state and file names that are part of the contract.

### 0. Order of work

The order follows PROMPT §7 Phase 3, with two recorded deviations (RUNLOG + ADR-0016):
1. The memory loop with budgets, the process-count harness, the Windows sampler **and the `memory-budget` CI job on ubuntu and windows with the expected-RED list** (the guardrail). **Deviation 2:** PROMPT principle 8 puts the memory budget job last; it lands here, because the expected-RED list exists so that the job can land first (Round 2 Q14 cond 1) and the Bun 1.4.2 Windows reference run is the draft PR's first CI run on the loop code merged before the toolchain batch (Round 3 Q9 cond 1, Round 4 Q5 D2).
2. Prefactors: the output module with its snapshot harness, then the CLI command-module split.
3. Upgrade batches 1–3. **Deviation 1:** they land *before* the memory fixes, so that the fixes are measured on the target runtime (Round 1 Q15, Q16 cond 4; Round 2 Q15). The proxy typecheck already moved into batch 1 (Round 2 Q15 cond 1).
4. Memory and process fixes. Each starts RED on the upgraded runtime. If an upgrade alone turns a scenario GREEN, the fix ticket is re-scoped with that evidence.
5. UX migration batches, then the TUI.
6. Observability.
7. Docs and translations.
8. The remaining CI guardrails (snapshot-update refusal, test-wiring guard).

### 1. Memory loop and budgets (guardrail; lands first)

- The loop from the diagnosis branch becomes committed code: scenarios S1–S7 against an isolated installation (port 18457–65000, isolated HOME and state dir, mock upstream, fixture credential, `ZCODE_OVERHAUL_RUN=1` or the CI flag `ZCODE_MEMLOOP_ALLOW=1`). It has a per-second sampler, a CSV plus summary per run, RED rules (slope with a trend rule, role peak, per-process peak incl. HWM, process count, orphans after stop), and exit codes 1 RED, 0 GREEN, 2 harness failure.
- **Sampler schema:** `t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd`, plus an additive `commit_kb` column (empty on Linux).
- **Windows sampler (Round 1 Q7, Round 2 Q13):**
  - one long-lived `powershell.exe -NoProfile -NonInteractive` child polls `Win32_Process` every 1 s, and the loop reaps it on exit;
  - kit processes are identified by the tree from the loop root **plus** a run-unique token in the command line or executable path (for example the isolated `ZCODE_KIT_BUN` path), and a self-test proves that a deliberately orphaned detached process is found;
  - mapping: `rss_kb` = WorkingSetSize/1024, `commit_kb` = PrivatePageCount/1024, `hwm_kb` = PeakPageFileUsage, `threads` = ThreadCount, `fds` = HandleCount;
  - a start-up self-test checks the units against `Get-Process` `PrivateMemorySize64`;
  - the sampler excludes itself by PID, and its measured overhead is recorded.
- **Metric per OS:** RED rules use RSS on Linux and commit on Windows. Linux PSS is reported for information only and never gates.
- **S3 verdict has two parts (Round 3 Q1):** (a) the maximum, over all samples, of summed kit RSS (commit on Windows) is ≤ the total budget; (b) every kit process's own peak (VmHWM, PeakPageFileUsage, or `ru_maxrss` where the loop spawns the process) is ≤ its per-role target. Part (b) is enforced as role budgets in the verdict module.
- **S3 OMP leg:** runs the generated OMP extension in a stub Bun host, with 5 simultaneous hosts and also with the starter host killed. It reports the host's RSS delta, which is not counted as kit footprint.
- **Expected-RED ratchet (Round 2 Q14, Round 3 Q8):**
  - a JSON list maps scenario/variant → ticket id, keyed per OS leg (`linux` / `windows`);
  - the job fails on a RED scenario that is not listed, on a listed scenario that turns GREEN, on an unknown scenario or variant, and on a ticket id with no issue file;
  - the verdict tests pin the ratchet rule;
  - each memory-fix ticket's acceptance criteria include deleting its entry;
  - the list is empty at the Phase 6 gate.
- **Baselines:**
  - the Linux reference is Bun 1.4.2 (`METRICS.md`);
  - the `memory-budget` CI job (ubuntu and windows, expected-RED list) lands together with the loop in step 1, so the Windows reference baseline exists before step 3;
  - Windows records two runs before any memory fix merges: the Bun 1.4.2 reference run (the loop and its CI job merge before the toolchain batch, and the draft PR's first CI run measures it) and the Bun 1.4.4 attribution run right after the toolchain batch;
  - if the sampler cannot run on the pre-upgrade code, the 1.4.4 run becomes the reference, with the reason in RUNLOG;
  - a scenario that is RED only on commit goes back to the owner. It is never adjusted silently.

### 2. Solver process (ADR-0002, Round 2 Q2, Round 3 Q10)

- The dispatcher interface stays unchanged (`runCaptchaSolve`, stats, recycle request, shutdown, as consumed by the token pool, the captcha module and the health supervisor), and so does the existing message protocol. The transport moves behind an internal seam with two adapters: the **child-process adapter** (default) and the **thread transport** (tests and fallback). The dispatcher's module-level state becomes an object owned by the deep module.
- **Spawn:**
  - from source, the solver process starts from the running Bun (`process.execPath`) plus the solver entry module;
  - compiled builds use a self-exec subcommand, never `-e`;
  - both paths have tests.
- **Cap before work:** the child loads neither happy-dom nor the solve code until the parent confirms by handshake that the cap is applied.
- **Enforcement per OS:**
  - Windows uses a Job Object through `bun:ffi` with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and no new dependency;
  - Linux uses a user-systemd cgroup v2 scope with `MemoryMax=` and `MemorySwapMax=0`, verified by reading the scope's `memory.max`, and falls back to `sampling` otherwise;
  - macOS uses `sampling`.
  The enforcement mode is `job-object` | `cgroup` | `sampling` | `none`, and `none` covers the thread transport and caps that are switched off.
- **Reaping:** Windows relies on kill-on-close. On POSIX the child exits on IPC EOF. The watchdog's self-SIGKILL of the proxy must also leave 0 solver processes.
- **One solver generation at a time:** the old process has exited, or has been killed after a bounded grace period, before the next one spawns.
- **Metric:** `Bun.unsafe.memoryFootprint()` (commit charge on Windows), with RSS only as the fallback. The child reports its own footprint after each solve.
- **Recycle triggers:**
  - the primary trigger is footprint at 80 % of the configured cap (240 MB at 300);
  - the count backstop is 100 solves, changed from today's 200;
  - the failure, idle (10 min), request and deadline (90 s, still starting at dispatch) triggers stay;
  - the in-worker 768 MB heap trigger is removed or re-based below the cap.
- **Cap:** 300 MB by default, configurable in `config.yaml` (env override only through the `proxyEnv` allowlist, with a test). Values below a documented minimum are rejected at config load with what/why/next. Tests and the §9 evidence use 300 MB.
- **Failure semantics:**
  - a crash, a cap kill, a fatal error or a deadline kill fails only the in-flight solve, with the existing error and category (`CaptchaSdkError("other", …)`);
  - the queue is pumped onto the next generation;
  - only these abnormal exits count toward the **5 per 10 min** solver restart budget, after which solves fail fast. Planned recycles never count;
  - the budget limits process restarts and never resubmits a solve, so it is not a new retry policy (ADR-0002 cond 7, B1);
  - during fail-fast, solve requests get the ADR-0004 shed contract with `Retry-After` = the time until the window reopens. A crash alone never sheds;
  - the solve queue is bounded by its callers (one in-flight solve per pool, §7). Only if no caller-side bound can be shown is a count bound added; that count then goes into §7 and its overflow sheds under ADR-0004.
- **Lifetime:** the solver process spawns lazily on the first solve, stays alive while solves arrive, and exits after 10 min idle, which is not an abnormal exit. An idle exit releases the cap container. Prewarm is off by default.
- **Environment parity (B1):**
  - the child receives `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA`, the CDN cache variables and the egress setting (§13), and the guest error boundary is installed in the child as well;
  - the solver process and the respawn hook environments exclude `ZCODE_KIT_STOP_TOKEN`, and the solver process environment also excludes `ZCODE_KIT_RESPAWN_*` (§4);
  - the child never runs the watchdog or the respawn hook.
- The child's stdout and stderr are piped to the parent and written through the parent's log writer (§8), with line content unchanged.
- The cold start (spawn + handshake + module load) is measured on Linux and Windows and recorded in METRICS. If it exceeds 4.5 s, it comes back as a finding. The deadline is not moved silently.

### 3. Admission (ADR-0004)

- In-flight bytes count from reading the body until it is sent upstream, and the byte cap is 64 MB by default. The cap is configurable in `config.yaml`, with an env override only through the `proxyEnv` allowlist and a test.
- Requests waiting in the admission queue have not had their bodies read, so backpressure stays on the socket. The queue is FIFO, bounded by a documented count and by 15 s.
- **Shed:** HTTP 503 with `Retry-After`, using the OpenAI `error` object on the OpenAI-format endpoints and `overloaded_error` on the Anthropic-format endpoint. Never 429. Open upstream response streams are not limited by default.
- Redundant body copies are reduced ticket by ticket, each measured. The bytes sent upstream do not change.
- The stop request (§4) bypasses admission.

### 4. Proxy lifecycle module (ADR-0003, ADR-0008, ADR-0012, ADR-0014, ADR-0015; Round 2 Q10/Q11, Round 3 Q3/Q4)

- **Module and interface:**
  - one deep module owns start, stop, restart, status, the start lock, takeover, orphan adoption, respawn requests and the restart budget;
  - its interface is the lifecycle intents: ensure running, stop, restart, budgeted respawn request and read state (identity proof + pid record);
  - the intents print nothing and return outcome records;
  - every caller uses this interface: the CLI commands, preflight, `run`, the OMP extension (through the preflight), update, setup, the account change and the respawn hook;
  - `createManager({ root, home, processStartMsImpl, … })` stays the injection seam;
  - the preflight path imports no presentation code.
- **Frozen external contracts:**
  - the manager CLI's commands, exit codes 0–5 and output, including its own `doctor` in the legacy off-TTY grammar;
  - the OMP autostart's exit-code mapping (3 → foreign, 5 → key);
  - the `ZCODE_KIT_RESPAWN_MANAGER` path;
  - the `respawn <pid> --reason <r>` arguments.
- **Start lock protocol:**
  - today's lock record `{pid, startedAt, nonce}` is protocol v0, and new locks add a protocol version field and the holder's process start time, written atomically;
  - **takeover** requires proof that the lock is stale: the holder is dead, or its PID was reused (the live start time differs from the recorded one; for v0 locks, it is later than `startedAt`);
  - the protocol closes the judge-then-rename race, for example by checking the moved record against the judged one, or with an exclusive takeover side-lock carrying pid + start-time proof;
  - a live holder's lock is never touched (AUD-001 stays), and unparsable or unknown-higher-version locks are never deleted automatically (what/why/next, exact path);
  - an old kit reading a new lock reads only `pid`/`startedAt`, which is tested against the origin/main manager.
- **Signals:** a holder releases its own lock on SIGINT, SIGTERM and SIGHUP, and on Windows on SIGBREAK and console close, and only while the on-disk record is still its own. Respawn treats a proven-stale lock as takeable. An orphaned proxy is adopted through the existing identity proof, and a second proxy is never spawned.
- **Graceful stop request (Round 3 Q3):**
  - **route:** `POST /__kit/stop` on the existing loopback listener. It sits after the Host, Origin and bearer checks and also requires a per-spawn 256-bit stop-token header. Both are compared in constant time, length included. No CORS allowance is added;
  - **when the proxy was spawned without a stop token** (TUI-hosted, standalone), the route answers the same `404 not_found_error` as an unknown route;
  - **stop-token storage:** it reaches the proxy as `ZCODE_KIT_STOP_TOKEN` and is stored as an additive field in `proxy.pid`. `proxyEnv` already passes `ZCODE_KIT_*` through, so an allowlist entry would do nothing; the real risk is an ambient value inherited through the respawn chain (the respawn hook is spawned with the proxy's own environment). Therefore (Round 4 Q4): the manager sets the variable explicitly at **every** proxy spawn (next to `ZCODE_KIT_RESPAWN_NODE`/`_MANAGER`, or inside `proxyEnv` the way `ZCODE_PROXY_CONFIG` is set), overwriting any inherited value; the token is freshly generated per spawn and equals the value written to `proxy.pid`; and the proxy strips it from the environment it gives the respawn hook, as it does for the solver process. On Windows, `proxy.pid` is protected by the user-profile ACL, the same as the proxy key;
  - **response:** the request has no body, bypasses admission and answers `202` before the drain. It triggers the single graceful sequence (§5);
  - **trigger path:** the manager sends the request on Windows **and** POSIX after the identity proof. On a 404/401/403 or a connection error, POSIX falls back to SIGTERM (still a handled trigger) and Windows goes straight to `TerminateProcess` (an old proxy, today's behaviour);
  - **force path:** `recoverHung`, the startup timeout and foreign-port paths in `start`, and the golden-path crash injection (through an explicit force helper) skip the request and force directly. Only `stop`, `restart` and update use the graceful request.
- **Shared deadlines:** `STOP_GRACE_MS = 10_000` is the proxy's own hard deadline: drain + the 3 s account-metadata flush + exit. The manager forces only after `STOP_GRACE_MS + STOP_EXIT_MARGIN_MS`, a named margin of a few 300 ms poll intervals (for example 2 s). Both live in one shared module and are tested together. The respawn wait (30 s) stays longer than the acknowledgement wait (10 s) + `STOP_GRACE_MS` + margin.
- **Respawn acknowledgement (Round 3 Q4):**
  - on a memory respawn, the proxy spawns the hook with unchanged arguments and waits up to 10 s for a `respawn.json` event with `pid === process.pid` and `at` later than the request time. Old and new managers both write this event at reservation;
  - the proxy watches the hook's `exit` event during the wait, and exit 4 counts as an immediate refusal. After the wait the proxy unrefs the hook, which must outlive it;
  - on refusal, or with no acknowledgement, the proxy does not drain. It keeps serving, logs ERROR once (event-line format), reports `restarts` as exhausted, and spawns at most one hook per budget window while the hard condition persists;
  - a late acknowledgement leads to "healthy and ours → already running, 0", never to a second proxy, and a test proves exactly 1 proxy with the slot consumed;
  - a backwards wall-clock jump fails safe (keep serving), because matching on `pid` + `at > requestTime` cannot pick up an earlier event;
  - the watchdog path waits at most 10 s for an acknowledgement or refusal, then self-terminates regardless and logs which outcome it saw;
  - **log dir in the proxy env (Round 4 Q4):** the logs directory reaches the proxy through one additive variable, `ZCODE_KIT_LOG_DIR`, which the manager sets explicitly at every proxy spawn to its own logs directory, overwriting any inherited value (same place as the stop token). Nothing else in the proxy env contract changes. The variable is **internal**, documented like `ZCODE_KIT_RESPAWN_*` and not in the user env-var list. A proxy started without it (TUI-hosted, standalone) keeps today's behaviour: no size-capped file writer opened by path and no respawn acknowledgement wait, because no manager hook exists (ADR-0008 cond 5);
  - **env tests (seam 8 `proxy-env` suite + seam 2):** with ambient bogus values for both variables, the spawned proxy receives the manager's logs dir and a new token; the token in the proxy's environment equals the one in `proxy.pid`; the respawn hook's environment has no stop token; two consecutive spawns get different tokens;
  - old proxies meeting a new manager keep today's behaviour, and this is documented.
- On a TTY, `proxy stop` and `restart` show progress during the grace period. Off a TTY they stay line-based.

### 5. Health supervisor (ADR-0008, Round 2 Q1)

- One supervisor module owns the heartbeat and watcher (`watchdogStep` stays its pure core), memory sampling (footprint, RSS fallback), the **single graceful shutdown sequence** (used by SIGINT/SIGTERM, the stop request, the memory respawn and update) and the respawn handoff to the lifecycle module. The lifecycle closures move out of the proxy entry point.
- **Thresholds:** soft 512 MB and hard 1024 MB, × 3 samples 15 s apart, configurable in `config.yaml` (env only through the allowlist). Soft only WARNs and logs; it no longer recycles the solver. Hard requests a respawn through the acknowledgement handoff (§4). Without a manager hook (TUI, standalone proxy), the supervisor logs and keeps serving. The restart budget stays at 3 per 15 min.
- **During the drain:** the listener stays open, new requests are shed (ADR-0004), in-flight requests get the drain window, and streams cut at the force point are counted in one log line.
- The SharedArrayBuffer heartbeat and its eval watcher keep their mechanism. The solver no longer shares the proxy's thread, so a hang in the solver process is handled by the solver deadline, not by the watchdog.

### 6. Kit footprint mechanisms (ADR-0013; Round 3 Q2)

- **(a) In-host single-flight in the generated OMP extension:**
  - before it spawns a preflight, the extension takes an exclusive autostart token: an O_EXCL file in the installation's logs directory holding the host pid and start time;
  - hosts that find the token wait in-host, with a stat poll plus the existing in-host `healthy()` fetch and no new process. The wait never exceeds today's `START_TIMEOUT_MS`;
  - the token is released in `finally`, and a stale token (holder dead, or older than `START_TIMEOUT_MS`) is taken over on proof;
  - the token is separate from the start lock, whose protocol does not change, and the extension keeps its rule of no kit modules in the long-lived host;
  - **cause-line channel (Round 4 Q2, binding conditions):** the starter writes a small result record next to the token, and waiters read it:
    1. **write before release:** the starter writes the record by temp file + rename with mode `0o600`, on every outcome (success, failure, timeout), and **before** it releases the token in `finally`, so a waiter never sees a released token without that attempt's record;
    2. **one attempt per record:** the record carries the same identity as the token (host pid, host start time and a per-attempt nonce). A waiter accepts it only if the identity equals the token it observed while waiting and the record's timestamp is not earlier than the waiter's own wait start. Any other record is stale and is never printed, so a record from an earlier start or another installation's clock is never replayed;
    3. **no matching record counts as a starter failure:** a token released without a matching record, or a token proven stale because the holder is dead, leads the waiter to apply the existing ADR-0013 takeover-by-proof and become the new starter with its own preflight; the other waiters keep waiting on the new token. "≤ 1 concurrent OMP preflight process" therefore holds in the killed-starter case, and no diagnostic is dropped silently;
    4. **bounded, fixed-vocabulary content:** only the exit code and the fixed-vocabulary `cause=` lines, with no paths, keys or free text, capped (≤ 4 KB / ≤ 16 lines). The waiter validates every line against the fixed vocabulary before printing it in its host; a corrupt or oversized record is treated as "no matching record" (condition 3);
    5. **one file:** a fixed name, overwritten per attempt, counted toward S4's log-dir file budget (≤ 8, loop-encoded). Waiters never delete it;
    6. a waiter that sees a healthy proxy and a matching record prints those cause lines in its own host before skipping its first-call preflight. A waiter whose starter failed or timed out runs its own preflight, so the failure categories and the "Next … may retry" text stay per host. The channel is an amendment line in ADR-0013 (cond 3);
  - an old extension (before re-setup) neither writes nor reads the record and keeps spawning preflights, which is harmless under the start lock.
- **(b) MCP bridge:**
  - the HTTP transport is imported lazily, with no behaviour change in HTTP mode;
  - `--max-semi-space-size=1` goes on the bridge command line in the generated harness MCP entries, never in `NODE_OPTIONS`;
  - existing harness configs are updated on the next `setup`/`integrate` through the transaction, idempotently;
  - `test:mcp` passes with the flag, and S5 stays within budget.
- **(c) Solver lifetime:** lazy spawn and idle exit, as in §2.
- **(d) `process.execve` handover in `zcode-kit run`:**
  - **when:** only when the platform is POSIX, `typeof process.execve === "function"`, Node ≥ 26.1, and the target is resolved on PATH and passes `access(X_OK)`. Otherwise the launcher stays resident as today, and pre-validation keeps today's "run: …" error with exit 2;
  - **opt-out (Round 4 Q3):** **`ZCODE_KIT_RESIDENT_LAUNCHER=1`** forces the resident launcher. The value convention is exactly `"1"`, as for `ZCODE_KIT_SKIP_DEPS` and `ZCODE_KIT_ALLOW_CHECKOUT`; any other value leaves the default. The launcher reads it before the handover decision, and with it set the resident path behaves byte for byte as today (asserted by the seam 5 spawn test). On Windows it has no effect, because the launcher is always resident. No other code path reads it. It is a user-visible variable (one-way door once released), documented in `--help` (environment section), in README × 5 next to the Node ≥ 26.1 note and in the release-notes entry for the handover;
  - **before the handover:** the `ready.detail` line, any `heal.log` write and all cleanup finish first (exit handlers do not run after execve). Then SIGPIPE/SIGXFSZ are re-armed (add and remove a listener), and the `ExperimentalWarning` is suppressed for this call only;
  - **visible change:** a harness killed by a signal now reports that signal (for example 143) where today it reports exit 1. Release notes announce it; exit codes 0/7/130 are unchanged;
  - **platforms:** macOS execve is unverified (owner action). README and the release notes state that the lower footprint on Linux/macOS needs Node ≥ 26.1. On Node 24 the S3 total is not claimed.
- **Windows:** the launcher stays resident. If Windows misses 600 MB of commit after (a)–(c), the lever choice (a lean resident launcher with the preflight in a child, or the bridge on Bun with proven protocol parity) comes back with numbers. Neither is adopted now.

### 7. Bounded collections (ADR-0009)

- One bounded-collection module is lifted from the responses store (LRU, TTL, byte budget, injected clock). The responses store's behaviour and tests stay unchanged. The dead `solveTimes` is deleted.
- Bounds:

| Store | Bound |
|---|---|
| CDN cache, memory | ≤ 64 MB and ≤ 256 entries; resets with each solver generation |
| CDN cache, disk | ≤ 256 MB (oldest first); prunes by age only entries already expired at max(14 days, configured TTL); pruned at start and after each write; skips temp files and files being written, tolerates `ENOENT` |
| Stall counters | 1,024 entries, count only, oldest first, no TTL, generation-scoped |
| Solver queue | bounded by its callers (one in-flight solve per pool; today `captcha-pool` clamps solve concurrency to 1). The ticket states the bound with evidence and pins it with a seam 3 test. Only if no caller-side bound can be shown is a count bound added here, with its overflow shed under ADR-0004 |
| MCP task registry | terminal tasks evicted at > 500 or > 7 days, whichever comes first; non-terminal never; `*.result.json` pruned with the task; startup restore loads only retained tasks; the idempotency key is forgotten on eviction |
| Per-task arrays | warnings 200, errors 200, tool calls 1,000 |
| Task response text | 4 MiB UTF-8, bounded during ingestion (head 1 MiB frozen, rolling 3 MiB tail, dropped-byte count) |
| TUI log pane | 2,000 lines and 8 MB |
| `proxy.log` | §8 |
| Responses store | unchanged (64 MB / 1,000 entries) |

- **Truncation shape (MCP):**
  - one marker line `[… N bytes truncated …]` (N in bytes), with cuts on code-point boundaries;
  - `completeness: partial`, with the truncation note merged into the end-state explanation after the terminal-state override, so the override cannot erase it;
  - the additive field `truncated: { droppedBytes }`;
  - the transcript fallback gets the same cap, and results cached before the change are served as stored;
  - the tool description, the MCP API doc (`docs/MCP_API.md`) and the release notes describe the 4 MiB cap (first 1 MiB + last 3 MiB), the `[… N bytes truncated …]` marker, the `truncated` field and the idempotency window, with the sentence: "Idempotency keys are remembered for as long as the task is retained (at most 500 terminal tasks or 7 days, whichever comes first); after that the same key starts a new task." `dist/` is regenerated by the build (B5).

### 8. `proxy.log` ownership (Round 2 Q4, Round 3 Q5)

- **The proxy is the single rotator while it runs:**
  - it opens `proxy.log` through a size-capped writer, rotating at 5 MB and keeping one `proxy.log.1`;
  - the rotation order is unlink `.1` → rename current → `.1` → reopen;
  - the writer uses plain fd writes, never a write stream;
  - once the writer is open, console, stdout and stderr go through it, and line content stays as it is today.
- **The manager:**
  - keeps appending `[manager <ISO>] …` lines;
  - rotates only under the start lock and only when no live recorded proxy exists. Today's rotation before lock acquisition is removed.
- **File modes bind every creator (Round 3 Q5 cond 2, Round 4 D4):** every creator of a log-dir file creates it with mode `0o600`, and the logs directory with `0o700`: the manager, the proxy writer on open and on reopen after rotation, the watchdog's by-path append, the creation of the early log, and the OMP extension if it creates the logs directory. This applies to `proxy.log`, `proxy.log.1`, the early log, the autostart token and its result record.
- **The early log (`proxy.early.log`):**
  - inherited stdio goes to the early log, which is truncated at each start and capped at 1 MB;
  - the proxy's writer enforces the cap: it checks the file's size at each rotation check and truncates it in place after writing a marker event to `proxy.log`;
  - before **any** truncation of a non-empty early log, the manager appends its last 64 KB to `proxy.log` behind a marker line. Start failure, respawn and crash are cases of this rule, and the golden-path classifier keeps reading only `proxy.log`;
  - watchdog lines may be appended to `proxy.log` by path (mode `0o600`), which is preferred.
- **Readers and foreign handles:** `proxy logs N` reads `.1` + current. If a foreign handle blocks the rename, the writer keeps appending, retries at every check and logs one WARN event line. Nothing is lost, and the case is documented.

### 9. Observability contract (ADR-0010)

- **Additive objects** in `proxy status`, `--json` and `/health` details:
  - `memory`, per process: `role` (`proxy` | `solver`), `pid`, `rssMB`, `footprintMB`, `capMB` and `enforcement` (`job-object` | `cgroup` | `sampling` | `none`). The solver entry also carries its fail-fast state and the time the window ends;
  - `restarts`: `last15m`, `budget`;
  - `admission`: `inFlightBytes`, `queued`, `shedTotal`;
  - `processes`: `{ proxy: 1, solver: n }`, which counts only what the proxy owns.
- **Contract rules:** `schemaVersion` stays 1. `/health` stays behind bearer auth, synchronous and O(1), and every value comes from a cached sample.
- **New `doctor` checks:** `proxy memory`, `solver memory`, `memory cap enforcement` and `restart budget`, with the PASS/WARN/SKIP rules and next commands of ADR-0010's Round 3 amendment. `doctor` triggers no new sampling work.
- **Event lines:** `ISO-time LEVEL component message key=value…` applies to new event lines only. Existing lines stay byte-identical, and redaction applies to all lines.

### 10. Terminal design language and output modules (ADR-0001, ADR-0005, ADR-0011; Round 1 Q8–Q13, Round 2 Q6–Q9/Q12)

- **Topology:** two renderers, one token set and one width core.
  - **Shared with the TUI:** a width core and a token set (glyph tiers, box chrome, colour roles, verdict words). Both are plain ESM with type declarations, live with the TUI code, and are tested under Node and Bun. `bun build --compile` bundles them for all five targets, and the payload verifier requires them. The existing width module re-exports the core, so its imports and tests keep working.
  - **Width core:** grapheme-based (`Intl.Segmenter`, a W/F table generated from UCD 17, VS16/RI pairs = 2, cluster cap 2), with an ASCII/no-combining fast path that keeps S6 within budget and the frame time unchanged.
  - **CLI output module (Node):** a capability record per stream, and `createOutput(...) → Out`, which renders records as text or JSON. No other module reads `isTTY`, `NO_COLOR`, `TERM`, `CI` or `columns`. Rendering code loads lazily; the preflight and the lifecycle intents never import it.
  - **TUI:** the proxy TUI keeps its pure frame renderer on the same tokens.
- **Capability record (from the 1C prototype, trimmed to the decision-rich part; the prototype's lower-case off-TTY words are NOT the target, see ADR-0001 rule 1):**

  ```js
  // colour  — flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > non-TTY off > TERM=dumb off > CLICOLOR=0 off > on
  // glyphs  — ZCODE_KIT_UNICODE override > ascii (TERM=dumb, non-TTY, non-UTF-8 POSIX locale)
  //           > wgl4 (win32 without WT_SESSION / TERM_PROGRAM) > full
  // animate — TTY && TERM != dumb && !CI
  // width   — stream.columns ?? COLUMNS ?? 80, min 40; off a TTY nothing is truncated
  { tty, color, glyphs: "full" | "wgl4" | "ascii", animate, width, fixed: tty }
  ```

- **Output interface** (design-language §9): `heading`, `kv`, `check({status: pass|fail|warn|skip, name, detail, why, next})`, `result({status: ok|fail|warn|skip|info, label, detail})`, `table`, `connection`, `verdict`, `next` and `data`/`json` on stdout; `error`, `warn`, `note` and `step(...) → Progress` on stderr. Prompts stay in the consent prompter, render through the stderr capabilities, and appear only when stdin and stderr are TTYs. Compact setup becomes a thin adapter over `Out`, with the setup log as a second sink.
- **Binding rules:**
  - off a TTY, check rows keep the separator ` — ` (U+2014) byte-for-byte in every glyph tier. The ascii copy mapping does not apply to the check-row separator or the verdict words. The grammar is `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$`, with today's check names, followed by whitespace-indented `why:`/`next:` lines (Round 4 D1; ADR-0001 rule 1). New display labels appear on a TTY only, and JSON check names stay byte-stable;
  - line mode has no box chrome. The TUI has exactly one box, the status header (Round 2 Q9 narrows ADR-0001 rule 2, see Further Notes);
  - the `doctor` lead line states the problem count only;
  - TUI memory rows show the enforced solver cap;
  - installer tags `[OK]`/`[SKIP]`/`[FAIL]`/`[WARN]` stay off a TTY;
  - check verdicts are `PASS|FAIL|WARN|SKIP`, and action results are `OK|FAIL|WARN|SKIP|INFO` (neutral choices are `INFO`, not `OK`).
- **Streams (ADR-0005):** stdout carries `doctor` rows and verdict, `status`/`proxy status` text, the setup summary, connection details, `proxy logs`, `models`, explicit `--help` and all JSON. stderr carries progress, warnings, error blocks, prompts, usage errors and every kit line in `run`. All of this ships in one release, announced. A windows-latest PowerShell 5.1 gate runs the installer's setup call and the shim with `2>&1`, with `-File … 2> file` and with `$ErrorActionPreference = "Stop"`, and asserts no NativeCommandError and no exit-code change. If it fails, the call sites are hardened in the same ticket.
- **`WARN` as a check verdict:** additive and exit 0. It is never applied to a condition that FAILs today. Its JSON value is listed as additive, and it is documented in `--help` and the release notes.
- **`auth status`:** text when stdout is a TTY, today's exact JSON otherwise, and JSON on a TTY with `--json`.
- **Account Rotator decision:**
  - the decision is stored under `generated/` next to the harness choices, and is asked only when nothing is stored;
  - `setup --reask` asks again, and `--account-rotator` and `ZCODE_KIT_ACCOUNT_ROTATOR=y|n` still override;
  - **migration:** `auth.accounts.enabled: true` → "yes", recorded without asking; `false` stays undecided and is asked once on the next TTY setup;
  - `accounts enable|disable` update the stored decision, and `update` never blocks without a usable TTY on stdin and stderr.
- **Compact `setup` by default:**
  - stages, one result row per assistant, the connection check, the connection details and the undo command;
  - full output goes to `install.log`, and to the screen with `--verbose`/`ZCODE_KIT_VERBOSE=1`;
  - every WARN/FAIL keeps its what/why/next on screen, `--installer` stays accepted, and nothing printed today is lost;
  - the installer-mode login hint shows `zcode-kit auth login zai`.
- **Help:** grouped by task, with examples first, environment variables and exit codes, at 80 columns. Every command gets its own `--help`. A usage error prints two lines to stderr and exits 2. `--help` documents `WARN`, `--reask`, the rotator override, `ZCODE_KIT_RESIDENT_LAUNCHER` and the output overrides.
- **Overrides (additive):** `--color=auto|always|never`, `--no-color`, `ZCODE_KIT_UNICODE=0|1`, `ZCODE_KIT_PROGRESS=auto|always|never`, `ZCODE_KIT_HYPERLINKS=auto|always|never` (off by default). NO_COLOR wins over FORCE_COLOR.
- **CLI command modules:** each command is a module that takes parsed args and ctx and returns `{ exitCode, records }`. The CLI entry keeps parsing, dispatch and rendering. Importing a command module has no side effects: no reads of argv or env, no `process.exit`, no I/O at module scope. The bin entry points stay unchanged.
- **Migration order** (each step reversible):
  1. the output-module prefactor plus the snapshot harness;
  2. the command-module split;
  3. the manager's `doctor` returns its checks as records, so `zcode-kit doctor` stops parsing text. The manager CLI's own `doctor` keeps the legacy grammar;
  4. per-command batches, each updating its snapshots in every C3 variant:
     - (a) `doctor`, `proxy start/status/stop/restart/logs` and the connection details;
     - (b) `setup`, `integrate`, the installer stages and `install.sh`/`install.ps1` text, which carries the PowerShell 5.1 gate;
     - (c) help, `models`, `accounts` (+health), `auth`, `run`, `update`, `rollback` and `uninstall`;
  5. the TUI.

  "No visible change" in steps 1–2 is proven by snapshots captured on the pre-change code.
- **The audit findings each batch closes:**
  - A-01 (login command);
  - A-02 (single doctor report);
  - A-04 (rotator asked once);
  - A-05/A-09 (streams, what/why/next; `Run setup first (node setup.mjs)` → `zcode-kit setup`);
  - A-06 (install.sh `die` prints real newlines, plus a next step);
  - A-07 (Codex POSIX launcher);
  - A-10 (help);
  - A-11 (TTY progress);
  - A-12 (connection details once, 80 columns, routes in `--verbose`/JSON);
  - A-13 (no escapes under TERM=dumb/NO_COLOR, including install.sh);
  - A-14 (ascii copy mapping);
  - A-15 (setup report);
  - A-16 (`integrate --dry-run` lists writes and registrations);
  - A-17 (status state line, human units);
  - A-19 (`zcode-kit` in account next steps);
  - A-20 (computed alignment);
  - A-21 (nesting under installer steps);
  - A-22 (prompt `[y/N]`);
  - A-23 (proposed additive `proxy logs` filters);
  - A-24 (rollback/uninstall verdict);
  - A-25 (numbered update steps);
  - A-26/A-27 (one banner, one number format).

### 11. Proxy TUI (Round 2 Q9; design-language §8)

- **Regions:**
  - a boxed status header (state, port, health, uptime, account/plan, login badge in words);
  - a process strip: per-process RSS, plus, for capped processes, the enforced metric named (footprint/commit) against the cap, the enforcement mode and restarts in 15 min;
  - the collapsed settings strip, with selection marked by `(•)`/`( )` text and disabled controls bracketed with a reason;
  - a log pane with an unboxed title line, a count/follow badge, a filter (`/`, substring, `level:warn`/`level:error`, Esc clears), scrolling and the byte cap;
  - the toast;
  - a key-hint footer in priority order (`quit` always visible, `[?] keys` overlay when cut).
- **Layout:** a sidebar at ≥ 100 columns and a single column at 80. The minimum is 60×16, with a notice below that naming `zcode-kit proxy status`.
- **Terminal rules:** TERM=dumb and non-TTY refuse, printing `zcode-kit proxy status` and `zcode-kit proxy logs 50`. NO_COLOR drops colour but keeps bold, reverse and the text markers. Colour uses the 16-colour roles only. Glyphs follow the wgl4 and ascii tiers. Alt-screen, cursor, mouse and raw mode are restored on every exit path.
- **Data:** the TUI hosts the proxy in-process, so it reads the same in-process snapshots `/health` exposes, plus the existing quota and accounts sources. It polls at ≥ 5 s, with one request in flight per source, no new endpoints and no new upstream calls. Every existing TUI action stays reachable.

### 12. Runtime and dependency targets, CI (ADR-0006, ADR-0007; Round 1 Q14–Q16/Q19, Round 2 Q14/Q15)

- **Batch 1, toolchain and CI:**
  - `engines.node >=24` in all three manifests, and installer gates (`install.sh`, `install.ps1`, pack build) at 24, with the exact upgrade step in the error;
  - `setup`/`update` on Node < 24 refuse before mutating state;
  - the preflight checks the OMP autostart's pinned Node path against the floor, and DEP0190 in the pack build is fixed;
  - Bun 1.4.4 everywhere, with the five upstream SHA-256s (linux-x64, linux-aarch64, darwin-x64, darwin-aarch64, windows-x64) and the installer tests' fake versions moved to 24/26, plus a test that rejects v22;
  - `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`;
  - the nested vendored proxy workflows are deleted, with a MANIFEST vendor-change entry;
  - the proxy typecheck moves into root CI through a pinned proxy `typescript` devDependency, and `@types/bun` is pinned to 1.4.4 exact. The typecheck baseline is recorded first, and any failures become tickets;
  - the memory loop's short profile re-runs on 1.4.4.
- **Batch 2, proxy deps:** happy-dom `^21.0.4` with `enableCSSFileLoading: true` and `enableIframePageLoading: true` (the SSRF-relevant surface stays unchanged, not stricter, ADR-0007); undici `^8.12.4`; yaml `^2.9.1`. The captcha suite runs green after the happy-dom bump, before any other captcha-path change.
- **Batch 3, MCP deps:**
  - `@modelcontextprotocol/sdk ^1.32.2`, `zod ^4.6.6` declared explicitly, TypeScript `7.0.2` exact (fallback `6.0.3`) and `@types/node ^24`, an intentional range downgrade;
  - both MCP lockfiles are regenerated, and `dist/` is regenerated and committed, with any TS 7 output diff reviewed;
  - staying on protocol 2025-11-25 and SDK 1.x is documented as a deliberate stay-back, and MCP 2.x becomes a `needs-triage` ticket.
- Each batch is green before the next.
- **CI layout:**
  - `test-kit` runs {ubuntu-latest, windows-latest} × {Node 24, 26} with the kit, proxy, proxy typecheck and MCP suites;
  - a separate `memory-budget` job (Node 26) runs per OS with the short profile and artefacts; it lands in step 1 with the memory loop and the expected-RED list, before batch 1 (§0, deviation 2), and batch 1 only moves its Bun pin to 1.4.4: ubuntu S1–S7, windows S1, S2 (offline fixture), S3, S4, S5 and S7. S6 stays ubuntu-only. Each job runs under hard caps and timeouts (a `systemd-run --user` scope or `prlimit` on ubuntu, a Job Object on windows), with `ZCODE_MEMLOOP_ALLOW=1` only there;
  - snapshot tests run inside `npm run test`. `release.yml` changes only in versions and runs on Node 26, and the publish job's Node 24 OIDC requirement stays satisfied;
  - the update and upstream-config tests join `npm run test`, and a guard fails on any kit test file that no script references;
  - the long memory profile stays local.

### 13. Captcha egress routing (Round 1 Q17)

On Bun, captcha fetches use `proxy: <ZCODE_PROXY_UPSTREAM_PROXY> ?? false`, and Node keeps the dispatcher. This is a routing fix only, covering `captchaFetch` and the sync-XHR worker path; what is fetched and how challenges are solved do not change.

### 14. Harness adapters (Round 1 Q18)

- **HIGH fixes:**
  - Continue: `capabilities` becomes a string array (`tool_use`, `image_input`);
  - Kilo Code: the Anthropic base URL gets `/v1`.
- **MEDIUM candidates, each applied only where the harness-config research confirms it from primary docs:**
  - Claude Code effort/capability declarations;
  - OpenCode Flash `modalities.input`;
  - Goose `supports_vision`;
  - Cline's documented CLI config path;
  - Kilo Code per-model reasoning and modalities;
  - OMP `auth: apiKey` and its unsupported compat fields;
  - pi `thinkingLevelMap`.
- **Left unchanged:** OpenCode's V1 schema, which V2 still accepts and migrates, and every UNVERIFIED item (`claude mcp add` syntax, Codex fallback metadata, the OpenCode V1/V2 merge).
- **Rollout and records:**
  - recorded versions and `primarySource` dates are refreshed only for what was re-verified;
  - changes reach existing users on the next `setup`/`integrate`, through the transaction with rollback, idempotently;
  - harnesses/README* and EFFORT_MAPPING* are updated where effort or image flags change.

### 15. Stored state and migrations (ADR-0012; Round 2 Q10)

- **State that changes or appears:**
  - the lock gains a version field and the holder's start time (§4);
  - `proxy.pid` gains the stop-token field;
  - the Account Rotator decision is stored under `generated/`;
  - `proxy.early.log` and `proxy.log.1` are new log files;
  - the autostart token and its result record are new;
  - MCP task files and CDN disk entries are pruned.
- **New config keys** are optional: byte cap, solver cap, memory thresholds and admission queue bounds. The shipped example config documents them with their defaults.
- **Rules:**
  - every migration runs through the existing transaction/rollback mechanism, is idempotent, and is tested by replaying it twice;
  - runtime migrations (lock versions, retention pruning) follow the same rule;
  - nothing is removed silently.

### 16. Docs (Round 2 Q16; C8)

- **Scope:** English first, with translations at content parity in the same ticket:
  - README × 5 (en, de, es, ja, zh-CN);
  - SECURITY (+de);
  - harnesses/README*;
  - SUPPORT_MATRIX.json (date, Node/Bun versions, tested harness versions reconciled with MANIFEST);
  - MANIFEST*;
  - EFFORT_MAPPING* only where affected;
  - the five MCP bridge READMEs, brought to parity and stating the Node 24 floor;
  - `docs/MCP_API.md` (the 4 MiB cap with head/tail marker, the `truncated` field and the idempotency window, §7).
- **SECURITY (+de):**
  - replace the worker-thread statement: the solver is now a separate OS process with a memory cap, and still not a sandbox (same user, files, network, credentials);
  - replace the "start lock is never taken over automatically" statement with the takeover rules;
  - state that the happy-dom loading flags keep the 20.x surface unchanged;
  - state that `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` keeps its meaning;
  - state the stop-token protections.
- **README × 5 also covers:**
  - the new config keys, log rotation and the early log (`proxy.early.log`);
  - MCP task retention and the idempotency window;
  - enforcement modes per OS, including the Linux delegated-controller section that `doctor` links to;
  - the 503 shed, the stderr routing and the rotator asked once;
  - the execve handover, its Node ≥ 26.1 requirement and its opt-out;
  - the README line about the start lock never being taken over is replaced, and the AUD-001 code comments are updated with the implementation.
- **Release notes:** the vNEXT release notes in the docs (English) list:
  - Node 20/22 dropped (the installer refuses first);
  - the stream move;
  - `WARN`, with the additive JSON enum values and fields and `completeness: partial` on truncation;
  - `auth status` text on a TTY;
  - the Account Rotator asked once, plus its migration;
  - the 503 shed, including shedding during a recycle drain;
  - the solver as a separate process (visible in task managers), its cap and enforcement modes;
  - memory thresholds 1536/3072 → 512/1024 MB (respawns become more likely);
  - solver recycle count 200 → 100;
  - MCP task retention 500/7 days and the idempotency window;
  - MCP task text capped at 4 MiB with a head/tail marker;
  - CDN disk pruning;
  - log rotation while running and `proxy.early.log`;
  - the Bun 1.4.4 requirement;
  - compact setup by default;
  - the Windows graceful stop;
  - the execve handover's signal exit status and its opt-out `ZCODE_KIT_RESIDENT_LAUNCHER=1`;
  - the nested proxy workflows deleted;
  - the proxy TUI refuses under TERM=dumb (exit 1) and prints the line-mode commands;
  - the four new `doctor` checks;
  - the additive `proxy logs --level/--grep` filters;
  - harness configs refreshed on the next `setup`/`integrate` (Continue `capabilities`, Kilo Code `/v1`, the confirmed MEDIUM items, the bridge's `--max-semi-space-size=1`).

### 17. Tracker docs and PR (Round 1 Q20/Q21)

- Byte-identical copies of the owner checkout's untracked agent-instructions file and tracker-convention docs are committed on the integration branch. Nothing else is copied from that checkout.
- A draft PR against `main` opens after the first merge and is marked ready in Phase 7. It is never merged, and nothing is pushed to `main` or `feature/account-rotator`.

### 18. Budgets and acceptance criteria

PROMPT §9, restated with the budgets the rounds tightened. Initial budgets are never loosened past the baseline. The metric is RSS on Linux and commit on Windows unless stated. "Loop" marks budgets the memory loop already encodes from memory-report §6. Evidence goes to METRICS.md and the run's verification report.

**MEMORY**

| Scenario | Budget | Baseline | Source |
|---|---|---|---|
| S1–S5 growth | ≤ 5 % per 1,000 work units after warm-up, and no upward trend across 3 consecutive windows | S1 long 0.07 %/1k; S5 ~42 %/1k | §9, loop |
| S1 proxy main steady state | ≤ 160 MB steady; ≤ 250 MB peak (§9 ceiling for steady-state RSS: 250 MB). Measurement rule for S1/burst1 (3 sequential ~10.8 MB requests per run; Round 6 Q1, ticket 60): the job runs 5 fresh, sequential repetitions and judges the MEDIAN proxy peak against 250 MB, and every repetition must stay ≤ 400 MB (a hard per-run ceiling); the same rule on the windows leg on the working-set gate, max(sampled WS, PeakWorkingSetSize), with the ceiling on that value and commit reported per repetition (Round 7 Q1). n = 5 is the smallest odd n with a predicted false-RED rate ≤ 5 % on the measured Linux distribution (METRICS.md); Round 8 Q1 condition 3 sets one n ≤ 9 for both legs once ≥ 20 windows repetitions are measured. The budget is unchanged; every other S1 run is still judged on one run | plateau 127 MB, HWM 182 MB | memory-report §6 (steady ≤ 160 MB tightens §9's 250 MB with Phase 1 evidence; peak ≤ 250 MB kept), loop, Round 6 Q1 |
| S1 burst HWM | ≤ 400 MB at 16 and ≤ 600 MB at 32 concurrent 10.8 MB bodies (the byte cap alone: 64 × ~4.5 + ~90 ≈ 380 MB) | 998 / 1,619 MB | ADR-0004 |
| S2 solver | each solver process hard-capped at 300 MB and recycled at 80 % (240 MB) footprint, count backstop 100; solver cost per generation ≤ 300 MB; retained before recycle ≤ 300 MB; hung-solve reclaim ≤ 64 MB; one solver generation at a time | per generation 0.9–1.0 GB, HWM 1,068 MB; retained 686 MB | ADR-0002, Round 2 Q2, loop |
| S2 CDN memory | ≤ 64 MB and ≤ 256 entries | +151 MB / 600 URLs | ADR-0009, loop |
| S2 solver cold start | ≤ 4.5 s (5 % of the 90 s deadline), Linux and Windows | — | Round 3 Q10 |
| S3 kit footprint, Linux | **≤ 596 MB** as the maximum summed-RSS sample on Node 26 (stricter of 600 and 852 × 0.7); PSS reported only | 852 MB | Round 3 Q1 |
| S3 per-role peaks | launcher ≤ 74 MB (resident path, on the CI Node version); MCP bridge ≤ 75 MB; OMP starter preflight ≤ 76 MB; proxy idle ≤ 62 MB; solver idle ≤ 20 MB (0 in S3 when spawned lazily). Plan P: 5 × 75 + 76 + 62 + 20 = 533 MB | launcher 74, bridge 86, preflight 55–73, proxy 60 | Round 3 Q2 |
| S3 OMP leg | ≤ 1 concurrent OMP preflight process, with 5 simultaneous hosts and with the starter killed; in-host waiter cost ≤ 5 MB per host (not counted as kit footprint) | 5 preflights | Round 3 Q2 |
| S3 kit footprint, Windows | **≤ 600 MB of commit**; if the Windows baseline exceeds 600 MB, the ≥ 30 % rule applies to that leg too | first windows-latest run | Round 3 Q1, Q9 |
| S3 macOS | RSS gate recorded as "unverified — owner action" | — | Round 3 Q1 |
| S3 on Node 24 | the S3 total is not claimed (the memory job runs Node 26) | — | Round 3 Q2 |
| S5 MCP bridge | growth ≤ 5 %/1k; per-process peak ≤ 150 MB; reboot cost of history ≤ 20 MB; 0 task failures; within budget with the semi-space flag and lazy HTTP | 86 → 97–100 MB over 400 tasks | loop, Round 3 Q2 |
| S6 TUI | log pane ≤ 16 MB of heap with 64 KB lines (pane cap 2,000 lines and 8 MB); resize storm ≤ 8 MB; no frame-time regression from the width core | +125 MB | ADR-0009, loop |
| S7 disk | `proxy.log` ≤ 6 MB while running, proven with kit readers and appenders open; `proxy.early.log` ≤ 1 MB + bounded overshoot; responses store heap at its cap ≤ 96 MB | 6.37 MB, no rotation | Round 2 Q4, Round 3 Q5, loop |
| Health thresholds | proxy soft 512 MB / hard 1024 MB memory footprint, 3 samples 15 s apart | 1536 / 3072 MB RSS at 60 s | ADR-0008 |
| ≥ 30 % peak rule | wherever the baseline peak exceeded its budget (S1 burst, S2, S3, S6), the peak improves by ≥ 30 % | — | §9 |

**PROCESSES**
- Exactly 1 proxy per installation under 10 concurrent launches, with 0 failed launches, including a killed holder.
- 0 stale locks after a race round or after Ctrl-C during start (baseline 5 of 8). The proxy is up after a respawn that met a stale lock.
- A takeover race test (N contenders, a kill injected at every protocol step) shows never two holders and never a deleted live lock.
- 0 orphans or leaked workers after stop, restart, crash and update (S4, 50 cycles). Log-dir files ≤ 8.
- 0 solver processes after the proxy is SIGKILLed, on Linux and on Windows (Job Object). An idle exit leaves 0 solver processes and releases the cap container. At most 1 solver process per proxy at every sample.
- No restart storm under induced memory pressure: ≤ 3 restarts per 15 min and exactly 1 proxy at every sample. A late respawn acknowledgement leaves exactly 1 proxy. Solver restarts after abnormal exits are ≤ 5 per 10 min, then fail-fast.
- The respawn wait (30 s) is greater than the acknowledgement wait (10 s) + `STOP_GRACE_MS` (10 s) + `STOP_EXIT_MARGIN_MS`. The manager force point comes after the proxy's deadline.

**BOUNDS**
Every cache, store and buffer in §7 and §8 has an enforced max size and/or TTL, each covered by a test, including the admission queue (count and 15 s), the byte cap and the solver queue (caller-side bound stated with evidence and pinned by a seam 3 test, or a count bound with ADR-0004 shed).

**COMPATIBILITY**
- All pre-existing tests pass unchanged, or each change is justified in its ticket.
- Old state and configs migrate automatically, and each migration is idempotent and tested twice: v0 locks, the rotator decision, adapter refreshes, bridge flags, retention pruning.
- Exit codes (0, 1, 2, 3, 4, 5, 20, 130) and `--json` fields form a documented superset. A JSON baseline of key names and value types is captured once from the pre-change code and committed, and new enum values are listed as additive.
- The manager CLI contracts, the OMP exit-code mapping, the respawn arguments and the golden-path classifier keep working, and an old proxy works with a new manager.

**UX**
- Every command follows design-language.md as bound by ADR-0001 (the spec wins over the prototype renders).
- Every command is covered by snapshot tests in every C3 variant (TTY colour at 80 and 120, NO_COLOR, pipe, TERM=dumb, CI, ascii tier, wgl4 tier), on both OS legs.
- Every error has what/why/next.
- The off-TTY doctor grammar has a regex test.
- The proxy TUI shows health, per-process RSS and key hints.

**CURRENCY**
- Dependencies are on the §12 targets, or the stay-back is documented (MCP SDK 2.x / protocol revision).
- The Node floor, the Bun pin, the CI actions, the installer bootstrap and the docs are consistent.
- The harness adapters match the current harness config formats for the HIGH and confirmed MEDIUM items.

**CI**
- Green on ubuntu and windows, including the memory-budget job (with an empty expected-RED list) and the snapshot suite.
- The proxy typecheck runs pinned.
- CI fails if the snapshot update switch is set.

**DOCS**
Updated per C8 and §16, with the release notes drafted.

**PR**
Open, /pr-shaped and not merged.

**Phase 6 verification gate (PROMPT §7)**
- `npm run test:all` is green.
- The MCP `tsc` build is clean, and the regenerated `dist/` is committed.
- `bun build --compile` succeeds for all five targets.
- The pack build, the payload verifier, the golden-path script and the installer tests pass.
- The long-profile memory loop gives a before/after table for S1–S7 with every budget met.
- The 10-launch process-count test passes.
- The complete before/after CLI snapshot diff is reviewed against design-language.md.
- GitHub Actions is green on both legs.

**Build-time gates (Round 3 "Shared understanding").** These are settled by measurement during the build or by an owner action. A gate that fails comes back as a question with numbers.
1. **S3 Linux:** ≤ 596 MB as a summed-RSS sample maximum on Node 26, plus per-role peaks within the targets above. The in-host waiter costs ≤ 5 MB per host. There is ≤ 1 concurrent OMP preflight process, including the killed-starter case.
2. **S3 Windows:** ≤ 600 MB of commit against the Windows baseline (≥ 30 % rule if that baseline exceeds 600). If it misses, the lever choice (lean resident launcher or Bun bridge) comes back with numbers.
3. **Windows baseline:** the Bun 1.4.2 reference run and the 1.4.4 attribution run are recorded before any memory fix. Any scenario RED only on commit goes back to the owner.
4. **Solver:** A1 (does a real vendor-SDK solve fit under 300 MB; owner action), and a cold start ≤ 5 % of the 90 s deadline.
5. **windows-latest proofs:** `proxy.log` rotation with kit readers and appenders open; the graceful stop flush through `/__kit/stop`; the PowerShell 5.1 stderr gate; Job Object reaping after the proxy is SIGKILLed.
6. **Bridge flags:** S5 within budget and `test:mcp` green with `--max-semi-space-size=1` and lazy HTTP.
7. **Proxy typecheck baseline:** any failures become tickets.
8. **Owner actions:** macOS execve and macOS footprint; A2 and real conhost/PowerShell 5.1 rendering; the optional live smoke.

## Testing Decisions

**What makes a good test here.**
- A test checks external behaviour at the highest seam that can observe it: process counts and memory at the process level; an HTTP status and error shape at the loopback listener; a check row at the rendered text; exit codes at the command's return value or the spawned CLI. It does not assert on private state, call order or internal helper names.
- Tests use the isolated installation only: temp HOME and state dir, a port ≥ 18457, the mock upstream and fixture credentials. They never touch the installed kit, real harness configs or secrets (B2, B3).
- Timing and clocks are injected wherever the seam allows (`createManager` timings, the supervisor sampler, the bounded collection's clock). Real time is used only where the property is about real time (the takeover race, rotation under open handles).
- Every memory and process fix starts with a scenario or test that is RED on the upgraded runtime and turns GREEN. Its expected-RED entry is deleted in the same ticket.
- Snapshots render from records with forced capabilities, so every C3 variant is deterministic on both OS legs without a pty. Snapshot files are compared as bytes, ANSI included, and are exempt from line-ending conversion in git attributes. Normalisation uses an explicit list (paths, ports, PIDs, times, versions) and never masks status words, exit codes or the check grammar. Updating snapshots needs `UPDATE_SNAPSHOTS=1`, which fails in CI.
- JSON tests assert a superset of baseline key names **and** value types, against a baseline captured once from the pre-change code.
- New test files are wired into a test script, and the wiring guard checks it.

**Seams.** These are the fewest that cover the spec. Each is the highest point that can observe its properties, and existing seams are reused wherever possible. The list is mirrored in `seams.md` for the Owner Proxy.

1. **Memory loop (process level). Exists, extended.**
   - **Covers:**
     - S1–S7 budgets, per-role peaks, process counts, orphans and the expected-RED ratchet;
     - the solver process-level claims (Round 4 Q1 add. 2; ADR-0002 cond 2, Round 3 Q10 cond 2): **0 solver processes after the proxy is SIGKILLed**, **an idle exit leaves 0 solver processes** (and releases the cap container), and **≤ 1 solver process per proxy at every sample**, asserted by the S2/S4 orphan checks; on the windows leg the proof is Job Object reaping;
     - the S3 OMP stub-host leg, which also asserts that **each waiter host printed the starter's `cause=` lines** whenever the starter's preflight emitted any, with 5 hosts and in the killed-starter case (Round 4 Q1 add. 4).
   - **Prior art (test suites unless stated):** the loop on the `diagnosis/memory` branch (scenarios, sampler, verdict) and its pinned RED-rule tests.
   - **New:** the Windows sampler adapter with its units and orphan self-tests, the `commit_kb` column, role budgets for S3 part (b), the OMP stub-host leg, and the expected-RED schema.
2. **Lifecycle module interface (`createManager` with injected process table and timings, plus the manager CLI spawned). Exists.**
   - **Covers:**
     - the lock protocol: the takeover race with a kill injected at every step, v0 locks, old-manager interop, unreadable locks;
     - signal release, orphan adoption and the force paths;
     - the stop request's fallbacks and shared deadlines;
     - respawn acknowledgement, refusal, late ack and clock jump;
     - manager-side log rotation under the lock, and file modes;
     - `proxy logs N` reading across `proxy.log.1` and `proxy.log`, and the golden-path classifier reading the tail-copy marker (Round 4 Q1 add. 5);
     - the per-spawn env at the spawned proxy: the token in the proxy's environment equals `proxy.pid`, two consecutive spawns get different tokens (Round 4 Q4);
     - the frozen CLI exit codes 0–5.
   - **Prior art (test suites unless stated):** `manager-safety`, `manager-audit` (respawn budget, hung proof, PID reuse), the golden-path verification script.
3. **Solver dispatcher interface (`configureCaptchaSolver({ backendModule })` + stats, with fixture backends), now with a transport choice. Exists, extended.**
   - **Covers:**
     - the child-process and thread adapters behind the same interface: byte-identical solve inputs and outputs, the cap handshake, the ordering logic of one solver generation at a time, recycle triggers (footprint 80 %, count 100, idle, deadline), abnormal-exit counting and fail-fast with `Retry-After`;
     - the solver queue's caller-side bound (one in-flight solve per pool), or its count bound and shed if one has to be added;
     - env parity and stripping, spawn from source vs compiled. The process-level reaping claims (SIGKILL, idle exit, ≤ 1 per proxy) belong to seam 1, because a dispatcher-level test cannot SIGKILL its own test runner;
     - egress routing for `captchaFetch` and the sync-XHR path;
     - the CDN memory and stall bounds inside a generation.
   - **Prior art (test suites unless stated):** the captcha-solver suite with its solver-backend fixture, `captcha-cdn-cache`, `captcha-happy`.
4. **Proxy over its loopback listener (an isolated proxy against the mock upstream, plus `/health` details). Exists.**
   - **Covers:**
     - admission: the byte cap, queued bodies left unread, the FIFO bounds, the 503 + `Retry-After` shed in each endpoint's error shape, never 429;
     - `/__kit/stop`: auth order, the stop token, 404 without a token, 202, the admission bypass, the listener staying open during the drain;
     - the observability fields as an additive JSON superset;
     - the log writer: rotation, the early log's cap and tail copy, foreign handles;
     - the supervisor through the drain behaviour.
   - **Prior art (test suites unless stated):** `server`, `protocol-contract`, `handler-resilience`; `health-monitor` and `watchdog` (injected sampler, `watchdogStep`, `spawnFn`) for the supervisor's thresholds at module level.
5. **CLI command records → output module with forced capabilities, plus a few CLI spawn tests. New snapshot suite on top of existing spawn tests.**
   - **Covers:**
     - every command in every C3 variant;
     - the off-TTY check grammar regex `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` (separator ` — ` byte-for-byte in every glyph tier, whitespace-indented `why:`/`next:` lines), `WARN`, the verdict and lead lines;
     - what/why/next, help, the connection details and the reveal rules;
     - exit codes asserted on `{ exitCode, records }`;
     - stream routing and exit codes through real spawns;
     - **the `process.execve` handover (Round 4 Q1 add. 1),** spawning `zcode-kit run` against a fake harness executable on POSIX: with Node ≥ 26.1 the harness runs under the launcher's pid (no launcher resident); on Node < 26.1, with `ZCODE_KIT_RESIDENT_LAUNCHER=1`, or with a non-executable target the launcher stays resident; a missing harness still gives `run: …` and exit 2; stderr carries no `ExperimentalWarning`; the `ready.detail` line and the `heal.log` write happen before the handover; a harness killed by SIGTERM reports 143; exit codes 0, 7 and 130 are unchanged. The windows-latest leg asserts the resident path with signal and exit-code forwarding as today;
     - the JSON key/type superset;
     - the PowerShell 5.1 stderr gate on windows-latest.
   - **Prior art (test suites unless stated):** `cli-kit`, `cli-audit`, `setup-regressions`, the connection-details suite (reveal rules), and the BEFORE capture script and snapshots from Phase 1C, which provide the pre-change baseline.
6. **Pure shared modules (width core and token set under Node and Bun, the TUI frame renderer and log pane, the bounded collection). Exists, extended.**
   - **Covers:**
     - width vectors (CJK, emoji, VS16, RI, the ASCII fast path) run identically under both runtimes;
     - TUI frames per tier and size (the header box, the process strip, the 80/100-column layouts, the 60×16 minimum, the TERM=dumb refusal, NO_COLOR markers);
     - the log-pane line and byte caps;
     - bounded-collection eviction with a fake clock.
   - **Prior art (test suites unless stated):** `width`, `frame`, `log-pane`, the responses-store suite.
7. **MCP bridge through the MCP client and the fake harness. Exists.**
   - **Covers:**
     - task retention (500 / 7 days, non-terminal kept, result files pruned, restore loads only retained);
     - not-found and idempotency after eviction;
     - per-task caps and the 4 MiB head+tail truncation during ingestion, with `completeness`/`truncated`;
     - old cached results served unchanged;
     - lazy HTTP with the HTTP mode unchanged;
     - `test:mcp` with the semi-space flag.
   - **Prior art (test suites unless stated):** the bridge's integration MCP client and fake-harness fixture, `bridge`, `lifecycle-audit`, `security-audit` (completeness assertions), `store-audit`.
8. **Installer and adapter temp-HOME fixtures. Exists.**
   - **Covers:**
     - the Node floor refusing before mutation, v22 rejected;
     - the Bun 1.4.4 hashes;
     - the adapter HIGH and confirmed MEDIUM fixes, byte-idempotent;
     - the bridge flag in the generated MCP entries;
     - the OMP extension's generated in-host token logic, and its waiter cause-line record logic (write before release, identity match, stale/corrupt/oversized records rejected, fixed-vocabulary validation; Round 4 Q2);
     - the preflight check of the OMP autostart's pinned Node path against the floor (Round 1 Q14 cond 2);
     - the per-spawn environment rules (Round 4 Q4): `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN` are set by the manager and overwrite ambient bogus values, and the stop token is absent from the respawn hook's environment;
     - the rotator decision migration;
     - every migration replayed twice through the transaction.
   - **Prior art (test suites unless stated):** `installer-audit`, `installer`, `adapter-audit`, `omp-audit`, `transaction-audit`, `account-setup`, the proxy-env suite (the per-spawn overwrite of `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN`, and the allowlist for the new `ZCODE_PROXY_*` config overrides).
9. **Repository guards. New, small.**
   - **Covers:** the test-script wiring guard; the expected-RED schema (unknown scenario, missing ticket file) and the ratchet; CI refusing `UPDATE_SNAPSHOTS`; `verify-payload` requiring the shared output files.
   - **Prior art (test suites unless stated):** `release-audit`, `state-audit`, the pack payload verifier.

Windows-only proofs run inside seams 1, 2, 3, 4, 5 and 8 on the windows-latest leg, not as a separate seam: `proxy.log` rename with readers, the stop-request flush, Job Object reaping after the proxy is SIGKILLed (seam 1), the resident launcher's signal and exit-code forwarding (seam 5) and the PowerShell 5.1 stderr gate.

## Out of Scope

- **Anything that changes how anti-abuse code behaves (B1).** This covers solve pass rates, client fingerprints, rotation strategies and quota or rate-limit workarounds. Inside the captcha, signing, identity, trace-header, session-context and rotator modules, only lifecycle, isolation, bounds, error handling, observability, UX and tests change.
- Dropping either happy-dom loading flag. It needs a live solve (owner action).
- **MCP SDK 2.x and protocol revision 2026-07-28.** They become a `needs-triage` ticket.
- **An MCP runtime restart budget** (architecture candidate 8). It becomes a `needs-triage` ticket, because S5 never exercised runtime restarts.
- **Observing response streams in the client's path instead of `tee()`** (architecture candidate 6). Decided "do nothing": the burst peak was attributed to body copies, and stalled readers retained 6 MB.
- A default concurrency limit on upstream streams.
- **Windows footprint levers** (the lean resident launcher, the MCP bridge on Bun). They are decided later, with numbers, and only if Windows misses its gate.
- **OpenCode V2 schema migration, and the adapter items marked UNVERIFIED.** Low-severity adapter drift is also out, apart from refreshing re-verified versions and dates; the decision covers only the HIGH items and the confirmed MEDIUM items.
- An installation-wide process count in `/health` (rejected in favour of proxy-owned processes).
- A Bun minimum-version check for an already-installed Bun, a Windows aarch64 Bun bootstrap, and npm 12 for publishing. These were raised in the drift audit but not decided.
- Prewarming the solver.
- Version bumps, tags, releases, merging into `main`, npm publishing, and any change to the installed kit, running proxies or global harness configs (B3, B6).

## Further Notes

- **ADR alignment and flagged deviations:**
  - **ADR-0001 rule 2** ("box chrome only in the TUI header card and the log-pane card") is narrowed by Round 2 Q9 cond 3: the header is the only box, and the log pane gets an unboxed title line. The Owner Proxy ruled that this narrows an upper bound and does not contradict it. ADR-0001 records this in its Round 2 amendment.
  - **ADR-0004's open consequence** (how a shed reaches connected clients) is settled by ADR-0008 cond 2 and Round 2 Q2 cond 1.
  - **ADR-0002 cond 7** ("no new retry policy") is kept: the solver restart budget limits process restarts and never resubmits a solve (Round 2 Q2 cond 2).
  - **ADR-0003** supersedes the AUD-001 "no automatic takeover" comments and the matching README and SECURITY lines. They are updated with the implementation.
  - **The upgrade-before-fix ordering** deviates from PROMPT §7 Phase 3 principle 4. It is justified by Round 1 Q15/Q16 and recorded per Round 2 Q15 cond 2.
  - **The `memory-budget` CI job landing in step 1** (with the loop and the expected-RED list) is a second deviation, from PROMPT §7 Phase 3 principle 8. It is justified by Round 2 Q14 cond 1 and Round 3 Q9 cond 1 and was required by Round 4 Q5 D2. Both deviations are recorded in RUNLOG and in ADR-0016.
- **ADRs in force for this spec:** 0001–0016 (0016 records the two work-order deviations). The later ones cover the health supervisor and respawn handoff (0008), bounded stores and task retention (0009), the observability contract (0010), the output topology (0011), the lock protocol version and stored-state migrations (0012), the launcher handover with in-host single-flight (0013), the graceful stop request (0014) and the respawn acknowledgement (0015). Tickets link the ADR that governs them.
- **Choices the rounds delegated to the spec, confirmed in Round 4:**
  - the waiter cause-line channel (§6 a: a result record next to the autostart token), accepted with conditions (Round 4 Q2; ADR-0013 amendment);
  - the names of the two new env vars: `ZCODE_KIT_RESIDENT_LAUNCHER=1` for the launcher opt-out (Round 4 Q3: a public variable, a one-way door once released; ADR-0013 amendment), and `ZCODE_KIT_LOG_DIR` for the log dir in the proxy env (Round 4 Q4: an internal variable set by the manager at every spawn; ADR-0015 and ADR-0014 amendments).
- **Owner actions** (recorded in OWNER-ACTIONS.md with copy-paste commands; each related criterion is marked "unverified — owner action"):
  - **A1:** measure a live vendor-SDK solve against the 300 MB cap. If it does not fit, that is a new owner question; the ceiling is not loosened.
  - **A2:** Windows worker termination and the Ctrl-C stale lock on PowerShell 5.1/7, conhost and Windows Terminal, plus real conhost rendering and an `install.ps1` run.
  - **macOS:** terminals, execve and the S3 footprint.
  - **Live smoke (optional):** one "Reply with ok" request with glm-5.3-flash, read-only on the owner's login.
- **Hazards for implementers:**
  - Never stop, restart or reconfigure the installed kit or any proxy this run did not start (port 8457).
  - Every soak runs under a hard memory cap and a timeout, tagged `ZCODE_OVERHAUL_RUN=1`.
  - The MCP bridge's committed `dist/` is only ever regenerated by the build (B5).
- **Evidence pointers:**
  - `diagnosis/memory-report.md` (RC1–RC8, RC-L);
  - `diagnosis/footprint-facts.md` (Plan P/W arithmetic);
  - `diagnosis/round3-facts.md`;
  - `METRICS.md`;
  - `reports/architecture.md` (candidates 1–5, 7);
  - `reports/drift.md`;
  - `ux/ux-audit.md` (A-01–A-27), `ux/design-language.md`, `ux/handoff-prototype.md` (prototype `prototype/terminal-ux` @ d27b890);
  - `research/*.md`.
- **Round 4 corrections applied (2026-11-06, DECISIONS.md Round 4):**
  - **D1:** §10 binding rule, Story 90, Story 106 and the seam 5 regex: off a TTY the separator ` — ` stays byte-for-byte in every glyph tier, the detail is optional (`( — <detail>)?`), and the ascii copy mapping never touches the separator or the verdict words.
  - **D2:** §0 step 1 now includes the `memory-budget` CI job on ubuntu and windows with the expected-RED list; step 8 is only the remaining guardrails; §1 Baselines and §12 CI layout updated; recorded as a second PROMPT §7 deviation (RUNLOG + ADR-0016).
  - **D3:** §4 "allowlisted in `proxyEnv`" replaced for both variables by the manager's per-spawn overwrite, the fresh token equal to `proxy.pid`, and stripping from the respawn hook; §2 lists the hook among environments without the token; Story 56 updated.
  - **D4:** §8 file-mode rule moved to its own bullet binding every creator (manager, proxy writer on open/reopen, watchdog by-path append, early log, OMP extension) and every log-dir file incl. the autostart token and its result record.
  - **D5:** §7 truncation docs now describe the 4 MiB cap (1 MiB head + 3 MiB tail), the marker, the `truncated` field and the idempotency window; `docs/MCP_API.md` added to §16 scope; "MCP task text capped at 4 MiB with a head/tail marker" added to the release notes list.
  - **D6:** Solution bullet and Story 29 qualified: ≤ 596 MB on Node ≥ 26.1 (launcher handover), not claimed on Node 24, macOS unverified (owner action).
  - **D7:** §7 gains a "Solver queue" row (bounded by its callers, evidence + seam 3 test; count bound and ADR-0004 shed only if needed); §2 failure semantics and §18 BOUNDS aligned.
  - **D8:** "early-output file" replaced by "early log (`proxy.early.log`)" in §8, §16 and seam 4.
  - **D9:** §18 S1 steady-state source corrected to memory-report §6 (tightening §9 with Phase 1 evidence), loop.
  - **D10:** Further Notes: ADR-0001 already records the Round 2 Q9 narrowing in its amendment.
  - **D11:** Testing Decisions and `seams.md` updated with the Q1 additions below.
  - **Q1:** seam 5 gains the execve handover spawn tests; seam 1 owns the solver process-level claims (SIGKILL reaping, idle exit, ≤ 1 per proxy; Job Object on windows) while seam 3 keeps one-generation ordering logic; seam 8 gains the pinned-Node-path preflight check, the waiter cause-line record logic and the per-spawn env rules; seam 1's S3 OMP leg asserts waiter cause lines (5 hosts and killed starter); seam 2 gains `proxy logs N` across both files and the tail-copy marker.
  - **Q2:** §6 (a) cause-line channel rewritten with the six binding conditions (write before release, per-attempt identity, no record = starter failure with takeover, bounded validated content, one file in the S4 budget, old extensions ignore it); ADR-0013 amended.
  - **Q4:** `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN` set by the manager at every spawn, overwriting inherited values; token stripped from the respawn hook; `ZCODE_KIT_LOG_DIR` internal (TUI/standalone keep today's behaviour); four env tests; ADR-0014 and ADR-0015 amended.
  - **Q3 (for completeness):** §6 (d) opt-out `ZCODE_KIT_RESIDENT_LAUNCHER` takes exactly `"1"`, has no effect on Windows, is documented in `--help`, README × 5 and the release notes, and is read nowhere else; ADR-0013 amended.
