import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");

function put(root, path, text = "// fixture\n") {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

function packageFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zcode-release-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, "pack/build.mjs", readFileSync(join(KIT, "pack", "build.mjs"), "utf8"));
  put(root, "pack/verify-payload.mjs", readFileSync(join(KIT, "pack", "verify-payload.mjs"), "utf8"));
  put(root, "scripts/verify-release-marker.mjs", readFileSync(join(KIT, "scripts", "verify-release-marker.mjs"), "utf8"));
  put(root, "package.json", JSON.stringify({
    name: "zcode-agent-kit", version: "1.2.3", description: "fixture", license: "MIT",
    bin: { "zcode-kit": "cli/zcode-kit.mjs" },
  }));
  put(root, "pack/ALLOW_PUBLISH", "1.2.3\n");
  put(root, "LICENSE", "MIT License\n");
  put(root, "mcp/zcode-harness-mcp/LICENSE", "MCP MIT License\n");
  put(root, "zcode-proxy-src/README.md", "Vendored from upstream v4.6.4; upstream README declares MIT.\n");
  put(root, "proxy/config.example.yaml", "auth:\n  proxyApiKey: \"GENERATE_ME\"\n");
  for (const path of [
    "cli/zcode-kit.mjs", "cli/heal.mjs", "cli/adapters/omp.mjs", "cli/adapters/pi.mjs",
    "cli/adapters/goose.mjs", "lib/transaction.mjs", "proxy/zcode-proxy-manager.mjs",
    "proxy/resolve-zcode-proxy-key.mjs", "mcp/zcode-harness-mcp/dist/index.js", "setup.mjs",
    "bin/zcode-claude.cmd", "bin/zcode-codex.cmd", "bin/zcode-aider.cmd",
    "bin/zcode-claude.sh", "bin/zcode-codex.sh", "bin/zcode-aider.sh",
    "zcode-proxy-src/src/runtime.ts",
  ]) put(root, path);
  put(root, "zcode-proxy-src/src/runtime.test.ts", "throw new Error('must not ship');\n");
  put(root, "zcode-proxy-src/src/__fixtures__/credential.json", "fixture\n");
  for (const args of [["init", "--quiet"], ["add", "."]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const build = spawnSync(process.execPath, [join(root, "pack", "build.mjs"), "--tracked-only"], { cwd: root, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  return root;
}

test("release workflow keeps automatic main releases while isolating write and OIDC permissions to the publish job", () => {
  const workflow = readFileSync(join(KIT, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
  const top = workflow.split("jobs:\n")[0];
  const testJob = workflow.split("  test:\n")[1]?.split("  release-and-publish:\n")[0] ?? "";
  const publishJob = workflow.split("  release-and-publish:\n")[1] ?? "";
  assert.match(workflow, /push:\n\s+branches: \["?main"?(?:,\s*"feature\/account-rotator")?\]/, "main pushes must remain automatic release triggers");
  assert.match(workflow, /workflow_dispatch:/, "manual dispatch must remain available");
  assert.match(top, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(top, /id-token:\s*write|contents:\s*write/);
  assert.match(testJob, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(testJob, /id-token:\s*write|contents:\s*write/);
  assert.match(publishJob, /permissions:\n\s+contents: write\n\s+id-token: write/);
  assert.equal((workflow.match(/id-token:\s*write/g) ?? []).length, 1, "OIDC must exist only on the publish job");
  assert.match(publishJob, /if:\s*\$\{\{[^\n]*(refs\/heads\/main|github\.ref_type\s*==\s*'tag')[^\n]*\}\}/);
  assert.match(publishJob, /!contains\(github\.ref_name, '-account-rotator\.'\)/, "feature prerelease tags must not enter stable npm publishing");
  assert.match(publishJob, /git push --atomic origin HEAD:main "v\$NEW"/, "auto-bump may only update main and must move commit and tag together");
  assert.match(publishJob, /echo "\$NEW" > pack\/ALLOW_PUBLISH/, "auto-version consistency marker remains intentional");
  assert.doesNotMatch(workflow, /^\s*environment:/m, "automatic releases must not gain a manual environment gate");
});

test("account-rotator feature releases are isolated prereleases built from the tested SHA", () => {
  const workflow = readFileSync(join(KIT, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
  const featureJob = workflow.split("  feature-account-rotator-prerelease:\n")[1] ?? "";
  assert.ok(featureJob, "feature prerelease job must exist");
  assert.match(workflow, /branches: \["main", "feature\/account-rotator"\]/);
  assert.match(featureJob, /if: \$\{\{ github\.ref == 'refs\/heads\/feature\/account-rotator' \}\}/);
  assert.match(featureJob, /needs: test/);
  assert.match(featureJob, /permissions:\n\s+contents: write/);
  assert.doesNotMatch(featureJob, /id-token:\s*write/);
  assert.match(featureJob, /-account-rotator\.\$\{GITHUB_RUN_NUMBER\}\.\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(featureJob, /GIT_INDEX_FILE=.*git read-tree HEAD/);
  assert.match(featureJob, /GIT_INDEX_FILE=.*git write-tree/);
  assert.match(featureJob, /pack\/ALLOW_PUBLISH -export-ignore/);
  assert.match(featureJob, /git archive .*\$\{TAG\}\.tar\.gz.*\$TREE/);
  assert.match(featureJob, /pack\/ALLOW_PUBLISH/);
  assert.match(featureJob, /--prerelease --latest=false/);
  assert.match(featureJob, /--target "\$SOURCE_SHA"/);
  assert.doesNotMatch(featureJob, /npm publish/);
  assert.doesNotMatch(featureJob, /git push/);
});

test("package build excludes source tests/fixtures and includes locally available license notices", (t) => {
  const root = packageFixture(t);
  const dist = join(root, "pack", "dist");
  assert.ok(existsSync(join(dist, "zcode-proxy-src", "src", "runtime.ts")));
  assert.equal(existsSync(join(dist, "zcode-proxy-src", "src", "runtime.test.ts")), false);
  assert.equal(existsSync(join(dist, "zcode-proxy-src", "src", "__fixtures__")), false);
  assert.ok(existsSync(join(dist, "mcp", "zcode-harness-mcp", "LICENSE")));
  assert.ok(existsSync(join(dist, "zcode-proxy-src", "README.md")));
  const verify = spawnSync(process.execPath, [join(root, "pack", "verify-payload.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);
});

test("payload verification detects full builder-home paths even without USERPROFILE", (t) => {
  const root = packageFixture(t);
  const leakHome = join(root, "private-builder-home");
  writeFileSync(join(root, "pack", "dist", "cli", "zcode-kit.mjs"), `const leaked = ${JSON.stringify(leakHome)};\n`);
  const env = { ...process.env, HOME: leakHome, USERPROFILE: "" };
  const result = spawnSync(process.execPath, [join(root, "pack", "verify-payload.mjs")], { cwd: root, encoding: "utf8", env });
  assert.equal(result.status, 1, "an absolute builder-home leak must fail payload verification");
  assert.match(result.stderr, /builder home path/i);
});

test("payload verification rejects token-shaped content and a mutated config template", (t) => {
  const root = packageFixture(t);
  const verify = () => spawnSync(process.execPath, [join(root, "pack", "verify-payload.mjs")], { cwd: root, encoding: "utf8" });
  writeFileSync(join(root, "pack", "dist", "cli", "zcode-kit.mjs"), "const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';\n");
  let result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /secret-shaped content/i);
  writeFileSync(join(root, "pack", "dist", "cli", "zcode-kit.mjs"), "// clean\n");
  writeFileSync(join(root, "pack", "dist", "proxy", "config.example.yaml"), "auth:\n  proxyApiKey: \"real-looking-key\"\n");
  result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GENERATE_ME|config template/i);
});

test("root attributes normalize scripts and keep release archives free of CI/tests/vendor-only assets", () => {
  const paths = [
    "install.sh", "install.ps1", "bin/zcode-claude.sh", "bin/zcode-claude.cmd",
    "tests/installer.test.mjs", ".github/workflows/ci.yml", "pack/build.mjs",
    "zcode-proxy-src/.github/workflows/release.yml", "zcode-proxy-src/docs/images/android/example.png",
    "zcode-proxy-src/scripts/example.sh", "mcp/zcode-harness-mcp/_probes/example.txt",
  ];
  const result = spawnSync("git", ["check-attr", "eol", "export-ignore", "--", ...paths], { cwd: KIT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install\.sh: eol: lf/);
  assert.match(result.stdout, /install\.ps1: eol: crlf/);
  assert.match(result.stdout, /bin\/zcode-claude\.cmd: eol: crlf/);
  for (const path of paths.slice(4)) {
    assert.match(result.stdout, new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: export-ignore: set`));
  }
});

test("release marker verifier describes a consistency check rather than human authorization", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-marker-consistency-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(join(KIT, "scripts", "verify-release-marker.mjs"), join(root, "scripts", "verify-release-marker.mjs"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.2.3" }));
    writeFileSync(join(root, "ALLOW_PUBLISH"), "1.2.3\n");
    const result = spawnSync(process.execPath, [join(root, "scripts", "verify-release-marker.mjs")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /consisten/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /consent|authori[sz]ation/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
