import { describe, expect, it } from "vitest";
import {
  evaluateComplex, numericComplexAdd, numericComplexDivide, numericComplexMultiply,
  numericComplexPow, numericComplexSqrt, parse,
} from "../src/index.js";

describe("numerical complex arithmetic", () => {
  it("evaluates the imaginary unit and exact-looking integer powers numerically", () => {
    const result = evaluateComplex(parse("i^2"));
    expect(result.re).toBeCloseTo(-1, 14);
    expect(result.im).toBeCloseTo(0, 14);
  });

  it("evaluates principal complex square roots and logarithms", () => {
    const root = evaluateComplex(parse("sqrt(-1)"));
    expect(root.re).toBeCloseTo(0, 14);
    expect(root.im).toBeCloseTo(1, 14);
    const logarithm = evaluateComplex(parse("log(-1)"));
    expect(logarithm.re).toBeCloseTo(0, 14);
    expect(logarithm.im).toBeCloseTo(Math.PI, 14);
  });

  it("evaluates Euler's identity", () => {
    const result = evaluateComplex(parse("exp(i*pi) + 1"));
    expect(result.re).toBeCloseTo(0, 12);
    expect(result.im).toBeCloseTo(0, 12);
  });

  it("supports trigonometric functions on complex values", () => {
    const sine = evaluateComplex(parse("sin(i)"));
    expect(sine.re).toBeCloseTo(0, 14);
    expect(sine.im).toBeCloseTo(Math.sinh(1), 14);
    const atan = evaluateComplex(parse("atan(1)"));
    expect(atan.re).toBeCloseTo(Math.PI / 4, 12);
    expect(atan.im).toBeCloseTo(0, 12);
  });

  it("accepts complex variable bindings", () => {
    const value = evaluateComplex(parse("z + 1"), { z: { re: 2, im: -3 } });
    expect(value).toEqual({ re: 3, im: -3 });
  });

  it("provides robust arithmetic helpers", () => {
    const product = numericComplexMultiply({ re: 1, im: 1 }, { re: 1, im: 1 });
    expect(product.re).toBeCloseTo(0, 14);
    expect(product.im).toBeCloseTo(2, 14);
    const quotient = numericComplexDivide(1, { re: 1, im: 1 });
    expect(quotient.re).toBeCloseTo(0.5, 14);
    expect(quotient.im).toBeCloseTo(-0.5, 14);
    expect(numericComplexAdd(2, { re: 1, im: 4 })).toEqual({ re: 3, im: 4 });
  });

  it("supports integer and principal complex powers", () => {
    const integerPower = numericComplexPow({ re: 1, im: 1 }, 2);
    expect(integerPower.re).toBeCloseTo(0, 14);
    expect(integerPower.im).toBeCloseTo(2, 14);
    const principalPower = numericComplexPow(-1, 0.5);
    expect(principalPower.re).toBeCloseTo(0, 12);
    expect(principalPower.im).toBeCloseTo(1, 12);
    const root = numericComplexSqrt({ re: 3, im: 4 });
    expect(root.re).toBeCloseTo(2, 14);
    expect(root.im).toBeCloseTo(1, 14);
    const hugeRoot = numericComplexSqrt(1e308);
    expect(hugeRoot.re).toBeCloseTo(1e154, 140);
    expect(hugeRoot.im).toBe(0);
  });

  it("rejects undefined and non-finite operations", () => {
    expect(() => numericComplexDivide(1, 0)).toThrow(/zero/i);
    expect(() => evaluateComplex(parse("log(0)"))).toThrow();
    expect(() => evaluateComplex(parse("exp(1000)"))).toThrow(/non-finite/i);
    expect(() => evaluateComplex(parse("missing + i"))).toThrow(/missing/);
  });
});
