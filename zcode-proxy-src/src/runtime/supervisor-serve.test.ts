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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

interface Proxy { child: ChildProcess; out(): string; exited: Promise<number | null>; key: string; base: string }

async function spawnProxy(mock: Mock): Promise<Proxy> {
  const dir = mkdtempSync(join(tmpdir(), "t21-serve-"));
  dirs.push(dir);
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const key = randomBytes(24).toString("base64url");
  const config = join(dir, "config.yaml");
  writeFileSync(config, [
    "server:", `  port: ${PORT}`, '  host: "127.0.0.1"',
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
  Object.assign(env, {
    HOME: home, USERPROFILE: home, TMPDIR: dir,
    ZCODE_PROXY_CREDENTIALS_PATH: join(dir, "credentials.json"),
    ZCODE_PROXY_CREDENTIAL_SECRET: randomBytes(24).toString("hex"),
    ZCODE_PROXY_ACCOUNTS_PATH: join(dir, "accounts.json"),
  });
  const store = join(SRC, "auth", "store.ts");
  const made = spawnSync(process.execPath, ["-e", `import { saveCredential } from ${JSON.stringify(store)};
await saveCredential({ apiKey: "fixture-key-" + crypto.randomUUID(), secret: "fixture-secret-" + crypto.randomUUID(), provider: "zai" });`], { env, encoding: "utf8", timeout: 30_000 });
  if (made.status !== 0) throw new Error(`fixture credential: ${made.stderr}`);

  const child = spawn(process.execPath, ["--preload", join(SRC, "runtime", "__fixtures__", "egress-guard.ts"), join(SRC, "index.ts"), "serve", config], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (d) => { out += d; });
  child.stderr!.on("data", (d) => { out += d; });
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  await until(() => out.includes(`listening on http://127.0.0.1:${PORT}`), 20_000, () => out);
  return { child, out: () => out, exited, key, base: `http://127.0.0.1:${PORT}` };
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
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const m of mocks.splice(0)) { m.release(); m.server.closeAllConnections(); m.server.close(); }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const body = JSON.stringify({ model: "glm-4.6", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });

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
