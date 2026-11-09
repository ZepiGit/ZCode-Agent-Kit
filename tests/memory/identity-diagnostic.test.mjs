// Round36 Q1: seam 1 (artifact records -> offline diagnostic, not shipping verdict).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('two actual fixture executions overlap below polling interval and remain diagnostic RED', { timeout: 120000 }, async () => {
  const { appendRecord, liveRecord, readRecords, classify } = await import('./lib/identity-diagnostic.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'identity-overlap-'));
  const children = [];
  const rawPath = join(dir, 'harness-spawns.jsonl');
  const parentPath = join(dir, 'parent-spawns.jsonl');
  const fixturePath = fileURLToPath(new URL('../../mcp/zcode-harness-mcp/test/fixture/fake-harness.mjs', import.meta.url));
  try {
    for (let i = 0; i < 2; i++) {
      const child = spawn(process.execPath, [fixturePath, 'app-server', '--stdio'], { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, ZCODE_S5_DIAGNOSTIC_RUN: run, ZCODE_S5_DIAGNOSTIC_RAW: rawPath } });
      children.push(child);
      const observed = liveRecord(child.pid, process.pid, { event: 'spawn', run, argv: [process.execPath, fixturePath, 'app-server', '--stdio'] });
      appendRecord(parentPath, observed);
      child.once('exit', () => appendRecord(parentPath, { ...observed, event: 'child-exit', t: Date.now() }));
    }
    // Let both fixtures finish startup before closing stdin. No process-table
    // polling is involved: this interval is deliberately shorter than 1000 ms.
    const deadline = Date.now() + 90000;
    while (readRecords(rawPath).records.filter((r) => r.event === 'start').length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.equal(readRecords(rawPath).records.filter((r) => r.event === 'start').length, 2, 'both actual fixtures acknowledged startup before closing stdin');
    const exited = children.map((c) => once(c, 'exit'));
    for (const c of children) c.stdin.end();
    await Promise.all(exited);
    const raw = readRecords(rawPath), parents = readRecords(parentPath);
    assert.equal(raw.valid, true);
    const result = classify({ run, raw: raw.records, parents: parents.records, problems: [...raw.problems, ...parents.problems] });
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.maxExecutions, 2);
    assert.equal(result.executionRed, true);
    const starts = raw.records.filter((r) => r.event === 'start');
    const exits = raw.records.filter((r) => r.event === 'exit');
    assert.ok(Math.min(...exits.map((r) => r.t)) - Math.max(...starts.map((r) => r.t)) < 1000);
  } finally {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill();
    await Promise.all(children.filter((c) => c.exitCode === null && c.signalCode === null).map((c) => once(c, 'exit')));
    rmSync(dir, { recursive: true, force: true });
  }
});
import { join } from 'node:path';

const run = 'offline-control';
const argv = ['/node', '/fixtures/fake-harness.mjs', 'app-server', '--stdio'];
const life = (pid = 10, start = '100', from = 1000, until = 1100) => [
  { event: 'start', run, pid, ppid: 5, start, parentStart: '50', t: from, argv, exe: '/node' },
  { event: 'exit', run, pid, ppid: 5, start, parentStart: '50', t: until, argv, exe: '/node' },
];
const parentLife = (rows) => rows.map((r) => ({ ...r, event: r.event === 'start' ? 'spawn' : 'child-exit', t: r.t + 1 }));
const sample = { event: 'process', run, pid: 10, ppid: 5, start: '100', parentStart: '50', t: 1050, argv, exe: '/node', role: 'fake-harness', rssKb: 4096, commitKb: 2048, wsPeakKb: 4096 };
const consoleRow = { ...sample, pid: 11, ppid: 10, start: '101', parentStart: '100', argv: ['C:\\Windows\\conhost.exe', '0x4'], exe: 'C:\\Windows\\conhost.exe', rssKb: 1024, commitKb: 512, wsPeakKb: 1024 };

