/**
 * Runtime discovery: locate the real installed ZCode harness (zcode.cjs),
 * verify a usable `node` on PATH, and fingerprint the bundle. Never guesses
 * blindly — every candidate is verified by executing it read-only
 * (`zcode --version`).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnVersionProbe } from "./runtime/spawn.js";
import { createLogger } from "./util/log.js";
const log = createLogger("discovery");
function candidateHarnessPaths() {
    const out = [];
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    for (const base of [localAppData, programFiles, programFilesX86]) {
        out.push(path.join(base, "Programs", "ZCode", "resources", "glm", "zcode.cjs"));
        out.push(path.join(base, "ZCode", "resources", "glm", "zcode.cjs"));
    }
    out.push(path.join(localAppData, "zcode", "app.resources", "glm", "zcode.cjs"));
    return out;
}
export function fileFingerprint(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        return { sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16), bytes: buf.length };
    }
    catch {
        return null;
    }
}
function runVersion(harnessPath, timeoutMs = 20_000) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };
        try {
            const child = spawnVersionProbe(harnessPath);
            let out = "";
            child.stdout?.on("data", (d) => {
                out += d.toString("utf8");
            });
            child.stderr?.on("data", () => { });
            child.on("error", () => done(null));
            child.on("exit", () => {
                const m = out.match(/zcode\s+(\d+\.\d+\.\d+[^\s]*)/i) ?? out.match(/(\d+\.\d+\.\d+[^\s]*)/);
                done(m ? m[1] : null);
            });
            setTimeout(() => {
                try {
                    child.kill();
                }
                catch {
                    /* already gone */
                }
                done(null);
            }, timeoutMs);
        }
        catch {
            done(null);
        }
    });
}
async function readDesktopVersion(desktopExe) {
    try {
        const st = await fs.promises.stat(desktopExe);
        return st.mtime ? `mtime:${st.mtime.toISOString()}` : null;
    }
    catch {
        return null;
    }
}
export async function discoverRuntime(opts) {
    const candidates = [];
    let source = "default-candidates";
    if (opts.runtimePathOverride) {
        candidates.push(opts.runtimePathOverride);
        source = "env";
    }
    else if (process.env.ZCODE_HARNESS_RUNTIME_PATH) {
        candidates.push(process.env.ZCODE_HARNESS_RUNTIME_PATH);
        source = "env";
    }
    // An explicit operator path must not be silently replaced by defaults.
    const explicit = opts.runtimePathOverride ?? process.env.ZCODE_HARNESS_RUNTIME_PATH ?? null;
    if (explicit && !fs.existsSync(path.resolve(explicit))) {
        throw new Error(`ZCODE_HARNESS_RUNTIME_PATH (--runtime-path) points to a missing file: ${path.resolve(explicit)}`);
    }
    candidates.push(...candidateHarnessPaths());
    const considered = [];
    for (const candidate of candidates) {
        const abs = path.resolve(candidate);
        considered.push(abs);
        if (!fs.existsSync(abs))
            continue;
        const version = await runVersion(abs);
        if (version === null) {
            log.warn("candidate exists but did not answer --version", { candidate: abs });
            // Still accept the candidate: a present bundle with a broken --version
            // is a real environment condition; the bridge reports it honestly.
        }
        const fp = fileFingerprint(abs);
        const desktopExe = path.join(path.dirname(path.dirname(path.dirname(abs))), "ZCode.exe");
        const info = {
            harnessPath: abs,
            nodeProgram: "node",
            harnessVersion: version,
            bundleFingerprint: fp?.sha256 ?? null,
            bundleBytes: fp?.bytes ?? null,
            desktopVersion: await readDesktopVersion(desktopExe),
            source,
            candidatesConsidered: considered,
        };
        log.info("runtime discovered", { harnessPath: abs, harnessVersion: version, fingerprint: fp?.sha256 });
        return info;
    }
    throw new Error(`ZCode harness (zcode.cjs) not found. Considered:\n${considered
        .map((c) => `  - ${c}`)
        .join("\n")}\nSet ZCODE_HARNESS_RUNTIME_PATH or pass --runtime-path.`);
}
/** Print discovery as JSON (used by `npm run probe:runtime`). */
export async function printDiscovery() {
    try {
        return await discoverRuntime({});
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
