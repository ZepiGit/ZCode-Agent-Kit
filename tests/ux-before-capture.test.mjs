// The UX capture tooling's host-specific parts (tests/ux-before/capture/host.mjs)
// and the comparison's explicit normalisation (tests/ux-before/compare.mjs),
// proven on Linux with injected Windows paths. Failures fixed here come from
// CI run 42236936458 (ux-before job): git 2.56's transfer-progress text on
// ubuntu, and on windows a fixture-proxy path whose backslashes were read as
// escapes, GNU tar reading `C:` as a remote host, and a silent `git clone`;
// then (staging/06) git.exe crashing with 0xC0000005 under a Git Bash step's
// environment in the baseline step only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneArgs, describeFailure, fakeProxySource, fixtureBaseEnv, importBase, pathForms, swapPath, tarBinary, windowsGitDir } from "./ux-before/capture/host.mjs";
import { VOLATILE, compareCaptures, normaliseVolatile } from "./ux-before/compare.mjs";

const ROOT = join(import.meta.dirname, "..");
const TEMPLATE = readFileSync(join(ROOT, "tests", "ux-before", "capture", "fake-proxy.ts"), "utf8");
const literalOf = (source) => source.match(/^const REAL_PROXY_SRC = (.*);$/m)[1];

// ------------------------------------------------------- git progress (ubuntu)
// Byte forms from the committed baseline (git 2.43) and from git 2.56 (CI).
const OLD_TTY = [
  "remote: Enumerating objects: 5, done.\x1b[K",
  "remote: Counting objects: 100% (5/5), done.\x1b[K",
  "remote: Total 3 (delta 2), reused 0 (delta 0), pack-reused 0\x1b[K",
  "Unpacking objects:  33% (1/3)",
  "Unpacking objects: 100% (3/3), 270 bytes | 270.00 KiB/s, done.",
];
const NEW_TTY = [
  "\x1b[Kremote: Enumerating objects: 5, done.",
  "\x1b[Kremote: Counting objects:  20% (1/5)",
  "\x1b[Kremote: Counting objects: 100% (5/5), done.",
  "\x1b[Kremote: Compressing objects: 100% (3/3), done.",
  "\x1b[Kremote: Total 3 (delta 2), reused 0 (delta 0), pack-reused 0 (from 0)",
  "Receiving objects: 100% (3/3), 269 bytes | 134.00 KiB/s, done.",
  "Resolving deltas: 100% (2/2), done.",
];
const around = (block) => ["n", "n", ...block, "From <FIXTURE>/origin", "   <SHA>..<SHA>  main       -> origin/main", "not running", "Fast-forward", ""].join("\n");

test("git's transfer progress normalises to one marker whatever the git version", () => {
  const a = normaliseVolatile(around(OLD_TTY));
  assert.equal(a, normaliseVolatile(around(NEW_TTY)));
  assert.equal(a, normaliseVolatile(around(OLD_TTY.map((l) => l.replace("\x1b[K", "        ")))), "TERM=dumb pads with spaces instead");
  assert.equal(a, normaliseVolatile(around(OLD_TTY.map((l) => l.replace("\x1b[K", "")))), "the ANSI-stripped .txt form");
  assert.equal(a, "n\nn\n<GIT TRANSFER PROGRESS>\nFrom <FIXTURE>/origin\n   <SHA>..<SHA>  main       -> origin/main\nnot running\nFast-forward\n");
});

test("the git progress rule touches no kit line: indented, mid-line or other wording stays", () => {
  const kit = [
    "  remote: indented kit text",
    "update: remote: not at line start",
    "Unpacking the release archive",
    "FAIL  remote: a check name",
    "",
  ].join("\n");
  assert.equal(normaliseVolatile(kit), kit);
  assert.ok(VOLATILE.some(([name]) => name === "git transfer progress"));
});

