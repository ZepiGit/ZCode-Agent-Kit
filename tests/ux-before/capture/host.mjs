// Host-specific helpers of the UX capture (capture.mjs), kept pure and
// platform-injectable so their Windows behaviour is tested on Linux
// (tests/ux-before-capture.test.mjs). Path normalisation, tar and clone
// arguments on POSIX are those of the original Phase 1C capture.
import { posix, win32 } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The Bun the fixtures run. POSIX: a symlink of fixed length,
 * `<tmp>/ux-bun-XXXXXX/bun`, to the host's Bun. The kit prints the path of
 * the Bun it runs (doctor's `bun available` row), and an 80-column TTY wraps
 * that row by the real path's length before normalise() writes `<BUN>`: Bun
 * under a long host directory put `(1.4.2)` on a continuation line where the
 * CI runner's ~/.bun/bin/bun printed one line (ticket 40, run 42590699086).
 * Windows: the host's path as found (symlinks need rights there, and its
 * pipe/ci variants never wrap a row).
 */
export function pinBun(host, { windows = false, tmp, mkdtemp, symlink }) {
  if (windows) return host;
  const pinned = posix.join(mkdtemp(posix.join(tmp, "ux-bun-")), "bun");
  symlink(host, pinned);
  return pinned;
}

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

/** Variables the capture never passes to a fixture (terminal, colour, proxy and kit settings of the host). */
const HOST_ONLY = /^(ZCODE_|CAPTCHA_|NO_COLOR$|FORCE_COLOR$|CLICOLOR|CI$|COLUMNS$|LINES$|TERM$|NODE_OPTIONS$|HTTPS?_PROXY$|ALL_PROXY$)/i;
/**
 * Windows only: the variables the fixture sets itself (case-insensitive
 * names), and the MSYS/Git Bash shell state a `shell: bash` step leaks into
 * child processes. Under that state git.exe crashed with 0xC0000005 in the
 * fixture `git clone` (CI, branch staging/06).
 */
const WIN_DROP = /^(PATH|TEMP|TMP|MSYSTEM|MSYSTEM_[A-Z0-9_]+|MSYS|MSYS2_[A-Z0-9_]+|MINGW_[A-Z0-9_]+|CHERE_INVOKING|EXEPATH|ORIGINAL_PATH|ORIGINAL_TEMP|ORIGINAL_TMP|SHLVL|PWD|OLDPWD|SHELL|ACLOCAL_PATH|PKG_CONFIG_PATH|MANPATH|INFOPATH|PLINK_PROTOCOL|_)$/i;

/**
 * The host environment a fixture inherits before the capture adds its own
 * values. POSIX: the original filter. Windows: also without WIN_DROP.
 */
export function fixtureBaseEnv(env, { windows = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (HOST_ONLY.test(k)) continue;
    if (windows && WIN_DROP.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The directory of git for a Windows fixture PATH. Git for Windows ships
 * `cmd\git.exe`, a launcher that sets up its own runtime; a `shell: bash`
 * step puts the raw `mingw64\bin\git.exe` (or `usr\bin`, `bin`) first. A
 * git.exe inside a Git for Windows tree maps to that tree's `cmd`; a git.exe
 * elsewhere is used as found.
 */
export function windowsGitDir(pathValue, { exists }) {
  for (const dir of String(pathValue ?? "").split(";")) {
    if (!dir || !exists(win32.join(dir, "git.exe"))) continue;
    const trimmed = dir.replace(/[\\/]+$/, "");
    const root = trimmed.replace(/[\\/](?:(?:mingw64|mingw32|clangarm64|usr)[\\/]bin|bin|cmd)$/i, "");
    const launcher = win32.join(root, "cmd");
    if (root !== trimmed && exists(win32.join(launcher, "git.exe"))) return launcher;
    return dir;
  }
  return null;
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