test('offline Windows identity fixture keeps two process rows and footprint but one diagnostic execution', async () => {
  const { classify } = await import('./lib/identity-diagnostic.mjs');
  const raw = life();
  const rows = [sample, consoleRow];
  const result = classify({ run, raw, parents: parentLife(raw), processes: rows });
  assert.equal(result.valid, true);
  assert.equal(result.maxExecutions, 1);
  assert.equal(result.maxConsoleSupport, 1);
  assert.equal(result.originalProcessCount, 2);
  assert.equal(result.fixturePeakCommitKb, 2560);
  assert.equal(result.fixturePeakRssKb, 5120);
  assert.equal(result.executionRed, false);
  assert.deepEqual(rows, [sample, consoleRow]);
  assert.equal(classify({ run, raw, parents: parentLife(raw), processes: [{ ...sample, argv: ['node', ...argv.slice(1)] }] }).valid, true, 'OS argv[0] spelling may differ from Node process.argv[0]; exact executable and all fixture arguments must still agree');
  const { osVerdict } = await import('./lib/verdict.mjs');
  const shipping = osVerdict([{ t: 0, progress: 0, procs: rows.map((r) => ({ ...r, key: `${r.pid}:${r.start}`, hwmKb: r.commitKb, fds: 0, threads: 0 })) }], { counts: { 'fake-harness': 1 }, orphans: 0 });
  assert.equal(shipping.checks.find((c) => c.name === 'count:fake-harness').value, 2);
  assert.equal(shipping.red, true, 'diagnostic one execution does not waive shipping count two');
});

test('Windows tracker retains console parent creation identity after parent exit and PID reuse', async () => {
  const { createKitTracker } = await import('./lib/win-sampler.mjs');
  const row = (pid, ppid, created, name, commandLine) => ({ pid, ppid, created, name, commandLine, executablePath: `C:\\Windows\\${name}`, rssKb: 1024, commitKb: 512, wsPeakKb: 1024 });
  const root = row(1, 99, '1', 'node.exe', 'run.mjs');
  const harness = row(10, 1, '100', 'node.exe', 'C:\\node.exe C:\\fixture\\fake-harness.mjs app-server --stdio');
  const console = row(11, 10, '101', 'conhost.exe', 'C:\\Windows\\conhost.exe 0x4');
  const tracker = createKitTracker({ rootPid: 1, token: run });
  const first = tracker.select([root, harness, console]);
  assert.equal(first.find((p) => p.pid === 11).parentStart, '100');
  const later = tracker.select([root, console]);
  assert.equal(later.find((p) => p.pid === 11).parentStart, '100');
  assert.equal(later.find((p) => p.pid === 11).role, 'other', 'shipping role mapping is not amended');
  const reused = tracker.select([root, { ...harness, created: '200' }, console]);
  const { windowsIdentityRows } = await import('./lib/identity-diagnostic.mjs');
  assert.equal(windowsIdentityRows([console], reused, parentLife(life())).find((p) => p.pid === 11).parentStart, '100');
});

test('Windows console discovered after parent vanished between polls keeps exact lifecycle ancestry', async () => {
  const { windowsIdentityRows } = await import('./lib/identity-diagnostic.mjs');
  const table = [{ pid: 11, ppid: 10, created: '101', executablePath: 'C:\\Windows\\conhost.exe', commandLine: 'C:\\Windows\\conhost.exe 0x4', rssKb: 1024, commitKb: 512, wsPeakKb: 1024 }];
  const rows = windowsIdentityRows(table, [], parentLife(life()));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parentStart, '100');
  assert.equal(rows[0].role, 'fake-harness');
  // A reused parent PID with creation time newer than the console cannot own it.
  assert.equal(windowsIdentityRows(table, [], parentLife(life(10, '200'))).length, 0);
});

