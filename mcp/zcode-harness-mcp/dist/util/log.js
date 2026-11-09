/**
 * Minimal structured logger. Writes to stderr only — stdout is reserved for
 * the MCP transport in stdio mode.
 */
import { redactDeep } from "../security/redact.js";
import { formatEventLine } from "./event-line.js";
let currentLevel = process.env.ZCODE_HARNESS_LOG_LEVEL ?? "info";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
export function setLogLevel(level) {
    currentLevel = level;
}
/**
 * Logger for NEW log events (ticket 14): one event line per event
 * (`ISO-time LEVEL component message key=value…`, util/event-line.ts) on
 * stderr, under the same level setting as the JSON lines below.
 */
export function createEventLogger(component) {
    const emit = (level, msg, data) => {
        if (LEVELS[level] < LEVELS[currentLevel])
            return;
        try {
            const fields = data !== null && typeof data === "object" ? data : {};
            process.stderr.write(formatEventLine({ level: level.toUpperCase(), component, message: msg, fields }) + "\n");
        }
        catch {
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
export function createLogger(scope) {
    const emit = (level, msg, data) => {
        if (LEVELS[level] < LEVELS[currentLevel])
            return;
        const entry = {
            ts: new Date().toISOString(),
            level,
            scope,
            msg,
        };
        if (data !== undefined)
            entry.data = data;
        let line;
        try {
            line = JSON.stringify(redactDeep(entry));
        }
        catch {
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
