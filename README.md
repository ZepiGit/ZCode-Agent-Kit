# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/ZepiGit/ZCode-Agent-Kit)

**English** | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [sprich Deutsch du H******](README.de.md)

Model access from your own agent harness through **your ZCode Desktop
account** — no second subscription, no API purchases. Ten harness adapters,
one local proxy, transparent rollback.

```
your harness (OMP / pi / Claude Code / Codex / OpenCode / Cline / Kilo Code /
              Aider / Continue / Goose / any MCP or OpenAI-/Anthropic-capable client)
        │
        ├─► local zcode-proxy  http://127.0.0.1:8457   (OpenAI + Anthropic + Responses formats)
        │         └─► zcode.z.ai  (start-plan, same quota as your ZCode Desktop)
        │
        └─► zcode-harness-mcp (stdio)  ─► your installed ZCode Desktop (real desktop sessions)
```

Models: **glm-5.3** (text, 1M context) and **glm-5.3-flash** (text+image, 1M
context), verified reasoning efforts **low / high / max** (default max).

> **Working-tree note (2026-09-15):** Repair/recovery and postinstall changes below
> describe local source, not a verified published release. Final validation is pending;
> no repair of the user's existing personal installation is claimed.

## Quickstart

**Windows (PowerShell)**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux**:

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```


The one-liners fetch the installer from the **latest published release**; the
installer then resolves that release automatically (pin any version with
`ZCODE_KIT_VERSION`, e.g. `$env:ZCODE_KIT_VERSION = "v0.2.0"`). It downloads
the release archive, verifies its checksum, installs user-locally (default
`%LOCALAPPDATA%\zcode-agent-kit` or `~/.local/share/zcode-agent-kit`, override
with `ZCODE_KIT_HOME`), installs bun v1.4.2 user-locally if it is missing, and
runs setup with harness detection.

**npm / npx:**

```sh
npm install -g zcode-agent-kit
zcode-kit setup

# Or run the published CLI without a global install:
npx --yes zcode-agent-kit setup
```

The npm package exposes both `zcode-kit` and `zcode-agent-kit` commands. Its
postinstall only prints a setup hint; it does **not** install the runtime or
change harness configuration. Run `zcode-kit setup` explicitly. Re-running setup
is designed to be idempotent. npm requires **Node ≥ 20**; setup installs or
verifies the pinned bun dependencies.

> The npm artifact is published per release by the maintainer. If `npm install`
> reports 404, this version is not on the npm registry (yet) — use the
> installers above, or install a local build: `npm install -g <repo>/pack/dist`.

## First run, in order

1. **Install** (commands above). Setup detects your harnesses and wires only
   those. Recorded configuration edits can be rolled back; credentials and
   dependency installation are not covered (see below).
2. **One login**: have the ZCode Desktop app installed and logged in; setup
   imports that credential automatically (otherwise it prints the exact
   one-time login command to run).
3. **Check**: `node cli\zcode-kit.mjs status` (proxy running? quota?) and
   `node cli\zcode-kit.mjs doctor` (full diagnostics).
4. **Use it** — see *Usage per harness* below. The proxy starts on demand:
   OMP auto-starts it through its extension, and the kit wrappers
   (`bin\zcode-claude`, `bin\zcode-codex`, `bin\zcode-aider` or
   `zcode-kit run ...`) ensure it before launching. For everything else
   (pi, Continue, Goose, raw API clients), start it once yourself:
   `node proxy\zcode-proxy-manager.mjs start`
5. **Later**: see *Updating* for your installation type. `zcode-kit rollback`
   undoes recorded file changes from the newest transaction; `zcode-kit uninstall`
   removes kit integrations without deleting shared credentials.

**From a repo checkout** (development or manual install):

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
$env:ZCODE_KIT_ALLOW_CHECKOUT = "1"     # opt-in: a checkout must not silently become the provider root
node setup.mjs                          # or: node cli\zcode-kit.mjs setup --harness auto
node cli\zcode-kit.mjs doctor
```

