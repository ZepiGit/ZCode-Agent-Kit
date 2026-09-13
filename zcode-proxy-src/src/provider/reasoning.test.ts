/**
 * Tests for the GLM-5.3 reasoning-effort contract.
 * @see src/provider/reasoning.ts
 */
import { describe, it, expect } from "bun:test";
import {
  isGlm53Model,
  normalizeGlm53Effort,
  buildGlm53Reasoning,
  clampGlm53BudgetToModel,
  GLM53_DEFAULT_EFFORT,
  GLM53_THINKING_BUDGETS,
} from "./reasoning.js";

describe("isGlm53Model", () => {
  it("matches glm-5.3", () => {
    expect(isGlm53Model("glm-5.3")).toBe(true);
  });

  it("matches GLM-5.3 case-insensitively", () => {
    expect(isGlm53Model("GLM-5.3")).toBe(true);
  });

  it("matches glm-5.3-flash", () => {
    expect(isGlm53Model("glm-5.3-flash")).toBe(true);
  });

  it("does not match glm-5.2", () => {
    expect(isGlm53Model("glm-5.2")).toBe(false);
  });

  it("does not match glm-5.1", () => {
    expect(isGlm53Model("glm-5.1")).toBe(false);
  });

  it("does not match glm-5", () => {
    expect(isGlm53Model("glm-5")).toBe(false);
  });

  it("does not match glm-4.7", () => {
    expect(isGlm53Model("glm-4.7")).toBe(false);
  });

  it("does not match undefined", () => {
    expect(isGlm53Model(undefined)).toBe(false);
  });
});

describe("normalizeGlm53Effort", () => {
  it("maps 'none' to 'low'", () => {
    expect(normalizeGlm53Effort("none")).toBe("low");
  });

  it("maps 'minimal' to 'low'", () => {
    expect(normalizeGlm53Effort("minimal")).toBe("low");
  });

  it("maps 'light' to 'low'", () => {
    expect(normalizeGlm53Effort("light")).toBe("low");
  });

  it("maps 'low' to 'low'", () => {
    expect(normalizeGlm53Effort("low")).toBe("low");
  });

  it("rounds 'medium' UP to 'high', not down to 'low' (regression: got this wrong once)", () => {
    expect(normalizeGlm53Effort("medium")).toBe("high");
  });

  it("maps 'high' to 'high'", () => {
    expect(normalizeGlm53Effort("high")).toBe("high");
  });

  it("maps 'xhigh' to 'max'", () => {
    expect(normalizeGlm53Effort("xhigh")).toBe("max");
  });

  it("maps 'max' to 'max'", () => {
    expect(normalizeGlm53Effort("max")).toBe("max");
  });

  it("maps 'ultra' to 'max'", () => {
    expect(normalizeGlm53Effort("ultra")).toBe("max");
  });

  it("defaults unrecognized values to the catalog default (max)", () => {
    expect(normalizeGlm53Effort("bogus")).toBe(GLM53_DEFAULT_EFFORT);
  });

  it("defaults absent value to the catalog default (max)", () => {
    expect(normalizeGlm53Effort(undefined)).toBe(GLM53_DEFAULT_EFFORT);
  });
});

describe("buildGlm53Reasoning", () => {
  it("pairs low effort with its catalog budget", () => {
    expect(buildGlm53Reasoning("low")).toEqual({
      thinking: { type: "enabled", budget_tokens: GLM53_THINKING_BUDGETS.low },
      output_config: { effort: "low" },
    });
  });

  it("pairs high effort with its catalog budget", () => {
    expect(buildGlm53Reasoning("high")).toEqual({
      thinking: { type: "enabled", budget_tokens: GLM53_THINKING_BUDGETS.high },
      output_config: { effort: "high" },
    });
  });

  it("pairs max effort with its catalog budget", () => {
    expect(buildGlm53Reasoning("max")).toEqual({
      thinking: { type: "enabled", budget_tokens: GLM53_THINKING_BUDGETS.max },
      output_config: { effort: "max" },
    });
  });
});

describe("clampGlm53BudgetToModel (catalog-patch clamp)", () => {
  it("clamps against the MODEL ceiling minus one, never the per-request max_tokens", () => {
    // ZCode's catalog patch clamps Math.min(budgetTokens, maxOutputTokens - 1)
    // against the large fixed model ceiling; the request-level answer room is
    // provided additively by applyAnthropicThinkingCompat instead.
    expect(clampGlm53BudgetToModel(200_000, 128_000)).toBe(127_999);
  });

  it("passes budgets that fit the model ceiling through unchanged", () => {
    expect(clampGlm53BudgetToModel(32_000, 128_000)).toBe(32_000);
    expect(clampGlm53BudgetToModel(8_000, 64_000)).toBe(8_000);
    expect(clampGlm53BudgetToModel(GLM53_THINKING_BUDGETS.max, 128_000)).toBe(GLM53_THINKING_BUDGETS.max);
  });

  it("passes through unchanged when the model ceiling is unknown (not in catalog)", () => {
    expect(clampGlm53BudgetToModel(32_000, undefined)).toBe(32_000);
    expect(clampGlm53BudgetToModel(32_000, Number.NaN)).toBe(32_000);
    expect(clampGlm53BudgetToModel(32_000, "128000")).toBe(32_000);
  });

  it("floors fractional model ceilings before clamping", () => {
    expect(clampGlm53BudgetToModel(200_000, 100_000.9)).toBe(99_999);
  });
});
