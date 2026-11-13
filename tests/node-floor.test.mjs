// Node.js support floor (spec stories 124/125): `setup` and
// `update` on a Node below 24 refuse before they change any state, with
// what/why/next, and leave the existing installation as it was.
//
// "Fake old Node": the real runtime runs the kit with a preload that reports
// an older `process.version` and records (and blocks) every child process and
// network call, so the test can prove that nothing ran, not only that no file
// changed. Everything lives in a temp fixture: a copy of the kit as an
// installed release with its machine-local state, and a temp HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const KIT = join(import.meta.dirname, "..");

/** Every entry under `dir` (itself included) with type, mode, mtime and content hash. */
function snapshotTree(dir) {
  const self = lstatSync(dir);
  const out = [`. dir ${self.mode.toString(8)} ${self.mtimeMs}`];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path);
      const kind = st.isDirectory() ? "dir" : st.isSymbolicLink() ? "link" : "file";
      const content = kind === "file" ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
      out.push(`${relPath} ${kind} ${st.mode.toString(8)} ${st.mtimeMs} ${content}`);
      if (kind === "dir") walk(path, relPath);
    }
  };
  walk(dir, "");
  return out;
}

const PRELOAD = `
import { createRequire, syncBuiltinESMExports } from "node:module";
import { appendFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const version = process.env.FAKE_NODE_VERSION;
Object.defineProperty(process, "version", { value: version });
Object.defineProperty(process.versions, "node", { value: version.replace(/^v/, "") });
const record = (line) => appendFileSync(process.env.FAKE_NODE_CALLS, line + "\\n");
const cp = require("node:child_process");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  cp[name] = (command, ...rest) => { record(name + " " + command + " " + JSON.stringify(rest[0] ?? [])); throw new Error("child processes are disabled in this fixture"); };
}
syncBuiltinESMExports();
globalThis.fetch = async (url) => { record("fetch " + url); throw new Error("network is disabled in this fixture"); };
`;

/**
 * A kit installed as a release (no .git, state in the installation root) with
 * a key, a user config, a recorded transaction, logs, a stored harness
 * decision and the Bun path; HOME holds an OMP integration made by the kit.
 */
