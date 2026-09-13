/**
 * Provider and model type definitions.
 * @see .omo/plans/zcode-proxy.md Task 3
 */

/** Supported provider identifiers. */
export type ProviderId = "zai" | "bigmodel";

/** Static provider definition with endpoint URLs. */
export interface ProviderDef {
  id: ProviderId;
  displayName: string;
  /** Base URL for Anthropic-format requests (no trailing slash). */
  anthropicBaseURL: string;
  /** Base URL for OpenAI-format requests (no trailing slash). */
  openaiBaseURL: string;
  /** Host for OAuth/API-key resolution business APIs. */
  bizHost: string;
}

/** Model definition derived from the catalog. */
export interface ModelDef {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  /** Whether the model supports reasoning/thinking mode. */
  reasoning?: boolean;
}
