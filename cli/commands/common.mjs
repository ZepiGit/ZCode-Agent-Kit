// Shared pieces of the CLI command modules.
//
// A command module exports `run(args, ctx) → { exitCode, records }`:
//   args — the entry's parsed argv: `{ positional, flags, passthrough }`;
//   ctx  — the command ctx built by the entry:
//     kit       the kit context (cli/context.mjs createCtx: paths, key(), port());
//     env       the process environment;
//     execPath  the Node executable that runs the manager;
//     platform  process.platform;
//     terminal  { stdin, stderr }: the process streams, read for isTTY only
//               (update decides whether its setup re-run may ask);
//     spawnSync the child_process boundary;
//     runCommandSync the PATH-command boundary (lib/process.mjs: git, npm,
//               claude);
//     fetch     the HTTP boundary (the local proxy);
//     progress  (line) => void, a stdout line written at once, for output that
//               has to interleave with a child process sharing the terminal
//               or with a question asked on it (setup, update, integrate,
//               uninstall);
//     progressError (line) => void, the same on stderr.
// `help` runs before the kit context exists: its ctx has `kit: null`.
// The entry renders the records after `run` returns. Importing a command
// module has no side effects: no argv or env reads, no process.exit and no
// I/O at module scope (tests/cli-commands.test.mjs).
//
// Record kinds while the split is in its expand phase: the
// commands keep today's exact bytes, so they return verbatim text records.
// Later batches (40+) replace them with the output module's record kinds.
//   { kind: "text", stream: "stdout" | "stderr", text }  written verbatim
//   { kind: "json", value }                              JSON.stringify(value, null, 2) + "\n" on stdout
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveBun } from "../../lib/process.mjs";
import { proxyEnv } from "../../lib/proxy-env.mjs";

export const ADAPTER_IDS = ["omp", "pi", "claude-code", "codex", "opencode", "cline", "kilo-code", "aider", "continue", "goose"];

// setup: the kit is configured but at least one harness failed. A dedicated
// code (not 1, which Node uses for an uncaught error or a failed import) so
// the installers and `update` can tell a partial success from a crash.
export const EXIT_HARNESS_FAILED = 20;
// setup: interrupted with Ctrl-C; answers already given were applied.
export const EXIT_ABORTED = 130;

/**
 * `{ exitCode: 2 }` with the usage line for a harness id this kit has no adapter for, or null.
 * A missing or empty id gets its own message instead of printing the value as "undefined".
 */
export function unknownHarness(id) {
  if (ADAPTER_IDS.includes(id)) return null;
  const known = ADAPTER_IDS.join(", ");
  const message = id === undefined || id === ""
    ? `missing harness name. Known: ${known}`
    : `unknown harness "${id}". Known: ${known}`;
  return { exitCode: 2, records: [stderrLine(message)] };
}

/**
 * The proxy's own CLI (`bun run src/index.ts <args>` in zcode-proxy-src) with
 * the per-spawn proxy environment; returns the spawnSync result.
 */
export function proxyCli({ kit, env, spawnSync }, cliArgs, opts = {}) {
  return spawnSync(resolveBun(kit.root, env), ["run", "src/index.ts", ...cliArgs], {
    cwd: kit.proxySrc,
    env: proxyEnv(kit, env),
    encoding: "utf8",
    ...opts,
  });
}

export function loadAdapter(id) {
  return import(`../adapters/${id}.mjs`);
}

// A tarball install carries no .git; a source checkout always does. Writing
// user configs against a checkout root silently forks machine state when two
// copies exist (install dir + checkout share one home), so it needs an
// explicit opt-in. Read-only paths (doctor, status, --dry-run) stay open.
export function assertNotCheckoutWrite(kit, env) {
  if (kit.dryRun) return;
  if (!existsSync(join(kit.root, ".git"))) return;
  if (env.ZCODE_KIT_ALLOW_CHECKOUT === "1") return;
  throw new Error(
    `refusing to write user configs from a source checkout (${kit.root}) — ` +
      "run the installed copy instead, or set ZCODE_KIT_ALLOW_CHECKOUT=1 to proceed intentionally",
  );
}

/** One stdout line, as `console.log(text)` printed it. */
export const stdoutLine = (text) => ({ kind: "text", stream: "stdout", text: `${text}\n` });

/** One stderr line, as `console.error(text)` printed it. */
export const stderrLine = (text) => ({ kind: "text", stream: "stderr", text: `${text}\n` });

/** The proxy manager CLI of this kit. */
export const managerPath = (kit) => join(kit.root, "proxy", "zcode-proxy-manager.mjs");

/**
 * Attach the records a command had collected to the error that ends it, so
 * the entry prints them before the error line, as the inline command did.
 */
export function keepRecords(err, records) {
  if (err !== null && typeof err === "object" && !Array.isArray(err.records)) err.records = records;
  return err;
}

/** A request to the kit's own proxy with its key (throws when the key or config is unreadable). */
export function proxyFetch({ kit, fetch }, path, init = {}, timeoutMs = 8000) {
  const key = kit.key();
  const port = kit.port();
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
