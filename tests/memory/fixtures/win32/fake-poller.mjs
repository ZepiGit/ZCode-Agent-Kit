#!/usr/bin/env node
// Stand-in for the Windows poller (lib/win-sampler.mjs pollerScript) on any
// OS: replays recorded Get-CimInstance / Get-Process CSV in the poller's
// framing. argv[2] is the JSON the sampler hands its poller (pollerOptions)
// plus { cim, getProcess, selfPid, pollMs } naming the fixture files and the
// poller pid the recording carries. `table` (an absolute path) is re-read at
// the start of every poll, so a test can change the process table while the
// sampler runs; `lagMs` is how long each poll takes between its start stamp
// and its frame (the Win32_Process query).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const opts = JSON.parse(process.argv[2]);
const read = (name) => readFileSync(join(here, name), "utf8").trimEnd();
const cim = read(opts.cim ?? "cim-poll.csv");
const out = (s) => process.stdout.write(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// delayMs: answer late, as PowerShell does while it starts (the caller must stay alive meanwhile).
if (opts.delayMs) await sleep(opts.delayMs);
if (opts.units) out(`@@UNITS ${opts.selfPid}\n${read(opts.unitsCim ?? opts.cim ?? "cim-poll.csv")}\n@@GETPROCESS\n${read(opts.getProcess ?? "get-process.csv")}\n@@END\n`);
let n = 0;
const poll = async () => {
  // The start stamp on the monotonic clock the sampler reads (process.hrtime), in ns.
  const start = process.hrtime.bigint();
  const table = opts.table ? readFileSync(opts.table, "utf8").trimEnd() : cim;
  if (opts.lagMs) await sleep(opts.lagMs);
  // Split each block in two writes: the parser must not depend on chunk boundaries.
  // noStamp: the head without its start stamp (the poller before ticket 73).
  const block = `@@POLL ${opts.selfPid} ${opts.pollMs ?? 180 + n++}${opts.noStamp ? "" : ` ${start} 1000000000`}\n${table}\n@@END\n`;
  const cut = Math.floor(block.length / 2);
  out(block.slice(0, cut));
  await sleep(5);
  out(block.slice(cut));
};
await poll();
if (!opts.once) for (;;) { await sleep(opts.intervalMs); await poll(); }
