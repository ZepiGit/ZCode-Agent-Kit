// Seam 5 spawn tests, ticket 40 (ADR-0005 stream contract, Story 93; A-05,
// A-09): the real `zcode-kit` entry, spawned in a temp kit copy with its
// stdout and stderr piped apart, against a stand-in proxy on a free loopback
// port in this process (an authenticated /health that proves the kit's
// identity, or a foreign listener that does not). Reports and data land on
// stdout, progress, results and error blocks on stderr, exit codes as before,
// and the key never reaches a pipe.
//
// The temp kit is its own state directory (no ZCODE_KIT_STATE_DIR, nothing
// copied from the checkout's state) with a synthetic key: no real credential (B2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { freePort } from "./free-port.mjs";

const ROOT = join(import.meta.dirname, "..");
const KEY = "synthetic-streams-key-not-a-secret";

async function kitCopy(t, { key = true } = {}) {
  const port = await freePort();
  const root = mkdtempSync(join(tmpdir(), "cli-ux-streams-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const member of ["cli", "lib"]) cpSync(join(ROOT, member), join(root, member), { recursive: true });
  mkdirSync(join(root, "proxy"));
  mkdirSync(join(root, "home"));
  mkdirSync(join(root, "logs"));
  mkdirSync(join(root, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const file of ["tokens.mjs", "width-core.mjs"]) cpSync(join(ROOT, "zcode-proxy-src", "src", "tui", file), join(root, "zcode-proxy-src", "src", "tui", file));
  for (const member of ["package.json", "proxy/zcode-proxy-manager.mjs"]) cpSync(join(ROOT, member), join(root, member));
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nmodels:\n  - glm-5.3\n  - glm-5.3-flash\n`);
  if (key) writeFileSync(join(root, ".proxykey"), KEY + "\n");
  return { root, port };
}

/** A stand-in proxy: "ours" proves the identity with the kit key; "foreign" answers 401. */
async function standIn(t, port, mode) {
  const server = http.createServer((req, res) => {
    if (mode === "foreign" || req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end("{}");
    if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", provider: "zai", details: { pid: 4242, uptimeSec: 3725, rssMB: 182 } }));
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "glm-5.3" }] }));
    if (req.url === "/quota") return res.end(JSON.stringify({ balances: [{ showName: "GLM Coding Lite", remainingUnits: 4120, totalUnits: 6000, unitType: "prompts", expiresAt: 1767139200 }] }));
    return res.writeHead(404).end("{}");
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
}

/** zcode-kit spawned with piped stdout and stderr (the stand-in answers from this process). */
function kit(root, args, { manager = false, nodeArgs = [] } = {}) {
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home") };
  for (const name of Object.keys(env)) if (/^(ZCODE_|CI$|FORCE_COLOR$|NO_COLOR$)/.test(name)) delete env[name];
  return new Promise((resolveRun, reject) => {
    const entry = manager ? join(root, "proxy", "zcode-proxy-manager.mjs") : join(root, "cli", "zcode-kit.mjs");
    const child = spawn(process.execPath, [...nodeArgs, entry, ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => { stdout += c; });
    child.stderr.setEncoding("utf8").on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.once("error", reject);
    child.once("close", (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}

const ESC = /\x1b/;

test("status and proxy status of the own proxy: the report on stdout, nothing on stderr, exit 0, no key in the pipe", { timeout: 120_000 }, async (t) => {
  const { root, port } = await kitCopy(t);
  await standIn(t, port, "ours");
  for (const args of [["status"], ["proxy", "status"]]) {
    const run = await kit(root, args);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stderr, "", `${args.join(" ")}: nothing on stderr`);
    assert.equal(run.stdout.split("\n")[0], `running on 127.0.0.1:${port}, up 1 h 02 min (pid 4242)`);
    assert.equal((run.stdout.match(/^Connection details/gm) ?? []).length, 1);
    assert.ok(!run.stdout.includes(KEY), "the key never reaches a pipe");
    assert.doesNotMatch(run.stdout, ESC, "no escape sequences off a TTY");
  }
  const json = await kit(root, ["proxy", "status", "--json"]);
  assert.equal(json.code, 0);
  assert.equal(json.stderr, "");
  assert.equal(JSON.parse(json.stdout).health, "ours", "stdout is one JSON document");
});

test("a foreign listener: status, start and stop write only an error block to stderr, with today's exit codes (1, 3, 3)", { timeout: 120_000 }, async (t) => {
  const { root, port } = await kitCopy(t);
  await standIn(t, port, "foreign");
  for (const [args, code, what] of [
    [["proxy", "status"], 1, `Port ${port} is answered by another service`],
    [["proxy", "start"], 3, `Port ${port} is in use by another service`],
    [["proxy", "stop"], 3, `Port ${port} is answered by another service`],
  ]) {
    const run = await kit(root, args);
    assert.equal(run.code, code, `${args.join(" ")}: ${run.stderr}`);
    assert.equal(run.stdout, "", `${args.join(" ")}: nothing on stdout`);
    assert.match(run.stderr, new RegExp(`^FAIL  ${what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n  why: \\S.*\\n(  next: \\S.*\\n)+  exit: ${code}\\n$`, "m"), args.join(" "));
  }
});

test("proxy start on the own running proxy: the result row on stderr, the connection details once on stdout", { timeout: 120_000 }, async (t) => {
  const { root, port } = await kitCopy(t);
  await standIn(t, port, "ours");
  const run = await kit(root, ["proxy", "start"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, "Proxy start ...\nOK  Proxy start - already running\n");
  assert.match(run.stdout, /^Connection details \(manual clients\) -+\n/);
  assert.equal((run.stdout.match(/^Connection details/gm) ?? []).length, 1);
  assert.match(run.stdout, new RegExp(`^  OpenAI base URL     http://127\\.0\\.0\\.1:${port}/v1$`, "m"));
  assert.ok(!run.stdout.includes(KEY));
});

test("a missing key: start (exit 5) and status (exit 1) name zcode-kit setup on stderr, never node setup.mjs", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t, { key: false });
  const start = await kit(root, ["proxy", "start"]);
  assert.equal(start.code, 5, start.stderr);
  assert.equal(start.stdout, "");
  assert.match(start.stderr, /^FAIL {2}The local proxy key is missing\n {2}why: .*\.proxykey not found, .+\n {2}next: zcode-kit setup\n {2}exit: 5\n$/m);
  const status = await kit(root, ["status"]);
  assert.equal(status.code, 1);
  assert.equal(status.stdout, "");
  assert.match(status.stderr, /^ {2}next: zcode-kit setup$/m);
  assert.doesNotMatch(start.stderr + status.stderr, /node setup\.mjs/);
});

test("proxy logs: the lines on stdout as data (filters included), a missing log is a note on stderr", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  const none = await kit(root, ["proxy", "logs"]);
  assert.deepEqual([none.code, none.stdout], [0, ""]);
  assert.match(none.stderr, /^INFO {2}no proxy log yet at .+proxy\.log\n$/);
  writeFileSync(join(root, "logs", "proxy.log"), `r001 ANT glm-5.3 200 stream 812ms\nr002 ANT glm-5.3 429 batch 233ms\n[manager 2026-11-06T10:00:00.000Z] key ${KEY}\n`);
  const all = await kit(root, ["proxy", "logs"]);
  assert.deepEqual([all.code, all.stderr], [0, ""]);
  assert.equal(all.stdout.split("\n").length, 4, "three lines");
  assert.ok(!all.stdout.includes(KEY), "redacted");
  const warn = await kit(root, ["proxy", "logs", "--level", "warn"]);
  assert.deepEqual([warn.code, warn.stdout, warn.stderr], [0, "r002 ANT glm-5.3 429 batch 233ms\n", ""]);
  const bad = await kit(root, ["proxy", "logs", "--level", "loud"]);
  assert.deepEqual([bad.code, bad.stdout], [2, ""]);
  assert.match(bad.stderr, /^FAIL {2}--level takes warn or error\n/);
});

