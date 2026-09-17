import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import omp from "../cli/adapters/omp.mjs";

const KIT = join(import.meta.dirname, "..");
const requireFromProxy = createRequire(join(KIT, "zcode-proxy-src", "package.json"));
const YAML = requireFromProxy("yaml");
const SYNTHETIC_KEY = "synthetic-omp-audit-key_20260917";

function fixture(models, config = null) {
  const home = mkdtempSync(join(tmpdir(), "zcode-omp-audit-"));
  const agentDir = join(home, ".omp", "agent");
  const stateDir = join(home, ".zcode-kit-test-state");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const modelsYml = join(agentDir, "models.yml");
  const configYml = join(agentDir, "config.yml");
  const keyFile = join(stateDir, ".proxykey");
  writeFileSync(modelsYml, models);
  if (config !== null) writeFileSync(configYml, config);
  writeFileSync(keyFile, `${SYNTHETIC_KEY}\n`);

  const ctx = {
    root: KIT,
    home,
    proxySrc: join(KIT, "zcode-proxy-src"),
    keyFile,
    port: () => 8457,
    key: () => SYNTHETIC_KEY,
  };
  const tx = { touch() {} };
  const apply = () => omp.apply(ctx, tx, () => {});
  return {
    home,
    agentDir,
    modelsYml,
    configYml,
    ctx,
    apply,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function parse(text) {
  return YAML.parse(text, { strict: true, uniqueKeys: true });
}

test("OMP preserves four-space provider indentation, comments, and unknown top-level keys", () => {
  const models = [
    "# user header",
    "schemaVersion: 7",
    "providers:",
    "    # keep provider comment",
    "    openai:",
    "        name: OpenAI",
    "        apiKey: foreign-key",
    "featureFlags:",
    "    keepUnknown: true",
    "",
  ].join("\n");
  const f = fixture(models);
  try {
    f.apply();
    const written = readFileSync(f.modelsYml, "utf8");
    const value = parse(written);
    assert.equal(value.schemaVersion, 7);
    assert.equal(value.featureFlags.keepUnknown, true);
    assert.equal(value.providers.openai.apiKey, "foreign-key");
    assert.equal(value.providers.zcode.apiKey, SYNTHETIC_KEY);
    assert.match(written, /^    zcode:$/m);
    assert.match(written, /    # keep provider comment/);
    assert.match(written, /^    openai:$/m);
  } finally {
    f.cleanup();
  }
});

test("OMP refuses foreign zcode providers at any indentation", () => {
  for (const indent of ["  ", "    "]) {
    const f = fixture(`providers:\n${indent}zcode:\n${indent}  apiKey: foreign\n`);
    try {
      const before = readFileSync(f.modelsYml, "utf8");
      assert.throws(f.apply, /hand-written `zcode` provider/);
      assert.equal(readFileSync(f.modelsYml, "utf8"), before);
    } finally {
      f.cleanup();
    }
  }
});

test("OMP refuses duplicate or malformed managed markers and invalid providers shapes", () => {
  const cases = [
    {
      text: "providers:\n  openai: {}\n# >>> zcode-kit (managed block) — do not edit inside\n  zcode: {}\n",
      error: /unbalanced.*managed block|begin marker without end marker/i,
    },
    {
      text: "providers:\n# >>> zcode-kit (managed block) — do not edit inside\n  zcode: {}\n# <<< zcode-kit\n# >>> zcode-kit (managed block) — do not edit inside\n  zcode: {}\n# <<< zcode-kit\n",
      error: /duplicate.*managed block|more than one.*managed block/i,
    },
    {
      text: "providers:\n  openai: {}\n  # >>> zcode-kit (managed block) — do not edit inside\n",
      error: /unbalanced.*managed block|begin marker without end marker/i,
    },
    {
      text: "providers:\n  openai: {}\n  # <<< zcode-kit\n",
      error: /unbalanced.*managed block|end marker without.*begin marker/i,
    },
    {
      text: "providers:\n  openai: {}\nproviders:\n  anthropic: {}\n",
      error: /unique|providers/i,
    },
    { text: "providers: []\n", error: /providers.*mapping/i },
    { text: "providers: { openai: {} }\n", error: /providers.*block mapping/i },
  ];

  for (const { text, error } of cases) {
    const f = fixture(text);
    try {
      const before = readFileSync(f.modelsYml, "utf8");
      assert.throws(f.apply, error);
      assert.equal(readFileSync(f.modelsYml, "utf8"), before);
    } finally {
      f.cleanup();
    }
  }
});

test("OMP verify reads providers.zcode.apiKey rather than an earlier foreign apiKey", () => {
  const f = fixture(
    `providers:\n  foreign:\n    apiKey: "${SYNTHETIC_KEY}"\n  zcode:\n    apiKey: "wrong-zcode-key"\n`,
  );
  try {
    const keyCheck = omp.verify(f.ctx).find((check) => check.name === "omp key resolver");
    assert.equal(keyCheck?.ok, false);
  } finally {
    f.cleanup();
  }
});

test("OMP edits flow disabledProviders and extensions without losing foreign entries", () => {
  const extension = "C:/Users/test/existing-extension.ts";
  const f = fixture(
    "providers:\n  openai:\n    name: OpenAI\n",
    `theme: dark\ndisabledProviders: [openai, zcode, local]\nextensions: [${extension}]\nunknownTop: keep\n`,
  );
  try {
    f.apply();
    const written = readFileSync(f.configYml, "utf8");
    const value = parse(written);
    assert.deepEqual(value.disabledProviders, ["openai", "local"]);
    assert.equal(value.extensions[0], extension);
    assert.equal(value.extensions.filter((entry) => entry.endsWith("zcode-proxy-autostart.ts")).length, 1);
    assert.equal(value.unknownTop, "keep");
  } finally {
    f.cleanup();
  }
});

test("OMP second apply is byte-identical", () => {
  const f = fixture(
    "providers:\n    openai:\n        name: OpenAI\n",
    "disabledProviders: [zcode, openai]\nextensions: []\n",
  );
  try {
    f.apply();
    const modelsOnce = readFileSync(f.modelsYml, "utf8");
    const configOnce = readFileSync(f.configYml, "utf8");
    const extensionOnce = readFileSync(join(f.agentDir, "extensions", "zcode-proxy-autostart.ts"), "utf8");
    const result = f.apply();
    assert.equal(result.changed, false);
    assert.equal(readFileSync(f.modelsYml, "utf8"), modelsOnce);
    assert.equal(readFileSync(f.configYml, "utf8"), configOnce);
    assert.equal(readFileSync(join(f.agentDir, "extensions", "zcode-proxy-autostart.ts"), "utf8"), extensionOnce);
  } finally {
    f.cleanup();
  }
});
