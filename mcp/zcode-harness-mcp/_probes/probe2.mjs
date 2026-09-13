import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const lines = [];
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: 'C:/Users/miche/zcode-harness-mcp/_probes/ws1' });
proc.stdout.on('data', d => { for (const l of d.toString('utf8').split('\n')) if (l.trim()) console.log('IN> ' + l.slice(0, 800)); });
proc.stderr.on('data', d => console.log('ERR> ' + d.toString('utf8').slice(0,400)));
proc.on('exit', (c) => console.log('EXIT>', c));
await new Promise(r => setTimeout(r, 1500));

const sends = [
  JSON.stringify({ id: 1, method: 'initialize', params: {} }) + '\n',
];
for (const s of sends) { proc.stdin.write(s); await new Promise(r => setTimeout(r, 2500)); }
proc.kill(); setTimeout(() => process.exit(0), 800);
