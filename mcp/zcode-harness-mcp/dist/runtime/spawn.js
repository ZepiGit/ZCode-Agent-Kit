import { spawn } from "node:child_process";
export function spawnAppServer(opts) {
    // stdio is fully piped, so the child has non-null streams (runtime
    // guarantee; the cast only mirrors that guarantee for the type system).
    const child = spawn("node", [opts.harnessPath, "app-server", "--stdio"], {
        cwd: opts.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    return child;
}
/** Read-only version probe of a candidate harness bundle. */
export function spawnVersionProbe(harnessPath) {
    return spawn("node", [harnessPath, "--version"], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
}
