// Lazy entry to the CLI output module (ADR-0011 cond 3): importing this file
// loads no renderer. `loadOutput()` imports ./out.mjs (and with it the token
// set, the width core and the connection-details rules) on first use, so a
// path that never renders never pays for them. The preflight and the
// lifecycle intents import neither file (tests/term-boundaries.test.mjs).

/** @param {Parameters<typeof import("./out.mjs").createOutput>[0]} [opts] */
export async function loadOutput(opts) {
  const { createOutput } = await import("./out.mjs");
  return createOutput(opts);
}

/** The record renderer, loaded the same way. */
export async function loadRenderRecords() {
  const { renderRecords } = await import("./out.mjs");
  return renderRecords;
}
