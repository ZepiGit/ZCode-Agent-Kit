// The UX capture tooling's host-specific parts (tests/ux-before/capture/host.mjs)
// and the comparison's explicit normalisation (tests/ux-before/compare.mjs),
// proven on Linux with injected Windows paths. Failures fixed here come from
// CI run 42236936458 (ux-before job): git 2.56's transfer-progress text on
// ubuntu, and on windows a fixture-proxy path whose backslashes were read as
// escapes, GNU tar reading `C:` as a remote host, and a silent `git clone`;
// then (staging/06) git.exe crashing with 0xC0000005 under a Git Bash step's
// environment in the baseline step only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneArgs, describeFailure, fakeProxySource, fixtureBaseEnv, importBase, pathForms, pinBun, swapPath, tarBinary, windowsGitDir } from "./ux-before/capture/host.mjs";
import { VOLATILE, compareCaptures, normaliseVolatile } from "./ux-before/compare.mjs";
import { runOwned, requireSuccess } from "./ux-before/capture/owned-child.mjs";

const ROOT = join(import.meta.dirname, "..");
const TEMPLATE = readFileSync(join(ROOT, "tests", "ux-before", "capture", "fake-proxy.ts"), "utf8");
const CAPTURE = join(ROOT, "tests", "ux-before", "capture", "capture.mjs");
/** The host environment without UX_CAPTURE_PORT: every capture scenario takes a free port of its own. */
function captureEnv() {
  const env = { ...process.env };
  delete env.UX_CAPTURE_PORT;
  return env;
}
function assertObservedOwnedDead(...pids) {
  for (const pid of pids) {
    assert.ok(pid > 0, "observed owned PID required");
    let live = true;
    try {
      process.kill(pid, 0);
      if (process.platform === "linux") live = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0] !== "Z";
    } catch (error) { if (error.code === "ESRCH" || error.code === "ENOENT") live = false; else throw error; }
    assert.equal(live, false, `owned PID ${pid} must not remain live (zombie is exited, not reaping proof)`);
  }
}
const literalOf = (source) => source.match(/^const REAL_PROXY_SRC = (.*);$/m)[1];

// ------------------------------------------------------- git progress (ubuntu)
// Byte forms from the committed baseline (git 2.43) and from git 2.56 (CI).
const OLD_TTY = [
  "remote: Enumerating objects: 5, done.\x1b[K",
  "remote: Counting objects: 100% (5/5), done.\x1b[K",
  "remote: Total 3 (delta 2), reused 0 (delta 0), pack-reused 0\x1b[K",
  "Unpacking objects:  33% (1/3)",
  "Unpacking objects: 100% (3/3), 270 bytes | 270.00 KiB/s, done.",
];
const NEW_TTY = [
  "\x1b[Kremote: Enumerating objects: 5, done.",
  "\x1b[Kremote: Counting objects:  20% (1/5)",
  "\x1b[Kremote: Counting objects: 100% (5/5), done.",
  "\x1b[Kremote: Compressing objects: 100% (3/3), done.",
  "\x1b[Kremote: Total 3 (delta 2), reused 0 (delta 0), pack-reused 0 (from 0)",
  "Receiving objects: 100% (3/3), 269 bytes | 134.00 KiB/s, done.",
  "Resolving deltas: 100% (2/2), done.",
];
const around = (block) => ["n", "n", ...block, "From <FIXTURE>/origin", "   <SHA>..<SHA>  main       -> origin/main", "not running", "Fast-forward", ""].join("\n");

test("git's transfer progress normalises to one marker whatever the git version", () => {
  const a = normaliseVolatile(around(OLD_TTY));
  assert.equal(a, normaliseVolatile(around(NEW_TTY)));
  assert.equal(a, normaliseVolatile(around(OLD_TTY.map((l) => l.replace("\x1b[K", "        ")))), "TERM=dumb pads with spaces instead");
  assert.equal(a, normaliseVolatile(around(OLD_TTY.map((l) => l.replace("\x1b[K", "")))), "the ANSI-stripped .txt form");
  assert.equal(a, "n\nn\n<GIT TRANSFER PROGRESS>\nFrom <FIXTURE>/origin\n   <SHA>..<SHA>  main       -> origin/main\nnot running\nFast-forward\n");
});

test("the git progress rule touches no kit line: indented, mid-line or other wording stays", () => {
  const kit = [
    "  remote: indented kit text",
    "update: remote: not at line start",
    "Unpacking the release archive",
    "FAIL  remote: a check name",
    "",
  ].join("\n");
  assert.equal(normaliseVolatile(kit), kit);
  assert.ok(VOLATILE.some(([name]) => name === "git transfer progress"));
});

