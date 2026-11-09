// Seam 7: per-task caps and the response-text bound (ADR-0009, spec §7).
// Task response text is bounded at 4 MiB of UTF-8 while it is collected: past
// the cap the first 1 MiB is kept, then one `[… N bytes truncated …]` marker
// line, then the last bytes up to 4 MiB in total, with cuts on code-point
// boundaries. A truncated result is `completeness: partial` with the note
// merged after the terminal-state override, and carries the additive
// `truncated: { droppedBytes }`. Driven through the real MCP client against the
// fixture harness (FAKE_STREAM_DIR scripts the streamed text per prompt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BRIDGE_NODE_FLAGS, startBridge } from './client.mjs';

const MiB = 1024 * 1024;
const heapPreload = pathToFileURL(path.join(import.meta.dirname, '..', 'fixture', 'heap-probe.mjs')).href;
const MARKER_RE = /\[… \d+ bytes truncated …\]/g;

/** `n` ASCII characters of `word ` repeated (spaces keep the text clear of the long-token redaction). */
const filler = (word, n) => `${word} `.repeat(Math.ceil(n / (word.length + 1))).slice(0, n);

function scriptDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-caps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Split `text` into deltas of `size` code units, plus a cut at every index in `alsoAt`. */
function deltasOf(text, size, alsoAt = []) {
  const cuts = new Set(alsoAt);
  for (let i = size; i < text.length; i += size) cuts.add(i);
  const sorted = [...cuts].filter((i) => i > 0 && i < text.length).sort((a, b) => a - b);
  const out = [];
  let from = 0;
  for (const at of sorted) { out.push(text.slice(from, at)); from = at; }
  out.push(text.slice(from));
  return out;
}

/** Compare two long strings without printing megabytes on a mismatch. */
function assertSameText(actual, expected, label) {
  if (actual === expected) return;
  let i = 0;
  while (i < Math.min(actual.length, expected.length) && actual[i] === expected[i]) i += 1;
  assert.fail(`${label}: length ${actual.length} vs expected ${expected.length}, first difference at ${i}: ${JSON.stringify(actual.slice(i, i + 40))} vs ${JSON.stringify(expected.slice(i, i + 40))}`);
}

async function runTask(c, prompt) {
  const task = await c.tool('zcode_task_start', { workspacePath: c.workspaceDir, prompt, readOnly: true });
  const done = await c.tool('zcode_task_wait', { taskId: task.taskId, timeoutMs: 60_000 }, 90_000);
  const result = await c.tool('zcode_task_result', { taskId: task.taskId }, 90_000);
  return { done, result };
}

test('text past 4 MiB keeps the first 1 MiB and the last 3 MiB around one marker line, cut on code-point boundaries', async (t) => {
  const dir = scriptDir(t);
  // A 3-byte "€" crosses the 1 MiB mark and a 4-byte "😀" (a surrogate pair, split
  // across two deltas) crosses the tail cut: neither may be split, so both are dropped.
  const head = filler('head', MiB - 2);
  const tail = filler('tail', 3 * MiB);
  const text = head + '€' + filler('drop', MiB) + '😀' + tail;
  const emojiAt = head.length + 1 + MiB;
  fs.writeFileSync(path.join(dir, 'five-mib.json'), JSON.stringify(deltasOf(text, 65_521, [emojiAt + 1])));
  const c = await startBridge({ env: { FAKE_STREAM_DIR: dir } });
  try {
    const { done, result } = await runTask(c, 'five-mib');
    assert.equal(done.state, 'completed');
    // Dropped: the "€" (3), the 1 MiB in between and the "😀" (4) = 1,048,583 bytes.
    assertSameText(result.responseText, `${head}\n[… 1048583 bytes truncated …]\n${tail}`, 'responseText');
    assert.equal(result.responseText.match(MARKER_RE).length, 1, 'exactly one marker');
    assert.deepEqual(result.truncated, { droppedBytes: 1048583 });
    assert.equal(result.partial, true);
    assert.equal(result.completeness.status, 'partial');
    assert.match(result.completeness.explanation, /^turn stream captured via session events; /);
    assert.match(result.completeness.explanation, /1048583 bytes truncated/);
  } finally { await c.stop(); }
});

