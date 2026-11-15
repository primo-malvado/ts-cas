import { describe, expect, it } from "vitest";
import { parse, solveLinearSystem, type LinearEquation, toString } from "../src/index.js";

describe("linear systems", () => {
  it("solves a system with a unique exact solution", () => {
    const equations: LinearEquation[] = [
      { left: parse("2*x + y"), right: parse("5") },
      { left: parse("x - y"), right: parse("1") },
    ];
    const result = solveLinearSystem(equations, ["x", "y"]);
    expect(result.status).toBe("unique");
    expect(toString(result.solutions!.x!)).toBe("2");
    expect(toString(result.solutions!.y!)).toBe("1");
  });

  it("detects inconsistent systems", () => {
    const equations: LinearEquation[] = [
      { left: parse("x + y"), right: parse("2") },
      { left: parse("x + y"), right: parse("3") },
    ];
    expect(solveLinearSystem(equations, ["x", "y"]).status).toBe("none");
  });

  it("returns parameterized solutions for underdetermined systems", () => {
    const equations: LinearEquation[] = [
      { left: parse("x + y"), right: parse("2") },
    ];
    const result = solveLinearSystem(equations, ["x", "y"]);
    expect(result.status).toBe("infinite");
    expect(result.parameters).toEqual(["t1"]);
    expect(toString(result.solutions!.y!)).toBe("t1");
    expect(toString(result.solutions!.x!)).toContain("t1");
    expect(toString(result.solutions!.x!)).toContain("2");
  });

  it("parameterizes systems with no equations and avoids variable-name collisions", () => {
    const result = solveLinearSystem([], ["t1", "y"]);
    expect(result.status).toBe("infinite");
    expect(result.parameters).toEqual(["t2", "t3"]);
    expect(toString(result.solutions!.t1!)).toBe("t2");
    expect(toString(result.solutions!.y!)).toBe("t3");
  });

  it("rejects nonlinear equations", () => {
    const equations: LinearEquation[] = [
      { left: parse("x*y"), right: parse("1") },
    ];
    expect(solveLinearSystem(equations, ["x", "y"]).status).toBe("unsupported");
  });
});
