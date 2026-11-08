# Owner Proxy round 23 — answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–22 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-23.md`.
- Issues 56, 30, 31, 36, 53 and 57 in full, and `issues/INDEX.md`. Ticket 13 shows `Status: resolved`. `git show --stat f383d6b` shows the merge "ticket 13: MCP dependencies (SDK 1.32.2, zod 4.6, TypeScript 7.0.2, @types/node 24)", which touched `KNOWN_LIMITATIONS.md` (+24 lines).
- `research/mcp-sdk.md` (2026-11-06) in full.
- On the integration branch `overhaul/stability-terminal-ux` (tip f322df8):
  - `mcp/zcode-harness-mcp/package.json` has `"@modelcontextprotocol/sdk": "^1.32.2"`, `"zod": "^4.6.6"` and `engines.node >=24`.
  - `bun.lock:20`: SDK 1.32.2 already pulls in `express`, `hono`, `@hono/node-server`, `cors`, `jose`, `express-rate-limit` and more.
  - `docs/KNOWN_LIMITATIONS.md` §6 says SDK 1.x `^1.32.2`, at most `2025-11-25`, a deliberate stay-back, and a deadline of "at least until 2027-01-27". It also says "Overhaul-Ticket 56, `needs-triage`".
  - `src/mcp/server.ts`: `:41-44` declares `tools: { listChanged: false }`, `resources: { subscribe: false }` and `logging: {}`. `:99` returns `-32002`. `:278-293` is the stateless JSON-mode transport per request. Its `res.on("close")` is still attached after `handleRequest`, and the error path closes nothing.
  - `src/mcp/resources.ts:33-35`: the bridge's "tasks" are its own tool and resource objects (`zcode://tasks/...`), not the MCP protocol's experimental Tasks.
  - `grep`: the only docs that name the SDK or 2025-11-25 are `MANIFEST.md`, `MANIFEST.de.md`, `mcp/zcode-harness-mcp/docs/PROTOCOL.md` and `KNOWN_LIMITATIONS.md`. README × 5, SECURITY and SUPPORT_MATRIX do not.
- `docs/agents/triage-labels.md`. `DECISIONS.md` Round 1 Q15/Q16 and Round 12 Q1. `spec.md:34, 129 (story), 523-525, 677, 808`. `PROMPT.md` C5, §5 B1–B6 and the CURRENCY DoD (`:571-572`).
- `STATE.md:4` lists 30 as "Ready" and t36 as running. The round says 30 is "in progress". This does not affect the answer.

Primary sources (checked 2026-11-08, Parallel web_search/web_fetch, session 7f3c9a2e-5b41-4d8e-9c6a-1e2f3a4b5c6d):
- npm registry `@modelcontextprotocol/server`: `dist-tags.latest = 2.4.0`. Release times: 2.0.0 2026-07-27T23:55Z, 2.1.0 09-23, 2.2.0 09-28, 2.3.0 10-02, 2.3.1 10-05, 2.4.0 2026-10-23T18:20Z. Pre-releases (alpha/beta) ran 2026-04 to 2026-07-21, and the stable line has had 5 releases since. https://registry.npmjs.org/@modelcontextprotocol/server
- npm registry `@modelcontextprotocol/sdk`: `dist-tags.latest = 1.32.2`. https://registry.npmjs.org/@modelcontextprotocol/sdk
- GitHub releases: v2.4.0 is marked "Latest" (2026-10-23 18:32Z), with server/client/core/server-legacy/codemod 2.4.0 and node 2.1.2. 1.32.2 was released 2026-10-23 18:06Z. There is no release after 2026-10-23. https://github.com/modelcontextprotocol/typescript-sdk/releases, https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0, https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.2
- v1.x README: "Support for the 2026-07-28 spec is not planned for v1.x: it is in v2, the current stable release, which … continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)". https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md and https://ts.sdk.modelcontextprotocol.io/
- ROADMAP (main): "v2.0.0 is the stable release line (main)"; "2026-07-28 spec revision board — implemented in v2.0.0 (released 2026-07-27, alongside the spec)"; "v1.x … at least six months after the v2 release (2026-07-27). It targets the 2025-11-25 spec revision; new spec revisions are implemented on main only." https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md
- `support-2026-07-28.md`: "Nothing in v2 puts a 2026-07-28 byte on the wire by default". `createMcpHandler(factory)` with the default `legacy: 'stateless'` serves both eras, and "a v1 stateless `StreamableHTTPServerTransport` hosting … maps directly onto the default entry". `serveStdio(factory)` serves both eras unless `legacy: 'reject'`. When serving 2026-07-28, the cache fields default to `ttlMs: 0` and `cacheScope: 'private'`. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- MCP spec changelog 2026-07-28 ("changes … since the previous revision, 2025-11-25"): sessions removed, `initialize` removed, `server/discover` MUST be implemented, `subscriptions/listen`, a required `resultType`, and renumbered error codes. https://modelcontextprotocol.io/specification/2026-07-28/changelog
- The spec versioning page came back only as a cache from 2026-06-04, which still names 2025-11-25 as "current". That is older than the 2026-07-28 release. Its GitHub source path returned 404. https://modelcontextprotocol.io/specification/versioning

