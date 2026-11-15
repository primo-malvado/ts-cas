/**
 * Arbitrary-precision decimal arithmetic backed by BigInt.
 *
 * Values are stored as coefficient * 10^(-scale). Addition and multiplication
 * can be exact; division and transcendental functions round to a configurable
 * number of significant decimal digits.
 *
 * This is a real-valued evaluator. It deliberately rejects non-real operations
 * rather than silently switching to IEEE-754 or complex arithmetic.
 */
import type { Expr } from "../core/expr.js";

export interface BigDecimal {
  readonly coefficient: bigint;
  /** Value = coefficient * 10^(-scale); scale may be negative. */
  readonly scale: number;
}

export type DecimalInput = BigDecimal | string | number | bigint;
export type DecimalRoundingMode = "half-even" | "half-up" | "toward-zero" | "floor" | "ceil";

export interface DecimalContext {
  /** Significant decimal digits, not digits after the decimal point. Default: 50. */
  readonly precision?: number;
  readonly rounding?: DecimalRoundingMode;
}

export type DecimalBindings = Readonly<Record<string, DecimalInput | undefined>>;

const DEFAULT_PRECISION = 50;
const MAX_PRECISION = 10_000;
const MAX_POWER10 = 200_000;
const MAX_SERIES_ITERATIONS = 100_000;

const TEN = 10n;
const TWO = 2n;
const ZERO = decimalRaw(0n, 0);
const ONE = decimalRaw(1n, 0);

function decimalRaw(coefficient: bigint, scale: number): BigDecimal {
  return { coefficient, scale };
}

function validateScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > MAX_POWER10) {
    throw new RangeError("Decimal scale is outside the supported range.");
  }
}

function pow10(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > MAX_POWER10) {
    throw new RangeError("Decimal operation requires too many powers of ten.");
  }
  return TEN ** BigInt(exponent);
}

function normalize(coefficient: bigint, scale: number): BigDecimal {
  validateScale(scale);
  if (coefficient === 0n) return ZERO;
  let c = coefficient;
  let s = scale;
  while (c % TEN === 0n) {
    c /= TEN;
    s--;
  }
  validateScale(s);
  return decimalRaw(c, s);
}

function isBigDecimal(value: unknown): value is BigDecimal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BigDecimal>;
  return typeof candidate.coefficient === "bigint" &&
    typeof candidate.scale === "number" &&
    Number.isSafeInteger(candidate.scale);
}

function contextPrecision(context: DecimalContext = {}): number {
  const precision = context.precision ?? DEFAULT_PRECISION;
  if (!Number.isInteger(precision) || precision < 2 || precision > MAX_PRECISION) {
    throw new RangeError(`Precision must be an integer between 2 and ${MAX_PRECISION}.`);
  }
  return precision;
}

function contextRounding(context: DecimalContext = {}): DecimalRoundingMode {
  const mode = context.rounding ?? "half-even";
  if (!["half-even", "half-up", "toward-zero", "floor", "ceil"].includes(mode)) {
    throw new RangeError(`Unsupported decimal rounding mode '${String(mode)}'.`);
  }
  return mode;
}

function signedRoundedQuotient(
  numerator: bigint,
  denominator: bigint,
  mode: DecimalRoundingMode,
): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero.");
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  const r = n % d;
  if (r === 0n) return sign * q;

  let increment = false;
  switch (mode) {
    case "toward-zero": increment = false; break;
    case "floor": increment = sign < 0n; break;
    case "ceil": increment = sign > 0n; break;
    case "half-up": increment = r * 2n >= d; break;
    case "half-even": {
      const twice = r * 2n;
      increment = twice > d || (twice === d && q % 2n !== 0n);
      break;
    }
  }
  if (increment) q++;
  return sign * q;
}

function exponent10(value: BigDecimal): number {
  if (value.coefficient === 0n) return Number.NEGATIVE_INFINITY;
  return value.coefficient.toString().replace("-", "").length - 1 - value.scale;
}

function isNegligible(term: BigDecimal, sum: BigDecimal, precision: number): boolean {
  if (term.coefficient === 0n) return true;
  if (sum.coefficient === 0n) return false;
  return exponent10(term) < exponent10(sum) - precision - 2;
}

