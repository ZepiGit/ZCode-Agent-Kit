// `zcode-kit update [--version vX.Y.Z] [--harness <list>] [--no-mcp]`.
// Three installation shapes, three update paths — update picks by layout:
//   checkout (.git present): git fetch + fast-forward to origin/main or a tag.
//   npm (node_modules/zcode-agent-kit): npm replaces the global package.
//   release tarball: download the published archive, verify its SHA-256
//     against checksums.txt, then mirror it over the installation while
//     keeping machine-local state (.proxykey, proxy/config.yaml, logs,
//     backups, generated, node_modules). Download, verification and
//     extraction all happen before the first installation file is touched.
// Every path stops a running proxy first, re-runs setup afterwards and then
// restarts the proxy: when update returns, the proxy is running the updated
// code (a failed restart carries the manager's exit code). Setup's 20 (a
// harness failed) and 130 (interrupted) are update's exit code too.
// Output is streamed (ctx.progress): git, npm, setup and the manager share
// the terminal. Below the Node support floor the entry refuses first
// (`nodeFloor`, ADR-0006).
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, beginTransaction, releaseLock } from "../../lib/transaction.mjs";
import { ensureState } from "../../lib/state.mjs";
import {
  detectInstallType,
  downloadRelease,
  extractTarball,
  installedVersion,
  mirrorTree,
  repoFromPackage,
  resolveLatestTag,
  stripV,
} from "../../lib/self-update.mjs";
import { isInteractive } from "../harness-consent.mjs";
import { EXIT_ABORTED, EXIT_HARNESS_FAILED, managerPath } from "./common.mjs";

/** The entry refuses this command below the Node support floor, before the kit context exists. */
export const nodeFloor = true;

