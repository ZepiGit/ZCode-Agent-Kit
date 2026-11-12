// The CLI's path to the shared width core: one core for the CLI
// (Node) and the proxy TUI (Bun). The core lives with the TUI code and ships
// in every payload (pack allowlist `zcode-proxy-src/src/`, verify-payload).
export * from "../../zcode-proxy-src/src/tui/width-core.mjs";
