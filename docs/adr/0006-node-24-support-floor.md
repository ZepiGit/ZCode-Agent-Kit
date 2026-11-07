---
status: accepted
---

# Node.js support floor is 24

The kit supports Node.js 24 and later. Node 20 and 22 are no longer supported. Per nodejs/Release `schedule.json`, Node 20 has been end-of-life since 2026-04-30, Node 26 is Active LTS, and Node 22 ends on 2027-04-30. That leaves 22 about six months, less than a kit release cycle, at the cost of a third CI leg. No API the kit uses is removed between 20 and 26. Charter C5 requires raising the floor.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q14 (ACCEPTED with the binding conditions below).

## What the floor means

- `engines.node` is `>=24` in all three manifests.
- The installer gates (`install.sh`, `install.ps1`, `pack/build.mjs`) check for 24. The installer error names the exact upgrade step.
- CI runs {ubuntu, windows} × {Node 24, Node 26}. The release workflow runs on 26; the publish job's Node 24 requirement for OIDC stays satisfied.

## Binding conditions

1. `setup` and `update` running on Node < 24 refuse **before** they change any state, with what/why/next, and leave the existing install working.
2. The preflight reports when the OMP autostart's pinned absolute Node path is below the floor or missing.
3. The DEP0190 warning at `pack/build.mjs` is fixed.
4. The release notes announce that Node 20 and 22 are no longer supported.
5. README and its translations, and `SUPPORT_MATRIX.json`, state the new floor.

## Considered options

- **`>=22.12`:** keeps users on 22 until April 2027, but needs a third CI leg and another floor raise in about six months.
- **`>=26`:** turns away users on 24, which is supported until 2028-04-30 and already required by the publish job, with no technical benefit.

## Consequences

- A one-way door for users once released: an installation on Node 22 must upgrade Node before its next `setup` or `update`.
