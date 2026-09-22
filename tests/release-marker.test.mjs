// Audit backlog: version-bound release gate — a marker for a different
// version must keep the generated package private, and the package-internal
// verifier must reject a version changed after the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");

function packageFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zcode-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text = "// fixture\n") => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put("pack/build.mjs", readFileSync(join(KIT, "pack/build.mjs"), "utf8"));
  put("pack/verify-payload.mjs", readFileSync(join(KIT, "pack/verify-payload.mjs"), "utf8"));
  put("package.json", JSON.stringify({ name: "zcode-agent-kit", version: "1.2.3",
    bin: JSON.parse(readFileSync(join(KIT, "package.json"), "utf8")).bin }));
  put("LICENSE", "Fixture license text (not a license grant)\n");
  put("LICENSE.extra", "not allowlisted\n");
  put("setup.mjs.extra", "not allowlisted\n");
  put("pack/ALLOW_PUBLISH", "1.2.3\n");
  for (const path of ["cli/zcode-kit.mjs", "cli/heal.mjs", "cli/adapters/omp.mjs", "cli/adapters/pi.mjs",
    "cli/adapters/goose.mjs", "proxy/zcode-proxy-manager.mjs", "proxy/resolve-zcode-proxy-key.mjs",
    "proxy/config.example.yaml", "mcp/zcode-harness-mcp/dist/index.js", "setup.mjs",
    "bin/zcode-claude.cmd", "bin/zcode-codex.cmd", "lib/transaction.mjs", "scripts/verify-release-marker.mjs"]) put(path);
  put('proxy/config.example.yaml', 'auth:\n  proxyApiKey: "GENERATE_ME"\n');
  for (const args of [["init", "--quiet"], ["add", "."]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const member of ["cli", "lib"]) cpSync(join(KIT, member), join(root, member), { recursive: true });
  put("cli/local-only.mjs");
  const build = (...args) => {
    const result = spawnSync(process.execPath, [join(root, "pack/build.mjs"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(root, "pack/dist/package.json"), "utf8"));
  };
  return { root, build };
}

test("npm payload includes the license and version marker, but not file-prefix lookalikes", (t) => {
  const { root, build } = packageFixture(t);
  const pkg = build();
  assert.ok(pkg.files.includes("LICENSE"), "license must be explicitly allowlisted");
  assert.ok(pkg.files.includes("ALLOW_PUBLISH"), "copied marker must survive npm's files allowlist");
  assert.equal(pkg.private, false);
  assert.equal(existsSync(join(root, "pack/dist/LICENSE.extra")), false);
  assert.equal(existsSync(join(root, "pack/dist/setup.mjs.extra")), false);
  const packed = process.platform === "win32"
    ? spawnSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: join(root, "pack/dist"), encoding: "utf8", shell: true, timeout: 30_000,
    })
    : spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: join(root, "pack/dist"), encoding: "utf8", timeout: 30_000,
    });
  assert.equal(packed.status, 0, packed.stderr);
  const packResult = JSON.parse(packed.stdout);
  // npm 12 keys results by package name; npm 11 returns an array.
  const paths = (Array.isArray(packResult) ? packResult[0] : packResult["zcode-agent-kit"]).files.map((f) => f.path);
  assert.ok(paths.includes("LICENSE"));
  assert.ok(paths.includes("ALLOW_PUBLISH"));
  assert.equal(paths.includes("LICENSE.extra"), false);
});

test("tracked-only packaging excludes new sources without hiding them from default local builds", (t) => {
  const { root, build } = packageFixture(t);
  build();
  assert.ok(existsSync(join(root, "pack/dist/cli/local-only.mjs")));
  build("--tracked-only");
  assert.equal(existsSync(join(root, "pack/dist/cli/local-only.mjs")), false);
  assert.ok(existsSync(join(root, "pack/dist/cli/heal.mjs")));
  assert.ok(existsSync(join(root, "cli/local-only.mjs")), "validation must not hide or remove new sources");
});

test("payload verification rejects a missing CLI heal import", (t) => {
  const { root, build } = packageFixture(t);
  build();
  const verify = () => spawnSync(process.execPath, [join(root, "pack/verify-payload.mjs")], { encoding: "utf8" });
  const good = verify();
  assert.equal(good.status, 0, good.stderr);
  rmSync(join(root, "pack/dist/cli/heal.mjs"));
  const bad = verify();
  assert.equal(bad.status, 1, "a package missing heal must fail closed");
  assert.match(bad.stderr, /required file missing: cli\/heal\.mjs/);
});

test("payload verification rejects a missing transaction runtime import", (t) => {
  const { root, build } = packageFixture(t);
  build();
  const verify = () => spawnSync(process.execPath, [join(root, "pack/verify-payload.mjs")], { encoding: "utf8" });
  assert.equal(verify().status, 0);
  rmSync(join(root, "pack/dist/lib/transaction.mjs"));
  const bad = verify();
  assert.equal(bad.status, 1, "a package missing transaction support must fail closed");
  assert.match(bad.stderr, /required file missing: lib\/transaction\.mjs/);
});

