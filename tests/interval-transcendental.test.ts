import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import { decimal, decimalCompare } from "../src/numeric/decimal.js";
import {
  decimalInterval,
  decimalIntervalContains,
  decimalIntervalExp,
  decimalIntervalLn,
  evaluateDecimalInterval,
} from "../src/numeric/interval.js";
import { certifyRealRoots } from "../src/numeric/certified-roots.js";

describe("certified transcendental interval extensions", () => {
  it("encloses e using a rigorous exponential remainder bound", () => {
    const result = decimalIntervalExp(decimalInterval(1n), 50);
    expect(decimalIntervalContains(result, "2.718281828459045235360287471352662497757247093699959574966967627724")).toBe(true);
    expect(decimalCompare(result.lower, decimal(2n)) > 0).toBe(true);
  });

  it("encloses ln(2) using a rigorous logarithm remainder bound", () => {
    const result = decimalIntervalLn(decimalInterval(2n), 50);
    expect(decimalIntervalContains(result, "0.69314718055994530941723212145817656807550013436025525412")).toBe(true);
    expect(decimalCompare(result.lower, decimal(0n)) > 0).toBe(true);
  });

  it("evaluates exp and ln inside an expression with outward rounding", () => {
    const result = evaluateDecimalInterval(parse("exp(ln(x))"), {
      x: decimalInterval("1.23456789", "1.23456790"),
    }, { precision: 35 });
    expect(decimalCompare(result.interval.lower, decimal("1.23456789")) <= 0).toBe(true);
    expect(decimalCompare(result.interval.upper, decimal("1.23456790")) >= 0).toBe(true);
  });

  it("certifies the unique real root of exp(x)-2", () => {
    const result = certifyRealRoots(parse("exp(x) - 2"), "x", "0", "1", {
      precision: 35,
      tolerance: "1e-20",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.lowerText.startsWith("0.6931471805")).toBe(true);
    expect(result.roots[0]!.certified).toBe(true);
  });

  it("certifies the unique real root of ln(x)-1 on a positive interval", () => {
    const result = certifyRealRoots(parse("ln(x) - 1"), "x", "2", "3", {
      precision: 30,
      tolerance: "1e-16",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.lowerText.startsWith("2.718281828")).toBe(true);
  });

  it("rejects logarithm intervals crossing the domain boundary", () => {
    expect(() => decimalIntervalLn(decimalInterval("-1", "1"), 30)).toThrow(/strictly positive/);
  });

  it("does not certify a root when the domain includes a logarithmic singularity", () => {
    const result = certifyRealRoots(parse("ln(x)"), "x", "-1", "1", {
      precision: 25,
      tolerance: "1e-10",
      maxSubdivisions: 100,
    });
    expect(["partial", "unsupported"]).toContain(result.status);
    expect(result.certified).toBe(false);
  });
});
