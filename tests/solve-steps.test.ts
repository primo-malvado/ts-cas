import { describe, expect, it } from "vitest";
import {
  parse,
  solveWithCertificates,
  solveWithSteps,
  toString,
  verifyEquationSolveExplanation,
  verifyPolynomialRootCertificate,
} from "../src/index.js";

describe("explainable equation solving", () => {
  it("explains linear equations with exact coefficient data", () => {
    const result = solveWithSteps(parse("2*x - 6"), "x");

    expect(result.result.solutions.map(toString)).toEqual(["3"]);
    expect(verifyEquationSolveExplanation(parse("2*x - 6"), "x", result).valid).toBe(true);
    expect(result.steps.map(step => step.rule)).toEqual([
      "normalize-to-zero",
      "classify-polynomial-degree",
      "linear-formula",
    ]);
    expect(result.steps[2]!.solutions?.map(toString)).toEqual(["3"]);
  });

  it("exposes the discriminant and exact quadratic solutions", () => {
    const result = solveWithSteps(parse("x^2 - 5*x + 6"), "x");
    const discriminant = result.steps.find(step => step.rule === "quadratic-discriminant");

    expect(toString(discriminant!.expression!)).toBe("1");
    expect(result.steps.find(step => step.rule === "quadratic-formula")?.solutions?.map(toString))
      .toEqual(["3", "2"]);
  });

  it("reports factorization steps and partial solver status for higher degrees", () => {
    const result = solveWithSteps(parse("(x - 1)*(x^3 + x + 1)"), "x");

    expect(result.result.status).toBe("partial");
    expect(result.steps.find(step => step.rule === "factor-over-rationals")?.factors?.length)
      .toBeGreaterThan(0);
    expect(result.steps.at(-1)?.status).toBe("partial");
  });

  it("provides certified real roots when no closed-form symbolic result is available", () => {
    const result = solveWithCertificates(parse("x^3 - x - 1"), "x");

    expect(result.exact.status).toBe("unsupported");
    expect(result.realRoots.status).toBe("complete");
    if (!("certificate" in result.realRoots)) throw new Error("Expected a complete real-root certificate.");
    expect(result.realRoots.certificate.roots).toHaveLength(1);
    expect(verifyPolynomialRootCertificate(result.realRoots.certificate, parse("x^3 - x - 1")).valid)
      .toBe(true);
  });

  it("rejects a tampered exact solution in a solver explanation", () => {
    const expression = parse("x^2 - 5*x + 6");
    const result = solveWithSteps(expression, "x");
    const altered = {
      ...result,
      result: { ...result.result, solutions: [parse("100")] },
    };

    expect(verifyEquationSolveExplanation(expression, "x", altered).valid).toBe(false);
  });
});
