import { describe, expect, it } from "vitest";
import { parse, solvePolynomialSystem, toString, type PolynomialEquation } from "../src/index.js";

const equation = (left: string, right: string): PolynomialEquation => ({
  left: parse(left),
  right: parse(right),
});

describe("exact two-variable polynomial systems", () => {
  it("solves a quadratic system with two rational solution points", () => {
    const result = solvePolynomialSystem(
      [equation("x + y", "3"), equation("x^2 + y^2", "5")],
      ["x", "y"],
    );

    expect(result.status).toBe("finite");
    const pairs = result.solutions.map(solution => `${toString(solution.x!)}:${toString(solution.y!)}`);
    expect(pairs).toEqual(expect.arrayContaining(["2:1", "1:2"]));
    expect(result.solutions).toHaveLength(2);
  });

  it("returns an exact radical family of solution points when roots are irrational", () => {
    const result = solvePolynomialSystem(
      [equation("x + y", "0"), equation("x^2 + y^2", "1")],
      ["x", "y"],
    );

    expect(result.status).toBe("finite");
    expect(result.solutions).toHaveLength(2);
    expect(result.solutions.every(solution =>
      toString(solution.x!).includes("sqrt") && toString(solution.y!).includes("sqrt")
    )).toBe(true);
  });

  it("reports no common solution", () => {
    const result = solvePolynomialSystem(
      [equation("x + y", "0"), equation("(x + y)^2", "1")],
      ["x", "y"],
    );
    expect(result.status).toBe("none");
  });

  it("delegates fully linear systems to Gaussian elimination", () => {
    const result = solvePolynomialSystem(
      [equation("2*x + y", "5"), equation("x - y", "1")],
      ["x", "y"],
    );
    expect(result.status).toBe("finite");
    expect(toString(result.solutions[0]!.x!)).toBe("2");
    expect(toString(result.solutions[0]!.y!)).toBe("1");
  });

  it("represents redundant equations as a parametric family", () => {
    const result = solvePolynomialSystem(
      [equation("x + y", "3"), equation("(x + y)^2", "9")],
      ["x", "y"],
    );
    expect(result.status).toBe("infinite");
    expect(result.parameters).toEqual(["t1"]);
    expect(toString(result.solutions[0]!.x!)).toBe("t1");
    expect(toString(result.solutions[0]!.y!)).toBe("3 - 1*t1");
  });

  it("declines systems with two nonlinear equations or unsupported arity", () => {
    expect(solvePolynomialSystem(
      [equation("x^2 + y^2", "5"), equation("x*y", "2")],
      ["x", "y"],
    ).status).toBe("unsupported");
    expect(solvePolynomialSystem([equation("x + y", "3")], ["x", "y"]).status).toBe("unsupported");
  });
});