Requirements: **Node ≥ 20** (bun is only needed for a repo checkout — the
installer brings its own) and **ZCode Desktop installed and logged in** (the
credential import reads your existing desktop login; the MCP bridge needs the
desktop app *running* for model turns). Administrator rights are never
required. WSL is detected and refused — install on the Windows host.

## The zcode-kit CLI

```
zcode-kit setup [--harness auto|omp,pi,...]   bootstrap + integrate detected harnesses
zcode-kit integrate <harness> --dry-run       preview exactly what would be written
zcode-kit integrate <harness>                 apply one adapter (transactional)
zcode-kit run <harness> -- <args>             launch claude-code/codex/aider/opencode wired to ZCode
zcode-kit doctor [--fix] [--harness <id>] [--json]  diagnose; opt-in managed repair
zcode-kit status                              proxy status + quota snapshot
zcode-kit models [--json] [--show-key]        advertised models (from the running proxy)
zcode-kit usage --json                        usage/quota from the account (never invented zeros)
zcode-kit auth status|login|logout            proxy credential lifecycle (logout never touches your desktop login)
zcode-kit update                              fast-forward the checkout, re-apply integrations
zcode-kit rollback [tx-id]                    undo the newest (or named) transaction, three-way safe
zcode-kit uninstall                           remove kit integrations; never deletes shared credentials
```

Recorded configuration edits use hash-based backups. For a finished transaction,
rollback reports later user edits as conflicts instead of overwriting them.
`setup` / `integrate` can fail after earlier steps succeeded: they record those
partial changes and print a rollback command, rather than automatically undoing
the whole setup. Local key creation, credentials, dependency installation and
external CLI side effects are **not** all reversible; external registrations
may require the printed undo command.

## How setup behaves

`setup --harness auto` detects which harnesses are installed and **only
touches those** — an OMP-only user gets no Claude/Codex artifacts, a
Claude-only user gets no OMP edits:

1. **bootstrap** — generates the local proxy key (`.proxykey`, exclusive
   create) and `proxy/config.yaml` from the template, installs proxy + MCP
   dependencies with `bun install --frozen-lockfile` (a failed install is a
   hard error, never a swallowed warning), and imports the credential from
   your existing ZCode Desktop login. If the import is not possible you get
   the exact one-time browser-login command printed.
2. **ten adapters** (each only for detected or explicitly requested
   harnesses) — see `harnesses/README.md` and `SUPPORT_MATRIX.json`.
3. **MCP bridge** — registers the `zcode-harness` stdio bridge only with
   harnesses that are actually present. MCP alone is never counted as model
   integration (Cline/Kilo explicitly state manual-confirmation-required).

On a machine with only OMP installed, exactly one adapter runs (OMP) plus the
OMP MCP entry — nothing Claude- or Codex-related is created.

**Continue YAML:** An existing `models: []` (including horizontal whitespace and
an optional separated comment) is safely converted to a block list before adding
the kit models. Existing indented or indentless lists retain user models first
and preserve their default order; repeated integration is idempotent. Nonempty
inline lists, duplicate `models` keys and unsupported forms are refused without
changing that file. The adapter stores a JSON-quoted **local proxy key** in the
managed section of `~/.continue/config.yaml`, not a Desktop credential, and never
prints the key. Reintegrate after key rotation. The old `${ZCODE_PROXY_KEY}` string
was not valid Continue secret interpolation; no extra env file is created.
Continue is not installed in the validation environment: **live validation is
blocked**; parser/config integration tests are not a real client session.

## Usage per harness

**OMP** (additive provider; full TUI/CLI integration incl. thinking levels):

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**pi** (`~/.pi/agent/models.json`, additive provider `zcode`):

```bash
pi --model zcode/glm-5.3
```

**Claude Code** (opt-in wrapper; `~/.claude` untouched):

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
```

**Codex CLI** (opt-in wrapper, isolated CODEX_HOME):

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Aider / OpenCode / Goose** (launchers set process-local env only):

```bat
node cli\zcode-kit.mjs run aider -- --model openai\glm-5.3-flash
node cli\zcode-kit.mjs run opencode -- .
goose session --provider zcode
```

**Cline / Kilo Code** (GUI-configured): the kit writes a prepared values
sheet to `generated/` and marks the step `manual-confirmation-required` — it
never touches VS Code's internal state.

**Any other client** (OpenAI / Anthropic / Responses formats on
`http://127.0.0.1:8457`, bearer token = content of `.proxykey`):
see `harnesses/README.md`.

