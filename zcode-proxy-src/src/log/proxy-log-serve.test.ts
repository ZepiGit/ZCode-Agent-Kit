/**
 * Seam 4: the `proxy.log` writer of a spawned `serve`.
 * The manager sets `ZCODE_KIT_LOG_DIR` at every spawn; with it, the proxy
 * opens `<dir>/proxy.log` through its size-capped writer, and console,
 * process.stdout and process.stderr go through that writer. It rotates the
 * file itself at 5 MB (unlink `.1` → rename → reopen), with kit readers and
 * appenders open; a handle that blocks the rename leaves it appending, with
 * one WARN event line, and it retries at every check.
 *
 * Each test spawns the real entry point against a loopback mock upstream,
 * with the egress guard preloaded, on a port the kernel just handed out. A
 * second preload (`__fixtures__/stdio-lines.ts`) makes the proxy write
 * test-chosen text to its own process.stdout / process.stderr on request.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SRC = join(import.meta.dir, "..");
const MiB = 1024 * 1024;
const isPosix = process.platform !== "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

/** A loopback port the kernel just handed out and that is free again. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** A loopback upstream that answers every request at once. */
async function mockUpstream(): Promise<{ server: Server; base: string }> {
  const server = createHttpServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "glm-4.6",
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

interface Proxy {
  child: ChildProcess;
  dir: string;
  logDir: string;
  log: string;
  /** What reached the proxy's inherited stdout and stderr (not the writer). */
  inherited(): string;
  stopToken: string;
  /** Make the proxy write these chunks to its own stdout/stderr (in batches). */
  emit(writes: Array<{ stream: "stdout" | "stderr"; text: string }>, options?: { batch?: number; pauseMs?: number }): void;
}

async function spawnProxy({ logDir = true }: { logDir?: boolean } = {}): Promise<Proxy> {
  const mock = await mockUpstream();
  servers.push(mock.server);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "t33-serve-"));
  dirs.push(dir);
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const key = randomBytes(24).toString("base64url");
  const config = join(dir, "config.yaml");
  writeFileSync(config, [
    "server:", `  port: ${port}`, '  host: "127.0.0.1"',
    "auth:", `  proxyApiKey: "${key}"`,
    "provider: zai", "plan: coding-plan",
    "providers:", "  zai:", `    anthropicBase: "${mock.base}/api/anthropic"`, `    openaiBase: "${mock.base}/api/coding/paas/v4"`,
    "  bigmodel:", `    anthropicBase: "${mock.base}/api/anthropic"`, `    openaiBase: "${mock.base}/api/coding/paas/v4"`,
    "defaultModel: glm-4.6", "models:", "  - glm-4.6",
    "claim:", "  enabled: false", "  auto: false",
    "endpointRouting:", "  enabled: false",
    "clientSigning:", "  enabled: false",
    "mcp:", "  enabled: false",
    "async:", "  enabled: false",
    "logging:", "  level: info", "",
  ].join("\n"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^ZCODE_|^CAPTCHA_|^(?:https?|all|no)_proxy$/i.test(k)) continue;
    env[k] = v;
  }
  const stopToken = randomBytes(32).toString("base64url");
  const trigger = join(dir, "stdio-job.json");
  const logs = join(dir, "logs"); // not created here: the writer creates it
  Object.assign(env, {
    HOME: home, USERPROFILE: home, TMPDIR: dir,
    ZCODE_PROXY_CREDENTIALS_PATH: join(dir, "credentials.json"),
    ZCODE_PROXY_CREDENTIAL_SECRET: randomBytes(24).toString("hex"),
    ZCODE_PROXY_ACCOUNTS_PATH: join(dir, "accounts.json"),
    ZCODE_KIT_STOP_TOKEN: stopToken,
    FIXTURE_STDIO_TRIGGER: trigger,
    ...(logDir ? { ZCODE_KIT_LOG_DIR: logs } : {}),
  });
  const store = join(SRC, "auth", "store.ts");
  const made = spawnSync(process.execPath, ["-e", `import { saveCredential } from ${JSON.stringify(store)};
await saveCredential({ apiKey: "fixture-key-" + crypto.randomUUID(), secret: "fixture-secret-" + crypto.randomUUID(), provider: "zai" });`], { env, encoding: "utf8", timeout: 30_000 });
  if (made.status !== 0) throw new Error(`fixture credential: ${made.stderr}`);

  const child = spawn(process.execPath, [
    "--preload", join(SRC, "runtime", "__fixtures__", "egress-guard.ts"),
    "--preload", join(SRC, "log", "__fixtures__", "stdio-lines.ts"),
    join(SRC, "index.ts"), "serve", config,
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let inherited = "";
  child.stdout!.on("data", (d) => { inherited += d; });
  child.stderr!.on("data", (d) => { inherited += d; });
  const log = join(logs, "proxy.log");
  const listening = `listening on http://127.0.0.1:${port}`;
  await until(() => inherited.includes(listening) || (existsSync(log) && readFileSync(log, "utf8").includes(listening)), 20_000, () => inherited);
  return {
    child, dir, logDir: logs, log, inherited: () => inherited, stopToken,
    emit(writes, options = {}) {
      const temp = `${trigger}.tmp`;
      writeFileSync(temp, JSON.stringify({ writes, ...options }));
      renameSync(temp, trigger);
    },
  };
}

async function until(cond: () => boolean, ms: number, detail: () => string = () => ""): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`condition not reached: ${detail().slice(-1500)}`);
    await Bun.sleep(10);
  }
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");

