/**
 * Test-only compile entry for solver-process.test.ts: a stand-in proxy built
 * with `bun build --compile`, like the shipped binary. Started with the
 * self-exec subcommand it runs the proxy's own CLI route (index.ts main());
 * otherwise it plays the proxy: the default dispatcher solves the scenes in
 * argv with the backend module in argv[2] and prints one JSON report.
 */
import { main } from "../../index.js";
import { configureCaptchaSolver, runCaptchaSolve, shutdownCaptchaSolver, solverProcessCommand } from "../captcha-solver.js";
import { SOLVER_PROCESS_COMMAND } from "../solver-process-command.js";

if (process.argv[2] === SOLVER_PROCESS_COMMAND) {
  main();
} else {
  const [backendModule, ...scenes] = process.argv.slice(2);
  configureCaptchaSolver({ backendModule, idleMs: 2000 });
  const results: string[] = [];
  for (const scene of scenes) results.push(JSON.parse(Buffer.from(await runCaptchaSolve(scene, "sgp", "p"), "base64").toString()).certifyId);
  shutdownCaptchaSolver();
  console.log(`REPORT ${JSON.stringify({ command: solverProcessCommand(), execPath: process.execPath, pid: process.pid, results })}`);
}
