// Fixture-port guard: kit tests run their files in parallel
// (`node --test`), and two checkouts may run the suite at once, so no kit test
// may depend on a fixed loopback port. A test that needs a port takes one from
// the kernel (`listen(0)`, or tests/free-port.mjs) and passes it into its
// fixture. Used by tests/test-wiring.test.mjs.
//
// What the guard reports, for every source file under tests/ (data trees, the
// manual tools in MANUAL_TOOLS and the guard's own vectors in
// tests/test-wiring.test.mjs excepted):
//   binds  a listen on a literal non-zero port: `.listen(18799 …`,
//          `.listen(${19083} …`, `listen({ port: 19083 })`,
//          `Bun.serve({ port: 18458 })`, or `.listen(NAME …` where NAME is a
//          constant initialised from a literal (`const PORT = 18765`, also
//          behind `process.env.X || 18765`). No exception exists.
//   ports  a literal port (1024-65535) in a port position (`port: 19421`,
//          `PORT = 19680`, `port: () => 18458`, `["Port", "18458"]`,
//          `127.0.0.1:19500`, `localhost:11434`), or any literal in the
//          fixture range 18000-19999. Allowed only where
//          RECORDED_PORTS lists it for that file with its reason: data (a value
//          a test renders, parses or writes into a config that nothing binds
//          and nothing connects to), or the one recorded exception, the memory
//          loop's own port (not part of `npm run test`).
// 8457 (the production default) may appear as data anywhere; the bind rule
// still forbids listening on it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = /\.(?:mjs|cjs|js|ts)$/;
/** Committed data trees, generated fixture homes and dependencies: not test code. */
const SKIP_DIRS = new Set([
  "tests/snapshots", "tests/ux-before/linux", "tests/ux-before/windows", "tests/ux-before/json-extra",
  "tests/fixtures/origin-main-9e45d05", "tests/fakehome",
]);
/**
 * Manual tools against the owner's own running proxy or a hand-started mock;
 * no test and no package script runs them (the guard test proves it).
 */
export const MANUAL_TOOLS = Object.freeze([
  "tests/effort-matrix-live.mjs", "tests/keycheck.mjs", "tests/mock-upstream.mjs", "tests/verify-glm53.mjs",
]);

/** Scanned for nothing: the guard's own test holds every violating form as a vector. */
const GUARD_VECTORS = "tests/test-wiring.test.mjs";

/**
 * Literal ports allowed per file, with the reason. Verified by a
 * run of `npm run test` that logged every listen and connect of every Node
 * process: none of these ports was bound or connected to. A test that makes a
 * process bind or connect to one of them must take a free port instead.
 */
const DATA = "data: rendered, parsed or written into a fixture file; nothing binds it and nothing connects to it";
export const RECORDED_PORTS = Object.freeze({
  "tests/adapter-audit.test.mjs": { ports: [18701], why: `${DATA} (ctx.port of the in-process adapter unit fixture)` },
  "tests/bench/tui-frame-time.ts": { ports: [18458], why: `${DATA} (serverUrl of a rendered TUI frame)` },
  "tests/cli-commands.test.mjs": { ports: [19071, 19081, 19082], why: `${DATA} (fake fetch records, and the tempKit config of the in-process accounts commands)` },
  "tests/cli-kit.test.mjs": { ports: [9999, 11434, 19439], why: `${DATA} (foreign providers' base URLs in user harness configs; the dry-run comparison fixture's config that nothing binds or connects to)` },
  "tests/cli-ux-accounts-auth-models.test.mjs": { ports: [18458], why: `${DATA} (ctx.port of the faked accounts/auth/models fixtures; byte-pinned renders)` },
  "tests/cli-ux-proxy.test.mjs": { ports: [18458], why: `${DATA} (the faked lifecycle's and status records' port; byte-pinned renders)` },
  "tests/connection-details.test.mjs": { ports: [18457], why: `${DATA} (connection-details lines rendered from facts)` },
  "tests/continue-compatibility.test.mjs": { ports: [18457, 18458, 18459], why: `${DATA} (ctx.port of the in-process Continue adapter)` },
  "tests/crlf-writers.test.mjs": { ports: [19682, 19689], why: `${DATA} (an earlier Goose entry, a mirrored config's content)` },
  "tests/golden-path.test.mjs": { ports: [18457], why: `${DATA} (fillProxyTemplate input)` },
  "tests/harness-consent.test.mjs": { ports: [11434], why: `${DATA} (a foreign Ollama provider in the user's pi config)` },
  "tests/memory/lib/isolated-kit.mjs": { ports: [18457, 18458], why: "the memory loop's own port (`npm run memloop`/`memloop:job`, not `npm run test`): its default and its refused ports; ZCODE_MEMLOOP_PORT overrides it, the CI memory-budget job runs alone" },
  "tests/memory/lib/proxy-session.mjs": { ports: [18457], why: "the memory loop's own port default (ZCODE_MEMLOOP_PORT overrides it; not part of `npm run test`)" },
  "tests/memory/loop.test.mjs": { ports: [18457, 19024, 19025, 19026, 19031], why: `${DATA} (rendered configs, fake process tables and evidence records)` },
  "tests/memory/scenarios/s6-tui-run.ts": { ports: [18457], why: `${DATA} (serverUrl of rendered TUI frames)` },
  "tests/memory/win-sampler.test.mjs": { ports: [19020, 19021], why: `${DATA} (ports parsed from a netstat fixture)` },
  "tests/node-floor.test.mjs": { ports: [19101], why: `${DATA} (an installer fixture's config; the refusal comes before anything runs)` },
  "tests/setup-regressions.test.mjs": { ports: [9999], why: `${DATA} (a hand-written zcode entry the adapter must refuse)` },
  "tests/state-audit.test.mjs": { ports: [18757], why: `${DATA} (a state-migration fixture config)` },
  "tests/term-fixtures.mjs": { ports: [18458], why: `${DATA} (term snapshot records; byte-pinned)` },
  "tests/term-output.test.mjs": { ports: [18458], why: `${DATA} (rendered output records)` },
  "tests/term-snapshots.test.mjs": { ports: [19060], why: `${DATA} (a check grammar vector)` },
  "tests/ux-before-capture.test.mjs": { ports: [20000], why: "the capture's kernel-port floor this test pins, not a port" },
  "tests/ux-before/capture/capture.mjs": { ports: [11434, 18458, 20000], why: `${DATA} (18458: the baseline's printed port every capture writes back; 20000: the kernel-port floor; 11434: a foreign provider in a fixture config)` },
  "tests/ux-before/capture/fake-proxy.ts": { ports: [18458, 18720], why: `${DATA} (18458: an error message naming the baseline port; 18720: seconds, not a port)` },
  "tests/ux-before/capture/render-tui.ts": { ports: [18458], why: `${DATA} (serverUrl and messages of rendered TUI frames; byte-pinned)` },
});

