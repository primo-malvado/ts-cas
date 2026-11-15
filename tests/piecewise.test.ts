import { describe, expect, it } from "vitest";
import { evaluatePiecewiseFunction, parse, samplePiecewiseFunction, solvePiecewiseEquation } from "../src/index.js";

describe("piecewise functions", () => {
  const branches = [
    { lower: null, upper: 0, upperClosed: false, expression: parse("-x") },
    { lower: 0, lowerClosed: true, upper: null, expression: parse("x^2") },
  ];

  it("evaluates the correct branch and preserves gaps", () => {
    expect(evaluatePiecewiseFunction(branches, "x", -2)).toBe(2);
    expect(evaluatePiecewiseFunction(branches, "x", 3)).toBe(9);
    expect(evaluatePiecewiseFunction([{ lower: 0, upper: 1, lowerClosed: false, upperClosed: false, expression: parse("x") }], "x", 0)).toBeNull();
    expect(() => evaluatePiecewiseFunction([
      { lower: 0, upper: 1, expression: parse("x") },
      { lower: 1, upper: 2, expression: parse("x+1") },
    ], "x", 1)).toThrow(/overlap/);
  });

  it("samples piecewise functions and solves branch-wise polynomial equations", () => {
    expect(samplePiecewiseFunction(branches, "x", -1, 1, 3).map(point => point.y)).toEqual([1, 0, 1]);
    const result = solvePiecewiseEquation([
      { lower: null, upper: 0, upperClosed: false, expression: parse("x + 1") },
      { lower: 0, lowerClosed: true, upper: null, expression: parse("x - 2") },
    ], "x");
    expect(result.status).toBe("complete");
    expect(result.roots.map(root => root.approximation)).toEqual([-1, 2]);
  });

  it("reports partial rather than losing real roots expressed with complex quartic radicals", () => {
    const result = solvePiecewiseEquation([
      { lower: null, upper: null, expression: parse("x^4 + x - 1") },
    ], "x");
    expect(result.status).toBe("partial");
    expect(result.roots).toEqual([]);
    expect(result.message).toMatch(/Quartic radical solutions/);
  });

  it("does not claim completeness when symbolic-constant roots cannot be filtered", () => {
    const result = solvePiecewiseEquation([
      { lower: null, upper: null, expression: parse("x^2 - pi") },
    ], "x");
    expect(result.status).toBe("partial");
    expect(result.message).toMatch(/symbolic constants/);
  });

  it("does not discard parameterized roots while claiming completeness", () => {
    const result = solvePiecewiseEquation([
      { lower: null, upper: null, expression: parse("x^2 - y") },
    ], "x");
    expect(result.status).toBe("partial");
    expect(result.message).toMatch(/parameters/);
  });

  it("does not claim completeness when principal-power roots cannot be filtered", () => {
    const result = solvePiecewiseEquation([
      { lower: null, upper: null, expression: parse("x^sqrt(2) - 2") },
    ], "x");
    expect(result.status).toBe("partial");
    expect(result.message).toMatch(/Principal-power/);
  });
});
