export declare const EGRESS_GUARD_LOG_ENV: "ZCODE_EGRESS_GUARD_LOG";
export declare const EGRESS_BLOCKED_CODE: "EGRESS_BLOCKED";
export declare const GUARD_MODULE_URL: string;

export interface EgressAttempt {
  transport: string;
  host: string;
  port: number;
  target: string;
  runtime: "bun" | "node";
  thread: "main" | "worker";
  pid: number;
  stack: string[];
}

export declare class EgressBlockedError extends Error {
  readonly code: "EGRESS_BLOCKED";
  readonly record: EgressAttempt;
  constructor(record: EgressAttempt);
}

export declare function isLoopbackHost(host: string): boolean;
export declare function withGuardPreload<T extends object | undefined>(options: T): T & { preload: string[] };
export declare const HOOKS: Readonly<Record<"fetch" | "socketConnect" | "bunConnect" | "webSocket" | "worker", () => void>>;
export declare function installEgressGuard(): { attempts: EgressAttempt[] };
export declare function guardFetchLike(original: unknown, transport: string): typeof fetch;
export declare function guardUrlCall(original: unknown, transport: string): (...args: unknown[]) => unknown;
export declare function guardUrlClass(original: unknown, transport: string): unknown;
export declare function attemptsInThisRealm(): EgressAttempt[];