// ------------------------------------------------- fixture proxy (windows)
test("the fixture proxy's source literal keeps a Windows path: a file URL, every backslash intact", () => {
  for (const dir of ["D:\\a\\_temp\\ux-base\\zcode-proxy-src", "D:\\a\\ZCode-Agent-Kit\\ZCode-Agent-Kit\\zcode-proxy-src"]) {
    const ref = JSON.parse(literalOf(fakeProxySource(TEMPLATE, dir, { windows: true })));
    assert.equal(ref, importBase(dir, { windows: true }));
    assert.match(ref, /^file:\/\/\/D:\/a\//);
    assert.equal(fileURLToPath(`${ref}/src/index.ts`, { windows: true }), `${dir}\\src\\index.ts`);
  }
});

test("the original raw substitution is what broke: `\\u` and `\\a` inside quotes are escapes", () => {
  const raw = TEMPLATE.replace("__REAL_PROXY_SRC__", "D:\\a\\_temp\\ux-base\\zcode-proxy-src");
  assert.throws(() => JSON.parse(literalOf(raw)), "a raw drive path is no valid string literal");
  assert.equal(JSON.parse(literalOf(TEMPLATE.replace("__REAL_PROXY_SRC__", "D:\\a\\ZCode"))
    .replace(/\\(?!["\\/bfnrtu])/g, "")), "D:aZCode", "the CI message 'D:aZCode-Agent-Kit…' is this escape loss");
});

test("POSIX: the fixture proxy imports from a file URL of the same directory", () => {
  const ref = JSON.parse(literalOf(fakeProxySource(TEMPLATE, "/home/runner/work/kit/zcode-proxy-src")));
  assert.equal(ref, "file:///home/runner/work/kit/zcode-proxy-src");
  assert.throws(() => fakeProxySource("const X = 1;", "/x"), /lost its __REAL_PROXY_SRC__ literal/);
});

test("Linux end to end: a kit path with `\\u` in it starts the fixture proxy (the class of the Windows failure)", {
  timeout: 120_000,
  skip: process.platform === "win32" ? "a backslash in a directory name is POSIX-only" : false,
}, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-capture-bs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const kit = join(dir, "k\\ux-base");
  symlinkSync(ROOT, kit);
  const out = join(dir, "out");
  const run = spawnSync(process.execPath, [join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "--kit", kit, "--out", out,
    "--only", "^proxy-status-json-running$", "--variants", "pipe"], {
    encoding: "utf8", timeout: 110_000,
    // Its own port: tests/json-superset.test.mjs captures on UX_CAPTURE_PORT in parallel (node --test runs files concurrently).
    env: { ...process.env, UX_CAPTURE_PORT: String(Number(process.env.UX_CAPTURE_PORT ?? 18458) + 1) },
  });
  assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-2000));
  const [m] = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(m.error, undefined, m.error);
  assert.equal(m.exit, 0);
  assert.equal(JSON.parse(readFileSync(join(out, "proxy", "proxy-status-json-running", "pipe.txt"), "utf8").replace(/<PID>/g, "0")).health, "ours", "the fixture proxy answered as this kit's own");
});

// ----------------------------------------------------------- tar, git, paths
test("tar: System32's bsdtar on Windows (GNU tar reads `C:` as a host); `tar` elsewhere", () => {
  assert.equal(tarBinary({ windows: true, env: { SystemRoot: "C:\\Windows" } }), "C:\\Windows\\System32\\tar.exe");
  assert.equal(tarBinary({ windows: true, env: { SYSTEMROOT: "D:\\WINNT" } }), "D:\\WINNT\\System32\\tar.exe");
  assert.equal(tarBinary({ windows: true, env: {} }), "C:\\Windows\\System32\\tar.exe");
  assert.equal(tarBinary({ windows: false, env: { SystemRoot: "C:\\Windows" } }), "tar");
});

test("clone: --no-local on Windows only", () => {
  assert.deepEqual(cloneArgs(["clone", "-q", "--bare", "a", "b"], { windows: true }), ["clone", "--no-local", "-q", "--bare", "a", "b"]);
  assert.deepEqual(cloneArgs(["clone", "-q", "--bare", "a", "b"]), ["clone", "-q", "--bare", "a", "b"]);
});

test("a failed prep step reports status, signal, error and both streams (the silent `git clone` of run 42236936458)", () => {
  const msg = describeFailure("git clone -q --bare A B", { status: 128, signal: null, stdout: "", stderr: "fatal: could not create work tree dir 'B'\n" });
  assert.equal(msg, "git clone -q --bare A B: status 128; stderr: fatal: could not create work tree dir 'B'");
  assert.match(describeFailure("x", { status: null, signal: "SIGKILL", error: Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" }), stdout: null, stderr: null }),
    /^x: status null; signal SIGKILL; error ETIMEDOUT spawnSync git ETIMEDOUT$/);
});

test("Windows path normalisation covers the long name, JSON escaping, forward slashes and a lower-case drive", () => {
  const short = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ux-kit-ab12\\kit";
  const long = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ux-kit-ab12\\kit";
  const opts = { windows: true, realpath: (p) => (p === short ? long : p) };
  const forms = pathForms(short, opts);
  for (const f of [short, long, long.replace(/\\/g, "\\\\"), long.replace(/\\/g, "/"), "c:" + long.slice(2)]) assert.ok(forms.includes(f), f);
  const json = JSON.stringify({ detail: `${long}\\proxy\\config.yaml`, other: `${short}/logs` });
  assert.equal(swapPath(json, short, "<KIT>", opts), '{"detail":"<KIT>\\\\proxy\\\\config.yaml","other":"<KIT>/logs"}');
  assert.deepEqual(pathForms("/tmp/ux-kit-ab/kit"), ["/tmp/ux-kit-ab/kit"], "POSIX keeps the original single form");
});

// ------------------------------------------------------------- comparison
function captureSet(root, files, manifest) {
  for (const [rel, text] of Object.entries(files)) { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); }
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
}

test("compare: a failed baseline capture fails loudly; volatile values never hide a kit change", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-compare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const m = (id, extra = {}) => ({ group: "g", id, variant: "pipe", exit: 0, ...extra });
  captureSet(join(dir, "base"), { "g/a/pipe.txt": "OK used 14h ago\n", "g/b/pipe.txt": "x\n" }, [m("a"), m("b"), m("c", { exit: undefined, error: "fixture proxy did not start" })]);
  captureSet(join(dir, "same"), { "g/a/pipe.txt": "OK used 1d ago\n", "g/b/pipe.txt": "x\n", "g/c/pipe.txt": "y\n" }, [m("a"), m("b"), m("c")]);
  assert.deepEqual(compareCaptures(join(dir, "base"), join(dir, "same")),
    ["unexpected: g/c/pipe.txt", "baseline capture error: g/c/pipe: fixture proxy did not start"]);
  captureSet(join(dir, "changed"), { "g/a/pipe.txt": "FAIL used 1d ago\n", "g/b/pipe.txt": "x\n" }, [m("a", { exit: 1 }), m("b"), m("c", { error: "boom" })]);
  const diffs = compareCaptures(join(dir, "base"), join(dir, "changed"), { only: /^g\/(a|b)$/ });
  assert.deepEqual(diffs, ['differs: g/a/pipe.txt line 1\n  before: "OK used <AGE> ago"\n  now:    "FAIL used <AGE> ago"', "exit code: g/a/pipe was 0, now 1"]);
});

// ------------------------------------------- git under Git Bash (staging/06)
const GIT = "C:\\Program Files\\Git";
const gitTree = new Set([`${GIT}\\cmd\\git.exe`, `${GIT}\\bin\\git.exe`, `${GIT}\\mingw64\\bin\\git.exe`, "D:\\tools\\portable-git\\git.exe"]);
const exists = (p) => gitTree.has(p);

test("windows git: any git.exe of a Git for Windows tree maps to its cmd launcher", () => {
  // A `shell: bash` step: mingw64\bin and usr\bin come first.
  assert.equal(windowsGitDir(`${GIT}\\mingw64\\bin;${GIT}\\usr\\bin;C:\\Windows\\System32`, { exists }), `${GIT}\\cmd`);
  // pwsh / cmd: Git\bin or Git\cmd, with or without a trailing backslash.
  assert.equal(windowsGitDir(`C:\\Windows;${GIT}\\bin;${GIT}\\cmd`, { exists }), `${GIT}\\cmd`);
  assert.equal(windowsGitDir(`${GIT}\\cmd\\`, { exists }), `${GIT}\\cmd`);
  // A git.exe outside a Git for Windows tree is used as found; no git at all gives null.
  assert.equal(windowsGitDir("D:\\tools\\portable-git;" + `${GIT}\\cmd`, { exists }), "D:\\tools\\portable-git");
  assert.equal(windowsGitDir("C:\\Windows\\System32", { exists }), null);
  assert.equal(windowsGitDir(`${GIT}\\mingw64\\bin`, { exists: (p) => p === `${GIT}\\mingw64\\bin\\git.exe` }), `${GIT}\\mingw64\\bin`, "no launcher: keep the binary");
});

test("windows fixture env: Git Bash state and the fixture's own variables are dropped, the Windows runtime is kept", () => {
  const host = {
    Path: "x", TEMP: "t", tmp: "t2", MSYSTEM: "MINGW64", MSYSTEM_PREFIX: "/mingw64", MINGW_PREFIX: "/mingw64", MSYS: "winsymlinks", EXEPATH: "C:\\Program Files\\Git\\bin",
    ORIGINAL_PATH: "p", SHLVL: "1", PWD: "/d/a", OLDPWD: "/", SHELL: "/usr/bin/bash", _: "/usr/bin/node", CHERE_INVOKING: "1",
    SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATHEXT: ".COM;.EXE", ComSpec: "C:\\Windows\\system32\\cmd.exe",
    HOMEDRIVE: "C:", HOMEPATH: "\\Users\\runneradmin", USERNAME: "runneradmin", NUMBER_OF_PROCESSORS: "4", PROCESSOR_ARCHITECTURE: "AMD64",
    TERM: "xterm-256color", CI: "true", ZCODE_KIT_HOME: "z", NODE_OPTIONS: "--x",
  };
  assert.deepEqual(Object.keys(fixtureBaseEnv(host, { windows: true })).sort(),
    ["ComSpec", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS", "PATHEXT", "PROCESSOR_ARCHITECTURE", "SystemRoot", "USERNAME", "WINDIR"]);
});

test("POSIX fixture env: exactly the original Phase 1C filter", () => {
  const host = { PATH: "/usr/bin", HOME: "/h", LANG: "C.UTF-8", MSYSTEM: "x", SHELL: "/bin/sh", TERM: "xterm", COLUMNS: "80", CI: "1", ZCODE_X: "1", https_proxy: "p", NO_COLOR: "1", CLICOLOR_FORCE: "1" };
  assert.deepEqual(fixtureBaseEnv(host), { PATH: "/usr/bin", HOME: "/h", LANG: "C.UTF-8", MSYSTEM: "x", SHELL: "/bin/sh" });
});

test("CI: the Windows baseline is captured under the same shell as the equivalence step (pwsh)", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8").replace(/\r\n/g, "\n");
  const job = ci.slice(ci.indexOf("\n  ux-before:\n"), ci.indexOf("\n  memory-budget:\n"));
  const step = (name) => job.slice(job.indexOf(`- name: ${name}`)).split(/\n      - /)[0];
  const baseline = step("Windows baseline from the base commit");
  const equivalence = step("Before-equivalence (byte for byte)");
  assert.match(baseline, /\n {8}shell: pwsh\n/);
  assert.doesNotMatch(equivalence, /shell:/, "the equivalence step uses the runner default, pwsh on windows");
  assert.match(baseline, /capture\.mjs --kit \$kit --variants pipe,ci --out \$out/);
});

test("capture.mjs builds the fixture env and the Windows git dir through host.mjs (wiring of the Windows-only branch)", () => {
  const src = readFileSync(join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "utf8");
  assert.match(src, /const env = fixtureBaseEnv\(process\.env, \{ windows: IS_WIN \}\);/);
  assert.match(src, /windowsGitDir\(process\.env\.PATH \?\? process\.env\.Path, \{ exists: existsSync \}\)/);
  assert.doesNotMatch(src, /for \(const \[k, v\] of Object\.entries\(process\.env\)\)/, "no second, unfiltered env copy");
});
