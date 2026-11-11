/**
 * The real `serve` entry point wires SIGTERM and SIGINT to the single graceful
 * shutdown sequence (ADR-0008): a spawned proxy against a loopback mock
 * upstream, with every outbound fetch to a non-loopback host refused by a
 * preload (`__fixtures__/egress-guard.ts`). POSIX only: on Windows a signal from
 * another process terminates it outright (the stop request, ticket 22, is the
 * Windows path).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SRC = join(import.meta.dir, "..");
const PORT = 19212; // ticket 21's port range (19210-19219)

interface Mock { server: Server; base: string; arrived: number; release(): void }

/** A loopback upstream that holds every request until `release()`. */
async function heldMock(): Promise<Mock> {
  const waiting: Array<() => void> = [];
  const mock: Mock = {
    server: createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        mock.arrived++;
        waiting.push(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            id: "msg_1", type: "message", role: "assistant", model: "glm-4.6",
            content: [{ type: "text", text: "answered after SIGTERM" }], stop_reason: "end_turn", stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }));
        });
      });
    }),
    base: "",
    arrived: 0,
    release() { while (waiting.length) waiting.shift()!(); },
  };
  await new Promise<void>((r) => mock.server.listen(0, "127.0.0.1", () => r()));
  mock.base = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`;
  return mock;
}

interface Proxy { child: ChildProcess; out(): string; exited: Promise<number | null>; key: string; base: string; dir: string; home: string; token: string; port: number; fixtureEnv: Record<string, string> }

type DirtyMode = false | true | "serve"; // true retains the earlier component-composition proof
async function spawnProxy(mock: Mock, managed = false, dirtyMetadata: DirtyMode = false): Promise<Proxy> {
  const dir = mkdtempSync(join(tmpdir(), "t21-serve-"));
  dirs.push(dir);
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const key = randomBytes(24).toString("base64url");
  const port = managed ? 19222 : PORT; // ticket 22's isolated port range
  const token = randomBytes(32).toString("base64url");
  const config = managed ? join(dir, "proxy", "config.yaml") : join(dir, "config.yaml");
  if (managed) {
    const root = join(SRC, "..", "..");
    for (const member of ["cli", "lib"]) cpSync(join(root, member), join(dir, member), { recursive: true });
    mkdirSync(join(dir, "proxy"));
    mkdirSync(join(dir, "logs"));
    cpSync(join(root, "proxy", "zcode-proxy-manager.mjs"), join(dir, "proxy", "zcode-proxy-manager.mjs"));
    writeFileSync(join(dir, ".proxykey"), key + "\n", { mode: 0o600 });
  }
  writeFileSync(config, [
    "server:", `  port: ${port}`, '  host: "127.0.0.1"',
    "auth:", `  proxyApiKey: "${key}"`,
    ...(dirtyMetadata === "serve" ? ["  accounts:", "    enabled: true"] : []),
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
  Object.assign(env, {
    HOME: home, USERPROFILE: home, TMPDIR: dir,
    ZCODE_PROXY_CREDENTIALS_PATH: join(dir, "credentials.json"),
    ZCODE_PROXY_CREDENTIAL_SECRET: randomBytes(24).toString("hex"),
    ZCODE_PROXY_ACCOUNTS_PATH: join(dir, "accounts.json"),
  });
  if (managed) Object.assign(env, { ZCODE_KIT_STOP_TOKEN: token, ZCODE_KIT_LOG_DIR: join(dir, "logs") });
  if (dirtyMetadata === "serve") env.ZCODE_PROXY_ACCOUNTS_PATH = join(home, "synthetic-serve-accounts.json");
  if (dirtyMetadata === true) {
    env.SYNTHETIC_METADATA_PATH = join(dir, "synthetic-metadata.json");
    writeFileSync(env.SYNTHETIC_METADATA_PATH, JSON.stringify([{ id: "synthetic", failureGeneration: 0, lastFailureAt: 1, exhaustedUntil: 2 }]));
  }
  const store = join(SRC, "auth", "store.ts");
  const made = spawnSync(process.execPath, ["-e", `import { saveCredential } from ${JSON.stringify(store)};
await saveCredential({ apiKey: "fixture-key-" + crypto.randomUUID(), secret: "fixture-secret-" + crypto.randomUUID(), provider: "zai" });`], { env, encoding: "utf8", timeout: 30_000 });
  if (made.status !== 0) throw new Error(`fixture credential: ${made.stderr}`);

  if (dirtyMetadata === "serve") {
    const madePool = spawnSync(process.execPath, ["-e", `import { saveAccountStore } from ${JSON.stringify(join(SRC, "auth", "account-store.ts"))};
