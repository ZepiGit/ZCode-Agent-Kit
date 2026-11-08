/**
 * Test preload (`node --import <this file> dist/index.js …`): records every
 * module URL the process resolves (ESM imports, dynamic imports, require and
 * builtins) plus the process's own Node flags, and writes them as JSON to
 * $ZCODE_TEST_MODULE_TRACE when the process exits and, because a Windows
 * kill runs no exit handler, on an unref'd timer whenever the set changed.
 * Used to prove what the stdio bridge does NOT load.
 */
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";

const out = process.env.ZCODE_TEST_MODULE_TRACE;
const urls = new Set();
let dirty = true;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (!urls.has(resolved.url)) { urls.add(resolved.url); dirty = true; }
    return resolved;
  },
});
const flush = () => {
  if (!out || !dirty) return;
  dirty = false;
  writeFileSync(out, JSON.stringify({ execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? null, urls: [...urls] }));
};
setInterval(flush, 100).unref();
process.on("exit", flush);
