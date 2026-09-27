# ZCode Agent Kit
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Use your ZCode account with the coding assistant you already use.

![ZCode Desktop connected through Agent Kit to coding assistants](zcode_agent_kit.png)

*The kit runs locally; model requests go to ZCode.*

Keep your coding assistant. Use your existing ZCode models and quota/tokens through a local connection. Two equal ways in: let the kit configure a detected assistant after you answer `y` for it, or take the printed base URL and API key into any OpenAI- or Anthropic-compatible client yourself.

**Optional account rotation:** The installer asks **"Do you want to activate the Account Rotator feature? [y/n]"**. With `y`, the current login is imported and later `zcode-kit auth login zai` logins are saved as additional accounts. Signing in again as an already saved user normally updates that entry; the documentation explains how users are matched and the exceptions. Enable later with `zcode-kit accounts enable`; inspect saved accounts with `zcode-kit accounts`. `zcode-kit accounts health [--json]` shows one on-demand verdict per account from billing data. It is not proof that model requests work; an account without quota data is not counted as healthy, and accounts are not polled continuously. See the [account rotator documentation](docs/ACCOUNT_ROTATOR.md).

**The path:** prepare your account → install the kit → Use GLM-5.3(-flash) / start working.

## Step 1 — Check what you need

- [ZCode Desktop](https://zcode.z.ai/en), signed in to your own account with available model quota.
- [Node.js 20 or newer](https://nodejs.org/). Check with `node --version` in a new terminal.
- A coding assistant installed separately. The kit connects it to ZCode.


## Step 2 — Install the kit once

Choose the release installer or npm below. The release installer runs setup for you, so there is no separate setup command to run afterward. Setup asks one question per detected assistant, **"Configure ZCode as a provider with its supported models in <HARNESS>? [y/n]"** (with the assistant's name), and changes that assistant's configuration only after a `y`; `n` skips it and leaves its settings untouched. Without a terminal answer nothing new is set up: an assistant is configured only when you select it explicitly (see below) or consented earlier, and an integration the kit created before it asked is only kept current.

The installer shows four numbered stages, one result line per assistant (configured, skipped or failed), a connection check and the connection details for manual client setup. Detailed setup output is saved to the displayed `install.log`; set `ZCODE_KIT_VERBOSE=1` for full output and `NO_COLOR=1` for plain text. Interactive installs ask `y` or `n` per assistant and, separately, for Account Rotator; Ctrl-C stops the questions and leaves everything you have not answered `y` to untouched. For unattended installs, select assistants explicitly with `ZCODE_KIT_HARNESSES=omp,codex` (or `none`) and set `ZCODE_KIT_ACCOUNT_ROTATOR=y` or `n`; without an explicit selection, undecided assistants are skipped and the existing Account Rotator setting is preserved. Answers are stored under `generated/harness-choices/`: a later setup, update or `zcode-kit doctor --fix` refreshes only assistants you consented to (a `y`, an explicit selection or `zcode-kit integrate <assistant>`) and never re-integrates a skipped one; an integration the kit created before it asked is kept current but only counts as consent once you answer `y`. `zcode-kit setup --reask` asks every detected assistant again on a terminal. A failed connection check remains a warning even when installation succeeds.

> **Before you run the installer:** it downloads and executes a script, changes configuration only for assistants you answer `y` to, and may register MCP tools for those. Setup also attempts a small model request that can use quota. Changes are recorded, but a later failure can leave earlier changes in place. Inspect the installer if required by your security policy.

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

macOS/Linux also need `curl`, `tar`, and a SHA-256 utility; Bun bootstrap needs `unzip`; updates use `rsync` when it is installed and a built-in `tar`/`find` mirror otherwise. Current live-client validation is Windows-focused; see the dated [support matrix](SUPPORT_MATRIX.json).

</details>

**Alternative — npm (Windows, macOS and Linux):**

Requires Node.js 20+ and [Bun](https://bun.sh/docs/installation) already installed and available in your terminal (`bun --version`; tested with Bun 1.4.2).

```sh
npm install -g zcode-agent-kit@latest
zcode-kit setup --harness auto --installer
```

npm installs the `zcode-kit` and `zcode-agent-kit` commands. The second command installs the kit's dependencies, asks one y/n question per detected assistant and then the Account Rotator y/n question. Run it after installing the npm package. Use one installation method to keep your command, configuration and proxy tied to the same kit copy.

## Step 3 — Use GLM-5.3(-flash) in your harness of choice

Open a new terminal and run `zcode-kit help`. Then open a terminal **inside your own project**, not the kit folder. Choose the assistant you installed, or use the manual connection details with any other client:

**Manual: base URL + API key (any OpenAI- or Anthropic-compatible client)**

The kit does not have to configure your assistant. Start the local proxy and copy the connection details it prints; `zcode-kit proxy status` shows them again while the proxy runs:

```sh
zcode-kit proxy start
```

```text
Connection details (local ZCode proxy, running and verified)
  OpenAI-compatible base URL:    http://127.0.0.1:8457/v1   (POST /chat/completions, POST /responses, GET /models)
  Anthropic-compatible base URL: http://127.0.0.1:8457      (POST /v1/messages)
  API key (Bearer / x-api-key):  <your local proxy key>
  Model IDs:                     glm-5.3, glm-5.3-flash
```

Enter the base URL that matches your client's API format, the key as the API key or auth token, and one of the model IDs. The full key is printed only in an interactive terminal; `zcode-kit models --show-key` prints it for scripts, and `zcode-kit proxy status` labels the values as unverified while the proxy is not running. This path still needs the kit's proxy and a ZCode login with quota; it only skips having the kit configure an assistant for you. The port comes from your `proxy/config.yaml`.

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

**Got the reply?** Your account, proxy, and the client you chose worked together for that request. You can now use it in your project.

**No reply?** Use the checks under “Get help” below; reinstalling will not fix an exhausted quota.

## Step 4 — Use it in your project

For an interactive OMP session:

```sh
omp --model zcode/glm-5.3-flash
```

For an interactive Claude Code session:

```sh
zcode-kit run claude-code -- --model glm-5.3-flash
```

Choose `glm-5.3` for text, or `glm-5.3-flash` for text and images. Image support also depends on your assistant. An optional MCP bridge provides tools from your installed ZCode runtime; registering it is not the same as connecting a model.

Flash always uses thinking. Requests that disable thinking are normalized to `low`; explicit `high` and `max` are preserved. In OMP, select the level with `--thinking low`, `--thinking high`, or `--thinking max`. Completed model replies have been verified with Flash through the direct proxy and Claude Code; this is not a claim that every harness has passed.

<details>
<summary>Other assistants and integration limits</summary>

| Assistant | What to do after setup |
| --- | --- |
| OpenCode | Run `zcode-kit run opencode -- .` and select a ZCode model. |
| Aider | Run `zcode-kit run aider -- --model openai/glm-5.3-flash`. |
| pi | Start the proxy manually, then run `pi --model zcode/glm-5.3`. |
| Goose | Start the proxy manually, then run `goose session --provider zcode`. |
| Continue | Open/configure Continue first. Run `zcode-kit integrate continue`, start the proxy, then select the model in the UI. |
| Cline / Kilo Code | After a `y` for that assistant, copy the generated values into the extension UI and start the proxy. Setup then creates `generated/cline-zcode-values.md` or `generated/kilo-zcode-values.md` inside a release installation. |

Run OMP directly, not through `zcode-kit run`. Only Claude Code, Codex, Aider, and OpenCode have kit launchers. Codex uses an isolated profile; your usual personal settings and skills do not automatically carry over. Claude Code routing is community compatibility. An adapter is not a guarantee that every client/version has been live-tested.

See [assistant-specific documentation](harnesses/README.md) and the [support matrix](SUPPORT_MATRIX.json).

</details>

<details>
<summary>Start, stop or restart the proxy manually</summary>

The same commands work on every platform and for release and npm installations:

```sh
zcode-kit proxy start
zcode-kit proxy status
zcode-kit proxy logs 50
zcode-kit proxy restart
zcode-kit proxy stop
```

`stop`, `restart` and every automatic restart interrupt connected clients and in-flight requests; retry those requests afterward. Releases without `zcode-kit proxy` run `node <installation>/proxy/zcode-proxy-manager.mjs` with the same command. `start` and `status` print the connection details (base URLs, key, model IDs) once the proxy is verified as this installation's own; a stopped proxy is reported as not running and its configured values are labelled as such.

**Hung proxy:** `start`, `restart` and `stop` terminate a proxy that does not answer only when it is proven to be this kit's own: it is past the 60-second startup grace, its start time matches the recorded one, its command line is the kit proxy, and 3 consecutive health checks (about 25 seconds) fail. A process whose ownership is unknown is never killed; the command reports it and stops. `zcode-kit doctor --fix` reapplies managed configuration and, if the proxy is down or proven hung, starts it the same way.

**Automatic restarts:** if the proxy's main thread stops responding or its memory stays too high, the proxy asks the kit manager for a fresh start. At most 3 such restarts are accepted within 15 minutes; after that, or when the restart history is unreadable, the request is refused and the proxy stays down until you check `zcode-kit proxy logs 50` and start it. A leftover start lock is deliberately never taken over: if no start is running, remove the lock file named in the message and retry.

</details>

## Get help

```sh
zcode-kit doctor
zcode-kit auth status
```

- **Command not found:** reopen the terminal. For release installs, check that `%LOCALAPPDATA%\Microsoft\WindowsApps` (Windows) or `$HOME/.local/bin` (macOS/Linux) is on PATH.
- **Assistant skipped during setup:** answer `y` next time, run `zcode-kit integrate <assistant>` (`zcode-kit setup --harness <list>` for several), or `zcode-kit setup --reask` to be asked again for every detected assistant. Without a terminal, select assistants with `ZCODE_KIT_HARNESSES`.
- **Manual client setup:** `zcode-kit proxy status` prints the base URLs, key and model IDs while the proxy runs; the full key only in an interactive terminal (`zcode-kit models --show-key` otherwise).
- **Choose several assistants at once:** `zcode-kit setup --select` shows one numbered list of the detected assistants instead of one question each (`1,3`, `all` or `none`); the chosen ones are configured, the other detected ones are recorded as skipped.
- **Forget a stored answer:** `zcode-kit doctor` reports unreadable or orphaned decision files; `zcode-kit doctor --forget <assistant>` removes one (the integration stays, the next setup asks again; undo with `zcode-kit rollback`).
- **Scripts and monitoring:** `zcode-kit proxy status --json` prints one JSON object with health, base URLs, model IDs and quota; it never contains the key.
- **Vendor moved a gateway?** `zcode-kit doctor --upstream` compares the gateway the kit's proxy uses with the provider configuration the ZCode client currently receives (two requests to zcode.z.ai, no credentials; only when you ask for it).
- **No model reply:** check the Desktop login and available quota. Start the proxy if your client does not start it. Local health does not prove model access.
- **Proxy down or not answering:** run `zcode-kit doctor --fix` or `zcode-kit proxy restart`. Only a proven-own hung proxy is terminated; see the manual proxy section above.
- **OMP autostart:** launch OMP directly. Setup pins native Node/Bun; the extension runs preflight in a fresh child instead of importing kit modules into OMP. Failures report secret-free categories; the child is limited to 120 seconds. Fix the reported cause, then retry after the 60-second per-session cooldown; recovery is possible in the same session. If the runtime moved, rerun `zcode-kit setup --harness auto` and reload the extension. Unknown port owners are left untouched.
- **Desktop login import:** run `zcode-kit auth login zai --import` to import the current active Desktop 0.16.9 `zai`/`start-plan` login; an explicitly configured plan is required. If `credentials.json` exists, it is authoritative: invalid credentials do not silently fall back to legacy `config.json`. Modern `coding-plan` logins use normal OAuth with `zcode-kit auth login zai` instead; the importer does not create or resolve API keys.
- **401 or occupied port:** check for another kit installation. Do not delete keys or kill an unknown process.
- **Setup partly failed:** one assistant failing does not undo the others; its own partial changes are reverted and the installer continues with a warning. Read the printed rollback command before trying again. Earlier changes may still exist.

## Before you use real project data

Keep the proxy on localhost and never share `.proxykey`, credentials, or generated configuration files.

**Read the [security policy](SECURITY.md):** the managed proxy can execute vendor CAPTCHA JavaScript without an OS sandbox. It remains loopback-only and bearer-authenticated, but those controls are not process isolation. The CAPTCHA worker thread keeps the proxy responsive; it is not a sandbox or a new permission boundary. This does not bypass account restrictions or guarantee that every challenge succeeds.

<details>
<summary>Update or remove the kit</summary>

**Update:**

- Any installation: run `zcode-kit update`. A release install downloads the latest release, verifies it (SHA-256), updates in place and keeps your proxy key, config, logs, backups and accounts; an npm install re-runs the npm install; a git checkout fast-forwards to `origin/main`. Pin a version with `zcode-kit update --version vX.Y.Z`.
- Manual fallback: re-run the release installer with the same dedicated destination (remove an old `ZCODE_KIT_VERSION` pin if you want the latest version), or for npm run `npm install -g zcode-agent-kit@latest` and then `zcode-kit setup --harness auto --installer` from that npm installation.

`update` stops the proxy before it touches files and restarts it afterwards — when the command succeeds, the proxy is running the updated code. Keep the same installation method when updating.

**Remove integrations:** stop your proxy (`zcode-kit proxy stop`, see above), then run `zcode-kit uninstall`. This leaves the installation folder, dependencies, logs, proxy keys, and shared credentials behind; it does not log you out of Desktop. Inspect leftover files before deleting anything.

For an npm installation, remove the global package afterward with `npm uninstall -g zcode-agent-kit`.

</details>

## More information

[Assistant guides](harnesses/README.md) · [Support matrix](SUPPORT_MATRIX.json) · [Security policy](SECURITY.md) · [Report a problem](https://github.com/ZepiGit/ZCode-Agent-Kit/issues) · [Licensing and bundled components](MANIFEST.md)