function integerSquareRoot(n: bigint): bigint {
  if (n < 0n) throw new RangeError("Integer square root requires a non-negative value.");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  while (true) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/** Parses ordinary and scientific decimal notation without losing input digits. */
export function parseDecimal(input: string): BigDecimal {
  const text = input.trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new SyntaxError(`Invalid decimal literal '${input}'.`);
  const sign = match[1] === "-" ? -1n : 1n;
  const integerPart = match[2] ?? "0";
  const fractionPart = match[3] ?? match[4] ?? "";
  const exponentText = match[5] ?? "0";
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_POWER10) {
    throw new RangeError("Decimal exponent is outside the supported range.");
  }
  const digits = `${integerPart}${fractionPart}`.replace(/^0+(?=\d)/, "");
  const coefficient = sign * BigInt(digits || "0");
  return normalize(coefficient, fractionPart.length - exponent);
}

/** Creates a decimal from text, bigint, number, or an existing BigDecimal value. */
export function decimal(value: DecimalInput): BigDecimal {
  if (typeof value === "string") return parseDecimal(value);
  if (typeof value === "bigint") return normalize(value, 0);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Decimal input must be finite.");
    return parseDecimal(Object.is(value, -0) ? "0" : value.toString());
  }
  if (isBigDecimal(value)) return normalize(value.coefficient, value.scale);
  throw new TypeError("Unsupported decimal input.");
}

/** Exact decimal representation of 10^exponent. */
export function decimalPowerOfTen(exponent: number): BigDecimal {
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_POWER10) {
    throw new RangeError("Decimal exponent is outside the supported range.");
  }
  return normalize(1n, -exponent);
}

export function decimalToString(value: BigDecimal): string {
  const { coefficient, scale } = normalize(value.coefficient, value.scale);
  if (coefficient === 0n) return "0";
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  let body: string;
  if (scale <= 0) {
    if (-scale > MAX_POWER10) throw new RangeError("Decimal string would be too large.");
    body = digits + "0".repeat(-scale);
  } else if (scale >= digits.length) {
    body = `0.${"0".repeat(scale - digits.length)}${digits}`;
  } else {
    const split = digits.length - scale;
    body = `${digits.slice(0, split)}.${digits.slice(split)}`;
  }
  return negative ? `-${body}` : body;
}

export function decimalToScientificString(value: BigDecimal): string {
  const normalized = normalize(value.coefficient, value.scale);
  if (normalized.coefficient === 0n) return "0";
  const negative = normalized.coefficient < 0n;
  const digits = (negative ? -normalized.coefficient : normalized.coefficient).toString();
  const exponent = digits.length - 1 - normalized.scale;
  const mantissa = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
  return `${negative ? "-" : ""}${mantissa}e${exponent >= 0 ? "+" : ""}${exponent}`;
}

export function decimalToNumber(value: BigDecimal): number {
  return Number(decimalToString(value));
}

/** Rounds to a number of significant digits using the selected rounding mode. */
export function decimalRound(
  value: BigDecimal,
  precision = DEFAULT_PRECISION,
  rounding: DecimalRoundingMode = "half-even",
): BigDecimal {
  contextPrecision({ precision });
  // Validate the rounding mode even when the value already fits the requested
  // precision; otherwise invalid runtime values silently pass through.
  contextRounding({ rounding });
  const normalized = normalize(value.coefficient, value.scale);
  if (normalized.coefficient === 0n) return ZERO;
  const digits = (normalized.coefficient < 0n
    ? -normalized.coefficient
    : normalized.coefficient).toString().length;
  const remove = digits - precision;
  if (remove <= 0) return normalized;
  const divisor = pow10(remove);
  const roundedCoefficient = signedRoundedQuotient(
    normalized.coefficient,
    divisor,
    rounding,
  );
  return normalize(roundedCoefficient, normalized.scale - remove);
}

export function decimalNegate(value: BigDecimal): BigDecimal {
  return normalize(-value.coefficient, value.scale);
}

export function decimalAbs(value: BigDecimal): BigDecimal {
  return value.coefficient < 0n ? decimalNegate(value) : normalize(value.coefficient, value.scale);
}

