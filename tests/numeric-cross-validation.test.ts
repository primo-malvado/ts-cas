import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import {
  decimal, decimalAbs, decimalCompare, decimalSubtract, decimalToString, evaluateDecimal,
} from "../src/numeric/decimal.js";
import { evaluateComplexDecimal } from "../src/numeric/complex-decimal.js";
import { numericalDerivativeDecimal, integrateNumericallyDecimal } from "../src/numeric/calculus-decimal.js";

const tolerance = decimal("1e-45");

function within(a: ReturnType<typeof decimal>, b: ReturnType<typeof decimal>, tol = tolerance): boolean {
  return decimalCompare(decimalAbs(decimalSubtract(a, b)), tol) < 0;
}

describe("cross-module numerical consistency", () => {
  it("agrees between real and complex evaluators for real expressions", () => {
    for (const source of ["sin(1)", "cos(1/3)", "exp(1/3)", "sqrt(2)", "ln(2)"]) {
      const real = evaluateDecimal(parse(source), {}, { precision: 55 });
      const complex = evaluateComplexDecimal(parse(source), {}, { precision: 55 });
      expect(within(complex.re, real, decimal("1e-48"))).toBe(true);
      expect(decimalCompare(decimalAbs(complex.im), decimal("1e-48")) < 0).toBe(true);
    }
  });

  it("checks Euler's identity through the arbitrary-precision complex evaluator", () => {
    const result = evaluateComplexDecimal(parse("exp(i*pi) + 1"), {}, { precision: 70 });
    expect(decimalCompare(decimalAbs(result.re), decimal("1e-65")) < 0).toBe(true);
    expect(decimalCompare(decimalAbs(result.im), decimal("1e-65")) < 0).toBe(true);
  });

  it("compares a symbolic derivative with a high-precision numerical derivative", () => {
    const result = numericalDerivativeDecimal(parse("sin(x) + x^3"), "x", "0.7", {}, {
      precision: 50, preferSymbolic: false, tolerance: "1e-35",
    });
    const expected = evaluateDecimal(parse("cos(x) + 3*x^2"), { x: "0.7" }, { precision: 50 });
    expect(result.converged).toBe(true);
    expect(within(result.value, expected, decimal("1e-30"))).toBe(true);
  });

  it("cross-checks high-precision integration against a known exact result", () => {
    const result = integrateNumericallyDecimal(parse("x^2"), "x", "0", "1", {}, {
      precision: 45, tolerance: "1e-35",
    });
    const expected = evaluateDecimal(parse("1/3"), {}, { precision: 45 });
    expect(result.converged).toBe(true);
    expect(within(result.value, expected, decimal("1e-30"))).toBe(true);
  });
});