## Diagnosis and bounded repair (current source; final verification pending)

Use `zcode-kit doctor` for diagnostics and `zcode-kit doctor --fix` for explicit
managed repair; `--harness <id>` restricts adapter selection and `--json` provides
structured results. Repair does not run general setup or install dependencies.
It reapplies selected adapters under the setup lock. Key drift is aligned only
for an unambiguous kit-template proxy config while its port can be exclusively
reserved; key alignment refuses custom/corrupt config or an occupied port. An
already matching key needs no config rewrite. Checkout writes
still require `ZCODE_KIT_ALLOW_CHECKOUT=1`. On repair failure, recorded file changes
are rolled back; this differs from setup's retained partial changes. Credentials
and external side effects are not covered by that rollback guarantee.

The shared launch preflight safely starts/verifies the proxy, then makes one
bounded quota check (no recurring poll/retry loop). Auth code `3012` is separate
from balance/quota codes `1113` / `3001`; restarting cannot replenish quota.
Upstream auth/balance findings and unavailable quota telemetry warn but permit
use of a healthy local proxy so the model path can attempt bounded credential
recovery. They do not prove usable quota or invent a zero balance; local
identity/start failures still block wrapper launch. A foreign/unverifiable listener is left untouched;
stale ownership locks are not automatically stolen. Logs in `logs/heal.log` use
bounded, fixed-vocabulary cause/action/result fields rather than provider bodies.

OMP caches local authenticated health for 60 seconds after preflight. A later
request can recover a crashed proxy; failed starts have a one-minute cooldown.
Normal healthy turns do not repeatedly query upstream quota.

Normal setup also attempts one minimal live Flash request, which can consume
account quota. `ZCODE_KIT_SKIP_SMOKE=1` opts out; CI/test modes skip it. A failed
smoke reports failure without undoing already-saved integrations. Its presence
in the code is not evidence that a live smoke was run for this source change.

## Proxy management

```bat
node proxy\zcode-proxy-manager.mjs status
node proxy\zcode-proxy-manager.mjs start
node proxy\zcode-proxy-manager.mjs stop
node proxy\zcode-proxy-manager.mjs restart
node proxy\zcode-proxy-manager.mjs doctor
node proxy\zcode-proxy-manager.mjs logs 50
```

Safety properties: binds to 127.0.0.1 only, authenticated health/identity
checks, fail-closed stop (an unverifiable or foreign process on the port is
**never** killed; PID-reuse is detected via process start times), manager
start lock against parallel starts, graceful-then-forced shutdown, log
rotation, bounded log reads, trial-claim and off-peak channels disabled.
`doctor` separates real auth validity from JWT age and only checks components
that exist on the machine.

## Security & automation policy

Stated plainly, so you can decide whether this tool is for you:

- **CAPTCHA handling.** The z.ai gateway serves challenge pages as part of its
  normal client protocol — the official ZCode Desktop app answers them
  automatically and invisibly. The vendored proxy replicates exactly that
  behavior for **your own logged-in account**: it solves gateway challenges
  the same way the official client does. No human-verification gate is
  bypassed (no human ever solves these), no other account is touched, and
  there is no CAPTCHA-farm or third-party solver.
- **No trial automation.** Automatic trial-claiming and off-peak scheduling
  exist nowhere in the kit's shipped config, and since the audit remediation
  the underlying defaults are fail-closed (`false`): a config that omits or
  truncates the claim block does NOT enable claiming. Enabling it requires an
  explicit `claim.enabled: true` in your own config.
- **MCP scope.** The `zcode-harness` bridge is registered at **user scope**
  on purpose: it is a machine-wide integration, not a per-project one. Undo
  is one command (`claude mcp remove zcode-harness --scope user`) and the
  bridge itself never serves unauthenticated or non-loopback requests.
- **Enforced in code, not just by template** (audit remediation): the proxy
  refuses to bind anything but loopback and refuses to serve without a real
  bearer key; adapters refuse to overwrite provider entries they do not own;
  setup refuses to write user configs from a source checkout.

