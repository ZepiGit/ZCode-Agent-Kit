/**
 * Synthetic credential values for the test suites.
 *
 * These are generated at runtime rather than written as literals, so no value
 * in the repository can be mistaken for — or accidentally become — a usable
 * credential. Each name returns a stable value for the lifetime of the test
 * process, which is what the suites need when a value is written in one place
 * and asserted in another.
 */
import { randomBytes } from "node:crypto";

const cache = new Map<string, string>();

/** Stable per-process synthetic value for `name`. Never a real credential. */
export function fixtureSecret(name: string): string {
  let value = cache.get(name);
  if (value === undefined) {
    value = `${name}-${randomBytes(9).toString("hex")}`;
    cache.set(name, value);
  }
  return value;
}

/** A value guaranteed to differ from `fixtureSecret(name)`. */
export function wrongSecret(name = "wrong"): string {
  return fixtureSecret(`${name}-mismatch`);
}
