import { describe, expect, it } from "vitest";
import { parse, simplifyRational, toString, type Expr } from "../src/index.js";

const showList = (values: readonly Expr[]) => values.map(value => toString(value));

describe("rational expression simplification", () => {
  it("cancels a common univariate polynomial factor and preserves its domain restriction", () => {
    const result = simplifyRational(parse("(x^2 - 1)/(x - 1)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("1 + x");
    expect(showList(result.canceledFactors)).toEqual(["-1 + x"]);
    expect(showList(result.restrictions)).toEqual(["-1 + x"]);
    expect(toString(result.factoredNumerator!)).toContain("x");
    expect(toString(result.factoredDenominator!)).toContain("x");
  });

  it("normalizes a rational expression with a constant denominator", () => {
    const result = simplifyRational(parse("(2*x)/(4*x)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("1/2");
    expect(showList(result.restrictions)).toEqual(["x"]);
  });

  it("keeps every original denominator restriction", () => {
    const result = simplifyRational(parse("1/(x^2 - 1)"));
    expect(result.status).toBe("simplified");
    expect(showList(result.restrictions)).toEqual(["-1 + x", "1 + x"]);
    expect(toString(result.expression!)).toContain("x");
  });

  it("combines sums of rational expressions", () => {
    const result = simplifyRational(parse("1/x + 1/(x + 1)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toContain("x^2");
    expect(result.restrictions).toHaveLength(2);
  });

  it("cancels common multivariate monomials", () => {
    const result = simplifyRational(parse("(x*y)/(x*z)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("z^-1*y");
    expect(showList(result.canceledFactors)).toEqual(["x"]);
    expect(showList(result.restrictions)).toEqual(["x", "z"]);
  });

  it("cancels a common non-monomial multivariate factor", () => {
    const result = simplifyRational(parse("(x^2 + 2*x*y + y^2)/(x + y)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("x + y");
    expect(showList(result.canceledFactors)).toEqual(["x + y"]);
    expect(showList(result.restrictions)).toEqual(["x + y"]);
  });

  it("cancels a multivariate factor when both operands have additional factors", () => {
    const result = simplifyRational(parse("(x^2 + 2*x*y + y^2)/(x*y + y^2)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("(x + y)*y^-1");
    expect(showList(result.canceledFactors)).toEqual(["x + y"]);
    expect(showList(result.restrictions)).toEqual(["x + y", "y"]);
  });

  it("finds multivariate common factors with a third variable", () => {
    const result = simplifyRational(parse("(x^2 + 2*x*y + y^2)/((x + y)*z)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("(x + y)*z^-1");
    expect(showList(result.canceledFactors)).toEqual(["x + y"]);
    expect(showList(result.restrictions)).toEqual(["x + y", "z"]);
  });

  it("does not invent a multivariate common factor", () => {
    const result = simplifyRational(parse("(x + y)/(x^2 + y^2)"));
    expect(result.status).toBe("simplified");
    expect(result.canceledFactors).toEqual([]);
  });

  it("uses multivariate factorization to preserve separate domain restrictions", () => {
    const result = simplifyRational(parse("1/(x^2 - y^2)"));
    expect(result.status).toBe("simplified");
    expect(showList(result.restrictions)).toEqual(["-1*y + x", "x + y"]);
  });


  it("preserves the excluded domain point when identical factors cancel", () => {
    const result = simplifyRational(parse("x/x"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("1");
    expect(showList(result.restrictions)).toEqual(["x"]);
  });

  it("does not lose restrictions when the whole numerator cancels", () => {
    const result = simplifyRational(parse("(x^2 - 1)/(x^2 - 1)"));
    expect(result.status).toBe("simplified");
    expect(toString(result.expression!)).toBe("1");
    expect(showList(result.restrictions)).toEqual(["-1 + x", "1 + x"]);
  });


  it("reports partial multivariate simplification when a general gcd may remain", () => {
    const result = simplifyRational(parse("(x*y + y)/(x*y + y^2)"));
    expect(result.status).toBe("partial");
    expect(showList(result.canceledFactors)).toEqual(["y"]);
    expect(showList(result.restrictions)).toEqual(["x + y", "y"]);
  });

  it("reports unsupported non-polynomial functions cleanly", () => {
    const result = simplifyRational(parse("sin(x)/(x - 1)"));
    expect(result.status).toBe("unsupported");
    expect(result.expression).toBeUndefined();
    expect(result.message).toMatch(/does not support the function/);
    expect(showList(result.restrictions)).toEqual(["-1 + x"]);
  });
});
