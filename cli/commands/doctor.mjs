// `zcode-kit doctor [--fix] [--harness <id>] [--json] [--upstream]` and
// `doctor --forget <harness>`. The manager's own `doctor` report is passed
// through verbatim and its FAIL/PASS/SKIP rows are counted with the adapter
// checks: exit 0 when nothing failed, 1 otherwise, 2 on a usage error.
// `--fix` output that interleaves with the manager start (whose stdio is the
// terminal's) is streamed through ctx.progress; the report is records.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireLock, beginTransaction, releaseLock } from "../../lib/transaction.mjs";
import { detectHarnesses } from "../../lib/detect.mjs";
import { ensureState } from "../../lib/state.mjs";
import {
  consentStatus, consentedForRepair, decisionFileChecks, forgetHarnessChoice, readHarnessChoices, storedDecisionIds,
} from "../harness-consent.mjs";
import { upstreamChecks } from "../upstream-config.mjs";
import { ADAPTER_IDS, assertNotCheckoutWrite, keepRecords, loadAdapter, managerPath, stderrLine, stdoutLine } from "./common.mjs";

/** @param {{ flags: Record<string, unknown> }} args */
export async function run({ flags }, ctx) {
  const records = [];
  try {
    if (flags.forget !== undefined) return await forgetDecision(flags, ctx, records);
    return await doctor(flags, ctx, records);
  } catch (err) {
    throw keepRecords(err, records);
  }
}

/**
 * `doctor --forget <id>`: remove one stored harness decision (readable or
 * not) through a transaction; the integration itself stays as it is and the
 * next setup asks again.
 */
