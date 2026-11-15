import { describe, expect, it } from "vitest";
import {
  factor,
  factorWithSteps,
  integrateWithSteps,
  parse,
  toString,
  verifyFactorizationExplanation,
  verifyIntegrationExplanation,
} from "../src/index.js";

describe("explanations for factorization and integration", () => {
  it("reports factorization stages and exact factors", () => {
    const expression = parse("x^2 - 1");
    const result = factorWithSteps(expression);

    expect(result.steps.map(step => step.rule)).toEqual([
      "convert-to-polynomial",
      "factor-univariate-over-rationals",
      "reconstruct-factorization",
    ]);
    expect(toString(result.expression)).toBe(toString(factor(expression)));
    expect(result.steps[1]!.factors?.map(item => item.multiplicity)).toEqual([1, 1]);
    expect(verifyFactorizationExplanation(expression, result).valid).toBe(true);

    const altered = {
      ...result,
      expression: parse("x^2 + 1"),
    };
    expect(verifyFactorizationExplanation(expression, altered).valid).toBe(false);
  });

  it("identifies polynomial and substitution integration rules", () => {
    const polynomial = integrateWithSteps(parse("2*x"), "x");
    const substitution = integrateWithSteps(parse("2*x*cos(x^2)"), "x");

    expect(polynomial.steps[0]!.rule).toBe("integrate-polynomial");
    expect(toString(polynomial.antiderivative)).toBe("x^2");
    expect(substitution.steps[0]!.rule).toBe("u-substitution");
    expect(toString(substitution.antiderivative)).toBe("sin(x^2)");
    expect(verifyIntegrationExplanation(parse("2*x"), polynomial, "x").valid).toBe(true);
    expect(verifyIntegrationExplanation(parse("2*x*cos(x^2)"), substitution, "x").valid).toBe(true);
    expect(verifyIntegrationExplanation(parse("x"), polynomial, "x").valid).toBe(false);
  });

  it("builds a parent-linked trace for recursive sum integration", () => {
    const result = integrateWithSteps(parse("x^2 + sin(2*x)"), "x");
    const root = result.steps.find(step => step.parentId === null)!;
    const children = result.steps.filter(step => step.parentId === root.id);

    expect(root.rule).toBe("sum-rule");
    expect(children.map(step => step.rule).sort()).toEqual([
      "integrate-polynomial",
      "u-substitution",
    ]);
    expect(verifyIntegrationExplanation(parse("x^2 + sin(2*x)"), result, "x").valid).toBe(true);
  });

  it("includes successful integration-by-parts subproblems in the trace", () => {
    const result = integrateWithSteps(parse("x*exp(x)"), "x");
    const root = result.steps.find(step => step.parentId === null)!;
    const children = result.steps.filter(step => step.parentId === root.id);

    expect(root.rule).toBe("integration-by-parts");
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(step => step.id > root.id)).toBe(true);
    expect(verifyIntegrationExplanation(parse("x*exp(x)"), result, "x").valid).toBe(true);
  });
});
