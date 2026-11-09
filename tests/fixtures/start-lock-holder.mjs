// A start-lock holder for tests/start-lock-signals.test.mjs (seam 2, real
// processes): it acquires the installation's start lock through the lifecycle
// module and keeps it until the test signals it or tells it what to do.
//   argv[2]  JSON { kitRoot, root, ownListener }
//   ownListener  a signal name: this process handles that signal itself (as
//                a host with its own Ctrl-C handling does) and keeps running
// stdout: one JSON line { pid, status, nonce } once the lock is held (or not),
// then "ok <command>" per command. stdin commands, one per line:
//   emit <SIGNAL>  deliver the signal through the process's own listeners
//                  (what libuv does for a Windows console control event:
//                  Ctrl-C = SIGINT, Ctrl-Break = SIGBREAK, console close = SIGHUP)
//   exit <code>    process.exit(code)
//   release        release the lock the normal way
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cfg = JSON.parse(process.argv[2]);
const { createLifecycle } = await import(pathToFileURL(join(cfg.kitRoot, "lib", "proxy-lifecycle.mjs")).href);
const lifecycle = createLifecycle({ root: cfg.root, home: join(cfg.root, "home") });
if (cfg.ownListener) process.on(cfg.ownListener, () => process.stdout.write(`handled ${cfg.ownListener}\n`));
const lock = lifecycle.acquireStartLock();
process.stdout.write(JSON.stringify({ pid: process.pid, status: lock.status, nonce: lock.record?.nonce ?? null }) + "\n");
const keepAlive = setInterval(() => {}, 1e6);
createInterface({ input: process.stdin }).on("line", (line) => {
  const [command, arg] = line.trim().split(/\s+/);
  if (command === "emit") process.emit(arg, arg);
  else if (command === "exit") process.exit(Number(arg));
  else if (command === "release") { lock.release(); clearInterval(keepAlive); }
  process.stdout.write(`ok ${command}\n`);
});
