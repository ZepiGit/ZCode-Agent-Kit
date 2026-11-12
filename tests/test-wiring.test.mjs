// Repository guard: every kit test file `tests/*.test.mjs` must be
// referenced by a test script (`test` or `test:*` in package.json), so no test
// can sit outside `npm run test` and CI unnoticed. Since ticket 75 also: no kit
// test depends on a fixed loopback port (scripts/fixture-ports.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTestWiring } from "../scripts/test-wiring.mjs";
import { MANUAL_TOOLS, checkFixturePorts, scanSource, stripComments } from "../scripts/fixture-ports.mjs";

function fixtureRepo(t, { scripts, files }) {
  const root = mkdtempSync(join(tmpdir(), "zcode-test-wiring-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts }));
  mkdirSync(join(root, "tests"), { recursive: true });
  for (const name of files) writeFileSync(join(root, "tests", name), "// fixture\n");
  return root;
}

test("a scratch test file wired into no test script is reported unwired", (t) => {
  const root = fixtureRepo(t, {
    scripts: { test: "node --test tests/alpha.test.mjs" },
    files: ["alpha.test.mjs", "scratch.test.mjs"],
  });
  assert.deepEqual(checkTestWiring(root).unwired, ["tests/scratch.test.mjs"]);
});

test("only a whole-argument reference in a test script wires a file", (t) => {
  const root = fixtureRepo(t, {
    scripts: {
      test: "node --test ./tests/a.test.mjs \"tests/b.test.mjs\" tests/c.test.mjs.bak tests/pre-d.test.mjs",
      "test:extra": "node --test tests\\f.test.mjs",
      kit: "node tests/e.test.mjs",
    },
    files: ["a.test.mjs", "b.test.mjs", "c.test.mjs", "d.test.mjs", "e.test.mjs", "f.test.mjs", "helper.mjs"],
  });
  assert.deepEqual(checkTestWiring(root).unwired, ["tests/c.test.mjs", "tests/d.test.mjs", "tests/e.test.mjs"]);
});

test("a package without test scripts leaves every test file unwired", (t) => {
  const root = fixtureRepo(t, { scripts: undefined, files: ["a.test.mjs", "b.test.mjs"] });
  assert.deepEqual(checkTestWiring(root).unwired, ["tests/a.test.mjs", "tests/b.test.mjs"]);
});

test("every kit test file in this repository is wired into a test script", () => {
  const { testFiles, unwired } = checkTestWiring(join(import.meta.dirname, ".."));
  assert.ok(testFiles.includes("tests/test-wiring.test.mjs"), "the guard must see the repository's test files");
  assert.deepEqual(unwired, [], `wire these into a test script in package.json: ${unwired.join(", ")}`);
});

// The proxy test run loads the egress guard. `npm run test:proxy`
// runs `bun test` inside zcode-proxy-src, where bunfig.toml preloads it, and
// both CI workflows run that script.
test("npm run test:proxy loads the egress guard preload, in CI too", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const repo = join(import.meta.dirname, "..");
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const bunfig = readFileSync(join(repo, "zcode-proxy-src", "bunfig.toml"), "utf8").replace(/\r\n/g, "\n");
  const testSection = /^\[test\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(bunfig)?.[1] ?? "";
  const preload = /^preload\s*=\s*\[([^\]]*)\]/m.exec(testSection)?.[1] ?? "";
  const preloads = [...preload.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const workflowsRunIt = ["ci.yml", "release.yml"].map((name) =>
    /^\s+run: npm run test:proxy$/m.test(readFileSync(join(repo, ".github", "workflows", name), "utf8")));
  assert.deepEqual({
    script: pkg.scripts["test:proxy"],
    preloads,
    preloadExists: preloads.every((p) => existsSync(join(repo, "zcode-proxy-src", p))),
    workflowsRunIt,
  }, {
    script: "cd zcode-proxy-src && bun test",
    preloads: ["./test-support/egress-guard-preload.ts"],
    preloadExists: true,
    workflowsRunIt: [true, true],
  });
});

// No kit test depends on a fixed loopback port. `node --test` runs
// the files in parallel, and two checkouts may run the suite at once; a shared
// port made a "down" case see another run's listener (json-superset,
// ux-before-capture), a bind fail with EADDRINUSE (cli-commands) and a test
// wait forever for a listener that never came up (manager-audit).
test("fixture-port guard: every literal bind form is reported, a kernel-assigned port is not", () => {
  const binds = (src) => scanSource("tests/x.test.mjs", src, {}).binds;
  assert.deepEqual(binds('server.listen(19083, "127.0.0.1", resolve);'), ["tests/x.test.mjs:1: listens on literal port 19083"]);
  assert.deepEqual(binds("spawn(node, ['-e', `require('node:net').createServer(()=>{}).listen(${18799},'127.0.0.1')`]);"), ["tests/x.test.mjs:1: listens on literal port 18799"]);
  assert.deepEqual(binds("srv.listen({ host: '127.0.0.1', port: 18601 });"), ["tests/x.test.mjs:1: listens on literal port 18601"]);
  assert.deepEqual(binds("Bun.serve({ hostname: '127.0.0.1', port: 18458, fetch });"), ["tests/x.test.mjs:1: listens on literal port 18458"]);
  assert.deepEqual(binds("const PORT = Number(process.env.MOCK_PORT || 18765);\nserver.listen(PORT, '127.0.0.1');"), ["tests/x.test.mjs:2: listens on PORT = 18765"]);
  assert.deepEqual(binds("listen(8457)\n.listen(8457, h)"), ["tests/x.test.mjs:2: listens on literal port 8457"], "the production port is data at most, never a bind");
  assert.deepEqual(binds("server.listen(0, '127.0.0.1');\nsrv.listen(port, '127.0.0.1');\nconst port = await freePort();\nBun.serve({ port, fetch });"), []);
  // A `/*` inside a line comment opens no block comment that could hide a bind below it.
  assert.deepEqual(binds("// every tests/*.test.mjs file\nserver.listen(19083);\nconst url = 'http://127.0.0.1/*'; // x */\nserver.listen(19084);"),
    ["tests/x.test.mjs:2: listens on literal port 19083", "tests/x.test.mjs:4: listens on literal port 19084"]);
  assert.deepEqual(binds("// server.listen(19083);\n/* server.listen(19084); */"), [], "a commented-out bind is no bind");
});

test("fixture-port guard: a literal in a port position or in the fixture range needs a recorded entry for its file", () => {
  const ports = (src, data = {}) => scanSource("tests/x.test.mjs", src, data).ports;
  assert.deepEqual(ports([
    "const FIXTURE_PORT = 19421;",
    "writeFileSync(cfg, 'server:\\n  port: 19500\\n');",
    "f.ctx.port = () => 18458;",
    'out.kv([["Port", "18458"]]);',
    "fetch('http://127.0.0.1:19141/health');",
    "const root = fixture(t, 18795);",
    "env: { UX_CAPTURE_PORT: String(Number(process.env.UX_CAPTURE_PORT ?? 18458) + 1) },",
    "let portCounter = 18600;",
  ].join("\n")).map((f) => f.replace("tests/x.test.mjs:", "")), [
    "1: literal port 19421", "2: literal port 19500", "3: literal port 18458", "4: literal port 18458",
    "5: literal port 19141", "6: literal port 18795", "7: literal port 18458", "8: literal port 18600",
  ]);
  assert.deepEqual(ports("// port 19421 in a comment\n/* 127.0.0.1:19500 */\nconst ms = 5000; const support = 2024;"), [], "comments and other numbers are not ports");
  assert.deepEqual(ports("assert.match(out, /127\\.0\\.0\\.1:8457/); const cfg = 'port: 8457';"), [], "8457 is the documented default: data");
  assert.deepEqual(ports("const PORT = 19680;", { "tests/x.test.mjs": { ports: [19680], why: "data" } }), []);
  assert.deepEqual(ports("const PORT = 19680;", { "tests/other.test.mjs": { ports: [19680], why: "data" } }), ["tests/x.test.mjs:1: literal port 19680"], "a recorded entry covers its own file only");
});

test("fixture-port guard: a recorded entry no file needs any more is reported stale; data trees and manual tools are not scanned", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zcode-fixture-ports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tests", "snapshots"), { recursive: true });
  writeFileSync(join(root, "tests", "a.test.mjs"), "const cfg = 'port: 19001';\n");
  writeFileSync(join(root, "tests", "snapshots", "b.mjs"), "server.listen(19002);\n");
  writeFileSync(join(root, "tests", "mock-upstream.mjs"), "server.listen(19003);\n");
  const data = { "tests/a.test.mjs": { ports: [19001, 19009], why: "data" } };
  const r = checkFixturePorts(root, { recordedPorts: data, manualTools: ["tests/mock-upstream.mjs"] });
  assert.deepEqual(r, { files: ["tests/a.test.mjs", "tests/mock-upstream.mjs"], binds: [], ports: [], stale: ["tests/a.test.mjs: 19009"] });
});

test("fixture-port guard: no test and no package script runs a manual tool the guard skips", () => {
  const repo = join(import.meta.dirname, "..");
  const pkg = readFileSync(join(repo, "package.json"), "utf8");
  const { files } = checkFixturePorts(repo);
  const users = [];
  for (const tool of MANUAL_TOOLS) {
    assert.ok(files.includes(tool), `${tool} exists`);
    const name = tool.split("/").pop();
    if (pkg.includes(name)) users.push(`package.json -> ${tool}`);
    // This file's own guard fixtures name a manual tool as a scanned-or-not example.
    for (const file of files) if (file !== tool && file !== "tests/test-wiring.test.mjs" && stripComments(readFileSync(join(repo, file), "utf8")).includes(name)) users.push(`${file} -> ${tool}`);
  }
  assert.deepEqual(users, []);
});

test("no kit test binds a literal port or pins one outside the recorded data", () => {
  const { files, binds, ports, stale } = checkFixturePorts(join(import.meta.dirname, ".."));
  assert.ok(files.includes("tests/test-wiring.test.mjs") && files.includes("tests/ux-before/capture/capture.mjs"), "the guard must see the kit's test sources");
  assert.deepEqual({ binds, ports, stale }, { binds: [], ports: [], stale: [] },
    "take a free port (tests/free-port.mjs, or listen(0)) and pass it into the fixture; a value nothing binds or connects to goes into RECORDED_PORTS with its reason");
});
