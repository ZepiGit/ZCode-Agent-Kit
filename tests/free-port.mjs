// Free loopback ports for kit test fixtures. `node --test` runs
// the test files in parallel and two checkouts may run the suite at once, so a
// fixture never pins a port: it asks the kernel for one (bind 127.0.0.1:0),
// releases it and writes it into its config. A "down" case checks a port that
// was free a moment ago, so nothing of this or another run listens there.
// Guarded by scripts/fixture-ports.mjs (tests/test-wiring.test.mjs).
import net from "node:net";

/** A loopback port the kernel just handed out and that is free again. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