export function decimalCompare(a: BigDecimal, b: BigDecimal): -1 | 0 | 1 {
  const left = normalize(a.coefficient, a.scale);
  const right = normalize(b.coefficient, b.scale);
  if (left.coefficient === right.coefficient && left.scale === right.scale) return 0;
  if (left.coefficient < 0n && right.coefficient >= 0n) return -1;
  if (left.coefficient >= 0n && right.coefficient < 0n) return 1;
  if (left.coefficient === 0n) return right.coefficient === 0n ? 0 : right.coefficient > 0n ? -1 : 1;
  if (right.coefficient === 0n) return left.coefficient > 0n ? 1 : -1;

  const leftNegative = left.coefficient < 0n;
  const leftDigits = (leftNegative ? -left.coefficient : left.coefficient).toString();
  const rightDigits = (right.coefficient < 0n ? -right.coefficient : right.coefficient).toString();
  const leftExponent = leftDigits.length - 1 - left.scale;
  const rightExponent = rightDigits.length - 1 - right.scale;
  let magnitude: number;
  if (leftExponent !== rightExponent) {
    magnitude = leftExponent < rightExponent ? -1 : 1;
  } else {
    const length = Math.max(leftDigits.length, rightDigits.length);
    const l = leftDigits.padEnd(length, "0");
    const r = rightDigits.padEnd(length, "0");
    magnitude = l === r ? 0 : l < r ? -1 : 1;
  }
  return (leftNegative ? -magnitude : magnitude) as -1 | 0 | 1;
}

export function decimalAdd(
  a: BigDecimal,
  b: BigDecimal,
  context?: DecimalContext,
): BigDecimal {
  const scale = Math.max(a.scale, b.scale);
  const left = a.coefficient * pow10(scale - a.scale);
  const right = b.coefficient * pow10(scale - b.scale);
  const sum = normalize(left + right, scale);
  return context ? decimalRound(sum, contextPrecision(context), contextRounding(context)) : sum;
}

export function decimalSubtract(
  a: BigDecimal,
  b: BigDecimal,
  context?: DecimalContext,
): BigDecimal {
  return decimalAdd(a, decimalNegate(b), context);
}

export function decimalMultiply(
  a: BigDecimal,
  b: BigDecimal,
  context?: DecimalContext,
): BigDecimal {
  const product = normalize(a.coefficient * b.coefficient, a.scale + b.scale);
  return context ? decimalRound(product, contextPrecision(context), contextRounding(context)) : product;
}

export function decimalDivide(
  a: BigDecimal,
  b: BigDecimal,
  context: DecimalContext = {},
): BigDecimal {
  if (b.coefficient === 0n) throw new RangeError("Division by zero.");
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  if (a.coefficient === 0n) return ZERO;

  const aAbs = a.coefficient < 0n ? -a.coefficient : a.coefficient;
  const bAbs = b.coefficient < 0n ? -b.coefficient : b.coefficient;
  const aDigits = aAbs.toString().length;
  const bDigits = bAbs.toString().length;
  let ratioExponent = aDigits - bDigits;
  if (ratioExponent >= 0) {
    if (aAbs < bAbs * pow10(ratioExponent)) ratioExponent--;
  } else if (aAbs * pow10(-ratioExponent) < bAbs) {
    ratioExponent--;
  }
  const valueExponent = ratioExponent + b.scale - a.scale;
  const targetScale = precision - 1 - valueExponent;
  const scaleShift = b.scale - a.scale + targetScale;
  const numerator = scaleShift >= 0 ? aAbs * pow10(scaleShift) : aAbs;
  const denominator = scaleShift < 0 ? bAbs * pow10(-scaleShift) : bAbs;
  const signedNumerator = (a.coefficient < 0n) !== (b.coefficient < 0n) ? -numerator : numerator;
  return normalize(signedRoundedQuotient(signedNumerator, denominator, rounding), targetScale);
}

