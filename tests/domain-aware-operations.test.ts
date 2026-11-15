import { describe, expect, it } from "vitest";
import {
  add,
  differentiateWithDomain,
  analyzeContinuityWithDomain,
  combineWithDomain,
  evaluateWithDomain,
  expandWithDomain,
  factorWithDomain,
  integrateWithDomain,
  laurentSeriesWithDomain,
  limitWithDomain,
  seriesWithDomain,
  taylorSeriesWithDomain,
  parse,
  parseWithDomain,
  simplifyWithDomain,
  solvePolynomialSystemWithDomain,
  solveWithDomain,
  substituteWithDomain,
  transformWithDomain,
  toString,
} from "../src/index.js";

describe("domain-preserving expression operations", () => {
  it("carries exclusions through symbolic differentiation", () => {
    const guarded = simplifyWithDomain(parse("(x^2 - 1)/(x - 1)"));
    const derivative = differentiateWithDomain(guarded, "x");

    expect(derivative.status).toBe("complete");
    expect(toString(derivative.expression!)).toBe("1");
    expect(derivative.conditions.map(condition => [
      toString(condition.expression),
      condition.relation,
    ])).toEqual([["-1 + x", "nonzero"]]);
  });

  it("rechecks carried conditions after substitution", () => {
    const guarded = simplifyWithDomain(parse("(x^2 - 1)/(x - 1)"));
    const excluded = substituteWithDomain(guarded, { x: parse("1") });
    const allowed = substituteWithDomain(guarded, { x: parse("2") });

    expect(excluded.status).toBe("undefined");
    expect(excluded.expression).toBeUndefined();
    expect(allowed.status).toBe("complete");
    expect(toString(allowed.expression!)).toBe("3");
    expect(allowed.conditions).toEqual([]);
  });

  it("preserves restrictions when combining independently parsed expressions", () => {
    const rational = parseWithDomain("(x^2 - 1)/(x - 1)");
    const radical = parseWithDomain("sqrt(y)");
    const combined = combineWithDomain([rational, radical], ([left, right]) =>
      add(left!, right!));

    expect(combined.status).toBe("complete");
    expect(combined.conditions.map(condition => [
      toString(condition.expression),
      condition.relation,
    ])).toEqual(expect.arrayContaining([
      ["-1 + x", "nonzero"],
      ["y", "nonnegative"],
    ]));
  });

  it("checks carried restrictions during numeric evaluation", () => {
    const guarded = parseWithDomain("(x^2 - 1)/(x - 1)");
    const excluded = evaluateWithDomain(guarded, { x: 1 });
    const allowed = evaluateWithDomain(guarded, { x: 2 });
    const tangentPole = evaluateWithDomain(parseWithDomain("tan(x)"), { x: Math.PI / 2 });
    const unknown = evaluateWithDomain(parseWithDomain("(y^2 - 1)/(y - 1)"));

    expect(excluded.status).toBe("undefined");
    expect(excluded.value).toBeUndefined();
    expect(allowed.status).toBe("complete");
    expect(allowed.value).toBe(3);
    expect(tangentPole.status).toBe("partial");
    expect(unknown.status).toBe("partial");
  });

  it("retains domain context through limits and local series", () => {
    const guarded = parseWithDomain("(x^2 - 1)/(x - 1)");
    const localLimit = limitWithDomain(guarded, "x", parse("1"));
    const localSeries = seriesWithDomain(guarded, "x", parse("1"));
    const taylor = taylorSeriesWithDomain(guarded, "x", parse("1"));
    const laurent = laurentSeriesWithDomain(parseWithDomain("1/x"), "x", parse("0"));

    expect(localLimit.status).toBe("partial");
    expect(localLimit.limit?.status).toBe("finite");
    expect(toString(localLimit.limit?.value!)).toBe("2");
    expect(localLimit.pointDomain).toBe("undefined");
    expect(localLimit.conditions).toHaveLength(1);
    expect(localSeries.series?.kind).toBe("taylor");
    expect(localSeries.status).toBe("partial");
    expect(localSeries.pointDomain).toBe("undefined");
    expect(taylor.pointDomain).toBe("undefined");
    expect(laurent.series?.kind).toBe("laurent");
    expect(laurent.status).toBe("partial");
    expect(laurent.pointDomain).toBe("undefined");
  });

  it("does not claim continuity after a prior simplification hid a restriction", () => {
    const guarded = parseWithDomain("(x^2 - 1)/(x - 1)");
    const result = analyzeContinuityWithDomain(guarded, "x", parse("1"));

    expect(result.status).toBe("partial");
    expect(result.pointDomain).toBe("undefined");
    expect(result.analysis?.classification).toBe("undetermined");
    expect(result.conditions).toHaveLength(1);
  });

  it("carries exclusions through expansion, factorization, integration, and custom transforms", () => {
    const guarded = simplifyWithDomain(parse("(x^2 - 1)/(x - 1)"));
    const operations = [
      expandWithDomain(guarded),
      factorWithDomain(guarded, "x"),
      integrateWithDomain(guarded, "x"),
      transformWithDomain(guarded, expression => expression),
    ];

    for (const result of operations) {
      expect(result.status).toBe("complete");
      expect(result.conditions.map(condition => [
        toString(condition.expression),
        condition.relation,
      ])).toEqual([["-1 + x", "nonzero"]]);
    }
  });

  it("filters equation roots that violate the original expression domain", () => {
    const parsed = parseWithDomain("((x - 1)^2)/(x - 1)");
    const result = solveWithDomain(parsed, "x");
    const allowed = solveWithDomain(
      parseWithDomain("((x^2 - 1)/(x - 1)) - 3"),
      "x",
    );

    expect(result.status).toBe("complete");
    expect(result.solutions).toEqual([]);
    expect(result.excludedSolutions.map(toString)).toEqual(["1"]);
    expect(allowed.status).toBe("complete");
    expect(allowed.solutions.map(toString)).toEqual(["2"]);
  });

  it("filters finite polynomial-system points against each equation's domain", () => {
    const restricted = (right: string) => solvePolynomialSystemWithDomain([
      {
        left: parseWithDomain("(x^2 - 1)/(x - 1)"),
        right: parseWithDomain(right),
      },
      { left: parseWithDomain("x^2 + y^2"), right: parseWithDomain("5") },
    ], ["x", "y"]);

    const excluded = restricted("2");
    const allowed = restricted("3");

    expect(excluded.status).toBe("complete");
    expect(excluded.solutions).toEqual([]);
    expect(excluded.excludedSolutions).toHaveLength(2);
    expect(excluded.excludedSolutions[0]!.x).toEqual(parse("1"));
    expect(allowed.status).toBe("complete");
    expect(allowed.solutions).toHaveLength(2);
    expect(allowed.solutions[0]!.x).toEqual(parse("2"));
  });
});
