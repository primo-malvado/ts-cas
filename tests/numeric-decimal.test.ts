import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import {
  decimal,
  decimalAdd,
  decimalDivide,
  decimalMultiply,
  decimalRound,
  parseDecimal,
  decimalPi,
  decimalSqrt,
  decimalToString,
  decimalSin,
  decimalCos,
  decimalAbs,
  decimalCompare,
  decimalSubtract,
  evaluateDecimal,
} from "../src/numeric/decimal.js";

describe("arbitrary-precision decimal arithmetic", () => {
  it("parses decimal and scientific notation without losing digits", () => {
    expect(decimalToString(parseDecimal("12345678901234567890.00100"))).toBe("12345678901234567890.001");
    expect(decimalToString(parseDecimal("1.25e-4"))).toBe("0.000125");
    expect(decimalToString(parseDecimal("-4.2E+5"))).toBe("-420000");
  });

  it("adds and multiplies values with many digits exactly", () => {
    const a = decimal("123456789012345678901234567890");
    const b = decimal("0.000000000000000000000000000009");
    expect(decimalToString(decimalAdd(a, b))).toBe("123456789012345678901234567890.000000000000000000000000000009");
    expect(decimalToString(decimalMultiply(decimal("123456789"), decimal("987654321"))))
      .toBe("121932631112635269");
  });

  it("divides to a configurable number of significant digits", () => {
    const result = evaluateDecimal(parse("1/7"), {}, { precision: 70 });
    expect(decimalToString(result).slice(0, 35)).toBe("0.142857142857142857142857142857142");
    expect(decimalToString(result).length).toBe(72);
  });

  it("computes square roots to arbitrary precision", () => {
    const result = decimalToString(decimalSqrt(decimal(2n), { precision: 70 }));
    expect(result.startsWith("1.41421356237309504880168872420969807856967187537694807317667973799")).toBe(true);
  });

  it("calculates pi using a convergent high-precision formula", () => {
    const result = decimalToString(decimalPi({ precision: 60 }));
    expect(result.startsWith("3.14159265358979323846264338327950288419716939937510582097494")).toBe(true);
  });

  it("evaluates transcendental expressions beyond double precision", () => {
    const result = decimalToString(evaluateDecimal(parse("exp(1)"), {}, { precision: 60 }));
    expect(result.startsWith("2.71828182845904523536028747135266249775724709369995957496697")).toBe(true);
  });

  it("evaluates trigonometric expressions with high precision", () => {
    const result = decimalToString(evaluateDecimal(parse("sin(1)"), {}, { precision: 50 }));
    expect(result.startsWith("0.84147098480789650665250232163029899962256306079837")).toBe(true);
  });


  it("preserves low-order digits during high-precision trigonometric range reduction", () => {
    const base = decimal("999999999999");
    const nearby = decimal("999999999999.00000000000000000001");
    const context = { precision: 50 as const };
    const baseSin = decimalSin(base, context);
    const nearbySin = decimalSin(nearby, context);
    const delta = decimalAbs(decimalSubtract(nearbySin, baseSin));
    // The arguments differ by 1e-20. Around 1e12, cos(x) is nonzero, so the
    // sine values must differ at approximately that scale. Conversion through
    // JavaScript Number would erase the low-order offset entirely.
    expect(decimalCompare(delta, decimal("1e-25"))).toBe(1);
    expect(decimalCompare(delta, decimal("1e-19"))).toBe(-1);

    const baseCos = decimalCos(base, context);
    const nearbyCos = decimalCos(nearby, context);
    expect(decimalCompare(decimalAbs(decimalSubtract(nearbyCos, baseCos)), decimal("1e-25"))).toBe(1);
  });

  it("uses decimal bindings without converting them to JavaScript number", () => {
    const result = evaluateDecimal(parse("x/3"), { x: "123456789012345678901234567890" }, { precision: 40 });
    expect(decimalToString(result).startsWith("41152263004115226300411522630.0")).toBe(false);
    expect(decimalToString(result).startsWith("41152263004115226300411522630")).toBe(true);
  });

  it("rejects an invalid rounding mode even when no rounding is needed", () => {
    expect(() => decimalRound(decimal(1n), 50, "invalid" as never)).toThrow(/Unsupported decimal rounding mode/);
  });

  it("rejects division by zero and real-domain violations", () => {
    expect(() => decimalDivide(decimal(1n), decimal(0n))).toThrow(/Division by zero/);
    expect(() => evaluateDecimal(parse("sqrt(-1)"))).toThrow(/non-negative real/);
    expect(() => evaluateDecimal(parse("ln(0)"))).toThrow(/positive real/);
  });
});
