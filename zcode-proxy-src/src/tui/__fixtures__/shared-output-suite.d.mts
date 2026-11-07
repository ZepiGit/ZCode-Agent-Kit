import type * as Core from "../width-core.mjs";
import type * as Tokens from "../tokens.mjs";

export interface WidthVector { cls: string; text: string; width: number; before: number }
export declare const WIDTH_VECTORS: WidthVector[];
export declare const CHANGED_CLASSES: Record<string, { change: string; frames: string[] }>;
export declare const TRUNCATE_VECTORS: Array<{ text: string; max: number; out: string; why: string }>;
export declare const PAD_VECTORS: Array<{ text: string; width: number; out: string }>;
export declare const EXPECTED_TOKENS: Record<string, unknown>;
export declare function sharedOutputSuite(t: {
  test: (name: string, fn: () => void) => void;
  equal: (actual: unknown, expected: unknown, message?: string) => void;
  core: typeof Core;
  tokens: typeof Tokens;
}): void;
