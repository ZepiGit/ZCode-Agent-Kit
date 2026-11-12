// `zcode-kit auth status|login [zai|bigmodel] [--import] [--account ID] [--replace]|logout [--yes]`.
//   status  human text on a TTY; the proxy's /quota JSON unchanged when
//           stdout is not a TTY (or with `--json`, on a TTY too, in the same
//           bytes): exit 0 when the proxy answered (logged in or not), 1
//           when it did not;
//   login   the proxy CLI on the terminal; its exit code (no status: 1);
//   logout  removes only the kit proxy's credential store, with --yes;
//           without it, exit 2. Unknown subcommands: exit 2.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diagnoseQuota, quotaAuthValid } from "../quota-diagnostics.mjs";
import { keepRecords, proxyCli, proxyFetch, stderrLine, stdoutLine } from "./common.mjs";

/** @param {{ positional: string[], flags: Record<string, unknown> }} args */
export async function run({ positional, flags }, ctx) {
  const sub = positional[1] ?? "status";
  if (sub === "status") return status(flags, ctx);
  if (sub === "login") return login(positional, flags, ctx);
  if (sub === "logout") return logout(flags, ctx);
  return { exitCode: 2, records: [stderrLine(`unknown auth subcommand: ${sub}`)] };
}

async function status(flags, ctx) {
  let value;
  try {
    const res = await proxyFetch(ctx, "/quota");
    const body = await res.json().catch(() => null);
    // Snapshot errors use billing prefixes, not a top-level code. A balance
    // rejection is not a logout; unknown/partial errors are not auth proof.
    const diagnostic = diagnoseQuota(res.status, body);
    const loggedIn = quotaAuthValid(res.status, body, diagnostic);
    const errors = diagnostic.cause === "healthy" ? [] : [diagnostic.detail];
    const jwt = body?.jwt && Number.isFinite(body.jwt.ageHours) && Number.isFinite(body.jwt.issuedAt)
      ? { ageHours: body.jwt.ageHours, issuedAt: body.jwt.issuedAt } : null;
    value = { logged_in: loggedIn, errors, jwt };
    return { exitCode: 0, records: statusRecords(flags, ctx, value) };
  } catch (err) {
    value = { logged_in: false, error: String(err.message) };
    return { exitCode: 1, records: statusRecords(flags, ctx, value) };
  }
}

/** `5.2 h old` under two days, `3.1 d old` beyond. */
function tokenAge(ageHours) {
  return ageHours >= 48 ? `${(ageHours / 24).toFixed(1)} d old` : `${ageHours.toFixed(1)} h old`;
}

/**
 * The records for one /quota answer: today's exact JSON document when stdout
 * is not a TTY (or with `--json`), a human key/value block on a TTY — with a
 * WARN/FAIL block carrying what/why/next for the not-logged-in and
 * unreachable cases.
 */
function statusRecords(flags, ctx, value) {
  const tty = ctx?.terminal?.stdout?.isTTY === true;
  if (flags.json === true || !tty) return [{ kind: "json", value }];
  const pairs = [["Logged in", value.logged_in ? "yes" : "no"]];
  if (value.jwt && Number.isFinite(value.jwt.ageHours)) pairs.push(["Token", tokenAge(value.jwt.ageHours)]);
  const records = [{ kind: "kv", pairs }];
  if (value.error !== undefined) {
    records.push({ kind: "error", what: "the proxy did not answer", why: value.error, next: ["zcode-kit proxy start"] });
  } else if (!value.logged_in) {
    records.push({
      kind: "warn",
      what: "not logged in",
      ...(value.errors.length ? { why: value.errors.join(" ") } : {}),
      next: ["zcode-kit auth login zai"],
    });
  }
  return records;
}

function login(positional, flags, ctx) {
  if (flags.account !== undefined && (typeof flags.account !== "string" || !flags.account.trim())) {
    return { exitCode: 2, records: [stderrLine("--account requires an account ID.")] };
  }
  const cliArgs = ["auth", "login", positional[2] ?? "zai"];
  for (const option of ["import", "paste", "replace"]) if (flags[option] === true) cliArgs.push(`--${option}`);
  if (flags.account !== undefined) cliArgs.push("--account", String(flags.account));
  const res = proxyCli(ctx, cliArgs, { stdio: "inherit" });
  return { exitCode: res.status ?? 1, records: [] };
}

function logout(flags, { kit, env }) {
  const records = [];
  const credFile = env.ZCODE_PROXY_CREDENTIALS_PATH || join(kit.home, ".zcode-proxy", "credentials.json");
  records.push(stdoutLine(`This removes the kit proxy's effective credential store: ${credFile}`));
  records.push(stdoutLine("Your ZCode Desktop login and its data are NOT touched."));
  if (flags.yes !== true) {
    records.push(stdoutLine("Re-run with --yes to confirm."));
    return { exitCode: 2, records };
  }
  try {
    if (existsSync(credFile)) {
      rmSync(credFile);
      records.push(stdoutLine(`removed ${credFile} (proxy-only credential)`));
    } else {
      records.push(stdoutLine("no proxy credential present"));
    }
  } catch (err) {
    throw keepRecords(err, records);
  }
  return { exitCode: 0, records };
}