**Facts the round asked for.**
1. **Is 2.x stable now? Yes.** It is the npm `latest` tag, GitHub "Latest", and named "the current stable release" by the v1.x README and "the stable release line" by the ROADMAP. 2.0.0 is 104 days old, and 2.4.0 is the fifth stable release.
2. **What is 2027-01-27? A guaranteed minimum, not an announced end-of-support date.** The SDK promises 1.x fixes "for at least six months after the v2 release (2026-07-27)". **EVIDENCE MISSING: a published v1.x end-of-support date.** No primary source names one (README, ROADMAP and releases checked). After 2027-01-27, 1.x fixes are no longer guaranteed. `research/mcp-sdk.md` and `KNOWN_LIMITATIONS.md` §6 both say "at least" and are correct. Ticket 56's "support horizon … (2027-01-27)" should say "guaranteed floor".
3. **Protocol revision.** 2026-07-28 is a published revision. The SDK implemented it in 2.0.0, "alongside the spec". 1.x will never support it. **EVIDENCE MISSING (not decision-relevant): a live copy of the spec versioning page's "current" marker.** The only copy obtained predates 2026-07-28. The decision does not depend on it, because C5 asks for the latest revision that passes the suite, and 2026-07-28 is published and implemented in the stable SDK.

---

## Q1 — Ticket 56: role, label, edges

**DECISION:** ACCEPTED with conditions. The recommendation's "2.x is stable" branch applies. Its edges are accepted, and the ticket is rewritten as two staged tracer bullets with pre-registered gates and a fallback. No edge is cut. The ticket is not yet fully specified as written: its only criterion is "Owner decides go/no-go". This decision makes the go call and fixes the criteria, so an AFK agent never makes the owner's call.