await saveAccountStore([
  { id: "synthetic", plan: "coding-plan", credential: { apiKey: "synthetic-serve-key", provider: "zai" }, failureGeneration: 0, lastFailureAt: 1, exhaustedUntil: 2 },
  { id: "untouched", paused: true, credential: { apiKey: "synthetic-untouched-key", provider: "zai" }, failureGeneration: 7, lastFailureAt: 3, exhaustedUntil: 4 }
]);`], { env, encoding: "utf8", timeout: 30_000 });
    if (madePool.status !== 0) throw new Error(`fixture pool: ${madePool.stderr}`);
  }
  const entry = dirtyMetadata === true ? [join(SRC, "runtime", "__fixtures__", "dirty-stop.ts"), config] : [join(SRC, "index.ts"), "serve", config];
  const preload = dirtyMetadata === "serve" ? ["--preload", join(SRC, "runtime", "__fixtures__", "dirty-serve-preload.ts")] : [];
  const child = spawn(process.execPath, ["--preload", join(SRC, "runtime", "__fixtures__", "egress-guard.ts"), ...preload, ...entry], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (d) => { out += d; });
  child.stderr!.on("data", (d) => { out += d; });
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  await until(() => {
    if (out.includes(`listening on http://127.0.0.1:${port}`)) return true;
    const log = join(dir, "logs", "proxy.log");
    return managed && existsSync(log) && readFileSync(log, "utf8").includes(`listening on http://127.0.0.1:${port}`);
  }, 20_000, () => out);
  return { child, out: () => out, exited, key, base: `http://127.0.0.1:${port}`, dir, home, token, port, fixtureEnv: env };
}

async function until(cond: () => boolean, ms: number, detail: () => string = () => ""): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`condition not reached: ${detail().slice(-1500)}`);
    await Bun.sleep(10);
  }
}

const dirs: string[] = [];
const children: ChildProcess[] = [];
const mocks: Mock[] = [];
afterEach(async () => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) {
    const exited = new Promise<void>((resolve) => c.once("exit", () => resolve()));
    c.kill("SIGKILL");
    await exited;
  }
  for (const m of mocks.splice(0)) { m.release(); m.server.closeAllConnections(); m.server.close(); }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const body = JSON.stringify({ model: "glm-4.6", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });

