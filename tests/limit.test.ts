import { describe, expect, it } from "vitest";
import { limit, parse, toString } from "../src/index.js";

function finiteLimit(expression: string, point: string, direction: "both" | "left" | "right" = "both") {
  return limit(parse(expression), "x", parse(point), direction);
}

describe("symbolic limits", () => {
  it("evaluates ordinary limits by exact substitution", () => {
    const result = finiteLimit("x^2 + 2*x + 1", "2");
    expect(result.status).toBe("finite");
    expect(toString(result.value!)).toBe("9");
    expect(result.method).toBe("direct-substitution");
  });

  it("uses L'Hopital for 0/0 quotients", () => {
    const result = finiteLimit("sin(x)/x", "0");
    expect(result.status).toBe("finite");
    expect(toString(result.value!)).toBe("1");
    expect(result.method).toBe("l-hopital");
    expect(result.lHopitalSteps).toBe(1);
  });

  it("applies L'Hopital repeatedly", () => {
    const result = finiteLimit("(1 - cos(x))/x^2", "0");
    expect(result.status).toBe("finite");
    expect(toString(result.value!)).toBe("1/2");
    expect(result.method).toBe("l-hopital");
    expect(result.lHopitalSteps).toBeGreaterThanOrEqual(2);
  });

  it("cancels removable singularities without losing the limit", () => {
    const result = finiteLimit("(x^2 - 1)/(x - 1)", "1");
    expect(result.status).toBe("finite");
    expect(toString(result.value!)).toBe("2");
  });

  it("classifies simple poles using one-sided limits", () => {
    expect(finiteLimit("1/x", "0", "right").status).toBe("positive-infinity");
    expect(finiteLimit("1/x", "0", "left").status).toBe("negative-infinity");
    expect(finiteLimit("1/x", "0", "both").status).toBe("does-not-exist");
    expect(finiteLimit("1/x^2", "0", "both").status).toBe("positive-infinity");
    expect(finiteLimit("abs(x)/x", "0", "right").value && toString(finiteLimit("abs(x)/x", "0", "right").value!)).toBe("1");
    expect(finiteLimit("abs(x)/x", "0", "left").value && toString(finiteLimit("abs(x)/x", "0", "left").value!)).toBe("-1");
    expect(finiteLimit("abs(x)/x", "0", "both").status).toBe("does-not-exist");
  });

  it("handles logarithm and square-root domain edges", () => {
    expect(finiteLimit("log(x)", "0", "right").status).toBe("negative-infinity");
    expect(finiteLimit("log(abs(x))", "0").status).toBe("negative-infinity");
    expect(finiteLimit("sqrt(x)", "0", "right").value && toString(finiteLimit("sqrt(x)", "0", "right").value!)).toBe("0");
    expect(finiteLimit("sqrt(x)", "0", "both").status).toBe("does-not-exist");
  });

  it("handles rational-function limits at positive and negative infinity", () => {
    const zero = limit(parse("(2*x + 1)/(x^2 + 3)"), "x", "infinity");
    expect(zero.status).toBe("finite");
    expect(toString(zero.value!)).toBe("0");

    const ratio = limit(parse("(3*x^2 + 1)/(2*x^2 - x)"), "x", "infinity");
    expect(ratio.status).toBe("finite");
    expect(toString(ratio.value!)).toBe("3/2");

    expect(limit(parse("x^3"), "x", "infinity").status).toBe("positive-infinity");
    expect(limit(parse("x^3"), "x", "-infinity").status).toBe("negative-infinity");
  });

  it("handles common elementary limits at infinity", () => {
    expect(limit(parse("exp(x)"), "x", "infinity").status).toBe("positive-infinity");
    expect(limit(parse("exp(-x)"), "x", "infinity").value && toString(limit(parse("exp(-x)"), "x", "infinity").value!)).toBe("0");
    expect(limit(parse("atan(x)"), "x", "infinity").value && toString(limit(parse("atan(x)"), "x", "infinity").value!)).toBe("1/2*pi");
    expect(limit(parse("log(1/x)"), "x", "infinity").status).toBe("negative-infinity");
    expect(limit(parse("exp(x)/x"), "x", "infinity").status).toBe("positive-infinity");
    const vanishing = limit(parse("x/exp(x)"), "x", "infinity");
    expect(vanishing.status).toBe("finite");
    expect(toString(vanishing.value!)).toBe("0");
  });

  it("resolves common zero-times-infinity forms using asymptotic dominance", () => {
    expect(finiteLimit("x*log(x)", "0", "right").value && toString(finiteLimit("x*log(x)", "0", "right").value!)).toBe("0");
    expect(finiteLimit("sqrt(x)*log(x)", "0", "right").value && toString(finiteLimit("sqrt(x)*log(x)", "0", "right").value!)).toBe("0");
    expect(finiteLimit("x^2*log(x)", "0", "right").value && toString(finiteLimit("x^2*log(x)", "0", "right").value!)).toBe("0");

    const decaying = limit(parse("x*exp(-x)"), "x", "infinity");
    expect(decaying.status).toBe("finite");
    expect(toString(decaying.value!)).toBe("0");

    expect(finiteLimit("x*exp(1/x)", "0", "right").status).toBe("positive-infinity");
    expect(toString(finiteLimit("x*exp(1/x)", "0", "left").value!)).toBe("0");
  });

  it("uses the squeeze theorem for a vanishing factor times bounded oscillation", () => {
    const result = finiteLimit("x*sin(1/x)", "0", "right");
    expect(result.status).toBe("finite");
    expect(toString(result.value!)).toBe("0");
  });

  it("reduces infinity-minus-infinity forms with exact rewrites", () => {
    const radical = limit(parse("sqrt(x^2 + 1) - x"), "x", "infinity");
    expect(radical.status).toBe("finite");
    expect(toString(radical.value!)).toBe("0");

    const negativeInfinity = limit(parse("sqrt(x^2 + 1) + x"), "x", "-infinity");
    expect(negativeInfinity.status).toBe("finite");
    expect(toString(negativeInfinity.value!)).toBe("0");

    const rational = limit(parse("x - x^2/(x + 1)"), "x", "infinity");
    expect(rational.status).toBe("finite");
    expect(toString(rational.value!)).toBe("1");

    expect(limit(parse("exp(x) - exp(x - 1)"), "x", "infinity").status).toBe("positive-infinity");
    expect(limit(parse("exp(x) - exp(2*x)"), "x", "infinity").status).toBe("negative-infinity");
  });

  it("evaluates integer powers of divergent functions and preserves rational-power domains", () => {
    expect(limit(parse("log(x)^2"), "x", parse("0"), "right").status).toBe("positive-infinity");
    const positive = finiteLimit("x^(1/2)", "0", "right");
    expect(positive.status).toBe("finite");
    expect(toString(positive.value!)).toBe("0");
    expect(finiteLimit("x^(1/2)", "0", "both").status).toBe("does-not-exist");
    expect(finiteLimit("x^(1/2)", "0", "left").status).toBe("does-not-exist");

    const absoluteRoot = finiteLimit("(x^2)^(1/2)", "0");
    expect(absoluteRoot.status).toBe("finite");
    expect(toString(absoluteRoot.value!)).toBe("0");
  });


  it("compares polynomial, logarithmic and exponential growth", () => {
    const polynomialDominatesLog = limit(parse("x - log(x)"), "x", "infinity");
    expect(polynomialDominatesLog.status).toBe("positive-infinity");

    const exponentialDominatesPolynomial = limit(parse("x^2 - exp(x)"), "x", "infinity");
    expect(exponentialDominatesPolynomial.status).toBe("negative-infinity");

    const polynomialOverLog = limit(parse("x^2/log(x)"), "x", "infinity");
    expect(polynomialOverLog.status).toBe("positive-infinity");

    const logOverPolynomial = limit(parse("log(x)/x"), "x", "infinity");
    expect(logOverPolynomial.status).toBe("finite");
    expect(toString(logOverPolynomial.value!)).toBe("0");

    const exponentialOverPolynomial = limit(parse("exp(x)/x^5"), "x", "infinity");
    expect(exponentialOverPolynomial.status).toBe("positive-infinity");

    const polynomialOverExponential = limit(parse("x^5/exp(x)"), "x", "infinity");
    expect(polynomialOverExponential.status).toBe("finite");
    expect(toString(polynomialOverExponential.value!)).toBe("0");

    const growingExponentialRatio = limit(parse("exp(x^2)/exp(x^3)"), "x", "infinity");
    expect(growingExponentialRatio.status).toBe("finite");
    expect(toString(growingExponentialRatio.value!)).toBe("0");

    const logRatio = limit(parse("log(x^2 + 1)/log(x)"), "x", "infinity");
    expect(logRatio.status).toBe("finite");
    expect(toString(logRatio.value!)).toBe("2");

    const rationalLogRatio = limit(parse("log(x^(1/3))/log(x)"), "x", "infinity");
    expect(rationalLogRatio.status).toBe("finite");
    expect(toString(rationalLogRatio.value!)).toBe("1/3");
  });

  it("uses dominant growth despite bounded oscillatory summands", () => {
    const result = limit(parse("x + sin(x)"), "x", "infinity");
    expect(result.status).toBe("positive-infinity");
    expect(result.method).toBe("asymptotic-dominance");
  });

  it("handles mixed polynomial-log-exponential products and both infinity directions", () => {
    expect(limit(parse("x^2*exp(-x^2)"), "x", "infinity").value && toString(limit(parse("x^2*exp(-x^2)"), "x", "infinity").value!)).toBe("0");
    expect(limit(parse("x - log(-x)"), "x", "-infinity").status).toBe("negative-infinity");
    expect(limit(parse("sqrt(x^2 + 1)/x"), "x", "-infinity").value && toString(limit(parse("sqrt(x^2 + 1)/x"), "x", "-infinity").value!)).toBe("-1");
    expect(toString(limit(parse("sqrt(4*x^2 + 1)/x"), "x", "infinity").value!)).toBe("2");
  });

  it("classifies negative rational powers at zero without returning undefined symbolic values", () => {
    expect(finiteLimit("x^(-1/2)", "0", "right").status).toBe("positive-infinity");
    expect(finiteLimit("1/sqrt(x)", "0", "right").status).toBe("positive-infinity");
    expect(finiteLimit("1/(x^(1/2))", "0", "right").status).toBe("positive-infinity");
    expect(finiteLimit("x^(-1/2)", "0", "left").status).toBe("does-not-exist");
    expect(finiteLimit("x^(-2)", "0", "left").status).toBe("positive-infinity");
    expect(finiteLimit("x^(-2)", "0", "both").status).toBe("positive-infinity");
    expect(finiteLimit("x^(-1)", "0", "both").status).toBe("does-not-exist");
  });

  it("reports unsupported cases instead of inventing a result", () => {
    const result = limit(parse("sin(x)"), "x", "infinity");
    expect(result.status).toBe("does-not-exist");
  });
});
