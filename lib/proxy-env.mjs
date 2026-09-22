export function proxyEnv(ctx, source = process.env) {
  const env = { ...source };
  // The kit's config is authoritative; ambient vendor debug and trial flags
  // must not silently change the service that the manager authenticates.
  for (const name of Object.keys(env)) {
    if ((/^ZCODE_(?:PROXY_|CLAIM_|ASYNC_|DUMP_|CAPTCHA_)/i.test(name) && !['ZCODE_PROXY_CREDENTIALS_PATH', 'ZCODE_PROXY_CREDENTIAL_SECRET', 'ZCODE_PROXY_CREDENTIAL_MASTER_KEY', 'ZCODE_PROXY_ACCOUNTS_PATH'].includes(name.toUpperCase())) || /^(?:CAPTCHA_|PE_PATCH$)/i.test(name)) delete env[name];
  }
  env.ZCODE_PROXY_CONFIG = ctx.config;
  env.ZCODE_IDENTITY_ENV_CWD = '/workspace';
  // The managed service opts into vendor JS execution without an OS sandbox.
  env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA = '1';
  return env;
}
