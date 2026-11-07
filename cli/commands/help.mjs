// `zcode-kit help` / `--help` (exit 0) and an unknown command (the error on
// stderr, then the same usage text, exit 2). Runs before the kit context
// exists, so it reads nothing but its arguments.
import { HARNESS_SELECTION_ENV } from "../harness-consent.mjs";
import { ADAPTER_IDS, stderrLine, stdoutLine } from "./common.mjs";

function usageText() {
  return `zcode-kit — local ZCode provider for your own agent harnesses

  zcode-kit setup [--harness auto|omp,pi,...|none] [--select]   bootstrap + one y/n question per detected harness
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
  (update keeps .proxykey, proxy/config.yaml, logs, backups, generated and node_modules)
  (setup: auto asks "Configure ZCode as a provider ... in <HARNESS>? [y/n]" per detected harness;
   without a terminal, undecided harnesses are skipped — never configured silently)
  (setup: --harness <list> or ${HARNESS_SELECTION_ENV}=<list> selects harnesses without questions (unattended);
   none skips all; the selection also limits MCP registration; --no-mcp skips registration;
   answers are remembered under generated/harness-choices/ — --reask asks again;
   --select shows one numbered list instead: chosen = configured, the other detected ones = skipped)
  (doctor: --forget <harness> removes a stored decision (the integration stays; setup asks again);
   --upstream compares the kit's gateway with the provider config the ZCode client receives — network, opt-in)
  (proxy status --json: one object, connection details without the key; exit 0 only when this kit's proxy answers)
  (setup: --account-rotator y|n for unattended installs; --verbose for full installer output)
  (proxy start/status and setup print the connection details for manual client setup;
   the key is shown in full only on an interactive terminal — export: zcode-kit models --show-key)

Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
4 safe-start refused · 5 auth/identity failure ·
20 setup: at least one harness failed, the others are configured ·
130 setup aborted with Ctrl-C (answers already given were applied)

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
