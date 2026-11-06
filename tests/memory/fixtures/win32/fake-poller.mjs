#!/usr/bin/env node
// Stand-in for the Windows poller (lib/win-sampler.mjs pollerScript) on any
// OS: replays recorded Get-CimInstance / Get-Process CSV in the poller's
// framing. argv[2] is the JSON the sampler hands its poller (pollerOptions)
// plus { cim, getProcess, selfPid, pollMs } naming the fixture files and the
// poller pid the recording carries.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const opts = JSON.parse(process.argv[2]);
const read = (name) => readFileSync(join(here, name), "utf8").trimEnd();
const cim = read(opts.cim ?? "cim-poll.csv");
const out = (s) => process.stdout.write(s);
if (opts.units) out(`@@UNITS ${opts.selfPid}\n${read(opts.unitsCim ?? opts.cim ?? "cim-poll.csv")}\n@@GETPROCESS\n${read(opts.getProcess ?? "get-process.csv")}\n@@END\n`);
let n = 0;
const poll = () => {
  // Split each block in two writes: the parser must not depend on chunk boundaries.
  const block = `@@POLL ${opts.selfPid} ${opts.pollMs ?? 180 + n++}\n${cim}\n@@END\n`;
  const cut = Math.floor(block.length / 2);
  out(block.slice(0, cut));
  setTimeout(() => out(block.slice(cut)), 5);
};
poll();
if (!opts.once) setInterval(poll, opts.intervalMs);