// ------------------------------------------------- fixture proxy (windows)
test("the fixture proxy's source literal keeps a Windows path: a file URL, every backslash intact", () => {
  for (const dir of ["D:\\a\\_temp\\ux-base\\zcode-proxy-src", "D:\\a\\ZCode-Agent-Kit\\ZCode-Agent-Kit\\zcode-proxy-src"]) {
    const ref = JSON.parse(literalOf(fakeProxySource(TEMPLATE, dir, { windows: true })));
    assert.equal(ref, importBase(dir, { windows: true }));
    assert.match(ref, /^file:\/\/\/D:\/a\//);
    assert.equal(fileURLToPath(`${ref}/src/index.ts`, { windows: true }), `${dir}\\src\\index.ts`);
  }
});

test("the original raw substitution is what broke: `\\u` and `\\a` inside quotes are escapes", () => {
  const raw = TEMPLATE.replace("__REAL_PROXY_SRC__", "D:\\a\\_temp\\ux-base\\zcode-proxy-src");
  assert.throws(() => JSON.parse(literalOf(raw)), "a raw drive path is no valid string literal");
  assert.equal(JSON.parse(literalOf(TEMPLATE.replace("__REAL_PROXY_SRC__", "D:\\a\\ZCode"))
    .replace(/\\(?!["\\/bfnrtu])/g, "")), "D:aZCode", "the CI message 'D:aZCode-Agent-Kit…' is this escape loss");
});

test("POSIX: the fixture proxy imports from a file URL of the same directory", () => {
  const ref = JSON.parse(literalOf(fakeProxySource(TEMPLATE, "/home/runner/work/kit/zcode-proxy-src")));
  assert.equal(ref, "file:///home/runner/work/kit/zcode-proxy-src");
  assert.throws(() => fakeProxySource("const X = 1;", "/x"), /lost its __REAL_PROXY_SRC__ literal/);
});

test("Linux end to end: a kit path with `\\u` in it starts the fixture proxy (the class of the Windows failure)", {
  timeout: 120_000,
  skip: process.platform === "win32" ? "a backslash in a directory name is POSIX-only" : false,
}, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-capture-bs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const kit = join(dir, "k\\ux-base");
  symlinkSync(ROOT, kit);
  const out = join(dir, "out");
  const run = spawnSync(process.execPath, [join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "--kit", kit, "--out", out,
    "--only", "^proxy-status-json-running$", "--variants", "pipe"], {
    encoding: "utf8", timeout: 110_000,
    // Free ports of its own: tests/json-superset.test.mjs captures in parallel (node --test runs files concurrently).
    env: captureEnv(),
  });
  assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-2000));
  const [m] = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(m.error, undefined, m.error);
  assert.equal(m.exit, 0);
  assert.equal(JSON.parse(readFileSync(join(out, "proxy", "proxy-status-json-running", "pipe.txt"), "utf8").replace(/<PID>/g, "0")).health, "ours", "the fixture proxy answered as this kit's own");
});

// Exercise the real proxy health JSON producer, public kit CLI,
// Out renderer and capture writer. Do NOT use compareCaptures here: its
// relative-age rule would hide the old milliseconds/seconds regression.
// fake-proxy.ts pins only the health CLI clock to 2026-11-11T00:00Z;
// the unchanged live timestamps from Nov 5 are 5d old. This keeps the
// historical expired-exhaustion verdict; listener/producer/renderer stay real.
test("accounts health raw capture pipeline preserves millisecond ages and reviewed baselines", {
  timeout: 120_000,
}, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-health-age-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const variants = process.platform === "win32" ? ["pipe", "ci"]
    : ["tty-color-80", "tty-color-120", "no-color", "term-dumb", "ascii-locale", "pipe", "ci"];
  const out = join(dir, "out");
  const run = await runOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", out,
    "--only", "^accounts-health(-json)?$", "--variants", variants.join(",")], {
    cwd: ROOT, phase: "raw-health-capture", timeoutMs: 110_000, env: { ...captureEnv(), TZ: "UTC" },
  });
  requireSuccess(run);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.length, variants.length * 2);
  assert.ok(manifest.every((m) => !m.error && m.exit === 0), JSON.stringify(manifest));
  const baseline = join(ROOT, "tests", "ux-before", process.platform === "win32" ? "windows" : "linux");
  for (const variant of variants) {
    const rel = join("accounts", "accounts-health", `${variant}.txt`);
    const raw = readFileSync(join(out, rel), "utf8");
    assert.match(raw, /work[^\n]*used 5d ago/, `${variant}: literal age, no volatility normalizer`);
    assert.match(raw, /personal[^\n]*used 5d ago/, `${variant}: literal age, no volatility normalizer`);
    assert.match(raw, /backup[^\n]*never used/);
    assert.doesNotMatch(raw, /used 0s ago/);
    assert.equal(raw, readFileSync(join(baseline, rel), "utf8"), `${variant}: raw baseline bytes`);
    if (variant !== "pipe" && variant !== "ci") {
      const ansi = rel.replace(/\.txt$/, ".ansi");
      assert.equal(readFileSync(join(out, ansi), "utf8"), readFileSync(join(baseline, ansi), "utf8"), `${variant}: raw ANSI baseline bytes`);
    }
    assert.equal(existsSync(join(out, "accounts", "accounts-health", `${variant}.stderr.txt`)), false);
    const doc = JSON.parse(readFileSync(join(out, "accounts", "accounts-health-json", `${variant}.txt`), "utf8"));
    assert.equal(doc.asOf, "<TS>", "only the existing ISO timestamp capture rule applies");
    assert.deepEqual(doc.accounts.map((a) => [a.id, a.lastUsedAt]), [
      ["work", 1793879880000], ["personal", 1793872800000], ["backup", null],
    ], "live fixture milliseconds survive the real health JSON producer");
  }
});

