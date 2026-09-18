// Exact-version checks: only a structured registry E404 means unpublished.
// Never echo npm diagnostics, which may contain registry credentials.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

function runNpm(command, args, options) {
  // All arguments are fixed or validated numeric versions; no shell input.
  return process.platform === "win32"
    ? spawnSync([command, ...args].join(" "), { ...options, shell: true })
    : spawnSync(command, args, options);
}

function parse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

export function remoteTagCommit(version, { run = spawnSync } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("expected an exact X.Y.Z version");
  const ref = `refs/tags/v${version}`;
  const result = run("git", ["ls-remote", "--tags", "origin", ref, `${ref}^{}`], {
    encoding: "utf8", timeout: 20_000,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error("remote tag lookup failed");
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const refs = new Map();
  for (const line of lines) {
    const [sha, name] = line.split(/\s+/);
    if (!/^[a-f0-9]{40,64}$/.test(sha) || ![ref, `${ref}^{}`].includes(name)) {
      throw new Error("unexpected remote tag response");
    }
    refs.set(name, sha);
  }
  return refs.get(`${ref}^{}`) ?? refs.get(ref) ?? null;
}

export function resolveReleaseVersion(version, { head, lookup = lookupVersion, getTagCommit = remoteTagCommit } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !head) throw new Error("release selection requires version and HEAD");
  let candidate = version;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (lookup(candidate) === "missing") {
      const tag = getTagCommit(candidate);
      // Only the current version can be an exact retry: future versions would
      // require changing package.json, hence a new commit and different assets.
      if (tag === null || (candidate === version && tag === head)) return candidate;
    }
    const [major, minor, patch] = candidate.split(".");
    candidate = `${major}.${minor}.${BigInt(patch) + 1n}`;
  }
  throw new Error("no unused release version found within 100 candidates");
}

export function lookupVersion(version, { run = runNpm } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("expected an exact X.Y.Z version");
  const result = run("npm", ["view", `zcode-agent-kit@${version}`, "version", "--json",
    "--registry=https://registry.npmjs.org/", "--fetch-retries=0", "--fetch-timeout=15000"], {
    encoding: "utf8", timeout: 20_000,
  });
  if (result.error || result.signal || result.status === null) {
    throw new Error("npm registry lookup failed (process error or timeout)");
  }
  const data = parse(result.stdout);
  if (result.status === 0) {
    const exact = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (exact !== version) throw new Error("npm registry returned an unexpected version response");
    return "present";
  }
  const code = data?.error?.code ?? parse(result.stderr)?.error?.code;
  if (code === "E404") return "missing";
  const safeCode = typeof code === "string" && /^E[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN";
  throw new Error(`npm registry lookup failed (${safeCode}); refusing to treat it as unpublished`);
}

export async function verifyPublished(version, { run = runNpm, sleep = setTimeout } = {}) {
  // npm trusted publishing may take several minutes to propagate. Keep each
  // lookup bounded but allow a realistic registry window before failing.
  const attempts = 18;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (lookupVersion(version, { run }) === "present") return version;
    if (attempt < attempts) await sleep(10_000);
  }
  throw new Error(`zcode-agent-kit@${version} not visible after ${attempts} attempts`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [mode, version, ...extra] = process.argv.slice(2);
    if (!["check", "verify", "resolve"].includes(mode) || extra.length) {
      throw new Error("usage: registry-version.mjs <check|verify|resolve> X.Y.Z");
    }
    if (mode === "resolve") {
      const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 20_000 });
      if (result.status !== 0 || !/^[a-f0-9]{40,64}$/.test(result.stdout.trim())) throw new Error("cannot resolve HEAD");
      console.log(resolveReleaseVersion(version, { head: result.stdout.trim() }));
    } else {
      console.log(mode === "check" ? lookupVersion(version) : await verifyPublished(version));
    }
  } catch (error) {
    console.error(`registry-version: ${error.message}`);
    process.exitCode = 1;
  }
}
