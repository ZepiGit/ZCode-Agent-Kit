// Seam 5 / ADR-0011 boundaries of the CLI output module:
// 1. the capability record (lib/term/caps.mjs) is the only reader of isTTY,
//    NO_COLOR, TERM, CI and columns in the code this ticket adds (grep test;
//    commands migrating onto lib/term/ add their files to NEW_CODE);
// 2. rendering loads lazily: importing lib/term/load.mjs loads no renderer,
//    and the preflight and the lifecycle intents never import lib/term/ or
//    the shared TUI tokens and width core (ADR-0011 cond 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const rel = (file) => relative(ROOT, file).split(sep).join("/");

/** Code added by ticket 06 (and later tickets that build on it). caps.mjs is the reader. */
const NEW_CODE = [
  ...readdirSync(join(ROOT, "lib", "term")).filter((f) => f.endsWith(".mjs") && f !== "caps.mjs").map((f) => `lib/term/${f}`),
  // Ticket 40: the commands migrated onto the output module and their report builders.
  "cli/doctor-report.mjs", "cli/proxy-report.mjs",
  ...["doctor", "proxy", "status", "logs"].map((name) => `cli/commands/${name}.mjs`),
];
const GUARDED = /\b(isTTY|NO_COLOR|TERM|CI|columns)\b/;

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

test("no module other than the capability record reads isTTY, NO_COLOR, TERM, CI or columns (new code)", () => {
  assert.ok(NEW_CODE.includes("lib/term/out.mjs") && NEW_CODE.includes("lib/term/load.mjs"), "the guard must see the output module");
  const offenders = [];
  for (const file of NEW_CODE) {
    stripComments(readFileSync(join(ROOT, file), "utf8")).split("\n").forEach((line, i) => {
      if (GUARDED.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(join(ROOT, "lib", "term", "caps.mjs"), "utf8"), /isTTY/, "the record itself is where the reads live");
});

test("the guard's comment stripping keeps code: a read after a URL-free line comment is still found", () => {
  assert.match(stripComments("const a = stream.isTTY; // note"), GUARDED);
  assert.doesNotMatch(stripComments("// TERM=dumb\n/* NO_COLOR */ const x = 1;"), GUARDED);
});

/** Relative static imports and re-exports of a module (dynamic import() is lazy and allowed). */
function staticImports(file) {
  const source = stripComments(readFileSync(file, "utf8"));
  const specs = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
  return specs.filter((s) => s.startsWith(".")).map((s) => resolve(dirname(file), s)).filter((p) => existsSync(p));
}
function graph(entry) {
  const seen = new Set();
  const walk = (file) => { if (seen.has(file)) return; seen.add(file); for (const dep of staticImports(file)) walk(dep); };
  walk(join(ROOT, entry));
  return [...seen].map(rel);
}

const PRESENTATION = /^(lib\/term\/|zcode-proxy-src\/src\/tui\/)/;

for (const entry of ["cli/heal.mjs", "cli/launch.mjs", "proxy/zcode-proxy-manager.mjs"]) {
  test(`the preflight and lifecycle path never imports presentation code: ${entry}`, () => {
    const files = graph(entry);
    assert.ok(files.length > 1, "the import walk must follow relative imports");
    assert.deepEqual(files.filter((f) => PRESENTATION.test(f)), []);
  });
}

test("the import walk sees lib/term/out.mjs's own renderer imports (the walk is not vacuous)", () => {
  const files = graph("lib/term/out.mjs");
  for (const f of ["lib/term/tokens.mjs", "lib/term/width.mjs", "zcode-proxy-src/src/tui/tokens.mjs", "zcode-proxy-src/src/tui/width-core.mjs", "cli/connection-details.mjs"]) {
    assert.ok(files.includes(f), `${f} reached from out.mjs`);
  }
});

test("importing lib/term/load.mjs loads no renderer until loadOutput() is called", () => {
  // Node's synchronous module hooks record every file the loader resolves.
  const script = `
    import { registerHooks } from "node:module";
    const seen = [];
    registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); seen.push(r.url); return r; } });
    const loaded = () => seen.filter((u) => /lib\\/term\\/out\\.mjs$|tui\\/(tokens|width-core)\\.mjs$/.test(u)).length;
    const { loadOutput } = await import(${JSON.stringify(new URL("../lib/term/load.mjs", import.meta.url).href)});
    const before = loaded();
    const out = await loadOutput({ stdout: { isTTY: false, write() {} }, stderr: { isTTY: false, write() {} }, env: {} });
    console.log(JSON.stringify({ before, after: loaded(), hasCheck: typeof out.check }));
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { before: 0, after: 3, hasCheck: "function" });
});
