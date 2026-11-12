// OMP extension: no kit modules are imported into the long-lived host.
// Each cold/unhealthy check executes the shared preflight in a fresh native
// process, so repaired modules are picked up even when Bun caches ESM failures.
// Hosts of one installation that start together share one preflight: the host
// holding the autostart token runs it, the others wait inside their own
// process for its result (the protocol is described above singleFlight).
// TEMPLATE: setup pins the installation, native interpreter and safe messages.
import { execFile } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const ROOT = "__ZCODE_OM_ROOT__";
const KEY_FILE = "__ZCODE_OM_KEY_FILE__";
const RUNTIME = "__ZCODE_OM_RUNTIME__";
const LOG_DIR = "__ZCODE_OM_LOG_DIR__";
const HEALTH_URL = "http://127.0.0.1:__ZCODE_OM_PORT__/health";
const PREFLIGHT = ROOT + "/cli/heal.mjs";
const FAILURE_DETAILS: Record<string, string> = JSON.parse("__ZCODE_OM_FAILURE_DETAILS__");
const WARNINGS: Record<string, string> = JSON.parse("__ZCODE_OM_WARNINGS__");
// Above the manager's bounded wait: do not interrupt normal detached-child
// bookkeeping. All output is captured; -p stdout is model-only.
const START_TIMEOUT_MS = 120_000;
const HEALTH_TTL_MS = 60_000;
const PLATFORM: string = process.platform;
const TOKEN = LOG_DIR + "/omp-autostart.token";
const RESULT = LOG_DIR + "/omp-autostart.result";
const RECORD_VERSION = 1;
const MAX_BYTES = 4096, MAX_LINES = 16;
const POLL_MS = 50;
// A file at the token path that stays unreadable this long is not a token of
// this protocol (tokens are written atomically).
const FOREIGN_MS = 1000;
const MAX_CLAIM_DEPTH = 4;
// Windows: a name that another process is deleting or holds open fails with
// one of these instead of ENOENT/EEXIST. The call is retried for at most
// BUSY_MS; elsewhere these codes are permanent and are not retried.
const BUSY = ["EPERM", "EBUSY", "EACCES"];
const BUSY_MS = 1000;
// hard links are unavailable on some filesystems (FAT, some network shares)
const NO_LINK = ["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL", "EXDEV"];
// Called at every step of the token protocol (tests end the process there).
const step = (_name: string): void => {};

interface ZcodeExtensionContext {
  model?: { provider?: string };
  models?: { current?: () => { provider?: string } | undefined };
}
// A process, named so that a reused pid is not mistaken for it: `startId` is
// exact (Linux: `<boot id>:<start ticks>`), `startMs` is an upper bound (the
// process was created no later than this).
type Identity = { pid: number; startMs: number; startId?: string };
// The token and, with `child` absent, a claim on one.
type Token = { v: number; nonce: string; at: number; host: Identity; child?: Identity | null };
type Outcome = { exitCode: number; failure: string | null; causes: string[] };

const codeOf = (err: unknown) => String((err as { code?: unknown } | null)?.code ?? "");
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const sleepSync = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
// 32 hex digits: names one attempt among the hosts of an installation (an identity, not a secret).
const unique = () => { let hex = ""; while (hex.length < 32) hex += Math.random().toString(16).slice(2); return hex.slice(0, 32); };
const tempName = (path: string) => `${path}.${process.pid}.${unique().slice(0, 12)}.tmp`;

async function healthy(): Promise<boolean> {
  try {
    const key = readFileSync(KEY_FILE, "utf8").trim();
    if (!key) return false;
    const res = await fetch(HEALTH_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(800) });
    const body = await res.json() as { status?: string; provider?: string };
    return res.ok && body?.status === "ok" && body?.provider === "zai";
  } catch { return false; }
}

