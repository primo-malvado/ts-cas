import { describe, expect, it } from "vitest";
import { add, differentiate, expand, integrate, IntegrationError, integer, mul, parse, simplify, simplifyRational, toString, equals } from "../src/index.js";

function derivativeMatches(integrand: string, variable = "x"): void {
  const original = simplify(parse(integrand));
  const primitive = integrate(parse(integrand), variable);
  expect(equals(simplify(differentiate(primitive, variable)), original)).toBe(true);
}

function rationalDerivativeMatches(integrand: string, variable = "x"): void {
  const original = parse(integrand);
  const primitive = integrate(original, variable);
  const difference = simplify(expand(add(differentiate(primitive, variable), mul(integer(-1), original))));
  const reduced = simplifyRational(difference);
  expect(reduced.status).toBe("simplified");
  expect(toString(reduced.numerator!)).toBe("0");
}

describe("symbolic integration", () => {
  it("integrates exact univariate and multivariate polynomials", () => {
    derivativeMatches("x^3 + 2*x - 7");
    derivativeMatches("y*x^3 + 2*x + y");
    expect(equals(integrate(parse("x^3"), "x"), parse("x^4/4"))).toBe(true);
  });

  it("integrates constants with respect to another variable", () => {
    expect(equals(integrate(parse("sin(y)"), "x"), parse("x*sin(y)"))).toBe(true);
    derivativeMatches("y", "x");
  });

  it("integrates common functions with affine arguments", () => {
    derivativeMatches("sin(3*x + 2)");
    derivativeMatches("cos(2*x - 1)");
    derivativeMatches("exp(4*x)");
    expect(equals(integrate(parse("sin(x)"), "x"), parse("-cos(x)"))).toBe(true);
  });

  it("integrates reciprocal affine expressions using logarithms", () => {
    expect(toString(integrate(parse("1/x"), "x"))).toBe("log(abs(x))");
    expect(toString(integrate(parse("1/(2*x + 3)"), "x"))).toContain("log(abs(3 + 2*x))");
    derivativeMatches("1/x");
    derivativeMatches("1/(2*x + 3)");
  });

  it("integrates non-integer powers of affine expressions", () => {
    const result = integrate(parse("sqrt(2*x + 1)"), "x");
    expect(toString(result)).toContain("(2*x + 1)^(3/2)");
    // The AST represents sqrt(u) and u^(1/2) differently; compare with the equivalent
    // rational-power expression after differentiating the primitive.
    const derived = simplify(differentiate(result, "x"));
    expect(equals(derived, simplify(parse("(2*x + 1)^(1/2)")))).toBe(true);
  });

  it("uses linearity for sums and constant multiples", () => {
    derivativeMatches("3*sin(x) + 2*x^2");
    derivativeMatches("y*cos(x)");
  });

  it("uses u-substitution for recognizable non-affine compositions", () => {
    derivativeMatches("x*cos(x^2)");
    derivativeMatches("2*x*exp(x^2)");
    derivativeMatches("3*x^2*sin(x^3)");
    derivativeMatches("x*sin(x^2)");
    expect(equals(
      simplify(differentiate(integrate(parse("x*cos(x^2)"), "x"), "x")),
      simplify(parse("x*cos(x^2)")),
    )).toBe(true);
  });

  it("integrates rational functions with rational linear factors using partial fractions", () => {
    for (const integrand of [
      "1/(x^2 - 1)",
      "1/(x^2 + 3*x + 2)",
      "1/(x*(x + 1)^2)",
      "x^2/(x + 1)",
      "1/(x + 1)^2",
    ]) rationalDerivativeMatches(integrand);

    expect(toString(integrate(parse("1/(x^2 - 1)"), "x"))).toContain("log(abs");
    expect(toString(integrate(parse("1/(x*(x + 1)^2)"), "x"))).toContain("log(abs(x))");
    expect(toString(integrate(parse("x^2/(x + 1)"), "x"))).toContain("log(abs(1 + x))");
  });

  it("integrates irreducible quadratic denominators with arctangent", () => {
    derivativeMatches("1/(x^2 + 1)");
    rationalDerivativeMatches("1/(x^2 + 2*x + 2)");
    rationalDerivativeMatches("x/(x^2 + 1)");
    rationalDerivativeMatches("(2*x + 3)/(x^2 + 1)");
    rationalDerivativeMatches("1/(x^2 + 1)^2");
    rationalDerivativeMatches("1/(x^2 + 1)^3");
    rationalDerivativeMatches("1/(x*(x^2 + 1))");
    expect(toString(integrate(parse("1/(x^2 + 1)"), "x"))).toBe("atan(x)");
    expect(toString(integrate(parse("1/(x^2 + 2*x + 2)"), "x"))).toContain("atan");
    expect(toString(integrate(parse("1/(x^2 + 2*x + 3)"), "x"))).toContain("sqrt(2)");
    expect(() => integrate(parse("1/(x^2 - 2)"), "x")).toThrow(IntegrationError);
  });

  it("uses integration by parts for polynomial times logarithms", () => {
    derivativeMatches("x*log(x)");
    derivativeMatches("x^2*log(x)");
    // The derivative is algebraically identical, but its rational remainder
    // requires exact rational normalization (the basic simplifier intentionally
    // preserves domain restrictions rather than cancelling arbitrary denominators).
    rationalDerivativeMatches("x*log(2*x + 1)");
    rationalDerivativeMatches("x*log(3*x + 2)");
    rationalDerivativeMatches("x^2*log(2*x + 1)");
    rationalDerivativeMatches("(x^2 + 1)*log(x)");
    rationalDerivativeMatches("(x^2 + 1)*log(2*x + 1)");
  });

  it("uses integration by parts for polynomial times elementary functions", () => {
    derivativeMatches("x*exp(x)");
    derivativeMatches("x*cos(x)");
    derivativeMatches("x*sin(x)");
    derivativeMatches("x^2*exp(x)");
    derivativeMatches("(x + 1)*sin(2*x)");
    derivativeMatches("x*cos(2*x)");
  });

  it("reports integrals outside the implemented rule set", () => {
    expect(() => integrate(parse("sin(x^2)"), "x")).toThrow(IntegrationError);
    expect(() => integrate(parse("x*sin(x)*exp(x)"), "x")).toThrow(IntegrationError);
    expect(() => integrate(parse("log(sin(x))"), "x")).toThrow(IntegrationError);
  });
});
