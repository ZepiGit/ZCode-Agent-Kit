/**
 * Test-only solver process entry for solver-process.test.ts: the real entry
 * (captcha-solver-process.ts) behind one of these modes, given before the
 * parent pid that the transport appends:
 *   ignore-sigterm      a generation that does not end on SIGTERM
 *   slow-start <ms>     a cold start that takes <ms> before the entry runs
 * With SOLVER_TEST_GENERATION_LOG set, each generation appends "<pid> <epoch ms>" there
 * when it starts.
 */
import { appendFileSync } from "node:fs";
import { runSolverProcess } from "../captcha-solver-process.js";

const [mode, arg] = process.argv.slice(2);
if (process.env.SOLVER_TEST_GENERATION_LOG) appendFileSync(process.env.SOLVER_TEST_GENERATION_LOG, `${process.pid} ${Date.now()}\n`);
if (mode === "ignore-sigterm") process.on("SIGTERM", () => {});
if (mode === "slow-start") await Bun.sleep(Number(arg));
runSolverProcess();
