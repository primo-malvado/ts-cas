import { add, integer, mul, type Expr } from "../core/expr.js";
import { simplify } from "./simplify.js";

/**
 * Extracts coefficients of a polynomial in one chosen variable.
 * Coefficients may themselves be symbolic expressions in other variables.
 * The returned array is indexed by exponent: result[0] is the constant term.
 */
export function polynomialCoefficientsIn(expr: Expr, variable: string): Expr[] {
  const coefficients = collect(expr, variable);
  const degree = Math.max(0, ...coefficients.keys());
  return Array.from({ length: degree + 1 }, (_, exponent) =>
    simplify(coefficients.get(exponent) ?? integer(0))
  );
}

function collect(expr: Expr, variable: string): Map<number, Expr> {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return new Map([[0, expr]]);
    case "Symbol":
      return expr.name === variable
        ? new Map([[1, integer(1)]])
        : new Map([[0, expr]]);
    case "Function":
      throw new TypeError(`Cannot extract polynomial coefficients: function '${expr.name}' is not polynomial.`);
    case "Add": {
      const result = new Map<number, Expr>();
      for (const term of expr.terms) {
        for (const [exponent, coefficient] of collect(term, variable)) {
          result.set(exponent, simplify(add(result.get(exponent) ?? integer(0), coefficient)));
        }
      }
      return result;
    }
    case "Mul": {
      let result = new Map<number, Expr>([[0, integer(1)]]);
      for (const factor of expr.factors) result = multiply(result, collect(factor, variable));
      return result;
    }
    case "Pow": {
      if (expr.exponent.kind !== "Integer" || expr.exponent.value < 0n || expr.exponent.value > 1000n) {
        throw new TypeError("Polynomial coefficient extraction requires a non-negative integer exponent.");
      }
      let result = new Map<number, Expr>([[0, integer(1)]]);
      const base = collect(expr.base, variable);
      for (let i = 0n; i < expr.exponent.value; i++) result = multiply(result, base);
      return result;
    }
  }
}

function multiply(left: Map<number, Expr>, right: Map<number, Expr>): Map<number, Expr> {
  const result = new Map<number, Expr>();
  for (const [leftExponent, leftCoefficient] of left) {
    for (const [rightExponent, rightCoefficient] of right) {
      const exponent = leftExponent + rightExponent;
      const term = simplify(mul(leftCoefficient, rightCoefficient));
      result.set(exponent, simplify(add(result.get(exponent) ?? integer(0), term)));
    }
  }
  return result;
}
