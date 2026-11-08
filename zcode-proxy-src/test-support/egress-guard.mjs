// Egress guard for the proxy test run (ticket 76).
//
// Tests use fixtures and loopback mocks only (B2, C6). This module blocks and
// records every connection attempt to a host outside loopback, in whichever
// runtime loads it: the `bun test` process (through egress-guard-preload.ts),
// its workers (injected `preload`), Bun child processes (`BUN_OPTIONS
// --preload`) and Node child processes (`NODE_OPTIONS --import`).
//
// Loopback is 127.0.0.0/8, ::1 (also IPv4-mapped 127.x) and `localhost`.
// Unix sockets and named pipes are local IPC and pass. A blocked attempt
// never opens a socket: fetch rejects, a socket is destroyed with the error,
// Bun.connect rejects and the WebSocket constructor throws. Each attempt is
// appended as one JSON line to $ZCODE_EGRESS_GUARD_LOG (when set) and kept in
// memory; the test preload turns those lines into test failures.
//
// Plain JavaScript on purpose: Node loads it too, without a TypeScript step.

import { appendFileSync } from "node:fs";
import net from "node:net";
import { isMainThread } from "node:worker_threads";

export const EGRESS_GUARD_LOG_ENV = "ZCODE_EGRESS_GUARD_LOG";
export const EGRESS_BLOCKED_CODE = "EGRESS_BLOCKED";
export const GUARD_MODULE_URL = import.meta.url;

const STATE = Symbol.for("zcode.egressGuard.state");

export class EgressBlockedError extends Error {
  constructor(record) {
    super(`egress guard: blocked ${record.transport} connection to ${record.host}:${record.port} (tests may reach loopback only)`);
    this.name = "EgressBlockedError";
    this.code = EGRESS_BLOCKED_CODE;
    this.record = record;
  }
}

function stripBrackets(host) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** True for 127.0.0.0/8, ::1, ::ffff:127.x.y.z and `localhost` (any case, trailing dot allowed). */
export function isLoopbackHost(host) {
  if (typeof host !== "string" || host === "") return false;
  let h = stripBrackets(host.trim().toLowerCase());
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h === "localhost") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) h = mapped[1];
  if (net.isIPv4(h)) return h.split(".")[0] === "127";
  if (net.isIPv6(h)) {
    // Every spelling of ::1 (0:0:0:0:0:0:0:1, ::0:1, ...).
    const groups = expandIPv6(h);
    return groups !== null && groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
  }
  return false;
}

function expandIPv6(h) {
  const parts = h.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail];
  if (all.length !== 8) return null;
  return all.map((g) => parseInt(g, 16));
}

function defaultPort(protocol) {
  return { "http:": 80, "ws:": 80, "https:": 443, "wss:": 443 }[protocol] ?? 0;
}

/** URL for the record: no userinfo and no query, so nothing secret-shaped is written. */
function safeTarget(url) {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function callerStack() {
  const lines = String(new Error().stack ?? "").split("\n").slice(1).map((l) => l.trim());
  return lines
    .filter((l) => l.startsWith("at ") && !l.includes("egress-guard") && !l.includes("(native") && !/\bat (?:native|node:|internal:)/.test(l))
    .slice(0, 12);
}

function state() {
  return globalThis[STATE];
}

/**
 * Records one attempt and returns the error that the hook hands to the caller.
 * Never throws: a broken log path must not let the connection through.
 */
function block(transport, host, port, target) {
  const record = {
    transport,
    host: String(host),
    port: Number(port) || 0,
    target,
    runtime: typeof Bun !== "undefined" ? "bun" : "node",
    thread: isMainThread ? "main" : "worker",
    pid: process.pid,
    stack: callerStack(),
  };
  const s = state();
  if (s) s.attempts.push(record);
  const log = process.env[EGRESS_GUARD_LOG_ENV];
  if (log) {
    try { appendFileSync(log, `${JSON.stringify(record)}\n`); } catch { /* the in-memory record stays */ }
  }
  return new EgressBlockedError(record);
}

/** Decision for a URL-shaped target; returns null when it may pass. */
function checkUrl(transport, input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(typeof input === "string" ? input : String(input?.url ?? input));
  } catch {
    return null; // Not a URL: the original call raises its own error.
  }
  if (["data:", "blob:", "file:", "about:"].includes(url.protocol)) return null;
  const host = stripBrackets(url.hostname);
  if (isLoopbackHost(host)) return null;
  return block(transport, host, url.port || defaultPort(url.protocol), safeTarget(url));
}

function proxyOf(init) {
  const proxy = init && typeof init === "object" ? init.proxy : undefined;
  if (typeof proxy === "string") return proxy;
  if (proxy && typeof proxy === "object" && typeof proxy.url === "string") return proxy.url;
  return undefined;
}