function installedKit(t) {
  const root = mkdtempSync(join(tmpdir(), "zcode-node-floor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const kit = join(root, "kit");
  const home = join(root, "home");
  for (const member of ["cli", "lib", "proxy", "zcode-proxy-src/src/tui"]) {
    cpSync(join(KIT, member), join(kit, member), { recursive: true, filter: (src) => !/[\\/](logs|backups|generated)$/.test(src) && !/config\.yaml$/.test(src) });
  }
  cpSync(join(KIT, "package.json"), join(kit, "package.json"));
  const put = (base, rel, body) => { mkdirSync(join(base, rel, ".."), { recursive: true }); writeFileSync(join(base, rel), body); };
  put(kit, ".proxykey", "fixture-proxy-key-0123456789\n");
  put(kit, "proxy/config.yaml", readFileSync(join(KIT, "proxy", "config.example.yaml"), "utf8")
    .replace('proxyApiKey: "GENERATE_ME"', 'proxyApiKey: "fixture-proxy-key-0123456789"').replace(/^  port: \d+/m, "  port: 19101"));
  put(kit, ".bun-path", "/opt/bun/bin/bun\n");
  put(kit, "backups/tx-20260101T000000Z-1.manifest.json", '{"id":"tx-20260101T000000Z-1","ops":[]}\n');
  put(kit, "generated/harness-choices/omp.json", '{"schema":1,"decision":"configured"}\n');
  put(kit, "logs/heal.log", "2026-01-01T00:00:00.000Z cause=healthy action=quota-check result=ok\n");
  put(home, ".omp/agent/models.yml", "providers:\n  zcode:\n    baseUrl: http://127.0.0.1:19101\n");
  put(home, ".omp/agent/extensions/zcode-proxy-autostart.ts", "// kit-generated autostart\n");
  put(root, "preload.mjs", PRELOAD);
  return { root, kit, home, calls: join(root, "calls.log") };
}

function runKit(fixture, version, args) {
  return spawnSync(process.execPath, ["--import", pathToFileURL(join(fixture.root, "preload.mjs")).href, join(fixture.kit, "cli", "zcode-kit.mjs"), ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: fixture.home, USERPROFILE: fixture.home, XDG_CONFIG_HOME: join(fixture.home, ".config"),
      ZCODE_KIT_STATE_DIR: "", ZCODE_KIT_SKIP_DEPS: "1", ZCODE_KIT_SKIP_SMOKE: "1", NO_COLOR: "1",
      FAKE_NODE_VERSION: version, FAKE_NODE_CALLS: fixture.calls,
    },
  });
}

for (const [command, args] of [["setup", ["setup", "--harness", "none"]], ["update", ["update"]], ["update", ["update", "--version", "v9.9.9"]]]) {
  for (const version of ["v20.19.0", "v22.23.4", "v23.11.1"]) {
    test(`${args.join(" ")} on Node ${version} refuses before changing any state and leaves the installation as it was`, (t) => {
      const fixture = installedKit(t);
      const before = { kit: snapshotTree(fixture.kit), home: snapshotTree(fixture.home) };
      const result = runKit(fixture, version, args);
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.equal(existsSync(fixture.calls), false, `no child process or network call may run:\n${existsSync(fixture.calls) ? readFileSync(fixture.calls, "utf8") : ""}`);
      assert.deepEqual({ kit: snapshotTree(fixture.kit), home: snapshotTree(fixture.home) }, before,
        "the installation, its state and HOME are byte-identical (nothing created, removed or touched)");
      // what / why / next / exit, on stderr (an error block); stdout stays empty.
      assert.equal(result.stdout, "");
      const lines = result.stderr.trimEnd().split("\n");
      assert.equal(lines[0], `FAIL  Node.js ${version} is below the support floor (Node.js 24)`);
      assert.equal(lines[1], `  why: zcode-kit ${command} needs Node.js 24 or newer; nothing was changed and the existing installation keeps working`);
      const next = process.platform === "win32"
        ? [`  next: winget install --id OpenJS.NodeJS.LTS --exact, then rerun zcode-kit ${command} in a new terminal`,
          `  next: install Node.js 24 LTS or newer from https://nodejs.org/en/download, then rerun zcode-kit ${command}`]
        : [`  next: install Node.js 24 LTS or newer from https://nodejs.org/en/download, then rerun zcode-kit ${command}`,
          `  next: nvm install 24, then rerun zcode-kit ${command}`];
      assert.deepEqual(lines.slice(2), [...next, "  exit: 2"]);
    });
  }
}

for (const version of ["v24.0.0", "v26.13.0"]) {
  test(`setup on Node ${version} passes the floor and goes on to configure the installation`, (t) => {
    const fixture = installedKit(t);
    const result = runKit(fixture, version, ["setup", "--harness", "none"]);
    assert.doesNotMatch(result.stderr, /below the support floor/);
    // Past the floor, setup takes the setup lock and records its transaction.
    const manifests = readdirSync(join(fixture.kit, "backups")).filter((name) => name.endsWith(".manifest.json"));
    assert.ok(manifests.length >= 2, `setup must record a transaction on ${version}:\n${result.stdout}\n${result.stderr}`);
  });
}

// ---------------------------------------------------------------- pack build

/** A tiny git checkout of the kit's package layout around the real pack/build.mjs. */
function packFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zcode-node-floor-pack-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel, body) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), body); };
  put("pack/build.mjs", readFileSync(join(KIT, "pack", "build.mjs"), "utf8"));
  put("package.json", JSON.stringify({ name: "zcode-agent-kit", version: "1.2.3", bin: { "zcode-kit": "cli/zcode-kit.mjs" } }));
  put("LICENSE", "fixture\n");
  put("cli/zcode-kit.mjs", "// fixture\n");
  for (const args of [["init", "--quiet"], ["add", "."]]) assert.equal(spawnSync("git", args, { cwd: root, encoding: "utf8" }).status, 0);
  // A fake npm first on PATH: `npm publish --dry-run` must not reach a registry.
  const bin = join(root, "fake-bin");
  put("fake-bin/npm", "#!/bin/sh\necho \"fake npm $*\"\n");
  spawnSync("chmod", ["+x", join(bin, "npm")]);
  put("fake-bin/npm.cmd", "@echo fake npm %*\r\n@exit /b 0\r\n");
  put("preload.mjs", PRELOAD);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const env = { ...process.env, [pathKey]: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey] ?? ""}`, FAKE_NODE_CALLS: join(root, "calls.log") };
  return { root, env };
}

test("pack build declares engines.node >=24 and runs the dry-run publish without a DEP0190 warning", (t) => {
  const { root, env } = packFixture(t);
  const result = spawnSync(process.execPath, [join(root, "pack", "build.mjs"), "--dry-run-publish"], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /fake npm publish --dry-run/, "the dry-run publish ran (through the fixture's npm)");
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /DEP0190|DeprecationWarning/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "pack", "dist", "package.json"), "utf8")).engines, { node: ">=24" });
});

for (const version of ["v20.19.0", "v22.23.4"]) {
  test(`pack build on Node ${version} refuses before assembling anything`, (t) => {
    const { root, env } = packFixture(t);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(join(root, "preload.mjs")).href, join(root, "pack", "build.mjs")], {
      cwd: root, encoding: "utf8", timeout: 30_000, env: { ...env, FAKE_NODE_VERSION: version },
    });
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(root, "pack", "dist")), false, "nothing is assembled");
    assert.equal(existsSync(join(root, "calls.log")), false, "no git or npm call runs");
    assert.ok(result.stderr.includes(`pack: Node.js ${version} is below the support floor (Node.js 24)`), result.stderr);
    assert.match(result.stderr, /next: install Node\.js 24 LTS or newer from https:\/\/nodejs\.org\/en\/download|next: winget install --id OpenJS\.NodeJS\.LTS --exact/);
  });
}

// ------------------------------------------------- one floor, every copy (C8)

test("every copy of the Node floor says 24: manifests, lockfiles, installers, the floor module", async () => {
  const json = (rel) => JSON.parse(readFileSync(join(KIT, rel), "utf8"));
  assert.equal((await import("../lib/node-floor.mjs")).NODE_FLOOR, 24);
  assert.deepEqual(json("package.json").engines, { node: ">=24" });
  assert.deepEqual(json("mcp/zcode-harness-mcp/package.json").engines, { node: ">=24" });
  assert.deepEqual(json("package-lock.json").packages[""].engines, { node: ">=24" });
  assert.deepEqual(json("mcp/zcode-harness-mcp/package-lock.json").packages[""].engines, { node: ">=24" });
  const sh = readFileSync(join(KIT, "install.sh"), "utf8");
  assert.match(sh, /^NODE_FLOOR=24$/m);
  assert.doesNotMatch(sh, /-ge 20|>= ?20/);
  const ps1 = readFileSync(join(KIT, "install.ps1"), "utf8");
  assert.match(ps1, /^\$NodeFloor = 24\r?$/m);
  assert.doesNotMatch(ps1, /-ge 20|>= ?20/);
  const build = readFileSync(join(KIT, "pack", "build.mjs"), "utf8");
  assert.match(build, /^const NODE_FLOOR = 24;$/m);
});
