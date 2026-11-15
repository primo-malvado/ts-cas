import type { Expr } from "../core/expr.js";

/** IEEE-754 complex value. This is numerical, not arbitrary-precision arithmetic. */
export interface NumericComplex {
  readonly re: number;
  readonly im: number;
}

export type NumericComplexValue = number | NumericComplex;
export type NumericComplexBindings = Readonly<Record<string, NumericComplexValue>>;

const FINITE_MESSAGE = "Complex numeric operation produced a non-finite result.";

function checked(re: number, im = 0): NumericComplex {
  if (!Number.isFinite(re) || !Number.isFinite(im)) throw new RangeError(FINITE_MESSAGE);
  return { re, im };
}

export function numericComplex(re: number, im = 0): NumericComplex {
  return checked(re, im);
}

function valueOf(value: NumericComplexValue): NumericComplex {
  if (typeof value === "number") return checked(value, 0);
  if (!value || typeof value.re !== "number" || typeof value.im !== "number") {
    throw new TypeError("A complex value must have numeric 're' and 'im' properties.");
  }
  return checked(value.re, value.im);
}

export function numericComplexAdd(a: NumericComplexValue, b: NumericComplexValue): NumericComplex {
  const x = valueOf(a), y = valueOf(b);
  return checked(x.re + y.re, x.im + y.im);
}

export function numericComplexSubtract(a: NumericComplexValue, b: NumericComplexValue): NumericComplex {
  const x = valueOf(a), y = valueOf(b);
  return checked(x.re - y.re, x.im - y.im);
}

export function numericComplexMultiply(a: NumericComplexValue, b: NumericComplexValue): NumericComplex {
  const x = valueOf(a), y = valueOf(b);
  return checked(x.re * y.re - x.im * y.im, x.re * y.im + x.im * y.re);
}

/** Robust complex division that avoids forming c²+d² directly. */
export function numericComplexDivide(a: NumericComplexValue, b: NumericComplexValue): NumericComplex {
  const x = valueOf(a), y = valueOf(b);
  if (y.re === 0 && y.im === 0) throw new RangeError("Division by complex zero.");
  if (Math.abs(y.re) >= Math.abs(y.im)) {
    const ratio = y.im / y.re;
    const denominator = y.re + y.im * ratio;
    return checked((x.re + x.im * ratio) / denominator, (x.im - x.re * ratio) / denominator);
  }
  const ratio = y.re / y.im;
  const denominator = y.im + y.re * ratio;
  return checked((x.re * ratio + x.im) / denominator, (x.im * ratio - x.re) / denominator);
}

export function numericComplexConjugate(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  return checked(z.re, -z.im);
}

export function numericComplexAbs(value: NumericComplexValue): number {
  const z = valueOf(value);
  const result = Math.hypot(z.re, z.im);
  if (!Number.isFinite(result)) throw new RangeError(FINITE_MESSAGE);
  return result;
}

export function numericComplexExp(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  const magnitude = Math.exp(z.re);
  return checked(magnitude * Math.cos(z.im), magnitude * Math.sin(z.im));
}

/** Principal complex logarithm, with argument in [-pi, pi]. */
export function numericComplexLog(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  const magnitude = Math.hypot(z.re, z.im);
  if (magnitude === 0) throw new RangeError("The complex logarithm is undefined at zero.");
  return checked(Math.log(magnitude), Math.atan2(z.im, z.re));
}

/** Principal square root. */
export function numericComplexSqrt(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  if (z.re === 0 && z.im === 0) return checked(0, 0);
  const magnitude = Math.hypot(z.re, z.im);
  // Halve before adding/subtracting to avoid overflow for very large inputs.
  if (z.re >= 0) {
    const re = Math.sqrt(magnitude / 2 + z.re / 2);
    if (re === 0) return checked(0, Math.sqrt(Math.max(0, magnitude)));
    return checked(re, z.im / (2 * re));
  }
  const imMagnitude = Math.sqrt(magnitude / 2 - z.re / 2);
  const re = imMagnitude === 0 ? 0 : Math.abs(z.im) / (2 * imMagnitude);
  return checked(re, z.im < 0 ? -imMagnitude : imMagnitude);
}

