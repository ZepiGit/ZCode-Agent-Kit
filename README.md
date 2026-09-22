# ZCode Agent Kit

Use your ZCode account with the coding assistant you already use.

![ZCode Desktop connected through Agent Kit to coding assistants](zcode_agent_kit.png)

*The kit runs locally; model requests go to ZCode.*

Keep your coding assistant. Use your existing ZCode models and quota/tokens through a local connection.

**Optional account rotation:** Enable a pool of your own authorized ZCode accounts, add them with `zcode-proxy auth login <provider> --account ID`, and inspect or remove them with `zcode-kit accounts`. See the [account rotator documentation](docs/ACCOUNT_ROTATOR.md); listings are offline and redacted, and no account or quota limits are bypassed.

**The path:** prepare your account → install the kit → Use GLM-5.3(-flash) / start working.

## Step 1 — Check what you need

- [ZCode Desktop](https://zcode.z.ai/en), signed in to your own account with available model quota.
- [Node.js 20 or newer](https://nodejs.org/). Check with `node --version` in a new terminal.
- A coding assistant installed separately. The kit connects it to ZCode.


## Step 2 — Install the kit once

Use the release installer below. It sets up detected assistants automatically, so there is no separate setup command to run afterward.

> **Before you run the installer:** it downloads and executes a script, changes configuration for detected assistants, and may register MCP tools. Setup also attempts a small model request that can use quota. Changes are recorded, but a later failure can leave earlier changes in place. Inspect the installer if required by your security policy.

**Windows — PowerShell, without administrator rights:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux — POSIX terminal:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

Run from any directory. No clone is needed. The installer runs setup and can install Bun if it is missing. On Windows, use PowerShell—not Git Bash or WSL.

<details>
<summary>Install locations and macOS/Linux prerequisites</summary>

Defaults: `%LOCALAPPDATA%\zcode-agent-kit` on Windows; `$HOME/.local/share/zcode-agent-kit` on macOS/Linux. Keep this folder separate from your working projects. Never point an installer at your home folder or source checkout: updates replace files at the destination.

macOS/Linux also need `curl`, `tar`, and a SHA-256 utility; Bun bootstrap needs `unzip`, and updates need `rsync`. Current live-client validation is Windows-focused; see the dated [support matrix](SUPPORT_MATRIX.json).

</details>

## Step 3 — Use GLM-5.3(-flash) in your harness of choice

Open a new terminal and run `zcode-kit help`. Then open a terminal **inside your own project**, not the kit folder. Choose the assistant you installed:

**OMP:**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with ok"
```

**Claude Code:**

```sh
zcode-kit run claude-code -- -p "Reply with ok" --model glm-5.3-flash
```

**Codex:**

```sh
zcode-kit run codex -- exec "Reply with ok" -m glm-5.3-flash
```

These commands start/check the proxy automatically. A reply of `ok` confirms the first model call. A successful setup message alone does not.

**Got the reply?** Your account, proxy, and selected assistant worked together for that request. You can now use that assistant in your project.

**No reply?** Use the checks under “Get help” below; reinstalling will not fix an exhausted quota.

## Step 4 — Use it in your project

For an interactive OMP session:

```sh
omp --model zcode/glm-5.3
```

For an interactive Claude Code session:

```sh
zcode-kit run claude-code -- --model glm-5.3
```

Choose `glm-5.3` for text, or `glm-5.3-flash` for text and images. Image support also depends on your assistant. An optional MCP bridge provides tools from your installed ZCode runtime; registering it is not the same as connecting a model.

<details>
<summary>Other assistants and integration limits</summary>

| Assistant | What to do after setup |
| --- | --- |
| OpenCode | Run `zcode-kit run opencode -- .` and select a ZCode model. |
| Aider | Run `zcode-kit run aider -- --model openai/glm-5.3-flash`. |
| pi | Start the proxy manually, then run `pi --model zcode/glm-5.3`. |
| Goose | Start the proxy manually, then run `goose session --provider zcode`. |
| Continue | Open/configure Continue first. Run `zcode-kit integrate continue`, start the proxy, then select the model in the UI. |
| Cline / Kilo Code | Copy the generated values into the extension UI and start the proxy. Setup creates `generated/cline-zcode-values.md` or `generated/kilo-zcode-values.md` inside a release installation. |

Run OMP directly, not through `zcode-kit run`. Only Claude Code, Codex, Aider, and OpenCode have kit launchers. Codex uses an isolated profile; your usual personal settings and skills do not automatically carry over. Claude Code routing is community compatibility. An adapter is not a guarantee that every client/version has been live-tested.

See [assistant-specific documentation](harnesses/README.md) and the [support matrix](SUPPORT_MATRIX.json).

</details>

<details>
<summary>Start or stop the proxy manually</summary>

For the default **release-installer** location only:

**PowerShell:**

```powershell
node (Join-Path $env:LOCALAPPDATA 'zcode-agent-kit/proxy/zcode-proxy-manager.mjs') start
```

**macOS/Linux:**

```sh
node "$HOME/.local/share/zcode-agent-kit/proxy/zcode-proxy-manager.mjs" start
```

Replace `start` with `status`, `logs 50`, or `stop` as needed. Stopping interrupts connected clients. For a custom location, use that installation's absolute path. These default paths do not apply to npm installs.

</details>

## Get help

```sh
zcode-kit doctor
zcode-kit auth status
```

- **Command not found:** reopen the terminal. For release installs, check that `%LOCALAPPDATA%\Microsoft\WindowsApps` (Windows) or `$HOME/.local/bin` (macOS/Linux) is on PATH.
- **No model reply:** check the Desktop login and available quota. Start the proxy if your assistant does not start it. Local health does not prove model access.
- **401 or occupied port:** check for another kit installation. Do not delete keys or kill an unknown process.
- **Setup partly failed:** read the printed rollback command before trying again. Earlier changes may still exist.

## Before you use real project data

Keep the proxy on localhost and never share `.proxykey`, credentials, or generated configuration files.

**Read the [security policy (German)](SECURITY.md):** the managed proxy can execute vendor CAPTCHA JavaScript without an OS sandbox. It remains loopback-only and bearer-authenticated, but those controls are not process isolation. This does not bypass account restrictions or guarantee that every challenge succeeds.

<details>
<summary>Update or remove the kit</summary>

**Update:** rerun the same release installer using the same dedicated destination. Do not mix release and npm installations. Remove an old `ZCODE_KIT_VERSION` pin if you want the latest version.

**Remove integrations:** stop your proxy using the manager command above with `stop`, then run `zcode-kit uninstall`. This leaves the installation folder, dependencies, logs, proxy keys, and shared credentials behind; it does not log you out of Desktop. Inspect leftover files before deleting anything.

</details>

## More information

[Assistant guides](harnesses/README.md) · [Support matrix](SUPPORT_MATRIX.json) · [Security](SECURITY.md) · [Report a problem](https://github.com/ZepiGit/ZCode-Agent-Kit/issues) · [Licensing and bundled components](MANIFEST.md)
