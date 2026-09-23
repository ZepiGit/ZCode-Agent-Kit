/** Native 0.16.9 workspace presentation and process-runtime preferences.
 * Workspace model/mode/reasoning setters and workspace revisions no longer exist.
 * Never emulate those defaults by mutating an unrelated session or provider file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeManager } from "../runtime/manager.js";
import { redactDeep } from "../security/redact.js";

export class SettingsError extends Error {
  constructor(public code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "SettingsError";
  }
}

const PREFERENCES = {
  askUserQuestionAutoResolutionEnabled: { method: "workspace/updateInteractionPreferences", field: "askUserQuestionAutoResolutionEnabled", nested: true },
  modelIoFullRetentionEnabled: { method: "workspace/updateModelIoPreferences", field: "fullRetentionEnabled", nested: true },
  offPeakToolEnabled: { method: "workspace/updateOffPeakToolPolicy", field: "enabled", nested: false },
  dynamicWorkflowEnabled: { method: "workspace/updateDynamicWorkflowPolicy", field: "enabled", nested: false },
} as const;

export class SettingsManager {
  constructor(private readonly runtime: RuntimeManager) {}

  async readWorkspaceState(workspacePath: string): Promise<Record<string, unknown>> {
    const presentation = await this.runtime.callForWorkspace<Record<string, unknown>>("workspace/readPresentation", workspacePath, {}, 60_000);
    if (typeof presentation.mode !== "string" || !Array.isArray(presentation.slashCommands)) {
      throw new SettingsError("INVALID_NATIVE_RESPONSE", "workspace/readPresentation omitted mode or slashCommands");
    }
    return {
      revision: null,
      settings: { mode: { current: presentation.mode }, model: null, thoughtLevel: null },
      presentation,
      source: "workspace/readPresentation",
      note: "Presentation mode is not a writable workspace default. Model/reasoning defaults and workspace revisions are not exposed by this native protocol.",
    };
  }

  async describe(workspacePath: string): Promise<Record<string, unknown>> {
    const state = await this.readWorkspaceState(workspacePath);
    const settings = state.settings as Record<string, unknown>;
    return {
      revision: null,
      settings: [
        ...["mode", "model", "thoughtLevel"].map((key) => ({
          path: key, type: "string", default: null,
          effective: key === "mode" ? (settings.mode as Record<string, unknown>).current : null,
          source: key === "mode" ? "workspace/readPresentation" : "not-exposed",
          scope: "workspace", writable: false, requiresRestart: false, writeMethod: null,
        })),
        ...Object.entries(PREFERENCES).map(([key, spec]) => ({
          path: key, type: "boolean", default: null, effective: null,
          source: "not-readable", scope: "runtime", writable: true,
          requiresRestart: false, writeMethod: spec.method,
          description: "Applies to the shared harness process, not only this workspace; not persisted. Native protocol provides an update acknowledgement but no preference getter or CAS revision.",
        })),
      ],
      notes: [
        "Use zcode_model_set scope=session for model, reasoning and mode selection. Workspace defaults/reset are unsupported in native 0.16.9.",
        "Use zcode_models_list for the full live catalog (an owned deferred session is created and closed without sending a prompt).",
        "Runtime preference effective values/defaults are unknown until an update acknowledgement; no local cache is represented as native state.",
        "Desktop settings are inventoried read-only via scope=desktop.",
      ],
    };
  }

  async get(workspacePath: string, settingPath: string | null): Promise<Record<string, unknown>> {
    if (!settingPath) return this.readWorkspaceState(workspacePath);
    if (settingPath === "modelCatalog") throw new SettingsError("CATALOG_REQUIRES_SESSION", "use zcode_models_list; full catalog discovery creates and closes a deferred native session");
    const desc = await this.describe(workspacePath);
    const found = (desc.settings as Array<Record<string, unknown>>).find((entry) => entry.path === settingPath);
    if (!found) throw new SettingsError("UNKNOWN_SETTING", `unknown setting path: ${settingPath}`);
    return found;
  }

  async update(workspacePath: string, changes: Record<string, unknown>, expectedRevision: number | null): Promise<{ revision: null; applied: Array<Record<string, unknown>> }> {
    // Validate the entire batch before any native mutation, including CAS support.
    if (expectedRevision !== null) throw new SettingsError("UNSUPPORTED_REVISION", "native workspace preferences have no CAS revision; no changes applied");
    for (const [key, value] of Object.entries(changes)) {
      if (["mode", "model", "thoughtLevel"].includes(key)) {
        throw new SettingsError("UNSUPPORTED_WORKSPACE_DEFAULT", "native 0.16.9 has no workspace default setters; use zcode_model_set with scope=session");
      }
      if (!Object.hasOwn(PREFERENCES, key)) throw new SettingsError("UNKNOWN_SETTING", `unknown or not-writable setting path: ${key}`);
      if (typeof value !== "boolean") throw new SettingsError("INVALID_VALUE", `${key} must be a boolean`);
    }
    const applied: Array<Record<string, unknown>> = [];
    for (const [key, value] of Object.entries(changes)) {
      const spec = PREFERENCES[key as keyof typeof PREFERENCES];
      const fields = { [spec.field]: value };
      const result = await this.runtime.callForWorkspace<Record<string, unknown>>(spec.method, workspacePath, spec.nested ? { preferences: fields } : fields);
      if (result[spec.field] !== value) throw new SettingsError("VERIFICATION_FAILED", `native acknowledgement did not confirm ${key}; earlier changes may have applied`);
      applied.push({ path: key, before: null, after: result[spec.field], writeMethod: spec.method, scope: "runtime", verification: "native-acknowledgement", result: redactDeep(result) });
    }
    return { revision: null, applied };
  }

  async reset(_workspacePath: string, settingPath: string): Promise<never> {
    if (["mode", "model", "thoughtLevel"].includes(settingPath)) throw new SettingsError("UNSUPPORTED_WORKSPACE_DEFAULT", "native 0.16.9 has no workspace defaults to reset");
    if (Object.hasOwn(PREFERENCES, settingPath)) throw new SettingsError("NO_DEFAULT", `native protocol exposes no default for ${settingPath}; set an explicit boolean instead`);
    throw new SettingsError("UNKNOWN_SETTING", `unknown setting path: ${settingPath}`);
  }

  /** Desktop file is never written by the bridge. */
  desktopInventory(): Record<string, unknown> {
    const p = path.join(os.homedir(), ".zcode", "v2", "setting.json");
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      const keys = [
        "locale", "taskAutoArchiveEnabled", "taskAutoArchiveOlderThanDays", "closeToTrayOnWindows",
        "keepAwakeWhileRunning", "messageStreamShowReasoning", "messageStreamShowTodos",
        "toolGroupingExploreEnabled", "toolGroupingTerminalEnabled", "toolGroupingChangesEnabled",
        "zcodeInteractionBehavior", "askUserQuestionAutoResolutionEnabled", "modelIoFullRetentionEnabled",
        "optimizeAgentExperienceEnabled", "enabledBuiltinAgentCliProviders", "modelProviderFamilyModes",
        "repoSnapshotIndexingEnabled", "instantGrepIndexingEnabled", "nativeSearchEnhancementsEnabled", "memoryEnabled",
      ];
      for (const key of keys) if (key in raw) safe[key] = redactDeep(raw[key]);
      return { path: p, exists: true, keys: safe, note: "desktop file is inventoried read-only; bridge never writes it" };
    } catch {
      return { path: p, exists: false, keys: {}, note: "desktop settings file not readable" };
    }
  }
}
