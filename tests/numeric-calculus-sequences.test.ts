import { describe, expect, it } from "vitest";
import { arithmeticSequence, geometricSequence, integrateNumerically, numericalDerivative, parse, recurrenceSequence, sequenceTable, solveRootBisection, solveRootHybrid, solveRootNewton } from "../src/index.js";

describe("numerical calculus", () => {
  it("finds roots using bisection and Newton's method", () => {
    const bisection = solveRootBisection(parse("x^2 - 2"), "x", 1, 2);
    expect(bisection.converged).toBe(true);
    expect(bisection.root).toBeCloseTo(Math.sqrt(2), 8);
    const newton = solveRootNewton(parse("x^2 - 2"), "x", 1.5);
    expect(newton.converged).toBe(true);
    expect(newton.root).toBeCloseTo(Math.sqrt(2), 8);
  });

  it("uses a safeguarded hybrid method and handles extreme brackets", () => {
    const hybrid = solveRootHybrid(parse("x^3 - 2"), "x", 0, 2);
    expect(hybrid.method).toBe("hybrid");
    expect(hybrid.converged).toBe(true);
    expect(hybrid.root).toBeCloseTo(Math.cbrt(2), 8);

    const extreme = solveRootBisection(parse("x"), "x", -1e308, 1e308);
    expect(extreme.converged).toBe(true);
    expect(extreme.root).toBeCloseTo(0, 12);
    expect(() => solveRootBisection(parse("x"), "x", 2, -2)).toThrow(/left < right/);
  });

  it("does not claim Newton convergence merely because the iterates stop changing", () => {
    const result = solveRootNewton(parse("x^3 - 2*x + 2"), "x", 0, {}, 1e-14, 5);
    expect(result.converged).toBe(false);
    expect(result.residual).toBeGreaterThan(1e-14);
  });

  it("uses a one-sided numerical derivative when the central stencil crosses a domain boundary", () => {
    // The symbolic rule for sqrt(x) is singular at zero, so numerical fallback uses the valid side.
    const value = numericalDerivative(parse("sqrt(x)"), "x", 0);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(100);
  });

  it("computes numerical derivatives and definite integrals", () => {
    expect(numericalDerivative(parse("sin(x)"), "x", 0)).toBeCloseTo(1, 10);
    const result = integrateNumerically(parse("x^2"), "x", 0, 1);
    expect(result.value).toBeCloseTo(1 / 3, 9);
    expect(result.converged).toBe(true);
    expect(integrateNumerically(parse("x^2"), "x", 1, 0).value).toBeCloseTo(-1 / 3, 9);
    expect(() => solveRootBisection(parse("x^2 + 1"), "x", -1, 1)).toThrow();
  });
});

describe("sequences", () => {
  it("generates arithmetic, geometric and recurrence sequences", () => {
    expect(arithmeticSequence(2, 3, 4)).toEqual([2, 5, 8, 11]);
    expect(geometricSequence(3, 2, 4)).toEqual([3, 6, 12, 24]);
    expect(recurrenceSequence([0, 1], 7, terms => terms.at(-1)! + terms.at(-2)!)).toEqual([0, 1, 1, 2, 3, 5, 8]);
    expect(sequenceTable([4, 5], 1)).toEqual([{ index: 1, value: 4 }, { index: 2, value: 5 }]);
  });
});
