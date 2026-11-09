/**
 * The respawn acknowledgement (ADR-0015, seam 4): on a memory respawn the
 * proxy spawns the kit manager's hook with unchanged arguments and waits for a
 * `respawn.json` event with its own pid and an `at` later than its request
 * time. Real hook processes (a stand-in manager script), a real logs dir.
 *
 * Every stand-in hook ends by itself: it stops once the test writes its stop
 * file (bounded at 20 s), and the test awaits its exit marker before the
 * directory is removed (a live process on Windows keeps it from being deleted).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { managerRespawnHandoff } from "./supervisor.js";

// A stand-in manager hook. Its mode comes from HOOK_MODE:
//   ack      reserve at once: write the event the manager writes at reservation
//   refuse   exit 4 at once (the manager's refusal)
//   silent   never answer
//   stale    write an event for this pid whose `at` lies 60 s in the past
//            (the wall clock jumped back between the request and the reservation)
//   late     ack after HOOK_DELAY_MS
// It records its argv and pid, then waits for the stop file and writes its
// exit marker.
const STAND_IN_HOOK = `import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.HOOK_DIR;
writeFileSync(join(dir, "hook-started-" + process.pid), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));
const reserve = (at) => {
  const file = join(process.env.ZCODE_KIT_LOG_DIR, "respawn.json");
  let events = [];
  try { events = JSON.parse(readFileSync(file, "utf8")).events; } catch {}
  events.push({ at, pid: Number(process.argv[3]), reason: process.argv[5] });
  const temp = file + "." + process.pid;
  writeFileSync(temp, JSON.stringify({ events }) + "\\n");
  renameSync(temp, file);
};
const mode = process.env.HOOK_MODE;
const finish = (code) => { writeFileSync(join(dir, "hook-exited-" + process.pid), String(code)); process.exit(code); };
if (mode === "refuse") finish(4);
if (mode === "ack") reserve(Date.now());
if (mode === "stale") reserve(Date.now() - 60_000);
if (mode === "late") setTimeout(() => reserve(Date.now()), Number(process.env.HOOK_DELAY_MS));
const until = Date.now() + 20_000;
const timer = setInterval(() => {
  if (existsSync(join(dir, "stop")) || Date.now() > until) { clearInterval(timer); finish(0); }
}, 50);
`;

interface Fixture { dir: string; logDir: string; env: Record<string, string | undefined> }

const fixtures: Fixture[] = [];

function fixture(mode: string, extra: Record<string, string> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "t23-ack-"));
  const logDir = join(dir, "logs");
  mkdirSync(logDir);
  const hook = join(dir, "hook.mjs");
  writeFileSync(hook, STAND_IN_HOOK);
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.toUpperCase().startsWith("ZCODE_KIT_")) env[k] = v;
  Object.assign(env, {
    ZCODE_KIT_RESPAWN_NODE: process.execPath,
    ZCODE_KIT_RESPAWN_MANAGER: hook,
    ZCODE_KIT_LOG_DIR: logDir,
    HOOK_DIR: dir,
    HOOK_MODE: mode,
    ...extra,
  });
  const f = { dir, logDir, env };
  fixtures.push(f);
  return f;
}

/** The hook processes this fixture started (pid → argv), from their own records. */
function hooksOf(f: Fixture): Array<{ pid: number; argv: string[] }> {
  return readdirSync(f.dir).filter((n) => n.startsWith("hook-started-")).map((n) => JSON.parse(readFileSync(join(f.dir, n), "utf8")));
}

const exited = (f: Fixture, pid: number) => existsSync(join(f.dir, `hook-exited-${pid}`));

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

/** Stop every stand-in hook and wait for each to exit, then remove the directory. */
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    writeFileSync(join(f.dir, "stop"), "");
    for (const h of hooksOf(f)) await until(() => exited(f, h.pid), 25_000, `hook ${h.pid} to exit`);
    for (let attempt = 0; ; attempt++) {
      try { rmSync(f.dir, { recursive: true, force: true }); break; }
      catch (err) {
        if (attempt >= 10 || !["EPERM", "EBUSY", "ENOTEMPTY"].includes((err as { code?: string }).code ?? "")) throw err;
        await Bun.sleep(200);
      }
    }
  }
});

