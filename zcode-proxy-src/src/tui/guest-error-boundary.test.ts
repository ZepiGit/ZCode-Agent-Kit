import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real runTui + installed handler, not a second copy of its classifier. Terminal
// capabilities are synthetic; no PTY/Unix helper is required on Windows.
//
// Startup readiness is OBSERVED, not assumed (CI run 42916065371, job
// test-kit (windows-latest, 26): all three children stayed alive but silent
// for the full 5000 ms — tui.log was never created, so the primary failure was
// masked by an unhandled ENOENT at the old unguarded log read). The child now
// writes one bounded readiness line to its real stderr (fd 2, bypassing the
// runTui stdio interception) exactly after `await runTui(...)` resolves — the
// point where the uncaughtException handler is installed. The parent waits for
// that ack under a finite startup budget, then keeps the previous 5 s deadline
// for the classification itself. Overruns kill the owned child and fail with
// bounded sanitized diagnostics (phase, child status, stdout/stderr tails,
// tui.log tail) BEFORE the fixture is cleaned up — a missing log is reported,
// never thrown as a masking ENOENT.
//
// Budget evidence: healthy boot measured 162–475 ms locally (Linux, Bun
// 1.4.2) and ~300 ms/test on the CI win24 leg; the win26 leg overran 5000 ms.
// STARTUP_READINESS_BUDGET_MS = 2× the observed overrun, still finite. The
// explicit per-test timeout is a documented deviation: no other proxy test
// passes one today, but bun's 5000 ms default would otherwise expire before
// the startup budget does. It cannot hide a hang — both budgets kill the
// child and report diagnostics, and the total stays bounded below the timeout.
const STARTUP_READINESS_BUDGET_MS = 10_000;
const CLASSIFICATION_BUDGET_MS = 5_000;
const TEST_TIMEOUT_MS = 20_000;
const READY_LINE = "t82-tui-ready";

const app = fileURLToPath(new URL("./app.ts", import.meta.url));
const store = fileURLToPath(new URL("../auth/store.ts", import.meta.url));

/** Drain a child stream from spawn, accumulating the full text. */
function drainStream(stream: ReadableStream<Uint8Array>, onChunk: (text: string) => void): Promise<string> {
  return (async () => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        text += chunk;
        onChunk(chunk);
      }
      text += dec.decode();
    } catch { /* killed child ends its streams; keep what was read */ }
    finally { reader.releaseLock(); }
    return text;
  })();
}

interface ChildRun {
  readonly home: string;
  readonly config: string;
  readonly log: string;
  /** Startup + classification phases; resolves with the settled artifacts or fails with diagnostics. */
  outcome(): Promise<{ code: number; stdout: string; stderr: string; elapsedMs: number }>;
  /** Kill the owned child if still alive, drain, then remove the fixture. Idempotent. */
  dispose(): Promise<void>;
}

