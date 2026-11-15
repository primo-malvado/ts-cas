import { describe, expect, it } from "vitest";
import { laurentSeries, limit, parse, series, taylorSeries, toString } from "../src/index.js";

describe("Taylor and Laurent series", () => {
  it("computes exact Taylor coefficients for sine", () => {
    const result = taylorSeries(parse("sin(x)"), "x", parse("0"), 5);
    expect(result.kind).toBe("taylor");
    expect(toString(result.coefficients["1"]!)).toBe("1");
    expect(toString(result.coefficients["3"]!)).toBe("-1/6");
    expect(toString(result.coefficients["5"]!)).toBe("1/120");
  });

  it("computes exponential and rational-function expansions exactly", () => {
    const exponential = taylorSeries(parse("exp(x)"), "x", parse("0"), 4);
    expect(toString(exponential.coefficients["0"]!)).toBe("1");
    expect(toString(exponential.coefficients["2"]!)).toBe("1/2");
    expect(toString(exponential.coefficients["4"]!)).toBe("1/24");

    const rational = taylorSeries(parse("(1 + x)/(1 - x)"), "x", parse("0"), 4);
    expect(toString(rational.coefficients["0"]!)).toBe("1");
    for (const order of [1, 2, 3, 4]) expect(toString(rational.coefficients[String(order)]!)).toBe("2");

    const removable = taylorSeries(parse("(exp(x) - 1)/x"), "x", parse("0"), 4);
    expect(toString(removable.coefficients["0"]!)).toBe("1");
    expect(toString(removable.coefficients["1"]!)).toBe("1/2");
    expect(toString(removable.coefficients["4"]!)).toBe("1/120");
  });

  it("returns Laurent expansions for poles", () => {
    const result = laurentSeries(parse("1/x"), "x", parse("0"), 3);
    expect(result.kind).toBe("laurent");
    expect(result.leadingExponent).toBe(-1);
    expect(toString(result.leadingCoefficient!)).toBe("1");
    expect(toString(result.coefficients["-1"]!)).toBe("1");
    expect(toString(result.expression)).toBe("x^-1");

    const orderZero = laurentSeries(parse("1/x^20"), "x", parse("0"), 0);
    expect(orderZero.leadingExponent).toBe(-20);
    expect(toString(orderZero.coefficients["-20"]!)).toBe("1");
    expect(taylorSeries(parse("x^20"), "x", parse("0"), 6).leadingExponent).toBeNull();
  });

  it("expands rational powers away from a zero of the base", () => {
    const result = taylorSeries(parse("sqrt(1 + x)"), "x", parse("0"), 4);
    expect(toString(result.coefficients["0"]!)).toBe("1");
    expect(toString(result.coefficients["1"]!)).toBe("1/2");
    expect(toString(result.coefficients["2"]!)).toBe("-1/8");
    expect(toString(result.coefficients["3"]!)).toBe("1/16");
    expect(toString(result.coefficients["4"]!)).toBe("-5/128");

    const shiftedRoot = taylorSeries(parse("sqrt(4 + x)"), "x", parse("0"), 2);
    expect(toString(shiftedRoot.coefficients["0"]!)).toBe("2");
    expect(toString(shiftedRoot.coefficients["1"]!)).toBe("1/4");
  });

  it("rejects fractional-power expansions that need fractional exponents", () => {
    expect(() => taylorSeries(parse("sqrt(x)"), "x", parse("0"), 4)).toThrow(/fractional powers|Taylor\/Laurent/);
    expect(() => series(parse("sqrt(1/x)"), "x", parse("0"), 4)).toThrow(/pole|fractional/);
    expect(() => series(parse("exp(1/x)"), "x", parse("0"), 4)).toThrow(/pole|Laurent/);
    expect(() => series(parse("abs(x)"), "x", parse("0"), 4)).toThrow(/nonzero/);
  });

  it("uses Laurent leading terms to classify poles", () => {
    const result = limit(parse("(1 + x)/x^3"), "x", parse("0"), "left");
    expect(result.status).toBe("negative-infinity");
  });

  it("uses local series when repeated L'Hopital steps reach their cap", () => {
    const expression = "(sin(x) - x + x^3/6 - x^5/120 + x^7/5040 - x^9/362880 + x^11/39916800 - x^13/6227020800 + x^15/1307674368000 - x^17/355687428096000)/x^19";
    const result = limit(parse(expression), "x", parse("0"));
    expect(result.status).toBe("finite");
    expect(toString(result.value!)).toBe("-1/121645100408832000");
    expect(result.method).toBe("taylor-series");
  });
});
