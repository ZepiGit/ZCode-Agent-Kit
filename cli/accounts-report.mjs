// The `zcode-kit accounts` reports (ticket 46; design-language §4.7, §7; ADR-0001).
// Pure: the proxy CLI's redacted JSON in → output-module records out. The
// command (./commands/accounts.mjs) collects the documents; the entry renders
// the records through the output module.
//
// The proxy CLI owns the account store: every fact here comes from its
// already-redacted JSON (`auth accounts --json`, `auth accounts health
// --json`); this module adds no field of its own and never reads the store,
// a credential or a token (B2). `accounts --json` and `accounts health
// --json` keep forwarding the proxy CLI verbatim (C2), so the JSON documents
// are byte-stable; only the text views render here.
//
// The tables follow design-language §4.7: a header row, an active-row marker
// `*` explained in a footer line, one number format — thousands without
// separators, `69 %`, local `HH:MM` reset times — and no truncation in a
// pipe. Every next step names `zcode-kit …`, never the standalone binary
// (A-19), and the words `no quota data`/`auth error` replace the machine
// codes `no_quota_data`/`auth_error` in text (the JSON keeps them verbatim).

const SECONDS_PER_DAY = 86_400;

/** `0`/`69` from `percentRemaining`; the percent sign is added by the caller. */
function roundedPercent(balance) {
  const p = balance?.percentRemaining;
  return typeof p === "number" && Number.isFinite(p) ? Math.round(p) : null;
}

