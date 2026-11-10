import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real runTui + installed handler, not a second copy of its classifier. Terminal
// capabilities are synthetic; no PTY/Unix helper is required on Windows.
const app = fileURLToPath(new URL("./app.ts", import.meta.url));
const store = fileURLToPath(new URL("../auth/store.ts", import.meta.url));
for (const kind of ["guest", "host-cdn-message", "host"] as const) {
  test(`TUI keeps strict actual-frame classification: ${kind}`, async () => {
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
      import { mock } from "bun:test";
      const store = await import(${JSON.stringify(store)});
      mock.module(${JSON.stringify(store)}, () => ({ ...store, loadCredential: async () => null }));
      Object.defineProperty(process.stdout, "isTTY", { value: true });
      Object.defineProperty(process.stdin, "isTTY", { value: true });
      process.stdin.setRawMode = () => process.stdin;
      const { runTui } = await import(${JSON.stringify(app)});
      await runTui({ configPath: ${JSON.stringify(config)} });
      const err = new TypeError(${JSON.stringify(message)});
      err.stack = ${JSON.stringify(stack)};
      setTimeout(() => { throw err; }, 0);
      setTimeout(() => process.exit(0), 80);
    `;
    const proc = Bun.spawn([process.execPath, "--eval", source], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
        APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home,
        ZCODE_TUI_LOGFILE: log }, stdout: "pipe", stderr: "pipe",
    });
    // Only this owned child is ever signalled; it inherits the test's process group.
    const timer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
    try {
      const [code, , stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect(stderr).not.toContain("config error");
      expect(stderr).not.toContain("error: ");
      const pane = readFileSync(log, "utf8");
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
    } finally { clearTimeout(timer); await proc.exited; rmSync(home, { recursive: true, force: true }); }
  });
}
