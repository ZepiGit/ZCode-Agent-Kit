// Round36 Q1 only. Never imported by shipping code; no count-policy amendment.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { startOf } from './process-identity.mjs';

export const LIMITS = Object.freeze({ fileBytes: 4 * 1024 * 1024, lineBytes: 8192, records: 4096, helpersPerExecution: 1 });
const FIELDS = ['event', 'run', 't', 'pid', 'ppid', 'start', 'parentStart', 'argv', 'exe', 'role', 'rssKb', 'commitKb', 'wsPeakKb', 'label', 'reason', 'code', 'signal'];
const REASONS = new Set(['overflow', 'missing-identity', 'unavailable-argv', 'collection-failed']);
const fixture = (s) => typeof s === 'string' && /(?:^|[\\/])fake-harness\.mjs$/.test(s);
const pathOK = (s) => typeof s === 'string' && s.length <= 2048 && !/[\r\n\0]|(?:bearer|token|password|secret|credential)[=:]/i.test(s);
export function fixtureArgv(argv) {
  return Array.isArray(argv) && argv.length === 4 && pathOK(argv[0]) && fixture(argv[1]) && pathOK(argv[1]) && argv[2] === 'app-server' && argv[3] === '--stdio';
}

// Only known fixture argv or a console's numeric handles may leave the collector.
// Unknown argv is represented as null, NOT elided from the process records.
export function safeArgv(argv, exe) {
  if (fixtureArgv(argv)) return [...argv];
  if (/(?:^|[\\/])conhost\.exe$/i.test(exe ?? '') && Array.isArray(argv) && argv.length <= 8 && argv.slice(1).every((a) => /^(?:0x[\da-f]+|\d+|-ForceV1)$/i.test(a))) return [exe, ...argv.slice(1)];
  return null;
}

export function appendRecord(path, record, { maxBytes = LIMITS.fileBytes } = {}) {
  const clean = {};
  for (const field of FIELDS) if (Object.hasOwn(record, field)) clean[field] = record[field];
  for (const field of ['run', 'event', 'role', 'label', 'signal']) {
    if (clean[field] !== undefined && clean[field] !== null && (typeof clean[field] !== 'string' || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(clean[field]))) clean[field] = null;
  }
  for (const field of ['start', 'parentStart']) if (clean[field] !== undefined && !/^[1-9]\d{0,30}$/.test(String(clean[field]))) clean[field] = null;
  for (const field of ['t', 'pid', 'ppid', 'rssKb', 'commitKb', 'wsPeakKb', 'code']) if (clean[field] !== undefined && clean[field] !== null && !Number.isFinite(clean[field])) clean[field] = null;
  clean.argv = safeArgv(record.argv, record.exe);
  clean.exe = pathOK(record.exe) ? record.exe : null;
  if (clean.reason && !REASONS.has(clean.reason)) clean.reason = 'collection-failed';
  const line = JSON.stringify(clean) + '\n';
  let locked = false;
  try {
    // Multiple actual fixtures can share the raw file. A contended writer
    // invalidates diagnostics instead of racing stat+append beyond the cap.
    mkdirSync(path + '.lock', { mode: 0o700 });
    locked = true;
    if (Buffer.byteLength(line) > LIMITS.lineBytes || (existsSync(path) ? statSync(path).size : 0) + Buffer.byteLength(line) > maxBytes) {
      writeFileSync(path + '.invalid', 'overflow\n', { mode: 0o600 });
      return false;
    }
    appendFileSync(path, line, { mode: 0o600 });
    return true;
  } catch {
    // A failed write cannot be turned into an empty, apparently valid stream.
    try { writeFileSync(path + '.invalid', 'collection-failed\n', { mode: 0o600 }); } catch {}
    return false;
  } finally {
    if (locked) rmdirSync(path + '.lock');
  }
}

export function readRecords(path) {
  const problems = [], records = [];
  if (existsSync(path + '.invalid')) problems.push('collection-invalid');
  if (!existsSync(path)) return { valid: false, records, problems: [...problems, 'missing-record-file'] };
  if (statSync(path).size > LIMITS.fileBytes) return { valid: false, records, problems: [...problems, 'oversized-record-file'] };
  const text = readFileSync(path, 'utf8');
  if (!text.endsWith('\n')) problems.push('incomplete-record');
  for (const line of text.split('\n').filter(Boolean)) {
    if (records.length >= LIMITS.records || Buffer.byteLength(line) > LIMITS.lineBytes) { problems.push('record-limit'); break; }
    try { records.push(JSON.parse(line)); } catch { problems.push('malformed-record'); }
  }
  if (!records.length) problems.push('empty-record-file');
  return { valid: !problems.length, records, problems };
}

