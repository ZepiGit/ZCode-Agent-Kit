import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real runTui + its installed uncaughtException handler; no second classifier.
// CI42916065371 establishes three 5000ms test timeouts, kill and missing tui.log,
// NOT a measured Windows startup duration or a native root cause. Local earlier
// firstTuiLogWrite measurements are not readiness measurements either. 10s is a
// provisional, bounded startup reserve, not twice a measured required duration.
// Readiness observes successful public process.on registration from app.ts,
// before its boot awaits, using a fixture-only transparent forwarding wrapper.
// An exact fd-2 line starts the parent's independent 5s handling deadline.
// Exit and pipe EOF are separate: cleanup has 1000ms to reap/drain and 500ms
// to cancel stuck readers. Kill, exit, stream and log I/O failures stay visible.
// Outer timeout = startup10s + handling5s + cleanup1.5s + fixture headroom3.5s.
// Native win26's original cause remains unattributed; no production/CI change.
const STARTUP_READINESS_BUDGET_MS = 10_000;
const CLASSIFICATION_BUDGET_MS = 5_000;
const CLEANUP_DRAIN_BUDGET_MS = 1_000;
const CANCEL_BUDGET_MS = 500;
const TEST_TIMEOUT_MS = STARTUP_READINESS_BUDGET_MS + CLASSIFICATION_BUDGET_MS
  + CLEANUP_DRAIN_BUDGET_MS + CANCEL_BUDGET_MS + 3_500;
const READY_LINE = "t82-tui-ready";
const app = fileURLToPath(new URL("./app.ts", import.meta.url));
const store = fileURLToPath(new URL("../auth/store.ts", import.meta.url));

async function raceBudget<T>(pending: Promise<T>, ms: number): Promise<T | "deadline"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), Math.max(0, ms));
    })]);
  } finally { clearTimeout(timer); }
}

// Constant-space line parser: chunk splits/CRLF accepted, prefixes/suffixes and
// unterminated strings rejected. Never search an accumulated stderr substring.
function readyParser(onReady: () => void): (chunk: string) => void {
  let line = "";
  let overflow = false;
  return (chunk) => {
    for (const char of chunk) {
      if (char === "\n") {
        if (!overflow && (line === READY_LINE || line === READY_LINE + "\r")) onReady();
        line = "";
        overflow = false;
      } else if (line.length <= READY_LINE.length) line += char;
      else overflow = true;
    }
  };
}

interface OwnedChild {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal: "SIGKILL"): void;
}

