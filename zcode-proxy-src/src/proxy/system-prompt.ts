/**
 * ZCode system-prompt assembly — a faithful mirror of the desktop client's
 * ContextBuilder (ZCode 3.11.2).
 *
 * The gateway does content inspection — if it doesn't see the ZCode identity
 * blocks in the `system` field, it rejects with 3012 "method not allowed".
 * Beyond the identity marker, the real client's assembly has a precise shape
 * (all symbols verified in the 3.11.2 bundle):
 *
 *   `assembleSystemMessages` groups the built sections into EXACTLY 3 wire
 *   blocks, each with `cache_control: {type:"ephemeral"}` (`ect`):
 *     1. cli_prefix alone                          ("You are ZCode, …")
 *     2. every other STABLE section, `\n\n`-joined (`Wre`)
 *     3. every DYNAMIC section, `\n\n`-joined, with an explicit `"\n\n"`
 *        prefix on the block text
 *
 *   The default desktop section set mirrored here (config-dependent sections
 *   — Session Guidance, Memory, Output Style, git System Context, skills —
 *   are absent, which is a real, common client state):
 *     block 2: Agent Identity (`u9o`) + ZCode Desktop Context (`Ylt`, gated
 *              on presentationSurface === "zcode_desktop")
 *     block 3: Dynamic Behavior (`wTr`/Xlt) → Environment Info (`T9o`) →
 *              Context Management (`STr`/xTr)
 *
 *   `T9o` builds the Environment lines with REAL runtime values (cwd,
 *   platform, shell, osVersion — `createNodeContextSourceAdapter`) and the
 *   conditional `- You are powered by the model named X.` as the section's
 *   last line. The proxy only supplies cwd when explicitly overridden;
 *   otherwise the calling harness's own workspace context is preserved.
 *   Platform/osVersion use the SAME identity env chain as the
 *   X-Platform/X-Os-Version headers, so the prompt can never contradict the
 *   headers (a mixed combination no real client produces). See
 *   {@link resolveEnvPromptInfo} in identity.ts.
 *
 *   `meta_user` attachments (`assembleMetaUserAttachments`/`tct`): the client
 *   ALWAYS attaches a context_prefix to the first user turn — the currentDate
 *   section (`Vre`, `# currentDate\nToday's date is YYYY-MM-DD.`, local date
 *   via `pK`) wrapped as `<system-reminder>…</system-reminder>` (`blt`).
 *   {@link buildContextPrefixMessage} mirrors it.
 *
 * Static section texts live in zcode_system.json (sidecar asset, inlined into
 * the single-file binary via the json import attribute).
 *
 * @see zcode_system.json
 */
// Inlined as a build-time constant (Bun `json` import attribute / esbuild json
// loader) so it ships inside the single-file compiled binary — a runtime
// `readFileSync` would resolve `__dirname` to the build-time CI path and crash
// with ENOENT on every other host. @see types.d.ts
import data from "./zcode_system.json" with { type: "json" };

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/** Runtime environment values for the Environment section (`T9o` input). */
export interface StartPlanEnvInfo {
  cwd?: string;
  platform: string;
  shell: string;
  osVersion: string;
}

const EPHEMERAL: { type: "ephemeral" } = { type: "ephemeral" };

/** Bundle `pK` (formatLocalIsoDate): local `YYYY-MM-DD`, zero-padded. */
export function formatLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Environment Info attachment (`nMo`): meta_user content, lines joined with `\n`. */
export function buildEnvironmentSection(env: StartPlanEnvInfo): string {
  const e = data.environment;
  const lines = [
    e.heading,
    e.invokedLine,
    ...(env.cwd ? [` - ${e.cwdLabel}: ${env.cwd}`] : []),
    ` - ${e.gitLabel}: ${e.gitNo}`,
    ` - ${e.platformLabel}: ${env.platform}`,
    ` - ${e.shellLabel}: ${env.shell}`,
    ` - ${e.osVersionLabel}: ${env.osVersion}`,
    ` - ${e.untrustedDataLine}`,
  ];
  return lines.join("\n");
}

/** Model Identity attachment (`M2n`): `You are powered by the model named X.` */
export function buildModelIdentityLine(currentModel?: string): string | null {
  const model = currentModel?.trim();
  return model ? data.modelLineTemplate.replace("{model}", model) : null;
}

