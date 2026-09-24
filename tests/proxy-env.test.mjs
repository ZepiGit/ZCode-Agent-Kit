import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyEnv } from '../lib/proxy-env.mjs';

test('managed proxies enable captcha solving without ambient opt-in', () => {
  const source = { PATH: 'keep-me' };
  const env = proxyEnv({ config: 'C:/kit/proxy/config.yaml' }, source);
  assert.equal(env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA, '1');
  assert.equal(env.ZCODE_PROXY_CONFIG, 'C:/kit/proxy/config.yaml');
  assert.equal(env.ZCODE_IDENTITY_ENV_CWD, '/workspace');
  assert.equal(env.PATH, 'keep-me');
  assert.deepEqual(source, { PATH: 'keep-me' });
});

test('managed login and service retain the configured account encryption key', () => {
  const key = 'synthetic-account-encryption-master-key';
  const env = proxyEnv({ config: '/fixture/config.yaml' }, { ZCODE_PROXY_CREDENTIAL_MASTER_KEY: key });
  assert.equal(env.ZCODE_PROXY_CREDENTIAL_MASTER_KEY, key);
});

test('managed env retains only explicit CDN cache controls without widening solver overrides', () => {
  const source = { CAPTCHA_CDN_CACHE_TTL_MS: '0', CAPTCHA_CDN_CACHE_DIR: 'C:/cache with spaces', CAPTCHA_DEBUG_BODIES: '1' };
  const env = proxyEnv({ config: 'C:/kit/proxy/config.yaml' }, source);
  assert.equal(env.CAPTCHA_CDN_CACHE_TTL_MS, '0');
  assert.equal(env.CAPTCHA_CDN_CACHE_DIR, source.CAPTCHA_CDN_CACHE_DIR);
  assert.equal(env.CAPTCHA_DEBUG_BODIES, undefined);
  assert.equal(env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA, '1');
});

test('managed env removes ambient solver overrides including Windows casing variants', () => {
  const source = {
    ZCODE_PROXY_CONFIG: 'ambient-config.yaml',
    ZCODE_CAPTCHA_POOL_MIN: '3',
    CAPTCHA_POOL_MIN: '999',
    captcha_pool_max: '999',
    CAPTCHA_DEBUG_BODIES: '1',
    PE_PATCH: 'custom',
    ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA: '0',
    Zcode_Proxy_Allow_Unsandboxed_Captcha: '0',
    ZCODE_PROXY_CREDENTIALS_PATH: 'C:/store/credentials.json',
    ZCODE_PROXY_CREDENTIAL_SECRET: 'keep',
    ZCODE_PROXY_ACCOUNTS_PATH: 'C:/store/accounts.json',
    HTTPS_PROXY: 'http://corporate-proxy:8080',
  };
  const snapshot = { ...source };
  const env = proxyEnv({ config: 'C:/kit/proxy/config.yaml' }, source);
  for (const name of ['ZCODE_CAPTCHA_POOL_MIN', 'CAPTCHA_POOL_MIN', 'captcha_pool_max', 'CAPTCHA_DEBUG_BODIES', 'PE_PATCH', 'Zcode_Proxy_Allow_Unsandboxed_Captcha']) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA, '1');
  assert.equal(env.ZCODE_PROXY_CREDENTIALS_PATH, source.ZCODE_PROXY_CREDENTIALS_PATH);
  assert.equal(env.ZCODE_PROXY_CREDENTIAL_SECRET, 'keep');
  assert.equal(env.ZCODE_PROXY_ACCOUNTS_PATH, source.ZCODE_PROXY_ACCOUNTS_PATH);
  assert.equal(env.HTTPS_PROXY, source.HTTPS_PROXY);
  assert.deepEqual(source, snapshot);
});

test('managed env passes the quota retry schedule knob through to the proxy', () => {
  const source = { ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS: 'off' };
  const env = proxyEnv({ config: 'C:/kit/proxy/config.yaml' }, source);
  assert.equal(env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS, 'off');
});
