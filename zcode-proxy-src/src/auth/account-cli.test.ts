import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAccount,
  clearAccountStore,
  loadAccountStore,
} from "./account-store.js";

const proxyRoot = join(import.meta.dir, "..", "..");
const secret = "synthetic-account-cli-store-secret";
let fixtureRoot = "";
let storePath = "";

/** Run the actual Bun entry point in a child process, as an installed user would. */
function runProxy(args: string[]) {
  return spawnSync(
    process.execPath,
    ["run", "src/index.ts", "--cli", ...args],
    {
      cwd: proxyRoot,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        // Explicit path prevents the subprocess from reading a real login.
        ZCODE_PROXY_ACCOUNTS_PATH: storePath,
        ZCODE_PROXY_CREDENTIAL_SECRET: secret,
        // Account listing is offline and must not need a config or proxy.
        ZCODE_PROXY_CONFIG: join(fixtureRoot, "missing-config.yaml"),
      },
    },
  );
}

function stdout(result: ReturnType<typeof runProxy>): string {
  return String(result.stdout ?? "");
}

function stderr(result: ReturnType<typeof runProxy>): string {
  return String(result.stderr ?? "");
}

describe("zcode-proxy auth accounts CLI", () => {
  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "zcode-account-cli-"));
    storePath = join(fixtureRoot, "accounts.json");
    process.env.ZCODE_PROXY_ACCOUNTS_PATH = storePath;
    process.env.ZCODE_PROXY_CREDENTIAL_SECRET = secret;
    clearAccountStore({ path: storePath });
  });

  afterEach(() => {
    clearAccountStore({ path: storePath });
    rmSync(fixtureRoot, { recursive: true, force: true });
    delete process.env.ZCODE_PROXY_ACCOUNTS_PATH;
    delete process.env.ZCODE_PROXY_CREDENTIAL_SECRET;
  });

  it("lists an empty pool as JSON without contacting a proxy", () => {
    const result = runProxy(["auth", "accounts", "--json"]);
    expect(result.status).toBe(0);
    expect(stderr(result)).not.toMatch(/api[-_]?key|jwt|secret/i);
    const body = JSON.parse(stdout(result));
    expect(body.accounts).toEqual([]);
    expect(body.schemaVersion).toBe(1);
    expect(body.source).toBe("offline-config");
  });

  it("lists accounts in text and JSON with credentials redacted", async () => {
    const apiKey = "super-secret-api-key-001";
    const jwt = "super-secret-jwt-001";
    await addAccount({
      id: "work",
      label: "Work account",
      plan: "coding-plan",
      createdAt: 1_700_000_000_000,
      credential: { provider: "zai", apiKey, secret: "api-secret", jwt },
    }, { path: storePath });

    const text = runProxy(["auth", "accounts"]);
    expect(text.status).toBe(0);
    expect(stdout(text)).toContain("Configured accounts:");
    expect(stdout(text)).toContain("work");
    expect(stdout(text)).toContain("provider=zai");
    expect(stdout(text)).toContain("state=ready");
    expect(stdout(text)).toContain("credential=redacted");
    expect(stdout(text)).not.toContain(apiKey);
    expect(stdout(text)).not.toContain(jwt);
    expect(stderr(text)).not.toContain(apiKey);
    expect(stderr(text)).not.toContain(jwt);

    const json = runProxy(["auth", "accounts", "--json"]);
    expect(json.status).toBe(0);
    const body = JSON.parse(stdout(json));
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({
      id: "work",
      provider: "zai",
      plan: "coding-plan",
      state: "ready",
      credentialPreview: "redacted",
    });
    expect(JSON.stringify(body)).not.toContain(apiKey);
    expect(JSON.stringify(body)).not.toContain(jwt);
  });

  it("requires --yes and then removes only the requested account", async () => {
    await addAccount({ id: "keep", credential: { provider: "zai", apiKey: "keep-secret" } }, { path: storePath });
    await addAccount({ id: "remove", credential: { provider: "zai", apiKey: "remove-secret" } }, { path: storePath });

    const refused = runProxy(["auth", "accounts", "remove", "remove"]);
    expect(refused.status).toBe(2);
    expect(stdout(refused) + stderr(refused)).toMatch(/--yes/);
    expect((await loadAccountStore({ path: storePath })).map((a) => a.id)).toEqual(["keep", "remove"]);

    const removed = runProxy(["auth", "accounts", "remove", "remove", "--yes"]);
    expect(removed.status).toBe(0);
    expect(stdout(removed)).toContain("Removed account: remove");
    expect(stdout(removed)).not.toContain("remove-secret");
    expect((await loadAccountStore({ path: storePath })).map((a) => a.id)).toEqual(["keep"]);
  });

  it("fails closed on a corrupt store without echoing its contents", () => {
    writeFileSync(storePath, "{\"encrypted\":\"PRIVATE_CORRUPT_PAYLOAD\"}", "utf8");
    const result = runProxy(["auth", "accounts", "--json"]);
    expect(result.status).toBe(1);
    const body = JSON.parse(stdout(result));
    expect(body.accounts).toEqual([]);
    expect(body.error).toMatchObject({ code: "account_store_unavailable" });
    expect(body.error.message).toMatch(/account listing failed/i);
    expect(stdout(result) + stderr(result)).not.toContain("PRIVATE_CORRUPT_PAYLOAD");
  });
});
