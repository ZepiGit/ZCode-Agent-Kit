// Every scenario the memory loop knows, its variants, and the runs each OS
// leg of the `memory-budget` CI job performs (short profile).
//
// A run key names one run: `<scenario>/<variant>`, or `<scenario>/<profile>`
// for the run without a variant. Keys are what expected-red.json lists.

export const CATALOGUE = {
  S1: { module: "./scenarios/s1-proxy-steady.mjs", variants: ["burst1", "burst4", "burst16", "burst32", "bigbody", "stalled"] },
  S2: { module: "./scenarios/s2-captcha.mjs", variants: ["gc"] },
  S3: { module: "./scenarios/s3-concurrency.mjs", variants: ["hung"] },
  S4: { module: "./scenarios/s4-lifecycle.mjs", variants: [] },
  S5: { module: "./scenarios/s5-mcp.mjs", variants: [] },
  S6: { module: "./scenarios/s6-tui.mjs", variants: [] },
  S7: { module: "./scenarios/s7-disk.mjs", variants: [] },
};

export const PROFILES = ["short", "long"];

/**
 * The runs of each `memory-budget` leg, in order. S2/gc is a diagnostic
 * variant (phase A only, with forced GC) and stays local. The windows leg is
 * added with the Windows sampler (ticket 02).
 */
export const JOB = {
  linux: [
    "S1/short", "S1/burst1", "S1/burst4", "S1/burst16", "S1/burst32", "S1/bigbody", "S1/stalled",
    "S2/short",
    "S3/short", "S3/hung",
    "S4/short", "S5/short", "S6/short", "S7/short",
  ],
};

export const OS_LEGS = ["linux", "windows"];

export function runKey(scenario, { profile = "short", variant = null } = {}) {
  return `${scenario}/${variant ?? profile}`;
}

/** { scenario, profile, variant } for a key, or { error } saying what is wrong with it. */
export function parseRunKey(key, catalogue = CATALOGUE) {
  const m = /^(S\d+)\/([a-z0-9]+)$/.exec(String(key));
  if (!m) return { error: "not a run key (<scenario>/<variant or profile>)" };
  const [, scenario, name] = m;
  const entry = catalogue[scenario];
  if (!entry) return { error: `unknown scenario ${scenario}` };
  if (PROFILES.includes(name)) return { scenario, profile: name, variant: null };
  if (!entry.variants.includes(name)) return { error: `unknown variant ${name} of ${scenario}` };
  return { scenario, profile: "short", variant: name };
}
