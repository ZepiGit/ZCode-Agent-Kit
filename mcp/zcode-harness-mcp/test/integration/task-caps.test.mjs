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
import { startBridge } from './client.mjs';

const MiB = 1024 * 1024;
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
