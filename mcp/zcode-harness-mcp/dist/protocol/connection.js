import { spawnAppServer } from "../runtime/spawn.js";
import { randomUUID } from "node:crypto";
import { createLogger } from "../util/log.js";
const log = createLogger("connection");
export class ZcodeConnectionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "ZcodeConnectionError";
        this.code = code;
    }
}
/** Ids the bridge uses for its own requests (server uses "server-N" strings). */
let clientRequestCounter = 1_000_000;
export class ZcodeConnection {
    child = null;
    pending = new Map();
    buffer = "";
    opts;
    starting = null;
    exited = false;
    lastExit = null;
    /** Set when the connection received at least one server message. */
    sawTraffic = false;
    constructor(opts) {
        this.opts = opts;
    }
    get running() {
        return this.child !== null && !this.exited && this.child.exitCode === null;
    }
    get lastExitInfo() {
        return this.lastExit;
    }
    async start() {
        if (this.running)
            return;
        if (this.starting)
            return this.starting;
        this.starting = this.spawnChild().finally(() => {
            this.starting = null;
        });
        await this.starting;
    }
    async spawnChild() {
        const { harnessPath, cwd } = this.opts;
        const child = spawnAppServer({ harnessPath, cwd });
        this.exited = false;
        this.child = child;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => this.onData(chunk));
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            log.debug("harness stderr", { line: chunk.slice(0, 2000) });
        });
        child.on("exit", (code, signal) => {
            this.exited = true;
            this.lastExit = { code, signal };
            this.failAllPending(new ZcodeConnectionError("HARNESS_EXITED", `harness exited (code=${code}, signal=${signal})`));
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
        await new Promise((resolve, reject) => {
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
    failAllPending(err) {
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(err);
            this.pending.delete(id);
        }
    }
    onData(chunk) {
        this.sawTraffic = true;
        this.buffer += chunk;
        let idx;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            if (!line.trim())
                continue;
            this.handleLine(line);
        }
        // Guard against unbounded buffering on frames without a newline.
        if (this.buffer.length > 32 * 1024 * 1024) {
            this.buffer = "";
            log.error("dropped oversized incomplete frame (>32MB without newline)");
        }
    }
    handleLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch (err) {
            log.error("unparseable line from harness", { line: line.slice(0, 500), error: String(err) });
            return;
        }
        const anyMsg = msg;
        if (anyMsg.method !== undefined && anyMsg.id !== undefined) {
            // Reverse request from the server.
            const ctx = {
                method: String(anyMsg.method),
                params: anyMsg.params,
                reply: (result) => this.sendRaw({ id: anyMsg.id, result }),
                replyError: (code, message) => this.sendRaw({ id: anyMsg.id, error: { code, message } }),
            };
            try {
                this.opts.onReverseRequest?.(ctx);
            }
            catch (err) {
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
            const resp = msg;
            if (resp.error) {
                const err = new Error(`harness error ${resp.error.code}: ${resp.error.message}`);
                err.data = resp.error.data;
                err.code = resp.error.code;
                p.reject(err);
            }
            else {
                p.resolve(resp.result);
            }
            return;
        }
        log.warn("unclassifiable message", { line: line.slice(0, 300) });
    }
    sendRaw(obj) {
        if (this.child === null)
            throw new ZcodeConnectionError("NOT_RUNNING", "harness not running");
        this.child.stdin.write(JSON.stringify(obj) + "\n");
    }
    /**
     * Issue a protocol call and correlate the response. This is internal stdio
     * IPC with the harness process — not an HTTP/network request. Retries are
     * NOT automatic; callers decide, and only for clearly idempotent reads.
     */
    call(method, params, timeoutMs) {
        if (!this.running) {
            return Promise.reject(new ZcodeConnectionError("NOT_RUNNING", "harness not running"));
        }
        const id = `client-${clientRequestCounter++}`;
        const p = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new ZcodeConnectionError("TIMEOUT", `harness did not answer ${method} within ${timeoutMs ?? this.opts.requestTimeoutMs}ms`));
            }, timeoutMs ?? this.opts.requestTimeoutMs);
            this.pending.set(id, {
                resolve: resolve,
                reject,
                timer,
                method,
            });
        });
        this.sendRaw({ id, method, params: params ?? {} });
        return p;
    }
    stop() {
        const child = this.child;
        if (child === null)
            return;
        this.exited = true;
        try {
            child.stdin.end();
        }
        catch {
            /* already gone */
        }
        const killTimer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                /* ignore */
            }
        }, 3000);
        child.once("exit", () => clearTimeout(killTimer));
        try {
            child.kill();
        }
        catch {
            /* ignore */
        }
    }
    newId() {
        return randomUUID();
    }
}
