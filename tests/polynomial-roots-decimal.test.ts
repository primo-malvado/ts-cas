import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import {
  decimal,
  decimalAbs,
  decimalCompare,
  decimalSubtract,
} from "../src/numeric/decimal.js";
import { solvePolynomialNumericallyDecimal } from "../src/numeric/polynomial-roots-decimal.js";

describe("arbitrary-precision polynomial roots", () => {
  it("solves a quadratic to substantially more than double precision", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x^2 - 2"), "x", {
      precision: 80,
      tolerance: "1e-72",
    });
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[1]!.valueText.startsWith("1.41421356237309504880168872420969807856967187537694807317667973799")).toBe(true);
    expect(result.roots.every(root => root.converged)).toBe(true);
  });

  it("separates close roots when precision and tolerance allow it", () => {
    const result = solvePolynomialNumericallyDecimal(
      parse("(x - 1)*(x - 1.0000000000000000000000001)"),
      "x",
      { precision: 80, tolerance: "1e-40" },
    );
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]!.valueText).not.toBe(result.roots[1]!.valueText);
  });

  it("finds even-multiplicity roots", () => {
    const result = solvePolynomialNumericallyDecimal(parse("(x - 1)^4*(x + 2)^2"), "x", {
      precision: 60,
    });
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots.map(root => root.multiplicity)).toEqual([2, 4]);
    expect(result.roots.every(root => root.converged)).toBe(true);
  });

  it("reports a polynomial with no real roots", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x^2 + 1"), "x", {
      precision: 50,
    });
    expect(result.status).toBe("none");
    expect(result.roots).toHaveLength(0);
  });

  it("returns every real root of a quartic", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x^4 - 5*x^2 + 4"), "x", {
      precision: 60,
    });
    expect(result.status).toBe("finite");
    const expected = ["-2", "-1", "1", "2"].map(decimal);
    const errors = result.roots.map((root, index) =>
      decimalAbs(decimalSubtract(root.value, expected[index]!)),
    );
    expect(errors.every(error => decimalCompare(error, decimal("1e-50")) < 0)).toBe(true);
  });

  it("makes incomplete convergence explicit", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x^2 - 2"), "x", {
      precision: 50,
      tolerance: "1e-45",
      maxIterations: 1,
    });
    expect(result.status).toBe("partial");
    expect(result.roots.some(root => !root.converged)).toBe(true);
  });

  it("reports invalid polynomial expressions as unsupported", () => {
    const result = solvePolynomialNumericallyDecimal(parse("sin(x)"), "x");
    expect(result.status).toBe("unsupported");
  });
});

function compareExactFractionStrings(left: string, right: string): -1 | 0 | 1 {
  const parseFraction = (text: string): [bigint, bigint] => {
    const [numeratorText, denominatorText] = text.split("/");
    return [BigInt(numeratorText!), denominatorText === undefined ? 1n : BigInt(denominatorText)];
  };
  const [ln, ld] = parseFraction(left);
  const [rn, rd] = parseFraction(right);
  const l = ln * rd;
  const r = rn * ld;
  return l < r ? -1 : l > r ? 1 : 0;
}

describe("certified Sturm root isolation regression cases", () => {
  it("does not mistake a very shallow positive minimum for a repeated root", () => {
    const result = solvePolynomialNumericallyDecimal(
      parse("(x - 1)^2 + 0.00000000000000000000000000000000000000000000000001"),
      "x",
      { precision: 60 },
    );
    expect(result.status).toBe("none");
    expect(result.totalDistinctRealRoots).toBe(0);
  });

  it("certifies multiplicities exactly from square-free factors", () => {
    const result = solvePolynomialNumericallyDecimal(
      parse("(x - 1)^4*(x + 2)^3"),
      "x",
      { precision: 60 },
    );
    expect(result.status).toBe("finite");
    expect(result.roots.map(root => root.multiplicity)).toEqual([3, 4]);
    expect(result.roots.every(root => root.certified)).toBe(true);
    expect(result.totalDistinctRealRoots).toBe(2);
  });

  it("keeps close distinct roots in disjoint exact isolating intervals", () => {
    const result = solvePolynomialNumericallyDecimal(
      parse("(x - 1)*(x - 1.0000000000000000000000001)"),
      "x",
      { precision: 80, tolerance: "1e-70" },
    );
    expect(result.status).toBe("finite");
    expect(result.roots).toHaveLength(2);
    expect(result.roots.every(root => root.certified)).toBe(true);
    expect(compareExactFractionStrings(
      result.roots[0]!.isolationInterval.upperExact,
      result.roots[1]!.isolationInterval.lowerExact,
    )).toBe(-1);
  });

  it("keeps the decimal approximation inside its exact isolating interval", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x"), "x", { precision: 60 });
    expect(result.status).toBe("finite");
    const root = result.roots[0]!;
    expect(root.certified).toBe(true);
    expect(root.converged).toBe(true);
    expect(root.valueText).toBeDefined();
    // Isolating interval endpoints are exact rationals around zero.
    expect(compareExactFractionStrings(root.isolationInterval.lowerExact, "0")).toBeLessThan(0);
    expect(compareExactFractionStrings(root.isolationInterval.upperExact, "0")).toBeGreaterThan(0);
  });

  it("certifies that x has one real root even though its decimal approximation is near zero", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x"), "x", { precision: 50 });
    expect(result.status).toBe("finite");
    expect(result.totalDistinctRealRoots).toBe(1);
    expect(result.roots[0]!.certified).toBe(true);
    expect(result.roots[0]!.converged).toBe(true);
    expect(compareExactFractionStrings(result.roots[0]!.isolationInterval.lowerExact, "0")).toBeLessThan(0);
    expect(compareExactFractionStrings(result.roots[0]!.isolationInterval.upperExact, "0")).toBeGreaterThan(0);
  });

  it("reports exact root counts separately when the iteration budget is too small", () => {
    const result = solvePolynomialNumericallyDecimal(parse("x^2 - 2"), "x", {
      precision: 50,
      maxIterations: 1,
    });
    expect(result.status).toBe("partial");
    expect(result.totalDistinctRealRoots).toBe(2);
    expect(result.roots.every(root => root.certified)).toBe(true);
    expect(result.roots.some(root => !root.converged)).toBe(true);
  });
});
