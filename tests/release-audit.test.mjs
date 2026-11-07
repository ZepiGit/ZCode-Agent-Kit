import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");

// Workflow text with LF line endings, read in one place: a Windows checkout
// (autocrlf) has CRLF, and every assertion here is written against LF.
const lf = (text) => text.replace(/\r\n/g, "\n");
const workflowText = (path) => lf(readFileSync(join(KIT, path), "utf8"));

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
    // ADR-0011 shared output files, required by verify-payload since ticket 05.
    "zcode-proxy-src/src/tui/width-core.mjs", "zcode-proxy-src/src/tui/width-core.d.mts",
    "zcode-proxy-src/src/tui/tokens.mjs", "zcode-proxy-src/src/tui/tokens.d.mts",
    // The CLI command modules, required by verify-payload since ticket 08.
    ...readdirSync(join(KIT, "cli", "commands")).filter((f) => f.endsWith(".mjs")).map((f) => `cli/commands/${f}`),
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
  const workflow = workflowText(".github/workflows/release.yml");
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

test("release verification timeout covers the complete registry retry budget", async () => {
  const workflow = workflowText(".github/workflows/release.yml");
  const step = workflow.split("      - name: Verify exact published version is visible on npm\n")[1]?.split("\n      - name:")[0] ?? "";
  const timeoutMinutes = Number(step.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  assert.match(step, /run: node scripts\/registry-version\.mjs verify "\$VERSION"/);
  const { verifyPublished } = await import("../scripts/registry-version.mjs");
  let retryBudgetMs = 0;
  await assert.rejects(verifyPublished("1.2.3", {
    run: (_command, _args, options) => {
      retryBudgetMs += options.timeout;
      return { status: 1, stdout: '{"error":{"code":"E404"}}', stderr: "" };
    },
    sleep: async (delayMs) => { retryBudgetMs += delayMs; },
  }), /not visible after/);
  assert.ok(timeoutMinutes * 60_000 >= retryBudgetMs + 60_000,
    `workflow timeout must cover the ${retryBudgetMs}ms retry budget plus runner overhead`);
});

test("account-rotator feature releases are isolated prereleases built from the tested SHA", () => {
  const workflow = workflowText(".github/workflows/release.yml");
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

// CI toolchain pins (ticket 09, ADR-0006/0016, seam 9). Every tracked workflow
// file is scanned, so a vendored copy with stale pins that reappears anywhere
// in the tree (the nested proxy workflows pinned Bun 1.4.0) fails here too.
// The pin: Bun 1.4.2 everywhere (Round 11 Q1 condition 1; Bun >= 1.4.3 raises
// the S1/burst1 proxy peak on the CI runners, ticket 62 owns re-entry).
const BUN_PIN = "1.4.2";
const ACTION_MAJORS = { "actions/checkout": "v7", "actions/setup-node": "v7", "oven-sh/setup-bun": "v2" };
const NODE_FLOOR = 24;

function trackedWorkflows() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: KIT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter((path) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path));
}

/** Pin violations in one workflow text: wrong action majors, Bun not BUN_PIN, Node below the floor. */
function pinViolations(text) {
  const problems = [];
  const unquote = (value) => value.trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  for (const [, action, ref] of text.matchAll(/uses:\s*["']?([\w.-]+\/[\w.-]+)@([^\s"'#]+)/g)) {
    if (ACTION_MAJORS[action] && ref !== ACTION_MAJORS[action]) problems.push(`${action}@${ref} (want @${ACTION_MAJORS[action]})`);
  }
  if (/uses:\s*["']?oven-sh\/setup-bun@/.test(text) && !/bun-version:/.test(text)) problems.push("setup-bun without an explicit bun-version");
  for (const [, raw] of text.matchAll(/bun-version:([^\n]*)/g)) {
    if (unquote(raw) !== BUN_PIN) problems.push(`bun-version: ${unquote(raw)} (want ${BUN_PIN})`);
  }
  const majorOk = (value) => /^\d+/.test(value) && Number(value.match(/^\d+/)[0]) >= NODE_FLOOR;
  for (const [, raw] of text.matchAll(/node-version:([^\n]*)/g)) {
    const value = unquote(raw);
    if (/^\$\{\{\s*matrix\.node\s*\}\}$/.test(value)) continue;
    if (!majorOk(value)) problems.push(`node-version: ${value} (floor ${NODE_FLOOR})`);
  }
  for (const [, list] of text.matchAll(/^\s*node:\s*\[([^\]]*)\]/gm)) {
    for (const item of list.split(",").map(unquote)) if (!majorOk(item)) problems.push(`matrix node ${item} (floor ${NODE_FLOOR})`);
  }
  return problems;
}

// The one exception (Round 10 Q1 condition 1): the paired Bun measurement
// installs other Bun versions as measurement arms. Such a step must be a
// setup-bun step that runs only with the one-run marker (which never merges),
// is uncached and sits in the memory-budget job; release.yml never has one.
const MARKER_IF = "if: hashFiles('tests/memory/measure-burst1') != ''";

/** text → { rest: text without the exempt arm steps, arms: [{ job, version, problems }] }. */
function splitMeasurementArms(text) {
  const arms = [];
  let job = null;
  const kept = [];
  for (const block of text.split(/\n(?=      - |  [\w-]+:\n)/)) {
    const jobHead = block.match(/^  ([\w-]+):\n/);
    if (jobHead) job = jobHead[1];
    const version = block.match(/bun-version:\s*["']?([^\s"']+)/)?.[1] ?? null;
    const isArm = /uses:\s*oven-sh\/setup-bun@/.test(block) && block.includes(MARKER_IF) && version !== BUN_PIN;
    if (!isArm) { kept.push(block); continue; }
    const problems = [];
    if (job !== "memory-budget") problems.push(`measurement arm outside the memory-budget job (${job})`);
    if (!/no-cache:\s*true/.test(block)) problems.push("measurement arm without no-cache: true");
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) problems.push(`measurement arm with a non-exact bun-version ${version}`);
    arms.push({ job, version, problems });
  }
  return { rest: kept.join("\n"), arms };
}

test("pin scanner: only a marker-guarded, uncached setup-bun step in memory-budget may install another Bun (scanner self-check)", () => {
  const wf = (job, step) => ["jobs:", `  ${job}:`, "    steps:", "      - uses: oven-sh/setup-bun@v2", "        with:", `          bun-version: ${BUN_PIN}`, step].join("\n");
  const arm = (extra = "") => ["      - name: Bun 1.4.4 for the paired measurement", `        ${MARKER_IF}`, "        uses: oven-sh/setup-bun@v2", "        with:", "          bun-version: 1.4.4", extra].filter(Boolean).join("\n");
  const ok = splitMeasurementArms(wf("memory-budget", arm("          no-cache: true")));
  assert.deepEqual(ok.arms.map((a) => [a.version, a.problems]), [["1.4.4", []]]);
  assert.deepEqual(pinViolations(ok.rest), []);
  assert.match(splitMeasurementArms(wf("memory-budget", arm())).arms[0].problems.join(), /no-cache/);
  assert.match(splitMeasurementArms(wf("test-kit", arm("          no-cache: true"))).arms[0].problems.join(), /outside the memory-budget job \(test-kit\)/);
  // Without the marker guard it is an ordinary pin and is flagged.
  const unguarded = splitMeasurementArms(wf("memory-budget", arm("          no-cache: true").replace(`        ${MARKER_IF}\n`, "")));
  assert.deepEqual(unguarded.arms, []);
  assert.deepEqual(pinViolations(unguarded.rest), ["bun-version: 1.4.4 (want 1.4.2)"]);
});

test("workflow text reads the same with LF and CRLF line endings: same pins, same measurement arms (Windows checkouts)", () => {
  for (const file of trackedWorkflows()) {
    const text = workflowText(file);
    const crlf = text.replace(/\n/g, "\r\n");
    assert.ok(crlf.includes("\r\n") && !lf(crlf).includes("\r"), file);
    const a = splitMeasurementArms(text), b = splitMeasurementArms(lf(crlf));
    assert.deepEqual(b.arms, a.arms, file);
    assert.deepEqual(pinViolations(b.rest), pinViolations(a.rest), file);
    assert.deepEqual(pinViolations(b.rest), [], file);
  }
});

test("pin scanner catches stale pins in every spelling (scanner self-check)", () => {
  assert.deepEqual(pinViolations([
    "      - uses: actions/checkout@v7",
    "      - uses: actions/setup-node@v7",
    "        with:",
    "          node-version: ${{ matrix.node }}",
    "      - uses: oven-sh/setup-bun@v2",
    "        with:",
    "          bun-version: 1.4.2",
    "        node: [24, 26]",
    "          node-version: 26",
  ].join("\n")), []);
  for (const [bad, why] of [
    ["- uses: actions/checkout@v4", /checkout@v4/],
    ["- uses: 'actions/setup-node@v6'", /setup-node@v6/],
    ["- uses: actions/checkout@0123abc # v7", /checkout@0123abc/],
    ["bun-version: 1.4.4", /1\.4\.4/],
    ["bun-version: '1.4.3'", /1\.4\.3/],
    ['bun-version: "1.4.0"', /1\.4\.0/],
    ["bun-version: latest", /latest/],
    ["- uses: oven-sh/setup-bun@v2", /without an explicit bun-version/],
    ["node-version: 20", /node-version: 20/],
    ["node-version: '22.x'", /22\.x/],
    ["node-version: lts/*", /lts/],
    ["    node: [20, 24]", /matrix node 20/],
  ]) {
    const problems = pinViolations(bad);
    assert.ok(problems.some((p) => why.test(p)), `${JSON.stringify(bad)} must be flagged, got ${JSON.stringify(problems)}`);
  }
});

test("CI and release workflows pin checkout@v7, setup-node@v7, setup-bun@v2, Bun 1.4.2 and Node >= 24", () => {
  const files = trackedWorkflows();
  assert.deepEqual(files.sort(), [".github/workflows/ci.yml", ".github/workflows/release.yml"],
    "only the root workflows exist; the nested vendored proxy workflows are deleted (they never ran and pinned Bun 1.4.0)");
  for (const file of files) {
    const { rest: text, arms } = splitMeasurementArms(workflowText(file));
    assert.deepEqual(arms.flatMap((a) => a.problems), [], `${file}: measurement arm steps`);
    if (file.endsWith("release.yml")) assert.deepEqual(arms, [], "release.yml never installs a measurement arm");
    else assert.deepEqual(arms.map((a) => a.version), ["1.4.3", "1.4.4"], "the paired measurement's candidate arms (Round 10 Q1 condition 1, Round 11 Q1 condition 4)");
    assert.deepEqual(pinViolations(text), [], `${file} has stale toolchain pins`);
    // Round 11 Q1 condition 1 replaces round 1's "no bun-version: 1.4.2": 1.4.2 is
    // the pin now, asserted exactly per job; 1.4.0 (the deleted nested pin) stays rejected.
    assert.doesNotMatch(text, /bun-version:\s*["']?1\.4\.0\b/, `${file} pins Bun 1.4.0`);
    const jobs = text.split("\njobs:\n")[1].split(/\n(?=  [\w-]+:\n)/).map((j) => [j.match(/^\s*([\w-]+):/)?.[1], [...j.matchAll(/bun-version:\s*["']?([^\s"']+)/g)].map((m) => m[1])]).filter(([, v]) => v.length);
    assert.deepEqual(jobs, file.endsWith("release.yml") ? [["test", [BUN_PIN]]] : [["test-kit", [BUN_PIN]], ["ux-before", [BUN_PIN]], ["memory-budget", [BUN_PIN]]], `${file}: every Bun-using job on ${BUN_PIN}`);
    assert.doesNotMatch(text, /node-version:\s*["']?20\b/, `${file} still pins Node 20`);
  }
  for (const nested of ["zcode-proxy-src/.github/workflows/ci.yml", "zcode-proxy-src/.github/workflows/release.yml", "zcode-proxy-src/.github/release.yml"]) {
    assert.equal(existsSync(join(KIT, nested)), false, `${nested} must stay deleted`);
  }
  const manifest = readFileSync(join(KIT, "MANIFEST.md"), "utf8");
  assert.match(manifest, /zcode-proxy-src\/\.github\/workflows\//, "MANIFEST.md records the nested-workflow vendor change");
});

test("release workflow: tests on Node 26, publish keeps Node 24 for OIDC, triggers unchanged", () => {
  const workflow = workflowText(".github/workflows/release.yml");
  const job = (name, next) => workflow.split(`  ${name}:\n`)[1]?.split(next ? `  ${next}:\n` : /\n(?! )/)[0] ?? "";
  const nodeVersions = (text) => [...text.matchAll(/node-version:\s*["']?([^\s"']+)/g)].map((m) => m[1]);
  assert.deepEqual(nodeVersions(job("test", "release-and-publish")), ["26"], "release test job runs on Node 26");
  assert.deepEqual(nodeVersions(job("release-and-publish", "feature-account-rotator-prerelease")), ["24"],
    "the publish job stays on Node 24 (npm OIDC Trusted Publishing path)");
  assert.deepEqual(nodeVersions(job("feature-account-rotator-prerelease")), ["26"]);
  // Exactly these events start release.yml: a push to main or
  // feature/account-rotator, a v* tag push, or a manual dispatch. Any other
  // branch push (an overhaul staging branch) must never start it (B6).
  const on = workflow.split("\non:\n")[1]?.split("\n\n")[0];
  assert.equal(on, [
    "  push:",
    '    branches: ["main", "feature/account-rotator"]',
    '    tags: ["v*"]',
    "  workflow_dispatch:",
  ].join("\n"));
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
