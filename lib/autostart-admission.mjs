// Admission of a preflight that an OMP host started for its autostart token
// (proxy/zcode-proxy-autostart.ts). Hosts of one installation that start
// together share one preflight: the host holding the token spawns it with
//   --autostart-token=<token path> --autostart-nonce=<its attempt>
// and writes the child's pid into the token right after the spawn. Another
// host may replace the token only once the first host and the preflight the
// token names are proven gone. A preflight whose host died between the spawn
// and that write is named nowhere, so nothing can wait for it: it must not
// work. It therefore starts only once the token names it, and leaves when the
// token is gone, belongs to another attempt, or still does not name it after
// `waitMs`.
import { readFileSync } from 'node:fs';

const MAX_BYTES = 4096;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** May this preflight run? `args` are the process arguments; without the two autostart arguments nothing is asked. */
export function autostartAdmitted(args, { pid = process.pid, waitMs = 3000, pollMs = 20, read = (path) => readFileSync(path, 'utf8'), sleep = sleepSync } = {}) {
  const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const path = value('autostart-token'), nonce = value('autostart-nonce');
  if (!path || !nonce) return true;
  for (let waited = 0; ; waited += pollMs) {
    let token = null, busy = false;
    try {
      const raw = read(path);
      if (raw.length <= MAX_BYTES) token = JSON.parse(raw);
    } catch (err) {
      // Windows: the host is replacing the file right now.
      busy = ['EPERM', 'EBUSY', 'EACCES'].includes(err?.code);
    }
    if (!busy) {
      if (token?.nonce !== nonce) return false;
      if (token.child?.pid === pid) return true;
    }
    if (waited >= waitMs) return false;
    sleep(pollMs);
  }
}
