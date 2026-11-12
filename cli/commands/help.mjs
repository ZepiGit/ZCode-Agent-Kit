// `zcode-kit help` / `--help` (exit 0) and an unknown command (the error on
// stderr, then the same usage text, exit 2). Runs before the kit context
// exists, so it reads nothing but its arguments.
import { HARNESS_SELECTION_ENV } from "../harness-consent.mjs";
import { ADAPTER_IDS, stderrLine, stdoutLine } from "./common.mjs";

function usageText() {
  return `zcode-kit — local ZCode provider for your own agent harnesses

  zcode-kit setup [--harness auto|omp,pi,...|none] [--select]   bootstrap + assistant consent
  zcode-kit integrate <harness> [--dry-run]     explicit consent for one harness
  zcode-kit run <harness> -- <args>             launch harness wired to ZCode
  zcode-kit doctor [--fix] [--harness <id>] [--json] [--upstream] | doctor --forget <harness>
  zcode-kit status [--json] | models [--json] [--show-key] | usage --json
  zcode-kit proxy start|stop|restart|status [--json]|logs [n]   manage the local proxy service
  zcode-kit auth status|login [zai|bigmodel] [--import] [--account ID] [--replace]|logout
  zcode-kit accounts enable|disable
  zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes] | accounts unlock [--force]
  zcode-kit accounts explain --model MODEL --operation OP
  zcode-kit accounts doctor [--json] | accounts quota | accounts health [--json]
  zcode-kit update [--version vX.Y.Z] | rollback [tx-id] | uninstall
  zcode-kit --version

Setup
  On a terminal, setup shows the detected harnesses as a checkbox list: arrow keys move,
  Space toggles, a toggles all, Enter confirms. Esc or Enter with nothing ticked saves no answer.
  Terminals without colour or cursor control get one [y/n] question per harness instead.
  Without a terminal, undecided harnesses are skipped; nothing is configured silently.
  Answers are kept under generated/harness-choices/ and reused; --reask asks again.
  A harness that already has a kit integration may be refreshed even without a new answer.
  --harness <list> or ${HARNESS_SELECTION_ENV}=<list> picks harnesses without questions; none skips all.
  --select shows one numbered list instead of the checkbox list.
  --no-mcp skips the MCP registration; otherwise it follows the chosen harnesses.
  --account-rotator y|n answers the Account Rotator question for unattended installs.
  --verbose prints the full installer output.
  Setup ends with the commands to run next. A configured harness does not prove that sign-in
  works; check that with the auth status command.

Other commands
  doctor --forget <harness> removes a stored answer (the integration stays; setup asks again).
  doctor --upstream compares the kit's gateway with the provider config the ZCode client
  receives. It uses the network and runs only when asked.
  proxy status --json prints one object with the connection details, without the key;
  it exits 0 only when this kit's proxy answers.
  proxy start, proxy status and setup print the connection details for manual client setup.
  The key is shown in full only on an interactive terminal; models --show-key prints it.
  update keeps .proxykey, proxy/config.yaml, logs, backups, generated and node_modules.

Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
4 safe-start refused · 5 auth/identity failure ·
20 setup: at least one harness failed, the others are configured ·
130 setup aborted with Ctrl-C (unconfirmed checkbox batch not applied; prior applied answers remain)

Harnesses: ${ADAPTER_IDS.join(", ")}`;
}

/** `help`, `--help` on any command: exit 0. */
export async function run() {
  return { exitCode: 0, records: [stdoutLine(usageText())] };
}

/** A command name the CLI does not know: exit 2. */
export async function runUnknown({ positional }) {
  return { exitCode: 2, records: [stderrLine(`unknown command: ${positional[0] ?? "help"}`), stdoutLine(usageText())] };
}
