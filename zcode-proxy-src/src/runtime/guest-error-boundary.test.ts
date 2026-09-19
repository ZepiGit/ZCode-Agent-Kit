import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./guest-error.ts', import.meta.url));

async function child(guest: boolean, rejection: boolean, message = 'synthetic callback failure') {
  const source = `
    import { installGuestErrorBoundary } from ${JSON.stringify(helper)};
    installGuestErrorBoundary();
    installGuestErrorBoundary();
    if (process.listenerCount('uncaughtException') !== 1 || process.listenerCount('unhandledRejection') !== 1) process.exit(2);
    const err = new TypeError(${JSON.stringify(message)});
    ${guest ? "err.stack = 'TypeError: synthetic callback failure\\n at callback (https://g.alicdn.com/captcha-frontend/FeiLin/synthetic.js:1:1)';" : ''}
    ${rejection ? 'Promise.reject(err);' : 'setTimeout(() => { throw err; }, 0);'}
    setTimeout(() => console.log('HOST_ALIVE'), 40);
  `;
  const proc = Bun.spawn([process.execPath, '--eval', source], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}

describe('headless guest error boundary', () => {
  for (const rejection of [false, true]) {
    it(`contains guest ${rejection ? 'rejection' : 'exception'} without killing the host`, async () => {
      const result = await child(true, rejection);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('HOST_ALIVE');
      expect(result.stderr).toContain('[captcha-guest-error]');
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
  }
});
