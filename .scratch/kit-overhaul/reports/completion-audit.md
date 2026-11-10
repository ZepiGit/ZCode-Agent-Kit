# Completion audit — Kit overhaul

Status: **INCOMPLETE**. This is a requirements-to-evidence index, not proof that the goal is complete. Final verification must inspect actual final-branch artifacts and commands, not this checklist alone.

## Concrete deliverables

Implement every accepted overhaul story/ticket; satisfy memory/process/compatibility/terminal requirements; complete independent Standards/Spec review and adversarial verification; run the final acceptance commands and long-profile measurements; update canonical English docs and translations; push a review-ready, unmerged PR against main; complete retro and reviewed environment improvement ticket; deliver the German final report. GitHub issue32 safe diagnostics and newest official ZCode compatibility are additional requirements tracked in local ticket82. Security B1-B6 and current requested-model workflow routing remain binding.

Individual numbered stories: [story-evidence-map.md](story-evidence-map.md) maps all 144 stories to ticket files and current statuses. All final-evidence cells remain pending audit; no missing ticket reference was found, which does not establish implementation or acceptance.

## Added onboarding requirement — not achieved

Ticket83 tracks the user's requested English-first coherent post-install onboarding, Space-toggle harness multiselect and useful command overview, collaboratively designed by the four named models with unavailable participants disclosed. It depends on40/42/43;40and43 remain unmerged. Four briefs exist, but the supposedly agreed artifact was inspected2026-11-10 and contains[object Object], not a design. New proposed-file recovery, actual model ratification, consent/cancel/nonTTY/stderr preservation, terminalC3/Windowsproof and installer overview dedup in44 are still required. No claim of consensus or implementation completion from the existing artifact/ticket comment is valid.

## Prompt-to-artifact checklist

