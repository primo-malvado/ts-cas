import { describe, expect, it } from "vitest";
import { analyzeRationalSingularities, exactRational, parse, toString, integer, type Expr } from "../src/index.js";

const q = (n: bigint, d = 1n) => exactRational(n, d);
const contains = (interval: { lower: ReturnType<typeof q>; upper: ReturnType<typeof q> }, value: ReturnType<typeof q>) =>
  interval.lower.numerator * value.denominator <= value.numerator * interval.lower.denominator &&
  value.numerator * interval.upper.denominator <= interval.upper.numerator * value.denominator;

describe("exact rational domain and singularity analysis", () => {
  it("classifies a canceled denominator zero as a removable singularity", () => {
    const result = analyzeRationalSingularities(parse("(x^2 - 1)/(x - 1)"), "x", q(0n), q(2n));
    expect(result.status).toBe("complete");
    expect(toString(result.simplifiedExpression!)).toBe("1 + x");
    expect(result.singularities).toHaveLength(1);
    expect(contains(result.singularities[0]!.interval, q(1n))).toBe(true);
    expect(result.singularities[0]!.kind).toBe("removable");
    expect(result.singularities[0]!.poleOrder).toBeUndefined();
    expect(result.singularities[0]!.excludedFactors.map(toString)).toContain("-1 + x");
  });

  it("isolates poles on both sides and reports the reduced denominator order", () => {
    const result = analyzeRationalSingularities(parse("1/(x^2 - 1)"), "x", q(-2n), q(2n));
    expect(result.status).toBe("complete");
    expect(result.singularities).toHaveLength(2);
    expect(result.singularities.map(item => item.kind)).toEqual(["pole", "pole"]);
    expect(result.singularities.map(item => item.poleOrder)).toEqual([1, 1]);
    expect(contains(result.singularities[0]!.interval, q(-1n))).toBe(true);
    expect(contains(result.singularities[1]!.interval, q(1n))).toBe(true);
  });

  it("computes the exact order of a higher-order pole", () => {
    const result = analyzeRationalSingularities(parse("1/(x - 1)^3"), "x", q(0n), q(2n));
    expect(result.status).toBe("complete");
    expect(result.singularities).toHaveLength(1);
    expect(contains(result.singularities[0]!.interval, q(1n))).toBe(true);
    expect(result.singularities[0]!.kind).toBe("pole");
    expect(result.singularities[0]!.poleOrder).toBe(3);
  });

  it("recognizes a partially canceled denominator as a simple pole", () => {
    const result = analyzeRationalSingularities(parse("(x^2 - 1)/(x - 1)^2"), "x", q(0n), q(2n));
    expect(result.status).toBe("complete");
    expect(result.singularities).toHaveLength(1);
    expect(contains(result.singularities[0]!.interval, q(1n))).toBe(true);
    expect(result.singularities[0]!.kind).toBe("pole");
    expect(result.singularities[0]!.poleOrder).toBe(1);
  });

  it("reports no real singularities when the denominator has no real roots", () => {
    const result = analyzeRationalSingularities(parse("1/(x^2 + 1)"), "x", q(-10n), q(10n));
    expect(result.status).toBe("complete");
    expect(result.singularities).toHaveLength(0);
  });

  it("preserves a hole when numerator and denominator cancel identically", () => {
    const result = analyzeRationalSingularities(parse("x/x"), "x", q(-1n), q(1n));
    expect(result.status).toBe("complete");
    expect(toString(result.simplifiedExpression!)).toBe("1");
    expect(result.singularities).toHaveLength(1);
    expect(contains(result.singularities[0]!.interval, q(0n))).toBe(true);
    expect(result.singularities[0]!.kind).toBe("removable");
  });

  it("includes singularities exactly at the closed interval endpoints", () => {
    const result = analyzeRationalSingularities(parse("1/(x*(x - 1))"), "x", q(0n), q(1n));
    expect(result.status).toBe("complete");
    expect(result.singularities).toHaveLength(2);
    expect(result.singularities.every(item => item.kind === "pole")).toBe(true);
    expect(result.singularities.every(item => item.interval.lower.numerator === item.interval.upper.numerator)).toBe(true);
  });

  it("keeps extremely close excluded points separate with a tighter exact tolerance", () => {
    const result = analyzeRationalSingularities(
      parse("1/((x - 1)*(x - 1.000000000001))"), "x", q(999n, 1000n), q(1001n, 1000n),
      { tolerance: q(1n, 10n ** 18n), maxIterations: 2000 },
    );
    expect(result.status).toBe("complete");
    expect(result.singularities).toHaveLength(2);
    expect(result.singularities.every(item => item.kind === "pole" && item.poleOrder === 1)).toBe(true);
    expect(result.singularities[0]!.interval.upper.numerator * result.singularities[1]!.interval.lower.denominator)
      .toBeLessThanOrEqual(result.singularities[1]!.interval.lower.numerator * result.singularities[0]!.interval.upper.denominator);
  });

  it("returns partial instead of silently truncating an over-degree restriction polynomial", () => {
    const result = analyzeRationalSingularities(
      parse("1/((x - 1)*(x - 2)*(x - 3))"), "x", q(0n), q(4n), { maxDegree: 2 },
    );
    expect(result.status).toBe("partial");
    expect(result.message).toMatch(/degree 3/);
  });

  it("declines multivariate rational restrictions without making unsupported claims", () => {
    const result = analyzeRationalSingularities(parse("1/(x*y - 1)"), "x", q(-2n), q(2n));
    expect(result.status).toBe("unsupported");
    expect(result.message).toMatch(/univariate/);
  });

  it("reports an identically undefined rational expression separately", () => {
    const invalid: Expr = {
      kind: "Pow",
      base: integer(0),
      exponent: integer(-1),
    };
    const result = analyzeRationalSingularities(invalid, "x", q(-1n), q(1n));
    expect(result.status).toBe("undefined");
    expect(result.singularities).toHaveLength(0);
  });
});
