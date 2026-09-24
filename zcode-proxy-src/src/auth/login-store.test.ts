import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadAccountStore, loadAccountStoreSnapshot, rememberAccount, updateAccountStore } from "./account-store.js";
import { loadCredential, saveCredential } from "./store.js";
import { saveLoginCredential } from "./login-store.js";
import { createStoredAuthManagerWithAccounts } from "./runtime.js";
import { loadConfig } from "../config/loader.js";

const proxyRoot = join(import.meta.dir, "../..");
let root: string, pool: string, configPath: string;
let previous: Record<string, string | undefined>;
const names = ["ZCODE_PROXY_CREDENTIALS_PATH", "ZCODE_PROXY_ACCOUNTS_PATH", "ZCODE_PROXY_CREDENTIAL_SECRET", "ZCODE_ACCOUNTS_ENABLED"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zcode-login-pool-"));
  pool = join(root, "accounts.json");
  configPath = join(root, "proxy.yaml");
  previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  delete process.env.ZCODE_ACCOUNTS_ENABLED;
  process.env.ZCODE_PROXY_CREDENTIALS_PATH = join(root, "credentials.json");
  process.env.ZCODE_PROXY_ACCOUNTS_PATH = pool;
  process.env.ZCODE_PROXY_CREDENTIAL_SECRET = "synthetic-login-pool-secret";
  writeFileSync(configPath, "provider: zai\nplan: coding-plan\nauth:\n  accounts:\n    enabled: true\n");
  mkdirSync(join(root, ".zcode", "v2"), { recursive: true });
});
afterEach(() => {
  for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  rmSync(root, { recursive: true, force: true });
});

function login(number: number, enabled = true) {
  writeFileSync(configPath, `provider: zai\nplan: coding-plan\nauth:\n  accounts:\n    enabled: ${enabled}\n`);
  writeFileSync(join(root, ".zcode", "v2", "config.json"), JSON.stringify({ provider: {
    "builtin:zai-coding-plan": { options: { apiKey: `synthetic-key-${number}` } },
    "builtin:zai-start-plan": { options: { apiKey: `synthetic-jwt-${number}` } },
  } }));
  return cli(["auth", "login", "zai", "--import"]);
}
function cli(args: string[]) {
  return spawnSync(process.execPath, ["run", "src/index.ts", "--cli", ...args], {
    cwd: proxyRoot, encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: root, USERPROFILE: root, ZCODE_PROXY_CONFIG: configPath },
  });
}

test("15 consecutive CLI logins retain every distinct account and a repeat login adds no duplicate", async () => {
  await saveCredential({ provider: "zai", apiKey: "legacy-untouched" });
  for (let i = 1; i <= 15; i++) {
    const result = login(i);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`account zai-${i}`);
    expect(result.stdout + result.stderr).not.toContain(`synthetic-key-${i}`);
  }
  expect(login(3).status).toBe(0);
  const accounts = await loadAccountStore();
  expect(accounts).toHaveLength(15);
  expect(new Set(accounts.map(a => a.credential.apiKey)).size).toBe(15);
  expect((await loadCredential())?.apiKey).toBe("legacy-untouched");
  expect(readFileSync(pool, "utf8")).not.toContain("synthetic-key");
});

test("disabled rotator keeps the legacy path and explicitly explains replacement", async () => {
  expect(login(1, false).status).toBe(0);
  const second = login(2, false);
  expect(second.status).toBe(0);
  expect(second.stdout).toContain("replaces the single-account login");
  expect((await loadCredential())?.apiKey).toBe("synthetic-key-2");
  expect(existsSync(pool)).toBe(false);
});