/** Local `HH:MM` from epoch seconds (design-language §4.7), as the proxy CLI prints it. */
function clock(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `GLM Coding Lite 4120/6000 (69 %) resets 00:00` — one number format (A-27). */
export function formatBalance(balance) {
  const left = `${balance?.remainingUnits ?? "?"}/${balance?.totalUnits ?? "?"}`;
  const pct = roundedPercent(balance) === null ? "" : ` (${roundedPercent(balance)} %)`;
  const reset = typeof balance?.expiresAt === "number" ? ` resets ${clock(balance.expiresAt)}` : "";
  return `${balance?.showName ?? "package"} ${left}${pct}${reset}`;
}

/** `used 14h ago` / `never used`, measured against the report's own asOf (deterministic). */
export function ageText(lastUsedAt, nowSeconds) {
  if (typeof lastUsedAt !== "number" || !Number.isFinite(lastUsedAt)) return "never used";
  const seconds = Math.max(0, Math.floor((nowSeconds - lastUsedAt) / 1000));
  if (seconds < 60) return `used ${seconds}s ago`;
  if (seconds < 3600) return `used ${Math.floor(seconds / 60)}m ago`;
  if (seconds < SECONDS_PER_DAY) return `used ${Math.floor(seconds / 3600)}h ago`;
  return `used ${Math.floor(seconds / SECONDS_PER_DAY)}d ago`;
}

const WORD_VERDICTS = { no_quota_data: "no quota data", auth_error: "auth error" };
/** A verdict word for text: the machine codes `no_quota_data`/`auth_error` read as words (A-19). */
export const verdictWord = (verdict) => WORD_VERDICTS[verdict] ?? String(verdict ?? "unknown");

/** The QUOTA column: balances with one number format, or the report's own reason. */
function quotaText(account) {
  if (account?.duplicateOf) return `same login as ${account.duplicateOf}`;
  if (Array.isArray(account?.balances) && account.balances.length) return account.balances.map(formatBalance).join(", ");
  if (account?.verdict === "no_quota_data") return "no quota data";
  return (Array.isArray(account?.errors) ? account.errors : []).join(", ");
}

const isDoc = (doc, key) => Boolean(doc) && typeof doc === "object" && Array.isArray(doc[key]);

/** The offline list table: ACCOUNT/LABEL/PROVIDER/PLAN/STATE with the active marker. */
export function listRecords(doc) {
  const rows = doc.accounts.map((a) => ({
    id: String(a?.id ?? ""),
    label: String(a?.label ?? ""),
    provider: String(a?.provider ?? ""),
    plan: String(a?.plan ?? ""),
    state: String(a?.state ?? ""),
  }));
  const active = rows.some((row) => row.state === "active");
  return {
    records: rows.length === 0
      ? [
          { kind: "result", status: "info", label: "No accounts configured." },
          { kind: "next", commands: ["zcode-kit auth login zai --account ID"] },
        ]
      : [{
          kind: "table",
          fields: [
            { key: "id", title: "ACCOUNT" },
            { key: "label", title: "LABEL", truncate: true },
            { key: "provider", title: "PROVIDER" },
            { key: "plan", title: "PLAN" },
            { key: "state", title: "STATE" },
          ],
          rows,
          ...(active ? { marker: (row) => row.state === "active", footer: "* = active account" } : {}),
        }],
  };
}

/** The combined health table: ACCOUNT/VERDICT/PLAN/QUOTA/USED, usable in the footer. Records only; the exit code stays the proxy CLI's. */
export function healthRecords(doc) {
  const nowSeconds = Math.floor(Date.parse(doc.asOf) / 1000);
  const rows = doc.accounts.map((a) => ({
    id: String(a?.id ?? ""),
    verdict: verdictWord(a?.verdict),
    plan: String(a?.plan ?? ""),
    quota: quotaText(a),
    used: ageText(a?.lastUsedAt, nowSeconds),
  }));
  const footerParts = [`usable: ${doc.summary.usable} of ${doc.summary.total}`];
  if (doc.activeAccountId) footerParts.push("* = active account");
  const records = [];
  if (doc.proxy.reachable === false) {
    records.push({
      kind: "error",
      what: "live data unavailable",
      why: "the kit proxy is not reachable, so runtime state and quota are unknown",
      next: ["zcode-kit proxy start"],
    });
  }
  records.push({
    kind: "table",
    fields: [
      { key: "id", title: "ACCOUNT" },
      { key: "verdict", title: "VERDICT" },
      { key: "plan", title: "PLAN" },
      { key: "quota", title: "QUOTA", truncate: true },
      { key: "used", title: "USED" },
    ],
    rows,
    ...(doc.activeAccountId ? { marker: (row) => row.id === doc.activeAccountId } : {}),
    footer: footerParts.join("; "),
  });
  if (Array.isArray(doc.summary.totals) && doc.summary.totals.length) {
    records.push({ kind: "kv", pairs: [["totals", doc.summary.totals.map(formatBalance).join(", ")]] });
  }
  return { records };
}

/**
 * Turn one captured proxy-CLI answer into records. The child's stderr stayed
 * inherited (diagnostics reach stderr as before); its stdout is the JSON
 * parsed here. A proxy CLI that prints no readable JSON is an error block
 * with a next step, never a bare code (Story 95).
 */
export function proxyAccountRecords(cliArgs, { exitCode, stdout }) {
  let doc = null;
  try { doc = JSON.parse(stdout); } catch { /* no readable JSON */ }
  const kind = cliArgs.includes("health") ? "health" : "accounts";
  if (kind === "health" ? !isDoc(doc, "accounts") || !doc.summary : !isDoc(doc, "accounts")) {
    return {
      exitCode: exitCode ?? 1,
      records: [{
        kind: "error",
        what: kind === "health" ? "the account health report could not be read" : "the account list could not be read",
        why: stdout.trim() ? "the proxy CLI printed no readable JSON document" : "the proxy CLI produced no output",
        next: ["zcode-kit accounts doctor"],
      }],
    };
  }
  if (doc.error) {
    return {
      exitCode: exitCode ?? 1,
      records: [{
        kind: "error",
        what: kind === "health" ? "the account store could not be read" : "the account list could not be read",
        why: String(doc.error.message ?? doc.error.code ?? "unknown error"),
        next: ["zcode-kit accounts doctor"],
      }],
    };
  }
  return { exitCode: exitCode ?? 1, ...(kind === "health" ? healthRecords(doc) : listRecords(doc)) };
}
