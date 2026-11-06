/** Unicode version of the generated width tables (UCD EastAsianWidth, DerivedGeneralCategory, emoji-variation-sequences). */
export declare const UNICODE_VERSION: string;

/** Remove ANSI escape sequences (CSI, OSC incl. OSC 8, two-byte ESC) so the result can be measured / compared. */
export declare function stripAnsi(s: string): string;

/** Display width in terminal cells, per grapheme cluster (ANSI escape sequences count as 0). */
export declare function displayWidth(s: string): number;

/**
 * Truncate to `max` display cells at a grapheme-cluster boundary, appending
 * `ellipsis` (default `…`) when anything was cut. ANSI sequences are stripped first.
 */
export declare function truncateToWidth(s: string, max: number, ellipsis?: string): string;

/** Pad with spaces (display-width aware) so the string occupies exactly `width` cells. */
export declare function padEndWidth(s: string, width: number): string;
