import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: 'C:/Users/miche/zcode-harness-mcp/_probes/ws1' });
let buf = '';
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) console.log('IN> ' + l.slice(0, 1500)); } });
proc.stderr.on('data', d => console.log('ERR> ' + d.toString('utf8').slice(0, 500)));
await new Promise(r => setTimeout(r, 1500));

const call = (id, method, params) => { proc.stdin.write(JSON.stringify({ id, method, params }) + '\n'); return id; };

call(1, 'workspace/readState', {});
await new Promise(r => setTimeout(r, 1200));
call(2, 'session/list', {});
await new Promise(r => setTimeout(r, 1200));
call(3, 'mcp/list', {});
await new Promise(r => setTimeout(r, 1200));
call(4, 'usage/stats', {});
await new Promise(r => setTimeout(r, 1200));
proc.kill(); setTimeout(() => process.exit(0), 500);