function spawnTuiChild(kind: "guest" | "host-cdn-message" | "host", bootDelayMs: number): ChildRun {
  const home = mkdtempSync(join(tmpdir(), "t82-tui-"));
  const config = join(home, "config.yaml");
  const log = join(home, "tui.log");
  writeFileSync(config, "server:\n  host: 127.0.0.1\nauth:\n  accounts:\n    enabled: false\nclaim:\n  enabled: false\n");
  const message = kind === "host-cdn-message"
    ? "prefix https://g.alicdn.com/x.js suffix SyntheticHostFrameCredential"
    : "synthetic callback failure";
  const stack = kind === "guest"
    ? "TypeError: synthetic callback failure\n    at SyntheticFunctionCredential (https://g.alicdn.com/captcha/feilin071.js#SyntheticFragmentCredential:1:1)"
    : `TypeError: ${message}\n    at host (/app/host.ts:1:1)`;
  const source = `
    import { writeSync } from "node:fs";
    import { mock } from "bun:test";
    const bootDelayMs = Number(process.env.T82_TUI_BOOT_DELAY_MS ?? 0);
    if (bootDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, bootDelayMs));
    const store = await import(${JSON.stringify(store)});
    mock.module(${JSON.stringify(store)}, () => ({ ...store, loadCredential: async () => null }));
    Object.defineProperty(process.stdout, "isTTY", { value: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true });
    process.stdin.setRawMode = () => process.stdin;
    const { runTui } = await import(${JSON.stringify(app)});
    await runTui({ configPath: ${JSON.stringify(config)} });
    // Bounded real readiness ack: runTui resolved, so the uncaughtException
    // handler is installed. fd-level write survives the TUI's stdio rerouting.
    writeSync(2, ${JSON.stringify(READY_LINE)} + "\\n");
    const err = new TypeError(${JSON.stringify(message)});
    err.stack = ${JSON.stringify(stack)};
    setTimeout(() => { throw err; }, 0);
    setTimeout(() => process.exit(0), 80);
  `;
  const proc = Bun.spawn([process.execPath, "--eval", source], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
      APPDATA: home, LOCALAPPDATA: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home,
      ZCODE_TUI_LOGFILE: log, T82_TUI_BOOT_DELAY_MS: String(bootDelayMs) }, stdout: "pipe", stderr: "pipe",
  });

  // Only this owned child is ever signalled; it inherits the test's process group.
  let stdoutText = "";
  let stderrText = "";
  let ackSeen = false;
  let childStatus = "running";
  let done = false;
  const stdoutDrained = drainStream(proc.stdout, (chunk) => { stdoutText += chunk; });
  const stderrDrained = drainStream(proc.stderr, (chunk) => {
    stderrText += chunk;
    if (!ackSeen && stderrText.includes(READY_LINE)) ackSeen = true;
  });
  const settled = Promise.all([proc.exited, stdoutDrained, stderrDrained]);
  proc.exited.then((code) => { if (!done) childStatus = `exited code=${code}`; }).catch(() => {});

  const killOwned = (why: string): void => {
    try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    if (!done) childStatus = why;
    done = true;
  };

  const sanitize = (text: string): string => text.split(home).join("<fixture>");
  const tail = (text: string): string => (text.length > 2000 ? `(truncated, showing tail)\n${text.slice(-2000)}` : text);
  const diagnostics = (phase: string, elapsedMs: number): string => {
    const parts = [
      `fixture-phase=${phase}`,
      `ackObserved=${ackSeen}`,
      `child=${childStatus}`,
      `elapsedMs=${elapsedMs}`,
      `fixtureHome=${home}`,
    ];
    const so = tail(sanitize(stdoutText));
    if (so) parts.push(`stdoutTailSanitized=${JSON.stringify(so)}`);
    const se = tail(sanitize(stderrText));
    if (se) parts.push(`stderrTailSanitized=${JSON.stringify(se)}`);
    // Guarded read: a child killed before its first log line must surface as
    // "absent" here, never as a masking ENOENT thrown between tests.
    try { parts.push(`tuiLogTailSanitized=${JSON.stringify(tail(sanitize(readFileSync(log, "utf8"))))}`); }
    catch { parts.push("tuiLog=absent"); }
    return parts.join(" | ");
  };

  const deadline = (ms: number): Promise<"deadline"> => new Promise((resolve) => {
    const t = setTimeout(() => resolve("deadline"), ms);
    if (typeof t.unref === "function") t.unref();
  });

  return {
    home,
    config,
    log,
    async outcome() {
      const startedAt = Date.now();
      // Phase S: startup readiness. Fails finitely — never waits silently.
      const startupWinner = await Promise.race([
        deadline(STARTUP_READINESS_BUDGET_MS),
        settled.then(() => "exited" as const),
      ]);
      if (startupWinner === "deadline") {
        killOwned("killed (SIGKILL) after startup-readiness budget without ack");
        await settled;
        throw new Error(diagnostics("startup-overrun-no-ack", Date.now() - startedAt));
      }
      // Phase C: the classification itself, under its own (unchanged effective)
      // 5 s deadline — an ack'd child that never finishes the throw/exit cycle
      // is killed and reported, never awaited forever.
      const classificationWinner = await Promise.race([
        deadline(CLASSIFICATION_BUDGET_MS),
        settled.then(() => "exited" as const),
      ]);
      if (classificationWinner === "deadline") {
        killOwned("killed (SIGKILL) after classification budget");
        await settled;
        throw new Error(diagnostics("classification-overrun", Date.now() - startedAt));
      }
      // Settled: the child exited and both streams drained, so the ack state
      // is final. A real early exit (config error, crash before the handler is
      // installed) surfaces here with the child's own output in diagnostics.
      const [code] = await settled;
      const elapsedMs = Date.now() - startedAt;
      if (!ackSeen) throw new Error(diagnostics("startup-exited-before-ack", elapsedMs));
      return { code, stdout: stdoutText, stderr: stderrText, elapsedMs };
    },
    async dispose() {
      killOwned("killed (SIGKILL) in dispose");
      await settled.catch(() => {});
      rmSync(home, { recursive: true, force: true });
    },
  };
}

for (const kind of ["guest", "host-cdn-message", "host"] as const) {
  test(`TUI keeps strict actual-frame classification: ${kind}`, async () => {
    const child = spawnTuiChild(kind, 0);
    try {
      const { code, stderr } = await child.outcome();
      expect(stderr).not.toContain("config error");
      expect(stderr).not.toContain("error: ");
      if (!existsSync(child.log)) throw new Error(`tui.log absent (child finished without writing it) | ${child.log}`);
      const pane = readFileSync(child.log, "utf8");
      if (kind === "guest") {
        expect(code).toBe(0);
        expect(pane).toContain("captcha SDK error (ignored)");
        expect(pane).toMatch(/len=26 sha256=[0-9a-f]{64}/);
        expect(pane).not.toContain("SyntheticFunctionCredential");
        expect(pane).not.toContain("SyntheticFragmentCredential");
      } else {
        expect(code).toBe(1);
        expect(stderr).toContain("zcode-proxy: tui crashed:");
        expect(pane).not.toContain("captcha SDK error (ignored)");
      }
    } finally { await child.dispose(); }
  }, TEST_TIMEOUT_MS);
}

// Delayed-readiness control (fixture-side 800 ms boot delay, inside the
// startup budget): the parent must deterministically observe readiness and
// still classify strictly — startup latency alone must never mask or skip the
// classification. Same real runTui + handler path as the guest case above.
test("TUI observes startup readiness before classification: delayed boot stays strictly classified", async () => {
  const child = spawnTuiChild("guest", 800);
  try {
    const { code, stderr } = await child.outcome();
    expect(stderr).not.toContain("config error");
    expect(stderr).not.toContain("error: ");
    if (!existsSync(child.log)) throw new Error(`tui.log absent (child finished without writing it) | ${child.log}`);
    const pane = readFileSync(child.log, "utf8");
    expect(code).toBe(0);
    expect(pane).toContain("captcha SDK error (ignored)");
    expect(pane).not.toContain("SyntheticFunctionCredential");
    expect(pane).not.toContain("SyntheticFragmentCredential");
  } finally { await child.dispose(); }
}, TEST_TIMEOUT_MS);