async function forgetDecision(flags, { kit, env }, records) {
  const id = typeof flags.forget === "string" ? flags.forget.trim() : "";
  const stored = storedDecisionIds(kit);
  if (!id || (!ADAPTER_IDS.includes(id) && !stored.includes(id))) {
    records.push(stderrLine(`Usage: zcode-kit doctor --forget <harness> (known: ${ADAPTER_IDS.join(", ")}${stored.length ? `; stored: ${stored.join(", ")}` : ""})`));
    return { exitCode: 2, records };
  }
  if (!stored.includes(id)) {
    records.push(stdoutLine(`No stored decision for ${id}; nothing to forget.`));
    return { exitCode: 0, records };
  }
  assertNotCheckoutWrite(kit, env);
  ensureState(kit);
  acquireLock(kit.backupDir);
  let tx = null;
  let txId = null;
  let result;
  try {
    tx = beginTransaction(kit.backupDir, `zcode-kit doctor --forget ${id}`);
    result = forgetHarnessChoice(kit, tx, id);
  } finally {
    let finishErr = null;
    try { if (tx) txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(kit.backupDir, ".setup-lock"));
    if (finishErr) records.push(stderrLine(`WARN: recording the transaction failed (${finishErr.message})`));
  }
  if (result?.removed) {
    records.push(stdoutLine(`Decision for ${id} removed. Its integration is unchanged; the next zcode-kit setup asks again.`));
    if (txId) records.push(stdoutLine(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`));
  }
  return { exitCode: 0, records };
}

async function doctor(flags, ctx, records) {
  const { kit, env } = ctx;
  const ids = flags.harness ? String(flags.harness).split(",").map(s => s.trim()).filter(Boolean) : [...ADAPTER_IDS];
  for (const id of ids) {
    if (!ADAPTER_IDS.includes(id)) {
      records.push(stderrLine(`unknown harness "${id}". Known: ${ADAPTER_IDS.join(", ")}`));
      return { exitCode: 2, records };
    }
  }
  const detected = detectHarnesses(kit.home);
  if (flags.fix) {
    assertNotCheckoutWrite(kit, env);
    const loaded = Object.fromEntries(await Promise.all(ids.map(async id => [id, (await loadAdapter(id)).default])));
    // Repairs never widen consent: without --harness only harnesses the user
    // consented to (stored decision or an existing kit integration) are re-applied.
    const targets = flags.harness ? ids : consentedForRepair(kit, ids, detected, loaded);
    const adapters = targets.map(id => loaded[id]);
    const { repairManaged } = await import("../heal.mjs");
    const repaired = await repairManaged(kit, adapters, flags.json ? () => {} : ctx.progress);
    if (repaired.id && !flags.json) ctx.progress(`transaction ${repaired.id} recorded — undo with: zcode-kit rollback ${repaired.id}`);
  }
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const manager = managerPath(kit);
  if (flags.fix) {
    // A down or hung proxy is the most common reason to run doctor --fix; the
    // manager's safe start (with its hung-own proof) is the only repair path.
    // The identity comes from the lifecycle's read-state intent; the start
    // runs through the manager CLI, whose output (incl. the connection
    // details) streams to the terminal under the start's own timeout.
    const { createLifecycle } = await import(pathToFileURL(join(kit.root, "lib", "proxy-lifecycle.mjs")).href);
    if ((await createLifecycle({ root: kit.root, home: kit.home }).readState()).identity !== "ours") {
      const started = ctx.spawnSync(ctx.execPath, [manager, "start"], {
        encoding: "utf8", timeout: 180000, stdio: flags.json ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      const code = started.error || started.signal ? null : started.status;
      add("proxy start (--fix)", code === 0, code === 0 ? "proxy running and healthy"
        : `manager start exit ${code ?? "timeout"} — see zcode-kit proxy logs; next: zcode-kit proxy restart`);
      if (!flags.json) ctx.progress(code === 0 ? "doctor --fix: proxy started" : `doctor --fix: proxy start failed (exit ${code ?? "timeout"})`);
    }
  }
  const core = ctx.spawnSync(ctx.execPath, [manager, "doctor"], { encoding: "utf8", timeout: 25000 });
  if (core.error || core.signal) add("manager doctor completed", false, "manager check failed or timed out");
  // Parse the manager doctor output in BOTH modes: the text summary and exit
  // code must count the same FAILs the user is shown, not only adapter checks.
  const lines = (core.stdout ?? "").split("\n");
  if (core.status !== 0 && !core.error && !core.signal && !lines.some(line => /^FAIL\s+/.test(line))) {
    add("manager doctor completed", false, `manager check exited ${core.status ?? "unknown"} without a diagnostic failure result`);
  }
  for (const line of lines) {
    const m = line.match(/^(PASS|FAIL|SKIP)\s+(.+?)(?:\s+—\s+(.*))?$/);
    if (m) checks.push({ name: m[2], ok: m[1] === "PASS" ? true : m[1] === "FAIL" ? false : null, detail: m[3] ?? "" });
  }
  if (!flags.json) records.push({ kind: "text", stream: "stdout", text: core.stdout ?? "" });

  const choices = readHarnessChoices(kit);
  for (const id of ids) {
    const { default: adapter } = await loadAdapter(id);
    if (!flags.harness) {
      // A harness the user declined (or never answered for) is not a failed
      // check: only consented or kit-owned integrations are verified.
      const status = consentStatus(kit, id, adapter, Boolean(detected[id]), choices);
      if (!status.verify) {
        checks.push({ name: `${id}: integration`, ok: null, detail: status.detail });
        continue;
      }
    }
    for (const c of adapter.verify(kit)) checks.push({ name: `${id}: ${c.name}`, ok: c.ok, detail: c.detail ?? "" });
  }
  // The decision files themselves: an unreadable one silently blocks every
  // refresh of its harness, so it is reported with the way out.
  for (const c of decisionFileChecks(kit, ADAPTER_IDS, detected, choices)) {
    if (flags.harness && !ids.some((id) => c.name.startsWith(`${id}:`))) continue;
    checks.push(c);
  }
  // Opt-in: the only doctor check that talks to the vendor (two unauthenticated GETs).
  if (flags.upstream === true) {
    for (const c of await upstreamChecks(join(kit.root, "proxy", "config.yaml"))) checks.push(c);
  }

  const failed = checks.filter((c) => c.ok === false).length;
  const skipped = checks.filter((c) => c.ok === null).length;
  if (flags.json) {
    records.push({ kind: "json", value: { ok: failed === 0, failed, skipped, checks } });
  } else {
    for (const c of checks) {
      const tag = c.ok === null ? "SKIP" : c.ok ? "PASS" : "FAIL";
      records.push(stdoutLine(`${tag}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
    }
    records.push(stdoutLine(failed === 0 ? `doctor: ${skipped} skipped, ${failed} failed — OK` : `doctor: ${failed} check(s) failed`));
  }
  return { exitCode: failed === 0 ? 0 : 1, records };
}
