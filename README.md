# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)

**English** | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md)

Use **your own ZCode Desktop account** with a coding assistant of your choice. The kit connects supported assistants to a local proxy; it does not install those assistants, create an account, buy quota, or provide free/unlimited access.

- **Model proxy:** OpenAI Chat Completions, Responses, and Anthropic Messages formats at `http://127.0.0.1:8457` by default.
- **Models:** `glm-5.3` (text) and `glm-5.3-flash` (text and images). Advertised context: 1M tokens; reasoning levels: `low`, `high`, `max`. Client support and account limits still apply.
- **Optional MCP bridge:** exposes operations of your installed ZCode runtime. This is separate from model-provider configuration. A running Desktop app does not guarantee standalone MCP model turns; the provider can reject them independently.

## Unreleased audit hardening

- **Model/setup evidence:** Standalone MCP model turns are not guaranteed by a running Desktop app; the provider can reject them independently. If setup saves configuration but its API attempt fails, setup reports a warning: configuration succeeded, model access did not.
- **Bun and mutable state:** Release installers store Bun's absolute executable path in `.bun-path` and do not change global PATH; kit restarts use that recorded path. npm mutable state lives outside `node_modules`: `%LOCALAPPDATA%\zcode-agent-kit\installs\<root-hash>` on Windows, or `${XDG_STATE_HOME:-$HOME/.local/state}/zcode-agent-kit/installs/<hash>` on POSIX. `ZCODE_KIT_STATE_DIR` must be absolute and dedicated to that installation. Source/tarball installs keep mutable state in their root. Before an npm package update, run setup to migrate legacy state; old data remains in place, and already-lost legacy data cannot be reconstructed.
- **MCP trust:** YOLO is enabled only by explicit `--allow-yolo`; workspace allowlists also constrain access through session IDs, logs are bounded, and every client using the same bridge shares one trust domain.
- **CAPTCHA boundary:** Remote CAPTCHA JavaScript is not OS-isolated. `createDom` without injected local test fixtures is disabled by default. Standalone use can opt in only for trusted deployments with `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA=1`; kit `proxyEnv` removes that override and provides no opt-in. Start-plan requests can therefore fail closed; none of this bypasses provider blocks.
- **Prompt/privacy:** Start-plan prepends vendored ZCode system blocks to client prompts and removes client `cache_control` markers. The kit uses the neutral CWD `/workspace`; platform, shell, OS version, locale, trace and device metadata may still reach the upstream. This is neither a provider-compatibility nor an access guarantee.
- **Release automation:** `main` and workflow-dispatch release triggers are intentional. `ALLOW_PUBLISH` checks version consistency only; it is not human or legal approval.


## 1. Before you install

You need:

