import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = ''; let sessionId = null; let events = [];
const handle = (l) => {
  if (!l.trim()) return;
  let m = null; try { m = JSON.parse(l); } catch { return; }
  if (m.id !== undefined && m.method) {
    console.log('SRVREQ> ' + l.slice(0, 250));
    proc.stdin.write(JSON.stringify({ id: m.id, result: {} }) + '\n');
    return;
  }
  if (m.method) { events.push(m); console.log('NOTIF[' + m.method + ']> ' + JSON.stringify(m.params).slice(0, 400)); return; }
  console.log('RESP> ' + l.slice(0, 800));
};
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
proc.stderr.on('data', d => console.log('ERR> ' + d.toString('utf8').slice(0, 300)));
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const W = { workspaceKey: WS, workspacePath: WS };

call(1, 'session/create', { workspace: W });
await new Promise(r => setTimeout(r, 3000));
console.log('SESSION=', sessionId);
if (!sessionId) { proc.kill(); process.exit(1); }
call(2, 'session/send', { sessionId, workspace: W, message: 'Reply with exactly the two letters: OK' });
let running = true; let idle = 0;
while (running && idle < 40) {
  await new Promise(r => setTimeout(r, 1000));
  // crude completion: last event type heuristics
  const last = events[events.length - 1];
  if (last && /completed|idle|done|finish/i.test(JSON.stringify(last).slice(0, 120))) idle++;
}
call(9, 'session/read', { sessionId, workspace: W });
await new Promise(r => setTimeout(r, 1500));
proc.kill(); setTimeout(() => process.exit(0), 500);
