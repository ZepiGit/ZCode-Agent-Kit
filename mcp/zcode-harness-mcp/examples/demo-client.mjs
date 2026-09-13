/**
 * Demo client — shows the full flow FROM THE PERSPECTIVE OF ANOTHER AGENT:
 *   discover capabilities → choose workspace → read models → try GLM-5.3-Flash
 *   → inspect/change a setting → start a task → poll progress → answer
 *   interactions → read result + artifacts → follow-up in the same session.
 *
 * Run against the REAL installed harness (default):
 *   node examples/demo-client.mjs --workspace "C:\path\to\project"
 * Run against the fixture harness (offline demo):
 *   node examples/demo-client.mjs --workspace <dir> --fixture
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (name) => argv.includes(`--${name}`);

let workspace = flag("workspace") ?? path.join(projectRoot, "demo-workspace");
const useFixture = has("fixture");
fs.mkdirSync(workspace, { recursive: true });

const dataDir = path.join(os.tmpdir(), `zcode-harness-demo-${Date.now()}`);
fs.mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });

const args = [
  path.join(projectRoot, "dist", "index.js"),
  "--stdio",
  "--data-dir", dataDir,
  "--allow-workspace", workspace,
  "--interaction-policy", "ask",
  "--interaction-timeout-sec", "120",
];
const childEnv = { ...process.env, ZCODE_HARNESS_LOG_LEVEL: "warn" };
if (useFixture) {
  childEnv.ZCODE_HARNESS_RUNTIME_PATH = path.join(projectRoot, "test", "fixture", "fake-harness.mjs");
}

const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], env: childEnv });
let buf = "";
let nextId = 1;
const pending = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && msg.method === undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {
      /* ignore */
    }
  }
});
child.stderr.on("data", () => {});

const call = (method, params, timeoutMs = 60_000) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, timeoutMs);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
};
const result = async (method, params, timeoutMs) => {
  const resp = await call(method, params, timeoutMs);
  if (resp.error) throw new Error(`MCP error: ${JSON.stringify(resp.error)}`);
  return resp.result;
};
const tool = async (name, a, timeoutMs) => {
  const resp = await result("tools/call", { name, arguments: a ?? {} }, timeoutMs);
  if (resp.isError) throw new Error(resp.content?.[0]?.text ?? "tool error");
  return resp.structuredContent ?? JSON.parse(resp.content?.[0]?.text ?? "{}");
};
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

// Handshake
const init = await result("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "zcode-harness-demo", version: "0.1.0" },
});
console.log("connected to:", JSON.stringify(init.serverInfo));
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

step(1, "Fähigkeiten entdecken");
const health = await tool("zcode_health", {});
console.log(`  harness: ${health.runtime.harnessVersion ?? "?"} @ ${health.runtime.harnessPath}`);
console.log(`  fingerprint: ${health.runtime.bundleFingerprint} | protocol: ${health.protocol}`);
const caps = await tool("zcode_capabilities", {});
console.log(`  capabilities: ${caps.capabilities.length} Einträge (available: ${caps.capabilities.filter((c) => c.availability === "available").length})`);

step(2, "Workspace wählen und öffnen");
const ws = await tool("zcode_workspace_open", { workspacePath: workspace });
console.log(`  workspace: ${workspace} (revision ${ws.revision})`);

step(3, "Verfügbare Modelle lesen (echter Katalog)");
const models = await tool("zcode_models_list", { workspacePath: workspace });
const catalogIds = (models.modelCatalog.available ?? []).map((m) => `${m.ref.providerId}/${m.ref.modelId}`);
console.log(`  Katalog: ${catalogIds.join(", ")}`);

step(4, "GLM-5.3-Flash versuchen (nur wenn wirklich im Katalog)");
const flash = catalogIds.find((id) => id.toLowerCase() === "zai/glm-5.3-flash");
if (flash) {
  console.log(`  ${flash} ist verfügbar und wird bevorzugt.`);
} else {
  console.log("  GLM-5.3-Flash ist NICHT im lokalen Katalog — kein stiller Ersatzmodell-Wechsel.");
  console.log(`  Bevorzugt stattdessen: ${catalogIds[0]} (erster Katalogeintrag)`);
}
const preferred = flash ?? catalogIds[0];

step(5, "Einstellung prüfen, ändern und zurücksetzen");
const schema = await tool("zcode_settings_schema", { workspacePath: workspace });
const modeSetting = schema.settings.find((s) => s.path === "mode");
console.log(`  mode: effektiv=${modeSetting.effective}, schreibbar=${modeSetting.writable}`);
const upd = await tool("zcode_settings_update", { workspacePath: workspace, changes: { mode: "build" } });
console.log(`  update: ${JSON.stringify(upd.applied)} (revision ${upd.revision})`);