| Requirement | Required evidence | Current evidence / gap |
|---|---|---|
| PROMPT §§0,9 stability priority | Ranked root causes and before/after MB contributions | diagnosis/memory-report.md and METRICS.md exist; final values not audited |
| Phase0 infrastructure | Isolated worktrees, sentinel, capped runs, baseline, untouched owner state | RUNLOG and tools; final isolation/process audit pending |
| Phase1A research | Dated primary-source reports for Node/Bun/dependencies/MCP/TS/actions/adapters/terminal conventions | research/ and reports/drift.md; currency must be rechecked at final verification |
| Phase1B executable memory loop | S1-S7, all variants and OS budget/process/orphan measurements | tests/memory exists; expected-RED entries remain, long-profile acceptance incomplete |
| Phase1C terminal audit/prototypes | BEFORE captures, audit, design language, variant choice/handoff | ux/ and DECISIONS; final AFTER coverage and review missing |
| Phase1D architecture | HTML/Markdown report and accepted candidates | reports/architecture.md + external HTML pointer in RUNLOG; final candidate implementation coverage pending |
| Phase1E drift | Engines, runtime/CI/install/docs, dependency and adapter evidence | drift reports exist; final alignment incomplete |
| Phase2 shared understanding | Charter decisions, glossary, relevant ADRs, closed frontier | DECISIONS/GLOSSARY/docs/adr exist; rounds after34 must be tracked;35 transcribed e0c9062 |
| Phase3 spec/task graph | spec.md, seams.md, individual ticket files/blockers/status/evidence | issues/ exists; INDEX status cells stale; use ticket files |
| Phase4 implementation | Every accepted ticket resolved with RED/GREEN or preservation mutant evidence, full fast suites, CI-only gates before merge | Many unresolved tickets. Built23/27/40/57/80 are not all merged. No claim of Phase4 completion |
| Merge discipline | Fresh merger, sanity diffs, full suite, memory after relevant merges, revert-on-RED | MERGER-BRIEF and RUNLOG; final audit must inspect each remaining merge |
| B1 anti-abuse unchanged | Diff review of captcha/signing/identity/session/rotator/claim behavior; only allowed lifecycle/errors/observability changes | Phase5 required; ticket20 protocol-byte pins not sufficient alone. Ticket82 cannot authorize challenge bypass/identity imitation |
| B2-B4 secrets/environment/process safety | Synthetic fixtures, no secret artifacts, no installed config changes, owned PID/identity checks | Ongoing boundaries; final publication-range/secret audit missing |
| B5 generated dist | Actual MCP build and zero uncommitted generated diff, committed output | Per-ticket evidence exists; final build/tree check pending |
| B6 no release | No version bump/tag/main merge/release workflow/npm publication/ALLOW_PUBLISH changes | Final git/PR/workflow audit pending |
| Phase5 Standards review | /code-review full publication range vs main, Grok xhigh, concrete findings/fixes | Not run for final integration tree |
| Phase5 Spec review | Independent model/context, actual accepted spec and decisions | Not run for final integration tree |
| Phase5 red team | Starts/signals, terminal variants, migrations/corruption, foreign ports, storms, hung solver, aborts; confirmed failures become tests | Not complete; max3 fix/review loops recorded |
| Phase6 full suites | npm run test:all, counts/skips and exact SHA | Final integration run missing; ticket40 first full gate exit127 was missing MCP tsc, not acceptance |
| Phase6 MCP build | tsc clean, regenerated dist committed | Final-tree run missing |
| Phase6 five compiled targets | Every target in zcode-proxy-src/package.json actually builds | Final-tree run missing |
| Phase6 package/golden/installers | pack/build.mjs, pack/verify-payload.mjs, scripts/verify-golden-path.mjs, installer suites | Final-tree run missing |
| Phase6 memory | Long profile before/after per S1-S7; all amended budgets met, >=30% improvements where required | Missing; no expected-RED green ratchet may substitute |
| Phase6 process counts | Ten concurrent launches => one proxy, zero orphans after stop | Partial short-profile evidence; final-tree explicit evidence missing |
| Phase6 snapshots | Complete ux/before vs ux/after, all commands/C3 variants, reviewed against design language | Incomplete; refreshed fixtures are not a substitute for preserved original BEFORE evidence |
| Phase6 both-OS CI | Exact final integration SHA green on ubuntu/windows, memory/snapshot/typecheck coverage inspected | Not complete |
| Phase6 optional live smoke | Only if safely possible without secrets/installed instance; otherwise owner commands + unverified label | No live inference claim. Owner action needed if omitted |
| Phase7 docs C8 | README md/de/es/ja/zh-CN, harness READMEs, SECURITY translations, SUPPORT_MATRIX, EFFORT_MAPPING affected parity | Tickets52-54 and preceding UX/runtime work incomplete |
| Phase7 release notes | English docs/RELEASE_NOTES_vNEXT.md with numbers, upgrade notes, deprecations; invoke changelog-generator first | Not drafted here. Skill availability must be resolved; unknown/public repository counts public |
| Phase7 PR | /pr format, small visual, before/after, door/blast radius; ready against main, not merged | PR13 exists as draft; not ready/final |
| Phase8 retro | /retro in session; mechanical checks, judgment standards, remaining tracker/owner actions | Not run |
| Phase8 environment ticket | Cheap improvements implemented, diff independently reviewed, pushed | Not done |
| §10 German final | reports/final.md and user report: five-line summary, causes/MB, table,3screens,versions,decisions/ADRs,unverified/actions,PR/followups | Missing |
| GitHub issue32 | Exact safe-scope regression/recovery evidence, separate local82; no static/models/doctor proxy completion | Incident cause/recovery unverified. Source https://github.com/ZepiGit/ZCode-Agent-Kit/issues/32 |
| Latest ZCode | Primary-source pinned release/runtime/distribution evidence, actual compatibility tests, recheck latest at final gate | Release v3.17.2 verified2026-11-09; https://github.com/zai-org/ZCode/releases/tag/v3.17.2 . Node24 already addressed; broader runtime/discovery gaps not yet verified/fixed |
| Current model routing | GLM max preferred workers/scouts; independent Grok-build-fast xhigh/Sol-subagent xhigh reviews; named4modelUXcooperation with unavailable participants disclosed | User-managed current workflow658f0456 has GLM max default and GUIdefault/noexplicitconcurrencylimit; do not restart/amend. Old run IDs and earlier model attribution are historical, not current compliance |

