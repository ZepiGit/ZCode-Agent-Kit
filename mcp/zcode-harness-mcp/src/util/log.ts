/**
 * Minimal structured logger. Writes to stderr only — stdout is reserved for
 * the MCP transport in stdio mode.
 */
import { redactDeep } from "../security/redact.js";
import { formatEventLine, type EventLevel } from "./event-line.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = (process.env.ZCODE_HARNESS_LOG_LEVEL as LogLevel) ?? "info";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

/**
 * Logger for NEW log events: one event line per event
 * (`ISO-time LEVEL component message key=value…`, util/event-line.ts) on
 * stderr, under the same level setting as the JSON lines below.
 */
export function createEventLogger(component: string): Logger {
  const emit = (level: LogLevel, msg: string, data?: unknown): void => {
    if (LEVELS[level] < LEVELS[currentLevel]) return;
    try {
      const fields = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
      process.stderr.write(formatEventLine({ level: level.toUpperCase() as EventLevel, component, message: msg, fields }) + "\n");
    } catch {
      /* logging never throws into the caller */
    }
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
  };
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, msg: string, data?: unknown): void => {
    if (LEVELS[level] < LEVELS[currentLevel]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg,
    };
    if (data !== undefined) entry.data = data;
    let line: string;
    try {
      line = JSON.stringify(redactDeep(entry));
    } catch {
      line = JSON.stringify({ ts: entry.ts, level, scope, msg, note: "unserializable data dropped" });
    }
    process.stderr.write(line + "\n");
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
  };
}
