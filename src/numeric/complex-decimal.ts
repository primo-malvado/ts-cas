/**
 * Arbitrary-precision complex arithmetic backed by the BigInt decimal engine.
 * Principal branches are used for logarithm, square root, power and arctangent.
 * This layer is separate from the IEEE-754 complex evaluator for compatibility.
 */
import type { Expr } from "../core/expr.js";
import {
  decimal,
  decimalAbs,
  decimalAdd,
  decimalAtan,
  decimalCompare,
  decimalCos,
  decimalDivide,
  decimalExp,
  decimalLn,
  decimalMultiply,
  decimalNegate,
  decimalPi,
  decimalRound,
  decimalSin,
  decimalSqrt,
  decimalSubtract,
  decimalToString,
  type BigDecimal,
  type DecimalContext,
  type DecimalInput,
  type DecimalRoundingMode,
} from "./decimal.js";

export interface BigComplexDecimal {
  readonly re: BigDecimal;
  readonly im: BigDecimal;
}

export type ComplexDecimalInput = DecimalInput | BigComplexDecimal | {
  readonly re: DecimalInput;
  readonly im: DecimalInput;
};
export type ComplexDecimalBindings = Readonly<Record<string, ComplexDecimalInput | undefined>>;

const ZERO = decimal(0n);
const ONE = decimal(1n);
const TWO = decimal(2n);
const I: BigComplexDecimal = { re: ZERO, im: ONE };

function workContext(context: DecimalContext = {}, guard = 8): DecimalContext {
  const precision = context.precision ?? 50;
  if (!Number.isInteger(precision) || precision < 2 || precision > 10_000) {
    throw new RangeError("Precision must be an integer between 2 and 10000.");
  }
  return {
    precision: Math.min(10_000, precision + guard),
    rounding: context.rounding ?? "half-even",
  };
}

function rounded(value: BigComplexDecimal, context: DecimalContext): BigComplexDecimal {
  return {
    re: decimalRound(value.re, context.precision ?? 50, context.rounding ?? "half-even"),
    im: decimalRound(value.im, context.precision ?? 50, context.rounding ?? "half-even"),
  };
}

function toComplex(value: ComplexDecimalInput): BigComplexDecimal {
  if (typeof value === "object" && value !== null && "re" in value && "im" in value) {
    return { re: decimal(value.re), im: decimal(value.im) };
  }
  return { re: decimal(value as DecimalInput), im: ZERO };
}

function isZero(value: BigDecimal): boolean {
  return value.coefficient === 0n;
}

function sign(value: BigDecimal): -1 | 0 | 1 {
  const compared = decimalCompare(value, ZERO);
  return compared < 0 ? -1 : compared > 0 ? 1 : 0;
}

function integerExponent(value: BigComplexDecimal): bigint | null {
  if (!isZero(value.im)) return null;
  if (value.re.scale > 0) return null;
  // Every integer exponent outside [-10000, 10000] will be rejected anyway;
  // bound the scale before constructing a potentially enormous BigInt.
  if (value.re.scale < -4) throw new RangeError("Complex integer exponent exceeds the supported limit of 10000.");
  const exponent = value.re.coefficient * (10n ** BigInt(-value.re.scale));
  if (exponent > 10_000n || exponent < -10_000n) {
    throw new RangeError("Complex integer exponent exceeds the supported limit of 10000.");
  }
  return exponent;
}

export function complexDecimal(re: DecimalInput, im: DecimalInput = 0n): BigComplexDecimal {
  return { re: decimal(re), im: decimal(im) };
}

export function complexDecimalAdd(
  aInput: ComplexDecimalInput,
  bInput: ComplexDecimalInput,
  context: DecimalContext = {},
): BigComplexDecimal {
  const ctx = workContext(context);
  const a = toComplex(aInput), b = toComplex(bInput);
  return rounded({
    re: decimalAdd(a.re, b.re, ctx),
    im: decimalAdd(a.im, b.im, ctx),
  }, context);
}

export function complexDecimalSubtract(
  aInput: ComplexDecimalInput,
  bInput: ComplexDecimalInput,
  context: DecimalContext = {},
): BigComplexDecimal {
  const ctx = workContext(context);
  const a = toComplex(aInput), b = toComplex(bInput);
  return rounded({
    re: decimalSubtract(a.re, b.re, ctx),
    im: decimalSubtract(a.im, b.im, ctx),
  }, context);
}

