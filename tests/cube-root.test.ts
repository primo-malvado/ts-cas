import { describe, expect, it } from "vitest";
import {
  decimal, decimalCompare, decimalInterval, decimalIntervalContains, decimalPowInteger,
  analyzeRealDomain, decimalToString, differentiate, evaluate, evaluateDecimal, evaluateDecimalInterval,
  exactRational, parse,
} from "../src/index.js";

describe("real cube root support", () => {
  it("parses and numerically evaluates cube roots of positive and negative values", () => {
    expect(evaluate(parse("cbrt(8)"))).toBe(2);
    expect(evaluate(parse("cbrt(-8)"))).toBe(-2);
    expect(evaluate(parse("cbrt(-0.125)"))).toBeCloseTo(-0.5, 12);
  });

  it("supports arbitrary-precision decimal cube roots", () => {
    expect(decimalToString(evaluateDecimal(parse("cbrt(8)"), {}, { precision: 30 }))).toBe("2");
    expect(decimalToString(evaluateDecimal(parse("cbrt(-8)"), {}, { precision: 30 }))).toBe("-2");
    const result = evaluateDecimal(parse("cbrt(2)"), {}, { precision: 30 });
    expect(decimalToString(result)).toMatch(/^1\.259921049894873164767210607/);
  });

  it("certifies cube-root interval enclosures across negative and positive values", () => {
    const result = evaluateDecimalInterval(parse("cbrt(x)"), { x: decimalInterval("-8", "27") }, { precision: 30 });
    expect(result.certified).toBe(true);
    expect(decimalCompare(result.interval.lower, decimal(-2n))).toBeLessThanOrEqual(0);
    expect(decimalCompare(result.interval.upper, decimal(3n))).toBeGreaterThanOrEqual(0);
    expect(decimalIntervalContains(result.interval, decimal(-2n))).toBe(true);
  });

  it("rounds non-perfect cube-root interval endpoints outward", () => {
    const result = evaluateDecimalInterval(
      parse("cbrt(x)"),
      { x: decimalInterval("-123.456", "0.001") },
      { precision: 40 },
    );
    expect(result.certified).toBe(true);

    // The cube function is increasing on the reals. These exact-decimal checks
    // verify that the lower and upper bounds are outward enclosures, not merely
    // close to Math.cbrt's binary floating-point approximation.
    const lowerCubed = decimalPowInteger(result.interval.lower, 3n, { precision: 120, rounding: "floor" });
    const upperCubed = decimalPowInteger(result.interval.upper, 3n, { precision: 120, rounding: "ceil" });
    expect(decimalCompare(lowerCubed, decimal("-123.456"))).toBeLessThanOrEqual(0);
    expect(decimalCompare(upperCubed, decimal("0.001"))).toBeGreaterThanOrEqual(0);
  });

  it("treats cube root as real-defined and differentiates it symbolically", () => {
    const derivative = differentiate(parse("cbrt(x)"), "x");
    expect(derivative.kind).not.toBe("Integer");
    const domain = analyzeRealDomain(parse("cbrt(x)"), "x", exactRational(-2n), exactRational(2n));
    expect(domain.status).toBe("complete");
  });
});
