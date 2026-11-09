// `zcode-kit doctor [--fix] [--harness <id>] [--json] [--upstream]` and
// `doctor --forget <harness>`. The manager's checks come as its doctor
// record (lib/proxy-doctor.mjs, ticket 38), never as parsed text, and count
// with the adapter checks: exit 0 when nothing failed (WARN and SKIP never
// fail), 1 otherwise, 2 on a usage error. The report is ../doctor-report.mjs:
// each check once, grouped, one verdict (ticket 40, A-02).
// `--fix` progress (the repairs, the proxy start) goes to stderr as it
// happens; the report is records on stdout. The report builders load on use:
// every command module is imported by the CLI entry, `run` included, whose
// launcher process stays lean (S3 procPeak:launcher).
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
    const repaired = await repairManaged(kit, adapters, flags.json ? () => {} : ctx.progressError);
    if (repaired.id && !flags.json) ctx.progressError(`transaction ${repaired.id} recorded — undo with: zcode-kit rollback ${repaired.id}`);
  }
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  if (flags.fix) {
    // A down or hung proxy is the most common reason to run doctor --fix; the
    // lifecycle's safe start (with its hung-own proof) is the only repair
    // path. It runs in this process, as `zcode-kit proxy start` does, with its
    // progress on stderr and no connection details: doctor reports checks.
    const { createLifecycle } = await import(pathToFileURL(join(kit.root, "lib", "proxy-lifecycle.mjs")).href);
    const lifecycle = createLifecycle({ root: kit.root, home: kit.home, managerPath: managerPath(kit) });
    if ((await lifecycle.readState()).identity !== "ours") {
      const progress = flags.json ? null : await ctx.step("Proxy start (--fix)");
      const record = await lifecycle.ensureRunning();
      if (progress) (await import("../proxy-report.mjs")).finishStart(progress, record, lifecycle);
      const code = record.code;
      add("proxy start (--fix)", code === 0, code === 0 ? "proxy running and healthy"
        : `manager start exit ${code} — see zcode-kit proxy logs; next: zcode-kit proxy restart`);
    }
  }
  // The manager's checks arrive as its doctor record (lib/proxy-doctor.mjs of
  // this kit) and count with the adapter checks in BOTH modes, so the text
  // summary and the exit code count the same FAILs the user is shown.
  let core = null;
  try {
    const { managerDoctor } = await import(pathToFileURL(join(kit.root, "lib", "proxy-doctor.mjs")).href);
    core = await managerDoctor({ root: kit.root, home: kit.home, env });
  } catch {
    add("manager doctor completed", false, "manager check failed or timed out");
  }
  if (core) {
    if (core.code !== 0 && !core.checks.some((c) => c.ok === false)) {
      add("manager doctor completed", false, `manager check exited ${core.code ?? "unknown"} without a diagnostic failure result`);
    }
    for (const c of core.checks) checks.push(checkOf(c));
  }

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
    for (const c of adapter.verify(kit)) checks.push(checkOf({ ...c, name: `${id}: ${c.name}` }));
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

  const { doctorJson, doctorRecords } = await import("../doctor-report.mjs");
  const report = doctorJson(checks);
  records.push(...(flags.json ? [{ kind: "json", value: report }] : doctorRecords(checks)));
  return { exitCode: report.failed === 0 ? 0 : 1, records };
}

/**
 * A check as the report takes it: name, ok and detail (always a string, as
 * before), plus the optional warn/why/next a check record may carry.
 */
function checkOf(c) {
  const check = { name: c.name, ok: c.ok, detail: c.detail ?? "" };
  if (c.warn === true) check.warn = true;
  if (typeof c.why === "string" && c.why) check.why = c.why;
  if (c.next !== undefined && c.next !== null) check.next = c.next;
  return check;
}
