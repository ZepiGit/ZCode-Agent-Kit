// The CLI's dispatch table: every command name → its command module
// (`run(args, ctx) → { exitCode, records }`, see ./common.mjs). A module
// that exports `nodeFloor = true` is refused by the entry below the Node
// support floor before the kit context exists (ADR-0006).
import * as accounts from "./accounts.mjs";
import * as auth from "./auth.mjs";
import * as doctor from "./doctor.mjs";
import * as help from "./help.mjs";
import * as integrate from "./integrate.mjs";
import * as models from "./models.mjs";
import * as proxy from "./proxy.mjs";
import * as rollback from "./rollback.mjs";
import * as run from "./run.mjs";
import * as setup from "./setup.mjs";
import * as status from "./status.mjs";
import * as uninstall from "./uninstall.mjs";
import * as update from "./update.mjs";
import * as usage from "./usage.mjs";
import * as version from "./version.mjs";

export const COMMANDS = Object.freeze({
  help, version, setup, integrate, run, doctor, status, proxy, models, usage, auth, accounts, update, rollback, uninstall,
});

/** A command name the table does not know: the error and the usage text, exit 2. */
export const UNKNOWN_COMMAND = Object.freeze({ run: help.runUnknown });