// Controlled faults use the same public capture CLI and real health producer.
// They prove the harness contract, not the cause of run 42974492278.
for (const [fault, code, status] of [["early-exit", "CAPTURE_EXIT", 23], ["hang", "CAPTURE_TIMEOUT", null], ["drain", "CAPTURE_DRAIN_TIMEOUT", 0], ["early-exit-drain", "CAPTURE_EXIT", 23]]) {
  test(`health capture controlled ${fault}: finite owned cleanup and primary diagnostic`, { timeout: 30000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "ux-health-fault-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = await runOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, "out"), "--only", "^accounts-health-json$", "--variants", "ci"], {
      cwd: ROOT, phase: "raw-health-capture", timeoutMs: 25000, env: { ...captureEnv(), TZ: "UTC", UX_CAPTURE_FAULT: fault },
    });
    requireSuccess(run);
    const [row] = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    // Print bounded fixture ownership evidence before the first assertion.
    t.diagnostic(JSON.stringify({ fault, row }));
    assert.equal(row.diagnostic?.error?.code, code, JSON.stringify(row));
    assert.equal(row.diagnostic.status, status);
    if (fault.includes("drain")) {
      assert.equal(row.diagnostic.holder.ready, true);
      assert.equal(row.diagnostic.holder.liveAfterCliExit, true);
      assert.equal(row.diagnostic.holder.closed, true);
      assert.ok(row.diagnostic.holder.pid > 0);
      assert.ok(row.diagnostic.holder.startId);
      assert.deepEqual(row.diagnostic.drainObservation, { exited: true, drained: false, holderLive: true, status, signal: null }, "real exit plus missing EOF at the original observer deadline");
      assert.equal(row.diagnostic.drained, true, "release permits actual EOF during cleanup");
      assert.equal(row.diagnostic.holder.exited, true);
      assert.equal(row.diagnostic.holder.status, 0);
      assert.equal(row.diagnostic.cliClosed, true, "actual CLI spawn handle closed");
      assert.ok(row.diagnostic.events.indexOf("holder-ready,") < row.diagnostic.events.indexOf("spawn,"));
      assert.ok(row.diagnostic.events.indexOf("exit,") < row.diagnostic.events.indexOf("holder-live,"));
      assert.match(row.diagnostic.stdout, new RegExp(row.diagnostic.holder.startId));
      assert.match(row.diagnostic.stderr, new RegExp(row.diagnostic.holder.startId));
    }
    assert.equal(row.diagnostic.phase, "health-cli");
    assert.equal(row.diagnostic.ownerClosed, true);
    assert.equal(row.cleanup?.listenerClosed, true);
    assert.equal(row.cleanup?.portClosed, true);
    assert.equal(row.cleanup?.fixtureRemoved, true);
    assert.ok(row.diagnostic.pid > 0 && row.diagnostic.ownerPid > 0);
    assert.equal(row.diagnostic.pgid, process.platform === "win32" ? null : row.diagnostic.ownerPid);
    assert.ok(row.diagnostic.stdout.length <= 16384 && row.diagnostic.stderr.length <= 16384);
    assert.match(row.diagnostic.stderr, /UX_CAPTURE_FAULT/);
    assert.equal(row.diagnostic.cleanupError, undefined);
    assert.equal(row.cleanup.stopAcknowledged, true);
    if (fault.includes("drain")) assert.match(row.diagnostic.stderr, /UX_CAPTURE_PIPE_HOLDER pid=\d+/);
    for (const pid of [row.diagnostic.pid, row.diagnostic.ownerPid,
      ...[...row.diagnostic.stderr.matchAll(/UX_CAPTURE_PIPE_HOLDER pid=(\d+)/g)].map((m) => Number(m[1]))]) {
      let live = true;
      try {
        process.kill(pid, 0);
        // Linux PID 1 may retain an exited orphan's zombie; it is not live.
        if (process.platform === "linux") live = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0] !== "Z";
      } catch (error) { if (error.code === "ESRCH" || error.code === "ENOENT") live = false; else throw error; }
      assert.equal(live, false, `owned PID ${pid} must not remain live`);
    }
    t.diagnostic(JSON.stringify({ fault, phase: row.diagnostic.phase, status: row.diagnostic.status,
      signal: row.diagnostic.signal, error: row.diagnostic.error, pid: row.diagnostic.pid,
      ownerPid: row.diagnostic.ownerPid, pgid: row.diagnostic.pgid, exited: row.diagnostic.exited,
      drained: row.diagnostic.drained, ownerClosed: row.diagnostic.ownerClosed,
      listenerClosed: row.cleanup.listenerClosed, portClosed: row.cleanup.portClosed, fixtureRemoved: row.cleanup.fixtureRemoved }));
  });
}

for (const fault of ["drain-release", "drain-startup-failed", "drain-ack-missing", "none"]) {
  test(`health pipe handshake ${fault}: real public capture control`, { timeout: 30000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "ux-health-handshake-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = await runOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, "out"), "--only", "^accounts-health-json$", "--variants", "ci"], {
      cwd: ROOT, phase: "raw-health-capture", timeoutMs: 25000,
      env: { ...captureEnv(), TZ: "UTC", UX_CAPTURE_FAULT: fault },
    });
    requireSuccess(run);
    const [row] = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    t.diagnostic(JSON.stringify({ fault, row }));
    const cli = row.cli;
    assert.ok(cli.pid > 0 || fault.includes("failed") || fault.includes("missing"));
    assert.equal(cli.ownerClosed, true);
    assert.equal(row.cleanup.listenerClosed, true);
    assert.equal(row.cleanup.portClosed, true);
    assert.equal(row.cleanup.fixtureRemoved, true);
    assert.ok(existsSync(join(dir, "out", "INDEX.md")));
    if (["drain-startup-failed", "drain-ack-missing"].includes(fault)) {
      assert.equal(row.diagnostic.error.code, "CAPTURE_FAULT_SETUP");
      assert.equal(cli.holder.ready, false);
      assert.equal(cli.holder.exited, true);
      assert.equal(cli.holder.closed, true);
      assert.equal(cli.exited, false, "unacknowledged setup must not launch a CLI");
    } else {
      assert.equal(row.error, undefined);
      assert.equal(row.exit, 0);
      assert.equal(cli.error, null);
      assert.equal(cli.exited, true);
      assert.equal(cli.drained, true);
      if (fault === "drain-release") {
        assert.equal(cli.holder.ready, true);
        assert.equal(cli.holder.liveAfterCliExit, true);
        assert.equal(cli.holder.pipeOpenAfterCliExit, true);
        assert.equal(cli.holder.exited, true);
        assert.equal(cli.holder.closed, true);
        assert.equal(cli.holder.status, 0);
        assert.ok(cli.events.indexOf("exit") < cli.events.indexOf("holder-live"));
        assert.ok(cli.events.indexOf("holder-exit") < cli.events.indexOf("drained"));
      } else assert.equal(cli.holder, undefined, "no holder means no drain timeout");
    }
    assert.equal(cli.cleanupError, undefined);
  });
}

