import { describe, expect, it } from "vitest";
import {
  parse, toString, polynomialFromExpr, polynomialToExpr, polynomialAdd,
  polynomialMultiply, polynomialPow, polynomialDegree, polynomialCoefficient,
  polynomialEvaluate, polynomialDivide,
} from "../src/index.js";

const from = (source: string) => polynomialFromExpr(parse(source));
const show = (poly: ReturnType<typeof from>) => toString(polynomialToExpr(poly));

describe("sparse polynomial algebra", () => {
  it("converts expressions to canonical polynomial form", () => {
    expect(show(from("(x + 1)^2"))).toBe("1 + 2*x + x^2");
  });

  it("adds and multiplies multivariate polynomials", () => {
    expect(show(polynomialAdd(from("x + y"), from("x - y")))).toBe("2*x");
    expect(show(polynomialMultiply(from("x + y"), from("x - y")))).toBe("-1*y^2 + x^2");
  });

  it("uses exact rational coefficients", () => {
    expect(show(polynomialMultiply(from("1/2*x"), from("2*x")))).toBe("x^2");
  });

  it("computes degrees and coefficients", () => {
    const p = from("3*x^3 + 2*x^2 + 7*x + 5");
    expect(polynomialDegree(p, "x")).toBe(3);
    expect(show(polynomialCoefficient(p, "x", 2))).toBe("2");
  });

  it("evaluates a polynomial numerically", () => {
    expect(polynomialEvaluate(from("x^2 + 2*x + 1"), { x: 3 })).toBe(16);
  });

  it("performs exact univariate division", () => {
    const { quotient, remainder } = polynomialDivide(from("x^2 - 1"), from("x - 1"));
    expect(show(quotient)).toBe("1 + x");
    expect(show(remainder)).toBe("0");
  });

  it("rejects non-polynomial expressions", () => {
    expect(() => from("sin(x)")).toThrow(/not a polynomial/);
    expect(() => polynomialPow(from("x"), -1)).toThrow(/non-negative/);
  });
});

describe("rational polynomial factorization", () => {
  it("factors a difference of squares through rational roots", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2 - 1")))).toBe("(-1 + x)*(1 + x)");
  });

  it("factors polynomials with repeated rational roots", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2 - 4*x + 4")))).toBe("(-2 + x)^2");
  });

  it("extracts rational roots and keeps an irreducible remainder", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("2*x^3 - 2*x")))).toBe("(-1 + x)*(1 + x)*2*x");
  });

  it("detects repeated irreducible quadratic factors", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("(x^2 + 1)^3")))).toBe("(x^2 + 1)^3");
  });
});


describe("multivariate common-factor extraction", () => {
  it("extracts a common monomial", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2*y + x*y^2")))).toBe("(x + y)*x*y");
  });
});


describe("multivariate polynomial factorization", () => {
  it("factors a multivariate difference of squares", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2 - y^2")))).toBe("(-1*y + x)*(x + y)");
  });

  it("recognizes a perfect-square trinomial", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2 + 2*x*y + y^2")))).toBe("(x + y)^2");
    expect(toString(factor(parse("x^2 - 2*x*y + y^2")))).toBe("(-1*y + x)^2");
  });

  it("factors by grouping", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2 + x*y + x*z + y*z")))).toBe("(x + y)*(x + z)");
  });

  it("handles non-unit coefficient ratios when factoring by grouping", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("2*x^2 + 2*x*y + x*z + y*z")))).toBe("(2*x + z)*(x + y)");
  });

  it("extracts numeric content before factoring", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("2*x^2 - 2*y^2")))).toBe("(-1*y + x)*(x + y)*2");
  });

  it("leaves a sum of squares irreducible over the rationals", async () => {
    const { factor } = await import("../src/index.js");
    expect(toString(factor(parse("x^2 + y^2")))).toBe("x^2 + y^2");
  });
});
