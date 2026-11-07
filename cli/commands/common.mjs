// Shared pieces of the CLI command modules (spec §10 "CLI command modules").
//
// A command module exports `run(args, ctx) → { exitCode, records }`:
//   args — the entry's parsed argv: `{ positional, flags, passthrough }`;
//   ctx  — the command ctx built by the entry:
//     kit       the kit context (cli/context.mjs createCtx: paths, key(), port());
//     env       the process environment;
//     execPath  the Node executable that runs the manager;
//     spawnSync the child_process boundary;
//     fetch     the HTTP boundary (the local proxy);
//     progress  (line) => void, a stdout line written at once, for output that
//               has to interleave with a child process sharing the terminal.
// The entry renders the records after `run` returns. Importing a command
// module has no side effects: no argv or env reads, no process.exit and no
// I/O at module scope (tests/cli-commands.test.mjs).
//
// Record kinds while the split is in its expand phase (tickets 07/08): the
// commands keep today's exact bytes, so they return verbatim text records.
// Later batches (40+) replace them with the output module's record kinds.
//   { kind: "text", stream: "stdout" | "stderr", text }  written verbatim
//   { kind: "json", value }                              JSON.stringify(value, null, 2) + "\n" on stdout
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ADAPTER_IDS = ["omp", "pi", "claude-code", "codex", "opencode", "cline", "kilo-code", "aider", "continue", "goose"];

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