const dirs: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) {
      const exited = new Promise((r) => c.once("exit", r));
      c.kill("SIGKILL");
      await exited;
    }
  }
  for (const s of servers.splice(0)) { s.closeAllConnections(); s.close(); }
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { await Bun.sleep(500); rmSync(d, { recursive: true, force: true }); }
  }
});

describe("serve with ZCODE_KIT_LOG_DIR: the proxy.log writer", () => {
  it("after the writer opens, a line written to process.stdout and one written to process.stderr appear unchanged in proxy.log", async () => {
    const p = await spawnProxy();
    const out = `stdout line ${randomBytes(4).toString("hex")}: tab\there, "quotes", ümlaut, = and [brackets]\n`;
    const err = `stderr line ${randomBytes(4).toString("hex")}: [captcha] warmup failed: ECONNREFUSED 127.0.0.1:1\n`;
    p.emit([{ stream: "stdout", text: out }, { stream: "stderr", text: err }]);
    await until(() => read(p.log).includes(err), 10_000, () => read(p.log) + p.inherited());
    const log = read(p.log);
    expect(log).toContain(out);
    expect(log).toContain(err);
    // The console lines of serve went through the writer too, not the inherited stdio.
    expect(log).toMatch(/^zcode-proxy listening on http:\/\/127\.0\.0\.1:\d+\n/m);
    expect(p.inherited()).not.toContain("listening on");
    expect(p.inherited()).not.toContain(out);
  }, 40_000);

  it("rotates at 5 MB while kit readers and appenders hold the file open: proxy.log.1 holds the old bytes, no line is lost, new files are 0o600", async () => {
    const p = await spawnProxy();
    // A kit appender (by path, like the manager's narration) fills the file to just under 5 MB.
    fillTo(p.log, 5 * MiB - 64 * 1024);
    const holder = await holdOpen(p.log, "kit");
    const seq = Array.from({ length: 2000 }, (_, i) => `proxy-seq-${String(i).padStart(5, "0")} ${"x".repeat(80)}\n`);
    p.emit(seq.map((text, i) => ({ stream: i % 2 ? "stderr" : "stdout", text })), { batch: 50, pauseMs: 5 });
    // Meanwhile the kit keeps appending by path.
    const appended: string[] = [];
    for (let k = 0; k < 100; k++) {
      const line = `[manager ${new Date().toISOString()}] kit-append-${k}\n`;
      // Like the real manager's appendLog: rotation can rename the file
      // between opens, so this appender may be the creator of the new file.
      appendFileSync(p.log, line, { mode: 0o600 });
      appended.push(line);
      await Bun.sleep(2);
    }
    await until(() => read(p.log).includes("proxy-seq-01999"), 20_000, () => read(p.log).slice(-500));
    await holder.release();

    expect(existsSync(`${p.log}.1`)).toBe(true);
    const old = read(`${p.log}.1`);
    const current = read(p.log);
    expect(old).toContain("zcode-proxy listening on");
    expect(old).toContain("#".repeat(1023));
    expect(statSync(`${p.log}.1`).size).toBeGreaterThanOrEqual(5 * MiB);
    expect(statSync(p.log).size).toBeLessThan(1 * MiB);
    const all = old + current;
    const seen = all.match(/^proxy-seq-\d{5} x+$/gm) ?? [];
    expect(seen.map((l) => `${l}\n`)).toEqual(seq);
    expect(current).toContain("proxy-seq-01999");
    for (const line of appended) expect(all.split(line).length - 1).toBe(1);
    if (isPosix) {
      expect(statSync(p.log).mode & 0o777).toBe(0o600);
      expect(statSync(p.logDir).mode & 0o777).toBe(0o700);
    }
  }, 60_000);

  it("never writes the stop token or the proxy key into proxy.log", async () => {
    const p = await spawnProxy();
    const key = /proxyApiKey: "([^"]+)"/.exec(readFileSync(join(p.dir, "config.yaml"), "utf8"))![1];
    p.emit([
      { stream: "stdout", text: `echoed stop token ${p.stopToken} end\n` },
      { stream: "stderr", text: `echoed key ${key} end\n` },
    ]);
    await until(() => read(p.log).includes("echoed key"), 10_000, () => read(p.log));
    const log = read(p.log);
    expect(log).toContain("echoed stop token <redacted> end\n");
    expect(log).toContain("echoed key <redacted> end\n");
    expect(log).not.toContain(p.stopToken);
    expect(log).not.toContain(key);
  }, 40_000);

  it.skipIf(!isPosix || isRoot)("POSIX: a rename the filesystem refuses keeps the writer appending, with one WARN event line, and the next check after the refusal ends rotates", async () => {
    const p = await spawnProxy();
    fillTo(p.log, 5 * MiB + 1024);
    const { chmodSync } = await import("node:fs");
    chmodSync(p.logDir, 0o500); // no entry may be renamed or removed: rename fails with EACCES
    try {
      const blocked = Array.from({ length: 50 }, (_, i) => `blocked-${String(i).padStart(3, "0")}\n`);
      p.emit(blocked.map((text) => ({ stream: "stdout" as const, text })), { batch: 5, pauseMs: 5 });
      await until(() => read(p.log).includes("blocked-049"), 10_000, () => read(p.log).slice(-500));
      expect(existsSync(`${p.log}.1`)).toBe(false);
      const log = read(p.log);
      for (const line of blocked) expect(log).toContain(line);
      expect(warnLines(log)).toHaveLength(1);
      expect(warnLines(log)[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z WARN proxy proxy\.log rotation blocked, appending and retrying at every check path=\S+ code=EACCES sizeBytes=\d+ limitBytes=5242880$/);
    } finally {
      chmodSync(p.logDir, 0o700);
    }
    p.emit([{ stream: "stderr", text: "after-release\n" }]);
    await until(() => existsSync(`${p.log}.1`) && read(p.log).includes("after-release"), 10_000, () => read(p.log).slice(-500));
    expect(read(`${p.log}.1`)).toContain("blocked-049\n");
    expect(warnLines(read(`${p.log}.1`) + read(p.log))).toHaveLength(1);
    expect(statSync(p.log).mode & 0o777).toBe(0o600);
  }, 60_000);

  it.skipIf(process.platform !== "win32")("Windows: a foreign handle without FILE_SHARE_DELETE blocks the rename; the writer keeps appending with one WARN line and rotates once the handle is gone", async () => {
    const p = await spawnProxy();
    fillTo(p.log, 5 * MiB + 1024);
    const holder = await holdOpen(p.log, "foreign");
    let released = false;
    try {
      const blocked = Array.from({ length: 50 }, (_, i) => `blocked-${String(i).padStart(3, "0")}\n`);
      p.emit(blocked.map((text) => ({ stream: "stdout" as const, text })), { batch: 5, pauseMs: 5 });
      await until(() => read(p.log).includes("blocked-049"), 15_000, () => read(p.log).slice(-500));
      expect(existsSync(`${p.log}.1`)).toBe(false);
      const log = read(p.log);
      for (const line of blocked) expect(log).toContain(line);
      expect(warnLines(log)).toHaveLength(1);
      expect(warnLines(log)[0]).toMatch(/ WARN proxy proxy\.log rotation blocked, appending and retrying at every check path=\S+ code=(?:EBUSY|EPERM|EACCES) /);
      await holder.release();
      released = true;
    } finally {
      if (!released) await holder.release();
    }
    p.emit([{ stream: "stderr", text: "after-release\n" }]);
    await until(() => existsSync(`${p.log}.1`) && read(p.log).includes("after-release"), 15_000, () => read(p.log).slice(-500));
    expect(read(`${p.log}.1`)).toContain("blocked-049\n");
    expect(warnLines(read(`${p.log}.1`) + read(p.log))).toHaveLength(1);
  }, 90_000);
});