test("same provider user refreshes credentials without losing label, pause or quota state", async () => {
  const config = loadConfig(configPath);
  const first = { provider: "zai" as const, apiKey: "old-key", userId: "same-user", jwt: "old-jwt" };
  const id = await saveLoginCredential(first, config);
  await updateAccountStore(accounts => accounts.map(a => ({ ...a, label: "Work", paused: true, exhaustedUntil: Date.now() + 90000, failureGeneration: 2 })));
  const before = (await loadAccountStore())[0];
  expect(await saveLoginCredential({ ...first, apiKey: "fresh-key", jwt: "fresh-jwt" }, config)).toBe(id);
  const accounts = await loadAccountStore();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ id, label: "Work", paused: true, exhaustedUntil: before.exhaustedUntil, failureGeneration: 2, credentialRevision: 2 });
  const revision = (await loadAccountStoreSnapshot()).revision;
  await saveLoginCredential({ ...first, apiKey: "fresh-key", jwt: "fresh-jwt" }, config);
  expect((await loadAccountStoreSnapshot()).revision).toBe(revision);
});

test("desktop combined key and OAuth key/secret match, but different provider users do not", async () => {
  const first = await rememberAccount({ provider: "zai", apiKey: "key.secret" });
  expect((await rememberAccount({ provider: "zai", apiKey: "key", secret: "secret", userId: "one" })).id).toBe(first.id);
  expect((await rememberAccount({ provider: "zai", apiKey: "key", secret: "secret", userId: "two" })).id).not.toBe(first.id);
  expect((await rememberAccount({ provider: "bigmodel", apiKey: "key.secret" })).id).not.toBe(first.id);
});

const subJwt = (sub: string, nonce: string) =>
  `h.${Buffer.from(JSON.stringify({ sub, iat: 1, nonce })).toString("base64url")}.s`;

test("a Desktop import candidate requires explicit replacement rather than duplicate insertion", async () => {
  const options = { plan: "start-plan" };
  const desktop = await rememberAccount({ provider: "zai", apiKey: "desktop-access", jwt: subJwt("user-s", "a") }, options);
  await expect(rememberAccount({ provider: "zai", apiKey: "oauth-key", secret: "oauth-secret", userId: "user-s", jwt: subJwt("user-s", "b") }, options)).rejects.toMatchObject({code: "conflict"});
  const accounts = await loadAccountStore();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ id: desktop.id, credentialRevision: 1, credential: { apiKey: "desktop-access" } });
});

test("rotated Desktop subject requires selection while another subject stays distinct", async () => {
  const options = { plan: "start-plan" };
  const first = await rememberAccount({ provider: "zai", apiKey: "access-1", jwt: subJwt("user-s", "a") }, options);
  await expect(rememberAccount({ provider: "zai", apiKey: "access-2", jwt: subJwt("user-s", "b") }, options)).rejects.toMatchObject({code: "conflict"});
  const other = await rememberAccount({ provider: "zai", apiKey: "access-3", jwt: subJwt("user-t", "c") }, options);
  expect(other.id).not.toBe(first.id);
  const accounts = await loadAccountStore();
  expect(accounts).toHaveLength(2);
  const refreshed = accounts.find(account => account.id === first.id)!;
  expect(refreshed.credentialRevision).toBe(1);
  expect(refreshed.credential.userId).toBeUndefined();
  expect(refreshed.credential.apiKey).toBe("access-1");
});

test("an unverified JWT subject never merges into a different OAuth user or another plan", async () => {
  const shared = subJwt("user-s", "a");
  const verified = await rememberAccount({ provider: "zai", apiKey: "k1", userId: "user-t", jwt: subJwt("user-t", "a") }, { plan: "start-plan" });
  await expect(rememberAccount({ provider: "zai", apiKey: "k2", jwt: subJwt("user-t", "b") }, { plan: "start-plan" })).rejects.toMatchObject({code: "conflict"});
  expect((await loadAccountStore()).find(account => account.id === verified.id)?.credential.apiKey).toBe("k1");
  const one = await rememberAccount({ provider: "zai", apiKey: "k3", userId: "user-a", jwt: shared }, { plan: "start-plan" });
  const two = await rememberAccount({ provider: "zai", apiKey: "k4", userId: "user-b", jwt: shared }, { plan: "start-plan" });
  expect(two.id).not.toBe(one.id);
  const desktop = await rememberAccount({ provider: "zai", apiKey: "k5", jwt: subJwt("user-u", "a") }, { plan: "start-plan" });
  expect((await rememberAccount({ provider: "zai", apiKey: "k6", jwt: subJwt("user-u", "b") }, { plan: "coding-plan" })).id).not.toBe(desktop.id);
  expect((await loadAccountStore()).find(account => account.id === verified.id)?.credential.userId).toBe("user-t");
});

