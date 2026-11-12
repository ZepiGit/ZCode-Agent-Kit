// Test clock for the bridge process: loaded with
// NODE_OPTIONS=--import=<this file's URL> and FAKE_CLOCK_FILE=<path>. The file
// holds a millisecond offset; Date.now() and `new Date()` return the real time
// plus that offset, so a test can move the bridge 7 days ahead without
// waiting. Only the bridge entrypoint is shifted; the fake harness keeps the
// real clock. Timers are not affected.
import fs from "node:fs";

const file = process.env.FAKE_CLOCK_FILE;
if (file && /zcode-harness-mcp[\\/]dist[\\/]index\.js$/.test(process.argv[1] ?? "")) {
  const RealDate = Date;
  let offset = 0;
  const read = () => {
    try {
      const v = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isFinite(v)) offset = v;
    } catch {
      /* no file yet: no offset */
    }
  };
  read();
  setInterval(read, 20).unref();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}
