# 67: A plain expected-RED listing of a single-run key accepts any RED, not only its owner's checks

**Blocked by:** None

**Status:** needs-triage

Model: sol
Risk: medium
ADR: no

**What to build:** Raised in Owner Proxy round 13 (Shared understanding) and round 9 (condition 1 fixed it for repeated keys only). For a single-run key listed plainly (e.g. linux `S5/short → 30`, `S3/short → 37`), the ratchet accepts the run when its outcome is RED, whatever checks are RED. A new RED on a check the owner ticket does not own (an orphan, a second proxy, a ceiling) passes unnoticed. Triage: decide whether plain entries should name the checks they own (so any other RED fails), and how that interacts with entries whose RED set legitimately varies run to run.

**Acceptance criteria:**

- [ ] Triage decision recorded.

## Comments