test("proxy logs filters span rotation before taking N, in order, with redaction before grep", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  writeFileSync(join(root, "logs", "proxy.log.1"), `WARN old-warning\nERROR old-error\nERROR old-key ${KEY}\n`);
  // More than N raw lines in the current file must not hide older matches.
  writeFileSync(join(root, "logs", "proxy.log"), "INFO new-1\nINFO new-2\nERROR new-error\n");
  for (const [args, expected] of [
    [["2", "--level", "warn"], "ERROR old-key <redacted>\nERROR new-error\n"],
    [["3", "--level", "error"], "ERROR old-error\nERROR old-key <redacted>\nERROR new-error\n"],
    [["2", "--grep", "old-"], "ERROR old-error\nERROR old-key <redacted>\n"],
    [["2", "--level", "error", "--grep", "<redacted>"], "ERROR old-key <redacted>\n"],
    [["2", "--grep", KEY], ""],
  ]) {
    const run = await kit(root, ["proxy", "logs", ...args]);
    assert.deepEqual([run.code, run.stdout, run.stderr], [0, expected, ""], args.join(" "));
  }
});

test("proxy logs reads a rotated-only log as data, filtered or unfiltered, not as a missing-log note", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  writeFileSync(join(root, "logs", "proxy.log.1"), `INFO old-info\nWARN old-warning\nERROR old-key ${KEY}\n`);
  for (const [args, expected] of [
    [["2"], "WARN old-warning\nERROR old-key <redacted>\n"],
    [["2", "--level", "warn"], "WARN old-warning\nERROR old-key <redacted>\n"],
    [["2", "--grep", "<redacted>"], "ERROR old-key <redacted>\n"],
    [["2", "--grep", KEY], ""],
  ]) {
    const run = await kit(root, ["proxy", "logs", ...args]);
    assert.deepEqual([run.code, run.stdout, run.stderr], [0, expected, ""], args.join(" "));
  }
});

