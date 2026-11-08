// A start (ensure running) through the lifecycle module that SIGKILLs itself
// at one named step (tests/start-lock.test.mjs, seam 2): a harness closed in
// the middle of a start, at an exact point instead of by timing.
//   argv[2]  JSON { kitRoot, root, killAt, waitMs }
// Prints one JSON line with the outcome record if it was not killed.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cfg = JSON.parse(process.argv[2]);
const { createLifecycle } = await import(pathToFileURL(join(cfg.kitRoot, "lib", "proxy-lifecycle.mjs")).href);
const lifecycle = createLifecycle({
  root: cfg.root, home: join(cfg.root, "home"),
  stepHook: (step) => { if (step === cfg.killAt) process.kill(process.pid, "SIGKILL"); },
});
const record = await lifecycle.ensureRunning({ waitMs: cfg.waitMs ?? 30_000 });
process.stdout.write(JSON.stringify({ code: record.code, outcome: record.outcome }) + "\n");
