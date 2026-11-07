// The S3 OMP leg's hosts: the generated OMP extension (written by the kit's
// own OMP adapter, exactly as `setup` writes it) loaded into stub Bun hosts
// (fixtures/omp-host.ts). See lib/omp-leg.mjs for the checks.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import omp from "../../../cli/adapters/omp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOST_SCRIPT = join(HERE, "..", "fixtures", "omp-host.ts");

/**
 * Generate the OMP extension into `<home>/.omp/agent/extensions/` through the
 * OMP adapter (the template filled with this root, key file, port and the
 * running Node as the pinned runtime). Returns its path.
 */
export function generateOmpExtension({ root, home, keyFile, port, key = "" }) {
  const agent = join(home, ".omp", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "models.yml"), "providers:\n");
  writeFileSync(join(agent, "config.yml"), "theme: dark\n");
  // proxySrc only locates the adapter's YAML parser: always this checkout's.
  const ctx = { root, home, keyFile, proxySrc: join(HERE, "..", "..", "..", "zcode-proxy-src"), port: () => port, key: () => key };
  omp.apply(ctx, { touch() {} }, () => {});
  return join(agent, "extensions", "zcode-proxy-autostart.ts");
}

/**
 * Start one stub host. It loads the extension, settles and reports READY;
 * `go()` fires the hook. The host exits when its stdin ends (`close()`, or
 * this process dying), so a loop that dies never leaves a host behind; callers
 * close or kill every host in `finally`.
 * POSIX hosts lead their own process group, so `killTree()` takes the host
 * and the preflight it spawned, as closing the harness's terminal does
 * (Windows: `taskkill /T`).
 */
export function startOmpHost({ bun, extension, env, cwd }) {
  const posix = process.platform !== "win32";
  const child = spawn(bun, [HOST_SCRIPT, extension], { env, cwd, stdio: ["pipe", "pipe", "pipe"], detached: posix, windowsHide: true });
  let out = "", err = "";
  let readyInfo = null, doneInfo = null;
  let onReady, onDone;
  const ready = new Promise((r) => { onReady = r; });
  const done = new Promise((r) => { onDone = r; });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (b) => {
    out = (out + b).slice(-64 * 1024);
    for (const m of out.matchAll(/^OMP_HOST_(READY|DONE) (\{.*\})$/gm)) {
      const info = JSON.parse(m[2]);
      if (m[1] === "READY" && !readyInfo) onReady((readyInfo = info));
      if (m[1] === "DONE" && !doneInfo) onDone((doneInfo = info));
    }
  });
  child.stderr.on("data", (b) => { err = (err + b).slice(-64 * 1024); });
  child.stdin.on("error", () => {});
  // The host measures its idle baseline only after its control channel has carried a line.
  try { child.stdin.write("arm\n"); } catch {}
  const exited = new Promise((r) => child.once("close", (code, signal) => { onReady(null); onDone(null); r({ code, signal }); }));
  child.once("error", () => { onReady(null); onDone(null); });
  return {
    pid: child.pid,
    ready, done, exited,
    stderr: () => err,
    stdout: () => out,
    go() { try { child.stdin.write("go\n"); } catch {} },
    close() { try { child.stdin.end(); } catch {} },
    killTree() {
      if (posix) { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } }
      else spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    },
  };
}
