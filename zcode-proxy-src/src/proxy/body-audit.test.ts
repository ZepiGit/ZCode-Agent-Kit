import { expect, test } from 'bun:test';
import { readBody, InflatedBodyTooLargeError } from './handler.js';
import { dumpHeaders } from './dump.js';

test('request body caps apply to declared and chunked raw input', async () => {
  const declared = new Request('http://localhost/v1/messages', { method: 'POST', headers: { 'content-length': String(32 * 1024 * 1024 + 1) }, body: '{}' });
  await expect(readBody(declared)).rejects.toBeInstanceOf(InflatedBodyTooLargeError);
  let cancelled = false;
  const input = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(32 * 1024 * 1024)); c.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const request = new Request('http://localhost/v1/messages', { method: 'POST', body: input, duplex: 'half' } as RequestInit);
  await expect(readBody(request)).rejects.toBeInstanceOf(InflatedBodyTooLargeError);
  expect(cancelled).toBe(true);
});

test('diagnostic headers redact the actual provider captcha header and cookies', () => {
  const original = 'synthetic-sensitive-token-for-audit';
  const headers = dumpHeaders(new Headers({ 'x-aliyun-captcha-verify-param': original, 'set-cookie': original }));
  expect(headers['x-aliyun-captcha-verify-param']).not.toBe(original);
  expect(headers['set-cookie']).not.toBe(original);
});