step(6, "Aufgabe starten (nicht-blockierend)");
const task = await tool("zcode_task_start", {
  workspacePath: workspace,
  prompt: "Schreibe die Datei demo-notiz.txt mit genau einer Zeile: Demo vom MCP-Bridge-Test.",
  model: preferred,
  idempotencyKey: "demo-" + Date.now(),
});
console.log(`  taskId=${task.taskId} state=${task.state}`);

step(7, "Zwischenstände abrufen (Polling + Events)");
let rec = task;
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  rec = await tool("zcode_task_get", { taskId: task.taskId });
  const evs = await tool("zcode_task_events", { taskId: task.taskId, afterSeq: i === 0 ? -1 : undefined, limit: 5 }).catch(() => null);
  process.stdout.write(`  t+${i + 1}s state=${rec.state}${evs ? ` lastSeq=${evs.nextSeq}` : ""}\r`);
  if (["completed", "failed", "cancelled", "interrupted", "unknown"].includes(rec.state)) break;
}
console.log("");

step(8, "Gegebenenfalls Rückfragen beantworten");
const pendingIa = await tool("zcode_interactions_list", { status: "pending" });
if ((pendingIa.interactions ?? []).length > 0) {
  for (const ia of pendingIa.interactions) {
    console.log(`  Rückfrage ${ia.id} (${ia.kind}, tool=${ia.toolName ?? "-"})`);
    const denyOption = ia.options.find((o) => o.kind === "deny" || o.id.startsWith("deny"));
    if (denyOption) {
      await tool("zcode_interaction_respond", { interactionId: ia.id, optionId: denyOption.id });
      console.log(`    -> abgelehnt (${denyOption.id}) — Vorsicht vor automatisch erlaubten Aktionen`);
    } else {
      console.log("    -> keine sichere Option erkennbar; offen gelassen (Timeout-Policy greift)");
    }
  }
} else {
  console.log("  keine offenen Rückfragen");
}

step(9, "Ergebnis und Artefakte lesen");
const taskResult = await tool("zcode_task_result", { taskId: task.taskId });
console.log(`  status=${taskResult.status} partial=${taskResult.partial} (${taskResult.completeness.explanation})`);
console.log(`  modell: angefordert=${taskResult.requestedModel ?? "-"} effektiv=${taskResult.effectiveModel ? taskResult.effectiveModel.providerId + "/" + taskResult.effectiveModel.modelId : "-"}`);
console.log(`  antwort: ${JSON.stringify((taskResult.responseText ?? "").slice(0, 120))}`);
console.log(`  nutzung: ${JSON.stringify(taskResult.usage.cumulative ?? "null (fehlt = nicht gemessen, nicht 0)")}`);
console.log(`  dateiänderungen: ${JSON.stringify(taskResult.fileChanges.modified ?? [])}`);
for (const art of taskResult.artifacts ?? []) {
  try {
    const artifact = await tool("zcode_artifact_read", { workspacePath: workspace, path: art.path, length: 4096 });
    const text = Buffer.from(artifact.contentBase64 ?? "", "base64").toString("utf8");
    console.log(`  artefakt ${art.path}: ${JSON.stringify(text.slice(0, 80))}`);
  } catch (err) {
    console.log(`  artefakt ${art.path}: nicht lesbar (${String(err).slice(0, 80)})`);
  }
}

step(10, "Folgeauftrag in derselben Session");
if (["completed", "failed", "cancelled", "interrupted", "unknown"].includes(rec.state)) {
  try {
    const follow = await tool("zcode_task_input", { taskId: task.taskId, content: "Nenne in einem Satz, was du gerade getan hast." });
    console.log(`  Folgeauftrag akzeptiert, state=${follow.state}, followUps=${follow.followUpCount}`);
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      rec = await tool("zcode_task_get", { taskId: task.taskId });
      if (["completed", "failed", "cancelled", "interrupted", "unknown"].includes(rec.state)) break;
    }
    const result2 = await tool("zcode_task_result", { taskId: task.taskId });
    console.log(`  endstatus=${result2.status}, antwort=${JSON.stringify((result2.responseText ?? "").slice(0, 120))}`);
  } catch (err) {
    console.log(`  Folgeauftrag nicht möglich: ${String(err).slice(0, 120)}`);
  }
}

console.log("\nDemo beendet.");
child.stdin.end();
await new Promise((r) => setTimeout(r, 300));
child.kill();
process.exit(0);
