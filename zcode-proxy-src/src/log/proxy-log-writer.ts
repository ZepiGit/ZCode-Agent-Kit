/**
 * The `proxy.log` writer: while it runs, the
 * proxy is the single rotator of `proxy.log`.
 *
 * - The manager sets `ZCODE_KIT_LOG_DIR` at every spawn.
 *   With it, `serve` opens `<dir>/proxy.log` through this size-capped writer;
 *   without it (TUI-hosted, standalone) nothing here runs and the output stays
 *   where it always went.
 * - Plain fd writes (`writeSync`), never a write stream: a line is in the file
 *   when `write` returns, also right before `process.exit`.
 * - Once open, console, process.stdout and process.stderr go through it, and
 *   the line content stays as it is, except that every chunk passes through
 *   `redactLine`: the stop token in the
 *   environment, the secrets added with `addSecret` and token shapes are masked.
 * - Rotation: before each write the writer checks the file's size through its
 *   own fd, so appends by other kit processes (the manager's narration) count.
 *   At 5 MB it rotates: unlink `proxy.log.1` → rename `proxy.log` →
 *   `proxy.log.1` → reopen `proxy.log`. The fd is closed before the rename, so
 *   the rename never depends on the writer's own share mode (Windows).
 * - A handle that blocks the unlink or the rename (Windows: another process
 *   holds the file without FILE_SHARE_DELETE, an editor or antivirus; the
 *   sharing violation surfaces as EPERM, EBUSY or EACCES) leaves the writer
 *   appending to the current file. It writes one WARN event line per blocked
 *   spell and retries at every check; nothing is lost.
 * - File modes: the logs directory is created `0o700`, `proxy.log` is
 *   created `0o600` on open and on every reopen, and a directory or file
 *   that already existed is set to those modes once, when the writer opens.
 *   `proxy.log.1` is the renamed file and keeps its mode.
 * - Only what goes through this writer follows a rotation. A thread or child
 *   that writes to the inherited fd 1 or 2 directly stays on the renamed file;
 *   such writers append to the log by path instead (runtime/watchdog.ts).
 * - If the file cannot be (re)opened, a chunk goes to the original stream it
 *   was written to (the inherited stdio), so it is never dropped.
 */