export function complexDecimalNegate(value: ComplexDecimalInput): BigComplexDecimal {
  const z = toComplex(value);
  return { re: decimalNegate(z.re), im: decimalNegate(z.im) };
}

export function complexDecimalConjugate(value: ComplexDecimalInput): BigComplexDecimal {
  const z = toComplex(value);
  return { re: z.re, im: decimalNegate(z.im) };
}

export function complexDecimalMultiply(
  aInput: ComplexDecimalInput,
  bInput: ComplexDecimalInput,
  context: DecimalContext = {},
): BigComplexDecimal {
  const ctx = workContext(context);
  const a = toComplex(aInput), b = toComplex(bInput);
  const ac = decimalMultiply(a.re, b.re, ctx);
  const bd = decimalMultiply(a.im, b.im, ctx);
  const ad = decimalMultiply(a.re, b.im, ctx);
  const bc = decimalMultiply(a.im, b.re, ctx);
  return rounded({
    re: decimalSubtract(ac, bd, ctx),
    im: decimalAdd(ad, bc, ctx),
  }, context);
}

export function complexDecimalDivide(
  aInput: ComplexDecimalInput,
  bInput: ComplexDecimalInput,
  context: DecimalContext = {},
): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const a = toComplex(aInput), b = toComplex(bInput);
  const denominator = decimalAdd(
    decimalMultiply(b.re, b.re, ctx),
    decimalMultiply(b.im, b.im, ctx),
    ctx,
  );
  if (isZero(denominator)) throw new RangeError("Division by complex zero.");
  const realNumerator = decimalAdd(
    decimalMultiply(a.re, b.re, ctx),
    decimalMultiply(a.im, b.im, ctx),
    ctx,
  );
  const imaginaryNumerator = decimalSubtract(
    decimalMultiply(a.im, b.re, ctx),
    decimalMultiply(a.re, b.im, ctx),
    ctx,
  );
  return rounded({
    re: decimalDivide(realNumerator, denominator, ctx),
    im: decimalDivide(imaginaryNumerator, denominator, ctx),
  }, context);
}

export function complexDecimalAbs(value: ComplexDecimalInput, context: DecimalContext = {}): BigDecimal {
  const ctx = workContext(context, 10);
  const z = toComplex(value);
  const squared = decimalAdd(
    decimalMultiply(z.re, z.re, ctx),
    decimalMultiply(z.im, z.im, ctx),
    ctx,
  );
  return decimalRound(decimalSqrt(squared, ctx), context.precision ?? 50, context.rounding ?? "half-even");
}

export function complexDecimalExp(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  const magnitude = decimalExp(z.re, ctx);
  const cosine = decimalCos(z.im, ctx);
  const sine = decimalSin(z.im, ctx);
  return rounded({
    re: decimalMultiply(magnitude, cosine, ctx),
    im: decimalMultiply(magnitude, sine, ctx),
  }, context);
}

/** Principal argument in [-pi, pi]. */
export function complexDecimalArg(value: ComplexDecimalInput, context: DecimalContext = {}): BigDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  if (isZero(z.re)) {
    if (isZero(z.im)) throw new RangeError("The argument of complex zero is undefined.");
    const halfPi = decimalDivide(decimalPi(ctx), TWO, ctx);
    return decimalRound(sign(z.im) > 0 ? halfPi : decimalNegate(halfPi), context.precision ?? 50, context.rounding ?? "half-even");
  }
  const ratio = decimalDivide(z.im, z.re, ctx);
  let angle = decimalAtan(ratio, ctx);
  if (sign(z.re) < 0) {
    angle = sign(z.im) >= 0
      ? decimalAdd(angle, decimalPi(ctx), ctx)
      : decimalSubtract(angle, decimalPi(ctx), ctx);
  }
  return decimalRound(angle, context.precision ?? 50, context.rounding ?? "half-even");
}