// This same supervisor handles real children and fault-injected OS/pipe controls.
function supervise(proc: OwnedChild, home: string, log: string) {
  const startedAt = performance.now();
  let ackAt: number | undefined;
  let resolveReady!: (at: number) => void;
  const ready = new Promise<number>((resolve) => { resolveReady = resolve; });
  const parse = readyParser(() => {
    if (ackAt !== undefined) return;
    ackAt = performance.now();
    resolveReady(ackAt);
  });
  let stdout = "";
  let stderr = "";
  let status = "running";
  let exited = false;
  let outcomeReported = false;
  const faults: string[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const tail = (text: string): string => text.slice(-2000);
  const safe = (text: string): string => text.split(home).join("<fixture>");
  const errorText = (err: unknown): string => safe(String(err));
  async function drain(stream: ReadableStream<Uint8Array>, name: string) {
    const reader = stream.getReader();
    readers.push(reader);
    const dec = new TextDecoder();
    const accept = (text: string) => {
      if (name === "stdout") stdout = tail(stdout + text);
      else { stderr = tail(stderr + text); parse(text); }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accept(dec.decode(value, { stream: true }));
      }
      accept(dec.decode());
    } catch (err) { faults.push(`${name}-stream-error=${errorText(err)}`); }
    finally { reader.releaseLock(); }
  }
  const pipes = Promise.all([drain(proc.stdout, "stdout"), drain(proc.stderr, "stderr")]);
  const exit = proc.exited.then((code) => {
    exited = true;
    status = `exited code=${code}`;
    return code;
  }, (err) => {
    faults.push(`exit-error=${errorText(err)}`);
    status = "exit-observation-failed";
    return null;
  });
  const settled = Promise.all([exit, pipes]);
  let cleanupPending: Promise<void> | undefined;
  function cleanup(): Promise<void> {
    return cleanupPending ??= (async () => {
      if (!exited) {
        try { proc.kill("SIGKILL"); status += "; SIGKILL sent"; }
        catch (err) { faults.push(`kill-error=${errorText(err)}`); }
      }
      if (await raceBudget(settled, CLEANUP_DRAIN_BUDGET_MS) === "deadline") {
        faults.push("cleanup-drain-overrun");
        const cancelled = Promise.all(readers.map(async (reader) => {
          try { await reader.cancel(); }
          catch (err) { faults.push(`stream-cancel-error=${errorText(err)}`); }
        }));
        if (await raceBudget(cancelled, CANCEL_BUDGET_MS) === "deadline") faults.push("stream-cancel-overrun");
      }
    })();
  }
  function diagnostic(phase: string): string {
    let logText: string;
    try { logText = `tuiLogTailSanitized=${JSON.stringify(tail(safe(readFileSync(log, "utf8"))))}`; }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      logText = code === "ENOENT" ? "tuiLog=absent" : `tuiLogReadError=${errorText(err)}`;
    }
    return [
      `fixture-phase=${phase}`, `ackObserved=${ackAt !== undefined}`, `child=${status}`,
      `elapsedMs=${Math.round(performance.now() - startedAt)}`, `fixtureHome=${safe(home)}`,
      `stdoutTailSanitized=${JSON.stringify(safe(stdout))}`, `stderrTailSanitized=${JSON.stringify(safe(stderr))}`,
      logText, ...faults,
    ].join(" | ");
  }
  return {
    async outcome() {
      let phase: string | undefined;
      // Readiness, not drained exit, advances startup. Raw exit can precede the
      // last pipe chunk; cleanup drains that chunk before final early-exit checks.
      const first = await raceBudget(Promise.race([
        ready.then(() => "ready" as const), exit.then(() => "exit" as const),
      ]), STARTUP_READINESS_BUDGET_MS - (performance.now() - startedAt));
      if (first === "deadline") phase = "startup-overrun-no-ack";
      else if (ackAt !== undefined) {
        const handled = await raceBudget(exit, CLASSIFICATION_BUDGET_MS - (performance.now() - ackAt));
        if (handled === "deadline") phase = "classification-overrun";
      }
      await cleanup();
      if (!phase && ackAt === undefined) phase = "startup-exited-before-ack";
      if (!phase && faults.length) phase = "cleanup-failure";
      outcomeReported = true;
      if (phase) throw new Error(diagnostic(phase));
      return { code: await exit, stdout, stderr, ackAt: ackAt! - startedAt, elapsedMs: performance.now() - startedAt };
    },
    async dispose() {
      try {
        await cleanup();
        if (faults.length && !outcomeReported) throw new Error(diagnostic("cleanup-failure"));
      } finally { rmSync(home, { recursive: true, force: true }); }
    },
  };
}

