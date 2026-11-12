// Retained-heap probe for the bridge process: loaded with
// `--expose-gc --import <this file's URL>` on the bridge command line and
// ZCODE_TEST_HEAP_DIR=<dir>. When the test creates `<dir>/request`, the probe
// deletes it, runs full garbage collections and writes `<dir>/heap.json` as
// JSON `{ n, heapUsed }` (n counts the answered requests). A test compares the
// heap retained before and after a task to see what the task keeps alive.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.ZCODE_TEST_HEAP_DIR;
if (dir && typeof globalThis.gc === "function" && /dist[\\/]index\.js$/.test(process.argv[1] ?? "")) {
  let n = 0;
  const request = path.join(dir, "request");
  setInterval(() => {
    if (!fs.existsSync(request)) return;
    fs.rmSync(request, { force: true });
    for (let i = 0; i < 3; i += 1) globalThis.gc();
    n += 1;
    const out = path.join(dir, "heap.json");
    fs.writeFileSync(`${out}.tmp`, JSON.stringify({ n, heapUsed: process.memoryUsage().heapUsed }));
    fs.renameSync(`${out}.tmp`, out);
  }, 50).unref();
}