1. **ZCode Desktop**, already signed in to your own account with available model quota.
2. **Node.js 20 or newer**, installed and available in your terminal: [nodejs.org](https://nodejs.org/).
3. **Bun for npm/source installs**, available on PATH: [Bun installation](https://bun.sh/docs/installation). The tested version is **1.4.2**. npm/source setup uses Bun to install dependencies; it does not install Bun itself. Release installers can bootstrap Bun and record its absolute path.
4. Your chosen assistant, installed separately: OMP, pi, Claude Code, Codex, OpenCode, Cline, Kilo Code, Aider, Continue, or Goose.

Open a **new terminal** and check:

```sh
node --version
bun --version
```

These checks work in PowerShell and POSIX shells. Node must be available for every method; `bun --version` must work before npm/source setup. Release installers can download Bun when absent, save its absolute executable path in `.bun-path`, and reuse that path after restart without changing global PATH. Existing Bun installations are reused, not automatically upgraded.

**Windows:** use PowerShell, without administrator rights. Do not run `install.sh` in Git Bash or WSL. **macOS/Linux:** use a POSIX shell; `curl`, `tar`, a SHA-256 utility, and `rsync` for updates are needed; Bun bootstrap also needs `unzip`. Linux/macOS live-client support has not been reverified in the Windows validation described below.

## 2. Install once — choose one method

Avoid mixing npm and release-installer copies. They can have different local keys, while both modify the same assistant profile.

### Recommended: published release installer

Run from **any directory**. You do not need to clone the repository or enter an installation folder. These commands download and execute the repository's published installer; inspect the script first if your policy requires it.

**Windows — PowerShell:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS/Linux — POSIX shell:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```
or

**npm installation:**

Requires both Node and Bun already on PATH. From any directory:

```sh
npm install -g zcode-agent-kit
zcode-kit setup
```
In the current source, npm postinstall prints a hint; explicit setup performs integration. Older published packages may behave differently. The npm command names are `zcode-kit` and `zcode-agent-kit`. A 404 can mean the requested package/version is unavailable or inaccessible; it does not prove a local installation fault.

Do not use a transient `npx ... setup` as a permanent installation: generated configurations refer to the package's filesystem location. Use a stable global install or the release installer.


The installer verifies the release archive's SHA-256, installs locally, and runs setup. Defaults:

| System | Kit directory | Command shim |
|---|---|---|
| Windows | `%LOCALAPPDATA%\zcode-agent-kit` | `%LOCALAPPDATA%\Microsoft\WindowsApps\zcode-kit.cmd` |
| macOS/Linux | `$HOME/.local/share/zcode-agent-kit` | `$HOME/.local/bin/zcode-kit` |

`ZCODE_KIT_INSTALL_DIR` overrides `ZCODE_KIT_HOME`; otherwise the default is used. **Always choose a dedicated absolute directory. Never choose your home directory, working project, or source checkout:** installer updates replace/mirror files there. These variables select the installer destination; setting them later does not redirect an already-installed CLI.

For reproducibility, set `ZCODE_KIT_VERSION` to an existing release tag, including its `v` prefix, before running the installer. Remove the override when you want latest again. Changing that variable pins the archive; the one-liners above still fetch the installer script from the latest release.


## 3. Verify which installation you are using

After installation, open a new terminal and run:

**PowerShell:**

```powershell
Get-Command zcode-kit -All
node --version
bun --version
zcode-kit help
```

**macOS/Linux:**

```sh
command -v zcode-kit
node --version
bun --version
zcode-kit help
```

If `zcode-kit` is not found, the shim directory above may be missing from PATH. Add the correct directory to your shell/user PATH, then reopen the terminal. If multiple copies exist, use the **explicit path** below rather than guessing which copy is active. PowerShell and Git Bash may select different copies on Windows.

### Explicit paths: safe from any working directory

Define the path to the **installation you actually chose**, once per terminal session. The defaults below are for release-installer installations, **not npm**. Replace the assignment for a custom destination or source checkout.

**PowerShell:**

```powershell
$KitRoot = Join-Path $env:LOCALAPPDATA 'zcode-agent-kit'
if (-not (Test-Path (Join-Path $KitRoot 'cli/zcode-kit.mjs'))) { throw 'Wrong KitRoot: cli/zcode-kit.mjs not found' }
node (Join-Path $KitRoot 'cli/zcode-kit.mjs') help
```

**macOS/Linux:**

```sh
KIT_ROOT="$HOME/.local/share/zcode-agent-kit"
if [ -f "$KIT_ROOT/cli/zcode-kit.mjs" ]; then
  node "$KIT_ROOT/cli/zcode-kit.mjs" help
else
  printf '%s\n' 'Wrong KIT_ROOT: cli/zcode-kit.mjs not found' >&2
fi
```

If the check fails, stop and correct the path. For npm, `npm root -g` identifies the global modules directory; the kit is its `zcode-agent-kit` subdirectory. Do not substitute a release-install path for an npm copy.

**Do not type `node cli/zcode-kit.mjs` from an arbitrary directory.** Relative paths refer to the current directory, not the kit. The global shim or absolute script path avoids this problem.

## 4. Configure and make the first model call

Setup detects assistants from executables/configuration directories and applies their adapters. Detection does not prove that a client is installed or working. To configure a selected assistant instead:

```sh
zcode-kit setup --harness omp
zcode-kit integrate continue --dry-run
```

Use these only after verifying the command's installation in section 3. Setup can modify user-level assistant configuration and MCP registrations. It records configuration transactions, but **it is not an all-or-nothing operation**: a later failure leaves earlier successful changes in place and prints a rollback command.

Current-source setup also makes one small live Flash request, which can consume quota. To skip it, set `ZCODE_KIT_SKIP_SMOKE=1` for that invocation; CI/test modes skip it too. If configuration was saved successfully but the API attempt fails, setup reports a warning and keeps the configuration success; that is not evidence of a successful model turn. `doctor --fix` does not install missing dependencies or perform general setup.

```sh
zcode-kit status
zcode-kit doctor
zcode-kit auth status
zcode-kit usage --json
```

A stopped proxy can make diagnostics fail before first launch. Start it as described in section 6 or launch an assistant that auto-starts it. **A health check or exit code alone does not prove model access:** inspect `logged_in`, quota diagnostics, and an actual model reply.

### Run assistants in your project — not the kit directory

Open a terminal **inside the project you want the assistant to work on**, or use `Set-Location` (PowerShell) / `cd` (POSIX) to enter that project. The kit launchers preserve that working directory.

**OMP, direct command (not `zcode-kit run omp`):**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with 52"
omp -p --model zcode/glm-5.3 "Reply with 52"
```

Expected: a model reply of `52`, exit 0. Normal latency varies; a timeout still counts as a failed attempt. For interactive use:

```sh
omp --model zcode/glm-5.3 --thinking max
```

**Other kit launchers** — everything after `--` is passed to the assistant:

```sh
zcode-kit run claude-code -- -p "Reply with 52" --model glm-5.3-flash
zcode-kit run codex -- exec "Reply with 52" -m glm-5.3-flash
zcode-kit run aider -- --model openai/glm-5.3-flash
zcode-kit run opencode -- .
```

Model identifiers always use `/`, including on Windows. `run` supports **only** `claude-code`, `codex`, `aider`, and `opencode`. OMP's extension and those launchers start/check the proxy; start it manually for other clients.

## 5. What each integration does

| Adapter ID | Configuration / usage |
|---|---|
| `omp` | Adds provider, model configuration, auto-start extension and optional MCP entry. Run `omp` directly. |
| `pi` | Adds `zcode` in `~/.pi/agent/models.json`. Start proxy, then `pi --model zcode/glm-5.3`. |
| `claude-code` | Generated settings + opt-in launcher; does not replace normal Claude model settings. Setup may register a user-scope MCP server. Non-Claude model routing is community compatibility. |
| `codex` | Launcher uses `generated/codex-home` as isolated `CODEX_HOME`; normal personal Codex configuration/skills do not automatically apply there. |
| `opencode` | Adds a provider; `zcode-kit run opencode -- .` supplies its process-local key. |
| `aider` | Generated environment + launcher; specify `--model openai/glm-5.3-flash` when passing other arguments. |
| `continue` | Updates an **existing** `~/.continue/config.yaml`; missing file is skipped. Open/configure Continue first, integrate again, then select the model in its UI. |
| `goose` | Writes a persistent custom-provider file with key helper. Start proxy, then `goose session --provider zcode`. |
| `cline` | Generates `generated/cline-zcode-values.md`; enter the values manually in the extension UI. |
| `kilo-code` | Generates `generated/kilo-zcode-values.md`; enter the values manually in the extension UI. |

Ten adapters do not mean ten live-tested clients. See the dated [support matrix](SUPPORT_MATRIX.json) and [test report](TEST_REPORT.md). Cline/Kilo configuration checks prove a values sheet exists, **not** that GUI setup is complete. MCP registration alone is not model access.

**Continue in current source:** `models: []`, comments and block-list indentation are supported; existing user models/default order remain first. Nonempty inline lists, duplicate keys and unsafe shapes are refused rather than guessed. The managed YAML stores the local proxy key as a quoted value; `${ZCODE_PROXY_KEY}` is not valid Continue secret interpolation. After key rotation, re-integrate or use supported managed repair. No native Continue live test is claimed.

## 6. Start, inspect or stop the proxy explicitly

Use the root variable from section 3. These commands work while you remain in your project.

**PowerShell:**

```powershell
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') start
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') status
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') logs 50
```

**macOS/Linux:**

```sh
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" start
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" status
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" logs 50
```

Replace `status` with `doctor`, `stop`, or `restart` for those operations. **Stop/restart interrupts clients using this proxy.** Do not kill a process merely because it owns port 8457. The manager refuses foreign/unverifiable processes and checks recorded process identity/start time before stopping its own process. Stale ownership locks are not automatically stolen.

## 7. Troubleshooting and bounded self-repair

| Symptom | What to check / do |
|---|---|
| `zcode-kit`, `node`, or `bun` not found | Check PATH in a new terminal. For the kit, use the absolute path in section 3. npm/source setup cannot bootstrap Bun. |
| `Cannot find module .../cli/zcode-kit.mjs` | A relative path was run from the wrong directory, or the wrong installation root was chosen. Do not copy scripts into your project; correct the absolute path. |
| Setup fails at Continue `models: []` | Published older versions lack the compatibility fix. Use a release containing it or the explicit source-install procedure below; do not append a second `models` key. |
| `unknown command` / unsupported `run` target | Start OMP/pi/Goose directly; only the four launchers above support `run`. |
| `foreign`, occupied port, or HTTP 401 | Check duplicate installations and command resolution first. Do not delete keys, steal locks, or kill the listener. Use diagnostics for the intended copy. |
| Auth `3012` / `logged_in: false` | Check the Desktop login. Current source attempts bounded credential renewal; deliberate browser login is `zcode-kit auth login`. |
| Balance/quota `1113` / `3001` | Check account plan/quota. Restarting or local repair cannot refill a balance. |
| Setup error after some adapters succeeded | Earlier edits may remain. Inspect the recorded transaction; use its printed rollback command if needed. |
| `doctor --fix` repairs files but still exits 1 | Diagnostics may still fail, for example because the proxy is stopped or a manual step is incomplete. Read each check, not just the summary. |
| `models --json` works with proxy stopped | It may be a registry fallback. Inspect `source`; a model list is not live-inference evidence. |

Current-source managed repair:

```sh
zcode-kit doctor --harness continue --json
zcode-kit doctor --fix --harness continue
```

Repair reapplies selected managed adapters under a lock. Offline key alignment requires an unambiguous kit template and reservable port; custom/corrupt configurations or occupied ports are refused. Matching keys need no proxy-config rewrite. Repair failure rolls back recorded repair-file changes; ordinary setup retains recorded partial changes. Credentials, dependency installs and external registrations are not all covered by file rollback.

Current-source startup warns on upstream quota/auth findings so the model request can try recovery; local identity/start failures block wrapper launch. OMP caches local health for 60 seconds, with a one-minute failure cooldown. It does not poll provider quota every turn. Fixed-vocabulary diagnostics go to bounded `logs/heal.log`.

The proxy reloads stored credentials per request. Corrupt/partial writes retain the last good value; a missing store clears it on reload. Selected pre-output failures may import the **existing** Desktop credential and resend once, only if the effective credential changes. Imports never rewrite Desktop login files, create API keys, buy quota or claim trials; SSE/in-stream errors are not replayed. Recovery and persistence retries are bounded, not guaranteed success. See [security policy](SECURITY.md) for limits, including concurrent writers and the per-process recovery cap.

## 8. Update, rollback and uninstall

**Update using the original installation method:**

- Release installer: rerun it with the same dedicated destination. This updates published files, not unpublished Git changes. Remove an obsolete version pin first.
- npm: before replacing the package, run `zcode-kit setup` from the current npm installation so legacy mutable state is migrated. Then run `npm install -g zcode-agent-kit@latest` and run setup again from the updated copy. Migration leaves old data in place; data already lost from an older `node_modules` cannot be reconstructed.
- Source checkout: `node cli/zcode-kit.mjs update` **from the checkout root**. It requires a clean tree, fast-forwards only, and reapplies setup. This is not a release-version selector. Release/npm installations without `.git` refuse this command.

Recorded configuration rollback:

```sh
zcode-kit rollback
```

This chooses the newest transaction; pass a printed transaction ID to select one. Later user edits are reported as conflicts rather than blindly overwritten. Do not assume credentials, dependency installs or all external registrations are undone.

To remove integrations, first stop the intended proxy using its **absolute manager path** from section 6. Then:

```sh
zcode-kit uninstall
```

Uninstall does not stop a running proxy itself and does not delete the installation directory, dependencies, logs, `.proxykey`, shared proxy credentials, or Desktop account data. It removes recorded integrations, generated files and a matching installer shim. For npm, remove the package separately with `npm uninstall -g zcode-agent-kit` **after** integration cleanup. Inspect any remaining directory before deleting it.

`zcode-kit auth logout` explains the effective proxy credential path; `zcode-kit auth logout --yes` deletes it (including a configured `ZCODE_PROXY_CREDENTIALS_PATH`). It does not log out Desktop or revoke upstream tokens. Do not use logout as a routine repair step.

## 9. Source installation and development — advanced

Use this only if you deliberately need the current source rather than a published release. Install Node, Bun and Git first. Clone into a **new dedicated folder**, not the project the assistant should edit. Do not run a release installer into the checkout.

**PowerShell:**

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; stop here' }
Set-Location zcode-agent-kit -ErrorAction Stop
$env:ZCODE_KIT_ALLOW_CHECKOUT = '1'
try { node cli/zcode-kit.mjs setup --harness omp }
finally { Remove-Item Env:ZCODE_KIT_ALLOW_CHECKOUT -ErrorAction SilentlyContinue }
```

**macOS/Linux:**

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit &&
cd zcode-agent-kit &&
ZCODE_KIT_ALLOW_CHECKOUT=1 node cli/zcode-kit.mjs setup --harness omp
```

Proceed only if cloning and changing directory succeeded; never run the later lines after an earlier error. `--harness omp` intentionally limits this example; choose your assistant or `auto`. Checkout writes require the explicit opt-in to avoid accidentally rebinding user profiles to a second copy. Setup does not install a global command shim for the checkout: use its absolute CLI path later. Keep the checkout in place because integrations refer to it, and return to your **working project** before launching an assistant.

Developer tests run **from the checkout root**, after installing proxy and MCP dependencies. They create fixture/build files in the checkout; use a disposable development copy when strict isolation matters.

```sh
npm run test
npm run test:proxy
npm run test:mcp
```

See [TEST_REPORT.md](TEST_REPORT.md) for the dated validation: 150 kit tests passed plus one live opt-in skip, 946 proxy tests passed, and 42 MCP tests passed. Real isolated OMP model turns covered normal startup, own-proxy crash recovery and offline key-drift repair; one initial timeout and its successful recheck remain documented. These are not claims of every client/platform/long-running scenario passing, nor proof that the latest published package contains these changes. Subsequent CI portability findings are separate from that local run; consult the badge and current workflow logs.

Maintainers: release automation on `main` pushes and workflow dispatch is intentional; a `v*` tag can also trigger it. Main/dispatch version selection checks npm and remote tags to avoid reusing another commit's assets; exact unpublished retries are conditional. `ALLOW_PUBLISH` checks version consistency only and is not human, legal, or redistribution approval. Tests, package/version gates, OIDC authorization and redistribution requirements still apply. See [release checklist](docs/RELEASE_CHECKLIST.md); a green local test is not a successful npm publication.

## Security and further documentation

Use only your own authorized account. Protect `.proxykey`, generated settings/env files and profile configurations; never paste their contents into issues. The proxy is loopback-only and bearer-authenticated. Remote CAPTCHA JavaScript is not OS-isolated: `createDom` without injected local test fixtures is disabled by default, and only trusted standalone deployments may opt in with `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA=1`. Kit `proxyEnv` strips that override and offers no enablement; start-plan requests may therefore fail closed. Challenge handling does not bypass provider restrictions or guarantee provider endorsement or future compatibility. Trial-claiming and off-peak automation are disabled by default. Read [SECURITY.md](SECURITY.md) before changing settings or exposing any endpoint.

- [Harness details](harnesses/README.md) and [support matrix](SUPPORT_MATRIX.json)
- [Reasoning/effort mapping](EFFORT_MAPPING.md)
- [Test report](TEST_REPORT.md) and [implementation status](IMPLEMENTATION_STATUS.md)
- [Vendored components and licensing](MANIFEST.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
