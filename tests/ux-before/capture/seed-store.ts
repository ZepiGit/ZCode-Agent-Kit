// UX capture fixture: seed a SYNTHETIC credential store and account pool in the
// fixture HOME (paths come from ZCODE_PROXY_CREDENTIALS_PATH /
// ZCODE_PROXY_ACCOUNTS_PATH, secret from ZCODE_PROXY_CREDENTIAL_SECRET; the
// capture script sets all three to fixture values). Same approach as
// zcode-proxy-src/src/auth/account-cli.test.ts. No real login is ever read.
// usage: bun seed-store.ts <real-proxy-src> credential|accounts
const [src, mode] = process.argv.slice(2);
for (const name of ["ZCODE_PROXY_CREDENTIALS_PATH", "ZCODE_PROXY_ACCOUNTS_PATH", "ZCODE_PROXY_CREDENTIAL_SECRET"]) {
  if (!process.env[name]) { console.error(`seed-store: ${name} must be set to a fixture value`); process.exit(2); }
}
if (!/ux-kit-/.test(process.env.ZCODE_PROXY_CREDENTIALS_PATH!)) { console.error("seed-store: refusing a non-fixture store path"); process.exit(2); }
const NOW = Date.parse("2026-11-05T12:00:00.000Z");
if (mode === "credential") {
  const { saveCredential } = await import(`${src}/src/auth/store.ts`);
  await saveCredential({ provider: "zai", apiKey: "ux-synthetic-api-key-0001", secret: "ux-synthetic-secret", jwt: "ux.synthetic.jwt" });
} else if (mode === "accounts") {
  const { addAccount } = await import(`${src}/src/auth/account-store.ts`);
  const path = process.env.ZCODE_PROXY_ACCOUNTS_PATH!;
  await addAccount({ id: "work", label: "Work account", plan: "coding-plan", createdAt: NOW - 86_400_000 * 30, credential: { provider: "zai", apiKey: "ux-synthetic-work", secret: "s1", jwt: "ux.synthetic.work" } }, { path });
  await addAccount({ id: "personal", label: "Personal", plan: "start-plan", createdAt: NOW - 86_400_000 * 7, credential: { provider: "zai", apiKey: "ux-synthetic-personal", secret: "s2", jwt: "ux.synthetic.personal" } }, { path });
  await addAccount({ id: "backup", plan: "coding-plan", paused: true, createdAt: NOW - 86_400_000, credential: { provider: "bigmodel", apiKey: "ux-synthetic-backup" } }, { path });
} else {
  console.error("usage: bun seed-store.ts <proxy-src> credential|accounts");
  process.exit(2);
}
