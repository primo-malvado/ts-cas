import { describe, expect, it } from "vitest";
import { differentiate, evaluate, expand, parse } from "../src/index.js";

describe("deterministic algebra invariants", () => {
  it("preserves polynomial values when expanding across representative inputs", () => {
    const expressions = [
      "(x + 1)^3",
      "(2*x - 3)^4",
      "(x^2 - 1)*(x + 2)",
      "(x - 1)*(x + 1)*(x^2 + 1)",
    ];

    for (const source of expressions) {
      const expression = parse(source);
      const expanded = expand(expression);
      for (const x of [-3, -1, 0, 2, 4]) {
        expect(evaluate(expanded, { x })).toBeCloseTo(evaluate(expression, { x }), 12);
      }
    }
  });

  it("preserves values and derivative checks for a deterministic generated polynomial set", () => {
    let seed = 0x5eed1234;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };

    for (let sample = 0; sample < 24; sample++) {
      const degree = 1 + next() % 5;
      const terms = Array.from({ length: degree + 1 }, (_, exponent) => {
        const coefficient = Number(next() % 7) - 3;
        return coefficient === 0
          ? null
          : `(${coefficient})*x^${exponent}`;
      }).filter((term): term is string => term !== null);
      if (terms.length === 0) terms.push("1");
      const expression = parse(terms.join(" + "));
      const expanded = expand(expression);
      const derivative = differentiate(expression, "x");

      for (const x of [-2, -1, 0, 1, 2]) {
        expect(evaluate(expanded, { x })).toBeCloseTo(evaluate(expression, { x }), 10);
        const step = 1e-5;
        const finiteDifference = (
          evaluate(expression, { x: x + step }) - evaluate(expression, { x: x - step })
        ) / (2 * step);
        expect(evaluate(derivative, { x })).toBeCloseTo(finiteDifference, 5);
      }
    }
  });
});
