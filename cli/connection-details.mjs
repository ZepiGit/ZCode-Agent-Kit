// Copyable connection details for manual client setup (no harness adapter
// involved). Values come from this installation's runtime files or the
// running proxy — never from defaults that may not match the instance.
//
// Secret handling: the local proxy key is printed in full only for a human
// at an interactive terminal (stdin and stdout are TTYs, no CI marker). Logs,
// CI, pipes, JSON and installer log files get a redaction marker;
// `zcode-kit models --show-key` remains the explicit opt-in for exporting the
// key to another program.
import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_MODEL_IDS = ["glm-5.3", "glm-5.3-flash"];
export const REDACTED_KEY = "(redacted: not an interactive terminal — print it with: zcode-kit models --show-key)";

export function shouldRevealKey({ stdin = process.stdin, stdout = process.stdout, env = process.env, json = false } = {}) {
  if (json) return false;
  if (stdout.isTTY !== true || stdin.isTTY !== true) return false;
  return !(env.CI && !/^(0|false)$/i.test(env.CI));
}

function readConfig(configPath) {
  try {
    if (!configPath || !existsSync(configPath)) return null;
    return readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
}

/** Model ids from the `models:` list of the proxy config; registry snapshot when absent or unreadable. */
export function configuredModelIds(configPath) {
  const text = readConfig(configPath);
  if (text === null) return [...DEFAULT_MODEL_IDS];
  const block = text.match(/^models:[ \t]*\r?\n((?:[ \t]+-[ \t]*\S.*\r?\n?)+)/m);
  if (!block) return [...DEFAULT_MODEL_IDS];
  const ids = [...block[1].matchAll(/^[ \t]+-[ \t]*["']?([A-Za-z0-9._-]+)["']?[ \t]*\r?$/gm)].map((m) => m[1]);
  return ids.length ? ids : [...DEFAULT_MODEL_IDS];
}

/** Listener host and Responses-API switch from the proxy config (template defaults when absent). */
export function configuredServer(configPath) {
  const text = readConfig(configPath) ?? "";
  const host = text.match(/^server:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+host:[ \t]*["']?([^"'\s]+)["']?/m)?.[1] ?? "127.0.0.1";
  const responses = text.match(/^responses:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+enabled:[ \t]*(true|false)/m)?.[1];
  return { host, responsesEnabled: responses !== "false" };
}

export function isLoopbackHost(host) {
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * Plain-text lines (no colour, no emojis). `source` is "running" only when
 * the caller verified the proxy answered as this installation's own.
 */
export function connectionDetailsLines({ port, key, models = DEFAULT_MODEL_IDS, source = "configured", reveal = false, host = "127.0.0.1", responsesEnabled = true, indent = "  " }) {
  const loopback = isLoopbackHost(host);
  const base = `http://${loopback ? "127.0.0.1" : host}:${port}`;
  const keyText = reveal && typeof key === "string" && key.length ? key : REDACTED_KEY;
  const verified = source === "running";
  const openaiRoutes = responsesEnabled ? "POST /chat/completions, POST /responses, GET /models" : "POST /chat/completions, GET /models";
  const lines = [
    `${indent}Connection details (local ZCode proxy, ${verified ? "running and verified" : "from configuration; proxy not verified running"})`,
    `${indent}  OpenAI-compatible base URL:    ${base}/v1   (${openaiRoutes})`,
    `${indent}  Anthropic-compatible base URL: ${base}      (POST /v1/messages)`,
    `${indent}  API key (Bearer / x-api-key):  ${keyText}`,
    `${indent}  Model IDs:                     ${models.join(", ")}`,
    `${indent}  Works with any OpenAI- or Anthropic-compatible client; no harness auto-configuration required.` +
      (verified ? "" : " Start the proxy first: zcode-kit proxy start"),
  ];
  if (!loopback) lines.push(`${indent}  WARNING: server.host is ${host} — the proxy is meant to stay on loopback; do not expose it.`);
  return lines;
}
