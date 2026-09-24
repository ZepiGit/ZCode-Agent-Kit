// Self-update primitives for `zcode-kit update`.
//
// Release and npm installations carry no .git, so update cannot use git.
// Each shape follows its installer instead: a release install downloads the
// published tarball, verifies it against checksums.txt (SHA-256) and mirrors
// it over the installation while keeping machine-local state; an npm install
// is replaced by npm itself. Everything here stays dependency-free and safe
// to run against a live installation: validation happens BEFORE the first
// installation file is touched, copies run before deletes, and machine-local
// state (.proxykey, proxy/config.yaml, logs, backups, generated,
// node_modules) is never overwritten or deleted — the same protections the
// installers express with robocopy /XF /XD and rsync --exclude.

import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const GITHUB_REPO_FALLBACK = "ZepiGit/ZCode-Agent-Kit";

const PRESERVE_FILES = new Set([".proxykey", "config.yaml", ".bun-path"]);
const PRESERVE_DIRS = new Set(["node_modules", "backups", "logs", "generated", ".git"]);
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

export function stripV(tag) {
  return tag.replace(/^v/, "");
}

// Same layout rule lib/state.mjs uses for the npm state directory: the real
// package identity decides, not the path shape alone.
export function isNpmInstallRoot(root) {
  try {
    return /(?:^|[\\/])node_modules[\\/]zcode-agent-kit$/i.test(root)
      && JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name === "zcode-agent-kit";
  } catch {
    return false;
  }
}

export function detectInstallType(root) {
  if (existsSync(join(root, ".git"))) return "checkout";
  if (isNpmInstallRoot(root)) return "npm";
  return "release";
}

export function installedVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

export function repoFromPackage(root) {
  try {
    const url = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.repository?.url ?? "";
    const match = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    return match ? match[1] : GITHUB_REPO_FALLBACK;
  } catch {
    return GITHUB_REPO_FALLBACK;
  }
}

/** checksums.txt → Map<assetName, sha256hex>. Malformed lines are ignored; callers require exactly one match. */
export function parseChecksums(text) {
  const map = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match) map.set(match[2].trim(), match[1].toLowerCase());
  }
  return map;
}

export async function resolveLatestTag(repo, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "user-agent": "zcode-kit-update", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`release lookup failed (HTTP ${res.status})`);
  const body = await res.json();
  const tag = body?.tag_name;
  if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) {
    throw new Error(`latest release has an unexpected tag (${JSON.stringify(tag ?? null)})`);
  }
  return tag;
}

async function fetchBuffer(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed: ${url} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Download the release tarball plus checksums.txt and verify the archive
 * hash before anything is extracted. Throws on any mismatch.
 */
export async function downloadRelease(repo, tag, tmpDir, { fetchImpl = fetch } = {}) {
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  const archiveBuf = await fetchBuffer(`${base}/${tag}.tar.gz`, { fetchImpl });
  const checksumsBuf = await fetchBuffer(`${base}/checksums.txt`, { fetchImpl });
  const entries = [...parseChecksums(checksumsBuf.toString("utf8")).entries()]
    .filter(([name]) => name === `${tag}.tar.gz`);
  if (entries.length !== 1) {
    throw new Error(`checksums.txt must contain exactly one valid entry for ${tag}.tar.gz`);
  }
  const actual = createHash("sha256").update(archiveBuf).digest("hex");
  if (actual !== entries[0][1]) {
    throw new Error(`release archive hash mismatch\n  expected ${entries[0][1]}\n  actual   ${actual}`);
  }
  mkdirSync(tmpDir, { recursive: true });
  const archive = join(tmpDir, `${tag}.tar.gz`);
  writeFileSync(archive, archiveBuf);
  return archive;
}

/**
 * Extract a release tarball. The archive must contain exactly one top-level
 * directory; its name is not load-bearing (git-archive prefixes differ
 * between release tooling versions). Windows uses the explicit System tar —
 * a GNU tar earlier on PATH would mis-parse `-C C:\...` as a remote host.
 */
export function extractTarball(archive, outDir) {
  mkdirSync(outDir, { recursive: true });
  const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const tarExe = process.platform === "win32" && existsSync(systemTar) ? systemTar : "tar";
  const res = spawnSync(tarExe, ["-xzf", archive, "-C", outDir], { stdio: "ignore" });
  if (res.error || res.status !== 0) {
    throw new Error(`archive extraction failed${res.error ? ` (${res.error.message})` : ` (tar exit ${res.status})`}`);
  }
  const top = readdirSync(outDir);
  if (top.length !== 1 || !lstatSync(join(outDir, top[0])).isDirectory()) {
    throw new Error("unexpected archive layout: expected exactly one top-level directory");
  }
  return join(outDir, top[0]);
}

function walkTree(root, dir, files, dirs) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // release trees carry no symlinks; never follow one
    if (PRESERVE_DIRS.has(entry.name)) continue; // state trees are invisible: never copied, never deleted
    const full = join(dir, entry.name);
    const rel = full.slice(root.length + 1).split(sep).join("/");
    if (entry.isDirectory()) {
      dirs.add(rel);
      walkTree(root, full, files, dirs);
    } else if (entry.isFile()) {
      files.add(rel);
    }
  }
}

function treeSnapshot(root) {
  const files = new Set();
  const dirs = new Set();
  walkTree(root, root, files, dirs);
  return { files, dirs };
}

function skipTree(name) {
  return PRESERVE_FILES.has(name) || PRESERVE_DIRS.has(name);
}

/**
 * Mirror the extracted release over the installation. New and changed files
 * are copied first, then files the release no longer has are removed, then
 * emptied directories. Preserved names are excluded at every depth and are
 * never entered for deletion, so machine-local state survives unchanged. A
 * crash mid-mirror leaves a superset of the release (stale files linger);
 * rerunning update repairs that. Returns the op counts.
 */
export function mirrorTree(srcDir, destDir) {
  const src = treeSnapshot(srcDir);
  const dest = treeSnapshot(destDir);
  let copied = 0;
  for (const rel of src.files) {
    const source = join(srcDir, ...rel.split("/"));
    const target = join(destDir, ...rel.split("/"));
    if (PRESERVE_FILES.has(basename(target))) continue;
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    copied++;
  }
  let deleted = 0;
  for (const rel of dest.files) {
    const full = join(destDir, ...rel.split("/"));
    if (PRESERVE_FILES.has(basename(full))) continue;
    if (src.files.has(rel)) continue;
    rmSync(full);
    deleted++;
  }
  // Deepest first: a stale directory only goes when everything inside it is
  // already gone or preserved (rmdir fails on a non-empty directory).
  const byDepth = (a, b) => b.split("/").length - a.split("/").length || b.localeCompare(a);
  for (const rel of [...dest.dirs].sort(byDepth)) {
    const full = join(destDir, ...rel.split("/"));
    if (PRESERVE_DIRS.has(basename(full))) continue;
    if (src.dirs.has(rel)) continue;
    try {
      rmdirSync(full);
      deleted++;
    } catch { /* preserved content inside — the directory stays */ }
  }
  return { copied, deleted };
}
