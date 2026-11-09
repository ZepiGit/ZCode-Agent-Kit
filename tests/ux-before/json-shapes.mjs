// JSON key/type baseline (spec §18 COMPATIBILITY, Story 123): every `--json`
// output must stay a superset of the pre-change key names AND value types.
//
// A shape records, per position in a document, the JSON types seen there,
// the keys of objects (with `optional` when only some array elements carried
// them) and the merged shape of array elements. checkSuperset() accepts
// added keys and added array elements; it rejects a removed key, a changed
// type and a value whose type the baseline never saw.
//
// The baseline (tests/ux-before/json-baseline.json) is generated once from
// the pre-change captures: the pipe variant of the Phase 1C BEFORE set
// (tests/ux-before/linux, 0960696) plus the `--extra json` captures of the
// ticket-06 base commit (tests/ux-before/json-extra). A BEFORE capture that a
// later ticket refreshed on purpose (keys added, as ticket 40 did for
// `doctor --json`) keeps its pre-change pipe output under
// tests/ux-before/json-before/<group>/<id>/pipe.txt, which the baseline reads
// instead. Regenerate only on purpose:
//   node tests/ux-before/json-shapes.mjs --write
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = import.meta.dirname;
export const BASELINE_FILE = join(HERE, "json-baseline.json");

/**
 * Every `--json` output the CLI has, as captured by tests/ux-before/capture
 * (pipe variant): capture path → the command.
 */
export const JSON_OUTPUTS = Object.freeze({
  "doctor/doctor-json": "doctor --json (proxy running)",
  "json-extra/doctor-json-down": "doctor --json (proxy down)",
  "status/status-json-running": "status --json (running)",
  "status/status-json-down": "status --json (down)",
  "proxy/proxy-status-json-running": "proxy status --json (running)",
  "proxy/proxy-status-json-down": "proxy status --json (down)",
  "json-extra/models-json-running": "models --json (running)",
  "models/models-json-down": "models --json (down, registry fallback)",
  "models/usage-json-running": "usage --json (running)",
  "models/usage-json-down": "usage --json (down)",
  "accounts/accounts-json": "accounts --json",
  "json-extra/accounts-doctor-json": "accounts doctor --json",
  "accounts/accounts-health-json": "accounts health --json (running)",
  "json-extra/accounts-health-json-down": "accounts health --json (down)",
  "auth/auth-status-running": "auth status, stdout not a TTY (running)",
  "auth/auth-status-down": "auth status, stdout not a TTY (down)",
});

/** Parse a normalised capture: the capture tool wrote `"pid": <PID>` for a number. */
export function parseCapture(text) {
  return JSON.parse(text.replace(/("pid": )<PID>/g, "$10"));
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export function shapeOf(value) {
  const t = typeOf(value);
  const shape = { types: [t] };
  if (t === "object") {
    shape.keys = {};
    for (const [k, v] of Object.entries(value)) shape.keys[k] = shapeOf(v);
  } else if (t === "array" && value.length) {
    shape.items = value.map(shapeOf).reduce(mergeShapes);
  }
  return shape;
}

/** Union of two shapes; a key missing from either side becomes optional. */
export function mergeShapes(a, b) {
  const out = { types: [...new Set([...a.types, ...b.types])].sort() };
  if (a.keys || b.keys) {
    out.keys = {};
    for (const k of new Set([...Object.keys(a.keys ?? {}), ...Object.keys(b.keys ?? {})])) {
      const x = a.keys?.[k], y = b.keys?.[k];
      out.keys[k] = x && y ? mergeShapes(x, y) : { ...(x ?? y), optional: true };
      if (x && y && (x.optional || y.optional)) out.keys[k].optional = true;
    }
  }
  if (a.items || b.items) out.items = a.items && b.items ? mergeShapes(a.items, b.items) : (a.items ?? b.items);
  return out;
}

/** Differences that break the superset rule; empty means `value` is a superset of `shape`. */
export function checkSuperset(shape, value, path = "$") {
  const t = typeOf(value);
  // A position the baseline only ever saw as null has no known type to keep.
  if (shape.types.length === 1 && shape.types[0] === "null") return [];
  if (!shape.types.includes(t)) return [`${path}: type ${t}, baseline ${shape.types.join("|")}`];
  const errors = [];
  if (t === "object" && shape.keys) {
    for (const [k, sub] of Object.entries(shape.keys)) {
      if (!(k in value)) { if (!sub.optional) errors.push(`${path}.${k}: missing`); continue; }
      errors.push(...checkSuperset(sub, value[k], `${path}.${k}`));
    }
  }
  if (t === "array" && shape.items) value.forEach((item, i) => errors.push(...checkSuperset(shape.items, item, `${path}[${i}]`)));
  return errors;
}

/** Build the baseline document from capture directories (pipe variant). */
export function buildBaseline({ before = join(HERE, "linux"), extra = join(HERE, "json-extra"), frozenDir = join(HERE, "json-before") } = {}) {
  const manifests = [before, extra].flatMap((dir) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const outputs = {};
  for (const [capture, command] of Object.entries(JSON_OUTPUTS)) {
    // json-extra/<id> captures are committed flat as tests/ux-before/json-extra/<id>/.
    const frozen = join(frozenDir, capture, "pipe.txt");
    const file = capture.startsWith("json-extra/") ? join(extra, capture.slice("json-extra/".length), "pipe.txt")
      : existsSync(frozen) ? frozen : join(before, capture, "pipe.txt");
    const m = manifests.find((x) => `${x.group}/${x.id}` === capture && x.variant === "pipe");
    if (!m) throw new Error(`no pipe capture for ${capture}`);
    outputs[capture] = { command, exit: m.exit, shape: shapeOf(parseCapture(readFileSync(file, "utf8"))) };
  }
  return {
    about: "Key names and value types of every --json output before the overhaul's output changes (ticket 06). Generated by tests/ux-before/json-shapes.mjs from tests/ux-before/linux (0960696) and tests/ux-before/json-extra (3f4e41a); never edited by hand.",
    outputs,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--write")) {
  writeFileSync(BASELINE_FILE, JSON.stringify(buildBaseline(), null, 2) + "\n");
  console.log(`wrote ${BASELINE_FILE}`);
}