const PRODUCTION_PORT = 8457;
const FIXTURE_RANGE = [18000, 19999];

function walk(root, dir, out) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !SKIP_DIRS.has(rel)) walk(root, rel, out);
    } else if (entry.isFile() && SOURCE.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * Blank out comments, keeping line numbers and strings: one left-to-right pass,
 * so `//` inside a string (a URL) is no comment and a `/*` inside a line
 * comment (`tests/*.test.mjs`) opens no block comment.
 */
export function stripComments(text) {
  return text.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (m, string) => (string ? m : m.replace(/[^\n]/g, " ")));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const BIND_LITERAL = [
  /\.listen\(\s*(?:\{[^}]*?\bport\s*:\s*)?(?:\$\{\s*)?([1-9]\d*)\b/g,
  /\bBun\.serve\(\s*\{[^}]*?\bport\s*:\s*([1-9]\d*)\b/g,
];
const LITERAL_CONST = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Number\([^)]*?(?:\|\||\?\?)\s*)?([1-9]\d*)\b/g;
const PORT_POSITION = [
  /(?:(?<![A-Za-z])port|Port|PORT)[\w$]*["'`]?(?:\s*(?:[:=,(]|\?\?|\|\|)\s*|\s+)(?:\(\)\s*=>\s*)?["'`]?(?:\$\{\s*)?(\d{4,5})\b/g,
  /(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):(?:\$\{\s*)?(\d{4,5})\b/g,
];
const ANY_NUMBER = /(?<![\w.$])(\d{5})(?![\w.])/g;

/** Findings of one file's source text (exported for the guard's own tests). */
export function scanSource(file, source, recordedPorts = RECORDED_PORTS) {
  const text = stripComments(source);
  const binds = [];
  const ports = [];
  for (const re of BIND_LITERAL) {
    for (const m of text.matchAll(re)) binds.push(`${file}:${lineOf(text, m.index)}: listens on literal port ${m[1]}`);
  }
  for (const [, name, value] of text.matchAll(LITERAL_CONST)) {
    if (Number(value) < 1024) continue;
    const use = new RegExp(`\\.listen\\(\\s*(?:\\{[^}]*?\\bport\\s*:\\s*)?${name.replace(/\$/g, "\\$")}\\b|\\bBun\\.serve\\(\\s*\\{[^}]*?\\bport\\s*:\\s*${name.replace(/\$/g, "\\$")}\\b`, "g");
    for (const m of text.matchAll(use)) binds.push(`${file}:${lineOf(text, m.index)}: listens on ${name} = ${value}`);
  }
  const allowed = new Set(recordedPorts[file]?.ports ?? []);
  const seen = new Set();
  const flag = (value, index) => {
    const port = Number(value);
    if (port < 1024 || port > 65535 || port === PRODUCTION_PORT || allowed.has(port)) return;
    const key = `${lineOf(text, index)}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    ports.push(`${file}:${key.replace(":", ": literal port ")}`);
  };
  for (const re of PORT_POSITION) for (const m of text.matchAll(re)) flag(m[1], m.index);
  for (const m of text.matchAll(ANY_NUMBER)) {
    const n = Number(m[1]);
    if (n >= FIXTURE_RANGE[0] && n <= FIXTURE_RANGE[1]) flag(m[1], m.index);
  }
  const byLine = (a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]);
  return { binds: binds.sort(byLine), ports: ports.sort(byLine) };
}

/** Every finding under `root`/tests, plus the data entries no file needs any more. */
export function checkFixturePorts(root, { recordedPorts = RECORDED_PORTS, manualTools = MANUAL_TOOLS } = {}) {
  const files = existsSync(join(root, "tests")) ? walk(root, "tests", []).sort() : [];
  const binds = [];
  const ports = [];
  const used = new Map();
  for (const file of files) {
    if (manualTools.includes(file) || file === GUARD_VECTORS) continue;
    const source = readFileSync(join(root, file), "utf8");
    const found = scanSource(file, source, recordedPorts);
    binds.push(...found.binds);
    ports.push(...found.ports);
    const all = scanSource(file, source, {}).ports.map((f) => Number(f.split(" ").pop()));
    used.set(file, new Set(all));
  }
  const stale = [];
  for (const [file, { ports: listed }] of Object.entries(recordedPorts)) {
    for (const port of listed) if (!used.get(file)?.has(port)) stale.push(`${file}: ${port}`);
  }
  return { files, binds, ports, stale };
}
