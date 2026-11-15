import { describe, expect, it } from "vitest";
import {
  differentiate,
  differentiateWithSteps,
  equals,
  parse,
  verifyDifferentiationExplanation,
} from "../src/index.js";

describe("explainable differentiation", () => {
  it("returns the same derivative as the existing API with linked post-order rule steps", () => {
    const expression = parse("(x^2 + 1)*sin(x)");
    const result = differentiateWithSteps(expression, "x");

    expect(equals(result.derivative, differentiate(expression, "x"))).toBe(true);
    expect(result.steps.find(step => step.id === 0)).toMatchObject({
      parentId: null,
      rule: "product-rule",
    });
    expect(result.steps.some(step => step.rule === "sum-rule")).toBe(true);
    expect(result.steps.some(step => step.rule === "chain-rule-sin")).toBe(true);

    const indexes = new Map(result.steps.map((step, index) => [step.id, index]));
    for (const step of result.steps) {
      if (step.parentId !== null) {
        expect(indexes.get(step.id)).toBeLessThan(indexes.get(step.parentId)!);
      }
    }
  });

  it("records chain-rule dependencies without changing the derivative result", () => {
    const result = differentiateWithSteps(parse("sin(x^2)"), "x");

    expect(result.steps.map(step => step.rule)).toEqual([
      "variable",
      "power-rule",
      "chain-rule-sin",
    ]);
    expect(result.steps.map(step => step.parentId)).toEqual([1, 0, null]);
    expect(result.steps[2]!.derivative).toEqual(result.derivative);
  });

  it("verifies every derivative and rejects a tampered trace", () => {
    const expression = parse("sin(x^2)");
    const result = differentiateWithSteps(expression, "x");

    expect(verifyDifferentiationExplanation(expression, "x", result).valid).toBe(true);

    const altered = {
      ...result,
      steps: result.steps.map((step, index) =>
        index === 0 ? { ...step, derivative: parse("9") } : step),
    };
    expect(verifyDifferentiationExplanation(expression, "x", altered).valid).toBe(false);
  });
});
