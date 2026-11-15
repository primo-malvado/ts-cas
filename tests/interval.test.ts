import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import {
  decimal,
  decimalAbs,
  decimalAdd,
  decimalCompare,
  decimalMultiply,
  decimalSubtract,
} from "../src/numeric/decimal.js";
import {
  decimalInterval,
  decimalIntervalAdd,
  decimalIntervalContains,
  decimalIntervalContainsZero,
  decimalIntervalDivide,
  decimalIntervalMultiply,
  decimalIntervalPowInteger,
  decimalIntervalToString,
  evaluateDecimalInterval,
} from "../src/numeric/interval.js";

describe("outward-rounded interval arithmetic", () => {
  it("encloses non-terminating rational values", () => {
    const result = evaluateDecimalInterval(parse("1/3"), {}, { precision: 30 });
    expect(decimalIntervalContains(result.interval, "0.333333333333333333333333333333")).toBe(true);
    expect(result.certified).toBe(true);
    expect(result.lowerText).not.toBe(result.upperText);
  });

  it("encloses an expression for every input value in the supplied interval", () => {
    const range = decimalInterval("1.2", "1.3");
    const result = evaluateDecimalInterval(parse("x^2 + 2*x + 1"), { x: range }, { precision: 40 });
    for (const sample of ["1.2", "1.21", "1.25", "1.29", "1.3"]) {
      const x = decimal(sample);
      const actual = decimalAdd(decimalAdd(decimalMultiply(x, x), decimalMultiply(decimal(2n), x)), decimal(1n));
      expect(decimalIntervalContains(result.interval, actual)).toBe(true);
    }
  });

  it("satisfies enclosure checks over a deterministic grid of polynomial inputs", () => {
    const xRange = decimalInterval("-1.25", "1.5");
    const yRange = decimalInterval("-0.75", "2.25");
    const result = evaluateDecimalInterval(parse("x*y + x - y"), { x: xRange, y: yRange }, { precision: 35 });
    for (const xText of ["-1.25", "-0.5", "0", "1.5"]) {
      for (const yText of ["-0.75", "0.5", "2.25"]) {
        const x = decimal(xText);
        const y = decimal(yText);
        const exact = decimalSubtract(decimalAdd(decimalMultiply(x, y), x), y);
        expect(decimalIntervalContains(result.interval, exact)).toBe(true);
      }
    }
  });

  it("handles an even power whose input interval crosses zero", () => {
    const result = evaluateDecimalInterval(parse("x^2"), { x: decimalInterval("-2", "3") }, { precision: 25 });
    expect(decimalCompare(result.interval.lower, decimal(0n))).toBe(0);
    expect(decimalCompare(result.interval.upper, decimal(9n)) >= 0).toBe(true);
  });

  it("computes outward-rounded division and rejects denominators containing zero", () => {
    const result = decimalIntervalDivide(decimalInterval(1n), decimalInterval("3", "4"), 25);
    expect(decimalCompare(result.lower, decimal("0.25")) <= 0).toBe(true);
    expect(decimalCompare(result.upper, decimal("0.3333333333333333333333334")) >= 0).toBe(true);
    expect(() => decimalIntervalDivide(decimalInterval(1n), decimalInterval("-1", "1"))).toThrow(/contains zero/);
  });

  it("encloses square roots and absolute values", () => {
    const sqrt = evaluateDecimalInterval(parse("sqrt(x)"), { x: decimalInterval("2", "3") }, { precision: 40 });
    expect(decimalCompare(decimalMultiply(sqrt.interval.lower, sqrt.interval.lower), decimal(2n)) <= 0).toBe(true);
    expect(decimalCompare(decimalMultiply(sqrt.interval.upper, sqrt.interval.upper), decimal(3n)) >= 0).toBe(true);

    const abs = evaluateDecimalInterval(parse("abs(x)"), { x: decimalInterval("-4", "2") });
    expect(decimalIntervalToString(abs.interval)).toBe("[0, 4]");
  });

  it("encloses integer powers with negative bases", () => {
    const result = evaluateDecimalInterval(parse("x^3"), { x: decimalInterval("-2", "-1") }, { precision: 30 });
    expect(decimalCompare(result.interval.lower, decimal(-8n)) <= 0).toBe(true);
    expect(decimalCompare(result.interval.upper, decimal(-1n)) >= 0).toBe(true);
  });

  it("certifies trigonometric interval enclosures and rejects unsupported functions", () => {
    const sine = evaluateDecimalInterval(
      parse("sin(x)"),
      { x: decimalInterval(0n, 1n) },
      { precision: 40 },
    );
    expect(sine.certified).toBe(true);
    expect(decimalCompare(sine.interval.lower, decimal(0n))).toBeLessThanOrEqual(0);
    expect(decimalCompare(sine.interval.upper, decimal("0.84"))).toBeGreaterThan(0);
    expect(decimalCompare(sine.interval.upper, decimal("0.85"))).toBeLessThan(0);

    expect(() => evaluateDecimalInterval(parse("atan(x)"), { x: decimalInterval(0n, 1n) }))
      .toThrow(/not supported by certified interval evaluation/);
  });

  it("validates interval endpoint order and negative-power singularities", () => {
    expect(() => decimalInterval(2n, 1n)).toThrow(/lower endpoint/);
    expect(() => decimalIntervalPowInteger(decimalInterval("-1", "1"), -1n)).toThrow(/contains zero/);
  });

  it("checks shared engine exposure", async () => {
    const { createNumericalEngine } = await import("../src/numeric/engine.js");
    const engine = createNumericalEngine({ precision: 35 });
    const result = engine.evaluateInterval(parse("x^2 - 2"), { x: decimalInterval("1.4", "1.5") });
    expect(result.certified).toBe(true);
    expect(decimalIntervalContains(result.interval, decimal("-0.04"))).toBe(true);
    expect(decimalIntervalContains(result.interval, decimal("0.25"))).toBe(true);
  });
});
