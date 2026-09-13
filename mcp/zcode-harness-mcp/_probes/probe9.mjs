import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = ''; let sessionId = null; let text = ''; let lastType = ''; let evts = [];
const handle = (l) => {
  if (!l.trim()) return;
  let m = null; try { m = JSON.parse(l); } catch { return; }
  if (m.id !== undefined && m.method) {
    if (m.method === 'session/requestRuntimePreferences') proc.stdin.write(JSON.stringify({ id: m.id, result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true } }) + '\n');
    else proc.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'not supported by bridge' } }) + '\n');
    return;
  }
  if (m.method === 'session/event') { evts.push(m.params); lastType = m.params.type; const p = m.params.payload || {}; if (p.kind === 'text_delta') text += (p.text ?? p.delta ?? ''); return; }
  if (m.method) return; // telemetry noise
  if (m.id === 1 && m.result) { sessionId = m.result.session?.sessionId; console.log('CREATE-OK sessionId=' + sessionId + ' model=' + JSON.stringify(m.result.session?.model) + ' status=' + m.result.projection?.status); return; }
  console.log('RESP[' + m.id + ']> ' + l.slice(0, 400));
};
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const W = { workspaceKey: WS, workspacePath: WS };

call(1, 'session/create', { workspace: W, mode: 'build' });
await new Promise(r => setTimeout(r, 2500));
if (!sessionId) { console.log('NO SESSION'); proc.kill(); process.exit(1); }
call(2, 'session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
await new Promise(r => setTimeout(r, 600));
call(3, 'session/send', { sessionId, content: 'Reply with exactly the two letters: OK' });
let t = 0;
while (t < 45 && !/turn\.completed|turn\.failed/.test(lastType)) { await new Promise(r => setTimeout(r, 1000)); t++; }
console.log('=== EVENT TYPES:', evts.map(e => e.type).join(','), '| lastType:', lastType);
console.log('=== MODEL TEXT:', JSON.stringify(text.slice(0, 200)));
call(4, 'session/setModel', { sessionId, model: { providerId: 'zai', modelId: 'GLM-5-Turbo' } });
await new Promise(r => setTimeout(r, 1000));
call(5, 'session/setModel', { sessionId, model: { providerId: 'zai', modelId: 'GLM-9.9-DoesNotExist' } });
await new Promise(r => setTimeout(r, 1000));
call(6, 'session/read', { sessionId });
await new Promise(r => setTimeout(r, 1200));
proc.kill(); setTimeout(() => process.exit(0), 500);
