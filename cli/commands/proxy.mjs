// `zcode-kit proxy start|stop|restart|status [--json] [--verbose]|logs [n]`.
// The lifecycle intents (lib/proxy-lifecycle.mjs, which owns identity,
// ownership proofs and the exit codes 0-5) run in this process, as the
// manager CLI runs them; the kit renders their outcome records through the
// output module (../proxy-report.mjs, ticket 40): progress, the result row
// and error blocks on stderr, the connection details once on stdout after a
// successful start or restart. `status` is shared with `zcode-kit status`;
// `logs` lives in ./logs.mjs. The report builders and the reveal rule load on
// use: the CLI entry imports every command module, `run` included, whose
// launcher process stays lean (S3 procPeak:launcher).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { managerPath, stderrLine } from "./common.mjs";
import { run as runLogs } from "./logs.mjs";

const SUBCOMMANDS = ["start", "stop", "restart", "status", "logs"];

/** A kit module of this installation (the tree whose manager the kit used to spawn). */
export const kitModule = (kit, rel) => import(pathToFileURL(join(kit.root, ...rel.split("/"))).href);

/** The lifecycle of this kit, with this kit's manager CLI as the respawn hook target. */
export async function lifecycleOf({ kit }) {
  const { createLifecycle } = await kitModule(kit, "lib/proxy-lifecycle.mjs");
  return createLifecycle({ root: kit.root, home: kit.home, managerPath: managerPath(kit) });
}

const report = () => import("../proxy-report.mjs");

/** The key, only when the connection details may show it (cli/connection-details.mjs rule). */
async function revealedKey(lifecycle, { terminal, env }) {
  const { shouldRevealKey } = await import("../connection-details.mjs");
  if (!shouldRevealKey({ stdin: terminal.stdin, stdout: terminal.stdout, env })) return null;
  try { return lifecycle.readKey(); } catch { return null; }
}

/** `status` / `proxy status`: the status record rendered, or its --json document. */
export async function statusReport({ flags }, ctx) {
  const lifecycle = await lifecycleOf(ctx);
  const { readProxyStatus, statusDocument, statusExitCode } = await kitModule(ctx.kit, "lib/proxy-status.mjs");
  const status = await readProxyStatus({ lifecycle, fetch: ctx.fetch });
  if (flags.json === true) return { exitCode: statusExitCode(status), records: [{ kind: "json", value: statusDocument(status) }] };
  const key = status.connection?.facts ? await revealedKey(lifecycle, ctx) : null;
  return (await report()).statusRecords(status, { key, reveal: key !== null, verbose: flags.verbose === true });
}

/** The connection details after a successful start, re-proven right before they are shown. */
async function cardAfterStart(lifecycle, { flags }, ctx) {
  const { readConnectionFacts } = await kitModule(ctx.kit, "lib/proxy-status.mjs");
  const source = (await lifecycle.healthIdentify(2500)) === "ours" ? "running" : "configured";
  let connection;
  try {
    connection = { source, facts: await readConnectionFacts({ lifecycle, fetch: ctx.fetch, source }), error: null };
  } catch (err) {
    connection = { source, facts: null, error: String(err?.message ?? err) };
  }
  const key = connection.facts ? await revealedKey(lifecycle, ctx) : null;
  return (await report()).connectionRecords(connection, { key, reveal: key !== null, verbose: flags.verbose === true });
}

/**
 * Run one intent under a Progress. An intent that throws (an unexpected
 * error, e.g. an unreadable config) ends as an error block with exit 1, the
 * manager CLI's `manager error: …` code.
 */
async function step(ctx, label, intent, finishName, lifecycle, failure) {
  const progress = await ctx.step(label);
  let record;
  try {
    record = await intent();
  } catch (err) {
    progress.fail({ what: failure, why: String(err?.message ?? err), next: ["zcode-kit doctor"], exit: 1 });
    return { ok: false, code: 1 };
  }
  return { ok: (await report())[finishName](progress, record, lifecycle), code: record.code };
}

async function start(args, ctx, lifecycle) {
  const started = await step(ctx, "Proxy start", () => lifecycle.ensureRunning(), "finishStart", lifecycle, "The proxy did not start");
  if (!started.ok) return { exitCode: started.code, records: [] };
  return { exitCode: 0, records: await cardAfterStart(lifecycle, args, ctx) };
}

const stop = (ctx, lifecycle) => step(ctx, "Proxy stop", () => lifecycle.stop(), "finishStop", lifecycle, "The proxy did not stop");

/** @param {{ positional: string[], flags: Record<string, unknown> }} args */
export async function run(args, ctx) {
  const sub = args.positional[1];
  if (!SUBCOMMANDS.includes(sub)) {
    return { exitCode: 2, records: [stderrLine("Usage: zcode-kit proxy start|stop|restart|status|logs [n]")] };
  }
  if (sub === "logs") return runLogs(args, ctx);
  if (sub === "status") return statusReport(args, ctx);
  const lifecycle = await lifecycleOf(ctx);
  if (sub === "start") return start(args, ctx, lifecycle);
  const stopped = await stop(ctx, lifecycle);
  if (sub === "stop" || !stopped.ok) return { exitCode: stopped.code, records: [] };
  // restart = stop, then start; a refused stop ends it (as the lifecycle's restart).
  return start(args, ctx, lifecycle);
}