// Listener faults bind the actual fixture listener before failing. Not a CLI fault.
for (const [fault, code] of [["never-ready", "CAPTURE_READINESS_TIMEOUT"], ["early-exit", "CAPTURE_EXIT"]]) {
  test(`health listener controlled ${fault}: manifest and enclosing cleanup`, { timeout: 30000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "ux-listener-fault-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = await runOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, "out"), "--only", "^accounts-health-json$", "--variants", "ci"], {
      cwd: ROOT, phase: "raw-health-capture", timeoutMs: 25000,
      env: { ...captureEnv(), TZ: "UTC", UX_CAPTURE_LISTENER_FAULT: fault },
    });
    requireSuccess(run);
    assert.ok(existsSync(join(dir, "out", "INDEX.md")));
    const [row] = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    assert.equal(row.diagnostic?.error?.code, code, JSON.stringify(row));
    assert.equal(row.diagnostic.phase, "health-listener");
    assert.match(row.diagnostic.stderr, /UX_CAPTURE_LISTENER_FAULT/);
    assert.equal(row.diagnostic.status, fault === "early-exit" ? 23 : null);
    assert.equal(row.cleanup.listenerClosed, true);
    assert.equal(row.cleanup.portClosed, true);
    assert.equal(row.cleanup.fixtureRemoved, true);
    assertObservedOwnedDead(row.cleanup.listener.pid, row.cleanup.listener.ownerPid);
    assert.equal(row.cleanup.listener.groupVerified, process.platform !== "win32");
    t.diagnostic(JSON.stringify({ fault, code, cleanup: row.cleanup }));
  });
}

for (const [fault, code] of [["budget", "CAPTURE_BUDGET"], ["diagnostic", "CAPTURE_RECORD_FAULT"], ["diagnostic-trap", "CAPTURE_RECORD_FAULT"]]) {
  test(`health record controlled ${fault}: primary survives record failure`, { timeout: 30000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "ux-record-fault-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = await runOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, "out"), "--only", "^accounts-health-json$", "--variants", "ci"], {
      cwd: ROOT, phase: "raw-health-capture", timeoutMs: 25000,
      env: { ...captureEnv(), TZ: "UTC", UX_CAPTURE_RECORD_FAULT: fault },
    });
    requireSuccess(run);
    const [row] = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    assert.equal(row.diagnostic?.error?.code, code, JSON.stringify(row));
    assert.equal(row.cleanup.listenerClosed, true);
    assert.equal(row.cleanup.portClosed, true);
    assert.equal(row.cleanup.fixtureRemoved, true);
    assert.ok(existsSync(join(dir, "out", "INDEX.md")));
    assert.ok(JSON.stringify(row).length < 65536);
    if (fault === "diagnostic-trap") assert.equal(row.diagnosticError, "DIAGNOSTIC_SERIALIZATION_FAILED");
  });
}

for (const fault of ["ignore-eof", "never-ready-ignore-eof"]) {
  test(`health listener controlled ${fault}: manifest survives cleanup failure`, { timeout: 30000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "ux-listener-eof-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = await runOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, "out"), "--only", "^accounts-health-json$", "--variants", "ci"], {
      cwd: ROOT, phase: "raw-health-capture", timeoutMs: 25000,
      env: { ...captureEnv(), TZ: "UTC", UX_CAPTURE_LISTENER_FAULT: fault },
    });
    requireSuccess(run);
    const [row] = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    assert.equal(row.cleanup.listenerClosed, true);
    assert.equal(row.cleanup.portClosed, true);
    assert.equal(row.cleanup.fixtureRemoved, true);
    assert.equal(row.cleanup.stopAcknowledged, false);
    assert.ok(row.error);
    if (fault.startsWith("never-ready")) assert.equal(row.diagnostic.error.code, "CAPTURE_READINESS_TIMEOUT");
    assert.ok(existsSync(join(dir, "out", "INDEX.md")));
    assert.equal(row.cleanup.listener.groupVerified, process.platform !== "win32");
    assertObservedOwnedDead(row.cleanup.listener.pid, row.cleanup.listener.ownerPid);
    t.diagnostic(JSON.stringify({ fault, primary: row.diagnostic?.error, cleanup: row.cleanup }));
  });
}

test("synthetic Windows taskkill failures are explicit, killer exit is not tree-death proof", { timeout: 5000 }, async () => {
  const { EventEmitter } = await import("node:events");
  const { terminateWindowsOwner } = await import("./ux-before/capture/owned-child.mjs");
  assert.equal(typeof terminateWindowsOwner, "function");
  for (const kind of ["missing", "access-denied", "timeout", "surviving-owner", "closed-owner"]) {
    let ownerClosed = kind === "closed-owner", killedKiller = false;
    const calls = [];
    const result = await terminateWindowsOwner({ ownerPid: 43210, ownerClosed: () => ownerClosed, timeoutMs: 30,
      spawnImpl(command, args) {
        calls.push([command, args]);
        const killer = new EventEmitter();
        killer.kill = () => { killedKiller = true; return true; };
        killer.unref = () => {};
        queueMicrotask(() => {
          if (kind === "missing") killer.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
          else if (kind === "access-denied") killer.emit("close", 5, null);
          else if (kind !== "timeout") killer.emit("close", 0, null);
        });
        return killer;
      },
    });
    assert.deepEqual(calls, [["taskkill", ["/PID", "43210", "/T", "/F"]]]);
    assert.equal(result.treeDead, false, "no process-table/tree identity evidence was supplied");
    assert.equal(result.cleanupError, { missing: "TASKKILL_ENOENT", "access-denied": "TASKKILL_EXIT_5", timeout: "TASKKILL_TIMEOUT", "surviving-owner": "OWNER_CLOSE_TIMEOUT", "closed-owner": undefined }[kind]);
    assert.equal(killedKiller, kind === "timeout");
  }
});

