/**
 * captcha-solver-worker.ts — thread entry that owns the happy-dom solver.
 *
 * The solver blocks its thread (sync XHR parks in Atomics.wait) and retains
 * guest DOM state, so it must never share the HTTP server's thread: the host
 * dispatcher (captcha-solver.ts) talks to this worker by message and can
 * terminate it at a hard deadline, which also returns its heap.
 *
 * Protocol (host → worker):
 *   { type: "init", backendModule: string | null }
 *   { type: "solve", id, scene, region, prefix }
 * (worker → host):
 *   { type: "result", id, ok: true, param, heapUsedMB, scripts? }
 *   { type: "result", id, ok: false, error: { category, message }, heapUsedMB, scripts? }
 *   { type: "fatal", name }   (error class only)
 * `scripts` = SDK bundle fingerprints of the attempt (basename/opaque id + sha256).
 *
 * This file is an extra `bun build --compile` entrypoint (see package.json):
 * without it the compiled binary cannot resolve the worker.
 */
import fs from "node:fs";
import { describeGuestError, hasGuestSourceFrame } from "../runtime/guest-error.js";
import { classifyCaptchaError } from "./captcha-token.js";

interface SolverBackend {
  solveTraceless(opts: { scene: string; region: string; prefix: string }): Promise<string>;
  lastCaptchaSdkScripts?: () => ReadonlyArray<{ filename: string; sha256: string | null }> | null;
}

// happy-dom aliases window members (self, postMessage, onmessage,
// addEventListener, ...) onto this thread's globalThis while a solve runs.
// Bind the host channel once, before any window exists.
const post: (message: unknown) => void = globalThis.postMessage.bind(globalThis);
const listen = globalThis.addEventListener.bind(globalThis);

let backendModule: string | null = null;
let backend: Promise<SolverBackend> | null = null;

// Guest SDK callbacks escape to the process level, and only process handlers
// keep a Bun worker alive. A guest error fails nothing by itself — the solve's
// own stall/timeout decides. Anything else is a fault in our code: report it
// and exit so the host starts a clean generation. Same strict provenance as
// the serve boundary: a guest URL must be on a stack frame, not in a message.
// The fatal report carries only the error class — messages and stacks can
// hold tokens or guest payloads.
function onUncaught(err: unknown): void {
  if (hasGuestSourceFrame(err)) {
    try { fs.writeSync(2, `[captcha-guest-error] ${describeGuestError(err)}\n`); } catch {}
    return;
  }
  const name = (err as Error | null)?.name;
  try { post({ type: "fatal", name: typeof name === "string" && /^\w{1,40}$/.test(name) ? name : "Error" }); } catch {}
  process.exit(1);
}
process.on("uncaughtException", onUncaught);
process.on("unhandledRejection", onUncaught);

async function solve(id: number, scene: string, region: string, prefix: string): Promise<void> {
  let mod: SolverBackend | null = null;
  const report = () => {
    try { return mod?.lastCaptchaSdkScripts?.()?.map(({ filename, sha256 }) => ({ filename, sha256 })) ?? undefined; }
    catch { return undefined; }
  };
  try {
    // The literal specifier keeps captcha-happy inside the compiled worker
    // bundle; the module override exists only for test fixtures.
    backend ??= backendModule
      ? (import(backendModule) as Promise<SolverBackend>)
      : (import("./captcha-happy.js") as Promise<SolverBackend>);
    mod = await backend;
    const param = await mod.solveTraceless({ scene, region, prefix });
    post({
      type: "result", id, ok: true, param, scripts: report(),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    });
  } catch (err) {
    // Only the category and the host-built message cross the thread boundary.
    post({
      type: "result", id, ok: false, scripts: report(),
      error: {
        category: classifyCaptchaError(err),
        message: err instanceof Error && typeof err.message === "string" ? err.message.slice(0, 4096) : "captcha solver failure",
      },
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    });
  }
}

listen("message", (event: MessageEvent) => {
  const msg = event.data as { type?: string; [key: string]: unknown };
  if (msg?.type === "init") {
    backendModule = typeof msg.backendModule === "string" ? msg.backendModule : null;
  } else if (msg?.type === "solve") {
    void solve(Number(msg.id), String(msg.scene), String(msg.region), String(msg.prefix));
  }
});
