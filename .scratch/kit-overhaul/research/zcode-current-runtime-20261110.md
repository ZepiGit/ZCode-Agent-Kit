# Current official ZCode runtime: pinned source and discovery counterexample

Date: 2026-11-10. Scope: ticket82's latest-ZCode runtime/distribution acceptance criterion. Controller-collected evidence only; no background research agent was dispatched because the requested GLM provider's availability remains unconfirmed. This is not an independent model review, a product fix or live inference proof. Workflow658f0456 stays stopped and unchanged.

## Versions and provenance

The live GitHub release API returned latest tag **v3.17.2**, published **2026-11-04T10:41:06Z**, target commit `a9fe401eede6e6e5e01be9048679c206fe6f02d9`:

- https://github.com/zai-org/ZCode/releases/tag/v3.17.2
- https://api.github.com/repos/zai-org/ZCode/releases/latest

The release body separately states build source `e6b675b40abb79e1d38d98d4e8750d0859cfedd9`. Do not conflate that build-source string with the public target commit. Listed assets from this API response are SHA256SUMS and macOS/Windows desktop installers/archives; no Linux server asset is in that list. The local server manifest is separate evidence, not proof that a Linux asset was published on this desktop release page.

At public commit a9fe401, `apps/zcode-cli/package.json` is blob `e6e751b31812a534727b7eef8ef074c3a06ee98a`: package `zcode-cli`, version **0.17.1**, engines.node **24.14.0**. App3.17.2 and agent package0.17.1 are different version domains. This engines declaration is not proof of the minimum compatible Node patch or a reason to change kit identity.appVersion.

Source: https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/apps/zcode-cli/package.json

Local read-only release manifest at `/home/laptop/.zcode/server/releases/3.17.2-linux-x64-88a41b337faa/manifest.json` names product zcode-server, appVersion3.17.2, targetlinux-x64, nodeVersion22.16.0, and agent entrypoint runtime/zcode.cjs. Only this distribution metadata and runtime package.json were read; no installed runtime was executed or changed, and no account/credential state was read. The bundled Node metadata and repository engines declaration describe different contexts; do not claim runtime-floor compatibility from either alone.

External metadata archives under `/home/AgentKit/overhaul-tools/`:

- zcode-latest-release-20261110.json
- zcode-pinned-root-tree-20261110.json
- zcode-pinned-layout-source-index-20261110.json (recursive source tree, truncated=false)
- zcode-pinned-cli-package-source-20261110.json (public base64 source; decoded as data only)

## Official installed layouts

Pinned source, not guessed filenames:

1. `runtime/manifest.ts` creates agent entrypoint `runtime/zcode.cjs` and declares six server targets. https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/zcode-server-cli/src/runtime/manifest.ts
2. `runtime/paths.ts` sets serverRoot to `(ZCODE_DATA_BASE_DIR || homedir())/.zcode/server`, releasesDir to serverRoot/releases and currentFile to serverRoot/current.json. https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/zcode-server-cli/src/runtime/paths.ts
3. `contracts.ts` defines releaseDir/version and optional releaseId/appVersion/target/nodeVersion. https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/zcode-server-cli/src/contracts.ts
4. `ReleaseManager.readCurrentForExecution()` validates the current release, including canonical containment inside releasesDir and directory existence. A future kit-discovery change must not turn arbitrary pointer contents into permission to execute an out-of-root bundle. https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/zcode-server-cli/src/runtime/releaseManager.ts
5. The pinned README separately documents standalone CLI installation at ~/.zcode/runtime, command shim ~/.local/bin/zcode, and ZCODE_DIST_HOME/ZCODE_DIST_BIN_DIR overrides. This is not the server releases layout and its internal agent-bundle placement was not yet mapped or fixture-tested here. https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/README.en.md

## Existing kit behavior and ownership

Clean ticket82 candidate `883f566bf7a6e24f6faa96580ad1653955782498`:

- `mcp/zcode-harness-mcp/src/discovery.ts:34-44`: seven legacy Windows desktop candidates only, derived from LOCALAPPDATA/ProgramFiles/ProgramFiles(x86), resources/glm/zcode.cjs and app.resources/glm/zcode.cjs. It does not consume the official server current.json or ZCODE_DATA_BASE_DIR.
- `discovery.ts:102-122`: an explicit runtime path is authoritative and missing/failed paths fail closed. Preserve this behavior; a new default search must not silently replace a broken explicit override.
- `runtime/spawn.ts:63-82`: actual process execution is fixed node with argument arrays, shell=false. No installed vendor process was launched by this investigation.
- `src/index.ts:43-55,61-75`: discovery failure produces an honest degraded bridge. `zcode_health` exposes this via `src/mcp/tools.ts:142-161`. That public MCP boundary is the probe oracle.