test("health capture handled termination writes manifest after real listener cleanup", { timeout: 30000,
  skip: process.platform === "win32" ? "POSIX SIGTERM delivery; native Windows termination remains downstream" : false,
}, async (t) => {
  const { startOwned } = await import("./ux-before/capture/owned-child.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ux-health-signal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const capture = startOwned(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, "out"), "--only", "^accounts-health-json$", "--variants", "ci"], {
    cwd: ROOT, phase: "raw-health-capture", timeoutMs: 25000,
    env: { ...captureEnv(), TZ: "UTC", UX_CAPTURE_FAULT: "hang" },
  });
  try {
    const until = performance.now() + 15000;
    while (!capture.result.stderr.includes('"type":"ready"') && !capture.result.ownerClosed && performance.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(capture.result.stderr, /"type":"ready"/);
    process.kill(capture.result.pid, "SIGTERM"); // exact live command spawned by this test
    const result = await capture.done;
    assert.equal(result.status, 143);
    assert.equal(result.ownerClosed, true);
    const [row] = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    assert.equal(row.cleanup.listenerClosed, true);
    assert.equal(row.cleanup.portClosed, true);
    assert.equal(row.cleanup.fixtureRemoved, true);
    assert.ok(existsSync(join(dir, "out", "INDEX.md")));
  } finally { if (!capture.result.ownerClosed) await capture.stop(); }
});

test("POSIX capture ownership verifies actual keeper and command private PGID", {
  timeout: 10000, skip: process.platform === "win32" ? "POSIX process groups only; Windows adapter is separate" : false,
}, async () => {
  const { startOwned } = await import("./ux-before/capture/owned-child.mjs");
  const child = startOwned(process.execPath, ["-e", 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'], {
    cwd: ROOT, env: captureEnv(), phase: "group-control", timeoutMs: 5000,
  });
  try {
    const until = performance.now() + 3000;
    while (!child.result.stdout.includes("ready") && performance.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(child.result.groupVerified, true);
    assert.ok(child.result.pid > 0);
    const probe = (pid) => {
      const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 });
      assert.equal(r.status, 0);
      return Number(r.stdout.trim());
    };
    assert.equal(probe(child.result.ownerPid), child.result.ownerPid);
    assert.equal(probe(child.result.pid), child.result.ownerPid);
    assert.notEqual(probe(process.pid), child.result.ownerPid);
  } finally { await child.stop(); }
  assert.equal(child.result.ownerClosed, true);
  assert.equal(child.result.cleanupError, undefined);
});

// ------------------------------------------- the Bun path (ubuntu, run 42590699086)
// The kit prints the Bun it runs (doctor's `bun available` row) and an
// 80-column TTY wraps that row by the path's real length before `<BUN>`
// replaces it: a baseline captured with Bun under a long directory had
// `(1.4.2)` on a continuation line, the CI runner (~/.bun/bin/bun) one line.
test("POSIX: the fixtures run Bun through a fixed-length path, whatever the host's Bun directory", () => {
  const made = [];
  const deps = { windows: false, tmp: "/tmp", mkdtemp: (prefix) => `${prefix}Ab12Cd`, symlink: (target, path) => made.push([target, path]) };
  const longHost = `/home/${"x".repeat(80)}/node_modules/.bin/bun`;
  const short = pinBun("/home/runner/.bun/bin/bun", deps);
  assert.equal(short, "/tmp/ux-bun-Ab12Cd/bun");
  assert.equal(pinBun(longHost, deps), short, "the host's directory never reaches the fixtures");
  assert.deepEqual(made, [["/home/runner/.bun/bin/bun", short], [longHost, short]]);
});

test("Windows: the host's Bun as found (no symlink rights; the pipe/ci rows never wrap)", () => {
  const made = [];
  const host = "C:\\Users\\runneradmin\\.bun\\bin\\bun.exe";
  assert.equal(pinBun(host, { windows: true, tmp: "C:\\T", mkdtemp: () => { throw new Error("no temp dir on Windows"); }, symlink: (...a) => made.push(a) }), host);
  assert.deepEqual(made, []);
});

test("capture.mjs runs the fixtures with the pinned Bun and writes both spellings back as <BUN> (wiring)", () => {
  const src = readFileSync(CAPTURE, "utf8");
  assert.match(src, /const BUN = pinBun\(BUN_HOST, \{ windows: IS_WIN, tmp: tmpdir\(\), mkdtemp: mkdtempSync, symlink: symlinkSync \}\);/);
  assert.match(src, /swap\(swap\(s, BUN, "<BUN>"\), BUN_HOST, "<BUN>"\)/);
  assert.doesNotMatch(src, /spawnSync\(BUN_HOST/, "nothing runs the host's spelling");
});

/** The first `bun` on PATH, or null. */
function hostBun() {
  for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
    if (dir && existsSync(join(dir, "bun"))) return join(dir, "bun");
  }
  return null;
}

test("Linux end to end: Bun under a short or a long directory captures the doctor's rows as the BEFORE baseline", {
  timeout: 300_000,
  skip: process.platform !== "linux" ? "the 80-column variants need the Linux pty runner" : hostBun() ? false : "no bun on PATH",
}, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-capture-bun-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const variants = ["tty-color-80", "no-color", "ascii-locale"];
  for (const [label, sub] of [["short", "b"], ["long", join("a".repeat(40), "node_modules", ".bin")]]) {
    mkdirSync(join(dir, label, sub), { recursive: true });
    const bun = join(dir, label, sub, "bun");
    symlinkSync(hostBun(), bun);
    const out = join(dir, label, "out");
    const run = spawnSync(process.execPath, [CAPTURE, "--out", out, "--only", "^doctor-fresh$", "--variants", variants.join(",")], {
      encoding: "utf8", timeout: 140_000, env: { ...captureEnv(), UX_BUN: bun },
    });
    assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-2000));
    const diffs = compareCaptures(join(ROOT, "tests", "ux-before", "linux"), out, { variants, only: /^doctor\/doctor-fresh$/ });
    assert.deepEqual(diffs, [], `Bun under a ${label} directory (${bun.length} chars):\n${diffs.join("\n")}`);
  }
});

// ----------------------------------------------------------- tar, git, paths
test("tar: System32's bsdtar on Windows (GNU tar reads `C:` as a host); `tar` elsewhere", () => {
  assert.equal(tarBinary({ windows: true, env: { SystemRoot: "C:\\Windows" } }), "C:\\Windows\\System32\\tar.exe");
  assert.equal(tarBinary({ windows: true, env: { SYSTEMROOT: "D:\\WINNT" } }), "D:\\WINNT\\System32\\tar.exe");
  assert.equal(tarBinary({ windows: true, env: {} }), "C:\\Windows\\System32\\tar.exe");
  assert.equal(tarBinary({ windows: false, env: { SystemRoot: "C:\\Windows" } }), "tar");
});

