/**
 * ZcodeConnection — drives one real `zcode.cjs app-server --stdio` process.
 *
 * Security properties of the process launch:
 *  - The program is the fixed literal "node" (resolved by the OS from PATH;
 *    discovery verifies it up front). The only variable part is the harness
 *    script path passed as argv[0], which comes from operator configuration
 *    or verified discovery — never from model or tool output.
 *  - Argument-array spawn with `shell: false`; no command-line string is
 *    ever concatenated.
 *
 * Protocol facts (verified live against 0.16.5, see docs/PROTOCOL.md):
 *  - NDJSON: one JSON object per line, no `jsonrpc` field, no Content-Length.
 *  - Message classification by field presence: id+method = request (either
 *    direction), method only = notification, id only = response.
 *  - The server raises reverse requests with string ids like "server-1".
 *  - session/create blocks until the client answers
 *    `session/requestRuntimePreferences` (scope runtime-materialization).
 */
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnAppServer } from "../runtime/spawn.js";
import { randomUUID } from "node:crypto";
import { createLogger } from "../util/log.js";
import type { ZcodeIncomingMessage, ZcodeResponse } from "./types.js";

const log = createLogger("connection");

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface ReverseRequestContext {
  method: string;
  params: unknown;
  /** Reply with a result. */
  reply: (result: unknown) => void;
  /** Reply with a JSON-RPC-style error object. */
  replyError: (code: number, message: string) => void;
}

export interface ConnectionOptions {
  harnessPath: string;
  cwd: string;
  requestTimeoutMs: number;
  onNotification?: (method: string, params: unknown) => void;
  onReverseRequest?: (ctx: ReverseRequestContext) => void;
  onExit?: (code: number | null, signal: string | null) => void;
}

export class ZcodeConnectionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZcodeConnectionError";
    this.code = code;
  }
}

/** Ids the bridge uses for its own requests (server uses "server-N" strings). */
let clientRequestCounter = 1_000_000;

export class ZcodeConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = "";
  private opts: ConnectionOptions;
  private starting: Promise<void> | null = null;
  private exited = false;
  private lastExit: { code: number | null; signal: string | null } | null = null;
  /** Set when the connection received at least one server message. */
  public sawTraffic = false;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return this.child !== null && !this.exited && this.child.exitCode === null;
  }

  get lastExitInfo(): { code: number | null; signal: string | null } | null {
    return this.lastExit;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.starting) return this.starting;
    this.starting = this.spawnChild().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async spawnChild(): Promise<void> {
    const { harnessPath, cwd } = this.opts;
    const child = spawnAppServer({ harnessPath, cwd });
    this.exited = false;
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      log.debug("harness stderr", { line: chunk.slice(0, 2000) });
    });
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.lastExit = { code, signal };
      this.failAllPending(
        new ZcodeConnectionError("HARNESS_EXITED", `harness exited (code=${code}, signal=${signal})`)
      );
      this.child = null;
      this.opts.onExit?.(code, signal);
    });
    child.on("error", (err) => {
      log.error("harness process error", { error: String(err) });
      this.exited = true;
      this.failAllPending(new ZcodeConnectionError("HARNESS_SPAWN_FAILED", String(err)));
      this.child = null;
    });

    // The app-server emits no greeting; liveness = still running after a
    // short grace period.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), 400);
      child.once("exit", () => {
        clearTimeout(t);
        reject(new ZcodeConnectionError("HARNESS_EXITED", "harness exited during startup"));
      });
      child.once("error", (err) => {
        clearTimeout(t);
        reject(new ZcodeConnectionError("HARNESS_SPAWN_FAILED", String(err)));
      });
    });
    log.info("harness started", { pid: child.pid });
  }

  private failAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private onData(chunk: string): void {
    this.sawTraffic = true;
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      this.handleLine(line);
    }
    // Guard against unbounded buffering on frames without a newline.
    if (this.buffer.length > 32 * 1024 * 1024) {
      this.buffer = "";
      log.error("dropped oversized incomplete frame (>32MB without newline)");
    }
  }

  private handleLine(line: string): void {
    let msg: ZcodeIncomingMessage;
    try {
      msg = JSON.parse(line) as ZcodeIncomingMessage;
    } catch (err) {
      log.error("unparseable line from harness", { line: line.slice(0, 500), error: String(err) });
      return;
    }
    const anyMsg = msg as { id?: unknown; method?: unknown; params?: unknown };
    if (anyMsg.method !== undefined && anyMsg.id !== undefined) {
      // Reverse request from the server.
      const ctx: ReverseRequestContext = {
        method: String(anyMsg.method),
        params: anyMsg.params,
        reply: (result) => this.sendRaw({ id: anyMsg.id, result }),
        replyError: (code, message) => this.sendRaw({ id: anyMsg.id, error: { code, message } }),
      };
      try {
        this.opts.onReverseRequest?.(ctx);
      } catch (err) {
        log.error("reverse request handler threw", { error: String(err) });
        ctx.replyError(-32603, "bridge internal error");
      }
      return;
    }
    if (anyMsg.method !== undefined) {
      this.opts.onNotification?.(String(anyMsg.method), anyMsg.params);
      return;
    }
    if (anyMsg.id !== undefined) {
      const key = String(anyMsg.id);
      const p = this.pending.get(key);
      if (!p) {
        log.warn("response for unknown id", { id: key });
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(key);
      const resp = msg as ZcodeResponse;
      if (resp.error) {
        const err = new Error(`harness error ${resp.error.code}: ${resp.error.message}`);
        (err as Error & { data?: unknown }).data = resp.error.data;
        (err as Error & { code?: number }).code = resp.error.code;
        p.reject(err);
      } else {
        p.resolve(resp.result);
      }
      return;
    }
    log.warn("unclassifiable message", { line: line.slice(0, 300) });
  }

  private sendRaw(obj: unknown): void {
    if (this.child === null) throw new ZcodeConnectionError("NOT_RUNNING", "harness not running");
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  /**
   * Issue a protocol call and correlate the response. This is internal stdio
   * IPC with the harness process — not an HTTP/network request. Retries are
   * NOT automatic; callers decide, and only for clearly idempotent reads.
   */
  call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.running) {
      return Promise.reject(new ZcodeConnectionError("NOT_RUNNING", "harness not running"));
    }
    const id = `client-${clientRequestCounter++}`;
    const p = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ZcodeConnectionError(
            "TIMEOUT",
            `harness did not answer ${method} within ${timeoutMs ?? this.opts.requestTimeoutMs}ms`
          )
        );
      }, timeoutMs ?? this.opts.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      });
    });
    this.sendRaw({ id, method, params: params ?? {} });
    return p;
  }

  stop(): void {
    const child = this.child;
    if (child === null) return;
    this.exited = true;
    try {
      child.stdin.end();
    } catch {
      /* already gone */
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 3000);
    child.once("exit", () => clearTimeout(killTimer));
    this.failAllPending(new ZcodeConnectionError("STOPPED", "harness connection was stopped"));
  }

  newId(): string {
    return randomUUID();
  }
}
