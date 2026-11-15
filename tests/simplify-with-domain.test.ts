import { describe, expect, it } from "vitest";
import { fn, parse, simplifyWithDomain, toString } from "../src/index.js";

describe("domain-aware simplification", () => {
  it("keeps excluded denominator values after exact rational cancellation", () => {
    const result = simplifyWithDomain(parse("(x^2 - 1)/(x - 1)"));

    expect(result.status).toBe("complete");
    expect(toString(result.expression!)).toBe("1 + x");
    expect(result.conditions.map(condition => [
      toString(condition.expression),
      condition.relation,
    ])).toEqual([["-1 + x", "nonzero"]]);
  });

  it("retains conditions for square roots, logarithms, and tangent", () => {
    const result = simplifyWithDomain(parse("sqrt(x) + ln(x) + tan(x)"));

    expect(result.status).toBe("complete");
    expect(result.conditions.map(condition => [
      toString(condition.expression),
      condition.relation,
    ])).toEqual(expect.arrayContaining([
      ["x", "nonnegative"],
      ["x", "positive"],
      ["cos(x)", "nonzero"],
    ]));
    expect(result.conditions).toHaveLength(3);
  });

  it("uses the real domain rules for rational powers", () => {
    const positiveRoot = simplifyWithDomain(parse("x^(1/2)"));
    const reciprocalRoot = simplifyWithDomain(parse("x^(-1/2)"));
    const oddReciprocalRoot = simplifyWithDomain(parse("x^(-1/3)"));

    expect(positiveRoot.conditions.map(condition => condition.relation)).toEqual(["nonnegative"]);
    expect(reciprocalRoot.conditions.map(condition => condition.relation)).toEqual(["positive"]);
    expect(oddReciprocalRoot.conditions.map(condition => condition.relation)).toEqual(["nonzero"]);
  });

  it("reports impossible exact numeric domains as undefined", () => {
    const result = simplifyWithDomain(parse("sqrt(-1)"));

    expect(result.status).toBe("undefined");
    expect(result.expression).toBeUndefined();
  });

  it("does not claim complete domain conditions for unknown functions", () => {
    const result = simplifyWithDomain(fn("gamma", parse("x")));

    expect(result.status).toBe("unsupported");
    expect(result.expression).toBeDefined();
    expect(result.message).toMatch(/gamma/);
  });
});
