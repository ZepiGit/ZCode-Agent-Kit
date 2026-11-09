// Fixtures for the output module's primitives (lib/term/out.mjs): record lists
// as command modules will return them (`{ exitCode, records }`), plus a
// progress script driven with a fake clock. Used by tests/term-snapshots.test.mjs
// for the byte snapshots in every C3 variant and the escape-sequence scan.
// Values are synthetic: no real path, key or account.
import { renderRecords } from "../lib/term/out.mjs";

const KEY = "UXFIXTURE-not-a-secret-0000000000000000000";

/** name → (out, clock) => void */
export const PRIMITIVE_FIXTURES = {
  "checks": (out) => renderRecords(out, [
    { kind: "heading", title: "Runtime" },
    { kind: "check", status: "pass", name: "bun available", detail: "/opt/bun/bin/bun (1.4.2)" },
    { kind: "check", status: "pass", name: "config exists", detail: "proxy/config.yaml" },
    { kind: "check", status: "fail", name: "mcp bridge deps", detail: "mcp/zcode-harness-mcp/node_modules missing",
      why: "the last setup was interrupted before the bridge dependencies were installed", next: "zcode-kit setup" },
    { kind: "check", status: "warn", name: "restart budget", detail: "2 of 3 restarts used in 15 min",
      why: "the proxy restarted twice for memory", next: ["zcode-kit proxy logs 50", "zcode-kit doctor"] },
    { kind: "check", status: "skip", name: "pi: integration", detail: "not configured (no consent yet) — answer y in zcode-kit setup" },
    { kind: "check", status: "pass", name: "omp: omp extension installed" },
    { kind: "verdict", label: "doctor", counts: { pass: 3, fail: 1, warn: 1, skip: 1 }, exit: 1 },
  ]),
  "verdict-clean": (out) => renderRecords(out, [
    { kind: "verdict", label: "doctor", counts: { pass: 12, fail: 0, warn: 0, skip: 3 } },
    { kind: "verdict", label: "accounts doctor", counts: { pass: 1, warn: 2 } },
    { kind: "verdict", label: "upstream", counts: {} },
  ]),
  "results": (out) => renderRecords(out, [
    { kind: "result", status: "ok", label: "OMP / Oh My Pi", detail: "provider, key resolver, autostart extension" },
    { kind: "result", status: "fail", label: "OpenCode", detail: "provider.zcode missing from opencode.json" },
    { kind: "result", status: "warn", label: "Codex", detail: "launcher not on PATH" },
    { kind: "result", status: "skip", label: "Claude Code", detail: "declined" },
    { kind: "result", status: "info", label: "Account Rotator disabled" },
  ]),
  "kv": (out) => renderRecords(out, [
    { kind: "heading", title: "Proxy" },
    { kind: "kv", pairs: [
      ["State", "running since 1 h 02 min (pid 4242)"],
      ["Port", "18458 (loopback only)"],
      ["Version", "0.2.42 (proxy 4.6.4)"],
      ["Note", "a long value that has to wrap on an interactive terminal at eighty columns, under its own column and never in the middle of /a/very/long/path/token/that/stays/whole"],
      ["Empty", ""],
    ] },
  ]),
  "table": (out) => renderRecords(out, [
    { kind: "heading", title: "Accounts" },
    { kind: "table",
      fields: [
        { key: "id", title: "Account" },
        { key: "state", title: "State" },
        { key: "used", title: "Used", align: "right" },
        { key: "quota", title: "Quota", truncate: true },
      ],
      rows: [
        { id: "work", state: "ready", used: "1880", quota: "GLM Coding Lite 4120/6000 (69 %) resets 2026-12-31, plenty of room left for the rest of the month" },
        { id: "personal", state: "exhausted", used: "200", quota: "Start Plan Bonus 0/200 (0 %) resets 2026-11-30" },
        { id: "backup", state: "paused", used: "0", quota: "" },
      ],
      marker: (row) => row.id === "work",
      footer: "* active account",
    },
  ]),
  "connection-running": (out) => renderRecords(out, [
    { kind: "connection", facts: { port: 18458, key: KEY, models: ["glm-5.3", "glm-5.3-flash"], modelsSource: "live", source: "running" }, reveal: true },
  ]),
  "connection-configured-exposed": (out) => renderRecords(out, [
    { kind: "connection", facts: { port: 18458, key: KEY, host: "0.0.0.0", source: "configured" }, reveal: false },
  ]),
  // Ticket 40: the lead line, state lines, a blank separator and the verbose card.
  "lead-state": (out) => renderRecords(out, [
    { kind: "lead", counts: { fail: 2, warn: 1 } },
    { kind: "blank" },
    { kind: "state", status: "run", text: "running, up 1 h 02 min (pid 4242)" },
    { kind: "state", status: "stop", text: "stopped" },
    { kind: "state", status: "warn", text: "not answering (pid 4242 is alive)" },
  ]),
  "connection-verbose": (out) => renderRecords(out, [
    { kind: "connection", facts: { port: 18458, key: KEY, models: ["glm-5.3", "glm-5.3-flash"], modelsSource: "config", source: "running" }, reveal: false, verbose: true },
  ]),
  "next": (out) => renderRecords(out, [
    { kind: "next", commands: ["zcode-kit proxy start", "zcode-kit doctor --fix"] },
  ]),
  "diagnostics": (out) => renderRecords(out, [
    { kind: "error", what: "Port 18458 is in use by another service",
      why: "it answered /health without this kit's identity (HTTP 401); the kit never stops a service it did not start",
      next: ["zcode-kit proxy status", "change server.port in proxy/config.yaml, then zcode-kit proxy start"], exit: 3 },
    { kind: "warn", what: "Account Rotator question skipped", why: "stdin is not a terminal", next: "zcode-kit setup --reask" },
    { kind: "note", text: "Account Rotator disabled" },
  ]),
  "data-json": (out) => renderRecords(out, [
    { kind: "data", text: "r001 ANT glm-5.3 200 stream 812ms→6.4s 1830tok 286t/s" },
    { kind: "data", text: "line with its own newline\n" },
    { kind: "json", value: { ok: true, failed: 0, checks: [{ name: "bun available", ok: true }] } },
  ]),
  "progress": (out, clock) => {
    const a = out.step("Proxy dependencies", [2, 4]);
    clock.tick(250);
    a.update("Proxy dependencies (bun install)");
    clock.tick(2500);
    a.done();
    const b = out.step("Connection check");
    clock.tick(150);
    b.skip("ZCODE_KIT_SKIP_DEPS=1");
    const c = out.step("Start proxy");
    clock.tick(100);
    c.fail({ why: "the port is taken by another service", next: "zcode-kit proxy status", exit: 3 });
  },
};

/** A manual clock: setInterval callbacks run on tick(), in order. */
export function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  const timers = new Set();
  return {
    now: () => now,
    setInterval(fn, ms) { const t = { fn, ms, next: now + ms }; timers.add(t); return t; },
    clearInterval(t) { timers.delete(t); },
    tick(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter((t) => t.next <= until).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.fn();
      }
      now = until;
    },
  };
}
