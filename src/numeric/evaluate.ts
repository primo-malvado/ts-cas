import type { Expr } from "../core/expr.js";

export type NumericBindings = Readonly<Record<string, number>>;

/** Evaluate a symbolic expression in IEEE-754 double precision. Throws on unknown symbols and invalid real-domain operations. */
export function evaluate(expr: Expr, bindings: NumericBindings = {}): number {
  const result = evaluateInner(expr, bindings);
  if (Number.isNaN(result)) throw new RangeError("Expression is undefined over the real numbers at these values.");
  if (!Number.isFinite(result)) throw new RangeError("Numeric evaluation produced a non-finite result (overflow or division by zero).");
  return result;
}

function evaluateInner(expr: Expr, bindings: NumericBindings): number {
  switch (expr.kind) {
    case "Integer": return Number(expr.value);
    case "Rational": return Number(expr.numerator) / Number(expr.denominator);
    case "Symbol": {
      if (expr.name === "pi") return Math.PI;
      if (expr.name === "E") return Math.E;
      const value = bindings[expr.name];
      if (value === undefined) throw new ReferenceError(`No numeric value supplied for symbol '${expr.name}'.`);
      return value;
    }
    case "Add": return expr.terms.reduce((sum, term) => sum + evaluateInner(term, bindings), 0);
    case "Mul": return expr.factors.reduce((product, factor) => product * evaluateInner(factor, bindings), 1);
    case "Pow": {
      const base = evaluateInner(expr.base, bindings);
      const exponent = evaluateInner(expr.exponent, bindings);
      if (base === 0 && exponent < 0) throw new RangeError("Division by zero in a negative power.");
      const value = base ** exponent;
      if (Number.isNaN(value)) throw new RangeError("Power is outside the real domain for these values.");
      return value;
    }
    case "Function": {
      const args = expr.args.map(arg => evaluateInner(arg, bindings));
      if (args.length !== 1) throw new RangeError(`Function '${expr.name}' expects one argument.`);
      const x = args[0]!;
      switch (expr.name) {
        case "sin": return Math.sin(x);
        case "cos": return Math.cos(x);
        case "tan": return Math.tan(x);
        case "atan": return Math.atan(x);
        case "exp": return Math.exp(x);
        case "log": case "ln":
          if (x <= 0) throw new RangeError("Logarithm requires a positive real argument.");
          return Math.log(x);
        case "cbrt": return Math.cbrt(x);
        case "sqrt":
          if (x < 0) throw new RangeError("Square root requires a non-negative real argument.");
          return Math.sqrt(x);
        case "abs": return Math.abs(x);
        case "sign": return Math.sign(x);
        default: throw new RangeError(`Unsupported numeric function '${expr.name}'.`);
      }
    }
  }
}