function guardFetchFunction(original, transport) {
  const guarded = function fetch(input, init) {
    if (!(init && typeof init === "object" && typeof init.unix === "string")) {
      const err = checkUrl(transport, input);
      if (err) return Promise.reject(err);
    }
    const proxy = proxyOf(init);
    if (proxy) {
      const err = checkUrl(`${transport} (proxy)`, proxy);
      if (err) return Promise.reject(err);
    }
    return original.call(this, input, init);
  };
  for (const key of Object.keys(original)) guarded[key] = original[key]; // fetch.preconnect
  return guarded;
}

// ---- hooks (one per transport family; each can be proven independently) ----

function hookFetch() {
  globalThis.fetch = guardFetchFunction(globalThis.fetch, "fetch");
}

/** node:net/tls/http/https/http2 (Bun and Node both connect through Socket#connect). */
function hookSocketConnect() {
  const proto = net.Socket.prototype;
  const original = proto.connect;
  proto.connect = function connect(...args) {
    let opts = args[0];
    if (Array.isArray(opts)) opts = opts[0]; // Node's internal normalized form.
    let host;
    let port;
    if (opts && typeof opts === "object") {
      if (typeof opts.path === "string" && opts.path !== "") return original.apply(this, args); // IPC
      host = opts.host ?? opts.hostname ?? "localhost";
      port = opts.port;
    } else if (typeof opts === "string" && !/^\d+$/.test(opts)) {
      return original.apply(this, args); // connect(path)
    } else {
      port = opts;
      host = typeof args[1] === "string" ? args[1] : "localhost";
    }
    if (isLoopbackHost(host)) return original.apply(this, args);
    const err = block("node:net", host, port, `tcp://${host}:${port}`);
    process.nextTick(() => this.destroy(err));
    return this;
  };
}

function hookBunConnect() {
  if (typeof Bun === "undefined") return;
  const original = Bun.connect;
  Bun.connect = function connect(options, ...rest) {
    if (options && typeof options === "object" && typeof options.unix !== "string") {
      const host = options.hostname ?? options.host ?? "localhost";
      if (!isLoopbackHost(host)) return Promise.reject(block("Bun.connect", host, options.port, `tcp://${host}:${options.port}`));
    }
    return original.call(this, options, ...rest);
  };
}

function hookWebSocket() {
  const Original = globalThis.WebSocket;
  if (typeof Original !== "function") return;
  class GuardedWebSocket extends Original {
    constructor(url, ...rest) {
      const err = checkUrl("WebSocket", url);
      if (err) throw err;
      super(url, ...rest);
    }
  }
  globalThis.WebSocket = GuardedWebSocket;
}

/** Bun workers do not inherit preloads: every new Worker loads this guard first. */
function hookWorker() {
  const Original = globalThis.Worker;
  if (typeof Bun === "undefined" || typeof Original !== "function") return;
  globalThis.Worker = class GuardedWorker extends Original {
    constructor(url, options) {
      super(url, withGuardPreload(options));
    }
  };
}

/** Adds this module to a Worker's `preload` option (Bun accepts it on both Worker classes). */
export function withGuardPreload(options) {
  const opts = options && typeof options === "object" ? { ...options } : {};
  const list = opts.preload === undefined ? [] : Array.isArray(opts.preload) ? [...opts.preload] : [opts.preload];
  if (!list.includes(GUARD_MODULE_URL)) list.unshift(GUARD_MODULE_URL);
  opts.preload = list;
  return opts;
}

export const HOOKS = Object.freeze({
  fetch: hookFetch,
  socketConnect: hookSocketConnect,
  bunConnect: hookBunConnect,
  webSocket: hookWebSocket,
  worker: hookWorker,
});

/** Installs every hook once per realm (main thread, each worker, each child). */
export function installEgressGuard() {
  if (globalThis[STATE]) return globalThis[STATE];
  const s = { attempts: [] };
  globalThis[STATE] = s;
  for (const hook of Object.values(HOOKS)) hook();
  return s;
}

/** Guarded copy of a fetch-like function (used for the builtin `undici` module). */
export function guardFetchLike(original, transport) {
  return guardFetchFunction(original, transport);
}

/** Wraps a function whose first argument is a URL or origin (undici request/stream/connect/...). */
export function guardUrlCall(original, transport) {
  return function guardedCall(target, ...rest) {
    const err = checkUrl(transport, target && typeof target === "object" && !(target instanceof URL) && typeof target.origin === "string" ? target.origin : target);
    if (err) return Promise.reject(err);
    return original.call(this, target, ...rest);
  };
}

/** Wraps a class whose constructor takes a URL (undici WebSocket/EventSource). */
export function guardUrlClass(Original, transport) {
  if (typeof Original !== "function") return Original;
  return class extends Original {
    constructor(url, ...rest) {
      const err = checkUrl(transport, url);
      if (err) throw err;
      super(url, ...rest);
    }
  };
}

/** Records the realm has made so far (this thread/process only). */
export function attemptsInThisRealm() {
  return state()?.attempts ?? [];
}

installEgressGuard();
