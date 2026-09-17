import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('./webui.txt', import.meta.url), 'utf8');

test('WebUI does not load remote scripts into the credential origin', () => {
  expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
});

test('WebUI persistence excludes credentials and key-bearing MCP connection details', () => {
  const begin = html.indexOf('function saveState()');
  const end = html.indexOf('function activeConv()', begin);
  let saved = '';
  const state = { settings: { apiKey: 'secret', mcpServers: [{ url: 'https://server/?key=secret', authKey: 'secret' }], mcpCorsProxy: 'https://secret/', model: 'x' }, conversations: [] };
  vm.runInNewContext(html.slice(begin, end) + ';saveState();', { state, STORE: 'test', localStorage: { setItem: (_key: string, value: string) => { saved = value; } }, toast: () => {} });
  expect(saved).not.toContain('secret');
  expect(JSON.parse(saved).settings.model).toBe('x');
  expect(state.settings.apiKey).toBe('secret');
});

test('WebUI renders untrusted model markup as text without optional sanitizer', () => {
  const begin = html.indexOf('function renderMarkdown(text)');
  const end = html.indexOf('// Tiny script', begin);
  const result = vm.runInNewContext(html.slice(begin, end) + ';renderMarkdown("<img src=x onerror=alert(1)>");');
  expect(result).toBe('&lt;img src=x onerror=alert(1)&gt;');
});
