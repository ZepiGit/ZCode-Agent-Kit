# 80: windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution

**Status:** ready-for-agent
**Blocked by:** none

Model: sol
Risk: medium
ADR: no

**What to build:** Owner Proxy round 31 Q1. Post-merge run 42553765178 (984b45d) was RED on windows S2/short cdn-cache:memory-growth 65 MB commit (WS 62; budget 64), unowned. By tree contents, windows values are 25-only n 26 mean 52.88 sd 6.00 max 62 and 25+29 n 39 mean 56.44 sd 5.26 max 65 (Welch t 2.45), bimodal on both trees (low ~47.6 / 49.8, high ~59.1 / 59.8; high share 46 % -> 67 %, Fisher p 0.13). Ticket 29 is the only change on S2's measured path but is not proven to be the cause. Stage 1 (pre-registered): an off-by-default test-loop marker (never merged) runs full S2/short with phase D on head's CaptchaCdnCache or on the verbatim pre-29 cache zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts, everything else identical; >= 30 runs per arm on windows (ABAB in one job, BABA in the next) and >= 10 per arm on linux; record commit and WS at D-start/D-end, the mode (<= 54 / > 54) and whether the pruner's 60 s rescan ran in phase D. Verdict: attributed if windows commit mean(head) - mean(pre-29) >= 2.0 MB with Welch t >= 2.5; not attributed if < 1.0 MB or t < 1.5; otherwise inconclusive and it comes back. Stage 2 only if attributed: remove the cost inside 29's code as resource lifecycle (B1 IN SCOPE); captcha-cdn-disk-prune.test.ts, captcha-cdn-disk-replay.test.ts and ticket 25's seam-3 replay pass unchanged (same prune decisions, fetches, bytes, sha256, fetchedAt). Never change the 64 MB budget, the 32 MiB body budget, 256 entries, the 256 MiB disk cap, the age rule, the S2 workload or the metric. Exit: >= 10 GREEN windows S2/short runs on the fix tree and the A/B on the fix tree < 1.0 MB. Attributed with no lever inside those limits, not attributed, or inconclusive: comes back to an Owner Proxy round with all values. A merge on S2's path (for example 58) during the runs restarts the count. This ticket owns no name and lists nothing; it records every signature (ix) occurrence (run id, commit, WS, linux value), starting with 42553765178.

**Acceptance criteria:**
- [ ] Stage 1 A/B recorded with all per-run values and the verdict under the pre-registered rule.
- [ ] Stage 2 (only if attributed): fix with the three replay/prune suites unchanged and green, then the exit evidence above.
- [ ] METRICS table: per arm, per leg, per run.

## Comments

### 2026-11-09 — first CI attribution attempt launched

Stage-1 tooling 5febef6 staged with integration354305b on staging/80m. Measurement commit03e20a6a30476f5ab8052a9bb73a16fe64bd96a5, tree50fdff58b751d4c6f894fd84f80e8133ef2d1d78, marker tests/memory/measure-cdn content8. Draft PR https://github.com/ZepiGit/ZCode-Agent-Kit/pull/74; run42635373819. One attempt is not the >=30-per-arm Windows dataset; four complete valid attempts are required, with alternating order and unchanged measured path. Marker guard test failures are intentional and never approval. Never merge the marker. The measurement tree does not contain ticket27, so it cannot silently settle ticket27's changed host/child attribution question. No CI verdict or pooled result is recorded yet.