import { chmodSync, closeSync, fchmodSync, fstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";
import { createEventLogger, redactLine } from "./event-line.mjs";

export const PROXY_LOG_NAME = "proxy.log";
/** Rotation threshold: 5 MB. */
export const PROXY_LOG_MAX_BYTES = 5 * 1024 * 1024;

export interface ProxyLogWriter {
  /** `<dir>/proxy.log`. */
  readonly path: string;
  /** Append `text` (redacted) after the rotation check. Never throws. */
  write(text: string): void;
  /** One more exact secret to mask in every later chunk (the proxy key). */
  addSecret(secret: string | null | undefined): void;
  close(): void;
}

export interface ProxyLogWriterOptions {
  dir: string;
  /** Rotation threshold in bytes (default 5 MB). */
  maxBytes?: number;
  /** Where a chunk goes when the file cannot be opened (default: the original stderr). */
  fallback?: (text: string) => void;
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";

export function openProxyLogWriter({ dir, maxBytes = PROXY_LOG_MAX_BYTES, fallback }: ProxyLogWriterOptions): ProxyLogWriter {
  const path = join(dir, PROXY_LOG_NAME);
  const rotated = `${path}.1`;
  const secrets: string[] = [];
  const spill = fallback ?? ((text: string) => { try { originalStderrWrite(text); } catch {} });
  let fd: number | null = null;
  let blocked = false; // a blocked spell is running (its WARN line is written)

  const open = () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    fd = openSync(path, "a", 0o600);
  };
  const closeFd = () => {
    if (fd === null) return;
    try { closeSync(fd); } catch {}
    fd = null;
  };
  /** Write all of `text` to the fd, or spill it. */
  const writeRaw = (text: string) => {
    if (fd === null) {
      try { open(); } catch { spill(text); return; }
    }
    const bytes = Buffer.from(text, "utf8");
    try {
      for (let at = 0; at < bytes.length;) at += writeSync(fd!, bytes, at, bytes.length - at);
    } catch {
      closeFd();
      spill(text);
    }
  };
  const events = createEventLogger({ component: "proxy", write: (line: string) => writeRaw(`${line}\n`), secrets: () => secrets });

  const rotate = (size: number) => {
    let failure: NodeJS.ErrnoException | null = null;
    try { unlinkSync(rotated); } catch (err) { if (!isMissing(err)) failure = err as NodeJS.ErrnoException; }
    if (failure === null) {
      closeFd();
      try { renameSync(path, rotated); } catch (err) { failure = err as NodeJS.ErrnoException; }
      try { open(); } catch {} // the new file, or the current one again when the rename failed
    }
    if (failure === null) {
      blocked = false;
      return;
    }
    if (blocked) return;
    blocked = true;
    events.warn("proxy.log rotation blocked, appending and retrying at every check", {
      path, code: failure.code ?? "unknown", sizeBytes: size, limitBytes: maxBytes,
    });
  };
  const check = () => {
    if (fd === null) return;
    let size: number;
    try { size = fstatSync(fd).size; } catch { return; }
    if (size >= maxBytes) rotate(size);
  };

  open();
  // The modes given to mkdir and open apply only when the directory or the
  // file is created. A log an older kit created with the default mode is
  // tightened once, here; every file created later starts owner-only.
  try { chmodSync(dir, 0o700); } catch {}
  try { fchmodSync(fd!, 0o600); } catch {}
  return {
    path,
    write(text: string) {
      try {
        const shown = redactLine(text, secrets);
        check();
        writeRaw(shown);
      } catch {
        spill(text);
      }
    },
    addSecret(secret) {
      if (typeof secret === "string" && secret !== "" && !secrets.includes(secret)) secrets.push(secret);
    },
    close: closeFd,
  };
}

// The original stderr write, kept before routing replaces it.
const originalStderrWrite = process.stderr.write.bind(process.stderr) as (text: string) => boolean;

type WriteCallback = (err?: Error | null) => void;

/**
 * Route console, process.stdout and process.stderr through `writer`.
 * Console methods format their arguments as console does (`util.format`)
 * and end the line; stream writes keep their bytes (Buffers are decoded as
 * UTF-8, a split multi-byte character included). Returns the restore.
 */
export function routeOutputThrough(writer: ProxyLogWriter): () => void {
  const saved = {
    log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error, trace: console.trace,
    stdoutWrite: process.stdout.write, stderrWrite: process.stderr.write,
  };
  const line = (...args: unknown[]) => writer.write(`${format(...args)}\n`);
  console.log = line;
  console.info = line;
  console.debug = line;
  console.warn = line;
  console.error = line;
  console.trace = (...args: unknown[]) => writer.write(`${format("Trace:", ...args)}\n${new Error().stack?.split("\n").slice(2).join("\n") ?? ""}\n`);
  const streamWrite = () => {
    const decoder = new TextDecoder("utf-8");
    return function write(chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
      const done = (typeof encoding === "function" ? encoding : callback) as WriteCallback | undefined;
      const text = typeof chunk === "string" ? chunk
        : chunk instanceof Uint8Array ? decoder.decode(chunk, { stream: true })
        : String(chunk);
      writer.write(text);
      if (typeof done === "function") queueMicrotask(() => done(null));
      return true;
    };
  };
  process.stdout.write = streamWrite() as typeof process.stdout.write;
  process.stderr.write = streamWrite() as typeof process.stderr.write;
  return () => {
    Object.assign(console, { log: saved.log, info: saved.info, debug: saved.debug, warn: saved.warn, error: saved.error, trace: saved.trace });
    process.stdout.write = saved.stdoutWrite;
    process.stderr.write = saved.stderrWrite;
  };
}

/**
 * `serve`'s entry: with `ZCODE_KIT_LOG_DIR` set, open the writer and route
 * the process's output through it; otherwise (or when it cannot be opened)
 * null, and the output stays on the inherited stdio as before.
 */
export function startProxyLog(env: Record<string, string | undefined> = process.env): ProxyLogWriter | null {
  const dir = env.ZCODE_KIT_LOG_DIR;
  if (!dir) return null;
  let writer: ProxyLogWriter;
  try {
    writer = openProxyLogWriter({ dir });
  } catch (err) {
    const events = createEventLogger({ component: "proxy", write: (line: string) => { originalStderrWrite(`${line}\n`); } });
    events.warn("proxy.log writer unavailable; output stays on the inherited stdio", { code: (err as NodeJS.ErrnoException)?.code ?? "unknown" });
    return null;
  }
  routeOutputThrough(writer);
  return writer;
}
