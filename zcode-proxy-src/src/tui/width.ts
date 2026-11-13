/**
 * Display-width helpers for TUI rendering.
 *
 * Terminal cells are monospace but East-Asian characters, fullwidth forms and
 * most emoji occupy 2 cells while combining marks occupy 0 — naive `.length`
 * math misaligns box borders the moment a log line contains CJK text (and
 * proxy errors regularly do, since upstream bodies are passed through).
 *
 * The implementation is the shared width core (`width-core.mjs`, grapheme
 * clusters + a UCD-generated W/F table), which the kit CLI uses as well.
 * This module keeps the TUI's import path stable.
 */
export { displayWidth, padEndWidth, stripAnsi, truncateToWidth } from "./width-core.mjs";
