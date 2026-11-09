/**
 * captcha-solver-worker.ts — thread entry of a solver generation (the thread
 * transport, kept for tests and as a fallback; ADR-0002). The generation
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

serveSolverGeneration({
  post,
  listen: (handler) => listen("message", (event: MessageEvent) => handler(event.data)),
});