Existing ticket13 owns dependency upgrades;36 owns lazy HTTP/semi-space;57 owns restart budgeting;56 owns SDK/protocol migration;53 owns dependent documentation. None of those inspected ticket scopes implements new server/standalone discovery. Ticket82 already explicitly owns verifying runtime/distribution paths and mapping uncovered safe fixes. The server-layout finding stays an unresolved82 scope item; no new implementation/architecture approval is inferred and no numbered ticket is invented without triage.

## Executed public-boundary reproduction

External probe `/home/AgentKit/overhaul-tools/t82-zcode-discovery-boundary-probe-20261110.mjs`, final SHA256 `f5a5b36c4ad204ce4a93be1df92eb8ba692b15119d5cd08c656514094bf0038c`.

Seam7 from seams.md: the real bridge process, MCP initialize and `zcode_health`, via the existing integration client. Each case gets a separate temp HOME, USERPROFILE/APPDATA/LOCALAPPDATA/ProgramFiles/temp/XDG paths and unrelated bridge data directory. Only a version-only synthetic zcode.cjs is executable; it refuses every invocation except --version. Fake app3.17.2 manifests use the pinned official server shape; the fixture answers agent version0.17.1. No model turn or real vendor process runs. No source/dist file was edited.

```sh
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-zcode-discovery-boundary-repeat-red-20261110 1G 90 -- node /home/AgentKit/overhaul-tools/t82-zcode-discovery-boundary-probe-20261110.mjs
```

First run name t82-zcode-discovery-boundary-red-20261110. It already executed the same5cases/3PASS/2FAIL. The final probe then removed a red-only diagnostic assertion so a future correct discovery can turn the test GREEN; second run repeated the same semantic result without product edits. First probe hash bdc7696091de74d34f75d45019108be87e0a773e7bb9871a3ab05aa08bf9277c; final hash above. Both runs Nodev26.7.0, cap1G/no-swap, timeout90s, EXIT1/duration2s.

| Case | Result | Public MCP health evidence |
|---|---|---|
| Legacy desktop layout |PASS|degraded=false, expected harness selected, version0.17.1, exactly one version probe|
| Current server release under default HOME |FAIL|degraded=true, no-default-candidate, zero version probes|
| Same server release with explicit runtime path |PASS|degraded=false, expected harness selected, version0.17.1, exactly one version probe|
| Current server release under ZCODE_DATA_BASE_DIR |FAIL|degraded=true, no-default-candidate, zero version probes|
| Missing explicit override |PASS|degraded=true with missing-file diagnosis, zero version probes, no fallback|

This distinguishes a missing discovery candidate from a version-probe failure: the same fixture works with an explicit override. No claim is made that this fixture proves official app-server protocol, native module or model compatibility.

Logs, under integration `.scratch/kit-overhaul/reports/`:

- t82-zcode-discovery-boundary-red-20261110.log, SHA25616c71705c58edb8cb006b484a3e88f26cfc980dc41cf9609d83b7ecae1ca71b6
- t82-zcode-discovery-boundary-repeat-red-20261110.log, SHA25688b4d0d66e4ba8fc75696813f0fefe30e05e0b75387d42f838633b35416d56f3

Both summary lines report5executed/3PASS/2FAIL/0unexpectedErrors, five owned bridge processes and two version probes, with PID/PPID/PGID evidence. Every owned child exited; fixture root removed. Product and generated dist remain clean. This was run on Linux only, not native Windows/macOS.

## Remaining work, not acceptance

- Scope and independently review an additive discovery change for supported current distributions. Keep explicit overrides authoritative and retain verified --version selection, argument-array spawning and pointer containment; define malformed/missing current metadata and multiple-installed-distribution precedence before implementation.
- Add permanent wired seam7 fixtures; regenerate MCP dist by build only; full suites and fresh native Windows/Linux CI required. Do not copy this Linux-only PID-check helper as portable test code.
- Map the standalone ~/.zcode/runtime layout and Windows/macOS desktop layouts at pinned source; do not imply they were covered by the five-case server fixture.
- Verify actual official runtime app-server/protocol behavior only through an authorized isolated safe test. No model call, credential read, challenge bypass or identity imitation is permitted.
- Original GitHub#32 incident causality/recovery, metadata/provenance repairs, full TUI classification proof and overall overhaul acceptance remain open. GLM quota/reset remain unknown; the stopped workflow was not resumed/amended/restarted.
