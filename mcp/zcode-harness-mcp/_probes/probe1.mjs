// Live protocol probe: start app-server, send candidates, dump raw bytes
import { spawn } from 'node:child_process';

const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: 'C:/Users/miche/zcode-harness-mcp/_probes/ws1',
});
proc.stdout.on('data', d => {
  const s = d.toString('utf8');
  console.log('STDOUT>', JSON.stringify(s).slice(0, 2000));
});
proc.stderr.on('data', d => {
  console.log('STDERR>', JSON.stringify(d.toString('utf8')).slice(0, 1000));
});
proc.on('exit', (c, s) => console.log('EXIT>', c, s?.toString()));

await new Promise(r => setTimeout(r, 1500));

// Candidate framings for initialize
const candidates = [
  // 1: newline-delimited JSON
  { label: 'ndjson', data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' },
];
for (const c of candidates) {
  console.log('SENDING', c.label);
  proc.stdin.write(c.data);
  await new Promise(r => setTimeout(r, 2000));
}
// 2: Content-Length framing
const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} });
console.log('SENDING content-length');
proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
await new Promise(r => setTimeout(r, 2000));

proc.kill();
setTimeout(() => process.exit(0), 1000);
