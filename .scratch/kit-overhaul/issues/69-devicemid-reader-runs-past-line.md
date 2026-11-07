# 69: `ensureDeviceMidInConfig` reads past the end of an empty unquoted `deviceMid:` line

**Blocked by:** 68 (Every writer of proxy/config.yaml and harness configs keeps the file's line endings (CRLF audit))

**Status:** needs-triage

Model: sol
Risk: high
ADR: no

**What to build:** Found by ticket 68's audit (not fixed there). In the proxy, the reader in `ensureDeviceMidInConfig` can run past the end of its line: for an empty unquoted `deviceMid:` it takes the next line's text (e.g. `appVersion: "3.8.1`) as the device ID it then sends. The kit template writes `deviceMid: ""` and is not affected; a hand-edited or third-party-tool config can be. This touches identity code (B1: anti-abuse behaviour must not change). Triage question for the Owner Proxy: is fixing the parse (an empty value is treated as empty, as the quoted form already is) a correctness/error-handling fix inside B1's IN-SCOPE list, or a behaviour change that stays out? If in scope: the fix must make the empty-unquoted case behave exactly like the existing empty-quoted case, with a test per form, and change nothing else in identity handling.

**Acceptance criteria:**

- [ ] Triage decision recorded (B1 scope).
- [ ] If accepted: RED test reproducing the misread, fix, tests for quoted/unquoted/empty/missing forms; no other identity behaviour changes.

## Comments
