import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import { decimal, decimalAbs, decimalCompare, decimalPi, decimalSubtract, decimalNegate, evaluateDecimal } from "../src/numeric/decimal.js";
import { integrateNumericallyDecimal, numericalDerivativeDecimal } from "../src/numeric/calculus-decimal.js";

describe("arbitrary-precision numerical differentiation", () => {
  it("uses the symbolic derivative and preserves many significant digits", () => {
    const result = numericalDerivativeDecimal(parse("x^3"), "x", "1.234567890123456789", {}, { precision: 60 });
    const expected = evaluateDecimal(parse("3*x^2"), { x: "1.234567890123456789" }, { precision: 60 });
    const difference = decimalAbs(decimalSubtract(result.value, expected));
    expect(result.method).toBe("symbolic");
    expect(result.converged).toBe(true);
    expect(decimalCompare(difference, decimal("1e-55")) < 0).toBe(true);
    expect(result.valueText.length).toBeGreaterThan(20);
  });

  it("supports the five-point fallback with high precision", () => {
    const result = numericalDerivativeDecimal(parse("sin(x)"), "x", "1", {}, {
      precision: 40,
      preferSymbolic: false,
    });
    expect(result.method).toBe("five-point-central");
    expect(result.converged).toBe(true);
    expect(result.valueText.startsWith("0.5403023058681397174009366074429766037323")).toBe(true);
    expect(result.estimatedError.coefficient >= 0n).toBe(true);
  });

  it("falls back to a one-sided stencil at a real-domain boundary", () => {
    const result = numericalDerivativeDecimal(parse("sqrt(x)"), "x", "0", {}, {
      precision: 24,
      preferSymbolic: false,
    });
    expect(result.method).toBe("five-point-forward");
    expect(result.value.coefficient > 0n).toBe(true);
    // sqrt(x) has no finite derivative at zero; a one-sided stencil returns
    // a useful diagnostic approximation but must not claim convergence.
    expect(result.converged).toBe(false);
  });
});

describe("arbitrary-precision numerical integration", () => {
  it("integrates a polynomial at high precision", () => {
    const result = integrateNumericallyDecimal(parse("x^2"), "x", "0", "1", {}, { precision: 60 });
    expect(result.converged).toBe(true);
    expect(result.valueText.startsWith("0.333333333333333333333333333333333333333333333333333333333333")).toBe(true);
    expect(result.evaluations).toBe(48);
  });

  it("integrates transcendental functions beyond double precision", () => {
    const result = integrateNumericallyDecimal(parse("sin(x)"), "x", "0", decimalPi({ precision: 65 }), {}, { precision: 45 });
    expect(result.converged).toBe(true);
    expect(result.valueText.startsWith("2" )).toBe(true);
    expect(decimalCompare(result.estimatedError, decimal("1e-30")) <= 0).toBe(true);
  });

  it("supports arbitrary-precision endpoints and reversed intervals", () => {
    const forward = integrateNumericallyDecimal(parse("x"), "x", "0", "1e-30", {}, { precision: 35 });
    const reverse = integrateNumericallyDecimal(parse("x"), "x", "1e-30", "0", {}, { precision: 35 });
    expect(forward.converged).toBe(true);
    expect(decimalCompare(decimalAbs(decimalSubtract(forward.value, decimal("5e-61"))), decimal("1e-90")) < 0).toBe(true);
    expect(decimalCompare(decimalSubtract(reverse.value, decimalNegate(forward.value)), decimal(0n))).toBe(0);
  });

  it("returns an explicit non-converged result when the subdivision budget is too small", () => {
    const result = integrateNumericallyDecimal(parse("sqrt(x)"), "x", "0", "1", {}, {
      precision: 40,
      tolerance: "1e-35",
      maxDepth: 1,
    });
    expect(result.converged).toBe(false);
    expect(result.evaluations).toBeGreaterThan(0);
  });

  it("integrates backwards by negating the result", () => {
    const result = integrateNumericallyDecimal(parse("x^2"), "x", "1", "0", {}, { precision: 40 });
    expect(result.converged).toBe(true);
    expect(result.valueText.startsWith("-0.3333333333333333333333333333333333333333")).toBe(true);
  });
});

