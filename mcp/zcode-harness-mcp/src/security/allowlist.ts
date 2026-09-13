/**
 * Workspace allowlist plus safe path resolution (symlink/junction aware).
 *
 * No bridge operation may touch paths outside an explicitly allowlisted
 * workspace root (or the bridge data dir). This module performs no process
 * execution at all — only filesystem metadata reads.
 */
import fs from "node:fs";
import path from "node:path";

export class PathDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathDeniedError";
  }
}

/** Best-effort realpath; returns the resolved input when it does not exist yet. */
export function resolveReal(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export function normalizeWorkspacePath(p: string): string {
  const resolved = path.resolve(p);
  // Windows: normalize drive letter case and drop trailing separators.
  let out = resolved.replace(/[\\/]+$/, "");
  if (/^[a-z]:/.test(out)) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

function segmentsOf(p: string): string[] {
  return p.split(/[\\/]+/);
}

/** Boundary check between two normalized absolute paths, segment by segment. */
export function isWithinRoot(child: string, root: string): boolean {
  const a = segmentsOf(child);
  const b = segmentsOf(root);
  if (a.length < b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class WorkspaceAllowlist {
  private readonly entries: string[] = [];

  constructor(paths: Iterable<string>) {
    for (const p of paths) this.entries.push(normalizeWorkspacePath(resolveReal(p)));
  }

  /** Returns the canonical workspace path when allowed, otherwise null. */
  check(candidate: string): string | null {
    const norm = normalizeWorkspacePath(candidate);
    for (const entry of this.entries) {
      if (isWithinRoot(norm, entry)) return norm;
    }
    return null;
  }

  /** Throws PathDeniedError when not allowed; returns the canonical path. */
  enforce(candidate: string): string {
    const ok = this.check(candidate);
    if (ok === null) {
      throw new PathDeniedError(
        `workspace "${candidate}" is not in the bridge allowlist. Configured roots: ${
          this.entries.join("; ") || "(none)"
        }`
      );
    }
    return ok;
  }

  list(): string[] {
    return [...this.entries];
  }

  add(candidate: string): string {
    const norm = normalizeWorkspacePath(resolveReal(candidate));
    if (!this.entries.includes(norm)) this.entries.push(norm);
    return norm;
  }
}

/**
 * Resolve a sub-path under a workspace root, refusing escapes (including via
 * symlinked segments once the path exists).
 */
export function resolveInsideWorkspace(workspacePath: string, subPath: string): string {
  const root = resolveReal(workspacePath);
  const abs = path.resolve(root, subPath);
  const realAbs = resolveReal(abs);
  if (!isWithinRoot(normalizeWorkspacePath(realAbs), normalizeWorkspacePath(root))) {
    throw new PathDeniedError(`path escapes workspace: ${subPath}`);
  }
  return realAbs;
}
