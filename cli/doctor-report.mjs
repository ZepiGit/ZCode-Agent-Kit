// The `zcode-kit doctor` report. Pure: a list of checks in →
// output-module records (or the JSON
// document) out. The command (./commands/doctor.mjs) collects the checks; the
// entry renders the records through the output module.
//
// A check is `{ name, ok, detail?, warn?, why?, next? }`:
//   ok    true (passed), false (failed: counts toward exit 1) or null (skipped);
//   warn  true on a passed check that needs attention: WARN, exit 0.
// The status is derived so that a failed check is never WARN: `ok === false`
// is FAIL whatever else the check says, and WARN
// needs `ok === true`. WARN never changes the exit code.
//
// The text report: a lead line with the problem count when anything failed,
// the checks once each, grouped under section headers
// (Runtime, Proxy, Account, Integrations, Upstream) in their original order,
// and one verdict line last. Off a TTY every row keeps the grammar
// `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` with today's check names.
// Every FAIL carries why/next lines; the check's own win over the defaults.
//
// The JSON document is today's `{ ok, failed, skipped, checks }` plus the
// additive `warned` count and a `status` on every check ("pass" | "fail" |
// "warn" | "skip"): the JSON value that WARN adds.
import { ADAPTER_IDS } from "./commands/common.mjs";

/** "pass" | "fail" | "warn" | "skip" for one check. */
export function checkStatus(check) {
  if (check?.ok === false) return "fail";
  if (check?.ok === null || check?.ok === undefined) return "skip";
  return check.warn === true ? "warn" : "pass";
}

/** Counts by status, and the exit code: 1 when any check failed, else 0 (WARN and SKIP never fail). */
export function doctorCounts(checks) {
  const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const c of checks) counts[checkStatus(c)]++;
  return { counts, exitCode: counts.fail === 0 ? 0 : 1 };
}

/** `doctor --json`: today's document, keys only added (C2). */
export function doctorJson(checks) {
  const { counts } = doctorCounts(checks);
  return {
    ok: counts.fail === 0,
    failed: counts.fail,
    skipped: counts.skip,
    warned: counts.warn,
    checks: checks.map((c) => ({ ...c, status: checkStatus(c) })),
  };
}

const GROUPS = ["Runtime", "Proxy", "Account", "Integrations", "Upstream"];

/** The manager's check names by group; anything else from the manager is a Proxy check. */
const MANAGER_GROUP = {
  "bun available": "Runtime",
  "config exists": "Runtime",
  "key file exists": "Runtime",
  "proxy source installed": "Runtime",
  "proxy env overrides": "Runtime",
  "mcp bridge installed": "Runtime",
  "mcp bridge deps": "Runtime",
  "credentials store": "Account",
  "account auth valid": "Account",
  "start-plan JWT age (info)": "Account",
  "omp provider registered": "Integrations",
  "extension installed": "Integrations",
  "omp integration": "Integrations",
  "claude adapter artifact": "Integrations",
  "codex adapter artifact": "Integrations",
  "harness decisions": "Integrations",
};

function groupOf(name) {
  if (Object.hasOwn(MANAGER_GROUP, name)) return MANAGER_GROUP[name];
  if (/^upstream\b/.test(name)) return "Upstream";
  if (/^[a-z0-9-]+: /.test(name)) return "Integrations";
  return "Proxy";
}

/** The default why/next of a FAIL row, by check name (the check's own win). */
function remedy({ name, detail = "" }) {
  const harness = name.match(/^([a-z0-9-]+): (.*)$/);
  if (harness) {
    const [, id, rest] = harness;
    if (rest === "decision file") {
      return { why: "an unreadable decision counts as undecided, so the harness is never refreshed", next: [`zcode-kit doctor --forget ${id}`] };
    }
    if (ADAPTER_IDS.includes(id)) {
      return { why: `the ${id} configuration does not match what the kit wrote`, next: [`zcode-kit integrate ${id}`] };
    }
  }
  if (/^upstream\b/.test(name)) {
    return { why: "the ZCode client's provider config no longer matches this kit's gateway", next: ["zcode-kit update"] };
  }
  switch (name) {
    case "bun available":
      return { why: "the local proxy runs on Bun and none could be started: install Bun, or set ZCODE_KIT_BUN to its executable path", next: ["zcode-kit doctor"] };
    case "config exists":
    case "key file exists":
      return { why: "setup has not run here, or its files were removed", next: ["zcode-kit setup"] };
    case "proxy source installed":
      return { why: "the proxy's dependencies are not installed", next: ["zcode-kit setup"] };
    case "mcp bridge installed":
    case "mcp bridge deps":
      return { why: "the MCP bridge is not built or its dependencies are missing", next: ["zcode-kit setup"] };
    case "proxy env overrides":
      return { why: "the kit-managed proxy ignores these variables, so they do not do what they seem to: unset them", next: ["zcode-kit doctor"] };
    case "credentials store":
      return { why: "no ZCode login is stored, or this machine cannot decrypt it", next: ["zcode-kit auth login zai"] };
    case "account auth valid":
      return { why: "the account endpoint did not accept the stored login", next: ["zcode-kit auth login zai"] };
    case "proxy reachable + identity":
      if (detail === "health=foreign") {
        return { why: "another service answers on the configured port; the kit never stops a service it did not start", next: ["zcode-kit proxy status"] };
      }
      if (detail === "health=nokey") return { why: "the local proxy key is missing, so the proxy's identity cannot be proven", next: ["zcode-kit setup"] };
      return { why: "no proxy of this kit answers on the configured port", next: ["zcode-kit proxy start", "zcode-kit doctor --fix"] };
    case "proxy start (--fix)":
      return { why: "the proxy did not start", next: ["zcode-kit proxy logs 50", "zcode-kit proxy restart"] };
    case "manager doctor completed":
      return { why: "the proxy manager's checks did not finish", next: ["zcode-kit proxy logs 50"] };
    case "omp provider registered":
    case "extension installed":
      return { why: "the OMP integration is incomplete", next: ["zcode-kit integrate omp"] };
    case "harness decisions":
      return { why: "every harness counts as undecided while the stored decisions cannot be read: fix the folder's permissions", next: ["zcode-kit doctor"] };
    default:
      return { why: "this check did not pass", next: ["zcode-kit doctor --fix"] };
  }
}

const asList = (next) => (next === undefined || next === null || next === "" ? [] : Array.isArray(next) ? next : [next]);

/** One check record for the output module. */
function checkRecord(check) {
  const status = checkStatus(check);
  const record = { kind: "check", status, name: check.name };
  if (check.detail) record.detail = check.detail;
  if (status === "fail" || status === "warn") {
    const fallback = status === "fail" ? remedy(check) : {};
    const why = check.why ?? fallback.why;
    const next = asList(check.next).length ? asList(check.next) : asList(fallback.next);
    if (why) record.why = why;
    if (next.length) record.next = next;
  }
  return record;
}

/** The text report's records. */
export function doctorRecords(checks) {
  const { counts, exitCode } = doctorCounts(checks);
  const records = [];
  if (counts.fail > 0) records.push({ kind: "lead", counts: { fail: counts.fail, warn: counts.warn } }, { kind: "blank" });
  for (const group of GROUPS) {
    const rows = checks.filter((c) => groupOf(c.name) === group);
    if (!rows.length) continue;
    records.push({ kind: "heading", title: group }, ...rows.map(checkRecord), { kind: "blank" });
  }
  records.push({ kind: "verdict", label: "doctor", counts, exit: exitCode });
  return records;
}
