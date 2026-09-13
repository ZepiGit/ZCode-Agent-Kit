import { spawn } from 'node:child_process';
const RUNTIME = 'C:/Program Files/ZCode/resources/glm/zcode.cjs';
const WS = 'C:/Users/miche/zcode-harness-mcp/_probes/ws1';
const proc = spawn(process.execPath, [RUNTIME, 'app-server', '--stdio'], { stdio: ['pipe','pipe','pipe'], cwd: WS });
let buf = ''; let sessionId = null; const out = {};
const handle = (l) => {
  if (!l.trim()) return;
  let m = null; try { m = JSON.parse(l); } catch { return; }
  if (m.id !== undefined && m.method) {
    if (m.method === 'session/requestRuntimePreferences') proc.stdin.write(JSON.stringify({ id: m.id, result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true } }) + '\n');
    else proc.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'bridge: declined' } }) + '\n');
    return;
  }
  if (m.method) return;
  const id = m.id;
  if (id === 1 && m.result) { sessionId = m.result.session?.sessionId; return; }
  out[id] = m.result ? 'OK: ' + JSON.stringify(m.result).slice(0, 150) : 'ERR: ' + (m.error?.message || '').slice(0, 120);
};
proc.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
await new Promise(r => setTimeout(r, 1500));
const call = (id, method, params) => proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
const W = { workspaceKey: WS, workspacePath: WS };
const wait = ms => new Promise(r => setTimeout(r, ms));
const show = n => { console.log('[' + n + '] ' + (out[n] || 'NO-RESPONSE')); };

call(1, 'session/create', { workspace: W, mode: 'build' }); await wait(2200);
console.log('sessionId:', sessionId);
call(10, 'session/messages', { sessionId }); await wait(700); show(10);
call(11, 'session/events', { sessionId }); await wait(700); show(11);
call(12, 'session/usage', { sessionId }); await wait(700); show(12);
call(13, 'session/subagents', { sessionId }); await wait(700); show(13);
call(14, 'session/goal', { sessionId }); await wait(700); show(14);
call(15, 'skills/referenceCatalog', { workspace: W }); await wait(900); show(15);
call(16, 'plugins/list', {}); await wait(900); show(16);
call(17, 'usage/stats', { range: '7d' }); await wait(900); show(17);
call(18, 'session/setMode', { sessionId, mode: 'plan' }); await wait(700); show(18);
call(19, 'session/setMode', { sessionId, mode: 'build' }); await wait(700); show(19);
call(20, 'session/setThoughtLevel', { sessionId, thoughtLevel: 'high' }); await wait(700); show(20);
call(21, 'session/compact', { sessionId }); await wait(900); show(21);
call(22, 'session/fork', { sessionId, target: { kind: 'latestCheckpoint' } }); await wait(1200); show(22);
call(23, 'automation/list', {}); await wait(700); show(23);
call(24, 'session/stop', { sessionId }); await wait(700); show(24);
call(25, 'session/close', { sessionId }); await wait(900); show(25);
call(26, 'workspace/setDefaultModel', { workspace: W, model: { providerId: 'zai', modelId: 'GLM-5.3' } }); await wait(900); show(26);
call(27, 'session/resume', { sessionId }); await wait(1200); show(27);
call(28, 'v4/connection/flow', {}); await wait(700); show(28);
call(29, 'workspace/generateText', { workspace: W, prompt: 'hi' }); await wait(1200); show(29);
proc.kill(); setTimeout(() => process.exit(0), 500);
