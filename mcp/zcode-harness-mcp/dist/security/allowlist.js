/**
 * Workspace allowlist plus safe path resolution (symlink/junction aware).
 *
 * No bridge operation may touch paths outside an explicitly allowlisted
 * workspace root (or the bridge data dir). This module performs no process
 * execution at all — only filesystem metadata reads.
 *
 * Canonicalization rule: a path is canonicalized through its nearest EXISTING
 * ancestor. A plain realpath fails for not-yet-existing leaves — but the
 * classic escape is a junction/symlinked PARENT, so the missing leaf must not
 * disable resolution (the old fallback to path.resolve enabled exactly that:
 * a new file under an outwards-pointing parent passed the check lexically).
 *
 * Residual limits, stated honestly: this is a check-then-use filesystem
 * boundary, not a sandbox. A component swapped in between resolve() and use
 * is a TOCTOU window that no userspace check fully closes; callers that write
 * should re-verify the created path afterwards where it matters.
 */
import fs from "node:fs";
import path from "node:path";
export class PathDeniedError extends Error {
    constructor(message) {
        super(message);
        this.name = "PathDeniedError";
    }
}
/** Drive-root aware split: "C:\a\b" → ["C:\\", "a", "b"], "/a/b" → ["/", "a", "b"]. */
function rootAwareSegments(abs) {
    const segs = abs.split(/[\\/]+/).filter((s) => s.length > 0);
    if (/^[A-Za-z]:$/.test(segs[0] ?? ""))
        segs[0] = segs[0] + path.sep;
    else if (abs.startsWith("/"))
        segs.unshift("/");
    else if (abs.startsWith("\\\\")) {
        // UNC: \\server\share\rest → ["\\\\server\\share", ...rest]
        const m = abs.match(/^(\\\\[^\\/]+\\[^\\/]+)(?:\\|$)/);
        const share = m?.[1];
        if (share) {
            segs.shift();
            segs.shift();
            return [share, ...segs];
        }
    }
    return segs.length ? segs : [abs];
}
/**
 * Best-effort canonical path: realpath of the nearest existing ancestor with
 * the non-existing remainder appended. Falls back to path.resolve only when
 * nothing on the chain can be resolved (e.g. a non-existing drive).
 */
export function resolveReal(p) {
    const abs = path.resolve(p);
    const segments = rootAwareSegments(abs);
    let tail = [];
    for (let i = segments.length; i >= 1; i -= 1) {
        const first = segments[0] ?? abs;
        const head = i === 1 && first.endsWith(path.sep) ? first : path.join(...segments.slice(0, i));
        try {
            const real = fs.realpathSync.native(head);
            return tail.length ? path.join(real, ...tail) : real;
        }
        catch {
            // The failed head's leaf becomes part of the unresolved remainder; the
            // drive root itself stays at index 0 and contributes no segment.
            const leaf = segments[i - 1];
            if (leaf !== undefined && (i > 1 || !first.endsWith(path.sep)))
                tail.unshift(leaf);
        }
    }
    return abs;
}
export function normalizeWorkspacePath(p) {
    const resolved = path.resolve(p);
    // Windows: normalize drive letter case and drop trailing separators.
    let out = resolved.replace(/[\\/]+$/, "");
    if (/^[a-z]:/.test(out))
        out = out.charAt(0).toUpperCase() + out.slice(1);
    return out;
}
function segmentsOf(p) {
    return p.split(/[\\/]+/);
}
/** Boundary check between two normalized absolute paths, segment by segment. */
export function isWithinRoot(child, root) {
    // NTFS/Windows default filesystems are case-insensitive; comparing
    // case-insensitively there prevents both false denials and bypasses that
    // rely on case differences resolving to the same directory.
    const norm = (s) => (process.platform === "win32" ? s.toLowerCase() : s);
    const a = segmentsOf(norm(child));
    const b = segmentsOf(norm(root));
    if (a.length < b.length)
        return false;
    for (let i = 0; i < b.length; i += 1) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
export class WorkspaceAllowlist {
    entries = [];
    constructor(paths) {
        for (const p of paths)
            this.entries.push(normalizeWorkspacePath(resolveReal(p)));
    }
    /** Returns the canonical workspace path when allowed, otherwise null. */
    check(candidate) {
        // Canonicalize through existing ancestors so a symlinked/junctioned
        // segment anywhere on the candidate path is resolved before comparing.
        const canonical = normalizeWorkspacePath(resolveReal(candidate));
        for (const entry of this.entries) {
            if (isWithinRoot(canonical, entry))
                return canonical;
        }
        return null;
    }
    /** Throws PathDeniedError when not allowed; returns the canonical path. */
    enforce(candidate) {
        const ok = this.check(candidate);
        if (ok === null) {
            throw new PathDeniedError(`workspace "${candidate}" is not in the bridge allowlist. Configured roots: ${this.entries.join("; ") || "(none)"}`);
        }
        return ok;
    }
    /** Boolean form of check() for filtering listings. */
    isAllowed(candidate) {
        try {
            return this.check(candidate) !== null;
        }
        catch {
            return false;
        }
    }
    list() {
        return [...this.entries];
    }
    add(candidate) {
        const norm = normalizeWorkspacePath(resolveReal(candidate));
        if (!this.entries.includes(norm))
            this.entries.push(norm);
        return norm;
    }
}
/**
 * Resolve a sub-path under a workspace root, refusing escapes (including via
 * symlinked segments and via not-yet-existing leaves under a symlinked
 * parent — resolveReal canonicalizes through the nearest existing ancestor).
 */
export function resolveInsideWorkspace(workspacePath, subPath) {
    const root = resolveReal(workspacePath);
    const abs = path.resolve(root, subPath);
    const realAbs = resolveReal(abs);
    if (!isWithinRoot(normalizeWorkspacePath(realAbs), normalizeWorkspacePath(root))) {
        throw new PathDeniedError(`path escapes workspace: ${subPath}`);
    }
    return realAbs;
}
