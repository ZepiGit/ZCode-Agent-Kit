/**
 * SettingsManager — workspace settings schema, effective values, verified
 * updates and resets, plus a read-only inventory of desktop configuration.
 *
 * Writes go through the harness workspace setters (workspace/setDefaultModel,
 * setDefaultMode, setDefaultThoughtLevel). A compare-and-swap guard uses the
 * stateRevision from workspace/readState: updates are rejected when the
 * workspace changed underneath the caller. Unknown fields are never silently
 * written.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../util/log.js";
import { redactDeep, safeJsonStringify } from "../security/redact.js";
const log = createLogger("settings");
export class SettingsError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "SettingsError";
        this.code = code;
    }
}
function desktopSettingPath() {
    return path.join(os.homedir(), ".zcode", "v2", "setting.json");
}
export class SettingsManager {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    async readWorkspaceState(workspacePath) {
        const state = await this.runtime.callForWorkspace("workspace/readState", workspacePath, {}, 60_000);
        const settings = (state?.settings ?? {});
        const catalog = (state?.modelCatalog ?? {});
        // Different harness builds expose the revision at top level or inside the
        // model catalog; accept both.
        const revision = Number(state?.revision ?? catalog.revision ?? settings.revision ?? 0);
        return {
            revision,
            modelCatalog: catalog,
            settings,
            raw: state,
        };
    }
    /** Full schema with effective values (for zcode_settings_schema). */
    async describe(workspacePath) {
        const state = await this.readWorkspaceState(workspacePath);
        const notes = [];
        const s = state.settings;
        const mode = (s.mode ?? {});
        const model = (s.model ?? {});
        const thought = (s.thoughtLevel ?? s.reasoning ?? {});
        const catalog = state.modelCatalog;
        const modelChoices = [];
        for (const m of catalog.available ?? []) {
            const ref = (m.ref ?? {});
            const id = `${String(ref.providerId ?? "")}/${String(ref.modelId ?? "")}`;
            if (id !== "/")
                modelChoices.push(id);
        }
        notes.push("Desktop/UI settings (~/.zcode/v2/setting.json) are exposed read-only via zcode_settings_get with scope 'desktop'.");
        notes.push("Provider/MCP/plugin configuration beyond workspace defaults is not writable through this harness version.");
        return {
            revision: state.revision,
            notes,
            settings: [
                {
                    path: "mode",
                    title: "Default permission mode",
                    description: "Permission mode used for new sessions in this workspace (build/edit/plan/yolo).",
                    type: "enum",
                    choices: ["build", "edit", "plan", "yolo"],
                    default: "build",
                    effective: mode.current ?? null,
                    source: "workspace",
                    scope: "workspace",
                    writable: true,
                    requiresRestart: false,
                    writeMethod: "workspace/setDefaultMode",
                },
                {
                    path: "model",
                    title: "Default model",
                    description: "Default model (providerId/modelId) for new sessions in this workspace. Only models from the live catalog are accepted.",
                    type: "enum",
                    choices: modelChoices,
                    default: modelChoices[0] ?? null,
                    effective: model.current && typeof model.current === "object"
                        ? `${String(model.current.providerId ?? "")}/${String(model.current.modelId ?? "")}`
                        : null,
                    source: "workspace",
                    scope: "workspace",
                    writable: true,
                    requiresRestart: false,
                    writeMethod: "workspace/setDefaultModel",
                },
                {
                    path: "thoughtLevel",
                    title: "Default reasoning level",
                    description: "Reasoning effort for new sessions; allowed values depend on the selected model (see model catalog reasoning.levels).",
                    type: "enum",
                    choices: ["low", "high", "max", "enabled", "disabled"],
                    default: null,
                    effective: (thought.current ?? thought.level ?? null),
                    source: "workspace",
                    scope: "workspace",
                    writable: true,
                    requiresRestart: false,
                    writeMethod: "workspace/setDefaultThoughtLevel",
                },
                {
                    path: "modelCatalog",
                    title: "Model catalog",
                    description: "Live model catalog of this workspace (read-only). Providers and models discovered by the harness.",
                    type: "object",
                    default: null,
                    effective: catalog,
                    source: "harness-default",
                    scope: "workspace",
                    writable: false,
                    requiresRestart: false,
                    writeMethod: null,
                },
            ],
        };
    }
    /** Get one setting path or the whole effective settings object. */
    async get(workspacePath, settingPath) {
        const state = await this.readWorkspaceState(workspacePath);
        if (settingPath === null || settingPath === "") {
            return redactDeep(state.settings);
        }
        const desc = await this.describe(workspacePath);
        const found = desc.settings.find((d) => d.path === settingPath);
        if (found)
            return { path: found.path, effective: found.effective, choices: found.choices ?? null, writable: found.writable };
        throw new SettingsError("UNKNOWN_SETTING", `unknown setting path: ${settingPath}`);
    }
    /**
     * Apply settings changes with CAS on the workspace revision. Returns
     * before/after values (redacted) per changed path.
     */
    async update(workspacePath, changes, expectedRevision) {
        const before = await this.readWorkspaceState(workspacePath);
        if (expectedRevision !== null && expectedRevision !== before.revision) {
            throw new SettingsError("REVISION_CONFLICT", `workspace revision moved: expected ${expectedRevision}, current ${before.revision}; re-read settings and retry`);
        }
        const applied = [];
        for (const [key, value] of Object.entries(changes)) {
            if (key === "mode") {
                if (typeof value !== "string" || !["build", "edit", "plan", "yolo"].includes(value)) {
                    throw new SettingsError("INVALID_VALUE", `mode must be one of build|edit|plan|yolo, got ${safeJsonStringify(value)}`);
                }
                await this.runtime.callForWorkspace("workspace/setDefaultMode", workspacePath, { mode: value });
                applied.push({ path: "mode", before: null, after: value, writeMethod: "workspace/setDefaultMode" });
            }
            else if (key === "model") {
                if (typeof value !== "string" || !value.includes("/")) {
                    throw new SettingsError("INVALID_VALUE", `model must be "providerId/modelId", got ${safeJsonStringify(value)}`);
                }
                const [providerId, modelId] = value.split("/", 2);
                // Validate against the catalog before writing.
                const state = await this.readWorkspaceState(workspacePath);
                const catalog = state.modelCatalog;
                const known = (catalog.available ?? []).some((m) => {
                    const ref = (m.ref ?? {});
                    return String(ref.providerId) === providerId && String(ref.modelId) === modelId;
                });
                if (!known) {
                    throw new SettingsError("UNKNOWN_MODEL", `model ${value} is not in the live catalog; available: ${safeJsonStringify((catalog.available ?? []).map((m) => `${String(m.ref.providerId)}/${String(m.ref.modelId)}`))}`);
                }
                await this.runtime.callForWorkspace("workspace/setDefaultModel", workspacePath, { model: { providerId, modelId } });
                applied.push({ path: "model", before: null, after: value, writeMethod: "workspace/setDefaultModel" });
            }
            else if (key === "thoughtLevel") {
                if (typeof value !== "string") {
                    throw new SettingsError("INVALID_VALUE", `thoughtLevel must be a string, got ${safeJsonStringify(value)}`);
                }
                await this.runtime.callForWorkspace("workspace/setDefaultThoughtLevel", workspacePath, { thoughtLevel: value });
                applied.push({ path: "thoughtLevel", before: null, after: value, writeMethod: "workspace/setDefaultThoughtLevel" });
            }
            else {
                throw new SettingsError("UNKNOWN_SETTING", `unknown or not-writable setting path: ${key}; writable paths: mode, model, thoughtLevel`);
            }
        }
        const after = await this.readWorkspaceState(workspacePath);
        // Read-back verification.
        for (const entry of applied) {
            const s = after.settings;
            if (entry.path === "mode") {
                const mode = (s.mode ?? {});
                entry.before = before.settings ? String(before.settings.mode?.current ?? null) : null;
                entry.after = String(mode.current ?? null);
            }
            else if (entry.path === "model") {
                const model = (s.model ?? {});
                const cur = (model.current ?? {});
                const prevModel = (before.settings.model ?? {});
                const prevCur = (prevModel.current ?? {});
                entry.before = `${String(prevCur.providerId ?? "")}/${String(prevCur.modelId ?? "")}`;
                entry.after = `${String(cur.providerId ?? "")}/${String(cur.modelId ?? "")}`;
            }
        }
        return { revision: after.revision, applied };
    }
    /** Reset a setting to its catalog/default value. */
    async reset(workspacePath, settingPath) {
        const desc = await this.describe(workspacePath);
        const found = desc.settings.find((d) => d.path === settingPath);
        if (!found)
            throw new SettingsError("UNKNOWN_SETTING", `unknown setting path: ${settingPath}`);
        if (!found.writable)
            throw new SettingsError("NOT_WRITABLE", `setting ${settingPath} is read-only`);
        if (found.default === null) {
            throw new SettingsError("NO_DEFAULT", `setting ${settingPath} has no known default to reset to`);
        }
        return this.update(workspacePath, { [settingPath]: found.default }, null);
    }
    /**
     * Read-only inventory of the desktop configuration file. Redacted; never
     * written by the bridge.
     */
    desktopInventory() {
        const p = desktopSettingPath();
        try {
            const raw = JSON.parse(fs.readFileSync(p, "utf8"));
            const safe = {};
            const keys = [
                "locale",
                "taskAutoArchiveEnabled",
                "taskAutoArchiveOlderThanDays",
                "closeToTrayOnWindows",
                "keepAwakeWhileRunning",
                "messageStreamShowReasoning",
                "messageStreamShowTodos",
                "toolGroupingExploreEnabled",
                "toolGroupingTerminalEnabled",
                "toolGroupingChangesEnabled",
                "zcodeInteractionBehavior",
                "askUserQuestionAutoResolutionEnabled",
                "modelIoFullRetentionEnabled",
                "optimizeAgentExperienceEnabled",
                "enabledBuiltinAgentCliProviders",
                "modelProviderFamilyModes",
                "repoSnapshotIndexingEnabled",
                "instantGrepIndexingEnabled",
                "nativeSearchEnhancementsEnabled",
                "memoryEnabled",
            ];
            for (const k of keys) {
                if (k in raw)
                    safe[k] = redactDeep(raw[k]);
            }
            return { path: p, exists: true, keys: safe, note: "desktop file is inventoried read-only; bridge never writes it" };
        }
        catch {
            return { path: p, exists: false, keys: {}, note: "desktop settings file not readable" };
        }
    }
}