/** fn(), retried while it fails busy (Windows only, at most BUSY_MS); then its last error. */
function patient<T>(fn: () => T): T {
  for (let wait = 2, waited = 0; ; waited += wait, wait = Math.min(wait * 2, 50)) {
    try { return fn(); } catch (err) {
      if (PLATFORM !== "win32" || !BUSY.includes(codeOf(err)) || waited >= BUSY_MS) throw err;
      sleepSync(wait);
    }
  }
}
function discard(path: string) {
  try { patient(() => unlinkSync(path)); } catch {}
}

// A host that waits does little, with few different calls: what it runs for
// the first time is what it costs its process (measured in the memory loop).
/** A record file's text; null when it does not exist; undefined when it is larger than a record or busy. */
function readSmall(path: string): string | null | undefined {
  try {
    const text = readFileSync(path, "utf8");
    return text.length > MAX_BYTES ? undefined : text;
  } catch (err) {
    if (codeOf(err) === "ENOENT") return null;
    if (PLATFORM === "win32" && BUSY.includes(codeOf(err))) return undefined;
    throw err;
  }
}

function identity(value: unknown): Identity | null {
  const id = value as Identity | null;
  if (!id || typeof id !== "object" || !Number.isSafeInteger(id.pid) || id.pid <= 0 || !Number.isFinite(id.startMs)) return null;
  if (id.startId !== undefined && (typeof id.startId !== "string" || !/^[0-9a-f-]{1,64}:\d{1,20}$/.test(id.startId))) return null;
  return id;
}
/** A token or claim this extension can judge, or null (foreign bytes, or a newer protocol version). */
function parseToken(raw: string | null | undefined): Token | null {
  if (!raw) return null;
  try {
    const token = JSON.parse(raw) as Token;
    if (!token || token.v !== RECORD_VERSION || typeof token.nonce !== "string" || !/^[0-9a-f]{32}$/.test(token.nonce)) return null;
    if (!Number.isFinite(token.at) || !identity(token.host)) return null;
    if (token.child !== undefined && token.child !== null && !identity(token.child)) return null;
    return token;
  } catch { return null; }
}

let bootId: string | null | undefined;
/**
 * Linux: a process's state letter and `<boot id>:<start ticks>`. "gone": no
 * process has this pid. null: it cannot be read here.
 */
function procStat(pid: number): { state: string; id: string } | "gone" | null {
  try {
    if (bootId === undefined) bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
  } catch { bootId = null; }
  if (!bootId) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return /^\d+$/.test(fields[19] ?? "") ? { state: fields[0], id: `${bootId}:${fields[19]}` } : null;
  } catch (err) {
    // The entry is missing, or went away while it was read.
    return codeOf(err) === "ENOENT" || codeOf(err) === "ESRCH" ? "gone" : null;
  }
}
/** Linux: `<boot id>:<start ticks>` of a live process, or undefined. */
function startIdOf(pid: number): string | undefined {
  const stat = PLATFORM === "linux" ? procStat(pid) : null;
  return stat && stat !== "gone" ? stat.id : undefined;
}
let own: Identity | undefined;
function self(): Identity {
  if (!own) {
    const id = startIdOf(process.pid);
    own = { pid: process.pid, startMs: Math.ceil(performance.timeOrigin), ...(id ? { startId: id } : {}) };
  }
  return own;
}
function pidGone(pid: number): boolean {
  // Only "no such process" proves that; EPERM and unknown errors do not.
  try { process.kill(pid, 0); return false; } catch (err) { return codeOf(err) === "ESRCH"; }
}
/**
 * Is the process with this identity gone? "ask": a process has the pid, and
 * only its start time can tell whether it is the recorded one (startedLater).
 */
function judge(id: Identity): "live" | "gone" | "ask" {
  if (PLATFORM !== "linux") return pidGone(id.pid) ? "gone" : "ask";
  const live = procStat(id.pid);
  if (live === "gone") return "gone";
  if (!live) return pidGone(id.pid) ? "gone" : "live";
  // A zombie has exited; only its exit status is left for its parent.
  if (live.state === "Z") return "gone";
  return id.startId && live.id !== id.startId ? "gone" : "live";
}
/**
 * Windows and macOS: was the process that has this pid now created after the
 * recorded one (a reused pid)? Asks PowerShell or ps for its start time, as
 * the kit's lifecycle module does. No answer is no proof.
 */