// No platform skip: the Windows CI leg must execute this real serve + manager
// CLI path, not an injected flush callback. Only fixture stores are opened.
async function managerStopProof(dirtyMetadata: DirtyMode = false): Promise<void> {
  const mock = await heldMock();
  mocks.push(mock);
  const p = await spawnProxy(mock, true, dirtyMetadata);
  const { createLifecycle } = await import(pathToFileURL(join(p.dir, "lib", "proxy-lifecycle.mjs")).href);
  const lifecycle = createLifecycle({ root: p.dir, home: p.home });
  const start = lifecycle.processStartIdentity(p.child.pid);
  expect(start).not.toBeNull();
  if (process.platform === "win32") expect(start.ticks).toMatch(/^\d{18,19}$/);
  writeFileSync(join(p.dir, "logs", "proxy.pid"), JSON.stringify({
    pid: p.child.pid, startedMs: start.ms, startedIso: new Date(start.ms).toISOString(),
    ...(start.ticks === null ? {} : { startTicks: start.ticks }), stopToken: p.token,
  }) + "\n", { mode: 0o600 });
  if (dirtyMetadata === "serve") {
    const before = JSON.parse(readFileSync(join(p.home, "dirty-before-stop.json"), "utf8"));
    expect(before.find((a: { id: string }) => a.id === "synthetic").failureGeneration).toBe(0);
  }
  const node = process.env.ZCODE_KIT_NODE ?? "node";
  // Keep this parent's event loop running so it reaps the proxy while the
  // separate manager waits for that process to disappear (no zombie fixture).
  const manager = spawn(node, [join(p.dir, "proxy", "zcode-proxy-manager.mjs"), "stop"], {
    env: { ...process.env, HOME: p.home, USERPROFILE: p.home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(manager);
  let output = "";
  manager.stdout!.on("data", (d) => { output += d; });
  manager.stderr!.on("data", (d) => { output += d; });
  const code = await new Promise<number | null>((resolve, reject) => {
    manager.once("error", reject);
    manager.once("close", resolve);
  });
  expect(code).toBe(0);
  expect(output).toContain(`stopped (pid ${p.child.pid})`);
  expect(await p.exited).toBe(0);
  expect(p.child.signalCode).toBeNull();
  const log = readFileSync(join(p.dir, "logs", "proxy.log"), "utf8");
  const shutdownLog = dirtyMetadata === true ? p.out() : log;
  expect(shutdownLog).toMatch(/ INFO shutdown flush finished reason=stop/);
  expect(shutdownLog.match(/ INFO shutdown started reason=stop /g)).toHaveLength(1);
  expect(log).not.toContain(p.token);
  expect(existsSync(join(p.dir, "logs", "proxy.pid"))).toBe(false);
  expect(p.out()).not.toContain("EGRESS-BLOCKED");
  expect(mock.arrived).toBe(0);
  if (dirtyMetadata === "serve") {
    // Decrypt only the synthetic store in a separate isolated process AFTER
    // the proxy and real manager have exited. Print metadata, never credentials.
    const after = spawnSync(process.execPath, ["-e", `import { loadAccountStore } from ${JSON.stringify(join(SRC, "auth", "account-store.ts"))};
const profiles = await loadAccountStore();
console.log(JSON.stringify(profiles.map(({ id, failureGeneration, lastFailureAt, exhaustedUntil, paused }) => ({ id, failureGeneration, lastFailureAt, exhaustedUntil, paused }))));`], {
      env: p.fixtureEnv,
      encoding: "utf8", timeout: 30_000,
    });
    expect(after.status).toBe(0);
    const profiles = JSON.parse(after.stdout);
    expect(profiles.find((a: { id: string }) => a.id === "synthetic").failureGeneration).toBe(1);
    const before = JSON.parse(readFileSync(join(p.home, "dirty-before-stop.json"), "utf8"));
    expect(profiles.find((a: { id: string }) => a.id === "untouched")).toEqual(before.find((a: { id: string }) => a.id === "untouched"));
    expect(profiles).toHaveLength(2);
  }
  if (dirtyMetadata === true) {
    // Read only this fixture's metadata after the actual child has exited.
    expect(JSON.parse(readFileSync(join(p.dir, "synthetic-metadata.json"), "utf8"))).toEqual([
      { id: "synthetic", failureGeneration: 1 },
    ]);
  }
}

it("proxy stop CLI runs the real serve account-metadata flush through the stop request on every OS", () => managerStopProof(), 45_000);
it("proxy stop persists dirty synthetic metadata before the real server process exits", () => managerStopProof(true), 45_000);
it("proxy stop persists dirty metadata through the actual serve auth factory without losing the untouched account", () => managerStopProof("serve"), 60_000);

describe.skipIf(process.platform === "win32")("serve: signals run the graceful shutdown", () => {
  it("SIGTERM drains: the accepted request finishes, a new one gets 503 + Retry-After, the proxy exits 0", async () => {
    const mock = await heldMock();
    mocks.push(mock);
    const p = await spawnProxy(mock);
    const headers = { authorization: `Bearer ${p.key}`, "content-type": "application/json" };
    const accepted = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body });
    await until(() => mock.arrived === 1, 10_000, p.out);

    const signalledAt = Date.now();
    p.child.kill("SIGTERM");
    await until(() => / INFO shutdown started reason=signal /.test(p.out()), 3_000, p.out);
    const shed = await fetch(`${p.base}/v1/messages`, { method: "POST", headers, body });
    expect(shed.status).toBe(503);
    expect(shed.headers.get("retry-after")).not.toBeNull();
    expect(((await shed.json()) as { error: { type: string } }).error.type).toBe("overloaded_error");

    mock.release();
    const res = await accepted;
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("answered after SIGTERM");

    expect(await p.exited).toBe(0);
    // Inside the manager's 5 s SIGTERM -> SIGKILL grace (POSIX).
    expect(Date.now() - signalledAt).toBeLessThan(5_000);
    expect(p.out()).toMatch(/ INFO shutdown drain finished reason=signal .*cut=0 shed=1/);
    expect(p.out()).not.toContain("EGRESS-BLOCKED");
    expect(mock.arrived).toBe(1);
  }, 40_000);

  it("SIGINT keeps its console line and exits 0 at once when idle", async () => {
    const mock = await heldMock();
    mocks.push(mock);
    const p = await spawnProxy(mock);
    const signalledAt = Date.now();
    p.child.kill("SIGINT");
    expect(await p.exited).toBe(0);
    expect(Date.now() - signalledAt).toBeLessThan(2_500);
    expect(p.out()).toContain("\nShutting down...\n");
    expect(p.out()).toMatch(/ INFO shutdown drain finished reason=signal .*cut=0 shed=0/);
    expect(p.out()).not.toContain("EGRESS-BLOCKED");
  }, 40_000);
});
