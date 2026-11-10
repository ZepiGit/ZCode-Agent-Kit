#!/usr/bin/env node
// zcode-kit — install, diagnose, run, update, roll back the local ZCode
// provider integration for your own agent harnesses.
//
// Commands:
//   zcode-kit setup [--harness auto|<list>]      bootstrap + integrate detected harnesses
//   zcode-kit integrate <harness> [--dry-run]
//   zcode-kit run <harness> -- <args>            launch a harness wired to ZCode
//   zcode-kit doctor [--fix] [--harness <id>] [--json]   --fix also (re)starts a down or proven-hung proxy
//   zcode-kit status                              includes /health details (memory, captcha, solver)
//   zcode-kit proxy start|stop|restart|status|logs [n]
//   zcode-kit models [--json] [--show-key]
//   zcode-kit usage --json
//   zcode-kit auth status|login|logout
//   zcode-kit accounts [--json|--live]
//   zcode-kit accounts remove|pause|resume ID [--yes]
//   zcode-kit accounts unlock [--force]
//   zcode-kit accounts explain --model MODEL --operation OP
//   zcode-kit accounts doctor [--json] | accounts quota | accounts health [--json]
//   zcode-kit update [--version vX.Y.Z]          checkout: fast-forward; npm: npm install; release: verified tarball mirror
//   zcode-kit rollback [tx-id]
//   zcode-kit uninstall
//
// Exit codes: 0 ok · 1 checks failed · 2 runtime error · 3 port/foreign conflict ·
// 4 safe-start refused (lock/ownership) · 5 auth/identity failure · 20 setup:
// one harness failed while the others were configured · 130 setup aborted
// with Ctrl-C. Unknown harness names are errors, not no-ops. `setup` exits 0
// once the consented integrations are saved even if the optional live smoke
// request fails (it prints a warning).
//
// This file parses the arguments, refuses setup/update below the Node support
// floor, dispatches to the command modules (cli/commands/index.mjs) and
// renders the records they return. The commands themselves live in
// cli/commands/<name>.mjs (tests/cli-commands.test.mjs pins that no command
// body is left here).
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createCtx, kitRoot } from "./context.mjs";
import { runCommandSync } from "../lib/process.mjs";
import { nodeFloorRefusal } from "../lib/node-floor.mjs";
import { loadOutput, loadRenderRecords } from "../lib/term/load.mjs";
import { COMMANDS, UNKNOWN_COMMAND } from "./commands/index.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let passthrough = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" && passthrough === null) {
      passthrough = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (["fix", "json", "dry-run", "no-mcp", "yes", "help", "show-key", "installer", "verbose", "import", "paste", "replace", "live", "reask", "select", "upstream"].includes(a.slice(2))) flags[a.slice(2)] = true;
      else flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else positional.push(a);
  }
  return { positional, flags, passthrough };
}

const { positional, flags, passthrough } = parseArgs(process.argv.slice(2));
const command = positional[0] ?? "help";
const ROOT = kitRoot();

async function main() {
  if (command === "help" || flags.help) return dispatch(COMMANDS.help, null);
  const module = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : UNKNOWN_COMMAND;
  // ADR-0006: on a Node below the support floor, setup and update refuse
  // before anything else runs (no state read for writing, no lock, no proxy
  // stop, no download), so the existing installation stays as it was.
  if (module.nodeFloor === true) {
    const refusal = nodeFloorRefusal(command);
    if (refusal) {
      (await output()).error(refusal);
      return refusal.exit;
    }
  }
  return dispatch(module, createCtx(ROOT));
}

// The output module (lib/term/out.mjs) over the process streams, loaded on
// first use only: a command that returns no output-module records (`run`,
// whose preflight is memory-bound) never loads the renderer (ADR-0011 cond 3).
let outputPromise = null;
const output = () => (outputPromise ??= loadOutput());

/** The command ctx a command module runs with (cli/commands/common.mjs). */
function commandCtx(kit) {
  return {
    kit,
    env: process.env,
    execPath: process.execPath,
    platform: process.platform,
    // Lazy: touching process.stdin creates its handle; only update and the
    // connection details' reveal rule read it.
    terminal: { get stdin() { return process.stdin; }, get stdout() { return process.stdout; }, get stderr() { return process.stderr; } },
    spawnSync,
    runCommandSync,
    fetch: (...args) => fetch(...args),
    progress: (line) => console.log(line),
    progressError: (line) => console.error(line),
    // A Progress on stderr (design-language §4.10): animated on a TTY only.
    step: async (label, total) => (await output()).step(label, total),
  };
}

/**
 * Run a command module and render its records. A module that throws may
 * attach the records it had collected (`err.records`); they are printed
 * first, as the inline command printed them before failing.
 */
async function dispatch(module, kit) {
  let result;
  try {
    result = await module.run({ positional, flags, passthrough }, commandCtx(kit));
  } catch (err) {
    if (Array.isArray(err?.records)) await render(err.records);
    throw err;
  }
  await render(result.records);
  return result.exitCode;
}

/**
 * Text records are written verbatim and JSON records as one document; every
 * other kind goes through the output module, consecutive ones as one list so
 * check groups align (lib/term/out.mjs renderRecords).
 */
async function render(records) {
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const list = batch;
    batch = [];
    (await loadRenderRecords())(await output(), list);
  };
  for (const record of records) {
    if (record.kind === "text") { await flush(); (record.stream === "stderr" ? process.stderr : process.stdout).write(record.text); }
    else if (record.kind === "json") { await flush(); process.stdout.write(JSON.stringify(record.value, null, 2) + "\n"); }
    else batch.push(record);
  }
  await flush();
}

// Entry check, realpath-canonical: npm exposes global bins as symlinks
// (POSIX) or junctions (`npm i -g <folder>` on Windows), and argv[1] can carry
// arbitrary casing. import.meta.url is the realized path, so comparing it
// against the raw argv form silently no-ops the whole CLI. Compare realized
// against realized instead; a vanished entry falls through fail-closed.
const entryArg = process.argv[1] ?? "";
let entryReal = "";
try {
  entryReal = entryArg ? realpathSync(entryArg) : "";
} catch { /* nonexistent entry: nothing to run */ }
if (entryReal && import.meta.url === pathToFileURL(entryReal).href) {
  main().then((code) => process.exit(code ?? 0)).catch((err) => {
    console.error(`zcode-kit: ${err.message}`);
    process.exit(2);
  });
}
