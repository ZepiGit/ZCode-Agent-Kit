/**
 * captcha-solver-worker.ts — thread entry of a solver generation (the thread
 * transport, kept for tests and as a fallback). The generation
 * itself, its protocol and its guest error boundary live in
 * captcha-solver-generation.ts; this entry only binds the thread's channel.
 *
 * This file is an extra `bun build --compile` entrypoint (see package.json):
 * without it the compiled binary cannot resolve the worker.
 */
import { serveSolverGeneration } from "./captcha-solver-generation.js";

// happy-dom aliases window members (self, postMessage, onmessage,
// addEventListener, ...) onto this thread's globalThis while a solve runs.
// Bind the host channel once, before any window exists.
const post: (message: unknown) => void = globalThis.postMessage.bind(globalThis);
const listen = globalThis.addEventListener.bind(globalThis);

// This thread's diagnostics go to the host by message, never to fd 2: the
// host writes them through its own stderr, which a managed proxy routes
// through its rotating log writer.
const writeLog = (text: string): void => { try { post({ type: "log", text }); } catch {} };
process.stderr.write = ((chunk: unknown, encoding?: unknown, callback?: unknown): boolean => {
  writeLog(typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : String(chunk));
  const done = typeof encoding === "function" ? encoding : callback;
  if (typeof done === "function") queueMicrotask(() => (done as () => void)());
  return true;
}) as typeof process.stderr.write;

serveSolverGeneration({
  post,
  listen: (handler) => listen("message", (event: MessageEvent) => handler(event.data)),
  writeLog,
});
