// Opt-in parent-side observer, loaded ONLY by the offline S5 fixture client.
// No product runtime, dist file, environment dump or task store is modified.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendRecord, liveRecord } from './identity-diagnostic.mjs';
const original = childProcess.spawn;
const run = process.env.ZCODE_S5_DIAGNOSTIC_RUN;
const path = process.env.ZCODE_S5_DIAGNOSTIC_PARENT;
if (run && path) {
  childProcess.spawn = function (command, args, options) {
    const child = original.call(this, command, args, options);
    if (Array.isArray(args) && args.length === 3 && /(?:^|[\\/])fake-harness\.mjs$/.test(args[0]) && args[1] === 'app-server' && args[2] === '--stdio') {
      child.once('spawn', () => {
        const record = liveRecord(child.pid, process.pid, { event: 'spawn', run, argv: [process.execPath, ...args], exe: process.execPath });
        appendRecord(path, record);
        child.once('exit', (code, signal) => appendRecord(path, { ...record, event: 'child-exit', t: Date.now(), code, signal }));
      });
    }
    return child;
  };
  syncBuiltinESMExports();
}