export function numericComplexSin(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  return checked(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
}

export function numericComplexCos(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  return checked(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
}

export function numericComplexTan(value: NumericComplexValue): NumericComplex {
  return numericComplexDivide(numericComplexSin(value), numericComplexCos(value));
}

/** Principal complex power. Integer powers use exponentiation by squaring. */
export function numericComplexPow(base: NumericComplexValue, exponent: NumericComplexValue): NumericComplex {
  const z = valueOf(base), w = valueOf(exponent);
  if (z.re === 0 && z.im === 0) {
    if (w.im === 0 && w.re > 0) return checked(0, 0);
    if (w.re === 0 && w.im === 0) throw new RangeError("0^0 is undefined.");
    throw new RangeError("Zero cannot be raised to this complex power.");
  }
  if (w.im === 0 && Number.isInteger(w.re) && Math.abs(w.re) <= 10000) {
    let n = Math.abs(w.re);
    let factor = z;
    let result = checked(1, 0);
    while (n > 0) {
      if (n % 2 === 1) result = numericComplexMultiply(result, factor);
      n = Math.floor(n / 2);
      if (n > 0) factor = numericComplexMultiply(factor, factor);
    }
    return w.re < 0 ? numericComplexDivide(1, result) : result;
  }
  return numericComplexExp(numericComplexMultiply(w, numericComplexLog(z)));
}

/** Principal arctangent using logarithms: atan(z) = -i/2 log((1+iz)/(1-iz)). */
export function numericComplexAtan(value: NumericComplexValue): NumericComplex {
  const z = valueOf(value);
  const iz = checked(-z.im, z.re);
  const numerator = numericComplexAdd(1, iz);
  const denominator = numericComplexSubtract(1, iz);
  const ratio = numericComplexDivide(numerator, denominator);
  const logarithm = numericComplexLog(ratio);
  return numericComplexMultiply(checked(0, -0.5), logarithm);
}

/** Evaluate expressions over C using double precision and principal branches. */
export function evaluateComplex(expr: Expr, bindings: NumericComplexBindings = {}): NumericComplex {
  const result = evaluateComplexInner(expr, bindings);
  if (!Number.isFinite(result.re) || !Number.isFinite(result.im)) {
    throw new RangeError(FINITE_MESSAGE);
  }
  return result;
}

function evaluateComplexInner(expr: Expr, bindings: NumericComplexBindings): NumericComplex {
  switch (expr.kind) {
    case "Integer": return checked(Number(expr.value), 0);
    case "Rational": return checked(Number(expr.numerator) / Number(expr.denominator), 0);
    case "Symbol": {
      if (expr.name === "i") return checked(0, 1);
      if (expr.name === "pi") return checked(Math.PI, 0);
      if (expr.name === "E") return checked(Math.E, 0);
      const binding = bindings[expr.name];
      if (binding === undefined) throw new ReferenceError(`No numeric value supplied for symbol '${expr.name}'.`);
      return valueOf(binding);
    }
    case "Add": {
      let total = checked(0, 0);
      for (const term of expr.terms) total = numericComplexAdd(total, evaluateComplexInner(term, bindings));
      return total;
    }
    case "Mul": {
      let product = checked(1, 0);
      for (const factor of expr.factors) product = numericComplexMultiply(product, evaluateComplexInner(factor, bindings));
      return product;
    }
    case "Pow":
      return numericComplexPow(
        evaluateComplexInner(expr.base, bindings),
        evaluateComplexInner(expr.exponent, bindings),
      );
    case "Function": {
      const args = expr.args.map(arg => evaluateComplexInner(arg, bindings));
      if (args.length !== 1) throw new RangeError(`Function '${expr.name}' expects one argument.`);
      const z = args[0]!;
      switch (expr.name) {
        case "sin": return numericComplexSin(z);
        case "cos": return numericComplexCos(z);
        case "tan": return numericComplexTan(z);
        case "atan": return numericComplexAtan(z);
        case "exp": return numericComplexExp(z);
        case "log": case "ln": return numericComplexLog(z);
        case "sqrt": return numericComplexSqrt(z);
        case "abs": return checked(numericComplexAbs(z), 0);
        case "sign": {
          const magnitude = numericComplexAbs(z);
          return magnitude === 0 ? checked(0, 0) : numericComplexDivide(z, magnitude);
        }
        default: throw new RangeError(`Unsupported complex numeric function '${expr.name}'.`);
      }
    }
  }
}
