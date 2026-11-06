// UX capture: render proxy-TUI frames to text with the REAL pure renderer
// (zcode-proxy-src/src/tui/frame.ts + log-pane.ts). Deterministic fake state,
// no terminal, no network. Prints one JSON object { name: { cols, rows, text } }.
// usage: bun render-tui.ts <proxy-src>
const src = process.argv[2];
const { buildFrame } = await import(`${src}/src/tui/frame.ts`);
const { LogPane } = await import(`${src}/src/tui/log-pane.ts`);

const base = {
  version: "4.6.4",
  configPath: "<KIT>/proxy/config.yaml",
  provider: "zai",
  plan: "start-plan",
  loggedIn: true,
  apiKeyPreview: "sk-…a1b2",
  loginInFlight: false,
  loginHint: "",
  serverStatus: "running" as const,
  serverUrl: "http://127.0.0.1:18458",
  serverError: "",
  modelCount: 2,
  responsesEnabled: true,
  claimAuto: false,
  logTotal: 0,
  logView: [] as Array<{ level: string; text: string }>,
  logFollowing: true,
  logFromBottom: 0,
  toast: null as null | { text: string; kind: "ok" | "err" | "info" },
};

function pane(n: number) {
  const p = new LogPane(2000);
  p.push("zcode-proxy listening on http://127.0.0.1:18458");
  p.push("  provider: zai · plan: start-plan · models: 2 available");
  for (let i = 1; i <= n; i++) {
    if (i % 9 === 0) p.push(`r${String(i).padStart(3, "0")} ANT glm-5.3 429 batch 233ms  rate limited — retry in 30s`, "warn");
    else if (i % 13 === 0) p.push(`r${String(i).padStart(3, "0")} OAI glm-5.3-flash 502 stream 1.2s  upstream error: 上游服务暂时不可用 (provider_1305)`, "error");
    else p.push(`r${String(i).padStart(3, "0")} ${i % 2 ? "ANT glm-5.3" : "OAI glm-5.3-flash"} 200 stream ${300 + i * 7}ms→${(2 + i / 10).toFixed(1)}s ${400 + i * 31}tok ${150 + i}t/s`);
  }
  return p;
}

function withLogs(p: InstanceType<typeof LogPane>, rows: number, extra: Partial<typeof base> = {}) {
  const view = p.view(rows);
  return { ...base, logTotal: view.total, logView: view.lines, logFollowing: view.fromBottom === 0, logFromBottom: view.fromBottom, ...extra };
}

const out: Record<string, { cols: number; rows: number; text: string }> = {};
const add = (name: string, cols: number, rows: number, state: Record<string, unknown>) => {
  out[name] = { cols, rows, text: buildFrame({ ...state, width: cols, height: rows }).text };
};

for (const [cols, rows] of [[80, 24], [120, 40]] as const) {
  const tag = `${cols}x${rows}`;
  add(`first-run-logged-out-${tag}`, cols, rows, { ...base, loggedIn: false, apiKeyPreview: "", serverStatus: "stopped", serverUrl: "" });
  add(`login-in-flight-${tag}`, cols, rows, { ...base, loggedIn: false, loginInFlight: true, loginHint: "waiting for browser authorization… press L to paste a code instead", serverStatus: "stopped" });
  const p = pane(60);
  add(`running-following-${tag}`, cols, rows, withLogs(p, rows));
  const scrolled = pane(60);
  scrolled.scrollUp(25);
  add(`running-scrolled-${tag}`, cols, rows, withLogs(scrolled, rows));
  add(`server-error-${tag}`, cols, rows, withLogs(pane(5), rows, { serverStatus: "error", serverError: "listen EADDRINUSE: port 18458 is already in use", serverUrl: "", toast: { text: "start failed: port 18458 is already in use", kind: "err" } }));
  add(`toast-ok-${tag}`, cols, rows, withLogs(pane(8), rows, { toast: { text: "proxy started on http://127.0.0.1:18458", kind: "ok" } }));
}
add("too-small-38x12", 38, 12, base);
console.log(JSON.stringify(out));
