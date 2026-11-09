// Work counter for the bridge process (seam 7): loaded with
// `--import <this file's URL>` on the bridge command line and
// ZCODE_TEST_SCAN_COUNT=<path>. It counts every element visited through a
// Map's iteration methods (values, keys, entries, the iterator, forEach) and
// every Date.parse call, and rewrites the counts to that file every 20 ms as
// JSON `{ mapVisits, dateParses }`. A test reads the file before and after a
// batch of requests to see how much per-request work grows with the number of
// stored tasks.
import fs from "node:fs";

const file = process.env.ZCODE_TEST_SCAN_COUNT;
if (file && /dist[\\/]index\.js$/.test(process.argv[1] ?? "")) {
  const counts = { mapVisits: 0, dateParses: 0 };
  const proto = Map.prototype;
  const counted = (iter) => ({
    next() {
      const r = iter.next();
      if (!r.done) counts.mapVisits += 1;
      return r;
    },
    [Symbol.iterator]() {
      return this;
    },
  });
  for (const name of ["values", "keys", "entries"]) {
    const real = proto[name];
    proto[name] = function (...args) {
      return counted(real.apply(this, args));
    };
  }
  proto[Symbol.iterator] = proto.entries;
  const realForEach = proto.forEach;
  proto.forEach = function (fn, thisArg) {
    return realForEach.call(this, (v, k, m) => {
      counts.mapVisits += 1;
      fn.call(thisArg, v, k, m);
    });
  };
  const realParse = Date.parse;
  Date.parse = function (s) {
    counts.dateParses += 1;
    return realParse.call(this, s);
  };
  const write = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(counts));
    } catch {
      /* the test's directory may be gone at shutdown */
    }
  };
  write();
  setInterval(write, 20).unref();
}
