export type EventLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export const EVENT_LEVELS: readonly EventLevel[];
export const REDACTED: "<redacted>";

export interface EventLineInput {
  time?: Date;
  level: EventLevel;
  component: string;
  message: string;
  fields?: Record<string, unknown>;
  /** Exact secret values to mask (the proxy key, a stop token). */
  secrets?: Iterable<string | null | undefined>;
}

/** `ISO-time LEVEL component message key=value…`, redacted, no trailing newline. */
export function formatEventLine(event: EventLineInput): string;

/** Mask secrets in a line of any format; secret-free lines come back byte-identical. */
export function redactLine(text: string, secrets?: Iterable<string | null | undefined>): string;

export type EventMethod = (message: string, fields?: Record<string, unknown>) => string;

export interface EventLogger {
  debug: EventMethod;
  info: EventMethod;
  warn: EventMethod;
  error: EventMethod;
}

export function createEventLogger(options: {
  component: string;
  write?: (line: string) => void;
  now?: () => Date;
  secrets?: () => Iterable<string | null | undefined>;
}): EventLogger;