// Supplement diagnostic rows only: shipping tracker membership/roles stay intact.
// A console first seen after parent death can still be joined to an exact
// parent-observed creation identity. Ambiguous generations remain unknown.
export function windowsIdentityRows(table, selected, parents) {
  const out = [...selected], seen = new Set(selected.map((p) => p.key));
  for (const p of table) {
    const key = `${p.pid}:${p.created}`;
    if (seen.has(key) || !/(?:^|[\\/])conhost\.exe$/i.test(p.executablePath ?? '')) continue;
    const owners = parents.filter((r) => r.event === 'spawn' && r.pid === p.ppid && /^[1-9]\d*$/.test(r.start ?? '') && /^[1-9]\d*$/.test(p.created ?? '') && BigInt(r.start) <= BigInt(p.created));
    if (!owners.length) continue;
    const owner = owners.length === 1 ? owners[0] : null;
    out.push({ ...p, key, exe: p.executablePath, argv: p.commandLine ? p.commandLine.trim().split(/\s+/) : null, parentStart: owner?.start ?? null, role: 'fake-harness' });
  }
  return out;
}

export function captureProcesses(path, run, snapshots, label = 'poll') {
  const t = Date.now();
  for (const p of snapshots) {
    const start = typeof p.key === 'string' ? p.key.slice(p.key.indexOf(':') + 1) : null;
    appendRecord(path, { event: 'process', run, t, pid: p.pid, ppid: p.ppid, start, parentStart: p.parentStart ?? null, argv: p.argv, exe: p.exe, role: p.role, rssKb: p.rssKb, commitKb: p.commitKb, wsPeakKb: p.wsPeakKb, label });
  }
}

export function classifyFiles({ run, rawPath, parentPath, processPath }) {
  const [raw, parents, processes] = [rawPath, parentPath, processPath].map(readRecords);
  return classify({ run, raw: raw.records, parents: parents.records, processes: processes.records, problems: [...raw.problems, ...parents.problems, ...processes.problems] });
}

