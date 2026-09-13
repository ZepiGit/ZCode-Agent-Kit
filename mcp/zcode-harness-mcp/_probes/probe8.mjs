import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = ''; let sessionId = null; let seq = 0; let text = ''; let lastType = '';
const handle = (l) => {
  if (!l.trim()) return;
  let m = null; try { m = JSON.parse(l); } catch { return; }
  if (m.id !== undefined && m.method) {
    console.log('SRVREQ> ' + l.slice(0, 200));
    if (m.method === 'session/requestRuntimePreferences') {
      proc.stdin.write(JSON.stringify({ id: m.id, result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true } }) + '\n');
    } else {
      proc.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'not supported by bridge' } }) + '\n');
    }
    return;
  }
  if (m.method === 'session/event') { seq = m.params.seq; lastType = m.params.type; if (m.params.type === 'model.streaming' && m.params.payload?.kind === 'text_delta') text += m.params.payload.text ?? m.params.payload.delta ?? ''; console.log('EVT[seq' + m.params.seq + ' ' + m.params.type + ']> ' + JSON.stringify(m.params.payload).slice(0, 220)); return; }
  if (m.method) { console.log('NOTIF[' + m.method + ']> ' + l.slice(0, 200)); return; }
  console.log('RESP[' + m.id + ']> ' + l.slice(0, 500));
};
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
proc.stderr.on('data', d => console.log('ERR> ' + d.toString('utf8').slice(0, 200)));
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const W = { workspaceKey: WS, workspacePath: WS };

call(1, 'session/create', { workspace: W, mode: 'build' });
await new Promise(r => setTimeout(r, 3000));
console.log('=== SESSION =', sessionId);
if (!sessionId) { proc.kill(); process.exit(1); }
call(2, 'session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
await new Promise(r => setTimeout(r, 800));
call(3, 'session/send', { sessionId, content: 'Reply with exactly the two letters: OK' });
let t = 0;
while (t < 45 && !/turn\.completed|turn\.failed|idle/i.test(lastType)) { await new Promise(r => setTimeout(r, 1000)); t++; }
call(4, 'session/read', { sessionId });
await new Promise(r => setTimeout(r, 1200));
console.log('=== ACCUMULATED TEXT:', JSON.stringify(text.slice(0, 300)), 'lastType:', lastType, 'seq:', seq);
proc.kill(); setTimeout(() => process.exit(0), 500);