## Login renewal

The runtime reloads its persisted proxy credential at request time. Partial or
invalid store data does not replace the last good credential; an absent store
(logout) clears it on reload, without cancelling already-running requests or
revoking upstream tokens. Explicit/injected credentials remain isolated by default.
Recovery tracks at most 128 failed-credential/source-revision pairs per process;
at the cap, automatic reimport stops until restart. Persistence compares the store
before replacing it but has no cross-process lock: a narrow competing-writer race
remains, so this is not a general atomic compare-and-swap guarantee.

Before any response output, selected non-streaming auth/balance failures may
trigger one existing-Desktop reimport and one resend **only if the effective
credential changes**. Concurrent requests share recovery; attempts are bounded
per failed credential and Desktop source revision, so a later Desktop login can
be noticed. A valid refreshed credential is saved to the proxy's encrypted store
only if the observed store has not changed; no Desktop file is rewritten. No
browser login, API-key creation, trial claim or endless retry is performed.
SSE/in-stream errors are not replayed. If recovery fails, the request still fails;
account permissions and quota cannot be repaired locally.

For deliberate manual renewal:

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
:: or browser login:
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## Uninstall / rollback

```bat
node cli\zcode-kit.mjs rollback      :: undo newest transaction (one step per run)
node cli\zcode-kit.mjs uninstall     :: roll back everything kit-owned, remove generated/
node proxy\zcode-proxy-manager.mjs stop
```

`uninstall` never deletes `~/.zcode-proxy/credentials.json` (shared with other
proxy tools) or your ZCode Desktop login/data. `zcode-kit auth logout` removes
only the proxy's own stored credential and says so.

## Updating

For a source checkout, `zcode-kit update` refuses on a dirty tree, fast-forwards
only (never force-updates), and re-applies integrations with the partial-setup
behavior described above. A release/tarball installation has no `.git` and refuses
this command: re-run the release installer instead. The vendored proxy is pinned
(see `MANIFEST.md`); local patches live in `patches/`.

### Release automation (maintainers)

`.github/workflows/release.yml` runs on pushes to `main`, `v*` tags and manual
dispatch. After tests, a non-tag run reuses the current version only if it is
absent from npm and its remote tag is absent or points to the exact current HEAD.
Otherwise it selects the next patch free on both npm and remote tags (up to 100
candidates), then pushes a version commit/tag. Dispatch is a same-version retry
**only for that unpublished, absent-tag/exact-HEAD case**, not unconditionally
idempotent. A missing npm version does not permit reusing another commit's old
GitHub assets. Tag runs skip npm publish for an existing version; assets are never
replaced. Registry errors fail closed. The workflow pins npm 11.19.1 and checks
exact version visibility after publishing; this is not an artifact-content check.
Version/marker gates and OIDC publication must succeed; local edits prove no release.

## Tests and evidence

```sh
npm run test          # kit fixtures: transactions, manager safety, adapters
npm run test:proxy    # proxy protocol and authentication fixtures
npm run test:mcp      # MCP bridge suite
```

Baseline before this repair work: **65 kit / 872 proxy / 42 MCP tests**. The MCP
`wmic` kill path did **not execute**; the suite count does not validate that path.
**Final verification is pending**; see `TEST_REPORT.md` for dated results.
Source inspection, fixture/config checks, actual live model turns and published
releases are distinct evidence. These local changes do not claim live verification
or repairs to the user's personal installation; historical live results are not
new results for this working tree.

## Documents

- `SUPPORT_MATRIX.json` — honest per-adapter state (implemented /
  config-tested / live-tested / manual-confirmation-required)
- `EFFORT_MAPPING.md` / `.json` — how low/high/max map to upstream parameters
- `SETUP_REPORT.md`, `TEST_REPORT.md` — test evidence with exact commands
- `IMPLEMENTATION_STATUS.md` — decisions and open points
- `harnesses/README.md` — per-harness details and manual integration snippets
- `MANIFEST.md` — vendored components, commits, licenses


I am convinced no coder should be forced to touch a unfamilliar harness. They get scared quiet easily, so I build this
