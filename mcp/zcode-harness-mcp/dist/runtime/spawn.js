import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const builtinConfigKey = "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE";
const bundledConfigKey = "ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
function isReadableFile(file) {
    try {
        if (!fs.statSync(file).isFile())
            return false;
        fs.accessSync(file, fs.constants.R_OK);
        return true;
    }
    catch {
        return false;
    }
}
/** Resolve only distribution-relative files, never a config in the bridge cwd. */
export function findBundledProviderConfig(harnessPath) {
    const dir = path.dirname(path.resolve(harnessPath));
    return [
        path.join(dir, "provider", "zcode-builtin.json"),
        path.resolve(dir, "../config/provider/zcode-builtin.json"),
        path.resolve(dir, "../../../../../config/provider/zcode-builtin.json"),
    ].find(isReadableFile) ?? null;
}
function appServerEnv(cwd, bundledProviderConfigPath) {
    const env = { ...process.env };
    // Native bootstrap uses ?? after trim(); blank paths must be absent rather
    // than becoming an empty bundled/personal filename.
    for (const key of [builtinConfigKey, bundledConfigKey, "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE"]) {
        if (env[key] !== undefined && !env[key]?.trim())
            delete env[key];
    }
    const builtin = env[builtinConfigKey]?.trim();
    const bundled = env[bundledConfigKey]?.trim();
    // An explicit built-in path always wins; never repair a broken operator
    // override by silently selecting another provider configuration.
    const selected = builtin || bundled || bundledProviderConfigPath;
    if (selected && !isReadableFile(path.resolve(cwd, selected))) {
        const source = builtin ? builtinConfigKey : bundled ? bundledConfigKey : "installed bundled provider config";
        throw new Error(`${source} is not a readable file; refusing to replace the selected provider configuration`);
    }
    if (!builtin && selected) {
        // The CLI bootstrap consumes BUILTIN, not BUNDLED. Supplying BUILTIN alone
        // lets the vendor materialize its active config and default personal path.
        // Never invent PERSONAL: a real operator override must retain its semantics.
        env[builtinConfigKey] = selected;
    }
    return env;
}
export function spawnAppServer(opts) {
    // stdio is fully piped, so the child has non-null streams (runtime
    // guarantee; the cast only mirrors that guarantee for the type system).
    const child = spawn("node", [opts.harnessPath, "app-server", "--stdio"], {
        cwd: opts.cwd,
        env: appServerEnv(opts.cwd, opts.bundledProviderConfigPath),
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
