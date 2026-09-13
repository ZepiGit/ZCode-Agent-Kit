import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = '';
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) console.log('IN> ' + l.slice(0, 3000)); } });
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const W = { workspaceKey: WS, workspacePath: WS };

call(1, 'workspace/readState', { workspace: W });
await new Promise(r => setTimeout(r, 1500));
call(2, 'session/create', { workspace: W });
await new Promise(r => setTimeout(r, 1500));
proc.kill(); setTimeout(() => process.exit(0), 500);
