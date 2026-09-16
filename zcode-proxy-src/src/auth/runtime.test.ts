import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCredential, clearCredential, loadCredential } from "./store.js";
import { createStoredAuthManager } from "./runtime.js";

test("real fixture encrypted store reloads, survives partial writes, persists changed desktop import, and honors logout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-recovery-fixture-"));
  const previous = process.env.ZCODE_PROXY_CREDENTIALS_PATH;
  process.env.ZCODE_PROXY_CREDENTIALS_PATH = join(dir, "credentials.json");
  try {
    const old = { apiKey: "fixture-old", provider: "zai" as const };
    const fresh = { apiKey: "fixture-new", provider: "zai" as const };
    await saveCredential(old);
    let imports = 0;
    const auth = createStoredAuthManager("coding-plan", { importCredential: async () => { imports++; return fresh; }, importRevision: () => "fixture-revision" });
    expect(await auth.getCredential()).toEqual(old);
    const snapshot = readFileSync(process.env.ZCODE_PROXY_CREDENTIALS_PATH, "utf8");
    writeFileSync(process.env.ZCODE_PROXY_CREDENTIALS_PATH, "{");
    expect(await auth.getCredential()).toEqual(old);
    writeFileSync(process.env.ZCODE_PROXY_CREDENTIALS_PATH, '{}');
    expect(await auth.getCredential()).toEqual(old);
    writeFileSync(process.env.ZCODE_PROXY_CREDENTIALS_PATH, snapshot);
    expect(await auth.recoverCredential(old, "coding-plan")).toEqual(fresh);
    expect(await loadCredential()).toEqual(fresh);
    expect(imports).toBe(1);
    await saveCredential({ ...old, expiresAt: 1 });
    const cold = createStoredAuthManager("coding-plan", { importCredential: async () => fresh, importRevision: () => "fixture-cold" });
    expect(await cold.getCredential()).toEqual(fresh);
    clearCredential();
    await expect(auth.getCredential()).rejects.toThrow(/not available/);
    expect(imports).toBe(1);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_PROXY_CREDENTIALS_PATH; else process.env.ZCODE_PROXY_CREDENTIALS_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