export function decimalPowInteger(
  base: BigDecimal,
  exponent: bigint,
  context: DecimalContext = {},
): BigDecimal {
  if (exponent === 0n) {
    if (base.coefficient === 0n) throw new RangeError("0^0 is undefined.");
    return ONE;
  }
  if (base.coefficient === 0n && exponent < 0n) {
    throw new RangeError("Zero cannot be raised to a negative power.");
  }
  if (exponent > 10_000n || exponent < -10_000n) {
    throw new RangeError("Integer exponent exceeds the supported limit of 10000.");
  }
  let n = exponent < 0n ? -exponent : exponent;
  let factor = normalize(base.coefficient, base.scale);
  let result = ONE;
  while (n > 0n) {
    if (n % 2n === 1n) result = decimalMultiply(result, factor, context);
    n /= 2n;
    if (n > 0n) factor = decimalMultiply(factor, factor, context);
  }
  return exponent < 0n ? decimalDivide(ONE, result, context) : result;
}

export function decimalSqrt(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  if (value.coefficient < 0n) throw new RangeError("Square root requires a non-negative real value.");
  if (value.coefficient === 0n) return ZERO;
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  const workPrecision = Math.min(MAX_PRECISION, precision + 8);
  const rounded = decimalRound(value, workPrecision, rounding);
  const valueExponent = exponent10(rounded);
  const rootExponent = Math.floor(valueExponent / 2);
  const targetScale = workPrecision - 1 - rootExponent;
  const shift = 2 * targetScale - rounded.scale;
  if (shift < 0) throw new RangeError("Unable to scale this square root at the requested precision.");
  const radicand = rounded.coefficient * pow10(shift);
  let root = integerSquareRoot(radicand);
  const exact = root * root === radicand;
  if (!exact) {
    if (rounding === "ceil") root++;
    else if (rounding === "half-up" || rounding === "half-even") {
      const fourN = 4n * radicand;
      const midpointSquared = (2n * root + 1n) ** 2n;
      if (fourN > midpointSquared ||
        (fourN === midpointSquared && (rounding === "half-up" || root % 2n !== 0n))) root++;
    }
  }
  return decimalRound(normalize(root, targetScale), precision, rounding);
}

function integerCubeRoot(value: bigint): bigint {
  if (value < 0n) throw new RangeError("Integer cube root expects a non-negative integer.");
  if (value < 2n) return value;
  const bitLength = value.toString(2).length;
  let root = 1n << BigInt(Math.ceil(bitLength / 3));
  while (true) {
    const next = (2n * root + value / (root * root)) / 3n;
    if (next >= root) return root;
    root = next;
  }
}

/** Correctly rounded real cube root, including negative values and arbitrary decimal magnitudes. */
export function decimalCbrt(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  if (value.coefficient === 0n) return ZERO;
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  if (value.coefficient < 0n) {
    const inverseRounding: DecimalRoundingMode = rounding === "floor" ? "ceil"
      : rounding === "ceil" ? "floor" : rounding;
    return decimalNegate(decimalCbrt(decimalAbs(value), { precision, rounding: inverseRounding }));
  }
  const workPrecision = Math.min(MAX_PRECISION, precision + 8);
  const rounded = decimalRound(value, workPrecision, rounding);
  const valueExponent = exponent10(rounded);
  const rootExponent = Math.floor(valueExponent / 3);
  const targetScale = workPrecision - 1 - rootExponent;
  const shift = 3 * targetScale - rounded.scale;
  if (shift < 0) throw new RangeError("Unable to scale this cube root at the requested precision.");
  const radicand = rounded.coefficient * pow10(shift);
  let root = integerCubeRoot(radicand);
  const cube = root ** 3n;
  const exact = cube === radicand;
  if (!exact) {
    if (rounding === "ceil") root++;
    else if (rounding === "half-up" || rounding === "half-even") {
      const eightTimesRadicand = 8n * radicand;
      const midpointCube = (2n * root + 1n) ** 3n;
      if (eightTimesRadicand > midpointCube || (eightTimesRadicand === midpointCube && (rounding === "half-up" || root % 2n !== 0n))) root++;
    }
  }
  return decimalRound(normalize(root, targetScale), precision, rounding);
}

function decimalIsNegligible(term: BigDecimal, sum: BigDecimal, precision: number): boolean {
  return isNegligible(term, sum, precision);
}