/** @param {{ flags: Record<string, unknown> }} args */
export async function run({ flags }, ctx) {
  const { kit, progress, progressError } = ctx;
  const ROOT = kit.root;
  ensureState(kit);
  const type = detectInstallType(ROOT);
  const wanted = flags.version === true ? "" : String(flags.version ?? "");
  if (flags.version !== undefined && !/^v?\d+\.\d+\.\d+$/.test(wanted)) {
    progressError(`update: --version expects a release tag like v0.2.11${wanted ? ` (got "${wanted}")` : ""}.`);
    return done(2);
  }
  const pin = wanted ? `v${wanted.replace(/^v/, "")}` : null;
  const harnessArgs = [
    ...(flags.harness ? ["--harness", String(flags.harness)] : []),
    ...(flags["no-mcp"] ? ["--no-mcp"] : []),
  ];

  if (type === "checkout") {
    // Conservative by design: refuses on a dirty tree; fast-forward only.
    // V1-01: a missing git must be reported, not mistaken for a clean tree.
    const dirty = ctx.runCommandSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
    if (dirty.error || dirty.status !== 0) {
      progressError(`update: cannot run git (${dirty.error?.message ?? `exit ${dirty.status}`}) — install git or re-run the installer.`);
      return done(2);
    }
    if ((dirty.stdout ?? "").trim().length > 0) {
      progressError("update: working tree has changes — commit or stash first (refusing to mix user changes into an update).");
      return done(2);
    }
    const fetched = ctx.runCommandSync("git", ["fetch", "--tags", "origin"], { cwd: ROOT, stdio: "inherit" });
    if (fetched.error || fetched.status !== 0) {
      progressError(`update: git fetch failed${fetched.error ? ` (${fetched.error.message})` : ""}.`);
      return done(fetched.status ?? 2);
    }
    let target = "origin/main";
    if (pin) {
      const known = ctx.runCommandSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${pin}^{commit}`], { cwd: ROOT, encoding: "utf8" });
      if (known.error || known.status !== 0) {
        progressError(`update: release tag ${pin} does not exist on origin.`);
        return done(2);
      }
      target = `refs/tags/${pin}`;
    }
    stopProxyIfRunning(ctx);
    const merge = ctx.runCommandSync("git", ["merge", "--ff-only", target], { cwd: ROOT, stdio: "inherit" });
    if (merge.error || merge.status !== 0) {
      progressError("update: fast-forward not possible (history diverged). Resolve manually — the kit never force-updates.");
      return done(merge.status ?? 2);
    }
    return done(finishUpdate(ctx, harnessArgs));
  }

  if (type === "npm") {
    const tag = pin ?? await resolveTargetTag(ctx);
    if (!tag) return done(2);
    const installed = installedVersion(ROOT);
    if (!pin && installed && stripV(tag) === installed) {
      progress(`update: already at v${installed} (latest). Nothing to do.`);
      return done(0);
    }
    stopProxyIfRunning(ctx);
    const res = ctx.runCommandSync("npm", ["install", "-g", `zcode-agent-kit@${stripV(tag)}`], { stdio: "inherit" });
    if (res.error || res.status !== 0) {
      progressError(`update: npm install failed${res.error ? ` (${res.error.message})` : ""}. Run it manually: npm install -g zcode-agent-kit@${stripV(tag)}`);
      return done(res.status ?? 2);
    }
    return done(finishUpdate(ctx, harnessArgs));
  }

  const tag = pin ?? await resolveTargetTag(ctx);
  if (!tag) return done(2);
  const installed = installedVersion(ROOT);
  if (!pin && installed && stripV(tag) === installed) {
    progress(`update: already at v${installed} (latest). Nothing to do.`);
    return done(0);
  }
  const tmp = mkdtempSync(join(tmpdir(), "zcode-kit-update-"));
  let txId = null;
  try {
    progress(`update: downloading ${tag} ...`);
    const archive = await downloadRelease(repoFromPackage(ROOT), tag, tmp, { fetchImpl: ctx.fetch });
    const src = extractTarball(archive, join(tmp, "out"));
    const releaseVersion = installedVersion(src);
    if (releaseVersion !== stripV(tag)) {
      progressError(`update: archive sanity check failed (package version ${releaseVersion ?? "unknown"} != ${stripV(tag)}).`);
      return done(2);
    }
    progress(`update: verified ${tag} (sha256) — updating ${installed ? `v${installed} ` : ""}→ ${tag}`);
    stopProxyIfRunning(ctx);
    acquireLock(kit.backupDir);
    let tx;
    try {
      tx = beginTransaction(kit.backupDir, `zcode-kit update ${tag}`);
      tx.external(
        `kit files updated to ${tag}`,
        `re-apply the previous release: zcode-kit update --version ${installed ? `v${installed}` : "<previous>"} (or re-run the installer)`,
      );
      const { copied, deleted } = mirrorTree(src, ROOT);
      tx.finish();
      txId = tx.id;
      progress(`update: applied ${tag} (${copied} files updated, ${deleted} removed)`);
    } catch (err) {
      // Record the interrupted transaction so zcode-kit rollback can list it.
      try { if (tx) tx.finish(); } catch { /* journal already persisted per op */ }
      throw err;
    } finally {
      releaseLock(join(kit.backupDir, ".setup-lock"));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return done(finishUpdate(ctx, harnessArgs, txId));
}

const done = (exitCode) => ({ exitCode, records: [] });

async function resolveTargetTag({ kit, fetch, progressError }) {
  try {
    return await resolveLatestTag(repoFromPackage(kit.root), { fetchImpl: fetch });
  } catch (err) {
    progressError(`update: could not resolve the latest release (${err.message}).`);
    progressError("  Pin one explicitly: zcode-kit update --version vX.Y.Z");
    return null;
  }
}

function stopProxyIfRunning(ctx) {
  // The manager owns identity proofs: a foreign service on the port is left
  // alone (exit 3) and update continues — mirroring kit files does not touch it.
  const res = ctx.spawnSync(ctx.execPath, [managerPath(ctx.kit), "stop"], { stdio: "inherit" });
  if (res.status !== 0 && res.status !== 3) {
    ctx.progressError(`update: proxy stop reported exit ${res.status ?? "unknown"} — continuing; the proxy may need a manual restart.`);
  }
}

/**
 * The setup re-run's stdin: the terminal only when stdin and stderr are both
 * terminals (and not CI). Otherwise setup gets no input, so it asks nothing:
 * stored decisions apply and undecided questions are skipped. An unattended
 * update never waits on a question nobody can see or answer (Round 1 Q8 cond 3).
 */
export function setupStdin({ terminal, env }) {
  return isInteractive({ input: terminal?.stdin ?? {}, output: terminal?.stderr ?? {}, env }) ? "inherit" : "ignore";
}

function finishUpdate(ctx, harnessArgs, txId = null) {
  const { kit, progress, progressError } = ctx;
  progress("update: refreshing consented integrations (stored answers are respected; new harnesses are asked only on a terminal)...");
  // Explicitly running `update` is the opt-in the checkout-write
  // guard asks for. Fresh process so the updated modules (not the ones
  // already loaded by this process) apply the integrations.
  const res = ctx.spawnSync(ctx.execPath, [join(kit.root, "cli", "zcode-kit.mjs"), "setup", ...harnessArgs], {
    cwd: kit.root,
    stdio: [setupStdin(ctx), "inherit", "inherit"],
    env: { ...ctx.env, ZCODE_KIT_ALLOW_CHECKOUT: "1" },
  });
  // Exit 20 = one or more harnesses failed but the kit itself is fine; exit
  // 130 = the user interrupted the questions (answers given were applied).
  // In both cases the proxy must still come back. Anything else is a real
  // setup failure.
  const harnessFailures = res.status === EXIT_HARNESS_FAILED;
  const aborted = res.status === EXIT_ABORTED;
  const partialExit = harnessFailures ? EXIT_HARNESS_FAILED : aborted ? EXIT_ABORTED : 0;
  if (res.status !== 0 && !harnessFailures && !aborted) {
    progressError("update: setup failed — the kit files are updated; inspect the output above and rerun `zcode-kit setup`.");
    return res.status ?? 2;
  }
  if (harnessFailures) progressError("update: some assistants could not be configured (see the summary above); the proxy is started anyway.");
  if (aborted) progressError("update: setup was interrupted; the kit files are updated and the answers given so far were applied — finish with `zcode-kit setup`. The proxy is started anyway.");
  // update stopped the proxy before mutating files, so it must come back
  // here: an update that returns with a dead proxy is not done. The
  // manager `start` is idempotent (already-running exits 0) and safe-starts
  // with full ownership proofs; failures carry its exit code. A kit layout
  // without the proxy manager (minimal fixtures, tooling checkouts) skips
  // the start — there is no proxy component to restart.
  const manager = managerPath(kit);
  if (!existsSync(manager)) {
    progress("update: no proxy manager in this kit layout — skipping the proxy start.");
    if (txId) progress(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
    return partialExit;
  }
  progress("update: starting the proxy on the updated code...");
  const started = ctx.spawnSync(ctx.execPath, [manager, "start"], { stdio: "inherit" });
  if (started.status !== 0) {
    progressError("update: the proxy did not start — the kit files are updated; run `zcode-kit doctor` (the exit code carries the reason).");
    return started.status ?? 2;
  }
  if (txId) progress(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
  return partialExit;
}
