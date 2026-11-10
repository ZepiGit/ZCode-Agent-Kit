# 43: UX batch (b1): compact `setup` report and `integrate --dry-run`

**Blocked by:** 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details), 42 (Account Rotator decision asked once, with migration)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001, 0005

**What to build:** `setup` prints a compact report by default (stages, one result row per assistant, the connection check, the connection details, the undo command); full output to `install.log` and to screen with `--verbose`/`ZCODE_KIT_VERBOSE=1`; every WARN/FAIL keeps what/why/next on screen; `--installer` still accepted; nothing printed today is lost. `integrate --dry-run` lists every file it would write and every registration with the undo command. The Codex adapter prints the POSIX launcher on POSIX. One banner, TTY progress via `step()`. Closes A-07, A-11 (setup), A-15, A-16, A-26.

**Acceptance criteria:**

- [ ] Snapshots in every C3 variant; `install.log` contains every line the old verbose output had (line-set comparison test).
- [ ] `setup-regressions` passes; dry-run lists match the files a real run writes (temp-HOME comparison).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 95, 97, 111, 115

## Comments

### 2026-11-10 — exact-head platform CI verified 8/8 GREEN, review still open

Run [42750466098](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42750466098), exact head `02bd817474978613d8449a499622041a0b5d9e57` (PR79), completed SUCCESS on all eight required named jobs: kit Ubuntu/Windows × Node24/26, UX Ubuntu/Windows, memory Ubuntu/Windows. Controller checked each job's name/status/conclusion and exact run/PR/local staging head rather than relying on watcher exit0 alone. Saved gate metadata `/home/AgentKit/overhaul-tools/t43-ci42750466098-verified-gates.json`.

Native Windows24/26 logs confirm BOTH the new narrow fixture-path normalization test and the full old-verbose install.log line-set test executed and passed. Each leg: kit988/1038 (50platform skips),proxy1649/1652 (3skips),MCP116/116 (0skips),zero failures; typecheck and MCPbuild stages passed. Windows UX's full pipe/ci byte comparison passed1/1, not a skip or baseline generation. Logs `t43-ci42750466098-windows24.log`, `windows26.log`, `windows-ux.log` under overhaul-tools.

Downloaded both memory artifact sets to `/home/AgentKit/overhaul-tools/t43-ci42750466098-artifacts-yvHJAP/`; each job-summary.json has `partial:false,ok:true,failures:[]`. Existing ownedREDs/Windowsunstable remain, so this is a holding ratchet, NOT final all-budget acceptance. Previous FAILED runs remain unchanged. Candidate product/staging worktrees are clean. No merge performed; ticket status remains ready-for-agent with independent review and unresolved ticket40 prerequisite. GLMworkflow658f0456 remains STOPPED1005, not resumed; no provider/billing/model change.

### 2026-11-10 — Windows fixture corrections and reviewed native snapshot refresh

CI42739064329/head2018c5dFAILED5/8:Windowskit24/26soleinstall-logcomparisonfailureonthreeknownfixturepathseparators;WindowsUX36intendedoutputdiffs. BothLinuxkitjobs/LinuxUXandBOTHmemoryjobsSUCCESS (archivedsummariesok=true/partial=false/failures=[]). Controlleraddedalways-runnableWindowsliteralnormalizationtestRED1fail/1passthenGREEN2pass,narrowlycanonicalizesONLYthreeexactfixturepathsuffixes,negativecontrolsretainwrongpath/filename/verb/unrelatedbackslashes. No productruntime/logsemantics or oldverbosefixture changed. NativeUXcapture193uniqueentries,zeroerrors/everyexitunchanged;all36nonvolatilechangesin10ticket43scenariosreviewedagainst942linediff/designlanguage,thenONLY36outputfiles(14newstderr)+20manifestrows+INDEXupdated. Comparator/volatile/static/unrelatedsnapshotsunchanged. Fullnativecaptureequivalenceafterrefreshzero;hashmanifest /home/AgentKit/overhaul-tools/t43-reviewed-windows-refresh-record-20261110.json.

FullcappedCI-likelocalnpmtest:all:kit1018/1038(skip20),proxy1651pass/1skip/0fail,proxytypecheckclean,MCPbuild115/116(skip1),EXIT0/278s;reports/t43-windows-fixture-fixes-full-20261110.log,distunchanged. Test/baselinecommit1f9e26c;existingstaging/43updatednewmerge02bd817474978613d8449a499622041a0b5d9e57 tree2947ffd0f965925d6ef323a27bcaf0b0616fbca3,wholeproductequalstestcandidate,clean. NonforcePR79pushstartedfreshCI42750466098RUNNINGmatchinghead02bd817;oldfailedrunsretained,immediateoldPRrollupnotmisreadasnewhead. Independentreview,newWindowsoutcomeand40prerequisiteremainOPEN;83notready;nointegration/mainmerge. Providerworkflow658f0456stillSTOPPED1005,nomodelcalls/resume/restart/amend/providerchange. Fullbrief /home/AgentKit/overhaul-tools/t43-second-ci-windows-followup-20261110.md.

### 2026-11-10 — exact tested repair preserved and new platform CI launched

Controller mechanically preserved the quota-interrupted, unchanged tested six-file patch as t43commit5aed942 after verifying its SHA2562385638c216df0e8d20993a9687c96118e645a94cf5e48c8fb5afcc3383a28ff and the completed fullCI-like local suite. No productcodechange or newtestlogic by controller; explanatorycandidateevidence is committed on that branch. t43 is CLEAN. Existingstaging/43updatedbynewmerge2018c5dc2ea60a66754dc09525647c3102fee4d6 (tree3f0f9d096acac7d38dc5385364df86c0f8641380), wholeproductidenticaltotestedticketbranch,clean. NonforcepushreusesdraftPR79andstartedfreshCI42739064329;all8jobsIN_PROGRESSwhenverified. Priorfailure42725722962remainsFAILED. This is newcandidatevalidation,notrerununtilgreenonunchangedtree. Independent review and nativeWindowsCIoutcome remainopen;40prerequisiteunmerged,83notready;nointegration/mainmerge. Agentworkflow658f0456stillSTOPPED1005;nomodelcalls/providerchanges/resume/amend/restart.

### 2026-11-10 — actual CI failure and reproducible PTY check

PR79/run42725722962 at staged99142f2 failed all four test-kit jobs (remaining jobs were still running when inspected). LinuxNode24log /home/AgentKit/overhaul-tools/t43-ci42725722962-linux24.log identifies4PTY failures in account-setup and harness-consent: legacy /OK {2}/ expectations versus intended glyph/aligned TTY output. Exact local reproduction from /home/AgentKit/wt/t43, through run-capped.sh t43-controller-ci-pty-red 3G300, with CI=true TERM=xterm-256color and node --test --test-name-pattern='rotator asked once|interactive setup asks per harness|setup --select: one numbered|Ctrl-C during the questions' tests/account-setup.test.mjs tests/harness-consent.test.mjs executed4tests/0pass/4fail/0skip, exit1. Log reports/t43-controller-ci-pty-red.log. This is a real regression check, not test discovery/infrastructure failure. A GLM workflow worker owns the repair; preserve stored consent/replay/MCP/abort/exit/stream assertions, justify any formatting-only expectation changes and do not weaken nonTTY contracts. Ticket40 is NOT merged;43's actual prerequisites still apply. No new CI rerun authorized from this record.

- 2026-11-07 (orchestrator, from ticket 42): the harness-prompt part of audit finding A-22 and moving prompts to stderr remain here (ticket 42 kept prompts on stdout).