function startedLater(id: Identity): Promise<boolean> {
  const win = PLATFORM === "win32";
  const tool = win ? "powershell" : "ps";
  const args = win ? ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${id.pid}).StartTime.ToUniversalTime().Ticks`] : ["-o", "lstart=", "-p", String(id.pid)];
  return new Promise(resolve => {
    try {
      execFile(tool, args, { env: { ...process.env, LC_ALL: "C" }, timeout: 15_000, maxBuffer: 4096, windowsHide: true, shell: false }, (err, stdout) => {
        if (err) return resolve(pidGone(id.pid));
        const text = String(stdout).trim();
        // .NET ticks count 100 ns from 0001-01-01; ps prints "Mon Sep 13 18:00:00 2026" (whole seconds).
        const ms = !win ? Date.parse(text) : /^\d{17,19}$/.test(text) ? Number((BigInt(text) - 621355968000000000n) / 10000n) : NaN;
        resolve(Number.isFinite(ms) && ms > id.startMs + 100);
      });
    } catch { resolve(false); }
  });
}
/**
 * A token or claim is stale only on proof: its host is gone and, where it
 * names one, so is the preflight that host started. Age proves nothing: a
 * preflight can outlive its host and any deadline. Where reading a start time
 * costs a process, age only decides when that question is worth asking: for a
 * record older than any attempt can be, once per process and wait.
 */
async function stale(token: Token, asked: Map<string, boolean>): Promise<boolean> {
  for (const id of [token.host, token.child]) {
    if (!id) continue;
    let verdict = judge(id);
    if (verdict === "ask") {
      if (Date.now() - token.at < START_TIMEOUT_MS) return false;
      const key = `${id.pid}:${id.startMs}`;
      if (!asked.has(key)) asked.set(key, await startedLater(id));
      verdict = asked.get(key) ? "gone" : "live";
    }
    if (verdict !== "gone") return false;
  }
  return true;
}

let linksWork = false;
/**
 * Create `path` with `text` exclusively and atomically (temp file + hard
 * link), so the path never shows a partial record. false: it exists.
 */
function createExclusive(path: string, text: string, kind: string): boolean {
  const temp = tempName(path);
  try { patient(() => writeFileSync(temp, text, { flag: "wx", mode: 0o600 })); } catch (err) {
    if (codeOf(err) !== "ENOENT") throw err;
    // The first token of this installation: its logs directory may not exist yet.
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
  }
  step(`${kind}:temp-written`);
  try {
    for (let wait = 2, waited = 0; ; waited += wait, wait = Math.min(wait * 2, 50)) {
      try { linkSync(temp, path); linksWork = true; break; } catch (err) {
        const code = codeOf(err);
        if (code === "EEXIST") return false;
        // Busy only where links are known to work; otherwise the same codes mean a filesystem without them.
        if (PLATFORM === "win32" && linksWork && BUSY.includes(code)) {
          if (waited >= BUSY_MS) throw err;
          sleepSync(wait);
          continue;
        }
        if (!NO_LINK.includes(code)) throw err;
        try { patient(() => writeFileSync(path, text, { flag: "wx", mode: 0o600 })); } catch (fallback) {
          if (codeOf(fallback) === "EEXIST") return false;
          throw fallback;
        }
        break;
      }
    }
    step(`${kind}:linked`);
  } finally { discard(temp); }
  step(`${kind}:temp-removed`);
  return true;
}

// Records this host could not delete when it was done with them (a busy
// file): path → nonce, deleted at its next attempt.
const unreleased = new Map<string, string>();
/** Delete `path` only while it holds this host's record with `nonce`. */
function release(path: string, nonce: string) {
  let left = true;
  try {
    // Gone, or a successor's: nothing of ours is left there.
    if (parseToken(readSmall(path))?.nonce === nonce) patient(() => unlinkSync(path));
  } catch (err) { left = codeOf(err) === "ENOENT"; }
  if (left) unreleased.delete(path);
  else unreleased.set(path, nonce);
}
/**
 * Remove the record at `target` whose bytes were judged stale, under an
 * exclusive claim on that record. Only the claimant deletes, and only after
 * reading the same bytes again, so a newer token is never removed. The claim
 * of a claimant that died is stale the same way and is taken over first.
 */
async function takeOver(target: string, judged: string, nonce: string, asked: Map<string, boolean>, depth = 0): Promise<boolean> {
  if (depth > MAX_CLAIM_DEPTH) return false;
  const claim = `${target}.claim-${nonce}`;
  const mine: Token = { v: RECORD_VERSION, nonce: unique(), at: Date.now(), host: self() };
  if (!createExclusive(claim, JSON.stringify(mine), "claim")) {
    const raw = readSmall(claim);
    const other = parseToken(raw);
    if (other && await stale(other, asked)) await takeOver(claim, raw as string, other.nonce, asked, depth + 1);
    return false;
  }
  try {
    if (readSmall(target) !== judged) return false;
    step("takeover:rechecked");
    try { patient(() => unlinkSync(target)); } catch (err) { if (codeOf(err) !== "ENOENT") throw err; }
    step("takeover:removed");
    return true;
  } finally {
    release(claim, mine.nonce);
    step("takeover:claim-released");
  }
}
/** While holding the token: remove what interrupted hosts left (temp files of dead processes, claims on records that are gone). */
function sweep(nonce: string) {
  let names: string[];
  try { names = readdirSync(LOG_DIR); } catch { return; }
  for (const name of names) {
    if (!name.startsWith("omp-autostart.")) continue;
    const temp = name.match(/\.(\d+)\.[0-9a-f]+\.tmp$/);
    if (temp ? pidGone(Number(temp[1])) : name.startsWith("omp-autostart.token.claim-") && !name.startsWith(`omp-autostart.token.claim-${nonce}`)) discard(`${LOG_DIR}/${name}`);
  }
}

function printCauses(causes: string[]) {
  for (const cause of causes) console.error(`[zcode-autostart] ${cause}: ${WARNINGS[cause]}`);
}
function finish(outcome: Outcome) {
  if (outcome.failure) throw { code: outcome.failure };
  printCauses(outcome.causes);
}

/**
 * Run the preflight; never rejects. With a token, the child is told which
 * attempt it belongs to, and the token names it before this host returns to
 * its event loop. The preflight does no work until it finds itself named
 * there (lib/autostart-admission.mjs), so a child whose host died in between
 * never works beside a successor's.
 */
function runPreflight(timeoutMs: number, token: Token | null): Promise<Outcome> {
  const failed = (failure: string, exitCode = 1): Outcome => ({ exitCode, failure, causes: [] });
  try {
    if (!statSync(ROOT).isDirectory() || !statSync(PREFLIGHT).isFile()) throw new Error();
  } catch { return Promise.resolve(failed("installation")); }
  const env = { ...process.env };
  if (PLATFORM === "win32") {
    const pathKey = Object.hasOwn(env, "PATH") ? "PATH" : Object.keys(env).find(key => key.toLowerCase() === "path");
    const path = pathKey ? env[pathKey] : undefined;
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    if (path !== undefined) env.PATH = path;
  }
  const args = [PREFLIGHT, "--diagnostic-code"];
  if (token) args.push(`--autostart-token=${TOKEN}`, `--autostart-nonce=${token.nonce}`);
  return new Promise(resolve => {
    let unpublished = false;
    const child = execFile(RUNTIME, args, {
      cwd: ROOT, env, timeout: timeoutMs, maxBuffer: 64 * 1024,
      windowsHide: true, shell: false, windowsVerbatimArguments: false,
    }, (err, _stdout, stderr) => {
      step("child:exited");
      if (err) {
        const code = unpublished ? "startup"
          : err.code === "ENOENT" ? "runtime-unavailable"
          : err.code === "EACCES" || err.code === "EPERM" ? "runtime-denied"
          : err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output-limit"
          : err.killed || err.code === "ETIMEDOUT" ? "timeout"
          : err.code === 3 ? "foreign" : err.code === 5 ? "key" : "startup";
        resolve(failed(code, typeof err.code === "number" && err.code > 0 && err.code < 256 ? err.code : 1));
        return;
      }
      // Never forward runtime errors, provider text, paths or credentials:
      // only exact fixed-vocabulary lines (a hung-proxy recovery and the
      // quota cause can both be reported by one preflight).
      const causes: string[] = [];
      for (const line of String(stderr).split(/\r?\n/)) {
        const cause = line.trim().match(/^\[zcode-preflight\] cause=([a-z0-9-]+)$/)?.[1];
        if (cause && Object.hasOwn(WARNINGS, cause) && causes.length < MAX_LINES) causes.push(cause);
      }
      resolve({ exitCode: 0, failure: null, causes });
    });
    if (!token || !child.pid) return;
    step("child:spawned");
    try {
      // The host's own token, which only the host changes: replaced in one rename.
      if (parseToken(readSmall(TOKEN))?.nonce !== token.nonce) throw new Error();
      const startId = startIdOf(child.pid);
      token.child = { pid: child.pid, startMs: Date.now(), ...(startId ? { startId } : {}) };
      const temp = tempName(TOKEN);
      try {
        writeFileSync(temp, JSON.stringify(token), { flag: "wx", mode: 0o600 });
        step("child:temp-written");
        patient(() => renameSync(temp, TOKEN));
      } catch (err) { discard(temp); throw err; }
      step("child:published");
    } catch {
      // The token does not name the child, so it will not run: end it now.
      unpublished = true;
      try { child.kill(); } catch {}
    }
  });
}

/** The starter's result for the hosts that waited: written on every outcome, before the token is released. */
function writeResult(token: Token, outcome: Outcome) {
  const temp = tempName(RESULT);
  try {
    const lines = outcome.failure ? [] : outcome.causes.map(cause => `cause=${cause}`);
    writeFileSync(temp, JSON.stringify({ v: RECORD_VERSION, nonce: token.nonce, host: token.host, at: Date.now(), exitCode: outcome.exitCode, lines }), { flag: "wx", mode: 0o600 });
    step("result:temp-written");
    patient(() => renameSync(temp, RESULT));
    step("result:published");
  } catch { discard(temp); }
}
/**
 * The causes of the attempt this host watched when it succeeded, or null.
 * The record counts only when it carries that token's identity, is not older
 * than this host's wait, and holds nothing but exit code 0 and
 * fixed-vocabulary cause lines; anything else (missing, a failed or earlier
 * attempt's, corrupt, oversized) is no result.
 */
function readResult(watched: Token, since: number): string[] | null {
  try {
    const record = JSON.parse(readSmall(RESULT) as string);
    const host = identity(record?.host);
    if (record.v !== RECORD_VERSION || record.nonce !== watched.nonce || !host) return null;
    if (host.pid !== watched.host.pid || host.startMs !== watched.host.startMs || host.startId !== watched.host.startId) return null;
    if (!Number.isFinite(record.at) || record.at < since || record.exitCode !== 0) return null;
    if (!Array.isArray(record.lines) || record.lines.length > MAX_LINES) return null;
    const causes: string[] = [];
    for (const line of record.lines) {
      const cause = typeof line === "string" ? line.match(/^cause=([a-z0-9-]+)$/)?.[1] : undefined;
      if (!cause || !Object.hasOwn(WARNINGS, cause)) return null;
      causes.push(cause);
    }
    return causes;
  } catch { return null; }
}

/**
 * One preflight for the hosts of this installation that start together.
 *
 * The autostart token (logs/omp-autostart.token) is created exclusively by
 * the host that will run the preflight (the starter). It names the starter
 * (pid + start identity), the attempt (a nonce) and, as soon as it is
 * spawned, the preflight process. The starter writes the result record
 * (logs/omp-autostart.result: that attempt's exit code and cause lines) and
 * only then deletes its token.
 *
 * A host that finds a token waits in-process, polling it; it starts no
 * process. When the token is gone and the result is that attempt's success,
 * the waiter prints the same cause lines and is done: it goes on with what
 * the starter goes on with, a preflight that has just succeeded. In every
 * other case (no result, a failed attempt) it takes the token itself and runs
 * its own preflight, so each host reports its own failure. A token whose starter and preflight are proven gone is removed
 * under a claim and replaced the same way. A token that is merely old is
 * never removed: the wait ends at START_TIMEOUT_MS with the timeout failure
 * and no second preflight.
 *
 * When the token cannot be used at all (an unreadable or newer-version file
 * in its place, a logs directory that cannot be written), the host runs its
 * preflight without it, as extensions before the token did; the start lock
 * still allows only one proxy.
 */
async function singleFlight(): Promise<void> {
  const since = Date.now(), deadline = since + START_TIMEOUT_MS;
  const remaining = () => Math.max(1, deadline - Date.now());
  const asked = new Map<string, boolean>();
  let watched: Token | null = null, foreignSince = 0, usable = true;
  let lastRaw: string | null | undefined = null, last: Token | null = null;
  try {
    for (const [path, nonce] of [...unreleased]) release(path, nonce);
  } catch { usable = false; }
  for (;;) {
    let pause = POLL_MS, token: Token | null = null;
    if (usable) try {
      const raw = readSmall(TOKEN);
      if (raw === null) {
        if (watched) {
          const causes = readResult(watched, since);
          watched = null;
          if (causes) return printCauses(causes);
        }
        const mine: Token = { v: RECORD_VERSION, nonce: unique(), at: Date.now(), host: self(), child: null };
        if (createExclusive(TOKEN, JSON.stringify(mine), "token")) token = mine;
        else pause = 0;
      } else {
        if (raw !== lastRaw) { lastRaw = raw; last = parseToken(raw); }
        if (last) {
          foreignSince = 0;
          watched = last;
          if (await stale(last, asked) && await takeOver(TOKEN, raw as string, last.nonce, asked)) pause = 0;
        } else {
          foreignSince ||= Date.now();
          usable = Date.now() - foreignSince < FOREIGN_MS;
        }
      }
    } catch { usable = false; }
    if (!usable) return finish(await runPreflight(remaining(), null));
    if (token) {
      let outcome: Outcome = { exitCode: 1, failure: "startup", causes: [] };
      try {
        step("token:acquired");
        sweep(token.nonce);
        outcome = await runPreflight(remaining(), token);
      } finally {
        writeResult(token, outcome);
        release(TOKEN, token.nonce);
        step("token:released");
      }
      return finish(outcome);
    }
    if (Date.now() >= deadline) throw { code: "timeout" };
    await sleep(Math.min(pause, remaining()));
  }
}

export default function (pi: {
  on: (event: string, handler: (event: unknown, ctx: ZcodeExtensionContext) => Promise<void> | void) => void;
}) {
  let pending: Promise<void> | null = null;
  let nextCheck = 0, attempted = false;
  function ensureProxy(): Promise<void> {
    if (pending) return pending;
    if (Date.now() < nextCheck) return Promise.resolve();
    pending = (async () => {
      const first = !attempted;
      attempted = true;
      try {
        if (first || !await healthy()) await singleFlight();
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        const category = typeof code === "string" && Object.hasOwn(FAILURE_DETAILS, code) ? code : "startup";
        console.error(`[zcode-autostart] ${category}: ${FAILURE_DETAILS[category]} Next zcode request after 60s may retry.`);
      }
    })().finally(() => { nextCheck = Date.now() + HEALTH_TTL_MS; pending = null; });
    return pending;
  }
  pi.on("before_provider_request", async (_event, ctx) => {
    const provider = ctx?.model?.provider ?? ctx?.models?.current?.()?.provider;
    if (provider === "zcode") await ensureProxy();
  });
}
