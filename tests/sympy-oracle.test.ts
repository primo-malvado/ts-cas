import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  differentiate,
  evaluate,
  factor,
  integrate,
  parse,
  simplify,
  solve,
  solvePolynomialSystem,
  toString,
} from "../src/index.js";

interface OracleCorpus {
  readonly oracle: { readonly name: string; readonly version: string };
  readonly cases: readonly Record<string, unknown>[];
}

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/sympy-cas-corpus.json", import.meta.url), "utf8"),
) as OracleCorpus;

function assertNumericallyEquivalent(actual: string, expected: string, variable: string): void {
  const actualExpression = parse(actual);
  const expectedExpression = parse(expected);
  for (const point of [-1.25, 0.25, 1.5, 2.75]) {
    const bindings = { [variable]: point };
    const actualValue = evaluate(actualExpression, bindings);
    const expectedValue = evaluate(expectedExpression, bindings);
    expect(actualValue).toBeCloseTo(expectedValue, 9);
  }
}

describe(`frozen ${corpus.oracle.name} ${corpus.oracle.version} oracle corpus`, () => {
  for (const testCase of corpus.cases) {
    it(`matches ${String(testCase.operation)} reference result`, () => {
      const operation = testCase.operation;
      if (operation === "differentiate" || operation === "factor" ||
          operation === "integrate" || operation === "simplify") {
        const expression = parse(String(testCase.expression));
        const variable = String(testCase.variable ?? "x");
        const expected = String(testCase.expected);
        const actual = operation === "differentiate"
          ? differentiate(expression, variable)
          : operation === "factor"
            ? factor(expression, variable)
            : operation === "integrate"
              ? differentiate(integrate(expression, variable), variable)
              : simplify(expression);
        const reference = operation === "integrate"
          ? differentiate(parse(expected), variable)
          : parse(expected);
        assertNumericallyEquivalent(toString(actual), toString(reference), variable);
        return;
      }

      if (operation === "solve") {
        const result = solve(parse(String(testCase.expression)), String(testCase.variable));
        expect(result.status).toBe("finite");
        if (result.status !== "finite") return;
        const expected = (testCase.expected as string[]).map(value => evaluate(parse(value), {})).sort((a, b) => a - b);
        const actual = result.solutions.map(solution => evaluate(solution, {})).sort((a, b) => a - b);
        expect(actual).toHaveLength(expected.length);
        actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
        return;
      }

      if (operation === "solve-system") {
        const variables = testCase.variables as string[];
        const equations = (testCase.equations as string[][]).map(([left, right]) => ({
          left: parse(left!),
          right: parse(right!),
        }));
        const result = solvePolynomialSystem(equations, variables);
        expect(result.status).toBe("finite");
        if (result.status !== "finite") return;
        const expected = testCase.expected as Record<string, string>[];
        expect(result.solutions).toHaveLength(expected.length);
        for (const solution of result.solutions) {
          expect(expected.some(candidate =>
            variables.every(variable =>
              Math.abs(evaluate(solution[variable]!, {}) - Number(candidate[variable])) < 1e-9),
          )).toBe(true);
        }
        return;
      }

      throw new Error(`Unknown oracle operation: ${String(operation)}`);
    });
  }
});
