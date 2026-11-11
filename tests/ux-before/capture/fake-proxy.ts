// UX capture fixture: stands in for zcode-proxy-src/src/index.ts inside a
// capture fixture kit. The kit's proxy manager spawns `bun run <this> serve`;
// `serve` answers the kit's identity contract (/health, /quota, /v1/models,
// /accounts/*) with FIXED data so snapshots are deterministic. Any other
// argv (auth accounts …, --cli …) is forwarded to the REAL proxy CLI so the
// account commands render their real output against the fixture store.
// Never reaches the network; binds 127.0.0.1 only. Same pattern as the
// mock proxies in tests/manager-safety.test.mjs and tests/auto-heal.test.mjs.
import { readFileSync } from "node:fs";

const REAL_PROXY_SRC = "__REAL_PROXY_SRC__";
const args = process.argv.slice(2);
// Faults belong only to this synthetic public capture path, never production.
if (args[0] === "auth" && args[1] === "accounts" && args[2] === "health" && process.env.UX_CAPTURE_FAULT) {
  console.error(`UX_CAPTURE_FAULT ${process.env.UX_CAPTURE_FAULT} pid=${process.pid}`);
  if (["drain", "early-exit-drain"].includes(process.env.UX_CAPTURE_FAULT)) {
    // An actual inherited pipe, not a fabricated missing-close event. The
    // keeper remains live and owns this descendant until its tree is reaped.
    const { spawn } = await import("node:child_process");
    const holder = spawn(process.env.UX_CAPTURE_NODE!, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });
    console.error(`UX_CAPTURE_PIPE_HOLDER pid=${holder.pid}`);
    holder.unref();
    process.exit(process.env.UX_CAPTURE_FAULT === "early-exit-drain" ? 23 : 0);
  }
  if (process.env.UX_CAPTURE_FAULT === "early-exit") process.exit(23);
  if (process.env.UX_CAPTURE_FAULT === "hang") await new Promise(() => { setInterval(() => {}, 1000); });
}

if (args[0] !== "serve") {
  // Pin only the fixture health CLI's report clock to the reviewed capture
  // date. The fixed status timestamps below are then 5d old, and its expired
  // exhaustion stays expired (pinning to Nov 5 would change the verdict).
  // The real producer still builds asOf and consumes real loopback JSON.
  // No production clock, other command, timer or capture normalizer changes.
  if (args[0] === "auth" && args[1] === "accounts" && args[2] === "health") {
    Date.now = () => Date.parse("2026-11-11T00:00:00.000Z");
  }
  const real = await import(`${REAL_PROXY_SRC}/src/index.ts`);
  real.main();
} else {
  const configPath = process.env.ZCODE_PROXY_CONFIG ?? "config.yaml";
  const text = readFileSync(configPath, "utf8");
  const port = Number(text.match(/^  port:\s*(\d+)/m)?.[1] ?? 0);
  const key = text.match(/^  proxyApiKey:\s*"([^"]+)"/m)?.[1] ?? "";
  if (!port || port === 8457) {
    console.error("fake-proxy: refusing to bind the production port (fixture config must use 18458)");
    process.exit(2);
  }
  const NOW = Date.parse("2026-11-05T12:00:00.000Z");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const balances = [
    { showName: "GLM Coding Lite", remainingUnits: 4120, totalUnits: 6000, usedUnits: 1880, unitType: "prompts", expiresAt: 1798761600 },
    { showName: "Start Plan Bonus", remainingUnits: 35, totalUnits: 200, usedUnits: 165, unitType: "prompts", expiresAt: 1796083200 },
  ];
  const health = {
    status: "ok",
    provider: "zai",
    details: {
      pid: 4242, uptimeSec: 3725, rssMB: 182, heapUsedMB: 64, eventLoopLagMs: 2,
      captcha: {
        ready: 2, target: 2, activeSolves: 0, storm: false, mintSuccessRate10m: 0.96,
        solver: { generation: 3, recycles: 2, lastRecycleReason: "rss-budget", lastRecycleAt: NOW - 600_000, totalSolves: 118, totalFailures: 3, busy: false },
      },
    },
  };
  let seq = 0;
  const log = (line: string) => console.log(line);
  log(`zcode-proxy listening on http://127.0.0.1:${port}`);
  log("  captcha egress: direct");
  log("  provider: zai");
  log("  plan: start-plan");
  log("  models: 2 available");
  log("  /v1/responses: ON");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (req.headers.get("authorization") !== `Bearer ${key}` && req.headers.get("x-api-key") !== key) {
        return json({ error: { type: "unauthorized", message: "invalid proxy key" } }, 401);
      }
      switch (url.pathname) {
        case "/health": return json(health);
        case "/quota": return json({ provider: "zai", serverTime: NOW / 1000, jwt: { ageHours: 5.2, issuedAt: Math.floor(Date.now() / 1000) - 18720 }, balances, claimablePlans: [], errors: [], asOf: new Date(NOW).toISOString(), cached: false });
        case "/v1/models": return json({ object: "list", data: [{ id: "glm-5.3", object: "model" }, { id: "glm-5.3-flash", object: "model" }] });
        case "/accounts/status": return json({ schemaVersion: 1, source: "live-runtime", activeAccountId: "work", accounts: [
          { id: "work", state: "ready", provider: "zai", plan: "coding-plan", lastUsedAt: NOW - 120_000, exhaustedUntil: null },
          { id: "personal", state: "exhausted", provider: "zai", plan: "start-plan", lastUsedAt: NOW - 7_200_000, exhaustedUntil: NOW + 3_600_000 },
          { id: "backup", state: "paused", provider: "bigmodel", plan: "coding-plan", lastUsedAt: null, exhaustedUntil: null },
        ] });
        case "/accounts/quota": return json({ schemaVersion: 1, source: "live-runtime", totals: balances, accounts: [
          { accountId: "work", source: "live", balances: [balances[0]], errors: [] },
          { accountId: "personal", source: "live", balances: [{ ...balances[1], remainingUnits: 0, usedUnits: 200 }], errors: [] },
          { accountId: "backup", source: "skipped", balances: [], errors: [] },
        ] });
        case "/v1/chat/completions": {
          seq++;
          log(`r${String(seq).padStart(3, "0")} OAI glm-5.3-flash 200 batch 412ms 18tok 44t/s`);
          return json({ id: "chatcmpl-ux", object: "chat.completion", model: "glm-5.3-flash", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
        }
        default: return json({ error: { type: "not_found" } }, 404);
      }
    },
  });
  // Capture-owned mode uses stdin EOF as its explicit stop request; manager
  // fixtures retain their historical signal/identity behavior.
  if (process.env.UX_CAPTURE_OWNED_LISTENER === "1") {
    process.stdin.resume();
    process.stdin.once("end", async () => {
      await server.stop(true);
      console.log("UX_LISTENER_STOPPED");
    });
    console.log("UX_LISTENER_READY");
  }
  // Seed the log so `proxy logs` has representative content (compact format).
  log("r001 ANT glm-5.3 200 stream 812ms→6.4s 1830tok 286t/s");
  log("r002 OAI glm-5.3-flash 200 stream 390ms→2.1s 402tok 191t/s");
  log("r003 ANT glm-5.3 429 batch 233ms");
  log("[captcha] solver recycled (rss-budget) generation=3");
  log("r004 OAI glm-5.3-flash 200 batch 412ms 18tok 44t/s");
}
