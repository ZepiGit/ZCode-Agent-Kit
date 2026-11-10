// Snapshot harness (spec Testing Decisions, seam 5): renders records through
// the output module with FORCED capabilities, so every C3 variant is
// deterministic on every OS leg without a pty, and compares the bytes
// (ANSI included) with committed snapshot files.
//
// - Snapshot files live under tests/snapshots/ and are exempt from line-ending
//   conversion (.gitattributes `-text`), so a Windows checkout compares the
//   same bytes.
// - Normalisation is the explicit list NORMALISE (paths, ports, PIDs, times,
//   versions). It never masks status words, exit codes or the check grammar.
// - Snapshots are written only with UPDATE_SNAPSHOTS=1. Otherwise a missing or
//   different snapshot fails. (CI's refusal of UPDATE_SNAPSHOTS is ticket 55.)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createOutput } from "../lib/term/out.mjs";
import { fakeClock } from "./term-fixtures.mjs";

export const SNAPSHOT_ROOT = join(import.meta.dirname, "snapshots");

const UTF8 = { TERM: "xterm-256color", LANG: "C.UTF-8" };

/**
 * The C3 variants (spec §18 UX): TTY colour at 80 and 120 columns, NO_COLOR,
 * pipe, TERM=dumb, CI, the ascii tier and the wgl4 tier. Each is a terminal
 * the capability record classifies by itself: a fake stream plus env and platform.
 */
export const C3_VARIANTS = Object.freeze({
  "tty-color-80": { tty: true, columns: 80, env: UTF8, platform: "linux" },
  "tty-color-120": { tty: true, columns: 120, env: UTF8, platform: "linux" },
  "no-color": { tty: true, columns: 80, env: { ...UTF8, NO_COLOR: "1" }, platform: "linux" },
  "pipe": { tty: false, env: UTF8, platform: "linux" },
  "term-dumb": { tty: true, columns: 80, env: { TERM: "dumb", LANG: "C.UTF-8" }, platform: "linux" },
  "ci": { tty: false, env: { TERM: "dumb", CI: "true", LANG: "C.UTF-8" }, platform: "linux" },
  "ascii": { tty: true, columns: 80, env: { TERM: "xterm-256color", LANG: "C" }, platform: "linux" },
  "wgl4": { tty: true, columns: 80, env: {}, platform: "win32" },
});

/** Variants with colour off: no escape sequence may appear in any render (Story 107). */
export const COLOURLESS_VARIANTS = Object.freeze(["no-color", "pipe", "term-dumb", "ci"]);

function fakeStream(isTTY, columns) {
  const chunks = [];
  return { isTTY, columns: isTTY ? columns : undefined, write(chunk) { chunks.push(String(chunk)); return true; }, text: () => chunks.join("") };
}

/** Render `drive(out, clock)` in one C3 variant; returns both streams as strings. */
export function renderVariant(variant, drive, { json = false } = {}) {
  const v = C3_VARIANTS[variant];
  if (!v) throw new Error(`unknown C3 variant ${variant}`);
  const stdout = fakeStream(v.tty, v.columns);
  const stderr = fakeStream(v.tty, v.columns);
  const clock = fakeClock();
  const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform, json, clock });
  drive(out, clock);
  return { stdout: stdout.text(), stderr: stderr.text() };
}

/**
 * renderVariant for a driver that awaits (a command module streaming its
 * progress through `out.step` before its records are rendered).
 */
export async function renderVariantAsync(variant, drive, { json = false } = {}) {
  const v = C3_VARIANTS[variant];
  if (!v) throw new Error(`unknown C3 variant ${variant}`);
  const stdout = fakeStream(v.tty, v.columns);
  const stderr = fakeStream(v.tty, v.columns);
  const clock = fakeClock();
  const out = createOutput({ stdout, stderr, env: v.env, platform: v.platform, json, clock });
  await drive(out, clock);
  return { stdout: stdout.text(), stderr: stderr.text() };
}

/**
 * Explicit normalisation list: [name, pattern, replacement]. Only values that
 * differ per machine or run; status words, exit codes and the check grammar
 * are never touched (pinned by tests/term-snapshots.test.mjs).
 */
export const NORMALISE = Object.freeze([
  ["temp path", /(?:\/tmp|\/var\/folders\/[^/\s]+\/[^/\s]+\/T|[A-Za-z]:\\Users\\[^\\\s]+\\AppData\\Local\\Temp)[\\/][^\s"'`)]+/g, "<TMP>"],
  ["home path", /(?:\/home|\/Users|[A-Za-z]:\\Users)[\\/][^\s"'`)]+/g, "<HOME>"],
  ["loopback port", /\b(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\b/g, "$1:<PORT>"],
  ["pid", /\bpid (?!<)\d+/g, "pid <PID>"],
  ["ISO time", /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<TS>"],
  ["duration", /\b\d+(?:\.\d+)?ms\b/g, "<MS>ms"],
  // Three dotted numbers, not part of a longer dotted run (so 127.0.0.1 is no version).
  ["version", /(?<![\w.])v?\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?![\w.]*\d)/g, "<VERSION>"],
]);

export const normaliseSnapshot = (text) => NORMALISE.reduce((s, [, re, to]) => s.replace(re, to), text);

/**
 * Compare `actual` bytes with tests/snapshots/<rel>. With UPDATE_SNAPSHOTS=1 a
 * missing or different snapshot is (re)written; otherwise it fails.
 */
export function matchSnapshot(rel, actual, { root = SNAPSHOT_ROOT, env = process.env } = {}) {
  const file = join(root, rel);
  const bytes = Buffer.from(actual, "utf8");
  const update = env.UPDATE_SNAPSHOTS === "1";
  if (!existsSync(file)) {
    if (!update) assert.fail(`snapshot missing: ${rel} (review the render, then write it with UPDATE_SNAPSHOTS=1)`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return "written";
  }
  const stored = readFileSync(file);
  if (Buffer.compare(stored, bytes) === 0) return "match";
  if (update) { writeFileSync(file, bytes); return "updated"; }
  const a = stored.toString("utf8").split("\n"), b = actual.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  assert.fail(`snapshot differs: ${rel} line ${at + 1}\n  stored: ${JSON.stringify(a[at])}\n  actual: ${JSON.stringify(b[at])}`);
}
