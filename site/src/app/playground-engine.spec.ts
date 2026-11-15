import { describe, expect, it } from "vitest";
import { evaluatePlayground } from "./playground-engine";

describe("playground calculations", () => {
  it("returns a real derivative and learner-readable steps", () => {
    const result = evaluatePlayground({
      expression: "sin(x^2)",
      operation: "differentiate",
      variable: "x",
    });

    expect(result.value).toContain("cos");
    expect(result.steps?.length).toBeGreaterThan(0);
    expect(result.steps?.every((step) => step.title && step.why)).toBe(true);
  });

  it("keeps the source restriction when simplifying a rational expression", () => {
    const result = evaluatePlayground({
      expression: "((x - 1)^2)/(x - 1)",
      operation: "domain",
      variable: "x",
    });

    expect(result.conditions).toHaveLength(1);
    expect(result.conditions?.[0]).toContain("≠ 0");
    expect(result.status).toContain("completa");
  });

  it("displays exact roots returned by the solver", () => {
    const result = evaluatePlayground({
      expression: "x^2 - 2",
      operation: "solve",
      variable: "x",
    });

    expect(result.value).toContain("sqrt(8)");
    expect(result.value).toContain("-1/2");
    expect(result.status).toContain("finito");
  });

  it("reports an empty expression instead of returning a placeholder result", () => {
    expect(() => evaluatePlayground({
      expression: "  ",
      operation: "simplify",
      variable: "x",
    })).toThrow("Escreve uma expressão");
  });
});