test("clone: --no-local on Windows only", () => {
  assert.deepEqual(cloneArgs(["clone", "-q", "--bare", "a", "b"], { windows: true }), ["clone", "--no-local", "-q", "--bare", "a", "b"]);
  assert.deepEqual(cloneArgs(["clone", "-q", "--bare", "a", "b"]), ["clone", "-q", "--bare", "a", "b"]);
});

test("a failed prep step reports status, signal, error and both streams (the silent `git clone` of run 42236936458)", () => {
  const msg = describeFailure("git clone -q --bare A B", { status: 128, signal: null, stdout: "", stderr: "fatal: could not create work tree dir 'B'\n" });
  assert.equal(msg, "git clone -q --bare A B: status 128; stderr: fatal: could not create work tree dir 'B'");
  assert.match(describeFailure("x", { status: null, signal: "SIGKILL", error: Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" }), stdout: null, stderr: null }),
    /^x: status null; signal SIGKILL; error ETIMEDOUT spawnSync git ETIMEDOUT$/);
});

test("Windows path normalisation covers the long name, JSON escaping, forward slashes and a lower-case drive", () => {
  const short = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ux-kit-ab12\\kit";
  const long = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ux-kit-ab12\\kit";
  const opts = { windows: true, realpath: (p) => (p === short ? long : p) };
  const forms = pathForms(short, opts);
  for (const f of [short, long, long.replace(/\\/g, "\\\\"), long.replace(/\\/g, "/"), "c:" + long.slice(2)]) assert.ok(forms.includes(f), f);
  const json = JSON.stringify({ detail: `${long}\\proxy\\config.yaml`, other: `${short}/logs` });
  assert.equal(swapPath(json, short, "<KIT>", opts), '{"detail":"<KIT>\\\\proxy\\\\config.yaml","other":"<KIT>/logs"}');
  assert.deepEqual(pathForms("/tmp/ux-kit-ab/kit"), ["/tmp/ux-kit-ab/kit"], "POSIX keeps the original single form");
});

// ------------------------------------------------------------- comparison
function captureSet(root, files, manifest) {
  for (const [rel, text] of Object.entries(files)) { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); }
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
}

test("compare: a failed baseline capture fails loudly; volatile values never hide a kit change", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-compare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const m = (id, extra = {}) => ({ group: "g", id, variant: "pipe", exit: 0, ...extra });
  captureSet(join(dir, "base"), { "g/a/pipe.txt": "OK used 14h ago\n", "g/b/pipe.txt": "x\n" }, [m("a"), m("b"), m("c", { exit: undefined, error: "fixture proxy did not start" })]);
  captureSet(join(dir, "same"), { "g/a/pipe.txt": "OK used 1d ago\n", "g/b/pipe.txt": "x\n", "g/c/pipe.txt": "y\n" }, [m("a"), m("b"), m("c")]);
  assert.deepEqual(compareCaptures(join(dir, "base"), join(dir, "same")),
    ["unexpected: g/c/pipe.txt", "baseline capture error: g/c/pipe: fixture proxy did not start"]);
  captureSet(join(dir, "changed"), { "g/a/pipe.txt": "FAIL used 1d ago\n", "g/b/pipe.txt": "x\n" }, [m("a", { exit: 1 }), m("b"), m("c", { error: "boom" })]);
  const diffs = compareCaptures(join(dir, "base"), join(dir, "changed"), { only: /^g\/(a|b)$/ });
  assert.deepEqual(diffs, ['differs: g/a/pipe.txt line 1\n  before: "OK used <AGE> ago"\n  now:    "FAIL used <AGE> ago"', "exit code: g/a/pipe was 0, now 1"]);
});

// ------------------------------------------- git under Git Bash (staging/06)
const GIT = "C:\\Program Files\\Git";
const gitTree = new Set([`${GIT}\\cmd\\git.exe`, `${GIT}\\bin\\git.exe`, `${GIT}\\mingw64\\bin\\git.exe`, "D:\\tools\\portable-git\\git.exe"]);
const exists = (p) => gitTree.has(p);

test("windows git: any git.exe of a Git for Windows tree maps to its cmd launcher", () => {
  // A `shell: bash` step: mingw64\bin and usr\bin come first.
  assert.equal(windowsGitDir(`${GIT}\\mingw64\\bin;${GIT}\\usr\\bin;C:\\Windows\\System32`, { exists }), `${GIT}\\cmd`);
  // pwsh / cmd: Git\bin or Git\cmd, with or without a trailing backslash.
  assert.equal(windowsGitDir(`C:\\Windows;${GIT}\\bin;${GIT}\\cmd`, { exists }), `${GIT}\\cmd`);
  assert.equal(windowsGitDir(`${GIT}\\cmd\\`, { exists }), `${GIT}\\cmd`);
  // A git.exe outside a Git for Windows tree is used as found; no git at all gives null.
  assert.equal(windowsGitDir("D:\\tools\\portable-git;" + `${GIT}\\cmd`, { exists }), "D:\\tools\\portable-git");
  assert.equal(windowsGitDir("C:\\Windows\\System32", { exists }), null);
  assert.equal(windowsGitDir(`${GIT}\\mingw64\\bin`, { exists: (p) => p === `${GIT}\\mingw64\\bin\\git.exe` }), `${GIT}\\mingw64\\bin`, "no launcher: keep the binary");
});

