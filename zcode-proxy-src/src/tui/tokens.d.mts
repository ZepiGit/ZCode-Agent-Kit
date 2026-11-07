export type GlyphTier = "full" | "wgl4" | "ascii";
export type StatusToken = "pass" | "fail" | "warn" | "skip" | "ok" | "info" | "run" | "stop";
export type CheckWord = "PASS" | "FAIL" | "WARN" | "SKIP";
export type ActionWord = "OK" | "FAIL" | "WARN" | "SKIP" | "INFO";
export type ColourRole = "ok" | "fail" | "warn" | "info" | "accent" | "heading" | "cmd" | "muted";

export interface GlyphSet {
  readonly pass: string;
  readonly ok: string;
  readonly fail: string;
  readonly warn: string;
  readonly skip: string;
  readonly info: string;
  readonly run: string;
  readonly stop: string;
  readonly bullet: string;
  readonly separator: string;
  readonly pointer: string;
  readonly arrow: string;
  readonly ellipsis: string;
  readonly dash: string;
  readonly barFull: string;
  readonly barEmpty: string;
  readonly up: string;
  readonly down: string;
  readonly more: string;
}

export interface BoxSet {
  readonly tl: string;
  readonly tr: string;
  readonly bl: string;
  readonly br: string;
  readonly h: string;
  readonly v: string;
}

export declare const GLYPH_TIERS: readonly GlyphTier[];
export declare const WORDS: Readonly<{
  pass: "PASS"; fail: "FAIL"; warn: "WARN"; skip: "SKIP"; ok: "OK"; info: "INFO"; run: "running"; stop: "stopped";
}>;
export declare const CHECK_WORDS: readonly CheckWord[];
export declare const ACTION_WORDS: readonly ActionWord[];
export declare const GLYPHS: Readonly<Record<GlyphTier, GlyphSet>>;
export declare const BOX: Readonly<Record<GlyphTier, BoxSet>>;
export declare const SPINNER: readonly string[];
/** 16-colour SGR parameters, e.g. `"31"` for `\x1b[31m`. */
export declare const ROLES: Readonly<Record<ColourRole, string>>;
export declare const STATUS_ROLES: Readonly<Record<StatusToken, ColourRole>>;