/** Principal complex logarithm; the branch cut is the non-positive real axis. */
export function complexDecimalLog(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  const magnitude = complexDecimalAbs(z, ctx);
  if (isZero(magnitude)) throw new RangeError("The complex logarithm is undefined at zero.");
  return rounded({ re: decimalLn(magnitude, ctx), im: complexDecimalArg(z, ctx) }, context);
}

export const complexDecimalLn = complexDecimalLog;

/** Principal square root. */
export function complexDecimalSqrt(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  if (isZero(z.re) && isZero(z.im)) return { re: ZERO, im: ZERO };
  const magnitude = complexDecimalAbs(z, ctx);
  if (sign(z.re) >= 0) {
    const re = decimalSqrt(decimalDivide(decimalAdd(magnitude, z.re, ctx), TWO, ctx), ctx);
    if (isZero(re)) return rounded({ re: ZERO, im: decimalSqrt(magnitude, ctx) }, context);
    const im = decimalDivide(z.im, decimalMultiply(TWO, re, ctx), ctx);
    return rounded({ re, im }, context);
  }
  const imMagnitude = decimalSqrt(decimalDivide(decimalSubtract(magnitude, z.re, ctx), TWO, ctx), ctx);
  if (isZero(imMagnitude)) return rounded({ re: ZERO, im: ZERO }, context);
  const re = decimalDivide(decimalAbs(z.im), decimalMultiply(TWO, imMagnitude, ctx), ctx);
  return rounded({ re, im: sign(z.im) < 0 ? decimalNegate(imMagnitude) : imMagnitude }, context);
}

export function complexDecimalSin(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  const sine = decimalSin(z.re, ctx);
  const cosine = decimalCos(z.re, ctx);
  const expPositive = decimalExp(z.im, ctx);
  const expNegative = decimalExp(decimalNegate(z.im), ctx);
  const cosh = decimalDivide(decimalAdd(expPositive, expNegative, ctx), TWO, ctx);
  const sinh = decimalDivide(decimalSubtract(expPositive, expNegative, ctx), TWO, ctx);
  return rounded({
    re: decimalMultiply(sine, cosh, ctx),
    im: decimalMultiply(cosine, sinh, ctx),
  }, context);
}

export function complexDecimalCos(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  const cosine = decimalCos(z.re, ctx);
  const sine = decimalSin(z.re, ctx);
  const expPositive = decimalExp(z.im, ctx);
  const expNegative = decimalExp(decimalNegate(z.im), ctx);
  const cosh = decimalDivide(decimalAdd(expPositive, expNegative, ctx), TWO, ctx);
  const sinh = decimalDivide(decimalSubtract(expPositive, expNegative, ctx), TWO, ctx);
  return rounded({
    re: decimalMultiply(cosine, cosh, ctx),
    im: decimalNegate(decimalMultiply(sine, sinh, ctx)),
  }, context);
}

export function complexDecimalTan(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  return complexDecimalDivide(complexDecimalSin(value, context), complexDecimalCos(value, context), context);
}

export function complexDecimalAtan(value: ComplexDecimalInput, context: DecimalContext = {}): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const z = toComplex(value);
  const iz: BigComplexDecimal = { re: decimalNegate(z.im), im: z.re };
  const numerator = complexDecimalAdd(ONE, iz, ctx);
  const denominator = complexDecimalSubtract(ONE, iz, ctx);
  const ratio = complexDecimalDivide(numerator, denominator, ctx);
  const logarithm = complexDecimalLog(ratio, ctx);
  return rounded({
    re: decimalDivide(logarithm.im, decimal(2n), ctx),
    im: decimalDivide(decimalNegate(logarithm.re), decimal(2n), ctx),
  }, context);
}

