import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import {
  complexDecimalAbs,
  complexDecimalDivide,
  complexDecimalLog,
  complexDecimalSqrt,
  complexDecimalToString,
  evaluateComplexDecimal,
} from "../src/numeric/complex-decimal.js";
import { decimal, decimalCompare, decimalSubtract, decimalAbs, decimalToString } from "../src/numeric/decimal.js";

describe("arbitrary-precision complex arithmetic", () => {
  it("evaluates exp(i*pi)+1 near zero at high precision", () => {
    const result = evaluateComplexDecimal(parse("exp(i*pi) + 1"), {}, { precision: 60 });
    expect(decimalCompare(decimalAbs(result.re), decimal("1e-55"))).toBeLessThan(0);
    expect(decimalCompare(decimalAbs(result.im), decimal("1e-55"))).toBeLessThan(0);
  });

  it("computes principal square roots of negative real values", () => {
    const result = complexDecimalSqrt({ re: decimal(-4n), im: decimal(0n) }, { precision: 60 });
    expect(decimalToString(result.re)).toBe("0");
    expect(decimalToString(result.im)).toBe("2");
  });

  it("computes principal logarithm of -1", () => {
    const result = complexDecimalLog({ re: decimal(-1n), im: decimal(0n) }, { precision: 50 });
    expect(decimalToString(result.re)).toBe("0");
    expect(decimalToString(result.im).startsWith("3.1415926535897932384626433832795028841971693993751")).toBe(true);
  });

  it("evaluates complex trigonometric and exponential functions", () => {
    const sin = evaluateComplexDecimal(parse("sin(1+i)"), {}, { precision: 50 });
    expect(decimalToString(sin.re).startsWith("1.298457581415977294826042365807815620313")).toBe(true);
    expect(decimalToString(sin.im).startsWith("0.634963914784736108255082202991509781") ).toBe(true);

    const exp = evaluateComplexDecimal(parse("exp(i)"), {}, { precision: 50 });
    expect(decimalToString(exp.re).startsWith("0.540302305868139717400936607442976603732")).toBe(true);
    expect(decimalToString(exp.im).startsWith("0.841470984807896506652502321630298999622")).toBe(true);
  });

  it("handles division and magnitude at precision beyond double", () => {
    const z = { re: decimal("123456789012345678901234567890"), im: decimal("1e-40") };
    const quotient = complexDecimalDivide(z, { re: decimal(3n), im: decimal(0n) }, { precision: 70 });
    expect(decimalToString(quotient.re).startsWith("41152263004115226300411522630")).toBe(true);
    const magnitude = complexDecimalAbs({ re: decimal(3n), im: decimal(4n) }, { precision: 60 });
    expect(decimalToString(magnitude)).toBe("5");
  });

  it("uses decimal complex bindings and formats results", () => {
    const result = evaluateComplexDecimal(parse("z^2 + 1"), {
      z: { re: decimal(0n), im: decimal(1n) },
    }, { precision: 50 });
    expect(decimalToString(result.re)).toBe("0");
    expect(decimalToString(result.im)).toBe("0");
    expect(complexDecimalToString({ re: decimal(2n), im: decimal(-3n) })).toBe("2 - 3i");
  });

  it("evaluates complex arctangent and principal powers", () => {
    const atan = evaluateComplexDecimal(parse("atan(1)"), {}, { precision: 50 });
    expect(decimalToString(atan.re).startsWith("0.7853981633974483096156608458198757210492923498437")).toBe(true);
    expect(decimalToString(atan.im)).toBe("0");

    const power = evaluateComplexDecimal(parse("(1+i)^2"), {}, { precision: 50 });
    expect(decimalToString(power.re)).toBe("0");
    expect(decimalToString(power.im)).toBe("2");
  });

  it("rejects singular operations", () => {
    expect(() => complexDecimalDivide({ re: decimal(1n), im: decimal(0n) }, { re: decimal(0n), im: decimal(0n) })).toThrow(/zero/);
    expect(() => complexDecimalLog({ re: decimal(0n), im: decimal(0n) })).toThrow(/undefined at zero/);
  });
});
