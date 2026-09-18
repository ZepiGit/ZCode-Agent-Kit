import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const load = () => import("../scripts/registry-version.mjs");
const missing = { status: 1, stdout: JSON.stringify({ error: { code: "E404" } }), stderr: "" };
const present = { status: 0, stdout: '"1.2.3"\n', stderr: "" };

test("registry lookup validates the exact returned version with bounded npm requests", async () => {
  const { lookupVersion } = await load();
  const result = lookupVersion("1.2.3", { run(command, args, options) {
    assert.equal(command, "npm");
    assert.deepEqual(args, ["view", "zcode-agent-kit@1.2.3", "version", "--json", "--registry=https://registry.npmjs.org/",
      "--fetch-retries=0", "--fetch-timeout=15000"]);
    assert.equal(options.timeout, 20_000);
    return present;
  } });
  assert.equal(result, "present");
});

test("registry lookup accepts npm 12's singleton array but rejects mixed versions", async () => {
  const { lookupVersion } = await load();
  assert.equal(lookupVersion("1.2.3", { run: () => ({ ...present, stdout: '["1.2.3"]' }) }), "present");
  for (const stdout of ['[]', '["1.2.3","1.2.4"]', '["1.2.4"]']) {
    assert.throws(() => lookupVersion("1.2.3", { run: () => ({ ...present, stdout }) }));
  }
});

test("only structured E404 means an unpublished version", async () => {
  const { lookupVersion } = await load();
  assert.equal(lookupVersion("1.2.3", { run: () => missing }), "missing");
  assert.equal(lookupVersion("1.2.3", { run: () => ({ ...missing, stdout: "", stderr: missing.stdout }) }), "missing");
  for (const code of ["E401", "E403", "E429", "E500", "ENOTFOUND", "ETIMEDOUT"]) {
    assert.throws(() => lookupVersion("1.2.3", { run: () => ({ status: 1,
      stdout: JSON.stringify({ error: { code, summary: "private diagnostic E404" } }), stderr: "private diagnostic" }) }),
    (error) => error.message.includes(code) && !error.message.includes("private diagnostic"));
  }
});

test("registry lookup fails closed on transport failures, malformed JSON, and version mismatch", async () => {
  const { lookupVersion } = await load();
  for (const response of [
    { status: null, error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" },
    { status: null, signal: "SIGTERM", stdout: missing.stdout, stderr: "" },
    { status: 1, stdout: "", stderr: "network diagnostic containing E404" },
    { status: 0, stdout: "", stderr: "" },
    { status: 0, stdout: '"1.2.4"', stderr: "" },
    { status: 0, stdout: missing.stdout, stderr: "" },
  ]) assert.throws(() => lookupVersion("1.2.3", { run: () => response }));
  assert.throws(() => lookupVersion("1.2.3; bad", { run: () => assert.fail("invalid input must not invoke npm") }));
});

test("post-publish verification retries propagation misses and returns the exact version", async () => {
  const { verifyPublished } = await load();
  let calls = 0;
  const delays = [];
  const version = await verifyPublished("1.2.3", {
    run: () => ++calls < 3 ? missing : present,
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(version, "1.2.3");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("post-publish verification stops after six misses and does not retry auth failures", async () => {
  const { verifyPublished } = await load();
  let calls = 0;
  let waits = 0;
  await assert.rejects(verifyPublished("1.2.3", {
    run: () => { calls++; return missing; }, sleep: async (ms) => { waits++; assert.equal(ms, 10_000); },
  }), /not visible.*36 attempts/);
  assert.equal(calls, 36);
  assert.equal(waits, 35);
  calls = 0;
  await assert.rejects(verifyPublished("1.2.3", {
    run: () => { calls++; return { status: 1, stdout: '{"error":{"code":"E401"}}', stderr: "" }; },
    sleep: async () => assert.fail("auth failure must not be retried"),
  }), /E401/);
  assert.equal(calls, 1);
});

test("main release selection keeps only an unpublished version with no tag or an exact HEAD retry", async () => {
  const { resolveReleaseVersion } = await load();
  for (const tag of [null, "current-head"]) {
    assert.equal(resolveReleaseVersion("1.2.3", {
      head: "current-head", lookup: () => "missing", getTagCommit: () => tag,
    }), "1.2.3");
  }
});

test("main release selection skips npm versions and old tags without rewriting either", async () => {
  const { resolveReleaseVersion } = await load();
  const checked = [];
  const next = resolveReleaseVersion("1.2.3", {
    head: "current-head",
    lookup: (version) => { checked.push(version); return version === "1.2.4" ? "present" : "missing"; },
    getTagCommit: (version) => ({ "1.2.3": "old-assets-head", "1.2.5": "another-head" })[version] ?? null,
  });
  assert.equal(next, "1.2.6");
  assert.deepEqual(checked, ["1.2.3", "1.2.4", "1.2.5", "1.2.6"]);
  assert.equal(resolveReleaseVersion("1.2.3", {
    head: "current-head", lookup: (v) => v === "1.2.3" ? "present" : "missing", getTagCommit: () => null,
  }), "1.2.4");
});

test("release selection is bounded and fails closed on registry or git lookup failure", async () => {
  const { resolveReleaseVersion } = await load();
  let calls = 0;
  assert.throws(() => resolveReleaseVersion("1.2.3", {
    head: "current-head", lookup: () => { calls++; return "present"; }, getTagCommit: () => null,
  }), /100 candidates/);
  assert.equal(calls, 100);
  for (const failing of ["lookup", "getTagCommit"]) {
    assert.throws(() => resolveReleaseVersion("1.2.3", {
      head: "current-head", lookup: () => "missing", getTagCommit: () => null,
      [failing]: () => { throw new Error("lookup unavailable"); },
    }), /lookup unavailable/);
  }
});

test("remote tag lookup resolves annotated tags and distinguishes absence from git failure", async () => {
  const { remoteTagCommit } = await load();
  const commit = "a".repeat(40);
  const tagObject = "b".repeat(40);
  assert.equal(remoteTagCommit("1.2.3", { run(command, args, options) {
    assert.equal(command, "git");
    assert.deepEqual(args, ["ls-remote", "--tags", "origin", "refs/tags/v1.2.3", "refs/tags/v1.2.3^{}"]);
    assert.equal(options.timeout, 20_000);
    return { status: 0, stdout: `${tagObject}\trefs/tags/v1.2.3\n${commit}\trefs/tags/v1.2.3^{}\n` };
  } }), commit);
  assert.equal(remoteTagCommit("1.2.3", { run: () => ({ status: 0, stdout: `${commit}\trefs/tags/v1.2.3\n` }) }), commit);
  assert.equal(remoteTagCommit("1.2.3", { run: () => ({ status: 0, stdout: "" }) }), null);
  for (const result of [{ status: 1, stderr: "auth failed" }, { status: null, error: { code: "ETIMEDOUT" } },
    { status: 0, stdout: "malformed output" }]) {
    assert.throws(() => remoteTagCommit("1.2.3", { run: () => result }));
  }
});

test("registry CLI rejects invalid modes and versions without contacting npm", async () => {
  await load();
  for (const args of [["bad", "1.2.3"], ["check"], ["check", "latest"]]) {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/registry-version.mjs"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /registry-version:/);
  }
});