export function complexDecimalPow(
  baseInput: ComplexDecimalInput,
  exponentInput: ComplexDecimalInput,
  context: DecimalContext = {},
): BigComplexDecimal {
  const ctx = workContext(context, 12);
  const base = toComplex(baseInput), exponent = toComplex(exponentInput);
  const integer = integerExponent(exponent);
  if (isZero(base.re) && isZero(base.im)) {
    if (integer === 0n) throw new RangeError("0^0 is undefined.");
    if (integer !== null && integer > 0n) return { re: ZERO, im: ZERO };
    if (isZero(exponent.im) && sign(exponent.re) > 0) return { re: ZERO, im: ZERO };
    throw new RangeError("Zero cannot be raised to this complex power.");
  }
  if (integer !== null) {
    let n = integer < 0n ? -integer : integer;
    let factor = base;
    let result: BigComplexDecimal = { re: ONE, im: ZERO };
    while (n > 0n) {
      if (n % 2n === 1n) result = complexDecimalMultiply(result, factor, ctx);
      n /= 2n;
      if (n > 0n) factor = complexDecimalMultiply(factor, factor, ctx);
    }
    return integer < 0n ? complexDecimalDivide({ re: ONE, im: ZERO }, result, context) : rounded(result, context);
  }
  const logarithm = complexDecimalLog(base, ctx);
  const product = complexDecimalMultiply(exponent, logarithm, ctx);
  return complexDecimalExp(product, context);
}

function evaluateInner(expr: Expr, bindings: ComplexDecimalBindings, context: DecimalContext): BigComplexDecimal {
  switch (expr.kind) {
    case "Integer": return { re: decimal(expr.value), im: ZERO };
    case "Rational": return {
      re: decimalDivide(decimal(expr.numerator), decimal(expr.denominator), context),
      im: ZERO,
    };
    case "Symbol": {
      if (expr.name === "i") return I;
      if (expr.name === "pi") return { re: decimalPi(context), im: ZERO };
      if (expr.name === "E") return { re: decimalExp(ONE, context), im: ZERO };
      const binding = bindings[expr.name];
      if (binding === undefined) throw new ReferenceError(`No complex decimal value supplied for symbol '${expr.name}'.`);
      return toComplex(binding);
    }
    case "Add": {
      return expr.terms.reduce((sum, term) => complexDecimalAdd(sum, evaluateInner(term, bindings, context), context), { re: ZERO, im: ZERO });
    }
    case "Mul": {
      return expr.factors.reduce((product, factor) => complexDecimalMultiply(product, evaluateInner(factor, bindings, context), context), { re: ONE, im: ZERO });
    }
    case "Pow":
      return complexDecimalPow(evaluateInner(expr.base, bindings, context), evaluateInner(expr.exponent, bindings, context), context);
    case "Function": {
      if (expr.args.length !== 1) throw new RangeError(`Function '${expr.name}' expects one argument.`);
      const value = evaluateInner(expr.args[0]!, bindings, context);
      switch (expr.name) {
        case "sin": return complexDecimalSin(value, context);
        case "cos": return complexDecimalCos(value, context);
        case "tan": return complexDecimalTan(value, context);
        case "atan": return complexDecimalAtan(value, context);
        case "exp": return complexDecimalExp(value, context);
        case "ln": case "log": return complexDecimalLog(value, context);
        case "sqrt": return complexDecimalSqrt(value, context);
        case "abs": return { re: complexDecimalAbs(value, context), im: ZERO };
        case "sign": {
          const magnitude = complexDecimalAbs(value, context);
          if (isZero(magnitude)) return { re: ZERO, im: ZERO };
          return complexDecimalDivide(value, { re: magnitude, im: ZERO }, context);
        }
        default: throw new RangeError(`Unsupported arbitrary-precision complex function '${expr.name}'.`);
      }
    }
  }
}

/** Evaluates a symbolic expression over C with configurable decimal precision. */
export function evaluateComplexDecimal(
  expression: Expr,
  bindings: ComplexDecimalBindings = {},
  context: DecimalContext = {},
): BigComplexDecimal {
  const requested = context.precision ?? 50;
  const rounding: DecimalRoundingMode = context.rounding ?? "half-even";
  const ctx = workContext({ precision: requested, rounding }, 12);
  const value = evaluateInner(expression, bindings, ctx);
  return rounded(value, { precision: requested, rounding });
}

export function complexDecimalToString(value: ComplexDecimalInput): string {
  const z = toComplex(value);
  if (isZero(z.im)) return decimalToString(z.re);
  if (isZero(z.re)) return `${decimalToString(z.im)}i`;
  const imagSign = sign(z.im) < 0 ? " - " : " + ";
  const imag = decimalToString(decimalAbs(z.im));
  return `${decimalToString(z.re)}${imagSign}${imag}i`;
}
