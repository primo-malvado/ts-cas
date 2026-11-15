import type { Expr } from "../core/expr.js";
import { add, fn, integer, isNumeric, mul, numericParts, pow } from "../core/expr.js";

function isProvablyPositive(expr: Expr): boolean {
  if (isNumeric(expr)) return numericParts(expr)[0] > 0n;
  if (expr.kind === "Symbol") return expr.name === "E" || expr.name === "pi";
  if (expr.kind === "Function") return expr.name === "exp" && expr.args.length === 1;
  if (expr.kind === "Mul") return expr.factors.every(isProvablyPositive);
  return expr.kind === "Pow" && isProvablyPositive(expr.base);
}

function halfOfDoubleAngle(argument: Expr): Expr | null {
  const factors = argument.kind === "Mul" ? argument.factors : [argument];
  let numerator = 1n;
  let denominator = 1n;
  const remainingFactors: Expr[] = [];

  for (const factor of factors) {
    if (isNumeric(factor)) {
      const [factorNumerator, factorDenominator] = numericParts(factor);
      numerator *= factorNumerator;
      denominator *= factorDenominator;
    } else {
      remainingFactors.push(factor);
    }
  }

  if (remainingFactors.length === 0 || numerator !== 2n * denominator) return null;
  return mul(...remainingFactors);
}

function multiplyExpressions(a: Expr, b: Expr): Expr {
  const left = a.kind === "Add" ? a.terms : [a];
  const right = b.kind === "Add" ? b.terms : [b];
  const terms: Expr[] = [];
  for (const x of left) for (const y of right) terms.push(mul(x, y));
  return add(...terms);
}

export function expand(expr: Expr): Expr {
  switch (expr.kind) {
    case "Integer":
    case "Rational":
    case "Symbol": return expr;
    case "Function": {
      const args = expr.args.map(expand);
      if (expr.name === "cos" && args.length === 1) {
        const halfAngle = halfOfDoubleAngle(args[0]!);
        if (halfAngle) {
          return add(
            pow(fn("cos", halfAngle), integer(2)),
            mul(integer(-1), pow(fn("sin", halfAngle), integer(2))),
          );
        }
      }
      return { ...expr, args };
    }
    case "Add": return add(...expr.terms.map(expand));
    case "Mul": {
      let result: Expr = integer(1);
      for (const factor of expr.factors) result = multiplyExpressions(result, expand(factor));
      return result;
    }
    case "Pow": {
      const base = expand(expr.base), exponent = expand(expr.exponent);
      if (exponent.kind === "Add" && isProvablyPositive(base)) {
        return mul(...exponent.terms.map(term => expand(pow(base, term))));
      }
      if (base.kind === "Mul" && exponent.kind === "Integer" && exponent.value !== 0n) {
        return mul(...base.factors.map(factor => expand(pow(factor, exponent))));
      }
      if (exponent.kind === "Integer" && exponent.value >= 0n && exponent.value <= 32n) {
        let result: Expr = integer(1);
        for (let i = 0n; i < exponent.value; i++) result = multiplyExpressions(result, base);
        return result;
      }
      return pow(base, exponent);
    }
  }
}