describe("respawn acknowledgement: the proxy drains only once the manager has reserved the budget", () => {
  it("an event with this pid written after the request is the acknowledgement; the hook gets unchanged arguments", async () => {
    const f = fixture("ack");
    const handoff = managerRespawnHandoff(f.env)!;
    const answer = await handoff.request("memory");
    expect(answer.outcome).toBe("acknowledged");
    expect(answer.confirmed).toBe(true);
    const [hook] = hooksOf(f);
    expect(hook!.argv).toEqual(["respawn", String(process.pid), "--reason", "memory"]);
  }, 30_000);

  it("hook exit 4 is a refusal at once, long before the 10 s wait ends", async () => {
    const f = fixture("refuse");
    const answer = await managerRespawnHandoff(f.env)!.request("memory");
    expect(answer).toMatchObject({ outcome: "refused", confirmed: false, exitCode: 4 });
    expect(answer.waitedMs).toBeLessThan(5_000);
  }, 30_000);

  it("no acknowledgement within the wait is not a confirmation", async () => {
    const f = fixture("silent");
    const t0 = Date.now();
    const answer = await managerRespawnHandoff(f.env, { ackWaitMs: 1_500 })!.request("memory");
    expect(answer).toMatchObject({ outcome: "no-acknowledgement", confirmed: false });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_400);
    // The hook is not touched: it is still running after the wait.
    const [hook] = hooksOf(f);
    expect(exited(f, hook!.pid)).toBe(false);
  }, 30_000);

  it("adversarial: a wall clock that jumped back (the event's `at` before the request time) fails safe: no acknowledgement", async () => {
    const f = fixture("stale");
    const answer = await managerRespawnHandoff(f.env, { ackWaitMs: 1_500 })!.request("memory");
    expect(answer).toMatchObject({ outcome: "no-acknowledgement", confirmed: false });
  }, 30_000);

  it("adversarial: an earlier event for the same pid already in respawn.json never counts", async () => {
    const f = fixture("silent");
    const earlier = Date.now() - 5_000;
    writeFileSync(join(f.logDir, "respawn.json"), JSON.stringify({ events: [{ at: earlier, pid: process.pid, reason: "memory" }] }));
    const answer = await managerRespawnHandoff(f.env, { ackWaitMs: 1_000 })!.request("memory");
    expect(answer.outcome).toBe("no-acknowledgement");
  }, 30_000);

  it("adversarial: an event for another pid, or a corrupt respawn.json, is no acknowledgement", async () => {
    for (const content of [JSON.stringify({ events: [{ at: Date.now() + 60_000, pid: process.pid + 1, reason: "memory" }] }), "{ corrupt", JSON.stringify({ events: [{ at: "later", pid: process.pid }] })]) {
      const f = fixture("silent");
      writeFileSync(join(f.logDir, "respawn.json"), content);
      const answer = await managerRespawnHandoff(f.env, { ackWaitMs: 600 })!.request("memory");
      expect(answer.outcome).toBe("no-acknowledgement");
    }
  }, 30_000);

  it("an acknowledgement after the wait has ended is too late: the answer stays no-acknowledgement", async () => {
    const f = fixture("late", { HOOK_DELAY_MS: "1500" });
    const answer = await managerRespawnHandoff(f.env, { ackWaitMs: 500 })!.request("memory");
    expect(answer.outcome).toBe("no-acknowledgement");
    await until(() => existsSync(join(f.logDir, "respawn.json")), 10_000, "the late acknowledgement");
  }, 30_000);

  it("a hook that does not start is no confirmation", async () => {
    const f = fixture("ack", {});
    f.env.ZCODE_KIT_RESPAWN_NODE = join(f.dir, "no-such-node.exe");
    const answer = await managerRespawnHandoff(f.env)!.request("memory");
    expect(answer).toMatchObject({ outcome: "hook-failed", confirmed: false });
  }, 30_000);

  it("without the manager's logs dir (a manager older than ADR-0015) the hook's start confirms, as before", async () => {
    const f = fixture("silent");
    delete f.env.ZCODE_KIT_LOG_DIR;
    const answer = await managerRespawnHandoff(f.env)!.request("memory");
    expect(answer).toMatchObject({ outcome: "started", confirmed: true });
  }, 30_000);

  it("after the wait the hook handle is unref'd: the proxy process can exit while the detached hook lives on", async () => {
    const f = fixture("silent");
    const script = join(f.dir, "proxy.ts");
    const supervisorUrl = Bun.pathToFileURL(join(import.meta.dir, "supervisor.ts")).href;
    // Nothing else keeps this process alive once the request has answered.
    writeFileSync(script, `import { managerRespawnHandoff } from ${JSON.stringify(supervisorUrl)};
const answer = await managerRespawnHandoff(process.env, { ackWaitMs: 500 }).request("memory");
console.log(answer.outcome);
`);
    const child = Bun.spawn([process.execPath, script], { env: f.env, stdout: "pipe", stderr: "pipe" });
    const t0 = Date.now();
    const code = await child.exited;
    expect(await new Response(child.stdout).text()).toBe("no-acknowledgement\n");
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
    const [hook] = hooksOf(f);
    expect(exited(f, hook!.pid)).toBe(false);
  }, 30_000);
});
