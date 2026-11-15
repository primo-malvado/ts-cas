import { describe, expect, it } from "vitest";
import { parse, solvePolynomialNumerically } from "../src/index.js";

describe("numerical polynomial root isolation", () => {
  it("finds the real root of a cubic without an initial guess", () => {
    const result = solvePolynomialNumerically(parse("x^3 - 2"), "x");
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.value).toBeCloseTo(Math.cbrt(2), 9);
    expect(result.roots[0]!.converged).toBe(true);
  });

  it("finds all four distinct real roots of a quartic", () => {
    const result = solvePolynomialNumerically(parse("x^4 - 5*x^2 + 4"), "x");
    expect(result.status).toBe("finite");
    const roots = result.roots.map(root => root.value);
    expect(roots).toHaveLength(4);
    expect(roots[0]).toBeCloseTo(-2, 8);
    expect(roots[1]).toBeCloseTo(-1, 8);
    expect(roots[2]).toBeCloseTo(1, 8);
    expect(roots[3]).toBeCloseTo(2, 8);
    expect(result.roots.every(root => root.converged)).toBe(true);
  });

  it("detects even-multiplicity roots that do not change sign", () => {
    const result = solvePolynomialNumerically(parse("(x - 1)^2*(x + 2)"), "x");
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]!.value).toBeCloseTo(-2, 8);
    expect(result.roots[1]!.value).toBeCloseTo(1, 8);
    expect(result.roots[1]!.method).toBe("sturm-isolation");
    expect(result.roots.every(root => root.certified)).toBe(true);
  });

  it("does not misclassify a shallow positive minimum as a repeated root", () => {
    const result = solvePolynomialNumerically(
      parse("(x^2 - 1)^2 + 0.000000000001"),
      "x",
    );
    expect(result.status).toBe("none");
  });

  it("reports polynomials with no real roots, including shallow positive minima", () => {
    const result = solvePolynomialNumerically(parse("x^2 + 1"), "x");
    expect(result.status).toBe("none");
    expect(result.roots).toEqual([]);
    const shallow = solvePolynomialNumerically(parse("x^2 + 0.00000000000000000001"), "x");
    expect(shallow.status).toBe("none");
  });

  it("distinguishes the zero polynomial from a nonzero constant", () => {
    expect(solvePolynomialNumerically(parse("0"), "x").status).toBe("all");
    expect(solvePolynomialNumerically(parse("7"), "x").status).toBe("none");
  });

  it("rejects non-polynomial and multivariate expressions explicitly", () => {
    expect(solvePolynomialNumerically(parse("sin(x)"), "x").status).toBe("unsupported");
    expect(solvePolynomialNumerically(parse("x^2 + y"), "x").status).toBe("unsupported");
  });

  it("normalizes large exact integer coefficients before floating-point calculations", () => {
    const result = solvePolynomialNumerically(
      parse("100000000000000000000000000000000000000000*x^3 - 200000000000000000000000000000000000000000"),
      "x",
    );
    expect(result.status).toBe("finite");
    expect(result.roots[0]!.value).toBeCloseTo(Math.cbrt(2), 8);
  });

  it("certifies exact multiplicities for repeated real roots", () => {
    const result = solvePolynomialNumerically(parse("(x - 1)^4*(x + 2)^3"), "x");
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]!.value).toBeCloseTo(-2, 7);
    expect(result.roots[0]!.multiplicity).toBe(3);
    expect(result.roots[1]!.value).toBeCloseTo(1, 7);
    expect(result.roots[1]!.multiplicity).toBe(4);
    expect(result.roots.every(root => root.certified && root.isolationInterval !== undefined)).toBe(true);
  });

  it("marks the overall result as partial when an isolated root misses tolerance", () => {
    const result = solvePolynomialNumerically(parse("x^3 - 2"), "x", {
      tolerance: 1e-14,
      maxIterations: 1,
    });
    expect(result.status).toBe("partial");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.converged).toBe(false);
  });

  it("keeps distinct roots even when both round to the same JavaScript number", () => {
    const result = solvePolynomialNumerically(
      parse("(x - 1)*(x - 1.0000000000000000000000001)"),
      "x",
      { tolerance: 1e-30 },
    );
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]!.value).toBe(result.roots[1]!.value);
    expect(result.roots[0]!.valueText).not.toBe(result.roots[1]!.valueText);
    expect(result.roots.every(root => root.certified)).toBe(true);
    expect(result.message).toMatch(/same IEEE-754 number/);
  });

  it("honors the configured maximum degree", () => {
    const result = solvePolynomialNumerically(parse("x^4 + x + 1"), "x", { maxDegree: 3 });
    expect(result.status).toBe("unsupported");
    expect(result.message).toMatch(/exceeds the configured maximum/);
  });
});