test('orphan console remains attributed after parent exit and kit console stays charged', async () => {
  const { classify } = await import('./lib/identity-diagnostic.mjs');
  const raw = life();
  const kit = { ...sample, pid: 5, ppid: 1, start: '50', parentStart: '1', argv: null, exe: '/node', role: 'mcp-bridge' };
  const kitConsole = { ...consoleRow, pid: 12, ppid: 5, parentStart: '50', role: 'other' };
  const result = classify({ run, raw, parents: parentLife(raw), processes: [sample, consoleRow, kit, kitConsole, { ...consoleRow, t: 1200, label: 'orphans' }] });
  assert.equal(result.valid, true);
  assert.equal(result.cleanupRed, true);
  assert.deepEqual(result.cleanupFailures, ['11:101']);
  assert.equal(result.kitConsolePeakCommitKb, 512);
  assert.equal(result.kitConsolePeakRssKb, 1024);
});

test('PID reuse is separate and missing argv/ancestry/lifecycle or malformed records invalidate classification', async () => {
  const { classify } = await import('./lib/identity-diagnostic.mjs');
  const raw = [...life(), ...life(10, '200', 2000, 2100)];
  assert.equal(classify({ run, raw, parents: parentLife(raw), processes: [] }).maxExecutions, 1);
  const cases = [
    { raw: life().slice(0, 1) },
    { raw: [...life(), { event: 'garbage' }] },
    { parents: [] },
    { processes: [{ ...sample, argv: null }] },
    { processes: [{ ...consoleRow, parentStart: null }] },
    { processes: [{ ...sample, ppid: 9, parentStart: '90' }] },
    { processes: [{ ...sample, t: 1300 }] },
    { processes: [{ ...sample, exe: '/different-node' }] },
    { processes: [{ ...sample, commitKb: -1 }] },
    { processes: [{ ...consoleRow, role: 'other' }], raw: [], parents: [] },
    { parents: parentLife(life()).map((r) => ({ ...r, parentStart: '51' })) },
    { processes: [sample, consoleRow, { ...consoleRow, pid: 12 }] },
  ];
  for (const change of cases) {
    const result = classify({ run, raw: life(), parents: parentLife(life()), processes: [sample], ...change });
    assert.equal(result.valid, false, JSON.stringify(change));
    assert.equal(result.maxExecutions, null);
    assert.equal(result.executionRed, null);
  }
});

test('diagnostic writer is bounded, allowlisted and makes overflow visible', async () => {
  const { appendRecord, readRecords, LIMITS } = await import('./lib/identity-diagnostic.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'identity-diag-'));
  try {
    const path = join(dir, 'records.jsonl');
    appendRecord(path, { event: 'invalid', run: 'control', t: 1, reason: 'missing-identity', env: { SECRET: 'never-copy-this' } });
    assert.doesNotMatch(readFileSync(path, 'utf8'), /SECRET|never-copy/);
    for (let i = 0; i < 100; i++) appendRecord(path, { event: 'invalid', run: 'control', t: i, reason: 'missing-identity' }, { maxBytes: 512 });
    assert.ok(readFileSync(path).length <= 512);
    assert.equal(readRecords(path).valid, false);
    assert.ok(LIMITS.fileBytes <= 4 * 1024 * 1024);
    const malformed = join(dir, 'malformed.jsonl');
    writeFileSync(malformed, '{not-json}\n');
    assert.deepEqual(readRecords(malformed).problems, ['malformed-record', 'empty-record-file']);
    assert.equal(readRecords(join(dir, 'absent.jsonl')).valid, false);
    const unsafe = join(dir, 'unsafe.jsonl');
    appendRecord(unsafe, { ...sample, argv: [...argv, '--token=fixture-secret'], env: 'fixture-secret', label: 'Bearer fixture-secret' });
    assert.doesNotMatch(readFileSync(unsafe, 'utf8'), /fixture-secret|Bearer/);
    assert.equal(JSON.parse(readFileSync(unsafe, 'utf8')).argv, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
