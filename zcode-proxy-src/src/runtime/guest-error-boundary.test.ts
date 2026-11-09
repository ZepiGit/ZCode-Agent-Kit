import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./guest-error.ts', import.meta.url));

async function child(guest: boolean, rejection: boolean, message = 'synthetic callback failure', stackQuery = '') {
  const source = `
    import { installGuestErrorBoundary } from ${JSON.stringify(helper)};
    installGuestErrorBoundary();
    installGuestErrorBoundary();
    if (process.listenerCount('uncaughtException') !== 1 || process.listenerCount('unhandledRejection') !== 1) process.exit(2);
    const err = new TypeError(${JSON.stringify(message)});
    ${guest ? `err.stack = 'TypeError: synthetic callback failure\\n at callback (https://g.alicdn.com/captcha-frontend/FeiLin/synthetic.js:1:1${stackQuery})';` : ''}
    ${rejection ? 'Promise.reject(err);' : 'setTimeout(() => { throw err; }, 0);'}
    setTimeout(() => console.log('HOST_ALIVE'), 40);
  `;
  const proc = Bun.spawn([process.execPath, '--eval', source], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}

describe('headless guest error boundary', () => {
  // Synthetic marker standing in for any credential/token-shaped content a
  // guest error message or stack URL might carry (GitHub issue 32).
  const SECRET = 'SYNTHETIC-SECRET-MARKER-7c41ab90';

  for (const rejection of [false, true]) {
    it(`contains guest ${rejection ? 'rejection' : 'exception'} without killing the host`, async () => {
      const result = await child(true, rejection);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('HOST_ALIVE');
      expect(result.stderr).toContain('[captcha-guest-error]');
    });
    it(`keeps a synthetic secret out of guest ${rejection ? 'rejection' : 'exception'} diagnostics (metadata-only)`, async () => {
      const result = await child(true, rejection, `callback failed token=${SECRET}`);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('HOST_ALIVE');
      expect(result.stderr).toContain('[captcha-guest-error]');
      // Metadata-only: the message content and any URL query never surface.
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stderr).not.toContain('token=');
      expect(result.stderr).toMatch(/len=\d+ sha256=[0-9a-f]{64}/);
    });
    it(`keeps a synthetic secret out of guest ${rejection ? 'rejection' : 'exception'} stack-URL diagnostics`, async () => {
      const result = await child(true, rejection, 'synthetic callback failure', `?access_token=${SECRET}`);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('[captcha-guest-error]');
      expect(result.stderr).toContain('synthetic.js');
      expect(result.stderr).not.toContain(SECRET);
    });
    it(`does not treat a CDN URL in a host error message as guest provenance (${rejection})`, async () => {
      const result = await child(false, rejection, 'Failed to fetch https://g.alicdn.com/script.js');
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain('HOST_ALIVE');
      expect(result.stderr).not.toContain('[captcha-guest-error]');
    });
    it(`keeps host ${rejection ? 'rejection' : 'exception'} fatal`, async () => {
      const result = await child(false, rejection);
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain('HOST_ALIVE');
      expect(result.stderr).toContain('synthetic callback failure');
    });
    it(`keeps a synthetic secret visible on the host ${rejection ? 'rejection' : 'exception'} path (classification preserved)`, async () => {
      const result = await child(false, rejection, `host fault token=${SECRET}`);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(SECRET); // host errors are ours to print in full
      expect(result.stderr).not.toContain('[captcha-guest-error]');
    });
  }
});
