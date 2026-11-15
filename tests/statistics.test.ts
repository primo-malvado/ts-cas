import { describe, expect, it } from "vitest";
import { binomialCdf, binomialPmf, combinations, correlation, factorial, linearRegression, mean, median, normalCdf, quantile, standardDeviation, variance } from "../src/index.js";

describe("statistics and probability", () => {
  it("computes descriptive statistics", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([7, 1, 3])).toBe(3);
    expect(variance([1, 2, 3])).toBeCloseTo(2 / 3, 12);
    expect(variance([1, 2, 3], true)).toBe(1);
    expect(standardDeviation([1, 2, 3], true)).toBe(1);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });
  it("computes correlation and least-squares regression", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(linearRegression([1, 2, 3], [3, 5, 7])).toMatchObject({ slope: 2, intercept: 1, rSquared: 1 });
  });
  it("computes combinatorics and probability distributions", () => {
    expect(factorial(5)).toBe(120n);
    expect(combinations(5, 2)).toBe(10n);
    expect(binomialPmf(4, 0.5, 2)).toBeCloseTo(0.375, 12);
    expect(binomialCdf(4, 0.5, 2)).toBeCloseTo(0.6875, 12);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });
});