## Current evidence additions, 2026-11-09

- Ticket23 pre-merge CI42634889797:8/8SUCCESS, candidate0badcae. Artifacts /home/AgentKit/overhaul-tools/t23-ci-yUPAQx/. Windows pressure:3restarts, <=1proxy,40/40serving after refusal,0furtherhooks,1errorline,0orphans. Existing expected-RED ratchet still contains other owners. Merged as a413614, resolved282557f: fresh local fast suites and proxytypecheck passed, dist unchanged, staged/wholeproduct sanitydiffs empty. Merger reused exactpremerge memory evidence under explicit ask permission; no freshpostmerge memoryrun.
- Ticket80 attempt1 CI42635373819: both measurement legsSUCCESS, marker guards intentionallyFAIL. Artifacts /home/AgentKit/overhaul-tools/t80-attempt1-X4kZ0t/. Windows8/8valid each arm, head mean54.13/pre29 51.38MB, difference2.75,t0.76. Linux8/8each, difference-1.75,t-1.18. These are insufficient for >=30Windows/>=10Linux per arm; no attribution verdict. Attempt2 launched via rerun, order reverses. Source commit03e20a6/tree50fdff58; reports identify CI merge commit d619ad8. GitHub commit API confirms parents542749b/03e20a6 and tree50fdff58b751d4c6f894fd84f80e8133ef2d1d78, exactly matching the staged tree. The report field named tree actually contains a commit SHA; preserve this distinction when pooling.

## Evidence corrections, 2026-11-10

- Ticket81 PR76/run42691497644 is FAILURE7/8 with WindowsCreateProcess123/harnessfailure; no merge occurred. Earlier8/8statusclaims invalid.
- Ticket82 PR77 exacte22c921 verified8namedCIjobsSUCCESS; independent security review still required, latest-runtime/incident acceptance remains incomplete.
- Ticket43: prior PR79runs42725722962/42739064329 remainFAILED. Corrected stagedcandidate02bd817/run42750466098 is VERIFIED8/8SUCCESSatmatchinghead,includingactualWindows24/26logtests,fullWindowsUX1/1andbothcompleteholdingmemoryratchets. Productbranch1f9e26c and staging areclean. Independentreviewandticket40prerequisiteOPEN;nointegrationmerge or full-goalcompletion. Evidencegatefile t43-ci42750466098-verified-gates.json, artifacts t43-ci42750466098-artifacts-yvHJAP. SeeMETRICSTicket43section.
- Ticket83 purported agreedartifact is[object Object], not design;4briefs only, recoveryandratificationpending. No consensus/multiselectimplementationclaim.
- Ticket57 Round38 permits prospectiveoptinartifactsfromREDdiagnosticrun; currentgateunchanged, not evidenceblockedbyRED. Windowsrunner/completemanifestunverified.
- Ticket40 PR75runrecordFAILUREbutemptyrollup/jobsandok=truememorysummarynotreconciled; exactfailurestep/provenancemissing. No proof from emptymetadata.
- Ticket80 final32/armnot-attributedstatisticalrule result is not proof of no effect; decisionreturn stillneeded. No budgetrelaxation/stage2fixautomaticallyauthorized.

## Final audit rule

Before any completion claim, replace every gap with final-SHA evidence or an explicitly permitted owner-only exception. Inspect what each verifier actually covers. Retain failed/invalid attempts and unresolved uncertainty. Never mark the objective complete from this index, a plan, cumulative effort, a green ratchet with exceptions, or one successful test suite.
