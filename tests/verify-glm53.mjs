#!/usr/bin/env node
// Post-reset verification for GLM-5.3 (daily 3M-token bucket, resets 18:00
// local). Run from the clone root: node tests/verify-glm53.mjs
// (proxy must be running; uses the clone's own .proxykey).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.ZCODE_KIT_LIVE_TEST !== '1') throw new Error('Live quota-consuming test requires ZCODE_KIT_LIVE_TEST=1');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KEY = readFileSync(join(ROOT, ".proxykey"), "utf8").trim();
const BASE = "http://127.0.0.1:8457";
const BUDGETS = { low: 2048, high: 16384, max: 32768 };

let failed = 0;
for (const effort of ["low", "high", "max"]) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "glm-5.3",
      max_tokens: 2000,
      stream: false,
      thinking: { type: "enabled", budget_tokens: BUDGETS[effort] },
      output_config: { effort },
      messages: [{ role: "user", content: "Antworte mit exakt einem Wort: BEREIT" }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json().catch(() => ({}));
  const text = (j.content ?? []).map((c) => c.text ?? "").join("").trim();
  const ok = res.status === 200 && text.length > 0;
  console.log(`glm-5.3 ${effort}: HTTP ${res.status} | "${text.slice(0, 40)}" ${ok ? "OK" : "| FAIL " + JSON.stringify(j).slice(0, 120)}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "GLM-5.3 ALL LEVELS VERIFIED" : `${failed} level(s) failed`);
process.exit(failed ? 2 : 0);
