/**
 * Frame-time benchmark for the proxy TUI's pure renderer (ticket 05, S6
 * "no frame-time regression from the width core").
 *
 * A full 2,000-line log pane (the TUI's own capacity, app.ts: new LogPane(2000))
 * is rendered completely: the frame height is chosen so every one of the 2,000
 * lines goes through the width core (truncate + measure + pad). Two fixtures:
 * ASCII proxy log lines, and mixed CJK/emoji lines (VS16, ZWJ, flags, skin
 * tones, combining marks). Each fixture is rendered at 80 and 120 columns.
 *
 * usage: bun tests/bench/tui-frame-time.ts <zcode-proxy-src> [frames]
 * Prints one JSON object: { "<fixture>@<cols>": { frames, p50, p95, mean } } (ms).
 * The script only uses buildFrame/LogPane, so it runs unchanged against the
 * base commit and against the change.
 */
const src = process.argv[2];
if (!src) throw new Error("usage: bun tests/bench/tui-frame-time.ts <zcode-proxy-src> [frames]");
const FRAMES = Number(process.argv[3] ?? 300);
const WARMUP = 30;
const { buildFrame } = await import(`${src}/src/tui/frame.ts`);
const { LogPane } = await import(`${src}/src/tui/log-pane.ts`);

const LINES = 2000;

function asciiLine(i: number): string {
  const id = `r${String(i).padStart(4, "0")}`;
  if (i % 9 === 0) return `${id} ANT glm-5.3 429 batch 233ms  rate limited - retry in 30s`;
  if (i % 13 === 0) return `${id} OAI glm-5.3-flash 502 stream 1.2s  upstream error: {"error":{"code":"1305","message":"service temporarily unavailable, please retry later"}} trace=${"ab12".repeat(12)}`;
  return `${id} ${i % 2 ? "ANT glm-5.3" : "OAI glm-5.3-flash"} 200 stream ${300 + i * 7}ms->${(2 + i / 10).toFixed(1)}s ${400 + i * 31}tok ${150 + i}t/s`;
}

function mixedLine(i: number): string {
  const id = `r${String(i).padStart(4, "0")}`;
  switch (i % 5) {
    case 0: return `${id} OAI glm-5.3 502 上游服务暂时不可用 (provider_1305) 请稍后重试 ✅ 完成 日志`;
    case 1: return `${id} ANT glm-5.3 200 ❤️ thanks 👍🏽 🧑‍🌾 farmer 👨‍👩‍👧 family 🇩🇪🇫🇷 flags`;
    case 2: return `${id} 한국어 응답 오류 ⌚ 시간 초과 — 재시도 中文 テスト ｶﾀｶﾅ ＡＢＣ`;
    case 3: return `${id} café e\u0301 naïve שָׁלוֹם नमस्ते 🚀 launch ⭐ star 🟢 ok 🫠`;
    default: return `${id} mixed 日本語のログ行 with ascii tail and emoji 🎉🎉 and more text to overflow`;
  }
}

function fillPane(line: (i: number) => string) {
  const pane = new LogPane(LINES);
  for (let i = 0; i < LINES; i++) pane.push(line(i), i % 50 === 0 ? "warn" : i % 77 === 0 ? "error" : "info");
  return pane;
}

function stateFor(pane: InstanceType<typeof LogPane>, width: number) {
  // Fixed rows outside the log card: 7 (settings card) + 1 + 5 (proxy card)
  // + 1 + 2 (log card borders) + 1 (footer) = 17; 40 spare rows on top.
  const height = LINES + 40;
  const view = pane.view(LINES);
  return {
    version: "4.6.4", configPath: "/bench/config.yaml", provider: "zai", plan: "start-plan", loggedIn: true,
    apiKeyPreview: "sk-…a1b2", loginInFlight: false, loginHint: "", serverStatus: "running",
    serverUrl: "http://127.0.0.1:18458", serverError: "", modelCount: 2, responsesEnabled: true, claimAuto: false,
    logTotal: view.total, logView: view.lines, logFollowing: true, logFromBottom: 0, toast: null, width, height,
  };
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const out: Record<string, { frames: number; p50: number; p95: number; mean: number }> = {};
for (const [name, line] of [["ascii", asciiLine], ["mixed", mixedLine]] as const) {
  const pane = fillPane(line);
  for (const cols of [80, 120]) {
    const state = stateFor(pane, cols);
    const rendered = buildFrame(state).text.split("\n").length;
    if (rendered < LINES) throw new Error(`frame rendered ${rendered} rows, expected >= ${LINES}`);
    for (let i = 0; i < WARMUP; i++) buildFrame(state);
    const ms: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      const t0 = performance.now();
      buildFrame(state);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const r = (n: number) => Number(n.toFixed(3));
    out[`${name}@${cols}`] = { frames: FRAMES, p50: r(pct(ms, 50)), p95: r(pct(ms, 95)), mean: r(ms.reduce((a, b) => a + b, 0) / ms.length) };
  }
}
console.log(JSON.stringify(out));
