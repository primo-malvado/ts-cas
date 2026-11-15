import { describe, expect, it } from "vitest";
import { parse } from "../src/core/parser.js";
import { decimal, decimalCompare } from "../src/numeric/decimal.js";
import {
  decimalInterval,
  decimalIntervalContains,
  decimalIntervalCos,
  decimalIntervalSin,
  decimalIntervalTan,
  decimalIntervalPi,
  evaluateDecimalInterval,
} from "../src/numeric/interval.js";
import { certifyRealRoots } from "../src/numeric/certified-roots.js";

describe("certified trigonometric interval extensions", () => {
  it("computes a certified interval for pi", () => {
    const result = decimalIntervalPi(50);
    expect(decimalIntervalContains(result, "3.1415926535897932384626433832795028841971693993751")).toBe(true);
    expect(decimalCompare(result.lower, result.upper) < 0).toBe(true);
  });
  it("encloses sin(1) at high precision", () => {
    const result = decimalIntervalSin(decimalInterval(1n), 45);
    expect(decimalIntervalContains(result, "0.84147098480789650665250232163029899962256306079")).toBe(true);
    expect(decimalCompare(result.lower, result.upper) < 0).toBe(true);
  });

  it("encloses cos(1) at high precision", () => {
    const result = decimalIntervalCos(decimalInterval(1n), 45);
    expect(decimalIntervalContains(result, "0.5403023058681397174009366074429766037323104206")).toBe(true);
  });

  it("includes the exact maximum of cosine when the input interval crosses zero", () => {
    const result = decimalIntervalCos(decimalInterval("-0.5", "0.5"), 40);
    expect(decimalIntervalContains(result, "1")).toBe(true);
    expect(decimalIntervalContains(result, "0.8775825618903727161162815826038296519916")).toBe(true);
  });

  it("encloses tangent where cosine is bounded away from zero", () => {
    const result = decimalIntervalTan(decimalInterval("0.4", "0.5"), 35);
    expect(decimalIntervalContains(result, "0.4227932187381618")).toBe(true);
    expect(decimalIntervalContains(result, "0.5463024898437905")).toBe(true);
  });

  it("evaluates trig functions in an expression with directed rounding", () => {
    const result = evaluateDecimalInterval(parse("sin(x) + cos(x)"), {
      x: decimalInterval("0.2", "0.3"),
    }, { precision: 35 });
    expect(decimalCompare(result.interval.lower, decimal("1.15")) > 0).toBe(true);
    expect(decimalCompare(result.interval.upper, decimal("1.3")) < 0).toBe(true);
  });

  it("reduces certified trigonometric arguments larger than one", () => {
    const sine = decimalIntervalSin(decimalInterval(100n), 40);
    expect(decimalIntervalContains(sine, "-0.506365641109758793656557610459785432065032721")).toBe(true);
    const cosine = decimalIntervalCos(decimalInterval(100n, 101n), 30);
    expect(decimalIntervalContains(cosine, "1")).toBe(true);
  });

  it("preserves low-order decimal digits when reducing large arguments", () => {
    const a = decimalIntervalSin(decimalInterval("1000000000000"), 45);
    const b = decimalIntervalSin(decimalInterval("1000000000000.00000000000000000001"), 45);
    const disjoint = decimalCompare(a.upper, b.lower) < 0 || decimalCompare(b.upper, a.lower) < 0;
    expect(disjoint).toBe(true);
  });

  it("rejects tangent intervals that cross a certified pole", () => {
    expect(() => decimalIntervalTan(decimalInterval("1.5", "1.7"), 35)).toThrow(/may contain a pole/);
  });

  it("certifies a simple root of sin(x)-1/2 inside the safe domain", () => {
    const result = certifyRealRoots(parse("sin(x) - 1/2"), "x", "0", "1", {
      precision: 35,
      tolerance: "1e-18",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.lowerText.startsWith("0.5235987755")).toBe(true);
    expect(result.roots[0]!.certified).toBe(true);
  });

  it("certifies a simple sine root beyond two pi", () => {
    const result = certifyRealRoots(parse("sin(x) - 1/2"), "x", "6", "7", {
      precision: 30,
      tolerance: "1e-15",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.lowerText.startsWith("6.8067840827")).toBe(true);
  });

  it("certifies a simple tangent root beyond one radian", () => {
    const result = certifyRealRoots(parse("tan(x) - 1"), "x", "6.5", "7.1", {
      precision: 30,
      tolerance: "1e-15",
    });
    expect(result.status).toBe("certified");
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.lowerText.startsWith("7.0685834705")).toBe(true);
  });
});