test('exactly 4 MiB is kept whole, even with a multi-byte character across the 1 MiB mark; one byte more drops that character', async (t) => {
  const dir = scriptDir(t);
  const head = filler('head', MiB - 2);
  const tail = filler('tail', 3 * MiB - 1);
  const exact = `${head}€${tail}`; // (1 MiB - 2) + 3 + (3 MiB - 1) bytes
  fs.writeFileSync(path.join(dir, 'exact.json'), JSON.stringify(deltasOf(exact, 100_000)));
  fs.writeFileSync(path.join(dir, 'over.json'), JSON.stringify(deltasOf(`${exact}!`, 100_000)));
  const c = await startBridge({ env: { FAKE_STREAM_DIR: dir } });
  try {
    const whole = (await runTask(c, 'exact')).result;
    assertSameText(whole.responseText, exact, 'a 4 MiB text');
    assert.equal(whole.completeness.status, 'full');
    assert.equal(whole.partial, false);
    assert.equal('truncated' in whole, false, 'no truncated field below the cap');

    const over = (await runTask(c, 'over')).result;
    // The head stops before the "€" (1 MiB - 2 bytes); the tail holds the 3 MiB after it.
    assertSameText(over.responseText, `${head}\n[… 3 bytes truncated …]\n${tail}!`, 'a 4 MiB + 1 text');
    assert.deepEqual(over.truncated, { droppedBytes: 3 });
    assert.equal(over.completeness.status, 'partial');
  } finally { await c.stop(); }
});

test('the terminal-state override cannot erase the truncation note', async (t) => {
  const dir = scriptDir(t);
  fs.writeFileSync(path.join(dir, 'failing.json'), JSON.stringify(deltasOf(`${filler('x', 4 * MiB)}😀`, 100_000)));
  const c = await startBridge({ env: { FAKE_STREAM_DIR: dir, FAKE_TURN: 'fail' } });
  try {
    const { done, result } = await runTask(c, 'failing');
    assert.equal(done.state, 'failed');
    assert.equal(result.completeness.status, 'partial');
    assert.match(result.completeness.explanation, /^task ended in state failed; /);
    assert.match(result.completeness.explanation, /\b4 bytes truncated\b/);
    assert.deepEqual(result.truncated, { droppedBytes: 4 });
    assert.equal(result.responseText.match(MARKER_RE).length, 1);
  } finally { await c.stop(); }
});

test('a task keeps at most 200 warnings and 1,000 tool calls, and says so', async () => {
  const c = await startBridge({ env: { FAKE_EVENT_GAPS: '250', FAKE_TOOL_CALLS: '1100' } });
  try {
    const { done, result } = await runTask(c, 'many events');
    assert.equal(done.state, 'completed');
    assert.equal(result.warnings.length, 200);
    // Each gap event skips one seq number, so the lost numbers go up by 2: the first 199 gaps are kept in order.
    const first = Number(/^event gap detected: seq (\d+)\.\.\1 missing$/.exec(result.warnings[0])?.[1]);
    assert.ok(Number.isInteger(first), result.warnings[0]);
    assert.deepEqual(result.warnings.slice(0, 199), Array.from({ length: 199 }, (_, i) => `event gap detected: seq ${first + 2 * i}..${first + 2 * i} missing`));
    assert.equal(result.warnings[199], 'warnings capped at 200; later warnings were dropped');
    assert.equal(result.completeness.status, 'partial', 'lost events still mark the result partial');

    assert.equal(result.toolCalls.length, 1000);
    assert.deepEqual(result.toolCalls.slice(0, 2), [{ toolName: 'Read', summary: 'toolCall read-0' }, { toolName: 'Read', summary: 'toolCall read-1' }]);
    assert.deepEqual(result.toolCalls[999], { toolName: 'Read', summary: 'toolCall read-999' });
    assert.deepEqual(result.fileChanges.modified, ['fixture-output.txt'], 'file changes are still recorded past the tool-call cap');
  } finally { await c.stop(); }
});

test('a tool call past the cap is reported in the warnings', async () => {
  const c = await startBridge({ env: { FAKE_TOOL_CALLS: '1000' } });
  try {
    const { result } = await runTask(c, 'one too many');
    // 1,000 Read calls fill the list; the fixture's Write call is the 1,001st.
    assert.equal(result.toolCalls.length, 1000);
    assert.ok(!result.toolCalls.some((call) => call.summary === 'toolCall tc1'));
    assert.deepEqual(result.warnings, ['tool calls capped at 1000; later tool calls are not listed']);
  } finally { await c.stop(); }
});