test("windows fixture env: Git Bash state and the fixture's own variables are dropped, the Windows runtime is kept", () => {
  const host = {
    Path: "x", TEMP: "t", tmp: "t2", MSYSTEM: "MINGW64", MSYSTEM_PREFIX: "/mingw64", MINGW_PREFIX: "/mingw64", MSYS: "winsymlinks", EXEPATH: "C:\\Program Files\\Git\\bin",
    ORIGINAL_PATH: "p", SHLVL: "1", PWD: "/d/a", OLDPWD: "/", SHELL: "/usr/bin/bash", _: "/usr/bin/node", CHERE_INVOKING: "1",
    SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATHEXT: ".COM;.EXE", ComSpec: "C:\\Windows\\system32\\cmd.exe",
    HOMEDRIVE: "C:", HOMEPATH: "\\Users\\runneradmin", USERNAME: "runneradmin", NUMBER_OF_PROCESSORS: "4", PROCESSOR_ARCHITECTURE: "AMD64",
    TERM: "xterm-256color", CI: "true", ZCODE_KIT_HOME: "z", NODE_OPTIONS: "--x",
  };
  assert.deepEqual(Object.keys(fixtureBaseEnv(host, { windows: true })).sort(),
    ["ComSpec", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS", "PATHEXT", "PROCESSOR_ARCHITECTURE", "SystemRoot", "USERNAME", "WINDIR"]);
});

test("POSIX fixture env: exactly the original Phase 1C filter", () => {
  const host = { PATH: "/usr/bin", HOME: "/h", LANG: "C.UTF-8", MSYSTEM: "x", SHELL: "/bin/sh", TERM: "xterm", COLUMNS: "80", CI: "1", ZCODE_X: "1", https_proxy: "p", NO_COLOR: "1", CLICOLOR_FORCE: "1" };
  assert.deepEqual(fixtureBaseEnv(host), { PATH: "/usr/bin", HOME: "/h", LANG: "C.UTF-8", MSYSTEM: "x", SHELL: "/bin/sh" });
});

test("CI: the equivalence step runs under the runner's default shell on both legs", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8").replace(/\r\n/g, "\n");
  const job = ci.slice(ci.indexOf("\n  ux-before:\n"), ci.indexOf("\n  memory-budget:\n"));
  const step = (name) => job.slice(job.indexOf(`- name: ${name}`)).split(/\n      - /)[0];
  const equivalence = step("Before-equivalence (byte for byte)");
  assert.match(equivalence, /run: npm run test:ux-before/);
  assert.doesNotMatch(equivalence, /shell:/, "the runner default, pwsh on windows: a bash step would leak MSYS state into the capture");
});

test("capture.mjs builds the fixture env and the Windows git dir through host.mjs (wiring of the Windows-only branch)", () => {
  const src = readFileSync(join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "utf8");
  assert.match(src, /const env = fixtureBaseEnv\(process\.env, \{ windows: IS_WIN \}\);/);
  assert.match(src, /windowsGitDir\(process\.env\.PATH \?\? process\.env\.Path, \{ exists: existsSync \}\)/);
  assert.doesNotMatch(src, /for \(const \[k, v\] of Object\.entries\(process\.env\)\)/, "no second, unfiltered env copy");
});

// --------------------------------------- git diffstat (windows, run 42259233373)
const DIFFSTAT_LF = [" package.json | 2 +-", " 1 file changed, 1 insertion(+), 1 deletion(-)"];
const DIFFSTAT_LF_TTY = [" package.json | 2 \x1b[32m+\x1b[m\x1b[31m-\x1b[m", " 1 file changed, 1 insertion(+), 1 deletion(-)"];
const DIFFSTAT_CRLF = (n) => [` package.json | ${2 * n} ${"+".repeat(30)}${"-".repeat(30)}`, ` 1 file changed, ${n} insertions(+), ${n} deletions(-)`];
const ffwd = (stat) => ["Updating <SHA>..<SHA>", "Fast-forward", ...stat, "update: refreshing consented integrations", ""].join("\n");

test("git's diffstat of the fixture update normalises whatever the checkout's line endings or package.json length", () => {
  const want = normaliseVolatile(ffwd(DIFFSTAT_LF));
  for (const stat of [DIFFSTAT_LF_TTY, DIFFSTAT_CRLF(34), DIFFSTAT_CRLF(35)]) assert.equal(normaliseVolatile(ffwd(stat)), want);
  assert.equal(want, "Updating <SHA>..<SHA>\nFast-forward\n package.json | <N> <GRAPH>\n <N> file(s) changed, <N> insertion(s)(+), <N> deletion(s)(-)\nupdate: refreshing consented integrations\n");
  assert.notEqual(normaliseVolatile(ffwd([" cli/zcode-kit.mjs | 2 +-", DIFFSTAT_LF[1]])), want, "the path stays: a different file is a difference");
});

// The TTY progress of `proxy start|stop|restart` and `doctor --fix`
// as the capture stores it (\r turned into \n): one line per spinner frame
// (colour: ESC[K before every redraw; NO_COLOR: a line of spaces after each).
const frames = (label, n, { colour = true, elapsedFrom = Infinity } = {}) => {
  const lines = [""];
  for (let i = 0; i < n; i++) {
    const text = `${"|/-\\"[i % 4]} ${label}${i >= elapsedFrom ? ` (${2 + Math.floor((i - elapsedFrom) / 10)} s)` : ""}`;
    lines.push(colour && i > 0 ? `\x1b[K${text}` : text);
    if (!colour) lines.push(" ".repeat(text.length));
  }
  return lines.join("\n") + "\n";
};

test("the step's spinner frames and elapsed time normalise whatever the start or stop took", () => {
  for (const colour of [true, false]) {
    for (const label of ["Proxy start", "Proxy stop", "Proxy start (--fix)"]) {
      const result = `${colour ? "\x1b[K" : ""}  ✓ OK    ${label}  started (pid <PID>)\n`;
      const quick = normaliseVolatile(frames(label, 3, { colour }) + result);
      const slow = normaliseVolatile(frames(label, 47, { colour, elapsedFrom: 20 }) + result.replace(label, `${label} (5 s)`));
      assert.equal(quick, slow, `${label} colour=${colour}`);
      assert.equal(quick, `\n<SPINNER> ${label}\n${result}`);
    }
  }
  assert.equal(normaliseVolatile("OK  Proxy start (3 s) - started (pid <PID>)\n"), "OK  Proxy start - started (pid <PID>)\n", "the plain result row too");
});

test("the spinner rules touch no other line: other labels, list items and kit text stay", () => {
  const kit = [
    "- Proxy started by hand",
    "| Proxy dependencies",
    "  - Proxy start",
    "- skipped: Proxy start is not needed",
    "Proxy start took (3 seconds)",
    "doctor: 1 failed (2 s)",
    "",
  ].join("\n");
  assert.equal(normaliseVolatile(kit), kit);
});

test("the diffstat rules leave kit lines strict: indentation, trailing text and other wording stay", () => {
  const kit = [
    "  [OK]   OMP / Oh My Pi | 2 +",
    "  package.json | 2 +-",
    " package.json | 2 +- (refreshed)",
    " package.json | two +-",
    " 1 file changed, see install.log",
    "doctor: 1 file changed, 2 insertions(+)",
    "",
  ].join("\n");
  assert.equal(normaliseVolatile(kit), kit);
});

test("Linux end to end: a CRLF package.json (as on a windows checkout) changes only git's diffstat", {
  timeout: 120_000,
  skip: process.platform === "win32" ? "builds a POSIX fixture kit" : false,
}, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-capture-crlf-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const kit = join(dir, "kit");
  for (const sub of ["cli", "lib", "proxy"]) cpSync(join(ROOT, sub), join(kit, sub), { recursive: true });
  mkdirSync(join(kit, "zcode-proxy-src"), { recursive: true });
  cpSync(join(ROOT, "zcode-proxy-src", "package.json"), join(kit, "zcode-proxy-src", "package.json"));
  symlinkSync(join(ROOT, "zcode-proxy-src", "src"), join(kit, "zcode-proxy-src", "src"));
  symlinkSync(join(ROOT, "zcode-proxy-src", "node_modules"), join(kit, "zcode-proxy-src", "node_modules"));
  // The output module's token set and width core re-export the
  // shared files under zcode-proxy-src/src/tui — part of every real kit
  // layout. Here the fixture symlinks src/ to this checkout, so the files
  // are already reachable and a copy would be src == dest.
  if (!existsSync(join(kit, "zcode-proxy-src", "src", "tui", "tokens.mjs"))) {
    mkdirSync(join(kit, "zcode-proxy-src", "src", "tui"), { recursive: true });
    for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(ROOT, "zcode-proxy-src", "src", "tui", f), join(kit, "zcode-proxy-src", "src", "tui", f));
  }
  writeFileSync(join(kit, "package.json"), readFileSync(join(ROOT, "package.json"), "utf8").replace(/\r?\n/g, "\r\n"));
  const out = join(dir, "out");
  const run = spawnSync(process.execPath, [join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "--kit", kit, "--out", out,
    "--only", "^update-checkout$", "--variants", "pipe,ci"], {
    encoding: "utf8", timeout: 110_000,
    env: captureEnv(),
  });
  assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-2000));
  const lines = readFileSync(join(out, "update", "update-checkout", "pipe.txt"), "utf8").split("\n");
  const n = readFileSync(join(ROOT, "package.json"), "utf8").split("\n").length - 1;
  assert.ok(lines.includes(` 1 file changed, ${n} insertions(+), ${n} deletions(-)`), "the CRLF rewrite really changed every line");
  assert.deepEqual(compareCaptures(join(ROOT, "tests", "ux-before", "linux"), out, { only: /^update\/update-checkout$/, variants: ["pipe", "ci"] }), []);
});