- **Triage role / label:** `ready-for-agent` (`Status: ready-for-agent`). Model **sol**, Risk **high**, **ADR: yes**, a new ADR (next free number, 0017 on the current tree): "MCP SDK 2.x and dual-era serving (2025-11-25 + 2026-07-28)".
- **Spec amendment.** Spec §Out of Scope (`spec.md:808`), "MCP SDK 2.x and protocol revision 2026-07-28. They become a `needs-triage` ticket.", becomes "MCP SDK 2.x and protocol revision 2026-07-28: triaged in Round 23 as ticket 56 (in scope, staged; the stay-back stays documented until it lands)." This follows the Round 12 precedent for 57. It does not contradict Round 1 Q16: Q16 sent 2.x to a `needs-triage` ticket, and this is that triage.
- **Binding conditions.** They go into the ticket's Acceptance, exact text below.
  1. **Stage A: package swap on the 2025-era wire.** Replace `@modelcontextprotocol/sdk` with `@modelcontextprotocol/server`, using the latest stable 2.x when implemented and ≥ 2.4.0. Add `@modelcontextprotocol/node` (≥ 2.1.2) only if the HTTP path needs it. `zod` stays `^4.6.6`, which meets the 2.x minimum of 4.2. Both lockfiles are regenerated (bun.lock, package-lock.json), and versions are re-verified on npm on the day.
     - The bridge still answers `initialize` and negotiates at most 2025-11-25.
     - Every existing raw-JSON-RPC test and example passes unedited, the 2025-06-18 clients included. A test edit that touches a wire assertion comes back as a question (C2).
     - 36's lazy HTTP import survives: stdio mode loads no HTTP adapter.
     - On whatever code path lands, the per-request server and transport are closed on every path, the error path included. A seam 7 test closes the response before `handleRequest` returns. Today's `server.ts:285-293` attaches the listener late and the error path closes nothing.
     - The transitive package count and install size are recorded before and after (C4). If the tree grows, the ticket comes back with the numbers.
     - `dist/` is regenerated by the build (B5).
  2. **Stage B: serve 2026-07-28 additively.** Only after stage A is GREEN.
     - HTTP goes through `createMcpHandler(factory)` with `legacy: 'stateless'`. It builds a fresh server per request and never shares an instance (typescript-sdk #2607).
     - The bridge's own Host, Bearer and Origin checks, `MAX_IN_FLIGHT = 16` and the bounded body pre-read still run before the SDK sees a request. GET and DELETE still get 405. Loopback-only is unchanged (C6).
     - stdio goes through `serveStdio(factory)`, accepts 2025 openings and keeps the stdin-end shutdown.
     - 2025-era output (capabilities, results, the `-32002` resource error) is byte-identical to stage A: recorded 2025-06-18 and 2025-11-25 transcripts are replayed. 2026-era behaviour follows the spec (`server/discover`, `resultType`, `-32602`, SDK default cache fields `ttlMs: 0` / `cacheScope: 'private'`).
     - No capability is added. `tools.listChanged: false` and `resources.subscribe: false` stay. Any long-lived stream the SDK keeps open is capped and closed on stop (C1).
     - Seam 7 adds a 2026-07-28 client, raw JSON-RPC like the existing tests and with no new devDependency, on HTTP and on stdio: discover, `tools/list`, `tools/call`, and `resources/read` on a task resource.
  3. **Memory gates (both stages; values, not verdicts).**
     - Per leg, ≥ 5 fresh `memory-budget` runs on the ticket's tree record these values next to the base tip's: S3 bridge-role peak (`procPeak:mcp-bridge`), S5 `growth:mcp-bridge`, S5 bridge peak and task failures, and 57's `S5/restart` numbers.
     - Every run must stay within the existing budgets. A listed expected-RED name (37 holds the `procPeak:mcp-bridge` names; S5/short is listed under 30 if still listed) does not cover a change in the value.
     - If the 5-run median of any bridge value rises by more than 10 % over the base, the ticket comes back with the numbers. It is not auto-failed and not auto-accepted.
     - **No expected-RED entry is added by 56**, so 55 needs no edge to 56.
  4. **Fallback (pre-registered).** If stage B misses any gate, stage A lands alone, and `KNOWN_LIMITATIONS.md` §6 says "SDK 2.x; protocol 2025-11-25 stay-back" with the measured reason. Stage B then comes back to the Owner Proxy with its numbers. Stage B never lands without stage A. If stage A misses a gate, the ticket comes back with numbers. Edge 53 ← 56 is then cut, and 53 documents today's stay-back unchanged.
  5. **Docs (C8).**
     - 56 itself rewrites `mcp/zcode-harness-mcp/docs/KNOWN_LIMITATIONS.md` §6 and `docs/PROTOCOL.md` to say what landed. 13 established that the package docs are owned by the code change.
     - 53 updates `MANIFEST.md`/`MANIFEST.de.md` (they name the v1 package), the five bridge READMEs ("stay-back note" or its replacement), `docs/MCP_API.md` and SUPPORT_MATRIX. 54 carries the change into the release notes through 54 ← 53.
     - Until 56 merges, §6's "needs-triage" wording is stale. It is corrected by 56's rewrite, not by a separate product-file edit now.
  6. **Re-check tripwire.** The orchestrator re-reads the v1.x README and ROADMAP at each merge of 30, 31, 36 and 57, and again on 2027-01-27. The question comes back to the owner with dates if any of these happens:
     - (a) the SDK announces a v1.x end-of-support date before 56 can land;
     - (b) a v1.x security advisory that affects the bridge is published without a 1.x fix;
     - (c) 56 is not merged by 2027-01-27.
- **Edges.**
  - **56 ← 30, 31, 36, 57 accepted** (13 stays listed, resolved).
    - 36 edits `server.ts:11` and `index.ts:16` (the lazy HTTP import), which is the same block stage A replaces.
    - 31 edits the tool descriptions, the result shape (`truncated`) and `dist/`, all served through `server.ts`.
    - 57 edits `index.ts` (the crash handler) and `runtime/manager.ts`.
    - 30 shares `s5-mcp.mjs` and the S5 bridge measurements, the same separation reason as 57 ← 30 in Round 12.
    - These are same-file edges (Round 5 Q2) plus measurement separation, so the swap lands on the final bridge code and its numbers are not mixed with four tickets' changes. 57 ← 30, 36 and 31 ← 30 already exist, so 30 and 36 are also transitive. They stay listed for clarity.
  - **53 ← 56 accepted.**
  - **No edge 55 ← 56** (condition 3). **No edge 56 ← 37:** no file overlap; condition 3 covers the shared `procPeak:mcp-bridge` names. **No edge 52 ← 56:** README × 5 do not name the SDK (grep).
  - **Acyclic, checked mechanically** (DFS over every INDEX row plus the two new edges).
    - 56 had no dependents. Its ancestors are 30, 31, 36, 57, 13 ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04, and 01.
    - Its only descendants are 53 and then 54. Neither is an ancestor of 30, 31, 36 or 57, so no cycle forms.

**Rationale:**
- The round made its recommendation conditional on a primary-source fact, and the fact holds: 2.x is the stable line. C5 names "@modelcontextprotocol/sdk and MCP protocol revision" explicitly. The ROADMAP says new revisions land on main only, so staying on 1.x means staying off every future revision, and 1.x fixes are guaranteed only to a floor date with no end date announced.
- The documented stay-back meets the run's DoD today (`PROMPT.md:571-572`). It was a deferral, not a verdict: Round 1 Q16 condition 2 justified it by cost ("an architectural step") and by the 1.x window. Neither argues against moving now that the window's end is in sight.
- The cost is small. One file imports the SDK, and the v2 stateless entry "maps directly" onto the bridge's current hosting. 1.32.2 already pulls in express and hono, so the swap may well shrink the tree, and condition 1 measures it instead of assuming it.
- The risk is real. The bridge's memory budgets are the run's hardest gates, a new major can move them, and v2-only defects were open on 2026-11-06 (#3148, #3097, #3036). That is why:
  - the ticket sits behind the four open MCP tickets;
  - its gates compare measured values, not listed verdicts;
  - the protocol adoption (the one-way part: once `server/discover` advertises 2026-07-28, withdrawing it is a deprecation under C2) is a separate stage with a fallback to a smaller, reversible stage A.
- The edges put 56 at the end of the MCP chain and in front of 53 → 54, the run's tail. The pre-registered fallback and the edge cut in condition 4 keep a stalled 56 from holding the release notes hostage. The tripwire keeps the 2027-01-27 floor from passing in silence.

**Charter:** C5 (SDK and protocol revision currency), C1 (memory gates, a per-request factory, capped streams, no added long-lived state), C2 (2025-era wire byte-identical; additive 2026 era; deprecation announced, never silent), C4 (footprint measured; no new framework), C6 (loopback, bearer, Host/Origin checks ahead of the SDK; no new endpoint), C8 (docs split between 56 and 53), C9 (stronger evidence first: primary sources; then the smaller blast radius: stage A before B, with a fallback). Also Round 1 Q16 (the triage it deferred to), Round 5 Q2 (same-file edges), Round 12 Q1 (56 to be ordered against 57; the spec amendment precedent), B5 (`dist/` by build), B6 (no kit version bump; dependency versions only).

**REVERSIBILITY:**
- Stage A is a two-way door: one dependency swap in one file, reverted by a revert commit.
- Stage B is one-way once released: a served protocol revision can only be withdrawn through an announced deprecation.
- **ADR: yes** (new ADR, next free number, 0017 on the current tree).

### Exact text changes

**`issues/56-mcp-sdk-2-migration.md`.** Replace everything from `**Blocked by:**` through the end of the `**Acceptance criteria:**` list (up to `**Common acceptance (every ticket):**`) with:

```
**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 30 (MCP task retention (500 / 7 days) and the idempotency window), 31 (Per-task caps and 4 MiB head/tail truncation of task text), 36 (MCP bridge: lazy HTTP transport and `--max-semi-space-size=1` in generated entries), 57 (MCP runtime restart budget)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0017 (MCP SDK 2.x and dual-era serving; next free number)

**What to build:** Move the bridge off SDK 1.x (whose fixes are guaranteed only until at least 2027-01-27; no end date announced) onto the stable SDK 2.x line, in two stages (Round 23 Q1). Stage A swaps the packages and keeps the 2025-era wire byte-identical. Stage B then serves protocol revision 2026-07-28 in addition, on HTTP (`createMcpHandler`, `legacy: 'stateless'`, a fresh server per request) and on stdio (`serveStdio`), behind the bridge's existing Host/Bearer/Origin checks and in-flight cap. If stage B misses a gate, stage A lands alone with a documented protocol stay-back.

**Acceptance criteria:**

- [ ] Stage A: `@modelcontextprotocol/sdk` replaced by `@modelcontextprotocol/server` (latest stable 2.x, ≥ 2.4.0, re-verified on npm on the day) and, only if the HTTP path needs it, `@modelcontextprotocol/node` (≥ 2.1.2); `zod` stays `^4.6.6`; bun.lock and package-lock.json regenerated; `dist/` regenerated by the build (B5).
- [ ] Stage A, wire: the bridge still answers `initialize` and negotiates at most 2025-11-25; every existing raw-JSON-RPC test and example (2025-06-18 clients included) passes unedited. A test edit touching a wire assertion comes back as a question.
- [ ] Stage A: stdio mode loads no HTTP adapter (36's lazy import, its seam 7 test unchanged); the per-request server and transport are closed on every path including errors, pinned by a seam 7 test that closes the response before `handleRequest` returns.
- [ ] Stage A: transitive package count and install size recorded before/after; a larger tree comes back with the numbers (C4).
- [ ] Stage B (only after stage A is GREEN): 2025-06-18 and 2025-11-25 transcripts recorded on stage A replay byte-identical (capabilities, results, `-32002`); a 2026-07-28 raw-JSON-RPC client on HTTP and on stdio passes `server/discover`, `tools/list`, `tools/call` and `resources/read` on a task resource, with `-32602` for an unknown resource; no capability is added (`tools.listChanged: false`, `resources.subscribe: false`); any long-lived stream is capped and closed on stop; GET/DELETE stay 405; Host/Bearer/Origin checks, `MAX_IN_FLIGHT` and the bounded body pre-read still run before the SDK.
- [ ] Memory, each stage, values not verdicts: ≥ 5 fresh `memory-budget` runs per leg record S3 `procPeak:mcp-bridge`, S5 `growth:mcp-bridge`, S5 bridge peak and task failures, and `S5/restart`, next to the base tip's values. Every run is within the existing budgets whether or not a name is listed. A 5-run median rising > 10 % over the base on any bridge value comes back with the numbers. 56 adds no expected-RED entry.
- [ ] Fallback: if stage B misses a gate, stage A lands alone and stage B comes back with numbers. If stage A misses a gate, the ticket comes back and edge 53 ← 56 is cut.
- [ ] Docs: `mcp/zcode-harness-mcp/docs/KNOWN_LIMITATIONS.md` §6 and `docs/PROTOCOL.md` state what landed (SDK 2.x; dual-era serving, or the 2025-11-25 stay-back with its measured reason). MANIFEST, bridge READMEs × 5, `docs/MCP_API.md` and SUPPORT_MATRIX are 53's scope.
```

`Spec stories: none (follow-up to 129)` stays as it is: story 129, the stay-back on record, holds until 56 lands, and 56 changes no stored state, so story 135 does not apply. Add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 23, binding): triaged ready-for-agent. 2.x is the stable line (npm latest 2.4.0, 2026-10-23; 2.0.0 2026-07-27). 2027-01-27 is the guaranteed floor for 1.x fixes, not an announced end date. Edges 56 ← 30, 31, 36, 57 and 53 ← 56; acyclic. Tripwire: the orchestrator re-reads the v1.x README/ROADMAP at each merge of 30, 31, 36 and 57 and on 2027-01-27. The question comes back to the owner if a v1.x end date before 56 can land is announced, if an unfixed v1.x advisory affects the bridge, or if 56 is not merged by 2027-01-27.
```

**`issues/53-docs-security-harness-bridge-and-manifests.md`.** Append to the `**Blocked by:**` line: `, 56 (MCP SDK 2.x and protocol revision 2026-07-28 migration)`. In **What to build**, replace `The five MCP bridge READMEs at parity with the Node 24 floor and the stay-back note.` with `The five MCP bridge READMEs at parity with the Node 24 floor and with ticket 56's outcome (SDK 2.x and dual-era serving, or the remaining protocol stay-back); \`MANIFEST*\` names the SDK package that 56 ships.`

**`issues/INDEX.md`.**
- Row 56 becomes: `| 56 | [MCP SDK 2.x and protocol revision 2026-07-28 migration](56-mcp-sdk-2-migration.md) | sol | high | 13, 30, 31, 36, 57 | ready-for-agent |`
- Row 53's Blocked-by cell becomes: `11, 13, 16, 22, 31, 51, 58, 57, 56`

**`spec.md:808`.** Replace `- **MCP SDK 2.x and protocol revision 2026-07-28.** They become a \`needs-triage\` ticket.` with `- **MCP SDK 2.x and protocol revision 2026-07-28.** Triaged in Round 23 as ticket 56 (in scope, staged; the stay-back stays documented until it lands).`

---

## Shared understanding

Open branches I still see:
1. **Stage B's go/no-go is measured, not decided.** Whether 2026-07-28 is served in this run depends on condition 3's numbers. If it falls back, the protocol stay-back stays documented, and stage B comes back as its own owner question.
2. **Run-tail timing.** 56 now sits between the MCP chain (30 → 31, 36 → 57) and 53 → 54. If that chain is not done well before 2027-01-27, tripwire (c) brings the question back. The SDK has announced no end date, so the floor is not a hard stop.
3. **Side observation, not decided here.** `spec.md:809` still reads "An MCP runtime restart budget … becomes a `needs-triage` ticket". Round 12 Q1 condition 7 ordered it amended to "triaged in Round 12 as ticket 57", and the amendment is not on the tree (f322df8).
4. **EVIDENCE MISSING, carried:** (a) a published v1.x end-of-support date; none exists today. (b) A live copy of the spec versioning page's "current" marker; the only copy obtained (2026-06-04) predates 2026-07-28.
