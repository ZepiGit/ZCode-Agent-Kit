import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { proxyEnv, proxyServeEnv } from '../lib/proxy-env.mjs';

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
    HTTP_PROXY: 'http://corporate-proxy:8080',
    HTTPS_PROXY: 'http://corporate-proxy:8080',
    http_proxy: 'http://corporate-proxy:8080',
    https_proxy: 'http://corporate-proxy:8080',
    ALL_PROXY: 'http://corporate-proxy:8080',
    all_proxy: 'http://corporate-proxy:8080',
    ZCODE_PROXY_UPSTREAM_PROXY: 'http://explicit-proxy:8080',
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
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.ZCODE_PROXY_UPSTREAM_PROXY, source.ZCODE_PROXY_UPSTREAM_PROXY);
  assert.deepEqual(source, snapshot);
});

test('managed env passes the quota retry schedule knob through to the proxy', () => {
  const source = { ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS: 'off' };
  const env = proxyEnv({ config: 'C:/kit/proxy/config.yaml' }, source);
  assert.equal(env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS, 'off');
});

test('managed env passes the admission byte-cap override through to the proxy (ADR-0004)', () => {
  const source = { ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB: '128', ZCODE_PROXY_ADMISSION_MAX_QUEUED: '9' };
  const env = proxyEnv({ config: 'C:/kit/proxy/config.yaml' }, source);
  assert.equal(env.ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB, '128');
  // Only the documented key is an exception; other ZCODE_PROXY_* names stay stripped.
  assert.equal(env.ZCODE_PROXY_ADMISSION_MAX_QUEUED, undefined);
});

// Per-spawn variables (ADR-0014/ADR-0015, Round 4 Q4; ticket 18). Tokens are
// generated fixtures; assertions compare them without printing them (B2).
const PER_SPAWN = ['ZCODE_KIT_STOP_TOKEN', 'ZCODE_KIT_LOG_DIR'];
const kitCtx = { config: '/kit/proxy/config.yaml', logDir: '/kit/logs' };

test('the serving proxy gets the manager logs dir and the given stop token, overwriting ambient values in any casing', () => {
  const ambient = randomBytes(32).toString('base64url');
  const fresh = randomBytes(32).toString('base64url');
  const source = {
    ZCODE_KIT_STOP_TOKEN: ambient, zcode_kit_stop_token: ambient,
    ZCODE_KIT_LOG_DIR: '/ambient/logs', Zcode_Kit_Log_Dir: '/ambient/logs',
    ZCODE_KIT_WATCHDOG: '0', PATH: 'keep-me',
  };
  const snapshot = { ...source };
  const env = proxyServeEnv(kitCtx, fresh, source);
  assert.equal(env.ZCODE_KIT_LOG_DIR, '/kit/logs');
  assert.ok(env.ZCODE_KIT_STOP_TOKEN === fresh, 'the stop token is the one the manager generated for this spawn');
  // Windows env names are case-insensitive: a second spelling would make the
  // child's value depend on block order, so exactly one of each remains.
  for (const name of PER_SPAWN) {
    assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === name), [name], `${name} appears once`);
  }
  assert.equal(env.ZCODE_KIT_WATCHDOG, '0', 'other ZCODE_KIT_* variables still pass');
  assert.equal(env.PATH, 'keep-me');
  assert.equal(env.ZCODE_PROXY_CONFIG, '/kit/proxy/config.yaml');
  assert.deepEqual(source, snapshot);
});

test('the serving proxy env refuses a missing or empty stop token instead of spawning without one', () => {
  for (const bad of [undefined, null, '', 42]) {
    assert.throws(() => proxyServeEnv(kitCtx, bad, {}), /stop token/);
  }
});

test('other proxy children (login, store probes) inherit neither per-spawn variable', () => {
  const source = { ZCODE_KIT_STOP_TOKEN: randomBytes(32).toString('base64url'), zcode_kit_log_dir: '/ambient/logs', ZCODE_KIT_WATCHDOG: '0' };
  const env = proxyEnv({ config: '/kit/proxy/config.yaml' }, source);
  assert.deepEqual(Object.keys(env).filter((k) => PER_SPAWN.includes(k.toUpperCase())), []);
  assert.equal(env.ZCODE_KIT_WATCHDOG, '0');
});
