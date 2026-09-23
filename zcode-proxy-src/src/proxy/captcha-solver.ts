/**
 * Solver backend dispatch — fully in-process, self-contained.
 *
 * Backend (ZCODE_CAPTCHA_BACKEND): "happy" (default) — the happy-dom solver
 * in src/proxy/captcha-happy.ts. Runs inside the Bun process; bundled into
 * the single-file release binary by `bun build --compile`. No external
 * Node.js, no browser. (The historical jsdom and Node-daemon/playwright
 * backends have been removed.)
 */
const BACKEND = process.env.ZCODE_CAPTCHA_BACKEND?.trim().toLowerCase() || "happy";

let happyMod: typeof import("./captcha-happy.js") | null = null;

// All callers share one runtime: happy-dom aliases the host globals and uses
// process-global browserFrame/cookieContainer references. Hold this queue through
// backend settlement (including its finally cleanup), not the caller's deadline.
let solveQueue: Promise<void> = Promise.resolve();

export function runCaptchaSolve(
  scene: string,
  region: string,
  prefix: string,
  beforeSolve?: () => void,
): Promise<string> {
  const result = solveQueue.then(async () => {
    if (BACKEND !== "happy") {
      throw new Error(`captcha backend "${BACKEND}" is not available; use ZCODE_CAPTCHA_BACKEND=happy`);
    }
    if (!happyMod) happyMod = await import("./captcha-happy.js");
    // A provider pause may have started while this request waited in the queue.
    beforeSolve?.();
    return happyMod.solveTraceless({ scene, region, prefix });
  });
  // Recover the queue without swallowing the error delivered to this caller.
  solveQueue = result.then(() => {}, () => {});
  return result;
}

/** Do not release a live window when a host stops waiting for its result. */
export function shutdownCaptchaSolver(): void {}

/** Fixed supported capacity, independent of historical daemon configuration. */
export function captchaSolverConcurrency(): number {
  return 1;
}
