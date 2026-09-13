import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = '';
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) console.log('IN> ' + l.slice(0, 2500)); } });
proc.stderr.on('data', d => console.log('ERR> ' + d.toString('utf8').slice(0, 500)));
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');

call(1, 'workspace/readState', { workspace: { workspacePath: WS } });
await new Promise(r => setTimeout(r, 1500));
call(2, 'session/create', { workspace: { workspacePath: WS }, title: 'probe-session' });
await new Promise(r => setTimeout(r, 1500));
call(3, 'workspace/readState', {});
await new Promise(r => setTimeout(r, 800));
proc.kill(); setTimeout(() => process.exit(0), 500);