function lnSeries(value: BigDecimal, context: DecimalContext): BigDecimal {
  // ln(value) = 2 * (z + z^3/3 + z^5/5 + ...), z=(value-1)/(value+1).
  const working = { precision: contextPrecision(context) + 8, rounding: contextRounding(context) };
  const z = decimalDivide(
    decimalSubtract(value, ONE, working),
    decimalAdd(value, ONE, working),
    working,
  );
  if (z.coefficient === 0n) return ZERO;
  const zSquared = decimalMultiply(z, z, working);
  let term = z;
  let sum = z;
  for (let n = 1; n < MAX_SERIES_ITERATIONS; n++) {
    term = decimalMultiply(term, zSquared, working);
    const contribution = decimalDivide(term, decimal(BigInt(2 * n + 1)), working);
    sum = decimalAdd(sum, contribution, working);
    if (decimalIsNegligible(contribution, sum, working.precision!)) {
      return decimalMultiply(decimal(2n), sum, working);
    }
  }
  throw new RangeError("Logarithm series did not converge within the iteration limit.");
}

const ln10Cache = new Map<number, BigDecimal>();

export function decimalLn(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  if (value.coefficient <= 0n) throw new RangeError("Natural logarithm requires a positive real value.");
  const precision = contextPrecision(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 8),
    rounding: contextRounding(context),
  };
  const exponent = exponent10(value);
  // Normalize x = m * 10^exponent with 1 <= m < 10 to keep the series stable.
  const mantissa = normalize(value.coefficient, value.scale + exponent);
  const lnMantissa = lnSeries(mantissa, working);
  let ln10 = ln10Cache.get(working.precision!);
  if (!ln10) {
    ln10 = lnSeries(decimal(10n), working);
    ln10Cache.set(working.precision!, ln10);
  }
  const result = decimalAdd(lnMantissa, decimalMultiply(decimal(exponent), ln10, working), working);
  return decimalRound(result, precision, contextRounding(context));
}

export function decimalExp(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 8),
    rounding,
  };
  const bound = decimal(10_000n);
  if (decimalCompare(decimalAbs(value), bound) > 0) {
    throw new RangeError("Exponential argument magnitude exceeds 10000.");
  }
  if (value.coefficient === 0n) return ONE;

  // Repeatedly halve the argument until |y| <= 1/8, evaluate exp(y), then square.
  const threshold = decimal("0.125");
  let y = normalize(value.coefficient, value.scale);
  let squarings = 0;
  while (decimalCompare(decimalAbs(y), threshold) > 0) {
    y = decimalDivide(y, decimal(2n), working);
    squarings++;
    if (squarings > 32) throw new RangeError("Exponential range reduction exceeded its limit.");
  }

  let term = ONE;
  let sum = ONE;
  for (let n = 1; n < MAX_SERIES_ITERATIONS; n++) {
    term = decimalDivide(decimalMultiply(term, y, working), decimal(BigInt(n)), working);
    sum = decimalAdd(sum, term, working);
    if (decimalIsNegligible(term, sum, working.precision!)) break;
    if (n === MAX_SERIES_ITERATIONS - 1) {
      throw new RangeError("Exponential series did not converge within the iteration limit.");
    }
  }
  for (let i = 0; i < squarings; i++) sum = decimalMultiply(sum, sum, working);
  return decimalRound(sum, precision, rounding);
}

function atanSeriesSmall(value: BigDecimal, context: DecimalContext): BigDecimal {
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, contextPrecision(context) + 8),
    rounding: contextRounding(context),
  };
  const squared = decimalMultiply(value, value, working);
  let term = value;
  let sum = value;
  for (let n = 1; n < MAX_SERIES_ITERATIONS; n++) {
    term = decimalNegate(decimalMultiply(term, squared, working));
    const contribution = decimalDivide(term, decimal(BigInt(2 * n + 1)), working);
    sum = decimalAdd(sum, contribution, working);
    if (decimalIsNegligible(contribution, sum, working.precision!)) {
      return decimalRound(sum, contextPrecision(context), contextRounding(context));
    }
  }
  throw new RangeError("Arctangent series did not converge within the iteration limit.");
}

export function decimalPi(context: DecimalContext = {}): BigDecimal {
  const precision = contextPrecision(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 8),
    rounding: contextRounding(context),
  };
  // Machin's formula: pi = 16 atan(1/5) - 4 atan(1/239).
  const a = atanSeriesSmall(decimalDivide(ONE, decimal(5n), working), working);
  const b = atanSeriesSmall(decimalDivide(ONE, decimal(239n), working), working);
  const result = decimalSubtract(
    decimalMultiply(decimal(16n), a, working),
    decimalMultiply(decimal(4n), b, working),
    working,
  );
  return decimalRound(result, precision, contextRounding(context));
}

