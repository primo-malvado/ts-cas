import { describe, expect, it } from "vitest";
import {
  evaluate, evaluateComplex, parse, solve, solveEquation, solveWithDomain, solveWithSteps,
  toString, verifyEquationSolveExplanation,
} from "../src/index.js";

describe("symbolic equation solving", () => {
  it("solves linear equations exactly", () => {
    const result = solve(parse("2*x - 6"), "x");
    expect(result.status).toBe("finite");
    expect(result.solutions.map(toString)).toEqual(["3"]);
  });

  it("solves quadratic equations with rational roots", () => {
    const result = solve(parse("x^2 - 5*x + 6"), "x");
    expect(result.status).toBe("finite");
    expect(result.solutions.map(toString)).toEqual(["3", "2"]);
  });

  it("returns one root for a repeated root", () => {
    const result = solve(parse("x^2 - 4*x + 4"), "x");
    expect(result.status).toBe("finite");
    expect(result.solutions.map(toString)).toEqual(["2"]);
  });

  it("keeps irrational roots symbolic", () => {
    const result = solve(parse("x^2 - 2"), "x");
    expect(result.status).toBe("finite");
    expect(result.solutions).toHaveLength(2);
    expect(result.solutions.every(root => toString(root).includes("sqrt"))).toBe(true);
  });

  it("solves a quadratic involving pi with exact roots and a verifiable explanation", () => {
    const expression = parse("x^2 - pi");
    const explanation = solveWithSteps(expression, "x");
    expect(explanation.result.status).toBe("finite");
    expect(explanation.result.solutions.map(toString)).toEqual(["sqrt(pi)", "sqrt(pi)*-1"]);
    expect(explanation.steps.map(step => step.rule)).toEqual([
      "normalize-to-zero", "classify-polynomial-degree", "quadratic-discriminant", "quadratic-formula",
    ]);
    expect(verifyEquationSolveExplanation(expression, "x", explanation).valid).toBe(true);
    expect(solveEquation(parse("x^2"), parse("pi"), "x").solutions.map(toString))
      .toEqual(explanation.result.solutions.map(toString));
  });

  it.each([
    ["2*x^2 - 2*x - pi", 2],
    ["x^2 + pi", 2],
    ["x^2 - E", 2],
    ["2*x - pi", 1],
  ])("solves supported constant coefficients in %s", (source, count) => {
    const expression = parse(source);
    const explanation = solveWithSteps(expression, "x");
    expect(explanation.result.status).toBe("finite");
    expect(explanation.result.solutions).toHaveLength(count);
    expect(verifyEquationSolveExplanation(expression, "x", explanation).valid).toBe(true);
    for (const root of explanation.result.solutions) {
      const value = evaluateComplex(parse(toString(root)));
      const residual = evaluateComplex(expression, { x: value });
      expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-10);
    }
  });

  it("solves a quadratic in x with y as a symbolic parameter", () => {
    const expression = parse("x^2 - y");
    const explanation = solveWithSteps(expression, "x");
    expect(explanation.result.status).toBe("finite");
    expect(explanation.result.solutions.map(toString)).toEqual(["sqrt(y)", "sqrt(y)*-1"]);
    expect(verifyEquationSolveExplanation(expression, "x", explanation).valid).toBe(true);
    for (const y of [0, 4, -4]) {
      for (const root of explanation.result.solutions) {
        const x = evaluateComplex(root, { y });
        const residual = evaluateComplex(expression, { x, y });
        expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-10);
      }
    }
    expect(solveEquation(parse("x^2"), parse("y"), "x").solutions.map(toString))
      .toEqual(explanation.result.solutions.map(toString));
  });

  it.each(["2*x - y", "2*x^2 - 2*x - y*z"])(
    "solves supported parameterized equations: %s", source => {
      const expression = parse(source);
      const explanation = solveWithSteps(expression, "x");
      expect(explanation.result.status).toBe("finite");
      expect(verifyEquationSolveExplanation(expression, "x", explanation).valid).toBe(true);
      for (const root of explanation.result.solutions) {
        const x = evaluateComplex(parse(toString(root)), { y: 3, z: 2 });
        const residual = evaluateComplex(expression, { x, y: 3, z: 2 });
        expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-10);
      }
    },
  );

  it("keeps unsupported symbolic coefficients and higher degrees explicit", () => {
    for (const source of ["pi*x^2 - 1", "y*x^2 - 1", "x^2 + y*x - 1", "x^3 - pi"]) {
      expect(solve(parse(source), "x").status).toBe("unsupported");
    }
    const domain = solveWithDomain(parse("x^2 + pi"), "x");
    expect(domain.status).toBe("unsupported");
    expect(domain.solutions).toEqual([]);
    expect(domain.undeterminedSolutions).toHaveLength(2);
    const parameterDomain = solveWithDomain(parse("x^2 - y"), "x");
    expect(parameterDomain.status).toBe("unsupported");
    expect(parameterDomain.solutions).toEqual([]);
    expect(parameterDomain.undeterminedSolutions).toHaveLength(2);
  });

  it("solves x^sqrt(2) = 2 on the principal branch", () => {
    const expression = parse("x^sqrt(2) - 2");
    const explanation = solveWithSteps(expression, "x");
    expect(explanation.result.status).toBe("finite");
    expect(explanation.result.method).toBe("principal-power");
    expect(explanation.result.solutions.map(toString)).toEqual(["2^(sqrt(2)*1/2)"]);
    expect(explanation.steps.at(-1)?.rule).toBe("principal-power-inversion");
    expect(verifyEquationSolveExplanation(expression, "x", explanation)).toEqual({
      valid: false,
      errors: ["Independent verification of principal-power solutions is not supported."],
    });
    const root = evaluate(parse(toString(explanation.result.solutions[0]!)));
    expect(root).toBeCloseTo(2 ** (1 / Math.sqrt(2)), 12);
    expect(evaluate(expression, { x: root })).toBeCloseTo(0, 12);
    expect(solveEquation(parse("x^sqrt(2)"), parse("2"), "x").solutions.map(toString))
      .toEqual(explanation.result.solutions.map(toString));
    const domain = solveWithDomain(expression, "x");
    expect(domain.status).toBe("partial");
    expect(domain.solutions).toEqual([]);
    expect(domain.undeterminedSolutions).toHaveLength(1);
  });

  it.each(["2*x^sqrt(3) - 3", "-3*x^sqrt(1/2) + 6", "x^sqrt(2) - 1"])(
    "solves supported principal powers: %s", source => {
      const expression = parse(source);
      const result = solve(expression, "x");
      expect(result.status).toBe("finite");
      expect(result.solutions).toHaveLength(1);
      const root = evaluateComplex(parse(toString(result.solutions[0]!)));
      const residual = evaluateComplex(expression, { x: root });
      expect(root.re).toBeGreaterThan(0);
      expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-10);
    },
  );

  it.each([
    "x^sqrt(2) + 2",
    "x^sqrt(2)",
    "x^sqrt(0) - 2",
    "x^sqrt(4) - 2",
    "x^sqrt(5) - 2",
    "x^sqrt(y) - 2",
    "(x + 1)^sqrt(2) - 2",
  ])("leaves unhandled power branches unsupported: %s", source => {
    expect(solve(parse(source), "x").status).toBe("unsupported");
  });

  it("distinguishes no solutions from infinitely many", () => {
    expect(solve(parse("4"), "x").status).toBe("none");
    expect(solve(parse("0"), "x").status).toBe("all");
  });

  it("solves two-sided equations", () => {
    const result = solveEquation(parse("2*x + 1"), parse("7"), "x");
    expect(result.solutions.map(toString)).toEqual(["3"]);
  });

  it("solves cubic equations with rational roots", () => {
    const result = solve(parse("x^3 - 6*x^2 + 11*x - 6"), "x");
    expect(result.status).toBe("finite");
    expect(result.solutions.map(toString)).toEqual(["1", "2", "3"]);
  });

  it("solves higher-degree equations when they split into rational roots", () => {
    const result = solve(parse("x^4 - 5*x^2 + 4"), "x");
    expect(result.status).toBe("finite");
    expect(result.solutions.map(toString)).toEqual(expect.arrayContaining(["-2", "-1", "1", "2"]));
  });

  it.each([
    "x^4 + 10*x^2 + x + 1",
    "x^4 + x - 1",
    "x^4 - 6*x^2 + x - 3",
    "x^4 - 6*x^2 + 9*x - 3",
    "2*x^4 + 2*x^3 + 3*x^2 + x + 2",
    "x^4 + 1",
    "x^4 + 8*x^3 + 24*x^2 + 32*x + 17",
    "(x^4 + x + 1)^2",
  ])("returns distinct exact complex roots for %s", (source) => {
    const expression = parse(source);
    const result = solve(expression, "x");
    expect(result.status).toBe("finite");
    expect(result.method).toBe("quartic-formula");
    expect(result.solutions).toHaveLength(4);
    const roots = result.solutions.map(root => {
      const value = evaluateComplex(root);
      const residual = evaluateComplex(expression, { x: value });
      expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-8);
      const roundTrip = evaluateComplex(parse(toString(root)));
      expect(Math.hypot(value.re - roundTrip.re, value.im - roundTrip.im)).toBeLessThan(1e-8);
      return value;
    });
    roots.forEach((root, index) => {
      for (const other of roots.slice(index + 1)) {
        expect(Math.hypot(root.re - other.re, root.im - other.im)).toBeGreaterThan(1e-6);
      }
    });
  });

  it("reports a partial list when a quartic factor is solved but a cubic remains", () => {
    const result = solve(parse("(x^4+x+1)^2*(x^3+x+1)"), "x");
    expect(result.status).toBe("partial");
    expect(result.solutions).toHaveLength(4);
    expect(result.method).toBe("quartic-formula");
  });

  it("does not claim to verify or filter quartic radicals", () => {
    const expression = parse("x^4 + 10*x^2 + x + 1");
    const explanation = solveWithSteps(expression, "x");
    expect(verifyEquationSolveExplanation(expression, "x", explanation)).toEqual({
      valid: false,
      errors: ["Independent verification of quartic radical solutions is not supported."],
    });
    const domainResult = solveWithDomain(expression, "x");
    expect(domainResult.status).toBe("unsupported");
    expect(domainResult.solutions).toEqual([]);
    expect(domainResult.undeterminedSolutions).toHaveLength(4);
  });

  it("reports unsupported degrees when no supported factors are found", () => {
    expect(solve(parse("x^3 + x + 1"), "x").status).toBe("unsupported");
  });

  it("marks higher-degree solutions as partial when unresolved factors remain", () => {
    const result = solve(parse("(x - 1)*(x^3 + x + 1)"), "x");
    expect(result.status).toBe("partial");
    expect(result.solutions.map(toString)).toEqual(["1"]);
    expect(result.message).toMatch(/may be incomplete/);
  });

  it("returns an integer-parametrized family for sin(x) = 1", () => {
    const result = solve(parse("sin(x) - 1"), "x");
    expect(result.status).toBe("infinite");
    expect(result.parameter).toEqual({ name: "k", domain: "integer" });
    expect(result.solutions).toHaveLength(1);
    for (const k of [-3, 0, 2]) {
      expect(Math.sin(evaluate(result.solutions[0]!, { k }))).toBeCloseTo(1, 12);
    }
  });

  it.each([
    "sin(x)",
    "sin(x) + 1",
    "cos(x) - 1",
    "cos(x) + 1",
    "cos(2*x + 1)",
    "2*sin(-3*x + 1) - 2",
  ])("solves %s using periodicity", (source) => {
    const result = solve(parse(source), "x");
    expect(result.status).toBe("infinite");
    for (const k of [-2, 0, 3]) {
      const x = evaluate(result.solutions[0]!, { k });
      expect(evaluate(parse(source), { x })).toBeCloseTo(0, 12);
    }
  });

  it("chooses a distinct integer parameter and leaves other cases unsupported", () => {
    const result = solve(parse("sin(k) - 1"), "k");
    expect(result.parameter).toEqual({ name: "n", domain: "integer" });
    expect(solve(parse("sin(x) - 1/2"), "x").status).toBe("unsupported");
    expect(solve(parse("sin(x^2) - 1"), "x").status).toBe("unsupported");
    expect(solve(parse("sin(y) - 1"), "x").status).toBe("unsupported");
  });

  it("reports the periodic rule in a verifiable explanation", () => {
    const expr = parse("sin(x) - 1");
    const explanation = solveWithSteps(expr, "x");
    expect(explanation.steps.at(-1)?.rule).toBe("trigonometric-periodicity");
    expect(verifyEquationSolveExplanation(expr, "x", explanation).valid).toBe(true);
    const tampered = { ...explanation, result: { ...explanation.result, parameter: { name: "n", domain: "integer" as const } } };
    expect(verifyEquationSolveExplanation(expr, "x", tampered).valid).toBe(false);
  });

  it("does not claim to filter an infinite family against domain conditions", () => {
    const result = solveWithDomain({
      status: "complete",
      expression: parse("sin(x) - 1"),
      conditions: [{ expression: parse("x"), relation: "positive" }],
    }, "x");
    expect(result.status).toBe("unsupported");
    expect(result.solutions).toEqual([]);
    expect(result.undeterminedSolutions).toHaveLength(1);
  });
});
