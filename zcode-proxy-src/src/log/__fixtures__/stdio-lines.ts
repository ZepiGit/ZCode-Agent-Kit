/**
 * Test preload (`bun --preload`) for the `proxy.log` writer tests: a spawned
 * proxy writes test-chosen text to its own process.stdout / process.stderr.
 *
 * The test drops a job file at `FIXTURE_STDIO_TRIGGER` (temp file + rename),
 * `{ "writes": [{ "stream": "stdout" | "stderr", "text": "…" }], "batch": n,
 * "pauseMs": ms }`; the fixture picks it up, deletes it, and performs the
 * writes in order, `batch` writes per tick with `pauseMs` between ticks. The
 * streams are looked up at write time, so whatever `serve` installed on them
 * by then is what receives the text. Never loaded by the product.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";

interface Job { writes: Array<{ stream: "stdout" | "stderr"; text: string }>; batch?: number; pauseMs?: number }

const trigger = process.env.FIXTURE_STDIO_TRIGGER;
if (trigger) {
  let busy = false;
  const poll = setInterval(() => {
    if (busy || !existsSync(trigger)) return;
    let job: Job;
    try {
      job = JSON.parse(readFileSync(trigger, "utf8")) as Job;
      rmSync(trigger, { force: true });
    } catch {
      return;
    }
    busy = true;
    const batch = Math.max(1, job.batch ?? job.writes.length);
    let next = 0;
    const tick = () => {
      for (const end = Math.min(job.writes.length, next + batch); next < end; next++) {
        const { stream, text } = job.writes[next];
        (stream === "stderr" ? process.stderr : process.stdout).write(text);
      }
      if (next < job.writes.length) setTimeout(tick, job.pauseMs ?? 0);
      else busy = false;
    };
    tick();
  }, 20);
  poll.unref();
}
