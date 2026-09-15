// Assembles the npm launcher package under pack/dist from the tracked repo
// sources (allowlist-driven — audit §11: explicit package allowlists, never
// "publish the directory"). The launcher package contains the kit sources;
// `npm install -g zcode-agent-kit` then runs the kit's setup, which installs
// the proxy/bridge dependencies with bun (versioned, frozen lockfile).
//
// Usage: node pack/build.mjs [--dry-run-publish]
import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "pack", "dist");

// Allowlist: exactly what ships. Everything else (tests, backups, logs,
// generated artifacts, vendored junk) never enters the package.
const ALLOW_PREFIXES = [
  "cli/",
  "lib/",
  "proxy/zcode-proxy-manager.mjs",
  "proxy/zcode-proxy-autostart.ts",
  "proxy/resolve-zcode-proxy-key.mjs",
  "proxy/config.example.yaml",
  "bin/",
  "setup.mjs",
  "README.md",
  "SECURITY.md",
  "EFFORT_MAPPING.md",
  "EFFORT_MAPPING.json",
  "MANIFEST.md",
  "mcp/zcode-harness-mcp/src/",
  "mcp/zcode-harness-mcp/dist/",
  "mcp/zcode-harness-mcp/package.json",
  "mcp/zcode-harness-mcp/tsconfig.json",
  "mcp/zcode-harness-mcp/bun.lock",
  "zcode-proxy-src/src/",
  "zcode-proxy-src/package.json",
  "zcode-proxy-src/tsconfig.json",
  "zcode-proxy-src/bun.lock",
  "patches/",
  "scripts/verify-release-marker.mjs",
];

const FORBIDDEN = [
  /^\.proxykey$/,
  /(^|\/)generated\//,
  /(^|\/)backups\//,
  /(^|\/)logs\//,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)test\//,
  /(^|\/)tests\//,
  /config\.yaml$/, // real config with the key — only config.example.yaml ships
  /credentials\.json$/,
  /\.mimosa\//,
];

function trackedFiles() {
  // Tracked + untracked-but-not-ignored sources: a local build from a working
  // tree must include new files, while the ignore rules (info/exclude) keep
  // secrets, logs and generated state out.
  const res = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) throw new Error("git ls-files failed — build the package from a git checkout");
  return res.stdout.split("\n").filter(Boolean);
}

function resetDist() {
  try {
    rmSync(DIST, { recursive: true, force: true });
  } catch (err) {
    // Windows cannot remove a directory that is any process's working
    // directory (an open shell or Explorer window inside pack/dist is enough).
    // Fall back to emptying it in place — same end state for the assembly.
    try {
      for (const entry of readdirSync(DIST)) {
        rmSync(join(DIST, entry), { recursive: true, force: true });
      }
    } catch {
      throw new Error(
        `cannot reset ${DIST} (${err.code}) — close any shell or Explorer window sitting inside it and re-run`,
      );
    }
  }
}

function main() {
  const dryRunPublish = process.argv.includes("--dry-run-publish");
  resetDist();
  mkdirSync(DIST, { recursive: true });

  const files = trackedFiles().filter((f) => {
    if (FORBIDDEN.some((re) => re.test(f))) return false;
    return ALLOW_PREFIXES.some((p) => f === p.replace(/\/$/, "") || f.startsWith(p));
  });
  if (files.length === 0) throw new Error("allowlist matched no files — refusing to build an empty package");

  for (const f of files) {
    const dest = join(DIST, f);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(ROOT, f), dest);
  }

  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  // AUD-012: the release marker is version-bound — a marker for a different
  // version must NOT produce a publishable package. prepublishOnly enforces
  // the same check inside the package at publish time.
  const releaseMarker = existsSync(join(ROOT, "pack", "ALLOW_PUBLISH"));
  const markerVersions = releaseMarker
    ? readFileSync(join(ROOT, "pack", "ALLOW_PUBLISH"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [];
  const releaseAuthorized = markerVersions.includes(rootPkg.version);
  const pkg = {
    name: "zcode-agent-kit",
    version: rootPkg.version,
    description: rootPkg.description,
    license: "MIT",
    type: "module",
    // Keep the source checkout (`npm link`) and generated publish package on
    // exactly the same command surface. `zcode-agent-kit` makes the package
    // name directly executable; `zcode-kit` remains the concise primary CLI.
    bin: rootPkg.bin,
    engines: { node: ">=20" },
    // Fail closed at the package level, not only in CI (ZAK-012): a generated
    // package stays private unless pack/ALLOW_PUBLISH existed at build time
    // AND names this exact version.
    private: !releaseAuthorized,
    scripts: {
      postinstall: "node setup.mjs --postinstall-hint",
      prepublishOnly: "node scripts/verify-release-marker.mjs",
    },
    repository: rootPkg.repository,
    bugs: rootPkg.bugs,
    homepage: rootPkg.homepage,
    files: files.concat(["package.json"]),
  };
  writeFileSync(join(DIST, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  // Ship the consent marker into the package when (and only when) it exists —
  // the package-internal prepublishOnly gate then re-checks it at publish time.
  const markerSrc = join(ROOT, "pack", "ALLOW_PUBLISH");
  if (releaseMarker) cpSync(markerSrc, join(DIST, "ALLOW_PUBLISH"));
  console.log(`pack: assembled ${files.length} files into pack/dist (version ${rootPkg.version}, private: ${pkg.private})`);

  if (dryRunPublish) {
    const res = spawnSync("npm", ["publish", "--dry-run"], {
      cwd: DIST,
      encoding: "utf8",
      shell: process.platform === "win32", // npm is npm.cmd on Windows
    });
    console.log((res.stdout ?? "") + (res.stderr ?? ""));
    if (res.status !== 0) {
      console.error("pack: dry-run publish FAILED — fix the payload before any real release");
      process.exit(1);
    }
    console.log("pack: dry-run publish OK (nothing was published)");
  }
}

main();
