import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = ''; let sessionId = null; let serverReq = 0;
const log = (tag, l) => console.log(tag + ' ' + l.slice(0, 1200));
const handle = (l) => {
  if (!l.trim()) return;
  let m = null; try { m = JSON.parse(l); } catch { log('RAW>', l); return; }
  if (m.id !== undefined && m.method) { // server→client request
    serverReq++;
    console.log('SRVREQ> ' + l.slice(0, 300));
    if (m.id === 1) return; // our create echo protection
    proc.stdin.write(JSON.stringify({ id: m.id, error: { code: -32000, message: 'declined by probe client' } }) + '\n');
    return;
  }
  if (m.method) { log('NOTIF>', l); return; }
  if (m.id === 1 && m.result && m.result.sessionId) { sessionId = m.result.sessionId; log('CREATE>', l.slice(0,600)); return; }
  log('RESP>', l);
};
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
proc.stderr.on('data', d => console.log('ERR> ' + d.toString('utf8').slice(0, 300)));
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const W = { workspaceKey: WS, workspacePath: WS };

call(1, 'session/create', { workspace: W });
await new Promise(r => setTimeout(r, 2000));
console.log('SESSION=', sessionId);
if (!sessionId) { proc.kill(); process.exit(1); }
call(2, 'session/subscribe', { sessionId, workspace: W });
await new Promise(r => setTimeout(r, 500));
call(3, 'session/send', { sessionId, workspace: W, message: 'Reply with exactly the two letters: OK' });
// wait for completion up to 60s
let done = false;
for (let t = 0; t < 60 && !done; t++) { await new Promise(r => setTimeout(r, 1000)); }
console.log('SRVREQS_TOTAL=', serverReq);
call(4, 'session/read', { sessionId, workspace: W });
await new Promise(r => setTimeout(r, 1000));
proc.kill(); setTimeout(() => process.exit(0), 500);
