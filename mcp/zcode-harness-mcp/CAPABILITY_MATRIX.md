# MCP Bridge capability overview
**English (original)** · [Deutsch](CAPABILITY_MATRIX.de.md)

This overview describes user-facing capabilities. The exact tool catalog can
change between releases.

| Area | Capability |
|---|---|
| Workspaces | Native 0.16.9 presentation only; no catalog, persistent defaults, or settings revision. Workspace setters/reset are unsupported without a fallback. |
| Sessions | Start or continue a session; select model, reasoning and mode through native session setters. Full catalog discovery creates and closes an owned deferred no-prompt session. |
| Tasks | Submit work, check progress, and cancel a running task. |
| User interactions | Return answers to questions or approval requests shown by the host. |
| Read-only use | Presentation reads remain available; full catalog discovery is blocked because session creation may initialize runtime services. This is not an operating-system sandbox. |
| Results | Review task status and returned results. |

Runtime preference updates affect the shared app-server process, not persistent
workspace defaults; native acknowledgement is not independent read-back. The
current native catalog includes verified `zai-api/GLM-5.3-Flash`, but native Flash
inference on Windows/ZCode 0.16.9 is blocked by upstream `1113` (insufficient
balance/resource package), after verified model/`low` selection. Proxy success
is separate; 0.16.5 evidence is historical.
Provider bootstrap changes only the child environment and preserves explicit overrides;
see [security](docs/SECURITY.md) for precedence and path resolution.

For stronger isolation, use a separate workspace with only the files an agent
needs.