export function decimalAtan(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  const precision = contextPrecision(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 8),
    rounding: contextRounding(context),
  };
  if (value.coefficient === 0n) return ZERO;
  const negative = value.coefficient < 0n;
  const x = decimalAbs(value);
  const one = ONE;
  let result: BigDecimal;
  if (decimalCompare(x, decimal("0.5")) <= 0) {
    result = atanSeriesSmall(x, working);
  } else if (decimalCompare(x, one) <= 0) {
    const ratio = decimalDivide(decimalSubtract(x, one, working), decimalAdd(x, one, working), working);
    result = decimalAdd(decimalDivide(decimalPi(working), decimal(4n), working), atanSeriesSmall(ratio, working), working);
  } else {
    const reciprocal = decimalDivide(one, x, working);
    result = decimalSubtract(
      decimalDivide(decimalPi(working), decimal(2n), working),
      decimalAtan(reciprocal, working),
      working,
    );
  }
  if (negative) result = decimalNegate(result);
  return decimalRound(result, precision, contextRounding(context));
}

function nearestInteger(value: BigDecimal): bigint {
  const normalized = normalize(value.coefficient, value.scale);
  if (normalized.coefficient === 0n) return 0n;
  if (normalized.scale <= 0) {
    return normalized.coefficient * pow10(-normalized.scale);
  }
  const denominator = pow10(normalized.scale);
  const negative = normalized.coefficient < 0n;
  const magnitude = negative ? -normalized.coefficient : normalized.coefficient;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  // Round to the nearest whole turn; tie direction is immaterial after the
  // subsequent exact-decimal adjustment into [-pi, pi].
  if (remainder * 2n >= denominator) quotient++;
  return negative ? -quotient : quotient;
}

function reduceAngle(value: BigDecimal, context: DecimalContext): BigDecimal {
  // Do not convert the argument to a JavaScript number here. Such a conversion
  // discards low-order decimal digits (for example, 1e12 + 1e-20), exactly the
  // digits a high-precision sine/cosine evaluation is expected to preserve.
  const maxMagnitude = decimal("1000000000000");
  if (decimalCompare(decimalAbs(value), maxMagnitude) > 0) {
    throw new RangeError("Trigonometric argument is too large for reliable arbitrary-precision range reduction (|x| must be <= 1e12).");
  }
  const pi = decimalPi(context);
  const twoPi = decimalMultiply(decimal(2n), pi, context);
  const turns = nearestInteger(decimalDivide(value, twoPi, context));
  let reduced = decimalSubtract(value, decimalMultiply(decimal(turns), twoPi, context), context);
  while (decimalCompare(reduced, pi) > 0) reduced = decimalSubtract(reduced, twoPi, context);
  while (decimalCompare(reduced, decimalNegate(pi)) < 0) reduced = decimalAdd(reduced, twoPi, context);
  return reduced;
}

export function decimalSin(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 10),
    rounding,
  };
  const x = reduceAngle(value, working);
  const xSquared = decimalMultiply(x, x, working);
  let term = x;
  let sum = x;
  for (let k = 1; k < MAX_SERIES_ITERATIONS; k++) {
    term = decimalNegate(decimalDivide(
      decimalMultiply(term, xSquared, working),
      decimal(BigInt((2 * k) * (2 * k + 1))),
      working,
    ));
    sum = decimalAdd(sum, term, working);
    if (decimalIsNegligible(term, sum, working.precision!)) {
      return decimalRound(sum, precision, rounding);
    }
  }
  throw new RangeError("Sine series did not converge within the iteration limit.");
}

export function decimalCos(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 10),
    rounding,
  };
  const x = reduceAngle(value, working);
  const xSquared = decimalMultiply(x, x, working);
  let term = ONE;
  let sum = ONE;
  for (let k = 1; k < MAX_SERIES_ITERATIONS; k++) {
    term = decimalNegate(decimalDivide(
      decimalMultiply(term, xSquared, working),
      decimal(BigInt((2 * k - 1) * (2 * k)),
      ),
      working,
    ));
    sum = decimalAdd(sum, term, working);
    if (decimalIsNegligible(term, sum, working.precision!)) {
      return decimalRound(sum, precision, rounding);
    }
  }
  throw new RangeError("Cosine series did not converge within the iteration limit.");
}

