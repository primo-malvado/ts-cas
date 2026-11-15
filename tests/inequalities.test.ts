import { describe, expect, it } from "vitest";
import { parse, solveAbsoluteValueRelation, solvePolynomialInequality, toString } from "../src/index.js";

describe("polynomial inequalities", () => {
  it("solves a quadratic strict inequality and preserves open roots", () => {
    const result = solvePolynomialInequality(parse("x^2 - 4"), "x", ">");
    expect(result.status).toBe("complete");
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0]!.lower).toBeNull();
    expect(toString(result.intervals[0]!.upper!)).toBe("-2");
    expect(result.intervals[0]!.upperClosed).toBe(false);
    expect(toString(result.intervals[1]!.lower!)).toBe("2");
    expect(result.intervals[1]!.upper).toBeNull();
  });

  it("merges intervals through roots included by a non-strict inequality", () => {
    const result = solvePolynomialInequality(parse("x^2 - 4"), "x", "<=");
    expect(result.status).toBe("complete");
    expect(result.intervals).toHaveLength(1);
    expect(toString(result.intervals[0]!.lower!)).toBe("-2");
    expect(toString(result.intervals[0]!.upper!)).toBe("2");
    expect(result.intervals[0]!.lowerClosed).toBe(true);
    expect(result.intervals[0]!.upperClosed).toBe(true);
  });

  it("handles repeated roots, positive quadratics, and zero polynomials", () => {
    const positive = solvePolynomialInequality(parse("x^2 + 1"), "x", ">");
    expect(positive.status).toBe("complete");
    expect(positive.intervals).toHaveLength(1);
    expect(positive.intervals[0]!.lower).toBeNull();
    expect(positive.intervals[0]!.upper).toBeNull();

    const squareStrict = solvePolynomialInequality(parse("x^2"), "x", ">");
    expect(squareStrict.intervals).toHaveLength(2);
    const squareNonStrict = solvePolynomialInequality(parse("x^2"), "x", ">=");
    expect(squareNonStrict.intervals).toHaveLength(1);
    expect(squareNonStrict.intervals[0]!.lower).toBeNull();
    expect(squareNonStrict.intervals[0]!.upper).toBeNull();

    expect(solvePolynomialInequality(parse("0"), "x", "<").intervals).toHaveLength(0);
    expect(solvePolynomialInequality(parse("0"), "x", "<=").intervals).toHaveLength(1);
  });

  it("does not claim unsupported nonlinear inequalities are solved", () => {
    const result = solvePolynomialInequality(parse("sin(x) - 1"), "x", "<=");
    expect(result.status).toBe("unsupported");
    expect(result.message).toContain("Function");
  });
});

it("solves absolute-value inequalities by interval intersection and union", () => {
  const less = solveAbsoluteValueRelation(parse("x - 2"), parse("3"), "x", "<=");
  expect(less.status).toBe("complete");
  expect(less.intervals).toHaveLength(1);
  expect(toString(less.intervals[0]!.lower!)).toBe("-1");
  expect(toString(less.intervals[0]!.upper!)).toBe("5");

  const greater = solveAbsoluteValueRelation(parse("x"), parse("2"), "x", ">");
  expect(greater.intervals).toHaveLength(2);
  expect(toString(greater.intervals[0]!.upper!)).toBe("-2");
  expect(toString(greater.intervals[1]!.lower!)).toBe("2");
});

