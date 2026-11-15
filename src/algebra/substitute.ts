import { add, fn, mul, pow, type Expr } from "../core/expr.js";

/**
 * Replace symbols in an expression with other expressions.
 * Constructors are reused so numeric and elementary structural simplifications
 * are applied while the substituted tree is rebuilt.
 */
export function substitute(
  expr: Expr,
  values: Readonly<Record<string, Expr>>,
): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
      return expr;
    case "Symbol":
      return Object.prototype.hasOwnProperty.call(values, expr.name)
        ? values[expr.name]!
        : expr;
    case "Add":
      return add(...expr.terms.map(term => substitute(term, values)));
    case "Mul":
      return mul(...expr.factors.map(factor => substitute(factor, values)));
    case "Pow":
      return pow(substitute(expr.base, values), substitute(expr.exponent, values));
    case "Function":
      return fn(expr.name, ...expr.args.map(arg => substitute(arg, values)));
  }
}