export function decimalTan(value: BigDecimal, context: DecimalContext = {}): BigDecimal {
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, contextPrecision(context) + 8),
    rounding: contextRounding(context),
  };
  const cosine = decimalCos(value, working);
  if (cosine.coefficient === 0n) throw new RangeError("Tangent is undefined at this argument.");
  return decimalDivide(decimalSin(value, working), cosine, context);
}

function integerValue(value: BigDecimal): bigint | null {
  if (value.coefficient === 0n) return 0n;
  if (value.scale > 0) return null;
  return value.coefficient * pow10(-value.scale);
}

export function decimalPow(
  base: BigDecimal,
  exponent: BigDecimal,
  context: DecimalContext = {},
): BigDecimal {
  const integerExponent = integerValue(exponent);
  if (integerExponent !== null) return decimalPowInteger(base, integerExponent, context);
  if (base.coefficient < 0n) {
    throw new RangeError("A negative real base requires an integer exponent in the real decimal evaluator.");
  }
  if (base.coefficient === 0n) {
    if (exponent.coefficient > 0n) return ZERO;
    throw new RangeError("Zero cannot be raised to a non-positive power.");
  }
  return decimalExp(decimalMultiply(exponent, decimalLn(base, context), context), context);
}

/** Evaluates arithmetic expressions with configurable significant decimal digits. */
export function evaluateDecimal(
  expression: Expr,
  bindings: DecimalBindings = {},
  context: DecimalContext = {},
): BigDecimal {
  const precision = contextPrecision(context);
  const rounding = contextRounding(context);
  const working: DecimalContext = {
    precision: Math.min(MAX_PRECISION, precision + 8),
    rounding,
  };
  const result = evaluateInner(expression, bindings, working);
  return decimalRound(result, precision, rounding);
}

function evaluateInner(
  expression: Expr,
  bindings: DecimalBindings,
  context: DecimalContext,
): BigDecimal {
  switch (expression.kind) {
    case "Integer": return decimal(expression.value);
    case "Rational": return decimalDivide(
      decimal(expression.numerator),
      decimal(expression.denominator),
      context,
    );
    case "Symbol": {
      const bound = bindings[expression.name];
      if (bound !== undefined) return decimal(bound);
      if (expression.name === "pi") return decimalPi(context);
      if (expression.name === "E") return decimalExp(ONE, context);
      throw new ReferenceError(`No decimal value supplied for symbol '${expression.name}'.`);
    }
    case "Add": {
      return expression.terms.reduce(
        (sum, term) => decimalAdd(sum, evaluateInner(term, bindings, context), context),
        ZERO,
      );
    }
    case "Mul": {
      return expression.factors.reduce(
        (product, factor) => decimalMultiply(product, evaluateInner(factor, bindings, context), context),
        ONE,
      );
    }
    case "Pow": {
      return decimalPow(
        evaluateInner(expression.base, bindings, context),
        evaluateInner(expression.exponent, bindings, context),
        context,
      );
    }
    case "Function": {
      if (expression.args.length !== 1) {
        throw new RangeError(`Function '${expression.name}' expects one argument.`);
      }
      const x = evaluateInner(expression.args[0]!, bindings, context);
      switch (expression.name) {
        case "sin": return decimalSin(x, context);
        case "cos": return decimalCos(x, context);
        case "tan": return decimalTan(x, context);
        case "atan": return decimalAtan(x, context);
        case "exp": return decimalExp(x, context);
        case "ln":
        case "log": return decimalLn(x, context);
        case "sqrt": return decimalSqrt(x, context);
        case "cbrt": return decimalCbrt(x, context);
        case "abs": return decimalAbs(x);
        case "sign": return decimal(x.coefficient === 0n ? 0n : x.coefficient < 0n ? -1n : 1n);
        default: throw new RangeError(`Unsupported high-precision numeric function '${expression.name}'.`);
      }
    }
  }
}