// Captures run in parallel (json-superset and this file under
// `node --test`, or two checkouts at once). Every scenario takes a free port of
// its own, so a "down" capture never sees another capture's fixture proxy and
// a "running" capture never finds its port taken. Both stay byte-identical to
// the BEFORE baseline because the port is written back as 18458.
test("Linux end to end: two captures at once, one with the fixture proxy running and one down, both match the baseline", {
  timeout: 240_000,
  skip: process.platform === "win32" ? "the linux baseline is compared" : false,
}, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ux-capture-parallel-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const capture = (name, only) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CAPTURE, "--kit", ROOT, "--out", join(dir, name), "--only", only, "--variants", "pipe,ci"], { env: captureEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("close", (status) => resolve({ status, output }));
  });
  const [running, down] = await Promise.all([
    capture("running", "^proxy-status-(running|json-running)$"),
    capture("down", "^proxy-status-(down|json-down)$"),
  ]);
  assert.equal(running.status, 0, running.output.slice(-2000));
  assert.equal(down.status, 0, down.output.slice(-2000));
  const baseline = join(ROOT, "tests", "ux-before", "linux");
  assert.deepEqual([
    ...compareCaptures(baseline, join(dir, "running"), { only: /^proxy\/proxy-status-(running|json-running)$/, variants: ["pipe", "ci"] }),
    ...compareCaptures(baseline, join(dir, "down"), { only: /^proxy\/proxy-status-(down|json-down)$/, variants: ["pipe", "ci"] }),
  ], []);
});

test("the port write-back can only touch the port: no committed capture holds a number from the kernel-port floor (20000) up", () => {
  const capture = readFileSync(CAPTURE, "utf8");
  assert.match(capture, /^const KERNEL_PORT_FLOOR = 20000;$/m, "the floor this test pins");
  const high = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== "INDEX.md" && e.name !== "manifest.json") {
        // Word-bounded, as normalise() matches the port (a digit run inside a hash is no match).
        for (const [n] of readFileSync(p, "utf8").matchAll(/\b\d{5}\b/g)) if (Number(n) >= 20000 && Number(n) <= 65535) high.push(`${p.slice(ROOT.length + 1)}: ${n}`);
      }
    }
  };
  for (const set of ["linux", "windows"]) if (existsSync(join(ROOT, "tests", "ux-before", set))) walk(join(ROOT, "tests", "ux-before", set));
  assert.deepEqual(high, []);
});