type Kind = "guest" | "host-cdn-message" | "host";
interface FixtureOptions {
  bootDelayMs?: number;
  hangAfterAck?: boolean;
  noAck?: boolean;
  superstringAck?: boolean;
  invalidConfig?: boolean;
}
function spawnTuiChild(kind: Kind, options: FixtureOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), "t82-tui-"));
  const config = join(home, "config.yaml");
  const log = join(home, "tui.log");
  writeFileSync(config, options.invalidConfig ? "server: [\n"
    : "server:\n  host: 127.0.0.1\nauth:\n  accounts:\n    enabled: false\nclaim:\n  enabled: false\n");
  const message = kind === "host-cdn-message"
    ? "prefix https://g.alicdn.com/x.js suffix SyntheticHostFrameCredential" : "synthetic callback failure";
  const stack = kind === "guest"
    ? "TypeError: synthetic callback failure\n    at SyntheticFunctionCredential (https://g.alicdn.com/captcha/feilin071.js#SyntheticFragmentCredential:1:1)"
    : `TypeError: ${message}\n    at host (/app/host.ts:1:1)`;
  const source = `
    import { writeSync } from "node:fs";
    import { mock } from "bun:test";
    // Fail closed on accidental network use. No SDK, login or proxy is started.
    globalThis.fetch = () => { throw new Error("fixture forbids network"); };
    if (${options.bootDelayMs ?? 0}) await new Promise(r => setTimeout(r, ${options.bootDelayMs ?? 0}));
    if (${!!options.noAck}) { setInterval(() => {}, 1000); await new Promise(() => {}); }
    const store = await import(${JSON.stringify(store)});
    mock.module(${JSON.stringify(store)}, () => ({ ...store, loadCredential: async () => {
      writeSync(2, "t82-boot-await-pending\\n");
      return await new Promise(() => {});
    } }));
    Object.defineProperty(process.stdout, "isTTY", { value: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true });
    process.stdin.setRawMode = () => process.stdin;
    const { runTui } = await import(${JSON.stringify(app)});
    const originalOn = process.on;
    const before = process.listeners("uncaughtException");
    const normalize = text => text.replaceAll("\\\\", "/");
    process.on = function(event, listener) {
      const caller = normalize(new Error().stack ?? "");
      const result = Reflect.apply(originalOn, this, arguments);
      if (this === process && event === "uncaughtException" && caller.includes(normalize(${JSON.stringify(app)}) + ":")) {
        const after = process.listeners(event);
        if (result !== process || before.includes(listener) || !after.includes(listener)
            || after.length !== before.length + 1) throw new Error("registration observation failed");
        process.on = originalOn;
        writeSync(2, ${JSON.stringify(options.superstringAck ? "prefix " + READY_LINE + " suffix" : READY_LINE)} + "\\n");
        const keepAlive = setInterval(() => {}, 1000);
        if (!${!!options.hangAfterAck}) {
          const err = new TypeError(${JSON.stringify(message)});
          err.stack = ${JSON.stringify(stack)};
          setTimeout(() => { throw err; }, 20);
          setTimeout(() => { clearInterval(keepAlive); process.exit(0); }, 100);
        }
      }
      return result;
    };
    await runTui({ configPath: ${JSON.stringify(config)} });
    writeSync(2, "t82-runTui-returned\\n");
  `;
  const proc = Bun.spawn([process.execPath, "--eval", source], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
      APPDATA: home, LOCALAPPDATA: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, ZCODE_TUI_LOGFILE: log },
    stdout: "pipe", stderr: "pipe",
  });
  // No grandchildren; group is inherited from the capped runner, never signalled.
  process.stderr.write(`owned_tui_pid=${proc.pid} process_group=inherited runner_pid=${process.pid}\n`);
  return { home, config, log, ...supervise(proc, home, log) };
}

async function assertClassification(kind: Kind, options: FixtureOptions = {}) {
  const child = spawnTuiChild(kind, options);
  try {
    const result = await child.outcome();
    expect(result.stderr).not.toContain("config error");
    expect(result.stderr).not.toContain("error: ");
    expect(result.stderr).toContain("t82-boot-await-pending\n");
    expect(result.stderr).not.toContain("t82-runTui-returned");
    expect(result.stderr.indexOf(READY_LINE + "\n")).toBeLessThan(result.stderr.indexOf("t82-boot-await-pending\n"));
    expect(existsSync(child.log)).toBe(true);
    const pane = readFileSync(child.log, "utf8");
    if (kind === "guest") {
      expect(result.code).toBe(0);
      expect(pane).toContain("captcha SDK error (ignored)");
      expect(pane).toMatch(/len=26 sha256=[0-9a-f]{64}/);
      expect(pane).not.toContain("SyntheticFunctionCredential");
      expect(pane).not.toContain("SyntheticFragmentCredential");
    } else {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("zcode-proxy: tui crashed:");
      expect(pane).not.toContain("captcha SDK error (ignored)");
    }
    return result;
  } finally { await child.dispose(); }
}

for (const kind of ["guest", "host-cdn-message", "host"] as const) {
  test(`TUI keeps strict actual-frame classification before boot returns: ${kind}`, async () => {
    await assertClassification(kind);
  }, TEST_TIMEOUT_MS);
}

test("TUI observes delayed boot beyond the old 5s limit with all guest contracts", async () => {
  const result = await assertClassification("guest", { bootDelayMs: 6_000 });
  expect(result.ackAt).toBeGreaterThan(5_000);
  expect(result.ackAt).toBeLessThan(STARTUP_READINESS_BUDGET_MS);
}, TEST_TIMEOUT_MS);

