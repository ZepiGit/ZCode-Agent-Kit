import crypto from "node:crypto";
import type { CdnEntry } from "./captcha-cdn-cache.js";
import { CaptchaSdkIncompatibleError } from "./captcha-token.js";

const hash = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");

// Only known script basenames are useful in reports. Arbitrary basenames may
// themselves contain credentials; unidentified resources get an opaque digest.
export function captchaResourceId(raw: unknown): string {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:") return "unknown";
    const basename = url.pathname.split("/").pop() ?? "";
    if (/^(?:AliyunCaptcha(?:-[\d.]+)?|feilin\d*|pe\.[\d.]+)\.js$/i.test(basename)) return basename;
    return `resource-${hash(url.origin + url.pathname).slice(0, 16)}`;
  } catch { return "unknown"; }
}

export interface ScriptMetadata {
  readonly filename: string;
  readonly originalSha256: string | null;
  readonly loadedSha256: string | null;
  readonly evaluatedSha256: string | null;
  readonly fetchedAt: number | null;
  readonly source: "network" | "memory" | "disk" | "unknown";
}
interface RequestMetadata { readonly at: number; readonly method: string; readonly filename: string; }
interface WindowDiagnostics {
  requests: RequestMetadata[];
  scripts: Map<string, ScriptMetadata>;
  loads: ScriptMetadata[];
  evaluations: ScriptMetadata[];
  lastPeUrl?: string;
}
const windows = new WeakMap<object, WindowDiagnostics>();
function state(w: object): WindowDiagnostics {
  let value = windows.get(w);
  if (!value) {
    value = { requests: [], scripts: new Map(), loads: [], evaluations: [] };
    windows.set(w, value);
  }
  return value;
}

export function beginCaptchaAttempt(w: object): void {
  const s = state(w);
  s.requests = [];
  // Loaded/evaluated code survives window reuse; activity does not. A frozen
  // snapshot held by a completed attempt cannot change as this window advances.
}
export function recordCaptchaRequest(w: object, url: string, method: string, at = Date.now()): void {
  const records = state(w).requests;
  records.push(Object.freeze({ at, method: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i.test(method) ? method : "OTHER", filename: captchaResourceId(url) }));
  if (records.length > 256) records.splice(0, records.length - 256);
}
export function lastCaptchaActivity(w: object, startedAt: number): number {
  const requests = state(w).requests;
  return requests.length ? Math.max(startedAt, requests[requests.length - 1].at) : startedAt;
}
export function lastCaptchaPeUrl(w: object): string | undefined { return state(w).lastPeUrl; }

export function recordCaptchaLoad(w: object, url: string, entry: CdnEntry, loaded: Buffer): void {
  try {
    const s = state(w);
    const metadata: ScriptMetadata = Object.freeze({
      filename: captchaResourceId(url), originalSha256: entry.sha256,
      loadedSha256: loaded === entry.body ? entry.sha256 : hash(loaded),
      evaluatedSha256: null, fetchedAt: entry.fetchedAt, source: entry.source,
    });
    s.scripts.set(url, metadata);
    s.loads.push(metadata);
    if (s.loads.length > 64) s.loads.shift();
    if (/\/dynamicJS\/.*\/pe\.[^/]+\.js(?:\?|$)/.test(url)) s.lastPeUrl = url;
    if (s.scripts.size > 64) s.scripts.delete(s.scripts.keys().next().value!);
  } catch {} // Diagnostics must never replace a network/evaluation error.
}

export function recordCaptchaEvaluation(w: object, url: unknown, evaluated: string, input = evaluated): void {
  try {
    const s = state(w);
    const loaded = s.scripts.get(String(url));
    // A compiler-generated wrapper/dynamic eval isn't necessarily the loaded
    // bundle. Only attribute retrieval provenance if the input bytes match.
    const matched = loaded && loaded.loadedSha256 === hash(input) ? loaded : undefined;
    const metadata: ScriptMetadata = Object.freeze({
      filename: captchaResourceId(url), originalSha256: matched?.originalSha256 ?? null,
      loadedSha256: matched?.loadedSha256 ?? null, evaluatedSha256: hash(evaluated),
      fetchedAt: matched?.fetchedAt ?? null, source: matched?.source ?? "unknown",
    });
    if (matched) s.scripts.set(String(url), metadata);
    s.evaluations.push(metadata);
    if (s.evaluations.length > 64) s.evaluations.shift();
  } catch {}
}

export function captchaDiagnostics(w: object) {
  const s = state(w);
  return Object.freeze({
    requests: Object.freeze(s.requests.slice()),
    scripts: Object.freeze([...s.scripts.values()]),
    loads: Object.freeze(s.loads.slice()),
    evaluations: Object.freeze(s.evaluations.slice()),
  });
}

export function captchaFailureSummary(w: object): string {
  try { return JSON.stringify(captchaDiagnostics(w)); }
  catch { return '{"metadata":"unavailable"}'; }
}

export function startCaptchaInstance(instance: unknown): void {
  const inst = instance as { startTracelessVerification?: unknown; show?: unknown } | null;
  const primary = inst?.startTracelessVerification;
  if (typeof primary === "function") { primary.call(inst); return; }
  const fallback = inst?.show;
  if (typeof fallback === "function") { fallback.call(inst); return; }
  throw new CaptchaSdkIncompatibleError(primary, fallback);
}
