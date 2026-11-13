/**
 * guest-error.ts — provenance test for errors thrown by third-party captcha
 * SDK code ("guest" scripts) running inside the in-process happy-dom solver.
 *
 * Under Bun the guest scripts execute in the HOST realm (happy-dom's VM
 * isolation is a no-op there), so an error escaping a guest callback reaches
 * process-level `uncaughtException` exactly like an error from our own code.
 * The two must not share a fate: a rotated pe/FeiLin bundle tripping over an
 * emulation gap must fail that one solve — the pool retries — while a genuine
 * fault in the proxy still terminates loudly.
 *
 * Opted-in `serve` installs the process boundary below; the TUI classifies
 * errors in its own handler. The TUI previously exited(1) for everything,
 * which turned a recoverable guest error into a dead proxy:
 *
 *     zcode-proxy: tui crashed: ReferenceError: moveBy is not defined
 *         at tE (https://g.alicdn.com/captcha-frontend/FeiLin/1.5.1/feilin008…js)
 *
 * Evidence is the source URL of the throwing frame: guest bundles are served
 * from Aliyun CDN/API hosts and carry those URLs in their stack frames (and,
 * for generated code, in the `//# sourceURL` we preserve when evaluating).
 *
 * Diagnostics are METADATA-ONLY (GitHub issue 32): guest error messages,
 * names and stack URLs can carry page content, tokens or account data, so
 * they are reduced to the error class, a bounded length+digest pair and the
 * bundle filename. Host errors keep their full detail (own code, own text).
 */
import { createHash } from "node:crypto";

// CDN/API hosts serving the Aliyun captcha SDK bundles. Anchored at the URL
// authority (`scheme://`, optional userinfo) and terminated by a port/path/
// delimiter, so the domain must be the real host — `evil-alicdn.com.bad.net`
// and `…?ref=alicdn.com` are not guest evidence.
const GUEST_SCRIPT_HOST =
  /https?:\/\/(?:[^/\s@]*@)?(?:[a-z0-9-]+\.)*(?:alicdn\.com|aliyuncs\.com)(?=[:/?#]|\s|$)/i;

/** Follows `cause` chains without looping on self-referential errors. */
function* errorChain(err: unknown, depth = 4): Generator<object> {
  const seen = new Set<unknown>();
  let current = err;
  for (let i = 0; i < depth; i++) {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    yield current as object;
    current = (current as { cause?: unknown }).cause;
  }
}

/**
 * True when `err` originates in third-party captcha SDK code.
 *
 * Deliberately conservative: only a guest source URL counts as evidence. A
 * missing/truncated stack yields `false`, so an unattributable error keeps the
 * strict (fatal) treatment.
 */
export function isGuestOriginError(err: unknown): boolean {
  // Compatibility export: fatality decisions must use the same actual-frame
  // evidence in TUI, headless and solver entry points, never message text.
  return hasGuestSourceFrame(err);
}

/**
 * Strict variant for process-level handlers that decide between "log and
 * continue" and "exit": only a guest source URL on an actual stack frame (or
 * the engine-attached sourceURL) counts. A host error whose MESSAGE merely
 * mentions a CDN URL stays fatal.
 */
export function hasGuestSourceFrame(err: unknown): boolean {
  return [...errorChain(err)].some((link) => {
    const e = link as { stack?: unknown; sourceURL?: unknown };
    return (typeof e.sourceURL === "string" && GUEST_SCRIPT_HOST.test(e.sourceURL)) ||
      (typeof e.stack === "string" && e.stack.split("\n").some((line) => /^\s*at\s/.test(line) && GUEST_SCRIPT_HOST.test(line)));
  });
}

let boundaryInstalled = false;

/** Headless entry points have no TUI handler for out-of-band guest callbacks. */
export function installGuestErrorBoundary(): void {
  if (boundaryInstalled) return;
  boundaryInstalled = true;
  const handle = (err: unknown): void => {
    if (hasGuestSourceFrame(err)) {
      process.stderr.write(`[captcha-guest-error] ${describeGuestError(err)}\n`);
      return;
    }
    process.stderr.write(`zcode-proxy: uncaught error: ${String(err)}\n${(err as Error)?.stack ?? ""}\n`);
    process.exit(1);
  };
  process.on("uncaughtException", handle);
  process.on("unhandledRejection", handle);
}

const ERROR_CLASSES = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);

/** Only validated bundle identifiers, never arbitrary filenames or callbacks. */
function guestBundleId(raw: string): string {
  try {
    const url = new URL(raw.replace(/:\d+(?::\d+)?$/, ""));
    const basename = (url.pathname.split("/").pop() ?? "").replace(/:\d+(?::\d+)?$/, "");
    const known = /^(AliyunCaptcha|feilin\d{0,3}|pe\.\d{1,3})(?:\.[0-9a-f]{64})?\.js$/i.exec(basename);
    // Rebuild from validated tokens; even known resources omit query/fragment.
    if (known) return `${known[1]}.js`;
    return `resource-${createHash("sha256").update(url.origin + url.pathname).digest("hex").slice(0, 16)}`;
  } catch { return "unknown"; }
}

/** One bounded metadata-only line for the log pane / stderr (GitHub issue 32). */
export function describeGuestError(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === "string" && ERROR_CLASSES.has(e.name) ? e.name : "Error";
  const message = typeof e?.message === "string" ? e.message : "";
  const digest = createHash("sha256").update(message).digest("hex");
  let source = "";
  for (const link of errorChain(err)) {
    const frame = link as { stack?: unknown; sourceURL?: unknown };
    const lines = typeof frame.stack === "string" ? frame.stack.slice(0, 8192).split("\n") : [];
    // Never select the error's message line. Strip every callback/prefix/remainder.
    const location = lines.find(line => /^\s*at\s/.test(line) && GUEST_SCRIPT_HOST.test(line));
    const raw = location?.match(/https?:\/\/[^\s)]+/i)?.[0]
      ?? (typeof frame.sourceURL === "string" && GUEST_SCRIPT_HOST.test(frame.sourceURL) ? frame.sourceURL.slice(0, 8192) : "");
    if (raw) { source = guestBundleId(raw); break; }
  }
  const metadata = `${name} [len=${message.length} sha256=${digest}]`;
  return source ? `${metadata} (${source})` : metadata;
}
