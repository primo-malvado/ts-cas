import { describe, expect, it } from "vitest";
import {
  determinant, differentiate, equals, evaluate, parse, simplify, toString,
} from "../src/index.js";
import { parsePreservingStructure } from "../src/core/parser.js";

describe("selected mathjs algebra regression cases", () => {
  it("respects arithmetic precedence and right-associative powers", () => {
    expect(evaluate(parse("2 + 6 / 3"))).toBe(4);
    expect(toString(parse("x^2^3"))).toBe("x^8");
    expect(toString(parse("-2^2"))).toBe("-4");
  });

  it("preserves expression values when combining like terms", () => {
    const cases = [
      ["x + 1 + 2*x", { x: 7 }],
      ["x^2 + x - 3 + x^2", { x: -2 }],
      ["3 + 2/4 + 2*8", {}],
    ] as const;

    for (const [source, bindings] of cases) {
      const expression = parsePreservingStructure(source);
      expect(evaluate(simplify(expression), bindings)).toBe(evaluate(expression, bindings));
    }
  });

  it("simplifies nested powers, signed terms, and rational constants", () => {
    const cases: readonly [string, string][] = [
      ["(x^2)^3", "x^6"],
      ["x^(2+3)", "x^5"],
      ["x--x", "2*x"],
      ["3*4", "12"],
      ["3+2/4", "7/2"],
    ];

    for (const [source, expected] of cases) {
      expect(equals(
        simplify(parsePreservingStructure(source)),
        parse(expected),
      ), source).toBe(true);
    }
  });

  it("differentiates constants, unrelated symbols, and a variable power", () => {
    expect(toString(differentiate(parse("42"), "x"))).toBe("0");
    expect(toString(differentiate(parse("y"), "x"))).toBe("0");

    const derivative = differentiate(parse("x^x"), "x");
    expect(evaluate(derivative, { x: 2 })).toBeCloseTo(4 * (Math.log(2) + 1), 12);
  });

  it("computes partial derivatives of multivariable polynomials", () => {
    const derivative = differentiate(parsePreservingStructure("x^2 + x*y + y^2"), "x");
    expect(equals(derivative, parse("2*x+y"))).toBe(true);
    expect(evaluate(derivative, { x: 3, y: 4 })).toBe(10);
  });

  it.each([
    ["2^-3", 0.125],
    ["(-3)^3", -27],
    ["sqrt(25)", 5],
    ["sqrt(2)", Math.sqrt(2)],
    ["abs(-7)", 7],
  ])("evaluates supported real arithmetic: %s", (source, expected) => {
    expect(evaluate(parse(source))).toBeCloseTo(expected, 12);
  });

  it("computes exact larger and singular determinants and rejects non-square matrices", () => {
    const matrix = (rows: string[][]) => rows.map(row => row.map(parsePreservingStructure));
    expect(toString(determinant(matrix([
      ["-2", "2", "3"],
      ["-1", "1", "3"],
      ["2", "0", "-1"],
    ])))).toBe("6");
    expect(toString(determinant(matrix([
      ["1", "0"],
      ["1", "0"],
    ])))).toBe("0");
    expect(() => determinant(matrix([["1", "2", "3"], ["4", "5", "6"]]))).toThrow(/square/);
  });
});
