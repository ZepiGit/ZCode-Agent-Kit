#!/usr/bin/env node
// Probe for the Job Object cap self-test (loop.test.mjs, Windows only):
//   alloc <MB>   commit <MB> of memory in 64 MB steps and hold it; exit 0 if all of it was granted
//   detach       start a detached grandchild that sleeps 60 s, print its pid and start time, exit 0
import { spawn } from "node:child_process";
import { identityOf } from "../../lib/process-identity.mjs";

const [mode, arg] = process.argv.slice(2);
if (mode === "alloc") {
  const held = [];
  try {
    for (let mb = 0; mb < Number(arg); mb += 64) held.push(Buffer.alloc(64 * 1024 * 1024, 1));
  } catch (err) {
    console.log(`ALLOC_FAILED ${held.length * 64} ${err.code ?? err.message}`);
    process.exit(3);
  }
  console.log(`ALLOC_OK ${held.length * 64}`);
  process.exit(0);
} else if (mode === "detach") {
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
  c.unref();
  // Its identity (pid + start time) while it surely runs: once the job kills
  // it, its pid may name a stranger (ticket 72).
  const { start } = identityOf(c.pid);
  console.log(`GRANDCHILD ${c.pid} ${start}`);
  process.exit(0);
} else {
  console.error("usage: job-probe.mjs alloc <MB> | detach");
  process.exit(2);
}
