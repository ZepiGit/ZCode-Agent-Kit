/**
 * captcha-solver-generation.ts — one solver generation: it owns the happy-dom
 * solver and answers the host dispatcher (captcha-solver.ts) over a channel.
 * Two entries run it: captcha-solver-worker.ts (the thread transport, a Bun
 * Worker) and captcha-solver-process.ts (the solver process). The
 * channel is the only difference between them.
 *
 * The solver blocks its thread (sync XHR parks in Atomics.wait) and retains
 * guest DOM state, so it must never share the HTTP server's thread: the host
 * talks to it by message and can end the generation at a hard deadline, which
 * also returns its heap.
 *
 * Protocol (host → generation):
 *   { type: "init", backendModule: string | null }
 *   { type: "solve", id, scene, region, prefix }
 * (generation → host):
 *   { type: "result", id, ok: true, param, heapUsedMB, footprintMB?, scripts? }
 *   { type: "result", id, ok: false, error: { category, message }, heapUsedMB, footprintMB?, scripts? }
 *   { type: "fatal", name }   (error class only)
 * `scripts` = SDK bundle fingerprints of the attempt (basename/opaque id + sha256).
 * `footprintMB` = the generation's own memory footprint after the solve; only
 * the solver process reports it (a thread has no footprint of its own).
 */
import fs from "node:fs";
import { describeGuestError, hasGuestSourceFrame } from "../runtime/guest-error.js";
import { classifyCaptchaError, describeCaptchaFailure } from "./captcha-token.js";

interface SolverBackend {
  solveTraceless(opts: { scene: string; region: string; prefix: string }): Promise<string>;
  lastCaptchaSdkScripts?: () => ReadonlyArray<{ filename: string; sha256: string | null }> | null;
}

/** How a generation reaches its host. Bound before any window exists (happy-dom aliases window members onto globalThis). */
export interface GenerationChannel {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
  /** The generation's own memory footprint in MB, where it has one (the solver process). */
  footprintMB?(): number;
}

/** Serves one solver generation over `channel`: the guest error boundary, then init/solve messages. */
export function serveSolverGeneration(channel: GenerationChannel): void {
  const post = channel.post;
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
    const memory = () => ({
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      ...(channel.footprintMB ? { footprintMB: channel.footprintMB() } : {}),
    });
    try {
      // The literal specifier keeps captcha-happy inside the compiled
      // bundle; the module override exists only for test fixtures.
      backend ??= backendModule
        ? (import(backendModule) as Promise<SolverBackend>)
        : (import("./captcha-happy.js") as Promise<SolverBackend>);
      mod = await backend;
      const param = await mod.solveTraceless({ scene, region, prefix });
      post({ type: "result", id, ok: true, param, scripts: report(), ...memory() });
    } catch (err) {
      // Only the category and the host-built message cross to the host.
      post({
        type: "result", id, ok: false, scripts: report(),
        error: {
          category: classifyCaptchaError(err),
          // Keep exactly the old cleanup recycle predicate, but only its fixed
          // host category, never the matching raw text or diagnostic suffix.
          message: err instanceof Error && /cleanup failed/.test(err.message.slice(0, 4096))
            ? "CAPTCHA DOM cleanup failed; runtime unavailable" : describeCaptchaFailure(err),
        },
        ...memory(),
      });
    }
  }

  channel.listen((raw) => {
    const msg = raw as { type?: string; [key: string]: unknown } | null;
    if (msg?.type === "init") {
      backendModule = typeof msg.backendModule === "string" ? msg.backendModule : null;
    } else if (msg?.type === "solve") {
      void solve(Number(msg.id), String(msg.scene), String(msg.region), String(msg.prefix));
    }
  });
}