// Pure offline classifier: malformed or incomplete input invalidates the entire
// diagnostic, never the original shipping rows, roles, verdict or cleanup checks.
export function classify({ run, raw = [], parents = [], processes = [], problems: inputProblems = [] }) {
  const problems = [...inputProblems], lives = new Map(), observers = new Map();
  const key = (r) => `${r.pid}:${r.start}`;
  const validIdentity = (r) => Number.isInteger(r.pid) && r.pid > 0 && Number.isInteger(r.ppid) && r.ppid > 0 && /^[1-9]\d*$/.test(r.start ?? '') && /^[1-9]\d*$/.test(r.parentStart ?? '');
  for (const [records, events, into] of [[raw, ['start', 'exit'], lives], [parents, ['spawn', 'child-exit'], observers], [processes, ['process'], null]]) {
    if (!records.length && into) problems.push('missing-lifecycle-records');
    if (records.length > LIMITS.records) { problems.push('record-limit'); continue; }
    for (const r of records) {
      if (!r || r.run !== run || !Number.isFinite(r.t) || !validIdentity(r) || !events.includes(r.event)) { problems.push('malformed-or-missing-identity'); continue; }
      if (into) {
        if (!fixtureArgv(r.argv) || !pathOK(r.exe)) { problems.push('missing-fixture-argv'); continue; }
        const id = key(r), entry = into.get(id) ?? {};
        if (entry[r.event]) problems.push('duplicate-lifecycle-record');
        entry[r.event] = r;
        into.set(id, entry);
      }
    }
  }
  const intervals = [];
  for (const [id, l] of lives) {
    const p = observers.get(id);
    if (!l.start || !l.exit || !p?.spawn || !p?.['child-exit']) { problems.push('missing-lifecycle-pair'); continue; }
    const all = [l.start, l.exit, p.spawn, p['child-exit']];
    if (all.some((r) => r.ppid !== l.start.ppid || r.parentStart !== l.start.parentStart || JSON.stringify(r.argv) !== JSON.stringify(l.start.argv) || r.exe !== l.start.exe)) problems.push('contradictory-lifecycle');
    if (l.exit.t < l.start.t || p['child-exit'].t < l.exit.t || p['child-exit'].t < p.spawn.t) problems.push('contradictory-time');
    intervals.push({ id, from: Math.min(l.start.t, p.spawn.t), until: p['child-exit'].t });
  }
  for (const id of observers.keys()) if (!lives.has(id)) problems.push('missing-raw-lifecycle');
  const groups = new Map(), ancestry = new Map();
  for (const r of processes) {
    if (!r || !validIdentity(r)) continue;
    const id = key(r), previous = ancestry.get(id);
    if (previous && (previous.ppid !== r.ppid || previous.parentStart !== r.parentStart)) problems.push('contradictory-ancestry');
    ancestry.set(id, r);
    if (!groups.has(r.t)) groups.set(r.t, []);
    groups.get(r.t).push(r);
  }
  let maxConsoleSupport = 0, originalProcessCount = 0, fixturePeakCommitKb = 0, fixturePeakRssKb = 0, kitConsolePeakCommitKb = 0, kitConsolePeakRssKb = 0;
  const cleanupFailures = [];
  for (const rows of groups.values()) {
    let helpers = 0, fixtureCommit = 0, fixtureRss = 0, kitCommit = 0, kitRss = 0;
    const helperCounts = new Map();
    originalProcessCount = Math.max(originalProcessCount, rows.length);
    for (const r of rows) {
      if (![r.rssKb, r.commitKb ?? 0, r.wsPeakKb ?? 0].every((v) => Number.isFinite(v) && v >= 0)) problems.push('missing-footprint');
      if (r.role === 'fake-harness') { fixtureCommit += r.commitKb ?? 0; fixtureRss += r.rssKb ?? 0; }
      const console = /(?:^|[\\/])conhost\.exe$/i.test(r.exe ?? '');
      if (!pathOK(r.exe)) problems.push('missing-executable');
      if (!console && r.role === 'fake-harness') {
        const l = lives.get(key(r)), p = observers.get(key(r));
        if (!fixtureArgv(r.argv) || !l?.start || !l.exit || !p?.spawn || !p['child-exit']) problems.push('unproved-fixture-process');
        else if (r.ppid !== l.start.ppid || r.parentStart !== l.start.parentStart || r.exe !== l.start.exe || JSON.stringify(r.argv) !== JSON.stringify(l.start.argv) || r.t < p.spawn.t || r.t > p['child-exit'].t) problems.push('contradictory-process-lifecycle');
      }
      if (console) {
        if (/^(?:after-exit|after-bridge-stop|orphans)/.test(r.label ?? '')) cleanupFailures.push(key(r));
        const parentId = `${r.ppid}:${r.parentStart}`, l = lives.get(parentId);
        const knownParent = ancestry.get(parentId);
        if (!safeArgv(r.argv, r.exe) || (!l?.start && !knownParent) || BigInt(r.start) < BigInt(r.parentStart)) problems.push('unproved-console-ancestry');
        if (l?.start) {
          if (r.role !== 'fake-harness') { fixtureCommit += r.commitKb ?? 0; fixtureRss += r.rssKb ?? 0; }
          helpers++;
          helperCounts.set(parentId, (helperCounts.get(parentId) ?? 0) + 1);
          if (r.t >= l.exit?.t || /^(?:after-exit|after-bridge-stop|orphans)/.test(r.label ?? '')) cleanupFailures.push(key(r));
        } else if (knownParent && knownParent.role !== 'fake-harness') { kitCommit += r.commitKb ?? 0; kitRss += r.rssKb ?? 0; }
        else problems.push('unproved-console-owner');
      }
    }
    if ([...helperCounts.values()].some((n) => n > LIMITS.helpersPerExecution)) problems.push('helper-limit');
    maxConsoleSupport = Math.max(maxConsoleSupport, helpers);
    fixturePeakCommitKb = Math.max(fixturePeakCommitKb, fixtureCommit);
    fixturePeakRssKb = Math.max(fixturePeakRssKb, fixtureRss);
    kitConsolePeakCommitKb = Math.max(kitConsolePeakCommitKb, kitCommit);
    kitConsolePeakRssKb = Math.max(kitConsolePeakRssKb, kitRss);
  }
  let maxExecutions = 0;
  for (const l of intervals) maxExecutions = Math.max(maxExecutions, intervals.filter((o) => o.from <= l.from && o.until > l.from).length);
  const valid = problems.length === 0;
  return { diagnosticOnly: true, valid, problems: [...new Set(problems)], maxExecutions: valid ? maxExecutions : null, executionRed: valid ? maxExecutions > 1 : null, maxConsoleSupport, helperLimit: LIMITS.helpersPerExecution, originalProcessCount, fixturePeakCommitKb, fixturePeakRssKb, kitConsolePeakCommitKb, kitConsolePeakRssKb, cleanupRed: cleanupFailures.length > 0, cleanupFailures: [...new Set(cleanupFailures)], windowsProof: 'pending-real-Windows-run' };
}

// OS creation identity, never Date.now() presented as an OS start time.
export function liveRecord(pid, ppid, { event, run, argv, exe = argv?.[0] } = {}) {
  try {
    const start = startOf(pid), parentStart = startOf(ppid);
    return { event, run, t: Date.now(), pid, ppid, start, parentStart, argv, exe };
  } catch {
    return { event: 'invalid', run, t: Date.now(), pid, ppid, reason: 'missing-identity' };
  }
}