// Seams 2/5: real manager and kit entry points, synthetic known key only.
// The byte window starts inside the key; blank lines keep the fixture large
// without pushing the leaked fragment out of the requested line count.
test("bounded log tails never expose a secret fragment cut by the byte window", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  const secret = "synthetic-prefix-] ERROR partial-leak-marker warn: tail";
  writeFileSync(join(root, ".proxykey"), secret + "\n");
  for (const file of ["proxy.log", "proxy.log.1"]) {
    for (const cut of [secret.indexOf("ERROR"), secret.indexOf("ERROR") - 2]) {
      for (const [name, args, window, manager] of [
        ["manager", ["logs", "40"], 64 * 1024, true],
        ["kit", ["proxy", "logs", "40"], 64 * 1024, false],
        ["grep", ["proxy", "logs", "40", "--grep", "partial-leak-marker"], 1024 * 1024, false],
        ["warn", ["proxy", "logs", "40", "--level", "warn"], 1024 * 1024, false],
        ["error", ["proxy", "logs", "40", "--level", "error"], 1024 * 1024, false],
      ]) {
        await t.test(`${file}, cut=${cut}, ${name}`, async () => {
          for (const member of ["proxy.log", "proxy.log.1"]) rmSync(join(root, "logs", member), { force: true });
          if (file === "proxy.log.1") writeFileSync(join(root, "logs", "proxy.log"), "INFO current\n");
          const complete = "ERROR complete-line\n";
          const remainder = secret.slice(cut) + "\n";
          const prefix = "x".repeat(5 * 1024 * 1024 - window - cut);
          writeFileSync(join(root, "logs", file), prefix + secret + "\n" + "\n".repeat(window - Buffer.byteLength(remainder + complete)) + complete);
          const run = await kit(root, args, { manager });
          assert.equal(run.code, 0, run.stderr);
          assert.equal(run.stderr, "");
          assert.equal(run.stdout.includes("partial-leak-marker"), false, "a cut known secret must never reach stdout");
          if (name === "grep") assert.equal(run.stdout, "", "grep sees no incomplete first line");
          else assert.ok(run.stdout.includes(complete), "the following complete line is preserved");
        });
      }
    }
  }
});

test("bounded log tails omit newline-free cut windows but preserve the first line at byte zero", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  for (const file of ["proxy.log", "proxy.log.1"]) {
    for (const truncated of [false, true]) {
      for (const [name, args, manager] of [
        ["manager", ["logs", "40"], true],
        ["kit", ["proxy", "logs", "40"], false],
        ["grep", ["proxy", "logs", "40", "--grep", "first-line"], false],
      ]) {
        await t.test(`${file}, truncated=${truncated}, ${name}`, async () => {
          for (const member of ["proxy.log", "proxy.log.1"]) rmSync(join(root, "logs", member), { force: true });
          const line = `first-line ${KEY}`;
          writeFileSync(join(root, "logs", file), (truncated ? "x".repeat(2 * 1024 * 1024) : "") + line);
          const run = await kit(root, args, { manager });
          // The manager retains its legacy console.log newline for an empty tail.
          const expected = truncated ? (manager ? "\n" : "") : "first-line <redacted>\n";
          assert.deepEqual([run.code, run.stdout, run.stderr], [0, expected, ""]);
        });
      }
    }
  }
});

test("log tail reads the opened file even if rotation replaces or removes its path", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  // Filesystem-boundary injection: rotate immediately after a successful open.
  // The real CLI and shared reader still perform the read and render the result.
  const preload = join(root, "rotate-after-open.mjs");
  writeFileSync(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const open = fs.openSync;
let rotated = false;
fs.openSync = function(file, ...args) {
  const fd = open(file, ...args);
  if (!rotated && file === join(process.cwd(), "logs", "proxy.log")) {
    rotated = true;
    fs.renameSync(file, file + ".1");
    if (process.argv.includes("--grep")) fs.writeFileSync(file, "replacement\\n");
  }
  return fd;
};
syncBuiltinESMExports();
`);
  for (const [args, manager] of [[["logs", "1"], true], [["proxy", "logs", "1", "--grep", "opened"], false]]) {
    await t.test(manager ? "renamed path absent" : "renamed path replaced", async () => {
      writeFileSync(join(root, "logs", "proxy.log"), "ERROR opened-file\n");
      const run = await kit(root, args, { manager, nodeArgs: ["--import", pathToFileURL(preload).href] });
      assert.deepEqual([run.code, run.stdout, run.stderr], [0, "ERROR opened-file\n", ""]);
    });
  }
});

test("doctor: the report on stdout only (stderr empty), one verdict, exit 1 when a check failed", { timeout: 120_000 }, async (t) => {
  const { root } = await kitCopy(t);
  const run = await kit(root, ["doctor"]);
  assert.equal(run.code, 1);
  assert.equal(run.stderr, "", "doctor's rows and verdict are a report: stdout (ADR-0005)");
  assert.equal((run.stdout.match(/^doctor: /gm) ?? []).length, 1);
  assert.match(run.stdout.trimEnd().split("\n").at(-1), /^doctor: \d+ failed, .* -> exit 1$/);
  assert.doesNotMatch(run.stdout, ESC);
});