/**
 * Prepend the official ZCode gateway blocks to the request's `system` field,
 * mirroring the 4.0.0 client's `assembleSystemMessages` (3 blocks, ephemeral
 * breakpoints, dynamic block `\n\n`-prefixed). The Environment/Model sections
 * are meta_user attachments since 4.0.0 and ride in the context-prefix turn
 * ({@link buildContextPrefixMessage}), not in `system`. Client system blocks
 * (if any) are preserved AFTER the official blocks, with their `cache_control`
 * stripped: the official blocks already consume 3 of Anthropic's 4 cache
 * breakpoints (the last is the last-message marker applied by
 * body-transformer), so client markers would push the request over the cap —
 * the real client never emits foreign markers because it owns the whole body.
 */
export function buildStartPlanSystem(existingSystem: unknown, currentModel: string | undefined, env: StartPlanEnvInfo): SystemBlock[] {
  const stable = data.stableSections.join("\n\n");
  const dynamic = data.dynamicSections.join("\n\n");
  void env;
  // The gateway's client gate (3012 "This client is not supported") rejects a
  // `system` field that carries ANY block beyond the official three — the real
  // client owns the whole body and never sends foreign system blocks. Client
  // system text therefore does NOT ride in `system`; the caller folds it into
  // the context-prefix user turn (see buildContextPrefixMessage).
  void existingSystem;
  return [
    { type: "text", text: data.cliPrefix, cache_control: { ...EPHEMERAL } },
    { type: "text", text: stable, cache_control: { ...EPHEMERAL } },
    { type: "text", text: `\n\n${dynamic}`, cache_control: { ...EPHEMERAL } },
  ];
}

/** Normalized client system text blocks — for the context-prefix fold (4.0.0 gate). */
export function normalizeClientSystemBlocks(existingSystem: unknown): SystemBlock[] {
  return normalizeUserSystem(existingSystem);
}

/**
 * The meta_user attachments on the leading user turn: since 4.0.0 the
 * Environment Info and Model Identity sections ride here (`env_info`/`model`
 * are meta_user sections in the ContextBuilder), next to the currentDate
 * section — each wrapped in `<system-reminder>…</system-reminder>` (no inner
 * padding newlines), exactly one text block per attachment.
 */
export function buildContextPrefixMessage(now?: Date, env?: StartPlanEnvInfo, currentModel?: string, clientSystem?: SystemBlock[]): { role: "user"; content: SystemBlock[] } {
  const cp = data.contextPrefix;
  const date = formatLocalIsoDate(now ?? new Date());
  const currentDateSection = `${cp.currentDateHeading}\n${cp.currentDateLine.replace("{date}", date)}`;
  const body = [cp.intro, currentDateSection, "", cp.outro].join("\n");
  const blocks: SystemBlock[] = [{ type: "text", text: `${data.systemReminder.open}${body}${data.systemReminder.close}` }];
  if (env) {
    blocks.push({ type: "text", text: `${data.systemReminder.open}${buildEnvironmentSection(env)}${data.systemReminder.close}` });
  }
  const modelLine = buildModelIdentityLine(currentModel);
  if (modelLine) {
    blocks.push({ type: "text", text: `${data.systemReminder.open}${modelLine}${data.systemReminder.close}` });
  }
  // Client system text (e.g. a harness's own agent prompt) rides here as
  // reminder blocks: the 4.0.0 gate rejects foreign blocks in `system`, but
  // the first user turn is exactly where the real client carries extra context.
  for (const b of clientSystem ?? []) {
    blocks.push({ type: "text", text: `${data.systemReminder.open}${b.text}${data.systemReminder.close}` });
  }
  return { role: "user", content: blocks };
}

function normalizeUserSystem(system: unknown): SystemBlock[] {
  if (system == null) return [];
  if (typeof system === "string") {
    const text = system.trim();
    return text ? [{ type: "text", text }] : [];
  }
  if (!Array.isArray(system)) return [];
  const out: SystemBlock[] = [];
  for (const item of system) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ type: "text", text: item });
    } else if (item && typeof item === "object") {
      const b = item as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        // cache_control intentionally dropped — see buildStartPlanSystem doc.
        out.push({ type: "text", text: b.text });
      }
    }
  }
  return out;
}
