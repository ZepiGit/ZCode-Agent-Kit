// Host-specific helpers of the UX capture (capture.mjs), kept pure and
// platform-injectable so their Windows behaviour is tested on Linux
// (tests/ux-before-capture.test.mjs). Path normalisation, tar and clone
// arguments on POSIX are those of the original Phase 1C capture.
import { win32 } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * How a Bun script given a directory should import from it: a file URL, on
 * every platform. A drive path is not a portable import specifier, and in
 * source text or a specifier a backslash is an escape (Windows `D:\a\_temp`,
 * or a POSIX directory named `k\ux-base`). The specifier never appears in a
 * captured output (the BEFORE set has no `<PROXY_SRC>` or REAL_PROXY_SRC line),
 * so this changes no capture.
 */
export function importBase(dir, { windows = false } = {}) {
  return pathToFileURL(dir, { windows }).href;
}

/**
 * The fixture proxy source: the template's `"__REAL_PROXY_SRC__"` literal
 * becomes a JSON string literal of importBase(proxySrcDir). The original
 * pasted the raw path between the quotes, so `D:\a\_temp\ux-base` was read as
 * the escapes `\a`, `\_`, `\u…` (CI run 42236936458).
 */
export function fakeProxySource(template, proxySrcDir, { windows = false } = {}) {
  if (!template.includes('"__REAL_PROXY_SRC__"')) throw new Error("fake-proxy template lost its __REAL_PROXY_SRC__ literal");
  return template.replace('"__REAL_PROXY_SRC__"', () => JSON.stringify(importBase(proxySrcDir, { windows })));
}

/**
 * The tar binary for building fixture archives. Windows: System32's bsdtar.
 * Git for Windows puts GNU tar first on PATH in a bash step, and GNU tar reads
 * `C:\…` as a remote host named "C" ("Cannot connect to C: resolve failed").
 */
export function tarBinary({ windows = false, env = {} } = {}) {
  return windows ? win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

/**
 * Arguments for cloning a fixture repository. Windows adds --no-local: the
 * fixture tree holds junctions, and the pack transport avoids git's local
 * copy/hardlink path for them. POSIX keeps the original arguments.
 */
export function cloneArgs(args, { windows = false } = {}) {
  return windows ? ["clone", "--no-local", ...args.slice(1)] : args;
}

/**
 * The spellings of a path that may appear in output, longest first. POSIX:
 * the path itself (the original normalisation). Windows: the path and its
 * long-name realpath, each also JSON-escaped, with forward slashes and with a
 * lower-case drive letter.
 */
export function pathForms(p, { windows = false, realpath = (x) => x } = {}) {
  if (!windows) return [p];
  const bases = new Set([p]);
  try { bases.add(realpath(p)); } catch { /* not on disk */ }
  const forms = new Set();
  for (const b of bases) {
    for (const v of [b, b.replace(/^[A-Z]:/, (d) => d.toLowerCase())]) {
      forms.add(v);
      forms.add(v.replace(/\\/g, "\\\\"));
      forms.add(v.replace(/\\/g, "/"));
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Replace every spelling of `p` in `text` by `token`. */
export function swapPath(text, p, token, opts) {
  return pathForms(p, opts).reduce((acc, form) => acc.split(form).join(token), text);
}

/** Describe a failed spawnSync result completely (status, signal, error and both streams). */
export function describeFailure(label, r) {
  const parts = [`${label}: status ${r.status ?? "null"}`];
  if (r.signal) parts.push(`signal ${r.signal}`);
  if (r.error) parts.push(`error ${r.error.code ?? ""} ${r.error.message}`.trim());
  const out = String(r.stdout ?? "").trim(), err = String(r.stderr ?? "").trim();
  if (out) parts.push(`stdout: ${out.slice(-1500)}`);
  if (err) parts.push(`stderr: ${err.slice(-1500)}`);
  return parts.join("; ");
}