// The bound is a memory bound, not an output trim (Round 3 Q6 condition 1), and
// a kept slice must not keep its parent alive (ticket 32's probe): the bridge's
// retained heap after a 40 MiB stream of small deltas, and after one 24 MiB
// delta, stays near the 4 MiB the task may keep.
test('the bridge retains about 4 MiB of a task text, however much is streamed and however it is split', async (t) => {
  const dir = scriptDir(t);
  const heapDir = scriptDir(t);
  fs.writeFileSync(path.join(dir, 'small-deltas.gen.json'), JSON.stringify({ count: 10 * 1024, chars: 4096 }));
  fs.writeFileSync(path.join(dir, 'one-delta.gen.json'), JSON.stringify({ count: 1, chars: 24 * MiB }));
  const c = await startBridge({ nodeArgs: [...BRIDGE_NODE_FLAGS, '--expose-gc', '--import', heapPreload], env: { FAKE_STREAM_DIR: dir, ZCODE_TEST_HEAP_DIR: heapDir } });
  let n = 0;
  const retained = async () => {
    n += 1;
    fs.writeFileSync(path.join(heapDir, 'request'), '');
    for (const start = Date.now(); Date.now() - start < 20_000; await new Promise((r) => setTimeout(r, 50))) {
      try {
        const reading = JSON.parse(fs.readFileSync(path.join(heapDir, 'heap.json'), 'utf8'));
        if (reading.n === n) return reading.heapUsed / MiB;
      } catch { /* not written yet */ }
    }
    throw new Error('no heap reading');
  };
  try {
    await runTask(c, 'warm-up');
    const base = await retained();
    const small = await runTask(c, 'small-deltas');
    assert.equal(small.result.truncated.droppedBytes, 36 * MiB);
    const afterSmall = await retained();
    const big = await runTask(c, 'one-delta');
    assert.equal(big.result.truncated.droppedBytes, 20 * MiB);
    const afterBig = await retained();
    t.diagnostic(`retained heap: ${base.toFixed(1)} MiB, +${(afterSmall - base).toFixed(1)} after small deltas, +${(afterBig - base).toFixed(1)} after one delta`);
    assert.ok(afterSmall - base < 12, `retained after 40 MiB in 4 KiB deltas: +${(afterSmall - base).toFixed(1)} MiB`);
    assert.ok(afterBig - base < 16, `retained after a further 24 MiB in one delta: +${(afterBig - base).toFixed(1)} MiB`);
  } finally { await c.stop(); }
});

// Spec story 72: a result cached before the cap is served exactly as stored,
// even when its text is longer than the cap allows today.
test('a result cached before the change is served byte-identical, its long text untouched', async (t) => {
  const dataDir = scriptDir(t);
  const workspacePath = path.join(dataDir, 'ws');
  fs.mkdirSync(path.join(dataDir, 'tasks'), { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  const id = 'task-cached-old';
  const finishedAt = new Date(Date.now() - 60_000).toISOString();
  const rec = {
    schemaVersion: 1, taskId: id, idempotencyKey: null, workspacePath, workspaceKey: workspacePath,
    sessionId: `sess_${id}`, sessionOwnedByTask: true, prompt: 'old', state: 'completed', readOnly: true, mode: null,
    requestedModel: null, effectiveModel: null, thoughtLevel: null, createdAt: finishedAt, startedAt: finishedAt, finishedAt,
    lastSeq: 1, followUpCount: 0, error: null, usage: null,
    fileChanges: { added: [], modified: [], deleted: [], source: 'none', preExistingUncommitted: [] }, interruptionReason: null,
  };
  const old = {
    schemaVersion: 1, taskId: id, sessionId: rec.sessionId, workspacePath, status: 'completed', createdAt: finishedAt, startedAt: finishedAt, finishedAt,
    requestedModel: null, effectiveModel: null, mode: null, thoughtLevel: null,
    responseText: `${filler('old', 5 * MiB)}€😀`, partial: false, completeness: { status: 'full', explanation: 'turn stream captured via session events' },
    usage: { cumulative: null, note: 'usage unavailable' }, toolCalls: [], fileChanges: rec.fileChanges, artifacts: [], interactions: [],
    errors: [], warnings: [], eventsRef: { firstSeq: 1, lastSeq: 1, storage: `tasks/${id}.events.jsonl` },
  };
  fs.writeFileSync(path.join(dataDir, 'tasks', `${id}.json`), JSON.stringify(rec, null, 2));
  const resultFile = path.join(dataDir, 'tasks', `${id}.result.json`);
  const stored = JSON.stringify(old, null, 2);
  fs.writeFileSync(resultFile, stored);
  const c = await startBridge({ reuseDataDir: dataDir });
  try {
    const resp = await c.call('tools/call', { name: 'zcode_task_result', arguments: { taskId: id } });
    assert.ok(resp.result.content[0].text === JSON.stringify(old), `served text of ${resp.result.content[0].text.length} code units`);
    assert.deepEqual(resp.result.structuredContent, old);
    assert.ok(fs.readFileSync(resultFile, 'utf8') === stored, 'the cached file is not rewritten');
  } finally { await c.stop(); }
});

test('the task result tool describes the cap, the marker, the truncated field and the per-task caps', async () => {
  const c = await startBridge();
  try {
    const { tools } = await c.result('tools/list', {});
    const { description } = tools.find((tool) => tool.name === 'zcode_task_result');
    for (const phrase of ['4 MiB', 'first 1 MiB', 'last 3 MiB', '[… N bytes truncated …]', 'truncated: { droppedBytes }', 'completeness partial', '200 warnings', '200 errors', '1,000 tool calls']) {
      assert.ok(description.includes(phrase), `zcode_task_result description lacks "${phrase}": ${description}`);
    }
  } finally { await c.stop(); }
});