test("TUI protocol rejects ack then hang in the handling phase", async () => {
  const child = spawnTuiChild("guest", { hangAfterAck: true });
  const start = performance.now();
  try {
    await expect(child.outcome()).rejects.toThrow("fixture-phase=classification-overrun | ackObserved=true");
    // Distinguishes the actual 5s handling deadline from the old 10s startup kill.
    expect(performance.now() - start).toBeLessThan(8_000);
  } finally { await child.dispose(); }
}, TEST_TIMEOUT_MS);

test("TUI protocol rejects no ack finitely with sanitized absent-log diagnostics", async () => {
  const child = spawnTuiChild("guest", { noAck: true });
  try {
    let diagnostic = "";
    try { await child.outcome(); } catch (err) { diagnostic = String(err); }
    expect(diagnostic).toContain("fixture-phase=startup-overrun-no-ack | ackObserved=false");
    expect(diagnostic).toContain("tuiLog=absent");
    expect(diagnostic).toContain("fixtureHome=<fixture>");
    expect(diagnostic).not.toContain(child.home);
  } finally { await child.dispose(); }
}, TEST_TIMEOUT_MS);

test("TUI protocol rejects a superstring ack from a real armed handler", async () => {
  const child = spawnTuiChild("guest", { superstringAck: true });
  try {
    await expect(child.outcome()).rejects.toThrow("fixture-phase=startup-exited-before-ack | ackObserved=false");
  } finally { await child.dispose(); }
}, TEST_TIMEOUT_MS);

test("TUI invalid configuration preserves real loadConfig exit1 and config-error without ack", async () => {
  const child = spawnTuiChild("guest", { invalidConfig: true });
  try {
    let diagnostic = "";
    try { await child.outcome(); } catch (err) { diagnostic = String(err); }
    expect(diagnostic).toContain("fixture-phase=startup-exited-before-ack | ackObserved=false | child=exited code=1");
    expect(diagnostic).toContain("zcode-proxy: config error:");
    expect(diagnostic).toContain("tuiLog=absent");
    expect(diagnostic).not.toContain(READY_LINE);
    expect(diagnostic).not.toContain("Cannot find module");
  } finally { await child.dispose(); }
}, TEST_TIMEOUT_MS);

test("readiness parser requires a whole terminated line across chunks", () => {
  let count = 0;
  const parse = readyParser(() => { count++; });
  parse(`prefix ${READY_LINE}\n${READY_LINE} suffix\n${READY_LINE}`);
  expect(count).toBe(0);
  parse("\n");
  expect(count).toBe(1);
  parse("t82-tui-"); parse("ready\r"); parse("\n");
  expect(count).toBe(2);
});

// OS/pipe fault injection at the SAME supervisor boundary: no unkillable real
// child is created. These controls cannot leak processes even when signalling fails.
for (const fault of ["kill", "stream", "log"] as const) {
  test(`TUI cleanup reports ${fault} failure within its own finite budget`, async () => {
    const home = mkdtempSync(join(tmpdir(), "t82-tui-fault-"));
    const log = join(home, "tui.log");
    if (fault === "log") mkdirSync(log);
    const stream = (err = false) => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(READY_LINE + "\n"));
        if (err) controller.error(new Error("synthetic pipe failure"));
      },
    });
    const child = supervise({ pid: -1, stdout: stream(fault === "stream"), stderr: stream(),
      exited: fault === "kill" ? new Promise(() => {}) : Promise.resolve(0),
      kill() { throw new Error("synthetic signal denied"); },
    }, home, log);
    const start = performance.now();
    try {
      let diagnostic = "";
      try { await child.outcome(); } catch (err) { diagnostic = String(err); }
      expect(diagnostic).toContain("cleanup-drain-overrun");
      if (fault === "kill") expect(diagnostic).toContain("kill-error=Error: synthetic signal denied");
      if (fault === "stream") expect(diagnostic).toContain("stdout-stream-error=Error: synthetic pipe failure");
      if (fault === "log") {
        expect(diagnostic).toContain("tuiLogReadError=");
        expect(diagnostic).not.toContain("tuiLog=absent");
      }
      expect(performance.now() - start).toBeLessThan(CLASSIFICATION_BUDGET_MS + CLEANUP_DRAIN_BUDGET_MS + CANCEL_BUDGET_MS + 1_000);
    } finally { await child.dispose(); }
    expect(existsSync(home)).toBe(false);
  }, TEST_TIMEOUT_MS);
}