for (const notes of [false, true]) {
  test(`release creation targets the built HEAD with ${notes ? "custom" : "generated"} notes`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "zcode-release-target-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    // Execute the workflow's real shell body with only remote GitHub replaced.
    // Windows CI checks out with CRLF; normalize or the step split finds nothing.
    const workflow = readFileSync(join(KIT, ".github/workflows/release.yml"), "utf8").replace(/\r\n/g, "\n");
    const step = workflow.split("      - name: Create the GitHub release\n")[1]?.split("      - name:")[0];
    assert.ok(step, "release creation step must exist");
    const body = step.split("        run: |\n")[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
    if (notes) {
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "docs/RELEASE_NOTES_v1.2.3.md"), "fixture notes\n");
    }
    const head = "a".repeat(40);
    const script = `set -eu
GITHUB_REF_TYPE=branch
GITHUB_REF_NAME=main
VERSION=1.2.3
GITHUB_SHA=${"b".repeat(40)}
git() {
  [ "$1" = rev-parse ] && [ "$2" = HEAD ] || return 90
  printf '%s\\n' '${head}'
}
gh() {
  [ "$1" = release ] || return 91
  if [ "$2" = view ]; then return 1; fi
  [ "$2" = create ] || return 92
  printf '%s\\n' "$@" > release-args
}
${body}`;
    const result = spawnSync("sh", ["-c", script], { cwd: root, encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(join(root, "release-args"), "utf8").trim().split(/\r?\n/);
    const target = args.indexOf("--target");
    assert.ok(target >= 0, "release creation must pin the built commit, not latest main");
    assert.equal(args[target + 1], head, "must use current HEAD, not pre-auto-bump GITHUB_SHA");
    assert.ok(args.includes(notes ? "--notes-file" : "--generate-notes"));
  });
}

test("pack build keeps the generated package private when the marker names another version", (t) => {
  const { root, build } = packageFixture(t);
  writeFileSync(join(root, "pack/ALLOW_PUBLISH"), "9.9.9\n");
  const pkg = build();
  assert.equal(pkg.private, true, "mismatched marker version must keep the package private");
  assert.deepEqual(pkg.bin, {
    "zcode-kit": "cli/zcode-kit.mjs",
    "zcode-agent-kit": "cli/zcode-kit.mjs",
  }, "generated npm package must expose both documented CLI names");
  assert.equal(pkg.scripts.postinstall, "node setup.mjs --postinstall-hint");
  assert.match(readFileSync(join(root, "pack/dist/cli/zcode-kit.mjs"), "utf8"), /^#!\/usr\/bin\/env node/);
});

test("pack build tolerates a process holding pack/dist as its CWD (Windows EPERM)", (t) => {
  const { root, build } = packageFixture(t);
  build();
  // Windows cannot remove a directory that is any process's working directory
  // (an open shell inside pack/dist is enough). The build must recover by
  // emptying the directory in place instead of failing the release pipeline.
  const dist = join(root, "pack", "dist");
  mkdirSync(dist, { recursive: true });
  const holder = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"], { cwd: dist, stdio: "ignore" });
  try {
    const res = spawnSync(process.execPath, [join(root, "pack", "build.mjs")], { encoding: "utf8" });
    assert.equal(res.status, 0, `build should recover from a locked dist (stderr: ${res.stderr})`);
  } finally {
    holder.kill();
  }
});

test("CLI entry guard survives npm-style path forms (casing/symlink/junction)", (t) => {
  const { root, build } = packageFixture(t);
  build();
  // npm exposes global bins through paths that differ from the realized
  // module URL: differently-cased argv (Windows shims), symlinks (POSIX bins),
  // junctions (`npm i -g <folder>`). The entry check must canonicalize via
  // realpath or the installed CLI silently no-ops.
  const distCli = join(root, "pack", "dist", "cli", "zcode-kit.mjs");
  const cased = process.platform === "win32" ? distCli.replace(/^C:/i, "c:") : distCli;
  const res = spawnSync(process.execPath, [cased, "--help"], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /zcode-kit/, "CLI must answer --help through a non-canonical argv path");
  if (process.platform !== "win32") {
    const linkDir = mkdtempSync(join(tmpdir(), "zcode-entry-"));
    try {
      const link = join(linkDir, "zcode-kit");
      try {
        symlinkSync(distCli, link);
      } catch {
        return; // unprivileged sandbox without symlink rights: skip this leg
      }
      const viaLink = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
      assert.equal(viaLink.status, 0, viaLink.stderr);
      assert.match(viaLink.stdout, /zcode-kit/, "CLI must answer --help through a symlinked bin");
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
  }
});

test("verify-release-marker rejects a version changed after the build", () => {
  const dir = mkdtempSync(join(tmpdir(), "zcode-marker-"));
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(join(KIT, "scripts", "verify-release-marker.mjs"), join(dir, "scripts", "verify-release-marker.mjs"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fake", version: "1.0.0" }));
    writeFileSync(join(dir, "ALLOW_PUBLISH"), "1.0.0\n");

    const ok = spawnSync(process.execPath, [join(dir, "scripts", "verify-release-marker.mjs")], { encoding: "utf8" });
    assert.equal(ok.status, 0, `matching version must pass (${ok.stderr})`);

    // the version changed after the build — the shipped marker no longer
    // names it, and a normal publish lifecycle must fail closed
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fake", version: "2.0.0" }));
    const bad = spawnSync(process.execPath, [join(dir, "scripts", "verify-release-marker.mjs")], { encoding: "utf8" });
    assert.equal(bad.status, 1, "changed version must be rejected");
    assert.match(bad.stderr, /2\.0\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
