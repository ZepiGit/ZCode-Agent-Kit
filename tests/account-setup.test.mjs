import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { askAccountRotator, configureAccountRotator, rotatorChoice, ACCOUNT_ROTATOR_QUESTION } from "../cli/account-setup.mjs";

test("installer requires an explicit y/n answer and repeats invalid/empty answers", async () => {
  for (const answer of ["y", "n"]) {
    const input = new PassThrough(), output = new PassThrough();
    input.isTTY = output.isTTY = true;
    let transcript = "";
    output.on("data", chunk => transcript += chunk);
    const pending = askAccountRotator({ input, output, env: {} });
    input.write(`\nmaybe\n${answer}\n`);
    assert.equal(await pending, answer === "y");
    assert.ok(transcript.includes(ACCOUNT_ROTATOR_QUESTION));
    assert.ok(transcript.includes("Please answer y or n"));
    input.destroy(); output.destroy();
  }
});

test("terminal redraw keeps the y/n question visible before and during input", async () => {
  for (const columns of [100, 36]) for (const answer of ["y", "n"]) {
    const input = new PassThrough(), output = new PassThrough();
    input.isTTY = output.isTTY = true;
    output.columns = columns;
    let transcript = "";
    output.on("data", chunk => transcript += chunk);
    const pending = askAccountRotator({ input, output, env: {} });
    try {
      const question = `${ACCOUNT_ROTATOR_QUESTION} [y/n] `;
      assert.ok(transcript.includes(question));
      transcript = "";
      output.emit("resize");
      assert.ok(transcript.includes(question), "redraw must not replace the question with the default > prompt");
      input.write(answer);
      transcript = "";
      output.emit("resize");
      assert.ok(transcript.includes(question + answer), "redraw must preserve the question and typed answer");
      input.write("\n");
      assert.equal(await pending, answer === "y");
    } finally {
      input.end();
      await pending;
      output.destroy();
    }
  }
});

test("headless install and closed terminal never silently opt in", async () => {
  const input = new PassThrough(), output = new PassThrough();
  assert.equal(await askAccountRotator({ input, output }), undefined);
  input.isTTY = output.isTTY = true;
  const answer = askAccountRotator({ input, output, env: {} });
  input.end();
  assert.equal(await answer, undefined);
  output.destroy();
  assert.equal(rotatorChoice(" Y "), true);
  assert.equal(rotatorChoice("n"), false);
  assert.equal(rotatorChoice(undefined), undefined);
  assert.throws(() => rotatorChoice("yes"), /must be y or n/);
});

test("activation imports before changing config and preserves policies/comments; failed import is non-destructive", t => {
  const root = mkdtempSync(join(tmpdir(), "kit-account-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "config.yaml");
  const proxySrc = join(import.meta.dirname, "..", "zcode-proxy-src");
  const ctx = { config, proxySrc };
  const initial = "# keep this comment\nprovider: zai\nauth:\n  proxyApiKey: synthetic-local-key\n  accounts:\n    enabled: false\n    path: /custom/accounts.json\n    allowedIds: [work]\n    pausedIds: [paused]\n    allowPaid: false\n";
  writeFileSync(config, initial);
  const writes = [];
  const tx = { touch: path => writes.push(path) };
  assert.throws(() => configureAccountRotator(ctx, tx, true, () => ({ status: 1 })), /import failed/);
  assert.equal(readFileSync(config, "utf8"), initial);
  const result = configureAccountRotator(ctx, tx, true, args => {
    assert.deepEqual(args, ["auth", "accounts", "import-current"]);
    assert.equal(readFileSync(config, "utf8"), initial);
    return { status: 0, stdout: '{"accountCount":2}' };
  });
  assert.deepEqual(result, { changed: true, accountCount: 2 });
  const yaml = createRequire(join(proxySrc, "package.json"))("yaml");
  const updated = readFileSync(config, "utf8");
  assert.ok(updated.includes("# keep this comment"));
  assert.deepEqual(yaml.parse(updated).auth.accounts, { ...yaml.parse(initial).auth.accounts, enabled: true });
  assert.deepEqual(writes, [config]);
  configureAccountRotator(ctx, tx, false, () => { throw new Error("disabled must not import"); });
  assert.equal(yaml.parse(readFileSync(config, "utf8")).auth.accounts.enabled, false);
});