describe("serve without ZCODE_KIT_LOG_DIR (TUI-hosted, standalone)", () => {
  it("keeps today's behaviour: no proxy.log is opened, and the output stays on the inherited stdout and stderr", async () => {
    const p = await spawnProxy({ logDir: false });
    p.emit([{ stream: "stdout", text: "plain stdout\n" }, { stream: "stderr", text: "plain stderr\n" }]);
    await until(() => p.inherited().includes("plain stderr\n"), 10_000, p.inherited);
    expect(p.inherited()).toContain("plain stdout\n");
    expect(p.inherited()).toMatch(/^zcode-proxy listening on http:\/\/127\.0\.0\.1:\d+$/m);
    expect(existsSync(p.logDir)).toBe(false);
  }, 40_000);
});

const warnLines = (text: string) => text.split("\n").filter((l) => / WARN proxy proxy\.log rotation blocked, /.test(l));

/** Append whole 1 KB filler lines by path (a kit appender) until the file has at least `bytes`. */
function fillTo(file: string, bytes: number): void {
  const need = bytes - statSync(file).size;
  if (need > 0) appendFileSync(file, `${"#".repeat(1023)}\n`.repeat(Math.ceil(need / 1024)));
}

/**
 * Another process holding `file` open until released:
 *   kit      a reader and an appender, opened like the kit's Node processes
 *            (`proxy logs`, the manager's appends) open the log: libuv shares
 *            read, write and delete on Windows;
 *   foreign  Windows only: a .NET FileStream sharing read and write but not
 *            delete, as editors and antivirus scanners open files.
 */
async function holdOpen(file: string, kind: "kit" | "foreign"): Promise<{ release(): Promise<void> }> {
  const node = Bun.which("node");
  const child = kind === "foreign"
    ? spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "$f=[System.IO.File]::Open($env:HOLD_PATH,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close()"],
    { env: { ...process.env, HOLD_PATH: file }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    : spawn(node ?? process.execPath, ["-e",
      "const fs=require('node:fs');const r=fs.openSync(process.env.HOLD_PATH,'r');const a=fs.openSync(process.env.HOLD_PATH,'a');process.stdout.write('held\\n');process.stdin.on('data',()=>{});process.stdin.on('end',()=>{fs.closeSync(r);fs.closeSync(a);process.exit(0);});"],
    { env: { ...process.env, HOLD_PATH: file }, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (d) => { out += d; });
  child.stderr!.on("data", (d) => { out += d; });
  const exited = new Promise((r) => child.once("exit", r));
  await until(() => out.includes("held"), 30_000, () => out);
  return {
    async release() {
      child.stdin!.end("\n");
      await exited;
    },
  };
}
