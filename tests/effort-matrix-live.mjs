#!/usr/bin/env node
// Effort matrix: both models x low/high/max against the LOCAL PROXY (live,
// start-plan quota). Tiny budgets. Records status, usage, effort echo.
// Run from the clone root: node tests/effort-matrix-live.mjs (uses .proxykey).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.ZCODE_KIT_LIVE_TEST !== '1') throw new Error('Live quota-consuming test requires ZCODE_KIT_LIVE_TEST=1');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KEY = readFileSync(join(ROOT, ".proxykey"), "utf8").trim();
const BASE = "http://127.0.0.1:8457";
const BUDGETS = { low: 2048, high: 16384, max: 32768 };

const results = [];
for (const model of ["glm-5.3", "glm-5.3-flash"]) {
  for (const effort of ["low", "high", "max"]) {
    const t0 = Date.now();
    let status = 0, usage = null, text = "", err = null, modelEcho = null, tier = null;
    try {
      const res = await fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          stream: false,
          thinking: { type: "enabled", budget_tokens: BUDGETS[effort] },
          output_config: { effort },
          messages: [{ role: "user", content: "Antworte mit exakt einem Wort: BEREIT" }],
        }),
        signal: AbortSignal.timeout(180000),
      });
      status = res.status;
      const j = await res.json();
      modelEcho = j.model ?? null;
      tier = j.usage?.service_tier ?? null;
      usage = j.usage ? { in: j.usage.input_tokens, out: j.usage.output_tokens, cacheRead: j.usage.cache_read_input_tokens } : null;
      text = (j.content ?? []).map((c) => c.text ?? "").join("").trim().slice(0, 60);
      if (!res.ok) err = (j.error?.message ?? "").slice(0, 120);
    } catch (e) {
      err = String(e).slice(0, 120);
    }
    const row = { model, effort, status, modelEcho, tier, usage, text, err, ms: Date.now() - t0 };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
const bad = results.filter((r) => r.status !== 200);
console.log(bad.length === 0 ? "ALL 6 COMBINATIONS OK" : `FAILURES: ${bad.length}`);
process.exit(bad.length ? 2 : 0);
