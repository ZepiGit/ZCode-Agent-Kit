/**
 * Test-only solver process entry for solver-process.test.ts: the real entry
 * (captcha-solver-process.ts) behind one of these modes, given before the
 * parent pid that the transport appends:
 *   ignore-sigterm          a generation that does not end on SIGTERM
 *   slow-start <ms>         a cold start that takes <ms> before the entry runs
 *   handshake-timeout <ms>  the entry waits only <ms> for its cap acknowledgement
 * With SOLVER_TEST_GENERATION_LOG set, each generation appends "<pid> <epoch ms>" there
 * when it starts.
 * With SOLVER_TEST_MODULE_LOG set, the process appends "<event> <n>" there,
 * n being how many heavy modules (the DOM runtime, the solve code, the
 * fixture backend) it has loaded: at start, when the cap acknowledgement
 * arrives (before the entry sees it), on a { type: "probe" } message and at
 * exit.
 */
import { appendFileSync } from "node:fs";
import { runSolverProcess } from "../captcha-solver-process.js";

const [mode, arg] = process.argv.slice(2);
if (process.env.SOLVER_TEST_GENERATION_LOG) appendFileSync(process.env.SOLVER_TEST_GENERATION_LOG, `${process.pid} ${Date.now()}\n`);
const moduleLog = process.env.SOLVER_TEST_MODULE_LOG;
if (moduleLog) {
  const heavy = () => Object.keys(require.cache).filter((key) => /happy-dom|captcha-happy|solver-backend/.test(key)).length;
  const note = (event: string) => appendFileSync(moduleLog, `${event} ${heavy()}\n`);
  note("start");
  process.on("message", (message: { type?: string } | null) => {
    if (message?.type === "cap") note("cap");
    if (message?.type === "probe") note("probe");
  });
  process.on("exit", () => note("exit"));
}
if (mode === "ignore-sigterm") process.on("SIGTERM", () => {});
if (mode === "slow-start") await Bun.sleep(Number(arg));
runSolverProcess(process.argv.slice(2), mode === "handshake-timeout" ? { handshakeTimeoutMs: Number(arg) } : {});
