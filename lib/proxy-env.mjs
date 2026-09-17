export function proxyEnv(ctx, source = process.env) {
  const env = { ...source };
  // The kit's config is authoritative; ambient vendor debug and trial flags
  // must not silently change the service that the manager authenticates.
  for (const name of Object.keys(env)) {
    if (/^ZCODE_(?:PROXY_|CLAIM_|ASYNC_|DUMP_|CAPTCHA_)/i.test(name) && !['ZCODE_PROXY_CREDENTIALS_PATH', 'ZCODE_PROXY_CREDENTIAL_SECRET'].includes(name.toUpperCase())) delete env[name];
  }
  env.ZCODE_PROXY_CONFIG = ctx.config;
  env.ZCODE_IDENTITY_ENV_CWD = '/workspace';
  return env;
}
