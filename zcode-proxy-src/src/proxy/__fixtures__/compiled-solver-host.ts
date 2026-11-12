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
import { waitForOwnedProcessExit } from "./solver-test-cleanup.js";

if (process.argv[2] === SOLVER_PROCESS_COMMAND) {
  main();
} else {
  const [backendModule, ...scenes] = process.argv.slice(2);
  configureCaptchaSolver({ backendModule, idleMs: 2000 });
  const results: string[] = [];
  let solverPid: number | undefined;
  try {
    // The public offline backend identifies the one generation this host owns.
    const label = JSON.parse(Buffer.from(await runCaptchaSolve("pid", "sgp", "p"), "base64").toString()).certifyId;
    solverPid = Number(label.slice("pid:".length));
    if (!Number.isSafeInteger(solverPid) || solverPid <= 0 || solverPid === process.pid) throw new Error("invalid owned solver pid");
    for (const scene of scenes) results.push(JSON.parse(Buffer.from(await runCaptchaSolve(scene, "sgp", "p"), "base64").toString()).certifyId);
  } finally {
    shutdownCaptchaSolver();
    // shutdown() is deliberately synchronous in production. Observe OS exit
    // here before this fixture exits and Windows removes its executable.
    if (solverPid !== undefined) await waitForOwnedProcessExit(solverPid);
  }
  console.log(`REPORT ${JSON.stringify({ command: solverProcessCommand(), execPath: process.execPath, pid: process.pid, solverPid, solverExited: true, results })}`);
}
