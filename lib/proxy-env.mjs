export function proxyEnv(ctx, source = process.env) {
  const env = { ...source };
  // The kit's config is authoritative; ambient vendor debug and trial flags
  // must not silently change the service that the manager authenticates.
  for (const name of Object.keys(env)) {
    // Cache lifetime/location are explicit operator controls, not solver or
    // security overrides. The cache validates their values in the child.
    if (['CAPTCHA_CDN_CACHE_TTL_MS', 'CAPTCHA_CDN_CACHE_DIR'].includes(name.toUpperCase())) {
      if (!Object.hasOwn(source, name.toUpperCase())) env[name.toUpperCase()] = env[name];
      if (name !== name.toUpperCase()) delete env[name];
      continue;
    }
    if ((/^ZCODE_(?:PROXY_|CLAIM_|ASYNC_|DUMP_|CAPTCHA_)/i.test(name) && !['ZCODE_PROXY_CREDENTIALS_PATH', 'ZCODE_PROXY_CREDENTIAL_SECRET', 'ZCODE_PROXY_CREDENTIAL_MASTER_KEY', 'ZCODE_PROXY_ACCOUNTS_PATH', 'ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS'].includes(name.toUpperCase())) || /^(?:CAPTCHA_|PE_PATCH$)/i.test(name)) delete env[name];
  }
  env.ZCODE_PROXY_CONFIG = ctx.config;
  env.ZCODE_IDENTITY_ENV_CWD = '/workspace';
  // The managed service opts into vendor JS execution without an OS sandbox.
  env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA = '1';
  return env;
}