test("activation imports both the saved legacy account and current Desktop login idempotently", async () => {
  await saveCredential({ provider: "zai", apiKey: "saved-primary" });
  expect(login(2).status).toBe(0);
  for (let i = 0; i < 2; i++) {
    const result = cli(["auth", "accounts", "import-current"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).accountCount).toBe(2);
  }
  expect((await loadCredential())?.apiKey).toBe("saved-primary");
});

test("running pool sees new login without switching the active account", async () => {
  const config = loadConfig(configPath);
  await saveLoginCredential({ provider: "zai", apiKey: "first" }, config);
  const auth = await createStoredAuthManagerWithAccounts("coding-plan", { enabled: true, path: pool });
  expect((await auth.getCredential()).apiKey).toBe("first");
  await saveLoginCredential({ provider: "zai", apiKey: "second" }, config);
  expect((await auth.getCredential()).apiKey).toBe("first");
  expect(auth.listAccounts()).toHaveLength(2);
  expect((await auth.recoverCredential({ provider: "zai", apiKey: "first" }, "coding-plan", "1005"))?.apiKey).toBe("second");
});

test("corrupt pool prevents login from overwriting either store", async () => {
  await saveCredential({ provider: "zai", apiKey: "saved-primary" });
  writeFileSync(pool, '{"encrypted":"broken"}');
  const result = login(2);
  expect(result.status).not.toBe(0);
  expect(readFileSync(pool, "utf8")).toBe('{"encrypted":"broken"}');
  expect((await loadCredential())?.apiKey).toBe("saved-primary");
  expect(result.stdout + result.stderr).not.toContain("synthetic-key-2");
});

test("kit setup, enable/disable and provider/import/account flags work through the real wrapper", async () => {
  const kitRoot = join(proxyRoot, "..");
  const state = join(root, "state");
  const runKit = (args: string[]) => spawnSync("node", [join(kitRoot, "cli/zcode-kit.mjs"), ...args], {
    cwd: kitRoot, encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: root, USERPROFILE: root, ZCODE_KIT_STATE_DIR: state,
      ZCODE_KIT_ALLOW_CHECKOUT: "1", ZCODE_KIT_SKIP_DEPS: "1", ZCODE_KIT_BUN: process.execPath },
  });
  const setup = runKit(["setup", "--harness", "pi", "--no-mcp", "--account-rotator", "n"]);
  expect(setup.status).toBe(0);
  const kitConfig = join(state, "proxy/config.yaml");
  writeFileSync(kitConfig, readFileSync(kitConfig, "utf8").replace("port: 8457", "port: 1"));
  await saveCredential({ provider: "zai", apiKey: "current-primary", jwt: "current-primary-jwt" });
  const enabled = runKit(["accounts", "enable"]);
  expect(enabled.status).toBe(0);
  expect(enabled.stdout).toContain("1 saved accounts");
  writeFileSync(join(root, ".zcode/v2/config.json"), JSON.stringify({ provider: {
    "builtin:bigmodel-coding-plan": { options: { apiKey: "bigmodel-synthetic" } },
    "builtin:bigmodel-start-plan": { options: { apiKey: "bigmodel-synthetic-jwt" } },
  } }));
  expect(runKit(["auth", "login", "bigmodel", "--import", "--account", "work"]).status).toBe(0);
  expect(runKit(["auth", "login", "bigmodel", "--import", "--account", "work"]).status).toBe(1);
  expect(runKit(["auth", "login", "bigmodel", "--import", "--account", "work", "--replace"]).status).toBe(0);
  expect((await loadAccountStore()).map(a => [a.id, a.credential.provider])).toEqual([["zai-1", "zai"], ["work", "bigmodel"]]);
  expect(runKit(["accounts", "disable"]).status).toBe(0);
  expect(loadConfig(kitConfig).auth.accounts?.enabled).toBe(false);
  expect((await loadAccountStore()).length).toBe(2);
  expect(runKit(["auth", "login", "zai", "--account"]).status).toBe(2);
});
